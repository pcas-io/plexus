/**
 * Required-edge-group validation for save_entity.
 *
 * Some kinds (currently: decision) demand that the newly created entity
 * has at least one edge from a configured relation group. The canonical
 * example is the CLAUDE.md ADR-Pflicht-Edge: every new decision must link
 * to one of [derived_from, triggered_by, supersedes, part_of].
 *
 * save_entity surfaces this via a `related` parameter (array of
 * {relation, to_id}). The MCP layer collects the relations the caller
 * intends to create, feeds them here, and this function decides whether
 * the write can proceed.
 *
 * Grandfathering: this check runs only on CREATE (save_entity), never on
 * update/archive. Pre-existing entities without the required edges remain
 * valid. The registry field `required_edge_groups` is therefore safe to
 * extend without a data backfill.
 */

import type { RequiredEdgeGroup } from '../../mcp/registries.js';

export class RequiredEdgeValidationError extends Error {
  readonly code = 'required_edge_missing';
  constructor(readonly group: string, message: string) {
    super(`required_edge_missing: ${message}`);
    this.name = 'RequiredEdgeValidationError';
  }
}

export interface PlannedEdge {
  readonly relation: string;
  readonly direction: 'out' | 'in';
}

export function validateRequiredEdges(
  kind: string,
  groups: readonly RequiredEdgeGroup[],
  planned: readonly PlannedEdge[]
): void {
  for (const group of groups) {
    const matching = planned.filter(
      (e) => e.direction === group.direction && group.relations.includes(e.relation)
    );
    if (matching.length < group.min) {
      throw new RequiredEdgeValidationError(
        group.name,
        `kind=${kind} requires at least ${group.min} ${group.direction}-edge(s) from relations [${group.relations.join(', ')}] (group "${group.name}"). Pass via save_entity's part_of or related parameter, or call link_entities in the same atomic operation.`
      );
    }
  }
}
