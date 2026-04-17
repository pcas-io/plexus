/**
 * Login page — matches buddy's .login-page .login-box pattern.
 */

import { layout, escapeHtml } from '../layout.js';

interface LoginPageOptions {
  readonly csrfToken: string;
  readonly errorMessage?: string;
  readonly mode?: 'initial' | 'passkey' | 'enroll';
  readonly hint?: string;
}

const WEBAUTHN_CLIENT_JS = `
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
async function postJson(url, body) {
  var csrf = (document.cookie.split('; ').find(function(c){return c.indexOf('plexus_csrf=')===0;}) || '').split('=')[1] || '';
  var r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Csrf-Token': csrf },
    body: JSON.stringify(body || {}),
    credentials: 'same-origin',
  });
  var data = await r.json();
  if (!r.ok) throw new Error(data.error || data.message || 'Request failed');
  return data;
}
async function doEnrollPasskey() {
  var opts = await postJson('/auth/passkey/enroll/start', {});
  var publicKey = Object.assign({}, opts, {
    challenge: b64urlToBytes(opts.challenge),
    user: Object.assign({}, opts.user, { id: b64urlToBytes(opts.user.id) }),
    excludeCredentials: (opts.excludeCredentials || []).map(function(c){return Object.assign({}, c, {id: b64urlToBytes(c.id)});}),
  });
  var cred = await navigator.credentials.create({ publicKey: publicKey });
  if (!cred) throw new Error('No credential returned');
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
    authenticatorAttachment: cred.authenticatorAttachment || null,
  };
  return await postJson('/auth/passkey/enroll/finish', { response: response });
}
async function doPasskeyAuth() {
  var opts = await postJson('/auth/passkey/auth/start', {});
  var publicKey = Object.assign({}, opts, {
    challenge: b64urlToBytes(opts.challenge),
    allowCredentials: (opts.allowCredentials || []).map(function(c){return Object.assign({}, c, {id: b64urlToBytes(c.id)});}),
  });
  var cred = await navigator.credentials.get({ publicKey: publicKey });
  if (!cred) throw new Error('No credential returned');
  var response = {
    id: cred.id,
    rawId: bytesToB64url(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: bytesToB64url(cred.response.clientDataJSON),
      authenticatorData: bytesToB64url(cred.response.authenticatorData),
      signature: bytesToB64url(cred.response.signature),
      userHandle: cred.response.userHandle ? bytesToB64url(cred.response.userHandle) : null,
    },
    clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
    authenticatorAttachment: cred.authenticatorAttachment || null,
  };
  return await postJson('/auth/passkey/auth/finish', { response: response });
}
`;

export function renderLoginPage(opts: LoginPageOptions): string {
  const { csrfToken, errorMessage, mode = 'initial', hint } = opts;
  const title = mode === 'enroll' ? 'Passkey registrieren' : mode === 'passkey' ? 'Passkey bestaetigen' : 'Anmelden';

  let inner = '';
  if (mode === 'initial') {
    inner = `
      <form method="POST" action="/auth/login">
        <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
        <label>Personal Token oder Admin Token</label>
        <input type="password" name="token" required autocomplete="off" autofocus spellcheck="false" placeholder="pt_... oder admin token">
        <button type="submit">Continue</button>
      </form>`;
  } else if (mode === 'passkey') {
    inner = `
      <div class="info">Bitte jetzt Passkey tippen.</div>
      <button type="button" id="passkey-auth">Mit Passkey anmelden</button>
      <div id="auth-error" class="error" style="display:none"></div>
      <form method="POST" action="/auth/logout" style="margin-top:12px">
        <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
        <button type="submit" class="btn-ghost">Abbrechen</button>
      </form>`;
  } else {
    inner = `
      <div class="info">Vor dem ersten Login wird ein Passkey registriert. Der Passkey bleibt an dieses Geraet gebunden (Touch-ID, Face-ID, Windows Hello, YubiKey).</div>
      <button type="button" id="passkey-enroll">Passkey jetzt registrieren</button>
      <div id="enroll-error" class="error" style="display:none"></div>`;
  }

  const body = `
<div class="login-page">
  <div class="login-box">
    <h1>plexus</h1>
    <div class="login-hint">${escapeHtml(hint ?? title)}</div>
    ${errorMessage ? `<div class="error">${escapeHtml(errorMessage)}</div>` : ''}
    ${inner}
  </div>
</div>
<script>
${WEBAUTHN_CLIENT_JS}
var enrollBtn = document.getElementById('passkey-enroll');
if (enrollBtn) {
  enrollBtn.addEventListener('click', async function() {
    var err = document.getElementById('enroll-error');
    err.style.display = 'none';
    try {
      enrollBtn.disabled = true;
      enrollBtn.textContent = 'Warte auf Passkey...';
      var res = await doEnrollPasskey();
      if (res.newToken) {
        // Token was rotated on first enrollment — show the new one
        // before redirecting. The old invitation token is now dead.
        var box = document.querySelector('.login-box');
        while (box.firstChild) box.removeChild(box.firstChild);
        var h = document.createElement('h1'); h.textContent = 'plexus'; box.appendChild(h);
        var hint = document.createElement('div'); hint.className = 'login-hint';
        hint.textContent = 'Passkey registriert. Dein neuer Token:'; box.appendChild(hint);
        var info = document.createElement('div'); info.className = 'info';
        info.textContent = 'Der initiale Token wurde entwertet. Speichere diesen neuen Token jetzt — er wird nie wieder angezeigt.';
        box.appendChild(info);
        var tokenBox = document.createElement('div');
        tokenBox.style.cssText = 'background:var(--color-surface);border:1px dashed var(--color-mid);border-radius:0.46rem;padding:0.92rem;font-family:var(--font-mono);font-size:0.92rem;word-break:break-all;color:var(--color-ink);margin:0.62rem 0;user-select:all';
        tokenBox.textContent = res.newToken;
        box.appendChild(tokenBox);
        var cont = document.createElement('button');
        cont.textContent = 'Mit neuem Token einloggen';
        cont.addEventListener('click', function() { window.location.href = '/auth/login'; });
        box.appendChild(cont);
      } else {
        if (res.redirect) window.location.href = res.redirect;
        else window.location.reload();
      }
    } catch (e) {
      err.textContent = e.message || 'Fehler bei der Registrierung';
      err.style.display = 'block';
      enrollBtn.disabled = false;
      enrollBtn.textContent = 'Erneut versuchen';
    }
  });
}
var authBtn = document.getElementById('passkey-auth');
if (authBtn) {
  var tryAuth = async function() {
    var err = document.getElementById('auth-error');
    err.style.display = 'none';
    try {
      authBtn.disabled = true;
      authBtn.textContent = 'Warte auf Passkey...';
      var res = await doPasskeyAuth();
      if (res.redirect) window.location.href = res.redirect;
      else window.location.reload();
    } catch (e) {
      err.textContent = e.message || 'Fehler bei der Authentifizierung';
      err.style.display = 'block';
      authBtn.disabled = false;
      authBtn.textContent = 'Erneut versuchen';
    }
  };
  authBtn.addEventListener('click', tryAuth);
  setTimeout(tryAuth, 300);
}
</script>`;

  // layout helpers are html``-based; use raw() for the body we built.
  return layout({
    title,
    body,
  });
}
