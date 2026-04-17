/**
 * Public share consumption page — rendered at /share/:token.
 *
 * Strictly read-only, no session, no nav, no links into the dashboard.
 * The recipient does not have an account and should not see anything
 * beyond the single entity that was shared.
 */

import type { Entity } from '../../db/repositories/entities.js';
import {
  layout,
  html,
  raw,
  escapeHtml,
  kindBadge,
  contextBadge,
} from '../layout.js';
import { renderMarkdown } from '../markdown.js';

interface SharedEntityOptions {
  readonly entity: Entity;
}

export function renderSharedEntity(opts: SharedEntityOptions): string {
  const { entity } = opts;

  // Build the optional Attributes section as ONE flat HTML string and
  // interpolate it via raw() at a single level — the previous version
  // nested an inner html`...` template inside the outer one, which
  // caused the outer template to escapeHtml() the inner result because
  // it wasn't marked with a __raw wrapper. Keep this as a plain string
  // so the single raw() wrap suffices.
  //
  // JSON values are escaped once via escapeHtml so quote characters in
  // the serialised attributes don't close the <pre> prematurely.
  const attributesHtml = Object.keys(entity.attributes).length > 0
    ? `<h2>Attributes</h2><div class="card"><pre style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:0.46rem;padding:12px;font-size:0.77rem;overflow-x:auto;max-width:100%;word-wrap:break-word">${escapeHtml(JSON.stringify(entity.attributes, null, 2))}</pre></div>`
    : '';

  const body = html`
    <div class="share-container" style="max-width:min(720px,100%);margin:3rem auto;padding:0 1.23rem;box-sizing:border-box">
      <div style="font-size:0.69rem;color:var(--color-subtle);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:0.46rem">
        plexus · geteilter Eintrag · read-only
      </div>
      <h1 style="margin-bottom:0.46rem;word-wrap:break-word;overflow-wrap:anywhere">${entity.title}</h1>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:1.23rem">
        ${raw(kindBadge(entity.kind))}
        ${raw(contextBadge(entity.context))}
      </div>

      <div class="markdown-content" style="background:var(--color-page);border:1px solid var(--color-border);border-radius:0.46rem;padding:1.23rem;max-width:100%;overflow-wrap:anywhere">
        ${raw(entity.body ? renderMarkdown(entity.body) : '<p class="subtle">Kein Body.</p>')}
      </div>

      ${raw(attributesHtml)}

      <p class="subtle" style="margin-top:2rem;font-size:0.77rem;text-align:center">
        Dieser Link wurde bereits verbraucht und funktioniert beim zweiten Aufruf nicht mehr.
      </p>
    </div>
  `;

  return layout({
    title: `${entity.title} — geteilt`,
    body,
    // No currentUser → no nav bar.
  });
}
