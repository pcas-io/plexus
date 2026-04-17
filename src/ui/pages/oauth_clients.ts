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
    ? '<tr><td colspan="5" class="empty">Keine autorisierten OAuth-Clients. Verbinde einen Client (z.B. claude.ai) ueber den MCP-Endpoint.</td></tr>'
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
            <td class="mono" style="font-size:0.77rem">${g.lastUsedAt ? escapeHtml(formatDate(g.lastUsedAt)) : '<span class="subtle">nie</span>'}</td>
            <td style="text-align:center"><span class="tag mono">${g.activeTokens}</span></td>
            <td>
              <form method="POST" action="/oauth/clients/${encodeURIComponent(g.client.id)}/revoke" style="display:inline">
                <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
                <button type="submit" class="btn btn-small btn-ghost" onclick="return confirm('Alle Tokens fuer diesen Client widerrufen?')">Widerrufen</button>
              </form>
            </td>
          </tr>`;
      }).join('');

  const body = html`
    <h1>OAuth-Clients</h1>
    <p class="subtitle">Externe Anwendungen die auf deinen plexus Knowledge Graph zugreifen. Du kannst den Zugriff jederzeit widerrufen.</p>

    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Client</th>
            <th>Autorisiert</th>
            <th>Letzter Zugriff</th>
            <th style="text-align:center">Tokens</th>
            <th>Aktion</th>
          </tr>
        </thead>
        <tbody>${raw(rows)}</tbody>
      </table>
    </div>

    <div class="subtle" style="margin-top:1.54rem;font-size:0.85rem">
      <p>Clients registrieren sich automatisch beim ersten Verbindungsversuch ueber den MCP-Endpoint (<span class="mono">/mcp</span>). Widerruf entzieht sofort alle Access- und Refresh-Tokens des Clients fuer deinen Account.</p>
    </div>
  `;

  return layout({
    title: 'OAuth-Clients',
    body,
    currentUser,
    activePath: '/oauth/clients',
    csrfToken,
  });
}
