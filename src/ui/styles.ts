/**
 * Plexus CSS tokens and component styles.
 *
 * Design is light by default with a dark-theme toggle, S/M/L zoom,
 * and dashboard-specific badge classes (admin/user/session).
 */

export const CSS = `
:root {
  --color-ink: #111;
  --color-body: #222;
  --color-mid: #444;
  --color-muted: #666;
  --color-subtle: #888;
  --color-light: #999;
  --color-ghost: #ccc;
  --color-border: #e0e0e0;
  --color-divider: #eee;
  --color-surface: #fafafa;
  --color-page: #fff;
  --color-accent: #444;
  --color-link: #222;

  --color-status-active-bg: #e8ede9;   --color-status-active-text: #4a6b50;
  --color-status-planning-bg: #f2ece4; --color-status-planning-text: #7a6840;
  --color-status-paused-bg: #ececec;   --color-status-paused-text: #777;
  --color-status-done-bg: #e8edf2;     --color-status-done-text: #4a5f6b;
  --color-status-archived-bg: #ececec; --color-status-archived-text: #777;

  --color-cat-dev: #94a89b;   --color-cat-bemodi: #c4a0a0;
  --color-cat-ifp-labs: #a0afc4; --color-cat-musik: #b0a0c4;
  --color-cat-privat: #aaa;

  --color-role-admin: #9b7a4a;
  --color-role-user: #6b7a9b;

  --font-sans: -apple-system, "system-ui", "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji";
  --font-mono: ui-monospace, "SF Mono", "Cascadia Code", "Segoe UI Mono", monospace;
  --font-active: var(--font-sans);
}

*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
html {
  -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
  font-size: 16px;
  /* Prevent iOS Safari/Brave from bumping text sizes up on orientation
     change or when the page is not explicitly wide-optimised. Without
     this the mobile markdown body text is visibly larger than the CSS
     defines because the browser "helpfully" inflates it. */
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}
body {
  font-family: var(--font-active);
  background: var(--color-page);
  color: var(--color-body);
  line-height: 1.6;
  font-size: 1rem;
  /* Intentionally NO overflow-x hidden or max-width 100vw here. Both
     break iOS pinch-zoom — Safari and Brave need to be able to scroll
     the viewport horizontally when the user zooms in. The responsive
     fixes live on the elements themselves: overflow-wrap anywhere on
     h1/h2/h3, word-break break-all on mono spans inside cards,
     max-width 100% on card wrappers, and the .table-wrapper class for
     wide tables. That keeps content inside the viewport at 1x zoom
     and still lets the browser pan when the user pinches to zoom in. */
}
a { color: var(--color-link); text-decoration: none; }
a:hover { text-decoration: underline; }
.container { max-width: 1632px; margin: 0 auto; padding: 1.85rem 2.5rem; background: color-mix(in srgb, var(--color-page) 92%, transparent); border-radius: 0 0 0.46rem 0.46rem; min-height: calc(100vh - 3rem); }

nav {
  background: var(--color-page);
  border-bottom: 1px solid var(--color-border);
  padding: 0.77rem 1.85rem;
  display: flex; gap: 0.3rem; align-items: center;
  position: sticky; top: 0; z-index: 40;
}
nav .brand {
  font-family: var(--font-mono);
  font-size: 1.08rem; font-weight: 700;
  color: var(--color-ink); margin-right: 1.23rem;
  letter-spacing: -0.02em;
}
nav a {
  color: var(--color-subtle);
  font-size: 0.85rem; font-weight: 500;
  padding: 0.31rem 0.54rem; border-radius: 0.46rem;
  transition: all 0.12s;
}
nav a:hover { color: var(--color-body); background: var(--color-surface); text-decoration: none; }
nav a.active { color: var(--color-ink); background: var(--color-surface); }

.stats-bar {
  display: flex; gap: 1.54rem; padding: 1.08rem 0;
  font-size: 0.85rem; color: var(--color-muted); font-weight: 500;
}
.stats-bar strong {
  font-family: var(--font-mono); color: var(--color-ink);
  font-size: 1.15rem; font-weight: 700; letter-spacing: -0.02em;
}

.grid { display: grid; grid-template-columns: 1fr minmax(280px, 380px); gap: 1.85rem; margin-top: 1.23rem; }
.grid-1 { display: grid; grid-template-columns: 1fr; gap: 1.23rem; margin-top: 1.23rem; }

/* Bento grid (home page) — mirrors buddy */
.bento-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 1.85rem; margin-top: 1.23rem; }

/* CRITICAL: grid/flex items default to min-width: auto which resolves to
   min-content. If a single child (a long mono string, a code span, a
   .table-wrapper whose inner table has min-width: 540px, a pre block
   with a long line) has an intrinsic min-content larger than the cell's
   allocated fr track, the cell will GROW past its track — and push the
   whole grid wider than the viewport. On the entity-detail page this
   showed up as "body is wider than screen" at 1× zoom on every phone.
   Forcing min-width: 0 tells the cell to respect its track width and
   let children with overflow:auto handle their own scrolling internally.
   Same for .bento-grid and .grid-1 for consistency. */
.grid > *,
.grid-1 > *,
.bento-grid > * { min-width: 0; }
.bento-projects { display: flex; flex-direction: column; gap: 0.46rem; }
.bento-tile {
  background: var(--color-page); border: 1px solid var(--color-border);
  border-radius: 0.46rem; padding: 0.77rem 1rem; transition: background 0.12s;
  margin-bottom: 0.46rem;
}
.bento-tile:hover { background: var(--color-surface); }
.bento-sidebar { display: flex; flex-direction: column; gap: 1.23rem; }
.bento-alert-card { border-left: 3px solid #c4b080; padding-left: 12px; }

/* Recent activity feed */
.activity-list { list-style: none; }
.activity-list li { padding: 0.46rem 0; border-bottom: 1px solid var(--color-divider); font-size: 0.92rem; color: var(--color-muted); display: flex; gap: 0.31rem; align-items: baseline; flex-wrap: wrap; }
.activity-list time { font-family: var(--font-mono); font-size: 0.77rem; color: var(--color-light); margin-right: 0.62rem; flex-shrink: 0; }

/* Usage widget */
.usage-widget {
  display: flex; gap: 1.23rem; padding: 0.77rem 1.23rem;
  font-size: 0.85rem; color: var(--color-muted);
  background: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: 0.46rem; margin-bottom: 1.23rem; flex-wrap: wrap;
  align-items: center;
}
.usage-widget .usage-count { white-space: nowrap; }
.usage-widget .usage-count strong {
  font-family: var(--font-mono); color: var(--color-ink);
  font-size: 1.15rem; font-weight: 700; letter-spacing: -0.02em;
}
.usage-widget .usage-sep { color: var(--color-ghost); }

/* Two-line clamp used on project/entity cards */
.truncate-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

/* Filter bar — used on /entities and similar list pages. The native
   select elements are restyled with a custom SVG chevron so the page
   stops looking like a Windows 95 form. */
.filter-bar {
  display: flex; gap: 0.62rem; align-items: center; flex-wrap: wrap;
  padding: 0.77rem 0.92rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 0.62rem;
  margin-bottom: 1.54rem;
}
.filter-bar-label {
  font-size: 0.69rem; font-weight: 700;
  color: var(--color-subtle);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-right: 0.38rem;
  user-select: none;
}
.filter-bar select {
  appearance: none; -webkit-appearance: none; -moz-appearance: none;
  background-color: var(--color-page);
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path fill='none' stroke='%23888' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round' d='M3 4.5 6 7.5 9 4.5'/></svg>");
  background-repeat: no-repeat;
  background-position: right 0.69rem center;
  background-size: 12px;
  border: 1px solid var(--color-border);
  border-radius: 0.46rem;
  padding: 0.46rem 2.15rem 0.46rem 0.77rem;
  color: var(--color-body);
  font-family: var(--font-active);
  font-size: 0.85rem;
  cursor: pointer;
  transition: border-color 0.12s, background-color 0.12s;
  min-width: 150px;
}
.filter-bar select:hover {
  border-color: var(--color-mid);
  background-color: var(--color-surface);
}
.filter-bar select:focus {
  outline: none;
  border-color: var(--color-ink);
  background-color: var(--color-page);
}
.filter-bar .filter-spacer { flex: 1; }
.filter-bar .btn { padding: 0.46rem 0.92rem; font-size: 0.85rem; }

.filter-bar-search {
  flex: 1 1 260px;
  min-width: 200px;
  padding: 0.46rem 0.77rem 0.46rem 2.15rem;
  background-color: var(--color-page);
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 14 14'><circle cx='6' cy='6' r='4.5' fill='none' stroke='%23888' stroke-width='1.5'/><path d='M9.5 9.5 12 12' fill='none' stroke='%23888' stroke-width='1.5' stroke-linecap='round'/></svg>");
  background-repeat: no-repeat;
  background-position: left 0.69rem center;
  background-size: 14px;
  border: 1px solid var(--color-border);
  border-radius: 0.46rem;
  color: var(--color-body);
  font-family: var(--font-active);
  font-size: 0.92rem;
  transition: border-color 0.12s, background-color 0.12s;
}
.filter-bar-search::placeholder { color: var(--color-light); }
.filter-bar-search:hover { border-color: var(--color-mid); }
.filter-bar-search:focus {
  outline: none;
  border-color: var(--color-ink);
  background-color: var(--color-page);
}
.filter-bar-search::-webkit-search-cancel-button {
  -webkit-appearance: none;
  height: 14px; width: 14px;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 14 14'><path d='M3 3 11 11 M11 3 3 11' fill='none' stroke='%23888' stroke-width='1.5' stroke-linecap='round'/></svg>");
  background-repeat: no-repeat;
  background-position: center;
  cursor: pointer;
  opacity: 0.6;
}
.filter-bar-search::-webkit-search-cancel-button:hover { opacity: 1; }

.filter-result-count {
  font-size: 0.85rem;
  color: var(--color-muted);
  margin-bottom: 0.77rem;
  padding: 0 0.23rem;
}
.filter-result-count strong {
  color: var(--color-ink);
  font-weight: 600;
  font-family: var(--font-mono);
  font-size: 0.85rem;
}

/* Filter-bar checkbox toggle (e.g. "Tasks einblenden"). Rendered as a
   compact pill matching the other controls so it doesn't break the
   horizontal rhythm of the bar. */
.filter-bar-check {
  display: inline-flex; align-items: center; gap: 0.38rem;
  padding: 0.46rem 0.77rem;
  background: var(--color-page);
  border: 1px solid var(--color-border);
  border-radius: 0.46rem;
  font-size: 0.85rem;
  color: var(--color-body);
  cursor: pointer;
  user-select: none;
  transition: border-color 0.12s, background-color 0.12s;
}
.filter-bar-check:hover { border-color: var(--color-mid); }
.filter-bar-check input[type="checkbox"] {
  appearance: none; -webkit-appearance: none;
  width: 14px; height: 14px;
  border: 1.5px solid var(--color-ghost);
  border-radius: 0.23rem;
  background: var(--color-page);
  cursor: pointer;
  position: relative;
  transition: all 0.12s;
  flex-shrink: 0;
}
.filter-bar-check input[type="checkbox"]:checked {
  background: var(--color-ink);
  border-color: var(--color-ink);
}
.filter-bar-check input[type="checkbox"]:checked::after {
  content: '';
  position: absolute;
  left: 3px; top: 0px;
  width: 4px; height: 8px;
  border: solid var(--color-page);
  border-width: 0 1.5px 1.5px 0;
  transform: rotate(45deg);
}

/* Search highlights inside entity cards — subtle accent background so
   matched tokens stand out without screaming. Works in both themes. */
.entity-card-title mark,
.markdown-content mark,
.cmdk-result-title mark {
  background: #fff3b8;
  color: inherit;
  padding: 0 0.15rem;
  border-radius: 0.15rem;
}
[data-theme="dark"] .entity-card-title mark,
[data-theme="dark"] .markdown-content mark,
[data-theme="dark"] .cmdk-result-title mark {
  background: #5a4a1e;
  color: #f5e8b0;
}

/* ---------- Command Palette (⌘K / Ctrl+K) ---------- */
/* Global quick-nav overlay. Loaded on every dashboard page via the
   layout module. Hidden by default; the cmdk.js inline script toggles
   .cmdk-backdrop.open on the Cmd+K / Ctrl+K keyboard shortcut. */

.cmdk-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.42);
  -webkit-backdrop-filter: blur(3px);
  backdrop-filter: blur(3px);
  z-index: 100;
  display: none;
  align-items: flex-start;
  justify-content: center;
  padding-top: 14vh;
  animation: cmdk-fade 0.12s ease-out;
}
[data-theme="dark"] .cmdk-backdrop { background: rgba(0, 0, 0, 0.62); }
.cmdk-backdrop.open { display: flex; }
@keyframes cmdk-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

.cmdk-panel {
  width: 92%;
  max-width: 640px;
  background: var(--color-page);
  border: 1px solid var(--color-border);
  border-radius: 0.77rem;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.24);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: 70vh;
  animation: cmdk-lift 0.15s ease-out;
}
[data-theme="dark"] .cmdk-panel { box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6); }
@keyframes cmdk-lift {
  from { transform: translateY(-8px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.cmdk-input-wrap {
  display: flex;
  align-items: center;
  gap: 0.77rem;
  padding: 0.92rem 1.15rem;
  border-bottom: 1px solid var(--color-divider);
  flex-shrink: 0;
}
.cmdk-input-wrap svg {
  width: 18px;
  height: 18px;
  color: var(--color-subtle);
  flex-shrink: 0;
}
.cmdk-input {
  flex: 1;
  border: 0;
  outline: none;
  background: transparent;
  font-family: var(--font-active);
  font-size: 1.08rem;
  color: var(--color-ink);
  padding: 0;
}
.cmdk-input::placeholder { color: var(--color-light); }
.cmdk-hint {
  font-family: var(--font-mono);
  font-size: 0.69rem;
  color: var(--color-subtle);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 0.31rem;
  padding: 0.15rem 0.46rem;
  flex-shrink: 0;
}

.cmdk-results {
  flex: 1;
  overflow-y: auto;
  padding: 0.38rem;
}
.cmdk-result {
  display: block;
  padding: 0.62rem 0.92rem;
  border-radius: 0.46rem;
  text-decoration: none;
  color: inherit;
  transition: background 0.08s;
}
.cmdk-result:hover,
.cmdk-result.active {
  background: var(--color-surface);
  text-decoration: none;
}
.cmdk-result-top {
  display: flex;
  align-items: center;
  gap: 0.46rem;
  margin-bottom: 0.23rem;
  flex-wrap: wrap;
}
.cmdk-result-title {
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--color-ink);
  line-height: 1.3;
}
.cmdk-result-body {
  font-size: 0.77rem;
  color: var(--color-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.4;
}
.cmdk-empty,
.cmdk-loading {
  padding: 1.85rem 1.15rem;
  text-align: center;
  color: var(--color-muted);
  font-size: 0.85rem;
}
.cmdk-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.54rem 1.15rem;
  border-top: 1px solid var(--color-divider);
  font-size: 0.69rem;
  color: var(--color-subtle);
  font-family: var(--font-mono);
  flex-shrink: 0;
}
.cmdk-footer kbd {
  font-family: var(--font-mono);
  font-size: 0.69rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 0.23rem;
  padding: 0.1rem 0.31rem;
  margin: 0 0.15rem;
}

/* Entity list grid — responsive 1/2/3 columns depending on viewport.
   Card look is extracted from the inline styles that used to live
   inside the entities template. */
.entity-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(440px, 1fr));
  gap: 1rem;
  margin-top: 0.46rem;
}
.entity-card {
  display: flex; flex-direction: column;
  background: var(--color-page);
  border: 1px solid var(--color-border);
  border-radius: 0.62rem;
  padding: 1.08rem 1.23rem 1rem;
  text-decoration: none;
  color: inherit;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
  min-height: 172px;
}
.entity-card:hover {
  text-decoration: none;
  border-color: var(--color-mid);
  box-shadow: 0 6px 20px rgba(0,0,0,0.05);
  transform: translateY(-1px);
}
[data-theme="dark"] .entity-card:hover {
  box-shadow: 0 6px 20px rgba(0,0,0,0.3);
}
.entity-card-head {
  display: flex; align-items: center; gap: 0.46rem;
  flex-wrap: wrap;
  margin-bottom: 0.69rem;
}
.entity-card-time {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 0.69rem;
  color: var(--color-light);
  white-space: nowrap;
}
.entity-card-title {
  font-size: 1.04rem;
  font-weight: 600;
  color: var(--color-ink);
  line-height: 1.35;
  letter-spacing: -0.005em;
  margin-bottom: 0.54rem;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.entity-card-body {
  font-size: 0.88rem;
  color: var(--color-muted);
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  flex: 1;
}

.card {
  background: var(--color-page); border: 1px solid var(--color-border);
  border-radius: 0.46rem; padding: 0.92rem 1.23rem;
  margin-bottom: 0.62rem; transition: background 0.12s;
}
.card:hover { background: var(--color-surface); }
.card h3 { font-size: 1rem; font-weight: 600; margin-bottom: 0.15rem; color: var(--color-ink); }
.card p { font-size: 0.92rem; color: var(--color-muted); }

.badge {
  font-size: 0.77rem; font-weight: 600;
  padding: 0.23rem 0.69rem; border-radius: 0.46rem;
  display: inline-block; letter-spacing: 0.04em;
}
.badge-dev { background: #e8ede9; color: #4a6b50; }
.badge-bemodi { background: #f0e8e8; color: #6b4a4a; }
.badge-ifp-labs { background: #e8edf2; color: #4a5f6b; }
.badge-musik { background: #ece8f2; color: #5f4a6b; }
.badge-privat { background: #ececec; color: #666; }
.badge-status { font-size: 0.77rem; padding: 0.23rem 0.69rem; border-radius: 0.46rem; margin-left: 0.46rem; }
.badge-active { background: var(--color-status-active-bg); color: var(--color-status-active-text); }
.badge-planning { background: var(--color-status-planning-bg); color: var(--color-status-planning-text); }
.badge-paused { background: var(--color-status-paused-bg); color: var(--color-status-paused-text); }
.badge-done { background: var(--color-status-done-bg); color: var(--color-status-done-text); }
.badge-archived { background: var(--color-status-archived-bg); color: var(--color-status-archived-text); }
.badge-draft { background: #f2ece4; color: #7a6840; }
.badge-deprecated { background: #ececec; color: #777; }
.badge-admin { background: #f5ede4; color: #7a5a2a; }
.badge-user { background: #e8ecf5; color: #3a4a6a; }
.badge-skill { background: #f5e4d0; color: #7a4a1a; }

.tag {
  font-size: 0.69rem; background: var(--color-surface); color: var(--color-muted);
  border: 1px solid var(--color-border); border-radius: 0.31rem;
  padding: 0.1rem 0.46rem; display: inline-block;
}

h1 { font-weight: 700; color: var(--color-ink); letter-spacing: -0.02em; margin-bottom: 0.46rem; overflow-wrap: anywhere; word-wrap: break-word; }
h2 { font-size: 0.69rem; font-weight: 700; margin-bottom: 0.77rem; color: var(--color-subtle); text-transform: uppercase; letter-spacing: 0.1em; overflow-wrap: anywhere; }
h3 { font-size: 0.85rem; font-weight: 600; color: var(--color-ink); margin-bottom: 0.38rem; overflow-wrap: anywhere; }
.subtitle { color: var(--color-muted); font-size: 0.92rem; margin-bottom: 1.23rem; }

.login-page { display: flex; align-items: center; justify-content: center; min-height: 100vh; background: var(--color-surface); }
.login-box { background: var(--color-page); border: 1px solid var(--color-border); padding: 2.46rem; border-radius: 0.62rem; width: 100%; max-width: 380px; box-shadow: 0 12px 32px rgba(0,0,0,0.06); }
.login-box h1 { font-family: var(--font-mono); font-size: 1.38rem; text-align: center; margin-bottom: 0.46rem; color: var(--color-ink); }
.login-box .login-hint { text-align: center; color: var(--color-muted); font-size: 0.85rem; margin-bottom: 1.54rem; }
.login-box input { width: 100%; padding: 0.69rem 0.92rem; background: var(--color-page); border: 1px solid var(--color-border); border-radius: 0.46rem; color: var(--color-body); font-family: var(--font-mono); font-size: 1rem; margin-bottom: 1.08rem; transition: border-color 0.12s; }
.login-box input:focus { outline: none; border-color: var(--color-mid); }
.login-box button { width: 100%; padding: 0.69rem 0.92rem; background: var(--color-ink); color: var(--color-page); border: none; border-radius: 0.46rem; font-weight: 600; cursor: pointer; font-size: 0.92rem; transition: background 0.12s; }
.login-box button:hover { background: var(--color-body); }
.login-box button.btn-ghost { background: transparent; color: var(--color-subtle); border: 1px solid var(--color-border); margin-top: 0.46rem; }
.login-box button.btn-ghost:hover { background: var(--color-surface); color: var(--color-body); }
.login-box .error { color: #904040; font-size: 0.92rem; margin-bottom: 0.92rem; text-align: center; background: #fdf5f5; padding: 0.62rem; border-radius: 0.46rem; border: 1px solid #c08080; }
.login-box .info { color: var(--color-mid); font-size: 0.85rem; margin-bottom: 0.92rem; text-align: center; background: var(--color-surface); padding: 0.62rem; border-radius: 0.46rem; border: 1px solid var(--color-border); }
.login-box label { display: block; font-size: 0.69rem; font-weight: 700; color: var(--color-subtle); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 0.38rem; }

.empty { color: var(--color-light); font-size: 0.92rem; padding: 1.23rem 0; }

table { width: 100%; border-collapse: collapse; }
thead tr { border-bottom: 1px solid var(--color-border); }
th { padding: 0.62rem; font-size: 0.69rem; font-weight: 700; color: var(--color-subtle); text-align: left; text-transform: uppercase; letter-spacing: 0.1em; }
tbody tr { border-bottom: 1px solid var(--color-divider); transition: background 0.1s; }
tbody tr:hover { background: var(--color-surface); }
td { padding: 0.77rem 0.62rem; font-size: 1rem; }
.table-wrapper { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }

::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--color-ghost); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--color-subtle); }

/* Forms */
.form-row { display: flex; gap: 0.77rem; align-items: flex-end; margin-bottom: 0.92rem; }
.form-field { flex: 1; }
.form-field label { display: block; font-size: 0.69rem; font-weight: 700; color: var(--color-subtle); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 0.38rem; }
.form-field input, .form-field select {
  width: 100%; padding: 0.46rem 0.62rem;
  background: var(--color-page); border: 1px solid var(--color-border);
  border-radius: 0.46rem; color: var(--color-body);
  font-family: var(--font-active); font-size: 0.92rem;
}
.form-field input:focus, .form-field select:focus { outline: none; border-color: var(--color-mid); }
.btn {
  padding: 0.46rem 0.92rem;
  background: var(--color-ink); color: var(--color-page);
  border: none; border-radius: 0.46rem;
  font-weight: 600; cursor: pointer; font-size: 0.85rem;
  font-family: var(--font-active); transition: background 0.12s;
  text-decoration: none; display: inline-block;
}
.btn:hover { background: var(--color-body); text-decoration: none; }
.btn-ghost {
  background: transparent; color: var(--color-body);
  border: 1px solid var(--color-border);
}
.btn-ghost:hover { background: var(--color-surface); }
.btn-danger { background: #8a3030; color: var(--color-page); }
.btn-danger:hover { background: #6e2424; }
.btn-small { padding: 0.23rem 0.62rem; font-size: 0.77rem; }

.alert {
  padding: 0.77rem 1rem; border-radius: 0.46rem;
  margin-bottom: 0.92rem; font-size: 0.92rem;
  border: 1px solid var(--color-border); background: var(--color-surface);
}
.alert-success { border-color: #90b090; background: #f2f8f2; color: #3a6b3a; }
.alert-danger { border-color: #c08080; background: #fdf5f5; color: #8a3030; }
.alert-info { border-color: var(--color-border); background: var(--color-surface); color: var(--color-mid); }

.token-box {
  background: var(--color-surface);
  border: 1px dashed var(--color-mid);
  border-radius: 0.46rem;
  padding: 0.92rem;
  font-family: var(--font-mono); font-size: 0.92rem;
  word-break: break-all;
  color: var(--color-ink);
  margin: 0.62rem 0;
  user-select: all;
}

/* Share-link result UI — three rows (HTML, Markdown, JSON) each with a
   copy-to-clipboard button. Used on the entity detail page after a
   share token is freshly created. */
.share-link-row {
  margin: 0.77rem 0;
}
.share-link-row-label {
  display: flex;
  align-items: baseline;
  gap: 0.46rem;
  font-size: 0.69rem;
  color: var(--color-subtle);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 0.31rem;
}
.share-link-row-label strong {
  color: var(--color-ink);
  font-weight: 600;
  letter-spacing: 0;
  text-transform: none;
  font-size: 0.85rem;
}
.share-link-box {
  display: flex;
  align-items: stretch;
  gap: 0;
  background: var(--color-surface);
  border: 1px dashed var(--color-mid);
  border-radius: 0.46rem;
  overflow: hidden;
}
.share-link-url {
  flex: 1 1 auto;
  padding: 0.69rem 0.85rem;
  font-family: var(--font-mono);
  font-size: 0.85rem;
  color: var(--color-ink);
  word-break: break-all;
  user-select: all;
  min-width: 0;
}
.share-copy-btn {
  flex: 0 0 auto;
  padding: 0 1rem;
  background: var(--color-page);
  border: none;
  border-left: 1px solid var(--color-border);
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: 0.77rem;
  font-weight: 600;
  color: var(--color-ink);
  white-space: nowrap;
  transition: background 0.12s, color 0.12s;
}
.share-copy-btn:hover { background: var(--color-surface); }
.share-copy-btn.copied {
  background: var(--color-ink);
  color: var(--color-page);
}
.share-copy-btn.copied::before { content: '✓ '; }
@media (max-width: 640px) {
  .share-link-box { flex-direction: column; }
  .share-copy-btn {
    border-left: none;
    border-top: 1px solid var(--color-border);
    padding: 0.62rem 0.85rem;
  }
}

/* Markdown content rendering — overrides global h2/h3 which are styled
   as section labels (uppercase, 0.69rem, grey). Inside .markdown-content
   headings must look like content headings, not labels. */
.markdown-content h1 { font-size: 1.54rem; font-weight: 700; color: var(--color-ink); margin-top: 2rem; padding-bottom: 0.5rem; border-bottom: 2px solid var(--color-border); }
.markdown-content h2 { font-size: 1.23rem; font-weight: 600; color: var(--color-ink); margin-top: 1.85rem; padding-bottom: 0.38rem; border-bottom: 1px solid var(--color-border); text-transform: none; letter-spacing: normal; }
.markdown-content h3 { font-size: 1.08rem; font-weight: 600; color: var(--color-ink); margin-top: 1.23rem; text-transform: none; letter-spacing: normal; }
.markdown-content h1:first-child, .markdown-content h2:first-child, .markdown-content h3:first-child { margin-top: 0; }
.markdown-content p { font-size: 1.08rem; line-height: 1.7; margin-bottom: 0.92rem; color: var(--color-body); }
.markdown-content ul, .markdown-content ol { font-size: 1.08rem; padding-left: 1.85rem; margin-bottom: 0.92rem; }
.markdown-content li { margin-bottom: 0.31rem; line-height: 1.6; }
.markdown-content blockquote { border-left: 3px solid var(--color-muted); background: var(--color-surface); padding: 0.62rem 1.23rem; border-radius: 0.31rem; margin: 1rem 0; }
.markdown-content blockquote p { margin-bottom: 0.31rem; color: var(--color-mid); }
.markdown-content code { font-family: var(--font-mono); font-size: 0.85em; background: var(--color-surface); padding: 0.15rem 0.46rem; border-radius: 0.23rem; border: 1px solid var(--color-border); }
.markdown-content pre code { background: none; border: none; padding: 0; font-size: 0.92rem; }
.markdown-content pre { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 0.46rem; padding: 1rem; overflow-x: auto; margin: 1rem 0; }
.markdown-content table { margin: 1rem 0; width: 100%; }
.markdown-content thead tr { border-bottom: 2px solid var(--color-border); }
.markdown-content th { background: var(--color-surface); padding: 0.62rem 0.92rem; font-size: 0.85rem; text-align: left; }
.markdown-content td { padding: 0.62rem 0.92rem; border-bottom: 1px solid var(--color-border); font-size: 0.92rem; }
.markdown-content tbody tr:hover { background: var(--color-surface); }
.markdown-content a { color: var(--color-link); text-decoration: underline; }

.actions { display: flex; gap: 0.38rem; align-items: center; }

hr { border: none; border-top: 1px solid var(--color-divider); margin: 1.54rem 0; }
.muted { color: var(--color-muted); }
.subtle { color: var(--color-subtle); font-size: 0.85rem; }
.mono { font-family: var(--font-mono); }

/* Dark Theme */
[data-theme="dark"] {
  --color-ink: #eee; --color-body: #ddd; --color-mid: #bbb;
  --color-muted: #999; --color-subtle: #888; --color-light: #777;
  --color-ghost: #555; --color-border: #383838; --color-divider: #2a2a2a;
  --color-surface: #1e1e1e; --color-page: #161616;
  --color-accent: #bbb; --color-link: #ddd;
  --color-status-active-bg: #1e2a20; --color-status-active-text: #7aab80;
  --color-status-planning-bg: #2a2618; --color-status-planning-text: #d0b070;
  --color-status-paused-bg: #222; --color-status-paused-text: #888;
  --color-status-done-bg: #1e2228; --color-status-done-text: #7a9ab0;
  --color-status-archived-bg: #222; --color-status-archived-text: #888;
}
[data-theme="dark"] .badge-admin { background: #382e1e; color: #c8a87a; }
[data-theme="dark"] .badge-user { background: #222838; color: #7a8ab0; }
[data-theme="dark"] .badge-skill { background: #2e2418; color: #d6a876; }
[data-theme="dark"] .login-box .error { background: #2a1e1e; color: #d09090; border-color: #804040; }
[data-theme="dark"] .login-box .info { background: #1e1e1e; color: #ccc; border-color: #383838; }
[data-theme="dark"] .login-page { background: var(--color-page); }
[data-theme="dark"] .login-box { box-shadow: 0 12px 32px rgba(0,0,0,0.3); }
[data-theme="dark"] input, [data-theme="dark"] select, [data-theme="dark"] textarea { color-scheme: dark; }
[data-theme="dark"] .alert-success { background: #1e2a1e; color: #90b090; border-color: #3a5a3a; }
[data-theme="dark"] .alert-danger { background: #2a1e1e; color: #d09090; border-color: #804040; }
[data-theme="dark"] .tag { border-color: var(--color-border); }

/* Controls */
.controls { display: flex; align-items: center; gap: 4px; margin-left: auto; }
.ctrl-btn {
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 6px; border: 1px solid var(--color-border);
  background: none; color: var(--color-subtle);
  cursor: pointer; transition: all 0.12s;
  font-family: var(--font-mono); font-size: 10px; font-weight: 600;
}
.ctrl-btn:hover { color: var(--color-body); border-color: var(--color-ghost); }
.ctrl-btn.active { background: var(--color-ink); color: var(--color-page); border-color: var(--color-ink); }
.ctrl-btn svg { width: 14px; height: 14px; }
.nav-toggle {
  display: none; width: 28px; height: 28px;
  align-items: center; justify-content: center;
  border-radius: 6px; border: 1px solid var(--color-border);
  background: none; color: var(--color-subtle);
  cursor: pointer; margin-left: auto; font-size: 16px; line-height: 1;
}
.nav-links { display: contents; }

/* ============================================================
 * Responsive breakpoints
 * ============================================================
 *
 * Three target viewports:
 *   - mobile     ≤ 640px   (phones, portrait tablets)
 *   - tablet     641–1023px (landscape phones, small tablets, split
 *                            desktop windows)
 *   - desktop    ≥ 1024px  (full desktop)
 *
 * The tablet bucket used to fall through to the full desktop layout,
 * which broke the nav bar (too many links in one row) and wasted
 * horizontal space on the entity grid. The rules below cover both.
 */

/* Tablet + mobile — shared rules that apply from 0 to 1023px */
@media (max-width: 1023px) {
  /* Nav bar: collapse to hamburger. Desktop has too many links to
     fit at tablet widths without wrapping awkwardly, so we reuse the
     mobile pattern across the whole range. */
  nav { flex-wrap: wrap; padding: 0.62rem 1rem; gap: 0; }
  .nav-toggle { display: flex; }
  .nav-links { display: none; width: 100%; flex-direction: column; gap: 2px; padding-top: 0.5rem; }
  .nav-links.open { display: flex; }
  nav a:not(.brand) { padding: 0.46rem 0.62rem; font-size: 0.85rem; }
  nav .brand { margin-right: auto; }
  .controls { width: 100%; justify-content: flex-end; padding-top: 0.38rem; margin-left: 0; }

  /* Layout grids collapse to one column. The desktop rule uses
     "1fr minmax(280px, 380px)" which at 800px leaves only ~420px for
     the main column and makes the sidebar unreadable. Single column
     below 1024px is the simpler contract. */
  .grid { grid-template-columns: 1fr; gap: 1.23rem; }
  .bento-grid { grid-template-columns: 1fr; gap: 1.23rem; }
}

/* Mobile-only — tighter rules for ≤ 640px. Stacks with the
   tablet+mobile block above via normal cascade. */
@media (max-width: 640px) {
  .container { padding: 1rem 0.77rem; }
  .stats-bar { flex-wrap: wrap; gap: 0.77rem; }
  .usage-widget { gap: 0.77rem; padding: 0.62rem 0.92rem; }
  /* Tables need horizontal scroll on narrow screens — the .table-wrapper
     class provides the scroll container, and the min-width here keeps
     column widths from collapsing to illegible. */
  table { min-width: 540px; }
  .login-box { width: 100%; max-width: 100%; margin: 0; padding: 1.85rem 1.23rem; }
  .login-page { padding: 1rem; }
  .card { padding: 0.77rem 0.92rem; max-width: 100%; }
  h1 { font-size: 1.15rem; }
  .form-row { flex-direction: column; align-items: stretch; }
  .entity-grid { grid-template-columns: 1fr; gap: 0.77rem; }
  .entity-card { min-height: auto; padding: 0.92rem 1rem; }
  .filter-bar { padding: 0.62rem 0.77rem; gap: 0.46rem; }
  .filter-bar select { min-width: 0; flex: 1 1 140px; }

  /* Markdown content scales down on mobile so body text feels
     proportional on a narrow viewport. Desktop defaults of 1.08rem
     body and 1.54rem h1 are too big on a 375-430px phone screen —
     user reported "text passt sich nicht dem bildschirm an, bleibt
     uebergroß". Numbers chosen so a 40-60 char markdown paragraph
     fits on one or two lines in a .card on an iPhone in portrait. */
  .markdown-content h1 { font-size: 1.23rem; margin-top: 1.23rem; padding-bottom: 0.31rem; }
  .markdown-content h2 { font-size: 1.08rem; margin-top: 1rem; padding-bottom: 0.23rem; }
  .markdown-content h3 { font-size: 0.96rem; margin-top: 0.77rem; }
  .markdown-content p { font-size: 0.92rem; line-height: 1.55; margin-bottom: 0.62rem; }
  .markdown-content ul,
  .markdown-content ol { font-size: 0.92rem; padding-left: 1.23rem; margin-bottom: 0.62rem; }
  .markdown-content li { line-height: 1.5; }
  .markdown-content blockquote { padding: 0.46rem 0.77rem; }
  .markdown-content pre { font-size: 0.77rem; padding: 0.62rem; }
  .markdown-content pre code { font-size: 0.77rem; }
  .markdown-content th,
  .markdown-content td { padding: 0.38rem 0.54rem; font-size: 0.77rem; }

  /* Body copy and card bodies that aren't markdown-wrapped. */
  body { font-size: 0.92rem; }
  .card { font-size: 0.92rem; }
  /* Graph legend collapses from a fixed 130px side panel to a full
     width top bar on mobile so the SVG canvas gets the screen. */
  #graph-legend { width: 100% !important; border-right: none !important; border-bottom: 1px solid var(--color-border); }
}

/* Tablet-only — 641px to 1023px. Between mobile and desktop, we want
   the nav hamburger (already set above) but a two-column entity grid
   instead of the single-column mobile layout. */
@media (min-width: 641px) and (max-width: 1023px) {
  .entity-grid { grid-template-columns: repeat(2, 1fr); }
}
`;
