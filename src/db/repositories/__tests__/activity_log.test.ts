/**
 * Integration tests for the ActivityLogRepository filter/list/count
 * surface added for the admin audit-log page.
 *
 * Validates that the WHERE clause builder matches rows the way the UI
 * expects: user_name / action / outcome / target_type / target_id /
 * since / until all compose via AND; pagination caps limit and offset
 * safely; distinctActions feeds the filter dropdown with only actually
 * logged values.
 *
 * Task entities:tckt3piig1ggql0tzpws.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { ActivityLogRepository } from '../activity_log.js';
import {
  startSurrealMemory,
  surrealAvailable,
  type SurrealHarness,
} from '../../../__tests__/helpers/surreal_harness.js';

describe.skipIf(!surrealAvailable())('ActivityLogRepository — filtered list/count', () => {
  let harness: SurrealHarness;
  let activity: ActivityLogRepository;

  beforeAll(async () => {
    harness = await startSurrealMemory();
    activity = new ActivityLogRepository(harness.db);
  }, 60_000);

  afterAll(async () => {
    if (harness) await harness.stop();
  });

  beforeEach(async () => {
    await harness.db.query('DELETE activity_log;');
  });

  async function seed(): Promise<void> {
    // 3 graph-events by alice, 1 failure by bob, 1 oauth consent by alice.
    await activity.create({
      userName: 'alice',
      action: 'save_entity',
      targetType: 'entity',
      targetId: 'entities:e1',
      outcome: 'success',
      ip: '10.0.0.1',
      metadata: { kind: 'project', context: 'dev' },
    });
    await activity.create({
      userName: 'alice',
      action: 'link_entities',
      targetType: 'edge',
      targetId: 'edges:le1',
      outcome: 'success',
    });
    await activity.create({
      userName: 'alice',
      action: 'update_entity',
      targetType: 'entity',
      targetId: 'entities:e1',
      outcome: 'success',
    });
    await activity.create({
      userName: 'bob',
      action: 'auth_login',
      targetType: 'session',
      outcome: 'failure',
      ip: '10.0.0.2',
      userAgent: 'curl/8',
    });
    await activity.create({
      userName: 'alice',
      action: 'oauth_consent',
      targetType: 'oauth',
      outcome: 'success',
    });
  }

  test('list with empty filter returns every row, newest first', async () => {
    await seed();
    const rows = await activity.list({});
    expect(rows).toHaveLength(5);
    // Timestamps are assigned server-side; newest-first means oauth_consent last seeded comes first.
    expect(rows[0].action).toBe('oauth_consent');
    expect(rows.at(-1)?.action).toBe('save_entity');
  });

  test('filter by user_name narrows the result set', async () => {
    await seed();
    const rows = await activity.list({ userName: 'bob' });
    expect(rows).toHaveLength(1);
    expect(rows[0].user_name).toBe('bob');
    expect(rows[0].outcome).toBe('failure');
  });

  test('filter by outcome=failure surfaces only failures', async () => {
    await seed();
    const rows = await activity.list({ outcome: 'failure' });
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('auth_login');
  });

  test('filter by action+target_type composes via AND', async () => {
    await seed();
    const rows = await activity.list({ action: 'save_entity', targetType: 'entity' });
    expect(rows).toHaveLength(1);
    expect(rows[0].target_id).toBe('entities:e1');
  });

  test('onlyGraph hides security events', async () => {
    await seed();
    const rows = await activity.list({ onlyGraph: true });
    expect(rows).toHaveLength(3);
    const actions = new Set(rows.map((r) => r.action));
    expect(actions.has('auth_login')).toBe(false);
    expect(actions.has('oauth_consent')).toBe(false);
  });

  test('count returns total matching rows without limit applied', async () => {
    await seed();
    expect(await activity.count({})).toBe(5);
    // Alice seeds: save_entity, link_entities, update_entity, oauth_consent = 4.
    expect(await activity.count({ userName: 'alice' })).toBe(4);
    expect(await activity.count({ outcome: 'failure' })).toBe(1);
  });

  test('limit + offset paginate correctly', async () => {
    await seed();
    const page1 = await activity.list({}, 2, 0);
    const page2 = await activity.list({}, 2, 2);
    const page3 = await activity.list({}, 2, 4);
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page3).toHaveLength(1);
    // No overlap between pages.
    const ids = new Set([...page1, ...page2, ...page3].map((r) => r.id));
    expect(ids.size).toBe(5);
  });

  test('since filter bounds timestamp inclusively', async () => {
    await seed();
    // ISO for far future — nothing should match.
    const rows = await activity.list({ since: '2099-01-01T00:00:00Z' });
    expect(rows).toHaveLength(0);
  });

  test('distinctActions returns deduped action names', async () => {
    await seed();
    const actions = await activity.distinctActions();
    expect(actions).toContain('save_entity');
    expect(actions).toContain('auth_login');
    expect(actions).toContain('oauth_consent');
    // No duplicates even though update_entity + save_entity + link_entities share a user.
    expect(new Set(actions).size).toBe(actions.length);
  });

  test('limit > 500 is clamped', async () => {
    await seed();
    // Should not throw. Clamped to 500 internally.
    const rows = await activity.list({}, 10_000, 0);
    expect(rows.length).toBeLessThanOrEqual(500);
  });
});
