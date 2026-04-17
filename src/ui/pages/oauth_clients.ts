/**
 * OAuth Client Management page — /oauth/clients.
 *
 * Shows the user which OAuth clients (e.g. claude.ai) they have
 * granted access to, with a revoke button per client.
 */

import type { User } from '../../db/repositories/users.js';
import type { OAuthClient } from '../../db/repositories/oauth.js';
import {
  layout,
  html,
  raw,
  escapeHtml,
  formatDate,
} from '../layout.js';

interface GrantedClient {
  readonly client: OAuthClient;
  readonly activeTokens: number;
  readonly lastUsedAt: string | null;
  readonly grantedAt: string;
}

interface OAuthClientsOptions {
  readonly currentUser: User;
  readonly grants: GrantedClient[];
  readonly csrfToken: string;
}

export function renderOAuthClients(opts: OAuthClientsOptions): string {
  const { currentUser, grants, csrfToken } = opts;

  const rows = grants.length === 0
    ? '<tr><td colspan="5" class="empty">No authorised OAuth clients. Connect a client (e.g. claude.ai) via the MCP endpoint.</td></tr>'
    : grants.map((g) => {
        let redirectOrigin = g.client.redirect_uris[0] ?? '—';
        try { redirectOrigin = new URL(redirectOrigin).origin; } catch { /* keep raw */ }
        return `
          <tr>
            <td>
              <div style="font-weight:600;color:var(--color-ink)">${escapeHtml(g.client.client_name)}</div>
              <div class="subtle" style="font-size:0.77rem">${escapeHtml(redirectOrigin)}</div>
            </td>
            <td class="mono" style="font-size:0.77rem">${escapeHtml(formatDate(g.grantedAt))}</td>
            <td class="mono" style="font-size:0.77rem">${g.lastUsedAt ? escapeHtml(formatDate(g.lastUsedAt)) : '<span class="subtle">never</span>'}</td>
            <td style="text-align:center"><span class="tag mono">${g.activeTokens}</span></td>
            <td>
              <form method="POST" action="/oauth/clients/${encodeURIComponent(g.client.id)}/revoke" style="display:inline">
                <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
                <button type="submit" class="btn btn-small btn-ghost" onclick="return confirm('Revoke all tokens for this client?')">Revoke</button>
              </form>
            </td>
          </tr>`;
      }).join('');

  const body = html`
    <h1>OAuth clients</h1>
    <p class="subtitle">External applications that can access your plexus knowledge graph. You can revoke access at any time.</p>

    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Client</th>
            <th>Authorised</th>
            <th>Last access</th>
            <th style="text-align:center">Tokens</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>${raw(rows)}</tbody>
      </table>
    </div>

    <div class="subtle" style="margin-top:1.54rem;font-size:0.85rem">
      <p>Clients register automatically on their first connection to the MCP endpoint (<span class="mono">/mcp</span>). Revocation immediately invalidates the client's access and refresh tokens for your account.</p>
    </div>
  `;

  return layout({
    title: 'OAuth clients',
    body,
    currentUser,
    activePath: '/oauth/clients',
    csrfToken,
  });
}
