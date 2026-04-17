/**
 * Passkey management page — /passkeys.
 *
 * Users can see their registered passkeys, add new ones (up to 3),
 * and delete backups (the last one cannot be deleted).
 */

import type { User } from '../../db/repositories/users.js';
import type { Passkey } from '../../db/repositories/passkeys.js';
import {
  layout,
  html,
  raw,
  escapeHtml,
  formatDate,
  renderFlash,
} from '../layout.js';

interface PasskeysPageOptions {
  readonly currentUser: User;
  readonly passkeys: Passkey[];
  readonly csrfToken: string;
  readonly flash?: { type: 'success' | 'danger' | 'info'; message: string };
}

const MAX_PASSKEYS = 3;

const ENROLL_SCRIPT = `
function b64urlToBytes(s) {
  var pad = '='.repeat((4 - (s.length % 4)) % 4);
  var b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  var bin = atob(b64);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function bytesToB64url(bytes) {
  var bin = String.fromCharCode.apply(null, new Uint8Array(bytes));
  return btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
}
async function addPasskey() {
  var status = document.getElementById('enroll-status');
  var csrf = (document.cookie.split('; ').find(function(c){return c.indexOf('plexus_csrf=')===0;}) || '').split('=')[1] || '';
  status.textContent = 'Challenge wird geladen...';
  status.style.display = 'block';
  status.className = 'info';
  try {
    var r1 = await fetch('/passkeys/enroll/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Csrf-Token': csrf },
      credentials: 'same-origin'
    });
    if (!r1.ok) { var e = await r1.json(); throw new Error(e.message || e.error || r1.status); }
    var opts = await r1.json();
    var publicKey = Object.assign({}, opts, {
      challenge: b64urlToBytes(opts.challenge),
      user: Object.assign({}, opts.user, { id: b64urlToBytes(opts.user.id) }),
      excludeCredentials: (opts.excludeCredentials || []).map(function(c){return Object.assign({}, c, {id: b64urlToBytes(c.id)});}),
    });
    status.textContent = 'Bitte Passkey bestaetigen...';
    var cred = await navigator.credentials.create({ publicKey: publicKey });
    if (!cred) throw new Error('Abgebrochen');
    var response = {
      id: cred.id,
      rawId: bytesToB64url(cred.rawId),
      type: cred.type,
      response: {
        clientDataJSON: bytesToB64url(cred.response.clientDataJSON),
        attestationObject: bytesToB64url(cred.response.attestationObject),
        transports: cred.response.getTransports ? cred.response.getTransports() : [],
      },
      clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
    };
    var r2 = await fetch('/passkeys/enroll/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Csrf-Token': csrf },
      body: JSON.stringify({ response: response }),
      credentials: 'same-origin'
    });
    if (!r2.ok) { var e2 = await r2.json(); throw new Error(e2.message || e2.error || r2.status); }
    window.location.reload();
  } catch (err) {
    status.textContent = 'Fehler: ' + (err.message || err);
    status.className = 'error';
  }
}
`;

export function renderPasskeysPage(opts: PasskeysPageOptions): string {
  const { currentUser, passkeys, csrfToken, flash } = opts;
  const canAdd = passkeys.length < MAX_PASSKEYS;
  const canDelete = passkeys.length > 1;

  const rows = passkeys.length === 0
    ? '<tr><td colspan="4" class="empty">Keine Passkeys registriert.</td></tr>'
    : passkeys.map((p) => {
        const ua = p.device_name ?? '—';
        const shortUa = ua.length > 50 ? ua.slice(0, 50) + '...' : ua;
        return `
          <tr>
            <td class="mono" style="font-size:0.77rem">${escapeHtml(p.credential_id.slice(0, 16))}...</td>
            <td style="font-size:0.85rem" title="${escapeHtml(ua)}">${escapeHtml(shortUa)}</td>
            <td class="mono" style="font-size:0.77rem">${formatDate(p.created_at)}</td>
            <td class="mono" style="font-size:0.77rem">${p.last_used_at ? formatDate(p.last_used_at) : '<span class="subtle">nie</span>'}</td>
            <td>
              ${canDelete
                ? `<form method="POST" action="/passkeys/${encodeURIComponent(p.credential_id)}/delete" style="display:inline">
                    <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
                    <button type="submit" class="btn btn-small btn-ghost" onclick="return confirm('Passkey entfernen?')">Entfernen</button>
                  </form>`
                : '<span class="subtle" style="font-size:0.77rem">letzter</span>'}
            </td>
          </tr>`;
      }).join('');

  const body = html`
    <h1>Passkeys</h1>
    <p class="subtitle">Verwalte deine registrierten Passkeys. Mindestens einer muss aktiv bleiben, maximal ${MAX_PASSKEYS}.</p>

    ${raw(renderFlash(flash))}

    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Credential-ID</th>
            <th>Geraet</th>
            <th>Erstellt</th>
            <th>Zuletzt benutzt</th>
            <th>Aktion</th>
          </tr>
        </thead>
        <tbody>${raw(rows)}</tbody>
      </table>
    </div>

    ${raw(canAdd
      ? `<div class="card" style="margin-top:1.23rem">
          <h3>Passkey hinzufuegen</h3>
          <p class="subtle" style="font-size:0.85rem;margin-bottom:0.62rem">Registriere einen zusaetzlichen Passkey als Backup (z.B. anderes Geraet, YubiKey). Max ${MAX_PASSKEYS} pro Account.</p>
          <button type="button" class="btn" onclick="addPasskey()">Neuen Passkey registrieren</button>
          <div id="enroll-status" style="margin-top:0.62rem;display:none"></div>
        </div>
        <script>${ENROLL_SCRIPT}</script>`
      : `<div class="card" style="margin-top:1.23rem">
          <p class="subtle">Maximum von ${MAX_PASSKEYS} Passkeys erreicht. Entferne einen bestehenden um einen neuen zu registrieren.</p>
        </div>`)}
  `;

  return layout({
    title: 'Passkeys',
    body,
    currentUser,
    activePath: '/passkeys',
    csrfToken,
  });
}
