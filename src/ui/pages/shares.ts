/**
 * Share management page — /shares.
 *
 * Three tabs as per the Kickoff-ADR:
 *   - Aktive Links:     currently redeemable, with countdown + revoke
 *   - Verbraucht:       consumed, with IP/UA audit trail
 *   - Inaktiv:          expired or revoked without ever being consumed
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
    ? '<tr><td colspan="5" class="empty">Keine aktiven Share-Links.</td></tr>'
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
                <button type="submit" class="btn btn-small btn-ghost" onclick="return confirm('Share-Link sofort entziehen?')">revoke</button>
              </form>
            </td>
          </tr>`)
        .join('');

  const consumedRows = consumed.length === 0
    ? '<tr><td colspan="5" class="empty">Noch keine verbrauchten Links.</td></tr>'
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
    ? '<tr><td colspan="4" class="empty">Keine abgelaufenen oder entzogenen Links.</td></tr>'
    : inactive
        .map((s) => {
          const reason = s.revoked_at
            ? `entzogen ${escapeHtml(formatDate(s.revoked_at))}`
            : `abgelaufen ${escapeHtml(formatDate(s.expires_at))}`;
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
    <h1>Share-Links</h1>
    <p class="subtitle">One-time Read-Only-Links fuer einzelne Entities. Erstellung nur via Entity-Detail mit Step-Up-Passkey.</p>

    <h2>Aktive Links</h2>
    <div class="table-wrapper">
      <table>
        <thead><tr><th>Entity</th><th>Erstellt</th><th>Ablauf</th><th>Ersteller</th><th>Aktion</th></tr></thead>
        <tbody>${raw(activeRows)}</tbody>
      </table>
    </div>

    <h2 style="margin-top:1.54rem">Verbraucht</h2>
    <div class="table-wrapper">
      <table>
        <thead><tr><th>Entity</th><th>Erstellt</th><th>Verbraucht</th><th>IP</th><th>User-Agent</th></tr></thead>
        <tbody>${raw(consumedRows)}</tbody>
      </table>
    </div>

    <h2 style="margin-top:1.54rem">Abgelaufen / entzogen</h2>
    <div class="table-wrapper">
      <table>
        <thead><tr><th>Entity</th><th>Erstellt</th><th>Status</th><th>Ersteller</th></tr></thead>
        <tbody>${raw(inactiveRows)}</tbody>
      </table>
    </div>
  `;

  return layout({
    title: 'Share-Links',
    body,
    currentUser,
    activePath: '/shares',
    csrfToken,
  });
}
