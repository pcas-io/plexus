/**
 * Entity detail page — READ-ONLY, with the single exception of the
 * share-link button.
 *
 * The dashboard is read-only for graph content. There are no edit,
 * archive, link, or unlink buttons here. All mutations to entities and
 * edges happen exclusively via MCP (save_entity, update_entity,
 * archive_entity, link_entities, unlink_entity).
 *
 * The share button is the single sanctioned human write action on
 * entities, per the Kickoff-ADR Abschnitt 4 and Auth-ADR Abschnitt 4.
 * It is guarded by a step-up passkey tap and creates a one-time
 * read-only share link — never via MCP.
 */

import type { Entity } from '../../db/repositories/entities.js';
import type { Edge } from '../../db/repositories/edges.js';
import type { User } from '../../db/repositories/users.js';
import {
  layout,
  html,
  raw,
  escapeHtml,
  formatDate,
  kindBadge,
  contextBadge,
  statusBadge,
} from '../layout.js';
import { renderMarkdown } from '../markdown.js';

interface EntityDetailOptions {
  readonly currentUser: User;
  readonly entity: Entity;
  readonly edges: Array<{ edge: Edge; otherEntity: Entity | null; direction: 'out' | 'in' }>;
  readonly csrfToken: string;
}


/**
 * Very small markdown → HTML. Handles: headings, paragraphs, fenced code,
 * inline code, bold, italic, lists, blockquotes, links. Not a full spec
 * compliant parser, but good enough for ADR-style bodies and matches
 * buddy's visual style.
 */
export function renderEntityDetail(opts: EntityDetailOptions): string {
  const { currentUser, entity, edges, csrfToken } = opts;

  const attrsPre = Object.keys(entity.attributes).length > 0
    ? `<pre style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:0.46rem;padding:12px;font-size:0.77rem;overflow-x:auto;max-width:100%;word-wrap:break-word">${escapeHtml(JSON.stringify(entity.attributes, null, 2))}</pre>`
    : '<p class="subtle">Keine Attributes.</p>';

  const connectionsList = edges.length === 0
    ? '<p class="subtle">Noch keine Verbindungen.</p>'
    : edges
        .map(({ edge, otherEntity, direction }) => {
          const arrow = direction === 'out' ? '→' : '←';
          const otherTitle = otherEntity
            ? `<a href="/entities/${encodeURIComponent(otherEntity.id)}">${escapeHtml(otherEntity.title)}</a>`
            : `<span class="subtle mono">${escapeHtml(direction === 'out' ? edge.to_entity : edge.from_entity)}</span>`;
          const otherKind = otherEntity ? kindBadge(otherEntity.kind) : '';
          return `
            <div style="padding:0.46rem 0;border-bottom:1px solid var(--color-divider);display:flex;align-items:center;gap:8px;font-size:0.85rem">
              <span style="font-family:var(--font-mono);font-size:0.69rem;color:var(--color-subtle);text-transform:uppercase;min-width:120px">${escapeHtml(edge.relation)}</span>
              <span class="subtle">${arrow}</span>
              ${otherKind}
              <span style="flex:1">${otherTitle}</span>
            </div>`;
        })
        .join('');

  // Share button is only offered for non-secret kinds. The click
  // handler runs a step-up WebAuthn flow inline on the page.
  const shareButton = entity.kind === 'secret'
    ? '<span class="subtle" style="font-size:0.77rem">Secrets koennen nicht geteilt werden.</span>'
    : `
        <button type="button" class="btn btn-small" id="plexus-share-btn" data-entity-id="${escapeHtml(entity.id)}">Teilen (Step-Up Passkey)</button>
        <div id="share-status" class="subtle" style="margin-top:0.62rem;font-size:0.85rem;display:none"></div>
        <div id="share-result" class="alert alert-success" style="margin-top:0.77rem;display:none"></div>`;

  // Inline step-up script. Everything here is constructed with DOM
  // APIs (textContent / createElement) so the only HTML we ever assign
  // is the static fragment below — no innerHTML with server values.
  const shareScript = `
<script>
(function(){
  var btn = document.getElementById('plexus-share-btn');
  if (!btn) return;
  var statusEl = document.getElementById('share-status');
  var resultEl = document.getElementById('share-result');

  function b64urlToBytes(str) {
    var s = str.replace(/-/g,'+').replace(/_/g,'/');
    while (s.length % 4) s += '=';
    var bin = atob(s);
    var out = new Uint8Array(bin.length);
    for (var i=0;i<bin.length;i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToB64url(buf) {
    var bytes = new Uint8Array(buf);
    var s = '';
    for (var i=0;i<bytes.length;i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=/g,'');
  }
  function csrf() {
    var c = document.cookie.split('; ').find(function(r){return r.indexOf('plexus_csrf=')===0});
    return c ? c.split('=')[1] : '';
  }
  function showStatus(msg) {
    statusEl.style.display = 'block';
    statusEl.textContent = msg;
    resultEl.style.display = 'none';
  }
  function showError(msg) {
    statusEl.style.display = 'none';
    resultEl.style.display = 'block';
    resultEl.className = 'alert alert-danger';
    resultEl.textContent = 'Fehler: ' + msg;
  }
  // Copy helper with visual "Kopiert!" feedback. Uses the Clipboard API
  // (requires a secure context — we are on HTTPS in production). Falls back
  // to text-selection for older browsers so the user can Cmd/Ctrl+C manually.
  function copyToClipboard(text, btn) {
    function flash() {
      var original = btn.getAttribute('data-original-label') || btn.textContent;
      btn.setAttribute('data-original-label', original);
      btn.textContent = 'Kopiert';
      btn.classList.add('copied');
      setTimeout(function() {
        btn.textContent = original;
        btn.classList.remove('copied');
      }, 1500);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(flash).catch(function() {
        // Clipboard denied (permission, iframe, etc.) — fall back to selection.
        var urlEl = btn.parentNode.querySelector('.share-link-url');
        if (urlEl) {
          var range = document.createRange();
          range.selectNodeContents(urlEl);
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
        btn.textContent = 'Markiert — Cmd+C';
      });
    } else {
      var urlEl2 = btn.parentNode.querySelector('.share-link-url');
      if (urlEl2) {
        var range2 = document.createRange();
        range2.selectNodeContents(urlEl2);
        var sel2 = window.getSelection();
        sel2.removeAllRanges();
        sel2.addRange(range2);
      }
      btn.textContent = 'Markiert — Cmd+C';
    }
  }

  // Build one share-link row: label + boxed URL + copy button.
  function buildLinkRow(labelText, sublabelText, url) {
    var row = document.createElement('div');
    row.className = 'share-link-row';

    var labelWrap = document.createElement('div');
    labelWrap.className = 'share-link-row-label';
    var strong = document.createElement('strong');
    strong.textContent = labelText;
    labelWrap.appendChild(strong);
    var sub = document.createElement('span');
    sub.textContent = sublabelText;
    labelWrap.appendChild(sub);
    row.appendChild(labelWrap);

    var box = document.createElement('div');
    box.className = 'share-link-box';

    var urlEl = document.createElement('code');
    urlEl.className = 'share-link-url';
    urlEl.textContent = url;
    box.appendChild(urlEl);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'share-copy-btn';
    btn.textContent = 'Kopieren';
    btn.addEventListener('click', function() {
      copyToClipboard(url, btn);
    });
    box.appendChild(btn);

    row.appendChild(box);
    return row;
  }

  function showSuccess(url, expiresAt) {
    statusEl.style.display = 'none';
    resultEl.style.display = 'block';
    resultEl.className = 'alert alert-success';
    // Build DOM nodes — never assign url via innerHTML.
    while (resultEl.firstChild) resultEl.removeChild(resultEl.firstChild);

    var strong = document.createElement('strong');
    strong.textContent = 'Share-Link erstellt';
    resultEl.appendChild(strong);

    var note = document.createElement('p');
    note.className = 'muted';
    note.style.margin = '8px 0 12px';
    note.textContent = 'Nur einmal verwendbar. Drei Varianten fuer Mensch, LLM und CLI — alle teilen denselben Token, nur das Format unterscheidet sich.';
    resultEl.appendChild(note);

    // Build the three URL variants by appending the query params documented
    // in src/ui/pages/shared_entity_formats.ts. The server picks the output
    // format based on which of ?raw, ?raw=json, or ?format= is set.
    var urlMd = url + (url.indexOf('?') === -1 ? '?' : '&') + 'raw';
    var urlJson = url + (url.indexOf('?') === -1 ? '?' : '&') + 'raw=json';

    resultEl.appendChild(buildLinkRow('HTML', 'Browser, Dashboard-Layout', url));
    resultEl.appendChild(buildLinkRow('Markdown', 'LLM / Terminal (glow)', urlMd));
    resultEl.appendChild(buildLinkRow('JSON', 'CLI / jq / Pipes', urlJson));

    var meta = document.createElement('p');
    meta.className = 'subtle';
    meta.style.fontSize = '0.77rem';
    meta.style.marginTop = '0.77rem';
    meta.textContent = 'Ablauf: ' + expiresAt;
    resultEl.appendChild(meta);
  }

  btn.addEventListener('click', async function() {
    var entityId = btn.getAttribute('data-entity-id');
    btn.disabled = true;
    try {
      showStatus('Passkey-Challenge wird geladen...');
      var startRes = await fetch('/shares/step-up/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Csrf-Token': csrf() },
        body: JSON.stringify({ entity_id: entityId }),
      });
      if (!startRes.ok) {
        var err = await startRes.json().catch(function(){return {error: String(startRes.status)}});
        showError(err.message || err.error || String(startRes.status));
        return;
      }
      var startData = await startRes.json();
      showStatus('Bitte Passkey bestaetigen...');
      var publicKey = startData.options;
      publicKey.challenge = b64urlToBytes(publicKey.challenge);
      if (publicKey.allowCredentials) {
        publicKey.allowCredentials = publicKey.allowCredentials.map(function(cred) {
          return Object.assign({}, cred, { id: b64urlToBytes(cred.id) });
        });
      }
      var credential = await navigator.credentials.get({ publicKey: publicKey });
      var authResponse = {
        id: credential.id,
        rawId: bytesToB64url(credential.rawId),
        type: credential.type,
        response: {
          authenticatorData: bytesToB64url(credential.response.authenticatorData),
          clientDataJSON: bytesToB64url(credential.response.clientDataJSON),
          signature: bytesToB64url(credential.response.signature),
          userHandle: credential.response.userHandle ? bytesToB64url(credential.response.userHandle) : null,
        },
        clientExtensionResults: credential.getClientExtensionResults ? credential.getClientExtensionResults() : {},
      };
      var finishRes = await fetch('/shares/step-up/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Csrf-Token': csrf() },
        body: JSON.stringify({ entity_id: entityId, response: authResponse }),
      });
      if (!finishRes.ok) {
        var err2 = await finishRes.json().catch(function(){return {error: String(finishRes.status)}});
        showError(err2.message || err2.error || String(finishRes.status));
        return;
      }
      var finishData = await finishRes.json();
      showSuccess(finishData.share.url, finishData.share.expires_at);
    } catch (err) {
      showError(err && err.message ? err.message : String(err));
    } finally {
      btn.disabled = false;
    }
  });
})();
</script>`;

  const body = html`
    <div style="font-size:0.77rem;color:var(--color-subtle);margin-bottom:0.62rem;overflow-wrap:anywhere;word-break:break-all">
      <a href="/entities">Entities</a> / <span class="mono">${entity.id}</span>
    </div>

    <h1 style="overflow-wrap:anywhere;word-wrap:break-word">${entity.title}</h1>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:1.23rem;max-width:100%">
      ${raw(kindBadge(entity.kind))}
      ${raw(contextBadge(entity.context))}
      ${raw(statusBadge(entity.status))}
      <span class="tag mono">v${entity.version}</span>
      <span class="tag">updated ${formatDate(entity.updated_at)}</span>
    </div>

    <div class="grid">
      <div>
        <h2>Body</h2>
        <div class="markdown-content card" style="overflow-wrap:anywhere;max-width:100%">
          ${raw(entity.body ? renderMarkdown(entity.body) : '<p class="subtle">Kein Body.</p>')}
        </div>

        <h2>Attributes</h2>
        <div class="card" style="overflow-wrap:anywhere;max-width:100%">${raw(attrsPre)}</div>
      </div>
      <div>
        <h2>Teilen</h2>
        <div class="card">
          <p class="subtle" style="font-size:0.85rem;margin-bottom:0.62rem">Erstellt einen einmaligen Read-Only-Link. Step-Up-Passkey erforderlich.</p>
          ${raw(shareButton)}
        </div>

        <h2>Verbindungen (${edges.length})</h2>
        <div class="card">${raw(connectionsList)}</div>
      </div>
    </div>
    ${raw(shareScript)}
  `;

  return layout({
    title: entity.title,
    body,
    currentUser,
    activePath: '/entities',
    csrfToken,
  });
}
