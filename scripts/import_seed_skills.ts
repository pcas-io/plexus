/**
 * One-shot importer for migrations/seed_skills/*.md.
 *
 * Reads each Markdown file with YAML frontmatter, splits off the body,
 * and calls EntityRepository.save() with kind='skill'. Idempotent:
 * skips any skill whose `attributes.name` already exists (active) in
 * the target context.
 *
 * Usage:
 *   npx tsx scripts/import_seed_skills.ts --context dev
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Surreal } from 'surrealdb';
import { loadConfig } from '../src/config.js';
import { EntityRepository } from '../src/db/repositories/entities.js';
import { SkillRepository } from '../src/db/repositories/skills.js';
import { runMigrations } from '../src/db/migrations.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SEED_DIR = join(__dirname, '..', 'migrations', 'seed_skills');

interface Frontmatter {
  name: string;
  description: string;
  version: string;
  category?: string;
  trigger_phrases?: string[];
}

function parseFrontmatter(raw: string): { meta: Frontmatter; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!match) throw new Error('no frontmatter delimiter');
  const head = match[1]!;
  const body = match[2]!;
  const meta: Partial<Frontmatter> & { trigger_phrases?: string[] } = {};
  let inTriggers = false;
  const triggers: string[] = [];
  for (const rawLine of head.split(/\r?\n/)) {
    if (inTriggers) {
      const m = /^\s*-\s*"?([^"]+?)"?\s*$/.exec(rawLine);
      if (m) { triggers.push(m[1]!); continue; }
      inTriggers = false;
    }
    const kv = /^(\w+):\s*(.*)$/.exec(rawLine);
    if (!kv) continue;
    const key = kv[1]!;
    const val = kv[2]!.replace(/^"(.*)"$/, '$1').trim();
    if (key === 'trigger_phrases') { inTriggers = true; continue; }
    if (key === 'name') meta.name = val;
    else if (key === 'description') meta.description = val;
    else if (key === 'version') meta.version = val;
    else if (key === 'category') meta.category = val;
  }
  if (triggers.length > 0) meta.trigger_phrases = triggers;
  if (!meta.name || !meta.description || !meta.version) {
    throw new Error('missing required frontmatter (name/description/version)');
  }
  return { meta: meta as Frontmatter, body: body.trimEnd() + '\n' };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const contextIdx = args.indexOf('--context');
  if (contextIdx === -1 || !args[contextIdx + 1]) {
    console.error('usage: tsx scripts/import_seed_skills.ts --context <ctx>');
    process.exit(1);
  }
  const context = args[contextIdx + 1]!;

  const cfg = loadConfig();
  const db = new Surreal();
  // Config shape: cfg.surreal.{url, user, pass, namespace, database}
  // (see src/config.ts — PlexusConfig.surreal)
  await db.connect(cfg.surreal.url);
  await db.signin({ username: cfg.surreal.user, password: cfg.surreal.pass });
  await db.use({ namespace: cfg.surreal.namespace, database: cfg.surreal.database });
  await runMigrations(db);

  const entities = new EntityRepository(db);
  const skills = new SkillRepository(entities);

  const userResult = await db.query<[Array<{ id: unknown }>]>(
    'SELECT id FROM users WHERE is_admin = true LIMIT 1;'
  );
  const adminRow = userResult[0]?.[0];
  if (!adminRow) {
    console.error('No admin user found. Seed an admin user first.');
    await db.close();
    process.exit(1);
  }
  const adminId = String((adminRow.id as { toString(): string }).toString());

  const existing = await skills.list({ context });
  const existingNames = new Set(
    existing.map((s) => (s.attributes as Record<string, unknown>).name).filter((n): n is string => typeof n === 'string')
  );

  const files = (await readdir(SEED_DIR)).filter((f) => f.endsWith('.md') && f !== 'README.md');
  let created = 0;
  let skipped = 0;
  for (const file of files) {
    const raw = await readFile(join(SEED_DIR, file), 'utf8');
    let parsed;
    try {
      parsed = parseFrontmatter(raw);
    } catch (err) {
      console.error(`[seed_skills] ${file}: ${(err as Error).message}`);
      continue;
    }
    if (existingNames.has(parsed.meta.name)) {
      console.log(`[seed_skills] skip ${parsed.meta.name} (already exists in ${context})`);
      skipped += 1;
      continue;
    }
    const saved = await entities.save(
      {
        kind: 'skill',
        title: parsed.meta.name,
        body: parsed.body,
        attributes: {
          name: parsed.meta.name,
          description: parsed.meta.description,
          version: parsed.meta.version,
          category: parsed.meta.category,
          trigger_phrases: parsed.meta.trigger_phrases ?? [],
        },
        context,
      },
      adminId
    );
    console.log(`[seed_skills] created ${parsed.meta.name} -> ${saved.id}`);
    created += 1;
  }
  console.log(`[seed_skills] done: ${created} created, ${skipped} skipped`);
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
