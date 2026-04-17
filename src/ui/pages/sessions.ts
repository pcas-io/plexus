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
    ? '<tr><td colspan="6" class="empty">No active sessions.</td></tr>'
    : sessions
        .map((s) => {
          const isCurrent = s.id === currentSessionId;
          const action = isCurrent
            ? '<span class="badge badge-active">this session</span>'
            : `<form method="POST" action="/sessions/${encodeURIComponent(s.id)}/revoke" style="display:inline">
                <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
                <button type="submit" class="btn btn-small btn-danger">Revoke</button>
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
    <h1>My sessions</h1>
    <p class="subtitle">All active dashboard sessions. You can revoke any session that isn't the current one.</p>

    ${raw(renderFlash(flash))}

    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Session</th>
            <th>IP</th>
            <th>User-Agent</th>
            <th>Created</th>
            <th>Last active</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>${raw(rows)}</tbody>
      </table>
    </div>

    <div style="margin-top:1.23rem">
      <form method="POST" action="/auth/logout">
        <input type="hidden" name="_csrf" value="${csrfToken}">
        <button type="submit" class="btn btn-danger">Sign out on this device</button>
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
