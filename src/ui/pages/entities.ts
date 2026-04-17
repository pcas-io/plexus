/**
 * Entities browser — READ-ONLY view for humans.
 *
 * Important design rule from the Plexus v5 Kickoff-ADR: the dashboard
 * is READ-ONLY for graph content. All writes to entities and edges
 * happen exclusively via MCP tools (save_entity, update_entity,
 * link_entities, …). The dashboard only lets humans browse and filter.
 *
 * The ONLY write actions the dashboard exposes are:
 *   - user management (/users)
 *   - session management (/sessions)
 *   - share-link creation (/share, with step-up passkey) — Schritt 6
 *
 * This file intentionally has no create/edit/delete buttons for entities.
 */

import type { Entity } from '../../db/repositories/entities.js';
import type { User } from '../../db/repositories/users.js';
import type { KindDef } from '../../mcp/registries.js';
import {
  layout,
  html,
  raw,
  escapeHtml,
  stripMarkdown,
  formatDate,
  kindBadge,
  contextBadge,
  statusBadge,
} from '../layout.js';

interface EntitiesListOptions {
  readonly currentUser: User;
  readonly entities: Entity[];
  readonly kinds: KindDef[];
  readonly filterQuery?: string;
  readonly filterKind?: string;
  readonly filterContext?: string;
  readonly filterStatus?: string;
  readonly filterShowTasks?: boolean;
  readonly contexts: string[];
  readonly csrfToken: string;
}

export function renderEntitiesList(opts: EntitiesListOptions): string {
  const { currentUser, entities, kinds, filterQuery, filterKind, filterContext, filterStatus, filterShowTasks, contexts, csrfToken } = opts;

  const kindOptions = ['<option value="">Alle Kinds</option>']
    .concat(
      kinds.map(
        (k) =>
          `<option value="${escapeHtml(k.name)}"${k.name === filterKind ? ' selected' : ''}>${escapeHtml(k.name)}</option>`
      )
    )
    .join('');

  const contextOptions = ['<option value="">Alle Kontexte</option>']
    .concat(
      contexts.map(
        (ctx) =>
          `<option value="${escapeHtml(ctx)}"${ctx === filterContext ? ' selected' : ''}>${escapeHtml(ctx)}</option>`
      )
    )
    .join('');

  const statusOptions = ['active', 'archived']
    .map(
      (s) =>
        `<option value="${s}"${s === filterStatus ? ' selected' : ''}>${s}</option>`
    )
    .join('');

  // When search() was used, title may contain pre-baked <mark>…</mark>
  // tags from SurrealDB's search::highlight(). Render those through
  // raw() but keep the rest of the pipeline HTML-safe: the tag
  // whitelist is a simple mark-only pass that escapes everything else.
  const renderTitle = (rawTitle: string): string => {
    if (!filterQuery) return escapeHtml(rawTitle);
    // Split on the literal markers we asked SurrealDB to inject, escape
    // the non-highlighted fragments, and re-wrap the highlighted ones.
    const parts = rawTitle.split(/(<mark>|<\/mark>)/g);
    let inside = false;
    const out: string[] = [];
    for (const p of parts) {
      if (p === '<mark>') { inside = true; continue; }
      if (p === '</mark>') { inside = false; continue; }
      out.push(inside ? `<mark>${escapeHtml(p)}</mark>` : escapeHtml(p));
    }
    return out.join('');
  };

  const resultInfo = filterQuery
    ? `<div class="filter-result-count">${entities.length} ${entities.length === 1 ? 'match' : 'matches'} for <strong>${escapeHtml(`"${filterQuery}"`)}</strong></div>`
    : '';

  const emptyMessage = filterQuery
    ? `<div class="empty">No matches for <strong>${escapeHtml(`"${filterQuery}"`)}</strong>. Try a different query or adjust the filters.</div>`
    : '<div class="empty">No entities in the graph yet. Entities are only created via MCP (save_entity).</div>';

  const cards = entities.length === 0
    ? emptyMessage
    : `<div class="entity-grid">${entities
        .map((e) => `
          <a href="/entities/${encodeURIComponent(e.id)}" class="entity-card">
            <div class="entity-card-head">
              ${kindBadge(e.kind)}
              ${contextBadge(e.context)}
              ${e.status !== 'active' ? statusBadge(e.status) : ''}
              <span class="entity-card-time">${escapeHtml(formatDate(e.updated_at))}</span>
            </div>
            <div class="entity-card-title">${renderTitle(e.title)}</div>
            ${e.body ? `<div class="entity-card-body">${escapeHtml(stripMarkdown(e.body).slice(0, 320))}</div>` : ''}
          </a>`)
        .join('')}</div>`;

  const body = html`
    <h1>Entities</h1>
    <p class="subtitle">Read-only view of the knowledge graph. Entities and edges are managed exclusively through MCP.</p>

    <form method="GET" action="/entities" class="filter-bar">
      <input
        type="search"
        name="q"
        class="filter-bar-search"
        placeholder="Search title and body…"
        value="${escapeHtml(filterQuery ?? '')}"
        autocomplete="off"
        aria-label="Full-text search"
      >
      <select name="kind" aria-label="Kind filter">${raw(kindOptions)}</select>
      <select name="context" aria-label="Context filter">${raw(contextOptions)}</select>
      <select name="status" aria-label="Status filter">
        <option value="">Active (default)</option>
        ${raw(statusOptions)}
      </select>
      <label class="filter-bar-check" title="Tasks are hidden by default because they dominate the overview.">
        <input type="checkbox" name="show_tasks" value="1"${filterShowTasks ? ' checked' : ''}>
        <span>Tasks</span>
      </label>
      <button type="submit" class="btn">Suchen</button>
      <a href="/entities" class="btn btn-ghost">Reset</a>
    </form>

    ${raw(resultInfo)}
    ${raw(cards)}
  `;

  return layout({
    title: 'Entities',
    body,
    currentUser,
    activePath: '/entities',
    csrfToken,
  });
}
