/**
 * Skill Forge → plexus publish contract (integration).
 *
 * Purpose (Pre-Mortem Risk R3, plexus entity snpxgkukysdc2erfwrcl):
 *   Forge publishes skills as proposed → approval → active. Plexus
 *   filters list_skills on status='active'. This test pins that
 *   contract so a drift on either side breaks the build rather than
 *   the first real publish.
 *
 * Uses a throwaway in-memory SurrealDB via docker when running locally
 * or a CI-provided server via PLEXUS_TEST_SURREAL_URL. Skips cleanly
 * when neither is available.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { EntityRepository } from '../../db/repositories/entities.js';
import { SkillRepository } from '../../db/repositories/skills.js';
import {
  startSurrealMemory,
  surrealAvailable,
  type SurrealHarness,
} from '../../__tests__/helpers/surreal_harness.js';

const CONTEXT = 'dev';

describe.skipIf(!surrealAvailable())('Skill Forge → plexus publish contract', () => {
  let harness: SurrealHarness;
  let entities: EntityRepository;
  let skills: SkillRepository;
  let userId: string;

  beforeAll(async () => {
    harness = await startSurrealMemory();
    entities = new EntityRepository(harness.db);
    skills = new SkillRepository(entities);

    const tokenHash = createHash('sha256').update(randomBytes(32)).digest('hex');
    const createRes = await harness.db.query<[unknown[]]>(
      `CREATE users CONTENT { name: 'forge-test', token_hash: $hash, is_active: true, is_admin: false } RETURN id;`,
      { hash: tokenHash }
    );
    const row = createRes[0]?.[0] as { id: { tb: string; id: string } | string } | undefined;
    if (!row) throw new Error('failed to seed test user');
    userId = typeof row.id === 'string' ? row.id : `users:${(row.id as { id: string }).id}`;
  }, 60_000);

  afterAll(async () => {
    if (harness) await harness.stop();
  });

  test('active skill is visible via skills.list', async () => {
    const saved = await entities.save(
      {
        kind: 'skill',
        title: 'test-active',
        body: '# test-active\n\nactive body',
        attributes: {
          name: 'test-active',
          description: 'visible from the start',
          version: 'v1.0.0',
          category: 'testing',
          trigger_phrases: ['Test Active'],
          gatekeeper_status: 'approved',
        },
        context: CONTEXT,
        status: 'active',
      },
      userId
    );

    const list = await skills.list({ context: CONTEXT });
    const found = list.find((s) => s.id === saved.id);
    expect(found).toBeDefined();
    expect(found?.status).toBe('active');
    expect(found?.attributes.name).toBe('test-active');
  });

  test('proposed skill (status=proposed) is hidden from skills.list', async () => {
    const saved = await entities.save(
      {
        kind: 'skill',
        title: 'test-proposed',
        body: '# test-proposed',
        attributes: {
          name: 'test-proposed',
          description: 'fresh forge publish, awaiting approval',
          version: 'v0.1.0',
          category: 'testing',
          trigger_phrases: ['Test Proposed'],
          gatekeeper_status: 'pending',
        },
        context: CONTEXT,
        status: 'proposed',
      },
      userId
    );

    expect(saved.status).toBe('proposed');
    const list = await skills.list({ context: CONTEXT });
    expect(list.find((s) => s.id === saved.id)).toBeUndefined();
  });

  test('approval flow: flipping status from proposed to active surfaces the skill', async () => {
    const saved = await entities.save(
      {
        kind: 'skill',
        title: 'test-approval',
        body: '# test-approval',
        attributes: {
          name: 'test-approval',
          description: 'approval smoke-test',
          version: 'v1.0.0',
          trigger_phrases: ['Approve Me'],
          gatekeeper_status: 'pending',
        },
        context: CONTEXT,
        status: 'proposed',
      },
      userId
    );

    const before = await skills.list({ context: CONTEXT });
    expect(before.find((s) => s.id === saved.id)).toBeUndefined();

    const approved = await entities.update(
      saved.id,
      saved.version,
      {
        status: 'active',
        attributes: { ...saved.attributes, gatekeeper_status: 'approved' },
      },
      userId
    );
    expect(approved.status).toBe('active');

    const after = await skills.list({ context: CONTEXT });
    const found = after.find((s) => s.id === saved.id);
    expect(found).toBeDefined();
    expect(found?.attributes.gatekeeper_status).toBe('approved');
  });

  test('archived skill is hidden again', async () => {
    const saved = await entities.save(
      {
        kind: 'skill',
        title: 'test-archivable',
        body: '# test-archivable',
        attributes: {
          name: 'test-archivable',
          description: 'will be archived',
          version: 'v1.0.0',
          trigger_phrases: ['Archive Me'],
          gatekeeper_status: 'approved',
        },
        context: CONTEXT,
        status: 'active',
      },
      userId
    );
    expect((await skills.list({ context: CONTEXT })).find((s) => s.id === saved.id)).toBeDefined();

    await entities.archive(saved.id, userId);
    expect((await skills.list({ context: CONTEXT })).find((s) => s.id === saved.id)).toBeUndefined();
  });

  test('skill payload round-trip preserves all attributes including nested objects', async () => {
    const payload = {
      name: 'round-trip',
      description: 'round-trip with ümläuts + emojis',
      version: 'v2.3.4',
      category: 'analysis',
      trigger_phrases: ['Round Trip', 'Roundtrip'],
      gatekeeper_status: 'approved',
      forge_metadata: {
        authored_by: 'forge',
        forge_run_id: 42,
        tags: ['alpha', 'beta'],
      },
    };
    const saved = await entities.save(
      {
        kind: 'skill',
        title: 'round-trip',
        body: 'round trip body',
        attributes: payload,
        context: CONTEXT,
        status: 'active',
      },
      userId
    );

    const fetched = await entities.get(saved.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.attributes).toEqual(payload);
  });

  test('drifted payload without trigger_phrases does not crash skills.list', async () => {
    await entities.save(
      {
        kind: 'skill',
        title: 'drifted-no-triggers',
        body: 'body',
        attributes: {
          name: 'drifted-no-triggers',
          description: 'forge forgot trigger_phrases — plexus must not crash',
          version: 'v1.0.0',
        },
        context: CONTEXT,
        status: 'active',
      },
      userId
    );

    const list = await skills.list({ context: CONTEXT });
    const found = list.find((s) => s.title === 'drifted-no-triggers');
    expect(found).toBeDefined();
    expect((found?.attributes as Record<string, unknown>).trigger_phrases).toBeUndefined();
  });

  test('gatekeeper contract assertion: only status=active reaches skills.list', async () => {
    const statuses = ['proposed', 'pending_review', 'rejected', 'draft'];
    const ids: string[] = [];
    for (const status of statuses) {
      const saved = await entities.save(
        {
          kind: 'skill',
          title: `contract-hide-${status}`,
          body: 'body',
          attributes: {
            name: `contract-hide-${status}`,
            description: `status=${status}`,
            version: 'v1.0.0',
            trigger_phrases: [`Contract ${status}`],
          },
          context: CONTEXT,
          status,
        },
        userId
      );
      ids.push(saved.id);
    }

    const list = await skills.list({ context: CONTEXT });
    for (const id of ids) {
      expect(list.find((s) => s.id === id)).toBeUndefined();
    }
  });
});
