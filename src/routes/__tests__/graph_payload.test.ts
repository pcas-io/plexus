/**
 * Tests for the pure graph-payload builder.
 */

import { describe, test, expect } from 'vitest';
import type { Entity } from '../../db/repositories/entities.js';
import type { Edge } from '../../db/repositories/edges.js';
import { buildGraphPayload } from '../graph_payload.js';

function entity(id: string, extras: Partial<Entity> = {}): Entity {
  return {
    id,
    kind: 'concept',
    title: `Entity ${id}`,
    body: null,
    attributes: {},
    context: 'dev',
    status: 'active',
    version: 1,
    created_at: '2026-04-11T00:00:00.000Z',
    updated_at: '2026-04-11T00:00:00.000Z',
    created_by: null,
    updated_by: null,
    ...extras,
  };
}

function edge(id: string, from: string, to: string, relation = 'relates_to'): Edge {
  return {
    id,
    from_entity: from,
    to_entity: to,
    relation,
    properties: {},
    confidence: 1,
    source: 'manual',
    valid_from: '2026-04-11T00:00:00.000Z',
    valid_to: null,
    created_at: '2026-04-11T00:00:00.000Z',
    created_by: null,
  };
}

describe('buildGraphPayload — basics', () => {
  test('returns empty payload for empty input', () => {
    const out = buildGraphPayload([], []);
    expect(out.nodes).toEqual([]);
    expect(out.edges).toEqual([]);
    expect(out.meta.total_entities).toBe(0);
    expect(out.meta.total_edges).toBe(0);
    expect(out.meta.orphan_count).toBe(0);
    expect(out.meta.dropped_edges).toBe(0);
  });

  test('maps entities to node objects with kind, title, context', () => {
    const out = buildGraphPayload(
      [entity('entities:a', { title: 'Alpha', kind: 'project', context: 'dev' })],
      [],
    );
    expect(out.nodes).toHaveLength(1);
    expect(out.nodes[0]).toMatchObject({
      id: 'entities:a',
      title: 'Alpha',
      kind: 'project',
      context: 'dev',
    });
  });

  test('preserves context from meta param', () => {
    const out = buildGraphPayload([], [], 'ifp-labs');
    expect(out.meta.context).toBe('ifp-labs');
  });

  test('null context becomes null in meta (all contexts)', () => {
    const out = buildGraphPayload([], []);
    expect(out.meta.context).toBeNull();
  });
});

describe('buildGraphPayload — edge filtering', () => {
  test('keeps edges whose both endpoints are in the node set', () => {
    const out = buildGraphPayload(
      [entity('entities:a'), entity('entities:b')],
      [edge('edges:1', 'entities:a', 'entities:b')],
    );
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]).toMatchObject({
      id: 'edges:1',
      source: 'entities:a',
      target: 'entities:b',
      relation: 'relates_to',
    });
    expect(out.meta.dropped_edges).toBe(0);
  });

  test('drops edges where the source is not in the node set', () => {
    const out = buildGraphPayload(
      [entity('entities:a')],
      [edge('edges:1', 'entities:ghost', 'entities:a')],
    );
    expect(out.edges).toHaveLength(0);
    expect(out.meta.dropped_edges).toBe(1);
  });

  test('drops edges where the target is not in the node set', () => {
    const out = buildGraphPayload(
      [entity('entities:a')],
      [edge('edges:1', 'entities:a', 'entities:ghost')],
    );
    expect(out.edges).toHaveLength(0);
    expect(out.meta.dropped_edges).toBe(1);
  });

  test('counts dropped edges separately from kept edges', () => {
    const out = buildGraphPayload(
      [entity('entities:a'), entity('entities:b')],
      [
        edge('edges:1', 'entities:a', 'entities:b'),         // kept
        edge('edges:2', 'entities:a', 'entities:ghost'),     // dropped
        edge('edges:3', 'entities:ghost', 'entities:b'),     // dropped
      ],
    );
    expect(out.edges).toHaveLength(1);
    expect(out.meta.total_edges).toBe(1);
    expect(out.meta.dropped_edges).toBe(2);
  });
});

describe('buildGraphPayload — edge counts and orphans', () => {
  test('assigns edge_count per node (undirected)', () => {
    const out = buildGraphPayload(
      [entity('entities:a'), entity('entities:b'), entity('entities:c')],
      [
        edge('edges:1', 'entities:a', 'entities:b'),
        edge('edges:2', 'entities:a', 'entities:c'),
      ],
    );
    const byId = Object.fromEntries(out.nodes.map((n) => [n.id, n]));
    expect(byId['entities:a']?.edge_count).toBe(2);
    expect(byId['entities:b']?.edge_count).toBe(1);
    expect(byId['entities:c']?.edge_count).toBe(1);
  });

  test('marks entities without edges as orphans', () => {
    const out = buildGraphPayload(
      [entity('entities:a'), entity('entities:b')],
      [edge('edges:1', 'entities:a', 'entities:b')],
    );
    const byId = Object.fromEntries(out.nodes.map((n) => [n.id, n]));
    expect(byId['entities:a']?.is_orphan).toBe(false);
    expect(byId['entities:b']?.is_orphan).toBe(false);
    expect(out.meta.orphan_count).toBe(0);
  });

  test('truly orphan node has is_orphan=true and edge_count=0', () => {
    const out = buildGraphPayload(
      [entity('entities:a'), entity('entities:lonely')],
      [edge('edges:1', 'entities:a', 'entities:a')],
    );
    const lonely = out.nodes.find((n) => n.id === 'entities:lonely');
    expect(lonely?.is_orphan).toBe(true);
    expect(lonely?.edge_count).toBe(0);
  });

  test('orphan_count in meta matches nodes flagged as is_orphan', () => {
    const out = buildGraphPayload(
      [entity('entities:a'), entity('entities:b'), entity('entities:c'), entity('entities:d')],
      [edge('edges:1', 'entities:a', 'entities:b')],
    );
    expect(out.meta.orphan_count).toBe(2); // c and d
    expect(out.nodes.filter((n) => n.is_orphan)).toHaveLength(2);
  });

  test('dropped edges do NOT contribute to edge_count', () => {
    // An entity whose only edge goes to a not-in-set target should
    // still appear as orphan in the graph view, even though the DB
    // says the edge exists.
    const out = buildGraphPayload(
      [entity('entities:a')],
      [edge('edges:1', 'entities:a', 'entities:ghost')],
    );
    expect(out.nodes[0]?.edge_count).toBe(0);
    expect(out.nodes[0]?.is_orphan).toBe(true);
    expect(out.meta.dropped_edges).toBe(1);
  });
});

describe('buildGraphPayload — self-loops and parallel edges', () => {
  test('self-loop counts as 2 on the same node (undirected degree)', () => {
    const out = buildGraphPayload(
      [entity('entities:a')],
      [edge('edges:1', 'entities:a', 'entities:a')],
    );
    expect(out.nodes[0]?.edge_count).toBe(2);
    expect(out.nodes[0]?.is_orphan).toBe(false);
  });

  test('parallel edges between the same pair of nodes both count', () => {
    const out = buildGraphPayload(
      [entity('entities:a'), entity('entities:b')],
      [
        edge('edges:1', 'entities:a', 'entities:b', 'depends_on'),
        edge('edges:2', 'entities:a', 'entities:b', 'documents'),
      ],
    );
    expect(out.edges).toHaveLength(2);
    const byId = Object.fromEntries(out.nodes.map((n) => [n.id, n]));
    expect(byId['entities:a']?.edge_count).toBe(2);
    expect(byId['entities:b']?.edge_count).toBe(2);
  });
});
