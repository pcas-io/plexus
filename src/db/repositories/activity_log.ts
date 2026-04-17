/**
 * Activity Log Repository — audit trail of graph-modifying actions.
 *
 * Per the Auth-ADR (buddy node 01KNF1YX0DS7BEKAF2EF6F8TG1 Abschnitt 7):
 * the activity log is a first-class feature, not optional. Every
 * graph-mutating MCP call and every security-relevant auth event ends
 * up here. Reads are used by the dashboard to show recent activity and
 * to compute activity scores on entity/project cards.
 *
 * Row shape matches migrations/0001_init.surql:
 *   timestamp, user_name, action, target_type, target_id,
 *   ip, user_agent, outcome, metadata (JSON)
 */

import type { Surreal } from 'surrealdb';
import { normalizeThingId } from '../util/record_id.js';
import { cleanObject } from '../util/clean.js';

export interface ActivityLogEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly user_name: string | null;
  readonly action: string;
  readonly target_type: string | null;
  readonly target_id: string | null;
  readonly ip: string | null;
  readonly user_agent: string | null;
  readonly outcome: string;
  readonly metadata: Record<string, unknown>;
}

export interface NewActivityLog {
  readonly userName?: string;
  readonly action: string;
  readonly targetType?: string;
  readonly targetId?: string;
  readonly ip?: string;
  readonly userAgent?: string;
  readonly outcome?: 'success' | 'failure';
  readonly metadata?: Record<string, unknown>;
}

/**
 * Filter for the admin audit-log browser. Every field is optional; an
 * empty filter matches everything. `since` / `until` are ISO-8601
 * timestamps; when set they bound the timestamp column inclusively.
 * `onlyGraph` narrows to entity/edge target types the way the home
 * page's recent-activity widget does — default false here so admins
 * see security events (auth, oauth, rate-limit) too.
 */
export interface ActivityLogFilter {
  readonly userName?: string;
  readonly action?: string;
  readonly outcome?: 'success' | 'failure';
  readonly targetType?: string;
  readonly targetId?: string;
  readonly since?: string;
  readonly until?: string;
  readonly onlyGraph?: boolean;
}

function normalizeRow(raw: unknown): ActivityLogEntry {
  const r = raw as Record<string, unknown>;
  return {
    id: normalizeThingId(r.id),
    timestamp: String(r.timestamp),
    user_name: r.user_name == null ? null : String(r.user_name),
    action: String(r.action),
    target_type: r.target_type == null ? null : String(r.target_type),
    target_id: r.target_id == null ? null : String(r.target_id),
    ip: r.ip == null ? null : String(r.ip),
    user_agent: r.user_agent == null ? null : String(r.user_agent),
    outcome: String(r.outcome ?? 'success'),
    metadata: (r.metadata as Record<string, unknown>) ?? {},
  };
}

const RETURN_COLS =
  'id, timestamp, user_name, action, target_type, target_id, ip, user_agent, outcome, metadata';

/**
 * Weighting per action kind used by `scoreForEntity`:
 *   create = 3, link = 2, update/archive/unlink = 1
 * Anything else contributes 0 (we only score graph-mutating actions).
 */
const ACTION_WEIGHT: Record<string, number> = {
  save_entity: 3,
  link_entities: 2,
  update_entity: 1,
  archive_entity: 1,
  unlink_entity: 1,
};

export class ActivityLogRepository {
  constructor(private readonly db: Surreal) {}

  async create(input: NewActivityLog): Promise<void> {
    // SurrealDB v2 rejects explicit `null` on option<T> fields — it
    // expects either a value or the field to be absent (so the DEFAULT
    // / NONE kicks in). Build the CONTENT object dynamically and only
    // include fields we actually have a value for.
    const fields: string[] = ['action: $action', 'outcome: $outcome', 'metadata: $metadata'];
    const params: Record<string, unknown> = {
      action: input.action,
      outcome: input.outcome ?? 'success',
      metadata: cleanObject(input.metadata),
    };
    if (input.userName != null) {
      fields.push('user_name: $user_name');
      params.user_name = input.userName;
    }
    if (input.targetType != null) {
      fields.push('target_type: $target_type');
      params.target_type = input.targetType;
    }
    if (input.targetId != null) {
      fields.push('target_id: $target_id');
      params.target_id = input.targetId;
    }
    if (input.ip != null) {
      fields.push('ip: $ip');
      params.ip = input.ip;
    }
    if (input.userAgent != null) {
      fields.push('user_agent: $user_agent');
      params.user_agent = input.userAgent;
    }
    await this.db.query(
      `CREATE activity_log CONTENT { ${fields.join(', ')} };`,
      params
    );
  }

  /**
   * Returns the most recent N entries, newest first. Used by the home
   * page for the recent-activity sidebar. Only graph-mutating actions
   * are returned by default so security-audit noise (login, logout,
   * passkey enrolment) stays out of the dashboard view.
   */
  async listRecent(limit = 20, opts: { onlyGraph?: boolean } = {}): Promise<ActivityLogEntry[]> {
    const onlyGraph = opts.onlyGraph ?? true;
    const whereClause = onlyGraph
      ? "WHERE target_type = 'entity' OR target_type = 'edge'"
      : '';
    const cappedLimit = Math.min(Math.max(limit, 1), 200);
    const result = await this.db.query<[unknown[]]>(
      `SELECT ${RETURN_COLS} FROM activity_log ${whereClause} ORDER BY timestamp DESC LIMIT ${cappedLimit};`
    );
    return (result[0] ?? []).map(normalizeRow);
  }

  /**
   * Build the WHERE clause fragments + bound parameters for a filter.
   * Shared between `list` and `count` so a row that's counted always
   * lines up with a row that's listed.
   */
  private buildFilterClauses(
    filter: ActivityLogFilter
  ): { where: string[]; params: Record<string, unknown> } {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (filter.onlyGraph) {
      where.push("(target_type = 'entity' OR target_type = 'edge')");
    }
    if (filter.userName) {
      where.push('user_name = $f_user');
      params.f_user = filter.userName;
    }
    if (filter.action) {
      where.push('action = $f_action');
      params.f_action = filter.action;
    }
    if (filter.outcome) {
      where.push('outcome = $f_outcome');
      params.f_outcome = filter.outcome;
    }
    if (filter.targetType) {
      where.push('target_type = $f_ttype');
      params.f_ttype = filter.targetType;
    }
    if (filter.targetId) {
      where.push('target_id = $f_tid');
      params.f_tid = filter.targetId;
    }
    // SurrealDB v2 stores `timestamp` as datetime. Comparing against a
    // bound string silently falls back to string comparison, which is
    // not what we want. Cast the bound parameter with type::datetime
    // so the engine does a real temporal comparison. The caller is
    // expected to pass an ISO-8601 string; invalid values will surface
    // as a query error rather than as silently-matching garbage.
    if (filter.since) {
      where.push('timestamp >= type::datetime($f_since)');
      params.f_since = filter.since;
    }
    if (filter.until) {
      where.push('timestamp <= type::datetime($f_until)');
      params.f_until = filter.until;
    }
    return { where, params };
  }

  /**
   * Filtered, paginated list — newest first. Powers the admin audit
   * log page. `limit` is clamped to 1..500, `offset` to >= 0. Unlike
   * `listRecent`, this does NOT default to onlyGraph, so security
   * events (login/logout, passkey enrol, oauth consent, rate-limit
   * trips) appear unless the caller explicitly filters them out.
   */
  async list(
    filter: ActivityLogFilter = {},
    limit = 100,
    offset = 0
  ): Promise<ActivityLogEntry[]> {
    const { where, params } = this.buildFilterClauses(filter);
    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    // Direct interpolation is safe: both numbers are clamped to ints.
    const cappedLimit = Math.min(Math.max(Math.floor(limit), 1), 500);
    const cappedOffset = Math.max(Math.floor(offset), 0);
    const result = await this.db.query<[unknown[]]>(
      `SELECT ${RETURN_COLS} FROM activity_log ${whereClause}
         ORDER BY timestamp DESC
         LIMIT ${cappedLimit} START ${cappedOffset};`,
      params
    );
    return (result[0] ?? []).map(normalizeRow);
  }

  /**
   * Count of rows matching the same filter shape as `list`. Used by
   * the audit-log page to render pagination controls.
   */
  async count(filter: ActivityLogFilter = {}): Promise<number> {
    const { where, params } = this.buildFilterClauses(filter);
    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const result = await this.db.query<[Array<{ count: number }>]>(
      `SELECT count() AS count FROM activity_log ${whereClause} GROUP ALL;`,
      params
    );
    return result[0]?.[0]?.count ?? 0;
  }

  /**
   * Distinct `action` values actually logged. Populates the filter
   * dropdown on the audit page without hard-coding a list that would
   * drift from reality as new MCP tools get added.
   */
  async distinctActions(): Promise<string[]> {
    const result = await this.db.query<[Array<{ action: string }>]>(
      `SELECT action FROM activity_log GROUP BY action ORDER BY action ASC;`
    );
    return (result[0] ?? [])
      .map((r) => String(r.action ?? ''))
      .filter((s) => s.length > 0);
  }

  /**
   * Weighted activity score for a single entity within the last `days`
   * days. Uses ACTION_WEIGHT as the per-action contribution. This is the
   * generic Option-1 metric from buddy decision 01KNFGGMBV1RTTNGZZSQTKYVKM.
   */
  async scoreForEntity(entityId: string, days = 30): Promise<number> {
    const normalized = normalizeThingId(entityId);
    const result = await this.db.query<[Array<{ action: string; count: number }>]>(
      `SELECT action, count() AS count FROM activity_log
         WHERE target_type = 'entity'
           AND target_id = $id
           AND timestamp > time::now() - ${Math.max(1, Math.floor(days))}d
         GROUP BY action;`,
      { id: normalized }
    );
    const rows = result[0] ?? [];
    let score = 0;
    for (const row of rows) {
      const weight = ACTION_WEIGHT[row.action] ?? 0;
      score += weight * Number(row.count ?? 0);
    }
    return score;
  }

  /**
   * Batched variant of `scoreForEntity` — returns a map from entity id to
   * weighted score for all entities referenced in the last `days` days.
   * Much cheaper than N round-trips when rendering a list of project cards.
   */
  async scoreMap(days = 30): Promise<Map<string, number>> {
    const result = await this.db.query<[Array<{ target_id: string; action: string; count: number }>]>(
      `SELECT target_id, action, count() AS count FROM activity_log
         WHERE target_type = 'entity'
           AND timestamp > time::now() - ${Math.max(1, Math.floor(days))}d
         GROUP BY target_id, action;`
    );
    const rows = result[0] ?? [];
    const map = new Map<string, number>();
    for (const row of rows) {
      const key = String(row.target_id ?? '');
      if (!key) continue;
      const weight = ACTION_WEIGHT[row.action] ?? 0;
      map.set(key, (map.get(key) ?? 0) + weight * Number(row.count ?? 0));
    }
    return map;
  }
}
