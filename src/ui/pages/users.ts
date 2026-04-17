/**
 * Users admin page in buddy style.
 */

import type { User } from '../../db/repositories/users.js';
import {
  layout,
  html,
  raw,
  escapeHtml,
  formatDate,
  renderFlash,
} from '../layout.js';

interface UsersListOptions {
  readonly currentUser: User;
  readonly users: User[];
  readonly contexts: string[];
  readonly kinds: string[];
  readonly csrfToken: string;
  readonly flash?: { type: 'success' | 'danger' | 'info'; message: string; token?: string; tokenUser?: string };
}

export function renderUsersList({ currentUser, users, contexts, kinds, csrfToken, flash }: UsersListOptions): string {
  const kindCheckboxes = kinds.length > 0
    ? kinds.map((k) =>
        `<label style="display:inline-flex;align-items:center;gap:4px;margin-right:0.62rem;font-size:0.85rem"><input type="checkbox" name="scope_kinds" value="${escapeHtml(k)}">${escapeHtml(k)}</label>`
      ).join('')
    : '';
  const contextCheckboxes = contexts.length > 0
    ? contexts.map((ctx) =>
        `<label style="display:inline-flex;align-items:center;gap:4px;margin-right:0.62rem;font-size:0.85rem"><input type="checkbox" name="scope_contexts" value="${escapeHtml(ctx)}">${escapeHtml(ctx)}</label>`
      ).join('')
    : '<span class="subtle" style="font-size:0.85rem">No contexts exist yet — all allowed.</span>';
  const rows = users
    .map((u) => {
      const statusBadge = u.is_active
        ? '<span class="badge badge-active">active</span>'
        : '<span class="badge badge-archived">inactive</span>';
      const roleBadge = u.is_admin
        ? '<span class="badge badge-admin">admin</span>'
        : '<span class="badge badge-user">user</span>';
      const actions = u.is_active && u.name !== currentUser.name
        ? `
          <form method="POST" action="/users/${encodeURIComponent(u.name)}/reset-token" style="display:inline">
            <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
            <button type="submit" class="btn btn-small btn-ghost">Reset token</button>
          </form>
          <form method="POST" action="/users/${encodeURIComponent(u.name)}/deactivate" style="display:inline" onsubmit="return confirm('Deactivate user ${escapeHtml(u.name)}?')">
            <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
            <button type="submit" class="btn btn-small btn-danger">Deactivate</button>
          </form>`
        : u.name === currentUser.name
        ? '<span class="subtle">that\'s you</span>'
        : u.is_active
        ? `<form method="POST" action="/users/${encodeURIComponent(u.name)}/reset-token" style="display:inline">
            <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
            <button type="submit" class="btn btn-small btn-ghost">Reset token</button>
          </form>`
        : '—';
      return `
        <tr>
          <td class="mono">${escapeHtml(u.name)}</td>
          <td>${roleBadge}</td>
          <td>${statusBadge}</td>
          <td class="mono subtle" style="font-size:0.77rem">${formatDate(u.created_at)}</td>
          <td><div class="actions">${actions}</div></td>
        </tr>`;
    })
    .join('');

  const body = html`
    <h1>Users</h1>
    <p class="subtitle">Manage personal tokens for MCP and the dashboard.</p>

    ${raw(renderFlash(flash))}

    <div class="card">
      <h3>Create new user</h3>
      <form method="POST" action="/users">
        <input type="hidden" name="_csrf" value="${csrfToken}">
        <div class="form-row">
          <div class="form-field">
            <label>Name</label>
            <input type="text" name="name" required maxlength="64" autocomplete="off" pattern="[a-zA-Z0-9_\\.\\-]+" placeholder="alice">
          </div>
          <div class="form-field">
            <label>Role</label>
            <select name="is_admin">
              <option value="false">Standard user</option>
              <option value="true">Admin</option>
            </select>
          </div>
          <div class="form-field">
            <label>Token label</label>
            <input type="text" name="label" maxlength="100" placeholder="e.g. Claude Code, Monitoring" value="default">
          </div>
        </div>
        <div class="form-row" style="margin-top:0.62rem">
          <div class="form-field">
            <label>Token permission</label>
            <select name="scope_permission">
              <option value="write" selected>write (default)</option>
              <option value="read">read (read-only)</option>
              <option value="admin">admin (everything)</option>
            </select>
          </div>
          <div class="form-field">
            <label>Expiry (days, empty = no limit)</label>
            <input type="number" name="expires_in_days" min="1" max="365" placeholder="no limit">
          </div>
          <div style="flex:0 0 auto">
            <button type="submit" class="btn">Create</button>
          </div>
        </div>
        <div style="margin-top:0.62rem">
          <label style="display:block;font-size:0.69rem;font-weight:700;color:var(--color-subtle);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:0.38rem">Allowed contexts (empty = all)</label>
          <div>${raw(contextCheckboxes)}</div>
        </div>
        ${raw(kindCheckboxes ? `<div style="margin-top:0.62rem">
          <label style="display:block;font-size:0.69rem;font-weight:700;color:var(--color-subtle);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:0.38rem">Allowed kinds (empty = all)</label>
          <div>${kindCheckboxes}</div>
        </div>` : '')}
      </form>
    </div>

    <div class="table-wrapper" style="margin-top:1.23rem">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Role</th>
            <th>Status</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>${raw(rows)}</tbody>
      </table>
    </div>
  `;

  return layout({
    title: 'Users',
    body,
    currentUser,
    activePath: '/users',
    csrfToken,
  });
}
