/**
 * Admin audit-log page.
 *
 * Shows the full activity_log feed with filters and pagination, gated
 * on `currentUser.is_admin`. Filters: user, action, outcome, target
 * type, target id, since/until (ISO date or datetime). Default load
 * shows 100 newest entries across all target types — including
 * security-relevant events (login, logout, passkey enrolment, oauth
 * consent, rate-limit hits) which the home-page sidebar intentionally
 * hides via `onlyGraph: true`.
 *
 * Pagination is simple prev/next with a fixed page size (100). A page
 * count is rendered when total count is known. Target ids that look
 * like entity ids get linked to the entity detail page so admins can
 * jump from a save_entity line to the record itself.
 *
 * Closes the half-implemented audit-log feature — activity_log writes
 * were already solid, only the read side for admins was missing.
 * Task entities:tckt3piig1ggql0tzpws.
 */

import type { ActivityLogEntry } from '../../db/repositories/activity_log.js';
import {
  layout,
  html,
  raw,
  escapeHtml,
  formatDate,
} from '../layout.js';

export interface AuditFilterInput {
  readonly userName?: string;
  readonly action?: string;
  readonly outcome?: string;
  readonly targetType?: string;
  readonly targetId?: string;
  readonly since?: string;
  readonly until?: string;
}

export interface AuditPageOptions {
  readonly currentUser: { readonly name: string; readonly is_admin: boolean };
  readonly entries: ActivityLogEntry[];
  readonly totalCount: number;
  readonly limit: number;
  readonly offset: number;
  readonly filter: AuditFilterInput;
  /** Distinct action values so the dropdown stays in sync with reality. */
  readonly actionOptions: string[];
  /** Known usernames for the user dropdown. */
  readonly userOptions: string[];
  readonly csrfToken: string;
}

const TARGET_TYPE_OPTIONS = ['entity', 'edge', 'user', 'session', 'share', 'oauth', 'token', 'passkey', 'rate_limit'];
const OUTCOME_OPTIONS = ['success', 'failure'];

function outcomeBadge(outcome: string): string {
  const cls = outcome === 'failure' ? 'badge-danger' : 'badge-active';
  return `<span class="badge ${cls}">${escapeHtml(outcome)}</span>`;
}

function targetCell(entry: ActivityLogEntry): string {
  if (!entry.target_id) return '<span class="subtle">—</span>';
  const isEntity = entry.target_type === 'entity' && entry.target_id.startsWith('entities:');
  const label = escapeHtml(entry.target_id);
  if (isEntity) {
    return `<a href="/entities/${encodeURIComponent(entry.target_id)}" class="mono" style="font-size:0.77rem">${label}</a>`;
  }
  return `<span class="mono subtle" style="font-size:0.77rem">${label}</span>`;
}

function truncate(input: string | null, max: number): string {
  if (!input) return '';
  if (input.length <= max) return input;
  return `${input.slice(0, max - 1)}…`;
}

function metadataCell(entry: ActivityLogEntry): string {
  const keys = Object.keys(entry.metadata ?? {});
  if (keys.length === 0) return '<span class="subtle">—</span>';
  const preview = keys
    .slice(0, 3)
    .map((k) => `${escapeHtml(k)}=${escapeHtml(truncate(String(entry.metadata[k] ?? ''), 40))}`)
    .join(' ');
  const suffix = keys.length > 3 ? ` +${keys.length - 3}` : '';
  return `<span class="subtle mono" style="font-size:0.77rem">${preview}${suffix}</span>`;
}

function buildQuery(filter: AuditFilterInput, offset: number, limit: number): string {
  const params = new URLSearchParams();
  if (filter.userName) params.set('user', filter.userName);
  if (filter.action) params.set('action', filter.action);
  if (filter.outcome) params.set('outcome', filter.outcome);
  if (filter.targetType) params.set('target_type', filter.targetType);
  if (filter.targetId) params.set('target_id', filter.targetId);
  if (filter.since) params.set('since', filter.since);
  if (filter.until) params.set('until', filter.until);
  if (offset > 0) params.set('offset', String(offset));
  if (limit !== 100) params.set('limit', String(limit));
  const q = params.toString();
  return q ? `?${q}` : '';
}

function paginationControls(filter: AuditFilterInput, offset: number, limit: number, total: number): string {
  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;
  const prevOffset = Math.max(0, offset - limit);
  const nextOffset = offset + limit;
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const prevUrl = `/audit${buildQuery(filter, prevOffset, limit)}`;
  const nextUrl = `/audit${buildQuery(filter, nextOffset, limit)}`;
  const prevBtn = hasPrev
    ? `<a class="btn btn-ghost btn-small" href="${prevUrl}">← Zurueck</a>`
    : `<span class="btn btn-ghost btn-small" style="opacity:0.4;pointer-events:none">← Zurueck</span>`;
  const nextBtn = hasNext
    ? `<a class="btn btn-ghost btn-small" href="${nextUrl}">Weiter →</a>`
    : `<span class="btn btn-ghost btn-small" style="opacity:0.4;pointer-events:none">Weiter →</span>`;
  return `
    <div style="display:flex;gap:0.62rem;align-items:center;margin-top:0.77rem">
      ${prevBtn}
      <span class="subtle mono" style="font-size:0.85rem">Seite ${currentPage} / ${totalPages} (${total} Zeilen gesamt)</span>
      ${nextBtn}
    </div>
  `;
}

function selectOption(value: string, current: string | undefined, label?: string): string {
  const selected = value === current ? ' selected' : '';
  return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(label ?? value)}</option>`;
}

export function renderAuditPage(opts: AuditPageOptions): string {
  const { currentUser, entries, totalCount, limit, offset, filter, actionOptions, userOptions, csrfToken } = opts;

  const userDropdown = [
    '<option value="">— alle —</option>',
    ...userOptions.map((u) => selectOption(u, filter.userName)),
  ].join('');
  const actionDropdown = [
    '<option value="">— alle —</option>',
    ...actionOptions.map((a) => selectOption(a, filter.action)),
  ].join('');
  const outcomeDropdown = [
    '<option value="">— alle —</option>',
    ...OUTCOME_OPTIONS.map((o) => selectOption(o, filter.outcome)),
  ].join('');
  const targetTypeDropdown = [
    '<option value="">— alle —</option>',
    ...TARGET_TYPE_OPTIONS.map((t) => selectOption(t, filter.targetType)),
  ].join('');

  // Row rendering uses a plain template literal (not the `html` tag)
  // because the helper functions already return ready-to-insert HTML
  // strings. Wrapping them in `raw()` here would stringify the marker
  // object into "[object Object]" — we learned that the hard way in
  // the first live preview.
  const rows = entries.length === 0
    ? `<tr><td colspan="7" class="subtle" style="text-align:center;padding:1.23rem">Keine Eintraege fuer diesen Filter.</td></tr>`
    : entries
        .map((e) => `
          <tr>
            <td class="mono subtle" style="font-size:0.77rem;white-space:nowrap">${escapeHtml(formatDate(e.timestamp))}</td>
            <td class="mono" style="font-size:0.85rem">${e.user_name ? escapeHtml(e.user_name) : '<span class="subtle">—</span>'}</td>
            <td class="mono" style="font-size:0.85rem">${escapeHtml(e.action)}</td>
            <td>${targetCell(e)}</td>
            <td>${outcomeBadge(e.outcome)}</td>
            <td class="mono subtle" style="font-size:0.77rem">${e.ip ? escapeHtml(e.ip) : '—'}</td>
            <td>${metadataCell(e)}</td>
          </tr>
        `)
        .join('');

  const body = html`
    <h1>Audit Log</h1>
    <p class="subtitle">Alle Activity-Log-Eintraege inklusive Security-Events. Nur Admins.</p>

    <form method="GET" action="/audit" class="card" style="margin-bottom:1.23rem">
      <div class="form-row">
        <div class="form-field">
          <label>User</label>
          <select name="user">${raw(userDropdown)}</select>
        </div>
        <div class="form-field">
          <label>Action</label>
          <select name="action">${raw(actionDropdown)}</select>
        </div>
        <div class="form-field">
          <label>Outcome</label>
          <select name="outcome">${raw(outcomeDropdown)}</select>
        </div>
        <div class="form-field">
          <label>Target Type</label>
          <select name="target_type">${raw(targetTypeDropdown)}</select>
        </div>
      </div>
      <div class="form-row" style="margin-top:0.62rem">
        <div class="form-field">
          <label>Target ID (exakt)</label>
          <input type="text" name="target_id" value="${escapeHtml(filter.targetId ?? '')}" placeholder="entities:xyz oder users:abc">
        </div>
        <div class="form-field">
          <label>Seit</label>
          <input type="date" name="since" value="${escapeHtml((filter.since ?? '').slice(0, 10))}">
        </div>
        <div class="form-field">
          <label>Bis</label>
          <input type="date" name="until" value="${escapeHtml((filter.until ?? '').slice(0, 10))}">
        </div>
        <div style="flex:0 0 auto;align-self:end;display:flex;gap:0.31rem">
          <button type="submit" class="btn">Filtern</button>
          <a href="/audit" class="btn btn-ghost">Reset</a>
        </div>
      </div>
    </form>

    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Zeit</th>
            <th>User</th>
            <th>Action</th>
            <th>Target</th>
            <th>Outcome</th>
            <th>IP</th>
            <th>Meta</th>
          </tr>
        </thead>
        <tbody>${raw(rows)}</tbody>
      </table>
    </div>

    ${raw(paginationControls(filter, offset, limit, totalCount))}
  `;

  return layout({
    title: 'Audit Log',
    body,
    currentUser,
    activePath: '/audit',
    csrfToken,
  });
}
