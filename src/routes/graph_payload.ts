/**
 * Pure builder for the /api/graph response payload.
 *
 * Extracted from the route handler so we can unit-test the logic —
 * the route itself is thin glue around this function plus two DB calls.
 *
 * Contract:
 *   - Input: a list of entities and a list of active edges
 *   - Output: `{ nodes, edges, meta }` where nodes carry an edge_count
 *     and is_orphan flag so the D3 layer can style them differently
 *   - Edges are filtered to those whose BOTH endpoints are in the
 *     input entity list — cross-boundary edges are dropped cleanly
 *     instead of producing dangling references in the D3 simulation
 *   - Each directed edge appears exactly once in the output
 *
 * No DB access, no side effects — everything happens in memory.
 */

import type { Entity } from '../db/repositories/entities.js';
import type { Edge } from '../db/repositories/edges.js';

export interface GraphNode {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  readonly context: string;
  readonly edge_count: number;
  readonly is_orphan: boolean;
}

export interface GraphEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly relation: string;
}

export interface GraphMeta {
  readonly total_entities: number;
  readonly total_edges: number;
  readonly orphan_count: number;
  readonly context: string | null;
  readonly dropped_edges: number;
}

export interface GraphPayload {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly meta: GraphMeta;
}

export function buildGraphPayload(
  entities: readonly Entity[],
  activeEdges: readonly Edge[],
  context: string | null = null,
): GraphPayload {
  const idSet = new Set(entities.map((e) => e.id));

  // Keep only edges whose both endpoints are in the visible entity set.
  // Dropped edges are counted in meta so the UI can warn the user that
  // the graph is a partial slice.
  let droppedEdges = 0;
  const filteredEdges: GraphEdge[] = [];
  for (const edge of activeEdges) {
    if (idSet.has(edge.from_entity) && idSet.has(edge.to_entity)) {
      filteredEdges.push({
        id: edge.id,
        source: edge.from_entity,
        target: edge.to_entity,
        relation: edge.relation,
      });
    } else {
      droppedEdges += 1;
    }
  }

  // Count edges touching each node (undirected: a node connected by
  // one edge counts as 1 regardless of direction).
  const edgeCountByNode = new Map<string, number>();
  for (const edge of filteredEdges) {
    edgeCountByNode.set(edge.source, (edgeCountByNode.get(edge.source) ?? 0) + 1);
    edgeCountByNode.set(edge.target, (edgeCountByNode.get(edge.target) ?? 0) + 1);
  }

  const nodes: GraphNode[] = entities.map((e) => {
    const count = edgeCountByNode.get(e.id) ?? 0;
    return {
      id: e.id,
      title: e.title,
      kind: e.kind,
      context: e.context,
      edge_count: count,
      is_orphan: count === 0,
    };
  });

  const orphanCount = nodes.filter((n) => n.is_orphan).length;

  return {
    nodes,
    edges: filteredEdges,
    meta: {
      total_entities: nodes.length,
      total_edges: filteredEdges.length,
      orphan_count: orphanCount,
      context,
      dropped_edges: droppedEdges,
    },
  };
}
