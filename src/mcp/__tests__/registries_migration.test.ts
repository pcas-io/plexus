/**
 * Integration test for migrations 0008 + 0009: verify attribute_schemas
 * AND required_edge_groups are actually populated against a real
 * SurrealDB instance.
 *
 * Regression target: live plexus.nxio.me after 0008 first shipped
 * returned decision.required_edge_groups = [] despite the migration
 * setting it to [{decision_context, …}]. Root cause was the
 * `VALUE $value OR []` expression mis-collapsing non-empty arrays.
 * 0009 drops the VALUE clause. This test catches a regression of that.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { KindRegistry } from '../registries.js';
import {
  startSurrealMemory,
  surrealAvailable,
  type SurrealHarness,
} from '../../__tests__/helpers/surreal_harness.js';

describe.skipIf(!surrealAvailable())('Registry migrations 0008 + 0009', () => {
  let harness: SurrealHarness;
  let kinds: KindRegistry;

  beforeAll(async () => {
    harness = await startSurrealMemory();
    kinds = new KindRegistry(harness.db);
  }, 60_000);

  afterAll(async () => {
    if (harness) await harness.stop();
  });

  test('decision kind carries its attribute_schema + Pflicht-Edge group', async () => {
    const decision = await kinds.findByName('decision');
    expect(decision).not.toBeNull();
    expect(decision!.attributes_schema.required).toContain('status');
    expect(decision!.attributes_schema.properties).toHaveProperty('severity');
    // This is the regression: required_edge_groups came back empty
    // after 0008 without 0009.
    expect(decision!.required_edge_groups).toHaveLength(1);
    const group = decision!.required_edge_groups[0];
    expect(group.name).toBe('decision_context');
    expect(group.direction).toBe('out');
    expect(group.min).toBe(1);
    expect(group.relations).toEqual(
      expect.arrayContaining(['derived_from', 'triggered_by', 'supersedes', 'part_of'])
    );
  });

  test('fact kind exposes handoff attributes + is_eval flag', async () => {
    const fact = await kinds.findByName('fact');
    expect(fact).not.toBeNull();
    expect(fact!.attributes_schema.properties).toHaveProperty('session_type');
    expect(fact!.attributes_schema.properties).toHaveProperty('is_eval');
    expect(fact!.attributes_schema.properties?.session_type?.enum).toEqual(
      expect.arrayContaining(['handoff', 'incident', 'milestone', 'review', 'eval'])
    );
  });

  test('task kind advertises priority enum', async () => {
    const task = await kinds.findByName('task');
    expect(task).not.toBeNull();
    expect(task!.attributes_schema.properties?.priority?.enum).toEqual(
      expect.arrayContaining(['low', 'medium', 'high', 'urgent'])
    );
  });

  test('list returns all core kinds with normalised required_edge_groups', async () => {
    const all = await kinds.list();
    expect(all.length).toBeGreaterThanOrEqual(13);
    // Every kind must have required_edge_groups as an array (not NONE),
    // otherwise LLM clients doing `.map()` on the field would crash.
    for (const k of all) {
      expect(Array.isArray(k.required_edge_groups)).toBe(true);
      expect(Array.isArray(k.recommended_attributes)).toBe(true);
    }
  });
});
