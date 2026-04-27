/**
 * Integration tests for the attribute + relation + eval filters added to
 * EntityRepository.list / EntityRepository.search (P2 + P4 from the
 * synthesis concept entities:2o2vqscphb4c2219m9iy).
 *
 * These exercise the real SurrealDB query builder — the WHERE fragment
 * construction around `attributes.<field>`, the edges subquery for
 * has_relation, and the `is_eval` exclusion are all DB-side SurrealQL
 * that unit tests cannot cover.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { EntityRepository } from '../entities.js';
import { EdgeRepository } from '../edges.js';
import {
  startSurrealMemory,
  surrealAvailable,
  type SurrealHarness,
} from '../../../__tests__/helpers/surreal_harness.js';

describe.skipIf(!surrealAvailable())('EntityRepository filters (P2 + P4)', () => {
  let harness: SurrealHarness;
  let entities: EntityRepository;
  let edges: EdgeRepository;
  const USER_ID = 'users:test_user_filters';

  beforeAll(async () => {
    harness = await startSurrealMemory();
    entities = new EntityRepository(harness.db);
    edges = new EdgeRepository(harness.db);
    // Create the user record referenced as created_by — the schema wants
    // a real record<users>. Only name + token_hash are NOT NULL.
    await harness.db.query(
      `CREATE users:test_user_filters CONTENT { name: "test_user_filters", token_hash: "${'0'.repeat(64)}" };`
    );
  }, 60_000);

  afterAll(async () => {
    if (harness) await harness.stop();
  });

  beforeEach(async () => {
    await harness.db.query('DELETE entities; DELETE edges;');
  });

  test('attributes filter: single field exact match', async () => {
    await entities.save(
      { kind: 'task', title: 'High task', context: 'dev', attributes: { priority: 'high' } },
      USER_ID
    );
    await entities.save(
      { kind: 'task', title: 'Low task', context: 'dev', attributes: { priority: 'low' } },
      USER_ID
    );

    const highs = await entities.list({ attributes: { priority: 'high' } });
    expect(highs).toHaveLength(1);
    expect(highs[0].title).toBe('High task');
  });

  test('attributes filter: multiple fields AND together', async () => {
    await entities.save(
      { kind: 'task', title: 'High milestone', context: 'dev', attributes: { priority: 'high', is_milestone: true } },
      USER_ID
    );
    await entities.save(
      { kind: 'task', title: 'High non-milestone', context: 'dev', attributes: { priority: 'high', is_milestone: false } },
      USER_ID
    );
    await entities.save(
      { kind: 'task', title: 'Low milestone', context: 'dev', attributes: { priority: 'low', is_milestone: true } },
      USER_ID
    );

    const highMilestones = await entities.list({
      attributes: { priority: 'high', is_milestone: true },
    });
    expect(highMilestones).toHaveLength(1);
    expect(highMilestones[0].title).toBe('High milestone');
  });

  test('attributes filter: silently skips invalid field names', async () => {
    await entities.save(
      { kind: 'task', title: 'T1', context: 'dev', attributes: { priority: 'high' } },
      USER_ID
    );
    // Field name with injection attempt must not reach the query.
    const all = await entities.list({ attributes: { 'priority OR 1=1': 'x' } as never });
    expect(all).toHaveLength(1);
  });

  test('exclude_eval removes is_eval=true entries', async () => {
    await entities.save(
      { kind: 'fact', title: 'Normal', context: 'dev', attributes: {} },
      USER_ID
    );
    await entities.save(
      { kind: 'fact', title: 'Eval snapshot', context: 'dev', attributes: { is_eval: true } },
      USER_ID
    );

    const withoutEvals = await entities.list({ exclude_eval: true });
    expect(withoutEvals).toHaveLength(1);
    expect(withoutEvals[0].title).toBe('Normal');

    const all = await entities.list({ exclude_eval: false });
    expect(all).toHaveLength(2);
  });

  test('has_relation: out direction matches source of an edge', async () => {
    const project = await entities.save(
      { kind: 'project', title: 'Project A', context: 'dev' },
      USER_ID
    );
    const task1 = await entities.save(
      { kind: 'task', title: 'In project A', context: 'dev' },
      USER_ID
    );
    await entities.save(
      { kind: 'task', title: 'Free-floating', context: 'dev' },
      USER_ID
    );
    await edges.link(
      { fromId: task1.id, toId: project.id, relation: 'part_of' },
      USER_ID
    );

    const partOfProjectA = await entities.list({
      has_relation: {
        relation: 'part_of',
        target_id: project.id,
        direction: 'out',
      },
    });
    expect(partOfProjectA).toHaveLength(1);
    expect(partOfProjectA[0].title).toBe('In project A');
  });

  test('has_relation: in direction matches target of an edge', async () => {
    const project = await entities.save(
      { kind: 'project', title: 'Project B', context: 'dev' },
      USER_ID
    );
    const task = await entities.save(
      { kind: 'task', title: 'Part of B', context: 'dev' },
      USER_ID
    );
    await edges.link(
      { fromId: task.id, toId: project.id, relation: 'part_of' },
      USER_ID
    );

    const containedBy = await entities.list({
      has_relation: {
        relation: 'part_of',
        target_id: task.id,
        direction: 'in',
      },
    });
    expect(containedBy).toHaveLength(1);
    expect(containedBy[0].id).toBe(project.id);
  });

  test('has_relation: omitting target_id matches any target', async () => {
    const p1 = await entities.save({ kind: 'project', title: 'P1', context: 'dev' }, USER_ID);
    const p2 = await entities.save({ kind: 'project', title: 'P2', context: 'dev' }, USER_ID);
    const t1 = await entities.save({ kind: 'task', title: 'T1', context: 'dev' }, USER_ID);
    const t2 = await entities.save({ kind: 'task', title: 'T2', context: 'dev' }, USER_ID);
    const t3 = await entities.save({ kind: 'task', title: 'T3 unlinked', context: 'dev' }, USER_ID);
    await edges.link({ fromId: t1.id, toId: p1.id, relation: 'part_of' }, USER_ID);
    await edges.link({ fromId: t2.id, toId: p2.id, relation: 'part_of' }, USER_ID);

    const anyPartOf = await entities.list({
      kind: 'task',
      has_relation: { relation: 'part_of', direction: 'out' },
    });
    expect(anyPartOf.map((e) => e.title).sort()).toEqual(['T1', 'T2']);
    expect(anyPartOf.map((e) => e.id)).not.toContain(t3.id);
  });

  test('search respects attributes + exclude_eval filters', async () => {
    await entities.save(
      { kind: 'fact', title: 'Alpha regular', body: 'searchtoken1', context: 'dev', attributes: {} },
      USER_ID
    );
    await entities.save(
      { kind: 'fact', title: 'Alpha eval', body: 'searchtoken1', context: 'dev', attributes: { is_eval: true } },
      USER_ID
    );

    const hits = await entities.search('searchtoken1', { exclude_eval: true });
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe('Alpha regular');
  });
});
