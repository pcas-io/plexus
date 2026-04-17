/**
 * Personal tokens management page — /tokens.
 *
 * Shows the logged-in user their own personal tokens with scope info
 * and revoke buttons.
 */

import type { User } from '../../db/repositories/users.js';
import type { PersonalToken } from '../../db/repositories/personal_tokens.js';
import {
  layout,
  html,
  raw,
  escapeHtml,
  formatDate,
  renderFlash,
} from '../layout.js';

interface TokensPageOptions {
  readonly currentUser: User;
  readonly tokens: PersonalToken[];
  readonly contexts: string[];
  readonly kinds: string[];
  readonly csrfToken: string;
  readonly flash?: { type: 'success' | 'danger' | 'info'; message: string; token?: string };
}

function statusLabel(t: PersonalToken): string {
  if (t.revoked_at) return '<span class="badge badge-archived">revoked</span>';
  if (t.expires_at) {
    const exp = Date.parse(t.expires_at);
    if (Number.isFinite(exp) && exp <= Date.now()) return '<span class="badge badge-archived">expired</span>';
  }
  return '<span class="badge badge-active">active</span>';
}

function scopeLabel(t: PersonalToken): string {
  const parts: string[] = [t.scope_permission];
  if (t.scope_contexts && t.scope_contexts.length > 0) {
    parts.push('ctx:' + t.scope_contexts.join(','));
  }
  if (t.scope_kinds && t.scope_kinds.length > 0) {
    parts.push('kinds:' + t.scope_kinds.join(','));
  }
  return parts.join(' · ');
}

export function renderTokensPage(opts: TokensPageOptions): string {
  const { currentUser, tokens, contexts, kinds, csrfToken, flash } = opts;

  const ctxCheckboxes = contexts.map((ctx) =>
    `<label style="display:inline-flex;align-items:center;gap:4px;margin-right:0.62rem;font-size:0.85rem"><input type="checkbox" name="scope_contexts" value="${escapeHtml(ctx)}">${escapeHtml(ctx)}</label>`
  ).join('');
  const kindCheckboxes = kinds.map((k) =>
    `<label style="display:inline-flex;align-items:center;gap:4px;margin-right:0.62rem;font-size:0.85rem"><input type="checkbox" name="scope_kinds" value="${escapeHtml(k)}">${escapeHtml(k)}</label>`
  ).join('');

  const activeTokens = tokens.filter((t) => !t.revoked_at && (!t.expires_at || Date.parse(t.expires_at) > Date.now()));
  const inactiveTokens = tokens.filter((t) => t.revoked_at || (t.expires_at && Date.parse(t.expires_at) <= Date.now()));

  const renderRow = (t: PersonalToken, canRevoke: boolean) => `
    <tr>
      <td style="font-weight:600">${escapeHtml(t.label ?? 'default')}</td>
      <td>${statusLabel(t)}</td>
      <td class="mono" style="font-size:0.77rem">${escapeHtml(scopeLabel(t))}</td>
      <td class="mono" style="font-size:0.77rem">${formatDate(t.created_at)}</td>
      <td class="mono" style="font-size:0.77rem">${t.last_used_at ? formatDate(t.last_used_at) : '<span class="subtle">never</span>'}</td>
      <td class="mono" style="font-size:0.77rem">${t.expires_at ? formatDate(t.expires_at) : '<span class="subtle">never</span>'}</td>
      <td>${canRevoke
        ? `<form method="POST" action="/tokens/${encodeURIComponent(t.id)}/revoke" style="display:inline">
            <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
            <button type="submit" class="btn btn-small btn-ghost" onclick="return confirm('Revoke token?')">Revoke</button>
          </form>`
        : '—'}</td>
    </tr>`;

  const activeRows = activeTokens.length === 0
    ? '<tr><td colspan="7" class="empty">No active tokens.</td></tr>'
    : activeTokens.map((t) => renderRow(t, activeTokens.length > 1)).join('');

  const inactiveRows = inactiveTokens.length === 0
    ? ''
    : `<h2 style="margin-top:1.54rem">Inactive tokens</h2>
       <div class="table-wrapper"><table>
       <thead><tr><th>Label</th><th>Status</th><th>Scope</th><th>Created</th><th>Last used</th><th>Expires</th><th></th></tr></thead>
       <tbody>${inactiveTokens.map((t) => renderRow(t, false)).join('')}</tbody>
       </table></div>`;

  const body = html`
    <h1>My tokens</h1>
    <p class="subtitle">Personal MCP tokens for this account. Each token has its own scope.</p>

    ${raw(renderFlash(flash as Parameters<typeof renderFlash>[0]))}

    <h2>Active tokens</h2>
    <div class="table-wrapper">
      <table>
        <thead><tr><th>Label</th><th>Status</th><th>Scope</th><th>Created</th><th>Last used</th><th>Expires</th><th>Action</th></tr></thead>
        <tbody>${raw(activeRows)}</tbody>
      </table>
    </div>

    ${raw(inactiveRows)}

    <div class="card" style="margin-top:1.54rem">
      <h3>Create new token</h3>
      <p class="subtle" style="font-size:0.85rem;margin-bottom:0.62rem">Creates an additional token with its own scope for this account.</p>
      <form method="POST" action="/tokens/create">
        <input type="hidden" name="_csrf" value="${csrfToken}">
        <div class="form-row">
          <div class="form-field">
            <label>Label</label>
            <input type="text" name="label" maxlength="100" placeholder="e.g. Claude Code, Monitoring" required>
          </div>
          <div class="form-field">
            <label>Permission</label>
            <select name="scope_permission">
              <option value="write" selected>write</option>
              <option value="read">read</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <div class="form-field">
            <label>Expiry (days)</label>
            <input type="number" name="expires_in_days" min="1" max="365" placeholder="no limit">
          </div>
          <div style="flex:0 0 auto">
            <button type="submit" class="btn">Create token</button>
          </div>
        </div>
        ${raw(ctxCheckboxes ? `<div style="margin-top:0.46rem"><label style="display:block;font-size:0.69rem;font-weight:700;color:var(--color-subtle);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:0.38rem">Contexts (empty = all)</label><div>${ctxCheckboxes}</div></div>` : '')}
        ${raw(kindCheckboxes ? `<div style="margin-top:0.46rem"><label style="display:block;font-size:0.69rem;font-weight:700;color:var(--color-subtle);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:0.38rem">Kinds (empty = all)</label><div>${kindCheckboxes}</div></div>` : '')}
      </form>
    </div>
  `;

  return layout({
    title: 'My tokens',
    body,
    currentUser,
    activePath: '/tokens',
    csrfToken,
  });
}
