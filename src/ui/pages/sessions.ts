/**
 * My Sessions page in buddy style.
 */

import type { User } from '../../db/repositories/users.js';
import type { Session } from '../../db/repositories/sessions.js';
import {
  layout,
  html,
  raw,
  escapeHtml,
  formatDate,
  renderFlash,
} from '../layout.js';

interface SessionsListOptions {
  readonly currentUser: User;
  readonly sessions: Session[];
  readonly currentSessionId: string;
  readonly csrfToken: string;
  readonly flash?: { type: 'success' | 'danger' | 'info'; message: string };
}

export function renderSessionsList(opts: SessionsListOptions): string {
  const { currentUser, sessions, currentSessionId, csrfToken, flash } = opts;

  const rows = sessions.length === 0
    ? '<tr><td colspan="6" class="empty">Keine aktiven Sessions.</td></tr>'
    : sessions
        .map((s) => {
          const isCurrent = s.id === currentSessionId;
          const action = isCurrent
            ? '<span class="badge badge-active">diese Session</span>'
            : `<form method="POST" action="/sessions/${encodeURIComponent(s.id)}/revoke" style="display:inline">
                <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
                <button type="submit" class="btn btn-small btn-danger">Beenden</button>
              </form>`;
          return `
            <tr>
              <td class="mono" style="font-size:0.77rem">${escapeHtml(String(s.id).slice(-12))}</td>
              <td class="mono">${escapeHtml(s.ip ?? '—')}</td>
              <td style="font-size:0.77rem">${escapeHtml(s.user_agent ? (s.user_agent.length > 60 ? s.user_agent.slice(0, 60) + '…' : s.user_agent) : '—')}</td>
              <td class="mono subtle" style="font-size:0.77rem">${formatDate(s.created_at)}</td>
              <td class="mono subtle" style="font-size:0.77rem">${formatDate(s.last_active_at)}</td>
              <td>${action}</td>
            </tr>`;
        })
        .join('');

  const body = html`
    <h1>Meine Sessions</h1>
    <p class="subtitle">Alle aktiven Dashboard-Anmeldungen. Nicht-aktuelle Sessions kannst du einzeln beenden.</p>

    ${raw(renderFlash(flash))}

    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Session</th>
            <th>IP</th>
            <th>User-Agent</th>
            <th>Erstellt</th>
            <th>Letzte Aktivitaet</th>
            <th>Aktion</th>
          </tr>
        </thead>
        <tbody>${raw(rows)}</tbody>
      </table>
    </div>

    <div style="margin-top:1.23rem">
      <form method="POST" action="/auth/logout">
        <input type="hidden" name="_csrf" value="${csrfToken}">
        <button type="submit" class="btn btn-danger">Von diesem Geraet abmelden</button>
      </form>
    </div>
  `;

  return layout({
    title: 'Sessions',
    body,
    currentUser,
    activePath: '/sessions',
    csrfToken,
  });
}
