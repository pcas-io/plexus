/**
 * SurrealQL migration runner.
 *
 * Reads all .surql files from /app/migrations (relative to the worker binary),
 * sorts them by filename (naming convention: NNNN_description.surql), and
 * applies any that have not yet been recorded in the _migrations table.
 *
 * Idempotent: can be run on every startup without side effects.
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Surreal } from 'surrealdb';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Migrations live at <repo-root>/migrations. From dist/db/migrations.js that's ../../migrations
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

interface MigrationRecord {
  name: string;
}

export async function runMigrations(db: Surreal): Promise<void> {
  // Step 1: Ensure the _migrations tracking table exists.
  // Has to run outside any real migration because we use it to track them.
  await db.query(`
    DEFINE TABLE IF NOT EXISTS _migrations SCHEMAFULL;
    DEFINE FIELD IF NOT EXISTS name ON _migrations TYPE string;
    DEFINE FIELD IF NOT EXISTS applied_at ON _migrations TYPE datetime DEFAULT time::now();
    DEFINE INDEX IF NOT EXISTS _migrations_name_unique ON _migrations FIELDS name UNIQUE;
  `);

  // Step 2: Load already-applied migration names.
  const appliedResult = await db.query<[MigrationRecord[]]>('SELECT name FROM _migrations;');
  const applied = new Set((appliedResult[0] ?? []).map((m) => m.name));

  // Step 3: Read migration files from disk.
  let files: string[];
  try {
    files = await readdir(MIGRATIONS_DIR);
  } catch (err) {
    console.error(`[migrations] cannot read ${MIGRATIONS_DIR}:`, err);
    throw err;
  }

  const pending = files
    .filter((f) => f.endsWith('.surql'))
    .sort()
    .filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log(`[migrations] up to date (${applied.size} already applied)`);
    return;
  }

  // Step 4: Apply pending migrations in order.
  for (const file of pending) {
    const path = join(MIGRATIONS_DIR, file);
    console.log(`[migrations] applying ${file}...`);
    const sql = await readFile(path, 'utf8');

    try {
      await db.query(sql);
      await db.query('CREATE _migrations CONTENT { name: $name };', { name: file });
      console.log(`[migrations] ✓ ${file}`);
    } catch (err) {
      console.error(`[migrations] ✗ ${file} failed:`, err);
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }

  console.log(`[migrations] applied ${pending.length} migration(s)`);
}
