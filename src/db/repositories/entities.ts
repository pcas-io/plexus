/**
 * Entity Repository — the core unified graph table.
 *
 * Plexus models every graph node (decision, concept, project, task, document,
 * fact, …) as a single "entity" row with a `kind` discriminator. This is the
 * voll-unified approach from the Plexus v5 Kickoff ADR (buddy node
 * 01KNF08JS7VKWPRYF1N8Q8ESMB, Abschnitt 2).
 *
 * Core fields:
 *   id, kind, title, body, attributes (JSON), context, status, version,
 *   embedding (vector), fts, created_at/by, updated_at/by
 *
 * Optimistic locking: every `update` takes an `expected_version`. If the
 * current row version does not match, the update throws a VersionConflict
 * error. This is the primary defense against last-write-wins.
 *
 * SurrealQL is isolated here (and in the other repositories) — the rest of
 * plexus treats this as a plain TypeScript interface. Lock-in mitigation per
 * the risk inventory (buddy node 01KNEYF2BRCJ147SXPG71YK5YG).
 */

import type { Surreal } from 'surrealdb';
import { normalizeThingId, rawIdPart } from '../util/record_id.js';
import { cleanObject } from '../util/clean.js';
import { IS_UNSET } from '../util/query.js';

export interface Entity {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string | null;
  readonly attributes: Record<string, unknown>;
  readonly context: string;
  readonly status: string;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly created_by: string | null;
  readonly updated_by: string | null;
}

export interface NewEntity {
  readonly kind: string;
  readonly title: string;
  readonly body?: string;
  readonly attributes?: Record<string, unknown>;
  readonly context: string;
  readonly status?: string;
}

export interface EntityPatch {
  readonly title?: string;
  readonly body?: string | null;
  readonly attributes?: Record<string, unknown>;
  readonly status?: string;
}

export interface EntityFilter {
  readonly kind?: string;
  /** Kinds to hide from the result set. Useful for the dashboard
   *  "hide tasks by default" behaviour — pass `['task']` to keep tasks
   *  out of a general browse view while still allowing the user to opt
   *  in by setting `kind: 'task'` explicitly. Ignored when `kind` is
   *  set (single-kind filter takes precedence). */
  readonly excludeKinds?: readonly string[];
  readonly context?: string;
  readonly status?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export class VersionConflictError extends Error {
  readonly code = 'version_conflict';
  constructor(
    readonly entityId: string,
    readonly currentVersion: number,
    readonly yourVersion: number
  ) {
    super(
      `version_conflict: entity ${entityId} is at version ${currentVersion}, you sent ${yourVersion}`
    );
    this.name = 'VersionConflictError';
  }
}

function normalizeEntity(raw: unknown): Entity {
  const r = raw as Record<string, unknown>;
  return {
    id: normalizeThingId(r.id),
    kind: String(r.kind),
    title: String(r.title),
    body: r.body == null ? null : String(r.body),
    attributes: (r.attributes as Record<string, unknown>) ?? {},
    context: String(r.context),
    status: String(r.status ?? 'active'),
    version: Number(r.version ?? 1),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
    created_by: r.created_by == null ? null : normalizeThingId(r.created_by),
    updated_by: r.updated_by == null ? null : normalizeThingId(r.updated_by),
  };
}

const RETURN_COLS =
  'id, kind, title, body, attributes, context, status, version, created_at, updated_at, created_by, updated_by';

export class EntityRepository {
  constructor(private readonly db: Surreal) {}

  async save(input: NewEntity, createdByUserId: string): Promise<Entity> {
    // SurrealDB v2: passing nested objects inside `CONTENT { field: $param }`
    // can silently lose nested properties during CBOR encoding. It also
    // rejects explicit null on option<> fields — so we build the CONTENT
    // object dynamically and only include body when it is present.
    const uidRaw = rawIdPart(createdByUserId, 'users');
    const fields: string[] = [
      'kind: $kind',
      'title: $title',
      'attributes: $attributes',
      'context: $context',
      'status: $status',
      'version: 1',
      'created_by: $user',
      'updated_by: $user',
    ];
    const params: Record<string, unknown> = {
      kind: input.kind,
      title: input.title,
      attributes: cleanObject(input.attributes),
      context: input.context,
      status: input.status ?? 'active',
      uid_raw: uidRaw,
    };
    if (input.body != null) {
      fields.push('body: $body');
      params.body = input.body;
    }
    const result = (await this.db.query(
      `LET $user = type::thing('users', $uid_raw);
       CREATE entities CONTENT { ${fields.join(', ')} } RETURN ${RETURN_COLS};`,
      params
    )) as unknown[];
    // With LET + CREATE, each statement produces one result entry.
    // Find the first CREATE result (skips LET which returns null/undefined).
    let row: unknown = null;
    for (const entry of result) {
      if (Array.isArray(entry) && entry.length > 0) {
        row = entry[0];
        break;
      }
    }
    if (!row) throw new Error('Failed to create entity');
    return normalizeEntity(row);
  }

  async get(id: string): Promise<Entity | null> {
    const result = await this.db.query<[unknown[]]>(
      `SELECT ${RETURN_COLS} FROM entities WHERE id = type::thing("entities", $raw) LIMIT 1;`,
      { raw: rawIdPart(id, 'entities') }
    );
    const row = result[0]?.[0];
    return row ? normalizeEntity(row) : null;
  }

  async list(filter: EntityFilter = {}): Promise<Entity[]> {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (filter.kind) {
      where.push('kind = $kind');
      params.kind = filter.kind;
    } else if (filter.excludeKinds && filter.excludeKinds.length > 0) {
      // Only applied when no explicit kind was given — the user asked
      // to hide certain kinds from the general browse view.
      where.push('kind NOT IN $exclude_kinds');
      params.exclude_kinds = [...filter.excludeKinds];
    }
    if (filter.context) {
      where.push('context = $context');
      params.context = filter.context;
    }
    if (filter.status) {
      where.push('status = $status');
      params.status = filter.status;
    } else {
      where.push("status != 'archived'");
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
    const offset = Math.max(filter.offset ?? 0, 0);
    // Direct interpolation is safe here: limit and offset are clamped
    // integers from the two lines above. Do NOT change them to strings
    // or non-numeric values without adding a $-bound parameter.
    const result = await this.db.query<[unknown[]]>(
      `SELECT ${RETURN_COLS} FROM entities ${whereClause} ORDER BY updated_at DESC LIMIT ${limit} START ${offset};`,
      params
    );
    return (result[0] ?? []).map(normalizeEntity);
  }

  /** Returns the distinct context values actually in use across active entities. */
  async distinctContexts(): Promise<string[]> {
    const result = await this.db.query<[Array<{ context: string }>]>(
      `SELECT context FROM entities WHERE status != 'archived' GROUP BY context ORDER BY context ASC;`
    );
    return (result[0] ?? []).map((r) => String(r.context)).filter(Boolean);
  }

  async count(filter: EntityFilter = {}): Promise<number> {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (filter.kind) {
      where.push('kind = $kind');
      params.kind = filter.kind;
    }
    if (filter.context) {
      where.push('context = $context');
      params.context = filter.context;
    }
    if (filter.status) {
      where.push('status = $status');
      params.status = filter.status;
    } else {
      where.push("status != 'archived'");
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const result = await this.db.query<[Array<{ count: number }>]>(
      `SELECT count() AS count FROM entities ${whereClause} GROUP ALL;`,
      params
    );
    return result[0]?.[0]?.count ?? 0;
  }

  async update(
    id: string,
    expectedVersion: number,
    patch: EntityPatch,
    updatedByUserId: string
  ): Promise<Entity> {
    const current = await this.get(id);
    if (!current) throw new Error(`entity ${id} not found`);
    if (current.version !== expectedVersion) {
      throw new VersionConflictError(id, current.version, expectedVersion);
    }

    const sets: string[] = [];
    const params: Record<string, unknown> = {
      raw: rawIdPart(id, 'entities'),
      uid_raw: rawIdPart(updatedByUserId, 'users'),
    };
    if (patch.title !== undefined) {
      sets.push('title = $title');
      params.title = patch.title;
    }
    if (patch.body !== undefined) {
      sets.push('body = $body');
      params.body = patch.body;
    }
    if (patch.attributes !== undefined) {
      sets.push('attributes = $attributes');
      params.attributes = cleanObject(patch.attributes);
    }
    if (patch.status !== undefined) {
      sets.push('status = $status');
      params.status = patch.status;
    }
    sets.push('version = version + 1');
    sets.push("updated_by = type::thing('users', $uid_raw)");

    const result = await this.db.query<[unknown[]]>(
      `UPDATE entities SET ${sets.join(', ')} WHERE id = type::thing("entities", $raw) RETURN ${RETURN_COLS};`,
      params
    );
    const row = result[0]?.[0];
    if (!row) throw new Error(`failed to update entity ${id}`);
    return normalizeEntity(row);
  }

  async archive(id: string, updatedByUserId: string): Promise<Entity> {
    const result = await this.db.query<[unknown[]]>(
      `UPDATE entities SET status = 'archived', version = version + 1, updated_by = type::thing('users', $uid_raw)
         WHERE id = type::thing("entities", $raw) RETURN ${RETURN_COLS};`,
      { raw: rawIdPart(id, 'entities'), uid_raw: rawIdPart(updatedByUserId, 'users') }
    );
    const row = result[0]?.[0];
    if (!row) throw new Error(`entity ${id} not found`);
    return normalizeEntity(row);
  }

  /**
   * Entities with zero active edges — "orphans" that are not connected
   * to anything in the graph. Used by the lint_graph tool.
   *
   * Implementation note: the previous version tried to do this in one
   * SurrealQL query using `id NOT IN (SELECT VALUE from_entity FROM edges …)`.
   * That returned zero rows for a populated graph under SurrealDB v2 —
   * the `NOT IN` comparison between a record id and a Thing-typed
   * subquery result is unreliable. We now fetch the active entity ids
   * and the active edge endpoints separately and compute the set
   * difference in JS. The extra round trips are fine for the lint case
   * (runs on demand, not on the hot path) and the behaviour is
   * testable without standing up a real SurrealDB.
   */
  async findOrphans(filter: EntityFilter = {}): Promise<Entity[]> {
    const where: string[] = ["status != 'archived'"];
    const params: Record<string, unknown> = {};
    if (filter.kind) { where.push('kind = $kind'); params.kind = filter.kind; }
    if (filter.context) { where.push('context = $context'); params.context = filter.context; }
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);

    // Step 1: fetch all candidate active entities (with filters applied).
    const entityResult = await this.db.query<[unknown[]]>(
      `SELECT ${RETURN_COLS} FROM entities WHERE ${where.join(' AND ')} ORDER BY updated_at DESC;`,
      params
    );
    const candidates = (entityResult[0] ?? []).map(normalizeEntity);
    if (candidates.length === 0) return [];

    // Step 2: collect every entity id that appears on *either* side of
    // an active edge (valid_to unset). We SELECT both endpoints in one
    // query and normalize the Thing-ids back to "table:id" strings so
    // they can be compared with entity.id.
    const edgeResult = await this.db.query<[Array<{ from_entity: unknown; to_entity: unknown }>]>(
      `SELECT from_entity, to_entity FROM edges
         WHERE ${IS_UNSET('valid_to')};`
    );
    const connected = new Set<string>();
    for (const row of edgeResult[0] ?? []) {
      const from = normalizeThingId(row.from_entity);
      const to = normalizeThingId(row.to_entity);
      if (from) connected.add(from);
      if (to) connected.add(to);
    }

    // Step 3: keep only candidates not referenced by any active edge.
    const orphans = candidates.filter((e) => !connected.has(e.id));
    return orphans.slice(0, limit);
  }

  /**
   * Entities not updated in the last `days` days — potential stale
   * content that should be reviewed or archived.
   */
  async findStale(days: number, filter: EntityFilter = {}): Promise<Entity[]> {
    // Direct interpolation is safe: `d` is Math.floor'd to an integer
    // above, `limit` is clamped 1..200 below. Both are numeric, no
    // caller-controlled string ever reaches the template.
    const d = Math.max(1, Math.floor(days));
    const where: string[] = ["status != 'archived'", `updated_at < time::now() - ${d}d`];
    const params: Record<string, unknown> = {};
    if (filter.kind) { where.push('kind = $kind'); params.kind = filter.kind; }
    if (filter.context) { where.push('context = $context'); params.context = filter.context; }
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const result = await this.db.query<[unknown[]]>(
      `SELECT ${RETURN_COLS} FROM entities WHERE ${where.join(' AND ')} ORDER BY updated_at ASC LIMIT ${limit};`,
      params
    );
    return (result[0] ?? []).map(normalizeEntity);
  }

  /**
   * Entities whose titles collide under a normalized key — potential
   * duplicates that should be merged or disambiguated.
   *
   * Normalization rules:
   *   - lowercase
   *   - collapse runs of whitespace to a single space
   *   - strip leading/trailing punctuation and whitespace
   *   - drop the leading "ADR", "ADR v1", "ADR v2 (ausführlich)" style
   *     prefixes so two ADRs for the same decision group together
   *
   * This catches "ADR v1: Skill Forge — …" and "ADR: Skill Forge — … (v1)"
   * as belonging to the same logical decision. Exact-match was too strict
   * for the common case where an ADR gets re-created with a slightly
   * different title wording instead of a proper supersedes edge.
   */
  async findDuplicateTitles(filter: EntityFilter = {}): Promise<Array<{ title: string; ids: string[] }>> {
    const where: string[] = ["status != 'archived'"];
    const params: Record<string, unknown> = {};
    if (filter.kind) { where.push('kind = $kind'); params.kind = filter.kind; }
    if (filter.context) { where.push('context = $context'); params.context = filter.context; }
    const result = await this.db.query<[unknown[]]>(
      `SELECT id, title FROM entities WHERE ${where.join(' AND ')};`,
      params
    );
    const rows = (result[0] ?? []) as Array<{ id: unknown; title: unknown }>;

    const normalize = (raw: string): string => {
      let t = raw.toLowerCase();

      // Detect version hints from either prefix ("ADR v2 (ausführlich):")
      // or suffix ("ADR: … (v1)"). Version is kept in the key so v1 and
      // v2 of the same decision do NOT collapse into one group — that
      // was a legitimate supersedes chain, not a duplicate.
      let version = '';
      const prefixVersionMatch = t.match(/^\s*adr\s*v?(\d+)(?:\s*\([^)]*\))?\s*[:\-—]/i);
      const suffixVersionMatch = t.match(/\s*\(v(\d+)\)\s*$/i);
      if (prefixVersionMatch) version = 'v' + prefixVersionMatch[1];
      else if (suffixVersionMatch) version = 'v' + suffixVersionMatch[1];

      // Drop the ADR prefix in all its variants ("ADR:", "ADR v1:",
      // "ADR v2 (ausführlich):"). The capture is non-greedy and only
      // anchored at the start.
      t = t.replace(/^\s*adr(\s*v?\d+)?(\s*\([^)]*\))?\s*[:\-—]\s*/i, '');
      // Strip a trailing "(v1)" marker so it does not stay in the body.
      t = t.replace(/\s*\(v\d+\)\s*$/i, '');
      // Collapse whitespace and trim edge punctuation.
      t = t.replace(/\s+/g, ' ').trim();
      t = t.replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, '');

      return version ? `${version}|${t}` : t;
    };

    const groups = new Map<string, { title: string; ids: string[] }>();
    for (const row of rows) {
      const rawTitle = typeof row.title === 'string' ? row.title : String(row.title);
      const key = normalize(rawTitle);
      if (!key) continue;
      const entry = groups.get(key);
      if (entry) {
        entry.ids.push(normalizeThingId(row.id));
      } else {
        groups.set(key, { title: rawTitle, ids: [normalizeThingId(row.id)] });
      }
    }

    return Array.from(groups.values())
      .filter((g) => g.ids.length > 1)
      .sort((a, b) => b.ids.length - a.ids.length)
      .slice(0, 50);
  }

  /**
   * BM25-ranked full-text search over title and body.
   *
   * Uses the FTS indexes defined in migrations/0006_fts.surql:
   *   - entities_title_search (FIELDS title)  → match reference 0
   *   - entities_body_search  (FIELDS body)   → match reference 1
   *
   * Ranking formula: title matches count double. A hit in the title is
   * almost always more meaningful than a body mention of the same term
   * (titles are the user-written label, bodies are free-form content).
   * BM25 handles inverse document frequency automatically so common
   * words ("plexus", "mcp") naturally contribute less than rare ones.
   *
   * Optional `highlight: true` turns on search::highlight() for the
   * title field, returning the original text with <mark>...</mark>
   * around matched tokens. The body field is returned raw — the
   * dashboard slices it down to a preview client-side and rendering
   * escaped `<mark>` spans inside a further-escaped slice is fiddly
   * and not worth it yet.
   */
  async search(
    query: string,
    filter: EntityFilter & { highlight?: boolean } = {}
  ): Promise<Entity[]> {
    const q = query.trim();
    if (!q) return [];

    const where: string[] = ['(title @0@ $q OR body @1@ $q)'];
    const params: Record<string, unknown> = { q };
    if (filter.kind) { where.push('kind = $kind'); params.kind = filter.kind; }
    if (filter.context) { where.push('context = $context'); params.context = filter.context; }
    where.push("status != 'archived'");

    const limit = Math.min(Math.max(filter.limit ?? 20, 1), 100);
    // When highlighting is requested we swap the title column for the
    // highlighted variant. The rest of RETURN_COLS stays identical so
    // normalizeEntity can still consume the row unchanged.
    const cols = filter.highlight
      ? RETURN_COLS.replace(
          'title',
          `search::highlight('<mark>', '</mark>', 0) AS title`
        )
      : RETURN_COLS;
    // SurrealDB's ORDER BY wants an identifier, not an expression, so
    // we compute the BM25 rank as a projected `_rank` column and sort
    // on that alias. normalizeEntity ignores the extra field.
    //
    // Direct ${limit} interpolation is safe: the value is clamped to
    // 1..100 as a pure integer two lines up. The user-supplied search
    // query itself goes through the $q bound parameter, never through
    // the template.
    const result = await this.db.query<[unknown[]]>(
      `SELECT ${cols},
              search::score(0) * 2 + search::score(1) AS _rank
         FROM entities
         WHERE ${where.join(' AND ')}
         ORDER BY _rank DESC
         LIMIT ${limit};`,
      params
    );
    return (result[0] ?? []).map(normalizeEntity);
  }
}
