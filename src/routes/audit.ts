/**
 * Admin audit-log route — GET /audit.
 *
 * Renders the full `activity_log` feed with filters and pagination.
 * Admin-gated via the session user's `is_admin` flag, mirroring the
 * `/users` page. Extracted into its own module so the already-oversize
 * dashboard.ts does not grow further; dashboard mounts it via
 * `mountAuditRoutes(app, deps)`.
 *
 * Security-relevant events (login, logout, passkey enrolment, OAuth
 * consent, rate-limit trips) are visible here by default — the home
 * sidebar continues to hide them via `onlyGraph: true`, but admins
 * get a dedicated surface. Task entities:tckt3piig1ggql0tzpws.
 */

import type { Hono, MiddlewareHandler } from 'hono';
import type { ActivityLogRepository } from '../db/repositories/activity_log.js';
import type { UserRepository } from '../db/repositories/users.js';
import { ensureCsrfToken } from '../auth/csrf.js';
import { renderAuditPage, type AuditFilterInput } from '../ui/pages/audit.js';

export interface AuditRouteDeps {
  readonly activity: ActivityLogRepository;
  readonly users: UserRepository;
}

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalises a date-picker value (YYYY-MM-DD) to an ISO timestamp.
 * Since-bounds expand to the start of the day, until-bounds to the
 * end, so an until=2026-04-16 filter includes events logged that
 * evening. Full RFC 3339 inputs (set manually via URL) are passed
 * through unchanged.
 */
function normaliseDateBound(raw: string | undefined, edge: 'start' | 'end'): string | undefined {
  if (!raw) return undefined;
  if (!DATE_ONLY_RE.test(raw)) return raw;
  return edge === 'start' ? `${raw}T00:00:00Z` : `${raw}T23:59:59.999Z`;
}

export function mountAuditRoutes(
  app: Hono,
  deps: AuditRouteDeps,
  requireAdmin: () => MiddlewareHandler
): void {
  app.get('/audit', requireAdmin(), async (c) => {
    const user = c.get('dashboardUser');
    const csrfToken = ensureCsrfToken(c);
    const url = new URL(c.req.url);
    const q = url.searchParams;
    const getStr = (key: string): string | undefined => {
      const v = q.get(key);
      return v && v.trim() !== '' ? v.trim() : undefined;
    };
    const outcomeRaw = getStr('outcome');
    const outcome: 'success' | 'failure' | undefined =
      outcomeRaw === 'success' || outcomeRaw === 'failure' ? outcomeRaw : undefined;
    const filter: AuditFilterInput = {
      userName: getStr('user'),
      action: getStr('action'),
      outcome,
      targetType: getStr('target_type'),
      targetId: getStr('target_id'),
      since: getStr('since'),
      until: getStr('until'),
    };
    const limit = Math.min(
      Math.max(Number(q.get('limit') ?? DEFAULT_PAGE_SIZE), 1),
      MAX_PAGE_SIZE
    );
    const offset = Math.max(Number(q.get('offset') ?? 0), 0);

    const repoFilter = {
      userName: filter.userName,
      action: filter.action,
      outcome,
      targetType: filter.targetType,
      targetId: filter.targetId,
      since: normaliseDateBound(filter.since, 'start'),
      until: normaliseDateBound(filter.until, 'end'),
    };

    const [entries, totalCount, actionOptions, allUsers] = await Promise.all([
      deps.activity.list(repoFilter, limit, offset),
      deps.activity.count(repoFilter),
      deps.activity.distinctActions(),
      deps.users.list(),
    ]);

    return c.html(
      renderAuditPage({
        currentUser: user,
        entries,
        totalCount,
        limit,
        offset,
        filter,
        actionOptions,
        userOptions: allUsers.map((u) => u.name),
        csrfToken,
      })
    );
  });
}
