/**
 * Share management page — /shares.
 *
 * Three tabs:
 *   - Active:    currently redeemable, with countdown + revoke
 *   - Consumed:  consumed, with IP/UA audit trail
 *   - Inactive:  expired or revoked without ever being consumed
 *
 * Dashboard-only; this view is the control surface for an explicit
 * human action and therefore carries write controls (revoke), which
 * are the single sanctioned exception to the otherwise read-only
 * dashboard rule.
 */

import type { User } from '../../db/repositories/users.js';
import type { ShareToken } from '../../db/repositories/share_tokens.js';
import {
  layout,
  html,
  raw,
  escapeHtml,
  formatDate,
  kindBadge,
} from '../layout.js';

interface EntityRef {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
}

interface SharesListOptions {
  readonly currentUser: User;
  readonly active: ShareToken[];
  readonly consumed: ShareToken[];
  readonly inactive: ShareToken[];
  readonly entityMap: Map<string, EntityRef>;
  readonly csrfToken: string;
}

function countdownLabel(expiresAt: string): string {
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return expiresAt;
  const remaining = Math.max(0, t - Date.now());
  const minutes = Math.floor(remaining / 60000);
  if (minutes <= 0) return 'lt;1 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function entityCell(ref: EntityRef | undefined, fallback: string): string {
  if (!ref) {
    return `<span class="subtle mono">${escapeHtml(fallback)}</span>`;
  }
  return `${kindBadge(ref.kind)} <a href="/entities/${encodeURIComponent(ref.id)}">${escapeHtml(ref.title)}</a>`;
}

export function renderSharesList(opts: SharesListOptions): string {
  const { currentUser, active, consumed, inactive, entityMap, csrfToken } = opts;

  const activeRows = active.length === 0
    ? '<tr><td colspan="5" class="empty">No active share links.</td></tr>'
    : active
        .map((s) => `
          <tr>
            <td>${entityCell(entityMap.get(s.entity), s.entity)}</td>
            <td class="mono" style="font-size:0.77rem">${escapeHtml(formatDate(s.created_at))}</td>
            <td class="mono" style="font-size:0.77rem">${escapeHtml(countdownLabel(s.expires_at))}</td>
            <td class="mono" style="font-size:0.77rem">${escapeHtml(s.created_by.replace(/^users:/, ''))}</td>
            <td>
              <form method="POST" action="/shares/${encodeURIComponent(s.id)}/revoke" style="display:inline">
                <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
                <button type="submit" class="btn btn-small btn-ghost" onclick="return confirm('Revoke this share link immediately?')">revoke</button>
              </form>
            </td>
          </tr>`)
        .join('');

  const consumedRows = consumed.length === 0
    ? '<tr><td colspan="5" class="empty">No consumed links yet.</td></tr>'
    : consumed
        .map((s) => `
          <tr>
            <td>${entityCell(entityMap.get(s.entity), s.entity)}</td>
            <td class="mono" style="font-size:0.77rem">${escapeHtml(formatDate(s.created_at))}</td>
            <td class="mono" style="font-size:0.77rem">${s.consumed_at ? escapeHtml(formatDate(s.consumed_at)) : '—'}</td>
            <td class="mono" style="font-size:0.77rem">${escapeHtml(s.consumed_ip ?? '—')}</td>
            <td class="mono subtle" style="font-size:0.69rem;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml((s.consumed_ua ?? '').slice(0, 80))}</td>
          </tr>`)
        .join('');

  const inactiveRows = inactive.length === 0
    ? '<tr><td colspan="4" class="empty">No expired or revoked links.</td></tr>'
    : inactive
        .map((s) => {
          const reason = s.revoked_at
            ? `revoked ${escapeHtml(formatDate(s.revoked_at))}`
            : `expired ${escapeHtml(formatDate(s.expires_at))}`;
          return `
            <tr>
              <td>${entityCell(entityMap.get(s.entity), s.entity)}</td>
              <td class="mono" style="font-size:0.77rem">${escapeHtml(formatDate(s.created_at))}</td>
              <td class="mono" style="font-size:0.77rem">${reason}</td>
              <td class="mono" style="font-size:0.77rem">${escapeHtml(s.created_by.replace(/^users:/, ''))}</td>
            </tr>`;
        })
        .join('');

  const body = html`
    <h1>Share links</h1>
    <p class="subtitle">One-time read-only links for individual entities. Creation only via an entity detail page with a step-up passkey.</p>

    <h2>Active</h2>
    <div class="table-wrapper">
      <table>
        <thead><tr><th>Entity</th><th>Created</th><th>Expires</th><th>Creator</th><th>Action</th></tr></thead>
        <tbody>${raw(activeRows)}</tbody>
      </table>
    </div>

    <h2 style="margin-top:1.54rem">Consumed</h2>
    <div class="table-wrapper">
      <table>
        <thead><tr><th>Entity</th><th>Created</th><th>Consumed</th><th>IP</th><th>User-Agent</th></tr></thead>
        <tbody>${raw(consumedRows)}</tbody>
      </table>
    </div>

    <h2 style="margin-top:1.54rem">Expired / revoked</h2>
    <div class="table-wrapper">
      <table>
        <thead><tr><th>Entity</th><th>Created</th><th>Status</th><th>Creator</th></tr></thead>
        <tbody>${raw(inactiveRows)}</tbody>
      </table>
    </div>
  `;

  return layout({
    title: 'Share links',
    body,
    currentUser,
    activePath: '/shares',
    csrfToken,
  });
}
