/**
 * OAuth 2.1 consent screen — rendered by GET /oauth/authorize.
 *
 * Shows the requesting client, the redirect target, the scope, and
 * two buttons (Zulassen / Abbrechen). Submits back to POST
 * /oauth/authorize with the original request parameters preserved as
 * hidden fields so the decision handler can re-validate them.
 */

import type { User } from '../../db/repositories/users.js';
import type { OAuthClient } from '../../db/repositories/oauth.js';
import { layout, html, raw, escapeHtml } from '../layout.js';

interface ConsentOptions {
  readonly currentUser: User;
  readonly client: OAuthClient;
  readonly redirectUri: string;
  readonly scope: string;
  readonly state: string;
  readonly codeChallenge: string;
  readonly resource: string;
  readonly csrfToken: string;
}

export function renderOAuthConsent(opts: ConsentOptions): string {
  const { currentUser, client, redirectUri, scope, state, codeChallenge, resource, csrfToken } = opts;

  // Show just the origin of the redirect URI to the user — the full
  // path is rarely meaningful and the origin is what matters for
  // trust.
  let redirectOrigin = redirectUri;
  try {
    redirectOrigin = new URL(redirectUri).origin;
  } catch {
    // keep the raw string if it does not parse
  }

  const scopeItems = scope
    .split(/\s+/)
    .filter(Boolean)
    .map((s) => `<li class="mono">${escapeHtml(s)}</li>`)
    .join('');

  const body = html`
    <div style="max-width:560px;margin:3rem auto;padding:0 1.23rem">
      <div style="font-size:0.69rem;color:var(--color-subtle);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:0.46rem">
        plexus · oauth · zustimmung
      </div>
      <h1 style="margin-bottom:0.77rem">Zugriff erlauben?</h1>
      <p class="subtitle">
        <strong>${escapeHtml(client.client_name)}</strong> moechte auf deinen plexus Knowledge Graph zugreifen.
      </p>

      <div class="card" style="margin-bottom:1.23rem">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:0.62rem">
          <span class="subtle" style="font-size:0.69rem;text-transform:uppercase;letter-spacing:0.1em">Client</span>
          <span class="mono" style="font-size:0.77rem">${escapeHtml(client.client_id.slice(0, 24))}…</span>
        </div>
        <div style="font-weight:600;font-size:1rem;color:var(--color-ink);margin-bottom:0.31rem">${escapeHtml(client.client_name)}</div>
        <div class="subtle" style="font-size:0.85rem">
          Leitet nach erfolgreicher Zustimmung weiter an<br>
          <span class="mono" style="font-size:0.77rem;word-break:break-all;color:var(--color-mid)">${escapeHtml(redirectOrigin)}</span>
        </div>
      </div>

      <div class="card" style="margin-bottom:1.23rem">
        <div class="subtle" style="font-size:0.69rem;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:0.46rem">Angefragte Berechtigungen</div>
        <ul style="list-style:none;padding:0;margin:0">
          ${raw(scopeItems)}
        </ul>
        <p class="subtle" style="font-size:0.85rem;margin-top:0.62rem">
          Der Client kann im Namen von <strong class="mono">${escapeHtml(currentUser.name)}</strong> Entities lesen, anlegen, verknuepfen und archivieren. Share-Links, User-Management und Sessions sind ausgeschlossen.
        </p>
      </div>

      <div class="card" style="margin-bottom:1.23rem">
        <div class="subtle" style="font-size:0.69rem;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:0.46rem">Token-Lifetime</div>
        <p style="font-size:0.85rem;color:var(--color-body);margin:0">
          Access-Token: 1 Stunde · Refresh-Token: 30 Tage · Widerrufbar jederzeit ueber <span class="mono">/oauth/revoke</span> oder die Sessions-Seite.
        </p>
      </div>

      <form method="POST" action="/oauth/authorize" style="display:flex;gap:0.62rem;flex-direction:column">
        <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
        <input type="hidden" name="client_id" value="${escapeHtml(client.client_id)}">
        <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}">
        <input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}">
        <input type="hidden" name="scope" value="${escapeHtml(scope)}">
        <input type="hidden" name="state" value="${escapeHtml(state)}">
        <input type="hidden" name="resource" value="${escapeHtml(resource)}">

        <button type="submit" name="decision" value="allow" class="btn" style="padding:0.77rem">Zulassen</button>
        <button type="submit" name="decision" value="deny" class="btn btn-ghost" style="padding:0.77rem">Abbrechen</button>
      </form>

      <p class="subtle" style="font-size:0.77rem;margin-top:1.54rem;text-align:center">
        Du bist angemeldet als <strong class="mono">${escapeHtml(currentUser.name)}</strong>. Alle Token werden an diese User-Identitaet gebunden.
      </p>
    </div>
  `;

  return layout({
    title: `Zugriff erlauben — ${client.client_name}`,
    body,
    // Intentionally no nav bar — the consent screen should look like
    // a focused modal, not a dashboard page.
  });
}
