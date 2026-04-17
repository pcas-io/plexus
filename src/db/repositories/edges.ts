/**
 * Edge Repository — relationships between entities, temporal-first.
 *
 * Per the Kickoff ADR (buddy node 01KNF08JS7VKWPRYF1N8Q8ESMB Abschnitt 2):
 * "Beziehungen haben valid_from/valid_to. Aenderungen heissen nicht 'update',
 * sondern 'alte Edge bekommt valid_to, neue Edge entsteht'. Point-in-Time-
 * Queries via as_of-Parameter. Historie lebt im Graph, nicht im Activity Log."
 *
 * Every edge has:
 *   id, from_entity, to_entity, relation, properties (JSON), confidence,
 *   source, valid_from, valid_to (NULL = currently active), created_at/by
 *
 * An "active" edge is one whose valid_to is unset — checked via the
 * shared `IS_UNSET('valid_to')` helper from `../util/query.js`. To "delete"
 * an edge we set its valid_to to time::now() — the record stays in the
 * graph as history.
 */

import type { Surreal } from 'surrealdb';
import { normalizeThingId, rawIdPart } from '../util/record_id.js';
import { cleanObject } from '../util/clean.js';
import { IS_UNSET } from '../util/query.js';

export interface Edge {
  readonly id: string;
  readonly from_entity: string;
  readonly to_entity: string;
  readonly relation: string;
  readonly properties: Record<string, unknown>;
  readonly confidence: number;
  readonly source: string;
  readonly valid_from: string;
  readonly valid_to: string | null;
  readonly created_at: string;
  readonly created_by: string | null;
}

export interface NewEdge {
  readonly fromId: string;
  readonly toId: string;
  readonly relation: string;
  readonly properties?: Record<string, unknown>;
  readonly confidence?: number;
  readonly source?: string;
}

export interface RelatedFilter {
  readonly relation?: string;
  /** "in" = edges pointing TO this entity, "out" = edges FROM it, "both" */
  readonly direction?: 'in' | 'out' | 'both';
  /** ISO timestamp for point-in-time queries. Default: now. */
  readonly asOf?: string;
  readonly limit?: number;
}

function normalizeEdge(raw: unknown): Edge {
  const r = raw as Record<string, unknown>;
  return {
    id: normalizeThingId(r.id),
    from_entity: normalizeThingId(r.from_entity),
    to_entity: normalizeThingId(r.to_entity),
    relation: String(r.relation),
    properties: (r.properties as Record<string, unknown>) ?? {},
    confidence: Number(r.confidence ?? 1.0),
    source: String(r.source ?? 'manual'),
    valid_from: String(r.valid_from),
    valid_to: r.valid_to == null ? null : String(r.valid_to),
    created_at: String(r.created_at),
    created_by: r.created_by == null ? null : normalizeThingId(r.created_by),
  };
}

const RETURN_COLS =
  'id, from_entity, to_entity, relation, properties, confidence, source, valid_from, valid_to, created_at, created_by';

export class EdgeRepository {
  constructor(private readonly db: Surreal) {}

  async link(input: NewEdge, createdByUserId: string): Promise<Edge> {
    const result = await this.db.query<[unknown[]]>(
      `CREATE edges CONTENT {
         from_entity: type::thing('entities', $from_raw),
         to_entity: type::thing('entities', $to_raw),
         relation: $relation,
         properties: $properties,
         confidence: $confidence,
         source: $source,
         created_by: type::thing('users', $uid_raw)
       } RETURN ${RETURN_COLS};`,
      {
        from_raw: rawIdPart(input.fromId, 'entities'),
        to_raw: rawIdPart(input.toId, 'entities'),
        relation: input.relation,
        properties: cleanObject(input.properties),
        confidence: input.confidence ?? 1.0,
        source: input.source ?? 'manual',
        uid_raw: rawIdPart(createdByUserId, 'users'),
      }
    );
    const row = result[0]?.[0];
    if (!row) throw new Error('Failed to create edge');
    return normalizeEdge(row);
  }

  /**
   * Invalidate an edge by setting valid_to = now(). The row stays in the
   * graph so point-in-time queries in the past still see it.
   */
  async unlink(edgeId: string): Promise<Edge | null> {
    const result = await this.db.query<[unknown[]]>(
      `UPDATE edges SET valid_to = time::now() WHERE id = type::thing("edges", $raw) AND ${IS_UNSET('valid_to')} RETURN ${RETURN_COLS};`,
      { raw: rawIdPart(edgeId, 'edges') }
    );
    const row = result[0]?.[0];
    return row ? normalizeEdge(row) : null;
  }

  async get(edgeId: string): Promise<Edge | null> {
    const result = await this.db.query<[unknown[]]>(
      `SELECT ${RETURN_COLS} FROM edges WHERE id = type::thing("edges", $raw) LIMIT 1;`,
      { raw: rawIdPart(edgeId, 'edges') }
    );
    const row = result[0]?.[0];
    return row ? normalizeEdge(row) : null;
  }

  /**
   * Fetch all currently-active edges in a single query. Intended for the
   * /api/graph visualisation route which needs every live edge at once.
   * The previous graph route ran `getRelated` once per entity (N+1) which
   * both stressed the DB and made it impossible to tell whether a node was
   * an orphan by design or just had edges that pointed to entities outside
   * the sampled window. Use with care on graphs larger than a few thousand
   * edges — pair with client-side filtering.
   *
   * Hard-cap of 5000 edges so a runaway graph can't produce a huge JSON
   * response. Ordered by `valid_from DESC` so the most recent edges are
   * always present even when the cap bites.
   */
  async listAllActive(limit = 5000): Promise<Edge[]> {
    const cap = Math.min(Math.max(limit, 1), 10_000);
    // Direct interpolation is safe: cap is clamped to an integer above.
    const result = await this.db.query<[unknown[]]>(
      `SELECT ${RETURN_COLS} FROM edges WHERE ${IS_UNSET('valid_to')} ORDER BY valid_from DESC LIMIT ${cap};`,
    );
    return (result[0] ?? []).map(normalizeEdge);
  }

  /**
   * Returns edges related to the given entity. direction=out means edges
   * where from_entity = id; direction=in means to_entity = id; both merges.
   * If asOf is provided, returns only edges that were active at that time.
   */
  async getRelated(entityId: string, filter: RelatedFilter = {}): Promise<Edge[]> {
    const entityRaw = rawIdPart(entityId, 'entities');
    const direction = filter.direction ?? 'both';
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);

    const where: string[] = [];
    const params: Record<string, unknown> = { raw: entityRaw };

    if (direction === 'out') {
      where.push(`from_entity = type::thing("entities", $raw)`);
    } else if (direction === 'in') {
      where.push(`to_entity = type::thing("entities", $raw)`);
    } else {
      where.push(`(from_entity = type::thing("entities", $raw) OR to_entity = type::thing("entities", $raw))`);
    }

    if (filter.relation) {
      where.push('relation = $relation');
      params.relation = filter.relation;
    }

    // Temporal filter. Default is "currently active" (valid_to unset).
    if (filter.asOf) {
      where.push(`valid_from <= $as_of AND (${IS_UNSET('valid_to')} OR valid_to > $as_of)`);
      params.as_of = filter.asOf;
    } else {
      where.push(IS_UNSET('valid_to'));
    }

    const result = await this.db.query<[unknown[]]>(
      `SELECT ${RETURN_COLS} FROM edges WHERE ${where.join(' AND ')} ORDER BY valid_from DESC LIMIT ${limit};`,
      params
    );
    return (result[0] ?? []).map(normalizeEdge);
  }

  /**
   * Counts active edges for a given entity. Used for the dashboard badge.
   */
  async countActiveForEntity(entityId: string): Promise<number> {
    const result = await this.db.query<[Array<{ count: number }>]>(
      `SELECT count() AS count FROM edges
       WHERE (from_entity = type::thing("entities", $raw) OR to_entity = type::thing("entities", $raw))
         AND ${IS_UNSET('valid_to')}
       GROUP ALL;`,
      { raw: rawIdPart(entityId, 'entities') }
    );
    return result[0]?.[0]?.count ?? 0;
  }
}
