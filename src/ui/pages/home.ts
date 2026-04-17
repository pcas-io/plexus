/**
 * Home page — READ-ONLY dashboard, mirrors buddy's home.tsx structure.
 *
 * Layout decision from buddy node 01KNFGGMBV1RTTNGZZSQTKYVKM (Option 1):
 *   - Context-Filter-Bar (Alle + Contexts as badges)
 *   - Bento-Grid:
 *       left:  Projekt-Cards (kind=project) with Mini-Activity-Ring (30d
 *              weighted score from activity_log)
 *       right: Recent-Activity-Feed (letzte 20 graph-mutating actions)
 *   - Usage-Widget bottom (stats across kinds)
 *
 * plexus does NOT reproduce buddy v3's Portfolio-Health-Ring or the
 * A/B/C/D grading — those rely on dedicated project fields we do not
 * have. The Mini-Ring shows a relative activity percentage instead.
 *
 * Dashboard is strictly read-only: no create/edit/archive/unlink
 * actions anywhere. Writes to the graph go exclusively through MCP.
 */

import type { Entity } from '../../db/repositories/entities.js';
import type { ActivityLogEntry } from '../../db/repositories/activity_log.js';
import type { User } from '../../db/repositories/users.js';
import {
  layout,
  html,
  raw,
  escapeHtml,
  formatDate,
  contextBadge,
  kindBadge,
  stripMarkdown,
} from '../layout.js';

interface HomeStats {
  readonly entityCount: number;
  readonly activeEdgeCount: number;
  readonly kindCount: number;
  readonly relationCount: number;
  readonly userCount: number;
}

interface ProjectCard {
  readonly entity: Entity;
  readonly score: number;
  /** 0–100, normalised against the max observed score in the batch. */
  readonly percent: number;
}

interface HomeOptions {
  readonly currentUser: User;
  readonly activeContext?: string;
  readonly contexts: string[];
  readonly stats: HomeStats;
  readonly projects: ProjectCard[];
  readonly recentEntities: Entity[];
  readonly recentActivity: ActivityLogEntry[];
  /** Map from entity id → title for enriching activity feed entries. */
  readonly activityEntityTitles: Map<string, string>;
  readonly csrfToken: string;
}

/** Small ring used on every project card. Mirrors buddy's MiniHealthRing
 *  visual, but shows a relative activity percentage (0–100) rather than
 *  an A/B/C/D score. */
function miniActivityRing(percent: number): string {
  const radius = 14;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.max(0, Math.min(100, percent)) / 100) * circumference;
  // Warm earth-tone palette, same feel as buddy.
  const color =
    percent >= 75 ? '#4a7a4a' :
    percent >= 50 ? '#8a7350' :
    percent >= 25 ? '#c4b080' :
    percent > 0 ? '#c08060' : '#bbbbbb';
  return `
    <svg width="36" height="36" viewBox="0 0 36 36" style="flex-shrink:0">
      <circle cx="18" cy="18" r="${radius}" fill="none" stroke="var(--color-border)" stroke-width="3" />
      <circle cx="18" cy="18" r="${radius}" fill="none"
        stroke="${color}" stroke-width="3"
        stroke-dasharray="${circumference}"
        stroke-dashoffset="${offset}"
        stroke-linecap="round"
        transform="rotate(-90 18 18)" />
      <text x="18" y="22" text-anchor="middle" font-size="9" font-weight="700"
        fill="${color}" font-family="var(--font-mono)">${percent}</text>
    </svg>`;
}

function actionLabel(action: string): string {
  switch (action) {
    case 'save_entity':    return 'created';
    case 'update_entity':  return 'updated';
    case 'archive_entity': return 'archived';
    case 'link_entities':  return 'linked';
    case 'unlink_entity':  return 'unlinked';
    default:               return action;
  }
}

function renderActivityItem(entry: ActivityLogEntry, titleMap: Map<string, string>): string {
  const when = formatDate(entry.timestamp);
  const who = entry.user_name ? escapeHtml(entry.user_name) : 'system';
  const action = escapeHtml(actionLabel(entry.action));
  // Show entity title instead of raw ID when available.
  const targetId = entry.target_id ?? '';
  const title = titleMap.get(targetId);
  const targetHref =
    entry.target_type === 'entity' && targetId
      ? `/entities/${encodeURIComponent(targetId)}`
      : null;
  const targetLabel = title
    ? escapeHtml(title.length > 35 ? title.slice(0, 35) + '…' : title)
    : (targetId ? escapeHtml(targetId.replace(/^entities:/, '').slice(0, 10)) : '—');
  const targetHtml = targetHref
    ? `<a href="${targetHref}" style="color:inherit;text-decoration:underline;text-decoration-color:var(--color-ghost)">${targetLabel}</a>`
    : targetLabel;
  return `
    <li>
      <time>${escapeHtml(when)}</time>
      <span>${who}</span>
      <span style="color:var(--color-muted);margin:0 0.31rem">·</span>
      <span>${action}</span>
      <span style="color:var(--color-muted);margin:0 0.31rem">·</span>
      <span style="font-size:0.85rem">${targetHtml}</span>
    </li>`;
}

function contextFilterBar(activeContext: string | undefined, contexts: string[]): string {
  if (contexts.length === 0) return '';
  const allActive = !activeContext;
  const allCls = allActive ? 'badge badge-status badge-active' : 'badge';
  const allStyle = allActive ? '' : 'color:var(--color-subtle);border:1px solid var(--color-border)';
  const allBadge = `<a href="/" class="${allCls}" style="${allStyle}">All</a>`;
  const ctxBadges = contexts.map((ctx) => {
    const isActive = activeContext === ctx;
    const cls = `badge badge-${ctx}${isActive ? ' badge-status badge-active' : ''}`;
    const style = isActive ? 'outline:2px solid var(--color-ink);outline-offset:1px' : '';
    return `<a href="/?context=${encodeURIComponent(ctx)}" class="${cls}" style="${style}">${ctx}</a>`;
  }).join('');
  return `
    <div style="display:flex;align-items:center;gap:0.62rem;margin-bottom:0.77rem;flex-wrap:wrap">
      ${allBadge}${ctxBadges}
    </div>`;
}

export function renderHome(opts: HomeOptions): string {
  const { currentUser, activeContext, contexts, stats, projects, recentEntities, recentActivity, activityEntityTitles, csrfToken } = opts;

  const projectTiles = projects.length === 0
    ? '<p class="empty">No projects in this context yet. Projects are created via MCP (save_entity with kind=project).</p>'
    : projects.map(({ entity, score, percent }) => `
        <a href="/entities/${encodeURIComponent(entity.id)}" style="text-decoration:none;color:inherit">
          <div class="bento-tile">
            <div style="display:flex;align-items:center;gap:10px">
              ${miniActivityRing(percent)}
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                  <span style="font-weight:600;font-size:0.92rem;color:var(--color-ink)">${escapeHtml(entity.title)}</span>
                  ${contextBadge(entity.context)}
                </div>
                ${entity.body
                  ? `<p class="truncate-2" style="font-size:0.85rem;color:var(--color-muted);margin-top:2px">${escapeHtml(stripMarkdown(entity.body).slice(0, 160))}</p>`
                  : ''}
              </div>
              <div style="text-align:right;flex-shrink:0">
                <div style="font-family:var(--font-mono);font-size:0.77rem;font-weight:600;color:var(--color-mid)">${score} pt</div>
                <div style="font-family:var(--font-mono);font-size:0.69rem;color:var(--color-subtle)">30d</div>
              </div>
            </div>
          </div>
        </a>`).join('');

  const recentEntitiesHtml = recentEntities.length === 0
    ? '<p class="empty">No entities yet. Entities are created via MCP (save_entity).</p>'
    : recentEntities.map((e) => `
        <a href="/entities/${encodeURIComponent(e.id)}" style="text-decoration:none;color:inherit">
          <div class="bento-tile">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px">
              ${kindBadge(e.kind)}
              ${contextBadge(e.context)}
              <span style="margin-left:auto;font-family:var(--font-mono);font-size:0.69rem;color:var(--color-light)">${escapeHtml(formatDate(e.updated_at))}</span>
            </div>
            <div style="font-size:0.92rem;font-weight:600;color:var(--color-ink)">${escapeHtml(e.title)}</div>
          </div>
        </a>`).join('');

  const activityItems = recentActivity.length === 0
    ? '<p class="empty">No activity yet. MCP calls appear here as soon as entities are created or linked.</p>'
    : `<ul class="activity-list">${recentActivity.map((a) => renderActivityItem(a, activityEntityTitles)).join('')}</ul>`;

  const body = html`
    <h1 style="margin-bottom:0.62rem">Dashboard</h1>

    ${raw(contextFilterBar(activeContext, contexts))}

    <div class="bento-grid">
      <div class="bento-projects">
        <h2>Projects</h2>
        ${raw(projectTiles)}

        <h2 style="margin-top:1.23rem">Recently updated</h2>
        ${raw(recentEntitiesHtml)}
      </div>

      <div class="bento-sidebar">
        <div>
          <h2>Activity</h2>
          ${raw(activityItems)}
        </div>
      </div>
    </div>

    <div class="usage-widget" style="margin-top:1.85rem">
      <div class="usage-count"><strong>${stats.entityCount}</strong> Entities</div>
      <span class="usage-sep">&middot;</span>
      <div class="usage-count"><strong>${stats.activeEdgeCount}</strong> Edges</div>
      <span class="usage-sep">&middot;</span>
      <div class="usage-count"><strong>${stats.kindCount}</strong> Kinds</div>
      <span class="usage-sep">&middot;</span>
      <div class="usage-count"><strong>${stats.relationCount}</strong> Relations</div>
      <span class="usage-sep">&middot;</span>
      <div class="usage-count"><strong>${stats.userCount}</strong> Users</div>
    </div>
  `;

  return layout({
    title: 'Dashboard',
    body,
    currentUser,
    activePath: '/',
    csrfToken,
  });
}
