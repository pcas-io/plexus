/**
 * Bootstrap page — initial admin creation after admin-token login.
 * Matches buddy's login-box styling.
 */

import { layout, escapeHtml } from '../layout.js';

interface BootstrapOptions {
  readonly csrfToken: string;
  readonly flash?: { type: 'success' | 'danger'; message: string; token?: string };
}

export function renderBootstrapPage({ csrfToken, flash }: BootstrapOptions): string {
  const flashHtml = flash?.token
    ? `
      <div class="info" style="text-align:left">
        <div style="font-weight:600;margin-bottom:4px">${escapeHtml(flash.message)}</div>
        <div class="subtle" style="font-size:0.77rem;margin-bottom:8px">Speichere diesen Token JETZT — er wird nie wieder angezeigt.</div>
        <div class="token-box">${escapeHtml(flash.token)}</div>
      </div>
      <form method="POST" action="/bootstrap/continue" style="margin-top:12px">
        <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
        <button type="submit">Weiter zum Login</button>
      </form>`
    : flash
    ? `<div class="error">${escapeHtml(flash.message)}</div>`
    : '';

  const form = !flash?.token
    ? `
      <form method="POST" action="/bootstrap">
        <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
        <label>Admin-Name</label>
        <input type="text" name="name" required autofocus autocomplete="off" maxlength="64" pattern="[a-zA-Z0-9_\\.\\-]+" placeholder="admin">
        <button type="submit">Admin anlegen</button>
      </form>`
    : '';

  const body = `
<div class="login-page">
  <div class="login-box">
    <h1>plexus</h1>
    <div class="login-hint">Admin-Bootstrap (einmaliger Setup)</div>
    <div class="info" style="font-size:0.77rem;text-align:left">
      Nach dem Anlegen des ersten Admin-Users wird der <code>PLEXUS_ADMIN_TOKEN</code> nur noch fuer User-Management akzeptiert, nicht fuer Dashboard-Login oder MCP.
    </div>
    ${flashHtml}
    ${form}
  </div>
</div>`;

  return layout({ title: 'Bootstrap', body });
}
