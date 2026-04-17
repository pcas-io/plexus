/**
 * Layout + HTML primitives for plexus, mirroring buddy's design language.
 *
 * Light-default theme, dark-theme toggle via [data-theme="dark"]
 * attribute on <html>, S/M/L zoom via font-size on <html>. Both
 * preferences persist in localStorage under plexus-theme and
 * plexus-zoom.
 */

import { CSS } from './styles.js';

export function escapeHtml(input: unknown): string {
  if (input === null || input === undefined) return '';
  const str = String(input);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Template literal tag that escapes interpolated values but leaves
 *  the static parts raw. Arrays are joined without separator. Wrapped
 *  `raw()` values bypass escaping. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = strings[0] ?? '';
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value && typeof value === 'object' && '__raw' in value) {
      out += (value as { __raw: string }).__raw;
    } else if (Array.isArray(value)) {
      out += value.join('');
    } else if (value === false || value === null || value === undefined) {
      // skip — common pattern for conditional rendering
    } else {
      out += escapeHtml(value);
    }
    out += strings[i + 1] ?? '';
  }
  return out;
}

export function raw(str: string): { __raw: string } {
  return { __raw: str };
}

// Inline script: sets theme before first paint to avoid FOUC.
// Font size is fixed at 18px (was "L"), zoom picker removed.
const INIT_SCRIPT = `
(function(){
  var t = localStorage.getItem('plexus-theme');
  if (!t) t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
  document.documentElement.style.fontSize = '18px';
})();
`;

const UI_SCRIPT = `
(function(){
  window.toggleTheme = function() {
    var current = document.documentElement.getAttribute('data-theme');
    var next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('plexus-theme', next);
    var moon = document.getElementById('theme-moon');
    var sun = document.getElementById('theme-sun');
    if (moon) moon.style.display = next === 'dark' ? 'none' : 'block';
    if (sun) sun.style.display = next === 'dark' ? 'block' : 'none';
  };
  var theme = document.documentElement.getAttribute('data-theme') || 'light';
  var moon = document.getElementById('theme-moon');
  var sun = document.getElementById('theme-sun');
  if (moon) moon.style.display = theme === 'dark' ? 'none' : 'block';
  if (sun) sun.style.display = theme === 'dark' ? 'block' : 'none';
  var toggle = document.querySelector('.nav-toggle');
  if (toggle) {
    toggle.addEventListener('click', function() {
      var links = document.querySelector('.nav-links');
      if (links) links.classList.toggle('open');
    });
  }
})();
`;

// ---------- Command Palette (Cmd+K / Ctrl+K) ----------
//
// Global quick-nav overlay. Only injected into authenticated pages —
// unauthenticated routes (login, bootstrap) omit the container so the
// shortcut has no effect there. Script is inline to avoid an extra
// round trip.
//
// XSS safety: every result row is built via document.createElement +
// Element.textContent / Node.appendChild. The only HTML fragments that
// are written as text come from SurrealDB's search::highlight() which
// wraps matched tokens in the exact strings '<mark>' and '</mark>'
// around otherwise plain text. The client-side highlightTitle()
// function reconstructs that structure using real DOM <mark> elements,
// so no untrusted HTML ever reaches innerHTML.

const CMDK_HTML = `
<div class="cmdk-backdrop" id="cmdk-backdrop" role="dialog" aria-modal="true" aria-hidden="true" aria-label="Command Palette">
  <div class="cmdk-panel" role="combobox" aria-expanded="true">
    <div class="cmdk-input-wrap">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input id="cmdk-input" class="cmdk-input" type="text" placeholder="Suche Entities im ganzen Graph…" autocomplete="off" spellcheck="false" aria-label="Global search">
      <span class="cmdk-hint">ESC</span>
    </div>
    <div id="cmdk-results" class="cmdk-results" role="listbox"></div>
    <div class="cmdk-footer">
      <span><kbd>↑</kbd><kbd>↓</kbd> Navigation · <kbd>↵</kbd> Öffnen</span>
      <span><kbd>⌘</kbd><kbd>K</kbd> oder <kbd>Ctrl</kbd><kbd>K</kbd></span>
    </div>
  </div>
</div>
`;

const CMDK_SCRIPT = `
(function(){
  var backdrop = document.getElementById('cmdk-backdrop');
  if (!backdrop) return;
  var input = document.getElementById('cmdk-input');
  var list = document.getElementById('cmdk-results');
  var state = { results: [], activeIdx: 0, timer: null, reqId: 0 };

  function badgeClass(value) {
    return 'badge-' + String(value || '').toLowerCase().replace(/[^a-z_-]/g, '');
  }

  // Build an in-memory <span> tree from the server-provided title,
  // which may contain the literal strings '<mark>' and '</mark>' around
  // matched tokens. Everything is appended as textContent so no HTML
  // can escape into the DOM; the <mark> elements are real DOM nodes
  // created via createElement.
  function titleNode(raw) {
    var span = document.createElement('span');
    span.className = 'cmdk-result-title';
    var text = String(raw == null ? '' : raw);
    var parts = text.split(/(<mark>|<\\/mark>)/g);
    var inside = false;
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === '<mark>') { inside = true; continue; }
      if (parts[i] === '</mark>') { inside = false; continue; }
      if (!parts[i]) continue;
      if (inside) {
        var m = document.createElement('mark');
        m.textContent = parts[i];
        span.appendChild(m);
      } else {
        span.appendChild(document.createTextNode(parts[i]));
      }
    }
    return span;
  }

  function emptyRow(kind, text, queryForTemplate) {
    var div = document.createElement('div');
    div.className = 'cmdk-' + kind;
    if (queryForTemplate) {
      // "Keine Treffer fuer \\"foo\\"." — build via textContent so
      // the query string stays inert.
      div.appendChild(document.createTextNode('Keine Treffer fuer '));
      var strong = document.createElement('strong');
      strong.textContent = '"' + queryForTemplate + '"';
      div.appendChild(strong);
      div.appendChild(document.createTextNode('.'));
    } else {
      div.textContent = text;
    }
    return div;
  }

  function clearList() {
    while (list.firstChild) list.removeChild(list.firstChild);
  }

  function open() {
    backdrop.classList.add('open');
    backdrop.setAttribute('aria-hidden', 'false');
    setTimeout(function() { input.focus(); input.select(); }, 0);
  }
  function close() {
    backdrop.classList.remove('open');
    backdrop.setAttribute('aria-hidden', 'true');
    input.value = '';
    clearList();
    state.results = [];
    state.activeIdx = 0;
  }
  function render() {
    clearList();
    var q = input.value.trim();
    if (!q) {
      list.appendChild(emptyRow('empty', 'Tippe um zu suchen…', null));
      return;
    }
    if (state.results.length === 0) {
      list.appendChild(emptyRow('empty', '', q));
      return;
    }
    for (var i = 0; i < state.results.length; i++) {
      var r = state.results[i];
      var row = document.createElement('a');
      row.className = 'cmdk-result' + (i === state.activeIdx ? ' active' : '');
      row.setAttribute('data-idx', String(i));
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', i === state.activeIdx ? 'true' : 'false');
      row.href = '/entities/' + encodeURIComponent(r.id);

      var top = document.createElement('div');
      top.className = 'cmdk-result-top';

      var kindBadge = document.createElement('span');
      kindBadge.className = 'badge ' + badgeClass(r.kind);
      kindBadge.textContent = String(r.kind || '');
      top.appendChild(kindBadge);

      var ctxBadge = document.createElement('span');
      ctxBadge.className = 'badge ' + badgeClass(r.context);
      ctxBadge.textContent = String(r.context || '');
      top.appendChild(ctxBadge);

      top.appendChild(titleNode(r.title));
      row.appendChild(top);

      if (r.snippet) {
        var body = document.createElement('div');
        body.className = 'cmdk-result-body';
        body.textContent = String(r.snippet);
        row.appendChild(body);
      }

      list.appendChild(row);
    }
    var activeEl = list.querySelector('.cmdk-result.active');
    if (activeEl && activeEl.scrollIntoView) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }
  function updateActive(delta) {
    if (state.results.length === 0) return;
    state.activeIdx = (state.activeIdx + delta + state.results.length) % state.results.length;
    render();
  }
  async function search(q) {
    var reqId = ++state.reqId;
    if (!q) { state.results = []; state.activeIdx = 0; render(); return; }
    try {
      var res = await fetch('/api/search?q=' + encodeURIComponent(q) + '&limit=8', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('http ' + res.status);
      var data = await res.json();
      if (reqId !== state.reqId) return;
      state.results = Array.isArray(data.results) ? data.results : [];
      state.activeIdx = 0;
      render();
    } catch (err) {
      if (reqId !== state.reqId) return;
      state.results = [];
      clearList();
      list.appendChild(emptyRow('empty', 'Fehler bei der Suche.', null));
    }
  }

  document.addEventListener('keydown', function(e) {
    var isK = (e.key === 'k' || e.key === 'K');
    if ((e.metaKey || e.ctrlKey) && isK) {
      e.preventDefault();
      if (backdrop.classList.contains('open')) { close(); } else { open(); }
      return;
    }
    if (!backdrop.classList.contains('open')) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); updateActive(1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); updateActive(-1); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      var r = state.results[state.activeIdx];
      if (r) window.location.href = '/entities/' + encodeURIComponent(r.id);
    }
  });
  input.addEventListener('input', function() {
    clearTimeout(state.timer);
    var q = input.value.trim();
    if (!q) { state.results = []; render(); return; }
    state.timer = setTimeout(function() { search(q); }, 150);
  });
  backdrop.addEventListener('click', function(e) {
    if (e.target === backdrop) close();
  });
  var panel = backdrop.querySelector('.cmdk-panel');
  if (panel) panel.addEventListener('click', function(e) { e.stopPropagation(); });
})();
`;

const MOON_SVG =
  '<svg id="theme-moon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

const SUN_SVG =
  '<svg id="theme-sun" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';

const HAMBURGER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';

export interface CurrentUser {
  readonly name: string;
  readonly is_admin: boolean;
}

export interface LayoutOptions {
  readonly title: string;
  readonly body: string;
  readonly currentUser?: CurrentUser;
  readonly activePath?: string;
  readonly csrfToken?: string;
  readonly headExtra?: string;
}

function navItem(href: string, label: string, activePath?: string): string {
  const active = activePath === href ? ' class="active"' : '';
  return `<a href="${href}"${active}>${escapeHtml(label)}</a>`;
}

function renderNav(user: CurrentUser | undefined, activePath: string | undefined, csrfToken: string | undefined): string {
  if (!user) return '';
  const adminNav = user.is_admin
    ? `${navItem('/users', 'Users', activePath)}${navItem('/audit', 'Audit', activePath)}`
    : '';
  const csrfInput = csrfToken ? `<input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">` : '';
  return `
<nav>
  <a href="/" class="brand">plexus</a>
  <button class="nav-toggle" aria-label="Menu">${HAMBURGER_SVG}</button>
  <div class="nav-links">
    ${navItem('/', 'Home', activePath)}
    ${navItem('/entities', 'Entities', activePath)}
    ${navItem('/graph', 'Graph', activePath)}
    ${navItem('/shares', 'Shares', activePath)}
    ${adminNav}
    ${navItem('/tokens', 'Tokens', activePath)}
    ${navItem('/passkeys', 'Passkeys', activePath)}
    ${navItem('/oauth/clients', 'Clients', activePath)}
    ${navItem('/sessions', 'Sessions', activePath)}
    ${navItem('/help', '?', activePath)}
    <div class="controls">
      <button class="ctrl-btn" onclick="toggleTheme()" aria-label="Theme wechseln" type="button">${MOON_SVG}${SUN_SVG}</button>
      <form method="POST" action="/auth/logout" style="display:inline;margin-left:8px">
        ${csrfInput}
        <button type="submit" class="ctrl-btn" aria-label="Abmelden" style="font-size:9px;width:auto;padding:0 8px">Logout</button>
      </form>
    </div>
  </div>
</nav>
`;
}

export function layout({ title, body, currentUser, activePath, csrfToken, headExtra }: LayoutOptions): string {
  const nav = renderNav(currentUser, activePath, csrfToken);
  const cmdkMarkup = currentUser ? CMDK_HTML : '';
  const cmdkScript = currentUser ? `<script>${CMDK_SCRIPT}</script>` : '';
  const container = currentUser
    ? `${nav}<div class="container">${body}</div>${cmdkMarkup}`
    : body;

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — plexus</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='14' fill='%23222' stroke='%234a7a9b' stroke-width='2'/%3E%3Ctext x='16' y='22' text-anchor='middle' fill='%234a7a9b' font-family='monospace' font-size='18' font-weight='700'%3Ep%3C/text%3E%3C/svg%3E">
<style>${CSS}</style>
<script>${INIT_SCRIPT}</script>
${headExtra ?? ''}
</head>
<body>
${container}
<script>${UI_SCRIPT}</script>
${cmdkScript}
</body>
</html>`;
}

// ---------- Reusable helpers ----------

/**
 * Strip markdown syntax markers for use in plain-text excerpts (cards,
 * tooltips, activity feed). Removes headings, bold, italic, code,
 * links, lists, blockquotes, tables, code blocks — leaving clean text
 * that reads well in a single line.
 */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')         // fenced code blocks
    .replace(/^#{1,6}\s+/gm, '')             // heading markers
    .replace(/\*\*([^*]+)\*\*/g, '$1')       // bold
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2') // italic
    .replace(/`([^`]+)`/g, '$1')             // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/^[-*]\s+/gm, '• ')            // unordered list items
    .replace(/^\d+\.\s+/gm, '')             // ordered list items
    .replace(/^>\s+/gm, '')                 // blockquotes
    .replace(/\|/g, ' ')                    // table pipes
    .replace(/^---+$/gm, '')               // horizontal rules / table separators
    .replace(/\n{2,}/g, ' ')               // collapse blank lines
    .replace(/\n/g, ' ')                   // single newlines → spaces
    .replace(/\s{2,}/g, ' ')              // collapse whitespace
    .trim();
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  } catch {
    return iso;
  }
}

export function contextBadge(ctx: string): string {
  const cls = `badge-${escapeHtml(ctx).replace(/[^a-z-]/g, '') || 'privat'}`;
  return `<span class="badge ${cls}">${escapeHtml(ctx)}</span>`;
}

export function kindBadge(kind: string): string {
  const cls = `badge-${escapeHtml(kind).replace(/[^a-z_-]/g, '') || 'concept'}`;
  return `<span class="badge ${cls}">${escapeHtml(kind)}</span>`;
}

export function statusBadge(status: string): string {
  const cls = `badge-${escapeHtml(status).replace(/[^a-z-]/g, '') || 'active'}`;
  return `<span class="badge badge-status ${cls}">${escapeHtml(status)}</span>`;
}

export function renderFlash(flash?: { type: 'success' | 'danger' | 'info'; message: string; token?: string; tokenUser?: string }): string {
  if (!flash) return '';
  if (flash.token) {
    return `
<div class="alert alert-success">
  <strong>${escapeHtml(flash.message)}</strong>
  <p class="muted" style="margin:8px 0 4px">Speichere diesen Token JETZT — er wird nie wieder angezeigt.</p>
  <div class="token-box">${escapeHtml(flash.token)}</div>
  ${flash.tokenUser ? `<p class="subtle" style="font-size:12px">Fuer User: <span class="mono">${escapeHtml(flash.tokenUser)}</span></p>` : ''}
</div>`;
  }
  return `<div class="alert alert-${flash.type}">${escapeHtml(flash.message)}</div>`;
}
