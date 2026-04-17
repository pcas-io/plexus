/**
 * Dashboard + pages router.
 *
 * Mounts at root '/' and serves all HTML pages + a small JSON API for
 * the graph view. All routes (except /bootstrap and /api/graph's auth
 * check) require a valid session cookie.
 */

import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import type { PlexusConfig } from '../config.js';
import type { User, UserRepository } from '../db/repositories/users.js';
import type { PasskeyRepository } from '../db/repositories/passkeys.js';
import type { SessionRepository } from '../db/repositories/sessions.js';
import type { EntityRepository, Entity } from '../db/repositories/entities.js';
import type { EdgeRepository, Edge } from '../db/repositories/edges.js';
import type { ActivityLogRepository } from '../db/repositories/activity_log.js';
import type { OAuthRepository } from '../db/repositories/oauth.js';
import type { KindRegistry, RelationRegistry } from '../mcp/registries.js';
import type { WebAuthnService } from '../auth/webauthn.js';
import { ensureCsrfToken } from '../auth/csrf.js';
import { hashToken } from '../auth/tokens.js';
import { readSessionCookie, clearSessionCookie } from '../auth/sessions.js';
import { stripMarkdown } from '../ui/layout.js';
import { renderHome } from '../ui/pages/home.js';
import { renderEntitiesList } from '../ui/pages/entities.js';
import { renderEntityDetail } from '../ui/pages/entity.js';
import { renderGraphPage } from '../ui/pages/graph.js';
import { renderUsersList } from '../ui/pages/users.js';
import { mountAuditRoutes } from './audit.js';
import { renderSessionsList } from '../ui/pages/sessions.js';
import { renderBootstrapPage } from '../ui/pages/bootstrap.js';
import { renderOAuthClients } from '../ui/pages/oauth_clients.js';
import { renderPasskeysPage } from '../ui/pages/passkeys.js';
import { renderHelpPage } from '../ui/pages/help.js';
import { buildGraphPayload } from './graph_payload.js';
import { renderTokensPage } from '../ui/pages/tokens.js';
import type { PersonalTokenRepository } from '../db/repositories/personal_tokens.js';

export interface PageDeps {
  readonly config: PlexusConfig;
  readonly users: UserRepository;
  readonly passkeys: PasskeyRepository;
  readonly sessions: SessionRepository;
  readonly entities: EntityRepository;
  readonly edges: EdgeRepository;
  readonly activity: ActivityLogRepository;
  readonly oauth: OAuthRepository;
  readonly personalTokens: PersonalTokenRepository;
  readonly webauthn: WebAuthnService;
  readonly kinds: KindRegistry;
  readonly relations: RelationRegistry;
}

declare module 'hono' {
  interface ContextVariableMap {
    dashboardUser: User;
    dashboardSessionId: string;
  }
}

// ---------- Flash cookie helpers ----------
const FLASH_COOKIE = 'plexus_flash';

function setFlash(c: Context, payload: Record<string, string>): void {
  setCookie(c, FLASH_COOKIE, JSON.stringify(payload), {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: 30,
  });
}

function consumeFlash(c: Context): Record<string, string> | null {
  const rawCookie = getCookie(c, FLASH_COOKIE);
  if (!rawCookie) return null;
  deleteCookie(c, FLASH_COOKIE, { path: '/' });
  try {
    return JSON.parse(rawCookie);
  } catch {
    return null;
  }
}

// ---------- Session middleware ----------
function requireSession(deps: PageDeps): MiddlewareHandler {
  return async (c, next) => {
    const token = readSessionCookie(c);
    if (!token) return c.redirect('/auth/login');
    const session = await deps.sessions.findActiveByTokenHash(hashToken(token));
    if (!session) {
      clearSessionCookie(c);
      return c.redirect('/auth/login');
    }
    const user = await deps.users.findById(session.user);
    if (!user || !user.is_active) {
      await deps.sessions.revoke(session.id);
      clearSessionCookie(c);
      return c.redirect('/auth/login');
    }
    await deps.sessions.touch(session.id);
    c.set('dashboardUser', user);
    c.set('dashboardSessionId', session.id);
    await next();
    return;
  };
}

function requireAdmin(): MiddlewareHandler {
  return async (c, next) => {
    const user = c.get('dashboardUser');
    if (!user?.is_admin) {
      return c.html('Nicht autorisiert', 403);
    }
    await next();
    return;
  };
}

function checkCsrf(c: Context, form: Record<string, unknown>): boolean {
  const cookie = ensureCsrfToken(c);
  const submitted = typeof form._csrf === 'string' ? form._csrf : '';
  return submitted !== '' && submitted === cookie;
}

function checkCsrfHeader(c: Context): boolean {
  const cookie = ensureCsrfToken(c);
  const submitted = c.req.header('X-Csrf-Token') ?? '';
  return submitted !== '' && submitted === cookie;
}

function flashFrom(raw: Record<string, string> | null): { type: 'success' | 'danger' | 'info'; message: string; token?: string; tokenUser?: string } | undefined {
  if (!raw) return undefined;
  return {
    type: (raw.type as 'success' | 'danger' | 'info') ?? 'info',
    message: raw.message ?? '',
    ...(raw.token ? { token: raw.token } : {}),
    ...(raw.tokenUser ? { tokenUser: raw.tokenUser } : {}),
  };
}

export function pagesRoutes(deps: PageDeps): Hono {
  const app = new Hono();

  // ============================================================
  // Bootstrap (public, gated by pending_auth cookie)
  // ============================================================
  app.get('/bootstrap', async (c) => {
    const pending = getCookie(c, 'plexus_pending_auth');
    if (pending !== '__admin_bootstrap__') return c.redirect('/auth/login');
    const csrfToken = ensureCsrfToken(c);
    const flash = flashFrom(consumeFlash(c));
    return c.html(renderBootstrapPage({ csrfToken, flash: flash as { type: 'success' | 'danger'; message: string; token?: string } | undefined }));
  });

  app.post('/bootstrap', async (c) => {
    const pending = getCookie(c, 'plexus_pending_auth');
    if (pending !== '__admin_bootstrap__') return c.redirect('/auth/login');
    const form = await c.req.parseBody();
    if (!checkCsrf(c, form)) return c.text('CSRF mismatch', 403);
    const all = await deps.users.list();
    if (all.some((u) => u.is_admin && u.is_active)) {
      setFlash(c, { type: 'danger', message: 'Ein Admin existiert bereits.' });
      return c.redirect('/bootstrap');
    }
    const name = typeof form.name === 'string' ? form.name.trim() : '';
    if (!name || !/^[a-zA-Z0-9_.-]+$/.test(name) || name.length > 64) {
      setFlash(c, { type: 'danger', message: 'Invalid name.' });
      return c.redirect('/bootstrap');
    }
    try {
      const result = await deps.users.create(name, true);
      setFlash(c, { type: 'success', message: `Admin user "${name}" created.`, token: result.token });
    } catch {
      setFlash(c, { type: 'danger', message: 'Failed to create user.' });
    }
    return c.redirect('/bootstrap');
  });

  app.post('/bootstrap/continue', async (c) => {
    deleteCookie(c, 'plexus_pending_auth', { path: '/' });
    return c.redirect('/auth/login');
  });

  // ============================================================
  // All routes below require a session
  // ============================================================
  app.use('*', requireSession(deps));

  // ---------- Home (READ-ONLY) ----------
  // Bento-Layout analog zu buddy's home.tsx:
  //   - Context-Filter-Bar oben
  //   - links: Projekt-Cards (kind=project) mit Mini-Activity-Ring (30d)
  //   - rechts: Recent-Activity-Feed aus activity_log
  //   - unten:  Usage-Widget (Zaehler ueber alle Kinds)
  // Score-Berechnung ist Option 1 aus buddy decision 01KNFGGMBV1RTTNGZZSQTKYVKM.
  app.get('/', async (c) => {
    const user = c.get('dashboardUser');
    const csrfToken = ensureCsrfToken(c);
    const url = new URL(c.req.url);
    const activeContext = url.searchParams.get('context') ?? undefined;

    const projectFilter = { kind: 'project', context: activeContext, limit: 12 };
    const [
      entityCount,
      usedContexts,
      kinds,
      relations,
      allUsers,
      projects,
      recentEntities,
      recentActivity,
      scoreMap,
    ] = await Promise.all([
      deps.entities.count(),
      deps.entities.distinctContexts(),
      deps.kinds.list(),
      deps.relations.list(),
      deps.users.list(),
      deps.entities.list(projectFilter),
      deps.entities.list({ context: activeContext, limit: 8 }),
      deps.activity.listRecent(20, { onlyGraph: true }),
      deps.activity.scoreMap(30),
    ]);

    const projectScores = projects.map((p) => ({
      entity: p,
      score: scoreMap.get(p.id) ?? 0,
    }));
    const maxScore = Math.max(1, ...projectScores.map((p) => p.score));

    let activeEdgeCount = 0;
    for (const p of projects) {
      activeEdgeCount += await deps.edges.countActiveForEntity(p.id);
    }

    // Build a title lookup for the activity feed so entries show
    // "plexus" instead of "fbq6bjxsrn3sk41psf2e".
    const activityEntityTitles = new Map<string, string>();
    const activityEntityIds = new Set<string>();
    for (const a of recentActivity) {
      if (a.target_type === 'entity' && a.target_id) activityEntityIds.add(a.target_id);
    }
    for (const id of activityEntityIds) {
      const e = await deps.entities.get(id);
      if (e) activityEntityTitles.set(e.id, e.title);
    }

    return c.html(
      renderHome({
        currentUser: user,
        activeContext,
        contexts: usedContexts,
        stats: {
          entityCount,
          activeEdgeCount,
          kindCount: kinds.length,
          relationCount: relations.length,
          userCount: allUsers.length,
        },
        projects: projectScores.map(({ entity, score }) => ({
          entity,
          score,
          percent: Math.round((score / maxScore) * 100),
        })),
        recentEntities,
        recentActivity,
        activityEntityTitles,
        csrfToken,
      })
    );
  });

  // ---------- Entities browser (READ-ONLY) ----------
  // Dashboard zeigt Entities nur an — schreiben ausschliesslich ueber MCP.
  app.get('/entities', async (c) => {
    const user = c.get('dashboardUser');
    const csrfToken = ensureCsrfToken(c);
    const url = new URL(c.req.url);
    const q = (url.searchParams.get('q') || '').trim();
    const kind = url.searchParams.get('kind') || undefined;
    const context = url.searchParams.get('context') || undefined;
    const status = url.searchParams.get('status') || undefined;
    // "Tasks einblenden" checkbox. Defaults to off so the browse view
    // stays readable — tasks tend to dominate by sheer count. When the
    // user explicitly picks kind=task from the dropdown, the toggle is
    // irrelevant: list() lets the explicit kind filter win.
    const showTasks = url.searchParams.get('show_tasks') === '1';

    // When a search query is present we route through the BM25 FTS path
    // (migrations/0006_fts.surql). search() ignores the status and
    // excludeKinds filters — the user explicitly asked for something
    // and deserves to see every hit. The list() path honours status
    // and hides tasks unless the user opts in.
    const [entities, kinds, usedContexts] = await Promise.all([
      q
        ? deps.entities.search(q, { kind, context, limit: 100, highlight: true })
        : deps.entities.list({
            kind,
            context,
            status,
            excludeKinds: showTasks ? undefined : ['task'],
            limit: 100,
          }),
      deps.kinds.list(),
      deps.entities.distinctContexts(),
    ]);
    return c.html(
      renderEntitiesList({
        currentUser: user,
        entities,
        kinds,
        contexts: usedContexts,
        filterQuery: q || undefined,
        filterKind: kind,
        filterContext: context,
        filterStatus: status,
        filterShowTasks: showTasks,
        csrfToken,
      })
    );
  });

  // JSON search endpoint for the global ⌘K command palette.
  // Session-gated (inherits requireSession middleware from the router).
  // Always uses BM25 full-text search with highlights on title. Strips
  // the body down to a 140-char plain-text snippet so the response
  // stays small on the wire.
  app.get('/api/search', async (c) => {
    const url = new URL(c.req.url);
    const q = (url.searchParams.get('q') || '').trim();
    const limitRaw = parseInt(url.searchParams.get('limit') || '8', 10);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 8, 1), 20);
    if (!q) return c.json({ results: [] });
    try {
      const results = await deps.entities.search(q, { limit, highlight: true });
      const payload = results.map((e) => ({
        id: e.id,
        kind: e.kind,
        context: e.context,
        // title may contain <mark>…</mark> from search::highlight() —
        // the client renders those into real DOM <mark> elements.
        title: e.title,
        snippet: e.body
          ? stripMarkdown(e.body).slice(0, 140)
          : null,
      }));
      return c.json({ results: payload });
    } catch (err) {
      console.error('[api/search] failed:', err);
      return c.json({ error: 'search_failed', message: (err as Error).message }, 500);
    }
  });

  app.get('/entities/:id', async (c) => {
    const user = c.get('dashboardUser');
    const csrfToken = ensureCsrfToken(c);
    const id = decodeURIComponent(c.req.param('id'));
    const entity = await deps.entities.get(id);
    if (!entity) return c.html('Entity nicht gefunden', 404);
    const activeEdges = await deps.edges.getRelated(id, { direction: 'both' });
    const enriched: Array<{ edge: Edge; otherEntity: Entity | null; direction: 'out' | 'in' }> = [];
    for (const edge of activeEdges) {
      const isOut = edge.from_entity === entity.id;
      const otherId = isOut ? edge.to_entity : edge.from_entity;
      const otherEntity = await deps.entities.get(otherId);
      enriched.push({ edge, otherEntity, direction: isOut ? 'out' : 'in' });
    }
    return c.html(
      renderEntityDetail({
        currentUser: user,
        entity,
        edges: enriched,
        csrfToken,
      })
    );
  });

  // ---------- Graph ----------
  app.get('/graph', async (c) => {
    const user = c.get('dashboardUser');
    const csrfToken = ensureCsrfToken(c);
    return c.html(renderGraphPage({ currentUser: user, csrfToken }));
  });

  app.get('/api/graph', async (c) => {
    // Structural graph endpoint. Two parallel DB calls instead of the
    // previous N+1 (one getRelated per entity). The response carries
    // a meta object with orphan_count + dropped_edges so the D3 layer
    // can tell the user whether floating dots are truly-orphan or
    // just cut by the result limit. See src/routes/graph_payload.ts
    // for the pure builder — this route is thin glue.
    //
    // Query params:
    //   ?context=<name>  — filter entities to one context (default: all
    //                      contexts the user has access to)
    //   ?limit=<n>       — max entities to return (default 2000, max 5000)
    const url = new URL(c.req.url);
    const contextParam = url.searchParams.get('context');
    const limitParam = Number(url.searchParams.get('limit') ?? '2000');
    const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : 2000, 1), 5000);

    const entityFilter: { context?: string; limit: number } = { limit };
    if (contextParam) entityFilter.context = contextParam;

    const [entities, activeEdges] = await Promise.all([
      deps.entities.list(entityFilter),
      deps.edges.listAllActive(),
    ]);

    const payload = buildGraphPayload(entities, activeEdges, contextParam);
    return c.json(payload);
  });

  // ---------- Users (admin only) ----------
  app.get('/users', requireAdmin(), async (c) => {
    const user = c.get('dashboardUser');
    const csrfToken = ensureCsrfToken(c);
    const [allUsers, usedContexts, allKinds] = await Promise.all([
      deps.users.list(),
      deps.entities.distinctContexts(),
      deps.kinds.list(),
    ]);
    const flash = flashFrom(consumeFlash(c));
    return c.html(
      renderUsersList({
        currentUser: user,
        users: allUsers,
        contexts: usedContexts,
        kinds: allKinds.map((k) => k.name),
        csrfToken,
        flash,
      })
    );
  });

  app.post('/users', requireAdmin(), async (c) => {
    const form = await c.req.parseBody();
    if (!checkCsrf(c, form)) return c.text('CSRF mismatch', 403);
    const name = typeof form.name === 'string' ? form.name.trim() : '';
    const isAdmin = form.is_admin === 'true';
    if (!name || !/^[a-zA-Z0-9_.-]+$/.test(name) || name.length > 64) {
      setFlash(c, { type: 'danger', message: 'Ungueltiger Name.' });
      return c.redirect('/users');
    }
    // Parse token scope from form fields.
    const scopePermission = typeof form.scope_permission === 'string'
      ? form.scope_permission as 'read' | 'write' | 'admin' : 'write';
    const label = typeof form.label === 'string' && form.label.trim() ? form.label.trim() : 'default';
    const expiresRaw = typeof form.expires_in_days === 'string' ? parseInt(form.expires_in_days, 10) : 0;
    // scope_contexts can be a single string or an array depending on how many checkboxes are checked.
    let scopeContexts: string[] = [];
    if (typeof form.scope_contexts === 'string') {
      scopeContexts = [form.scope_contexts];
    } else if (Array.isArray(form.scope_contexts)) {
      scopeContexts = form.scope_contexts.filter((v): v is string => typeof v === 'string');
    }
    let scopeKinds: string[] = [];
    if (typeof form.scope_kinds === 'string') {
      scopeKinds = [form.scope_kinds];
    } else if (Array.isArray(form.scope_kinds)) {
      scopeKinds = form.scope_kinds.filter((v): v is string => typeof v === 'string');
    }
    try {
      const result = await deps.users.create(name, isAdmin, {
        permission: scopePermission,
        contexts: scopeContexts.length > 0 ? scopeContexts : undefined,
        kinds: scopeKinds.length > 0 ? scopeKinds : undefined,
        label,
        expiresInDays: expiresRaw > 0 ? expiresRaw : undefined,
      });
      setFlash(c, {
        type: 'success',
        message: `User "${name}" created.`,
        token: result.token,
        tokenUser: name,
      });
    } catch (err) {
      const msg = (err as Error).message ?? '';
      setFlash(c, {
        type: 'danger',
        message: msg.includes('already exists') || msg.includes('Duplicated')
          ? 'User already exists.'
          : 'Failed to create user.',
      });
    }
    return c.redirect('/users');
  });

  app.post('/users/:name/reset-token', requireAdmin(), async (c) => {
    const form = await c.req.parseBody();
    if (!checkCsrf(c, form)) return c.text('CSRF mismatch', 403);
    const name = c.req.param('name');
    const result = await deps.users.resetToken(name);
    if (!result) {
      setFlash(c, { type: 'danger', message: `User "${name}" not found.` });
    } else {
      setFlash(c, {
        type: 'success',
        message: `Neuer Token fuer "${name}".`,
        token: result.token,
        tokenUser: name,
      });
    }
    return c.redirect('/users');
  });

  app.post('/users/:name/deactivate', requireAdmin(), async (c) => {
    const form = await c.req.parseBody();
    if (!checkCsrf(c, form)) return c.text('CSRF mismatch', 403);
    const name = c.req.param('name');
    const currentUser = c.get('dashboardUser');
    if (name === currentUser.name) {
      setFlash(c, { type: 'danger', message: 'You cannot deactivate yourself.' });
      return c.redirect('/users');
    }
    const user = await deps.users.deactivate(name);
    if (!user) {
      setFlash(c, { type: 'danger', message: `User "${name}" not found.` });
    } else {
      setFlash(c, { type: 'success', message: `User "${name}" deactivated.` });
    }
    return c.redirect('/users');
  });

  // ---------- Audit log (admin only) — extracted to routes/audit.ts ----------
  mountAuditRoutes(app, { activity: deps.activity, users: deps.users }, requireAdmin);

  // ---------- Sessions ----------
  app.get('/sessions', async (c) => {
    const user = c.get('dashboardUser');
    const csrfToken = ensureCsrfToken(c);
    const active = await deps.sessions.listActiveForUser(user.id);
    const flash = flashFrom(consumeFlash(c));
    return c.html(
      renderSessionsList({
        currentUser: user,
        sessions: active,
        currentSessionId: c.get('dashboardSessionId'),
        csrfToken,
        flash: flash as { type: 'success' | 'danger' | 'info'; message: string } | undefined,
      })
    );
  });

  app.post('/sessions/:id/revoke', async (c) => {
    const form = await c.req.parseBody();
    if (!checkCsrf(c, form)) return c.text('CSRF mismatch', 403);
    const id = c.req.param('id');
    const user = c.get('dashboardUser');
    const currentSessionId = c.get('dashboardSessionId');
    if (id === currentSessionId) {
      setFlash(c, { type: 'danger', message: 'Aktuelle Session via Logout beenden.' });
      return c.redirect('/sessions');
    }
    const active = await deps.sessions.listActiveForUser(user.id);
    if (!active.some((s) => String(s.id) === id)) {
      setFlash(c, { type: 'danger', message: 'Session not found.' });
      return c.redirect('/sessions');
    }
    await deps.sessions.revoke(id);
    setFlash(c, { type: 'success', message: 'Session beendet.' });
    return c.redirect('/sessions');
  });

  // ---------- Personal Tokens ----------
  app.get('/tokens', async (c) => {
    const user = c.get('dashboardUser');
    const csrfToken = ensureCsrfToken(c);
    const [tokens, usedContexts, allKinds] = await Promise.all([
      deps.personalTokens.listForUser(user.id),
      deps.entities.distinctContexts(),
      deps.kinds.list(),
    ]);
    const flash = flashFrom(consumeFlash(c));
    return c.html(
      renderTokensPage({
        currentUser: user,
        tokens,
        contexts: usedContexts,
        kinds: allKinds.map((k) => k.name),
        csrfToken,
        flash: flash as { type: 'success' | 'danger' | 'info'; message: string; token?: string } | undefined,
      })
    );
  });

  app.post('/tokens/create', async (c) => {
    const user = c.get('dashboardUser');
    const form = await c.req.parseBody();
    if (!checkCsrf(c, form)) return c.text('CSRF mismatch', 403);
    const label = typeof form.label === 'string' && form.label.trim() ? form.label.trim() : 'unnamed';
    const perm = typeof form.scope_permission === 'string' ? form.scope_permission as 'read' | 'write' | 'admin' : 'write';
    const expiresRaw = typeof form.expires_in_days === 'string' ? parseInt(form.expires_in_days, 10) : 0;
    let scopeContexts: string[] = [];
    if (typeof form.scope_contexts === 'string') scopeContexts = [form.scope_contexts];
    else if (Array.isArray(form.scope_contexts)) scopeContexts = form.scope_contexts.filter((v): v is string => typeof v === 'string');
    let scopeKinds: string[] = [];
    if (typeof form.scope_kinds === 'string') scopeKinds = [form.scope_kinds];
    else if (Array.isArray(form.scope_kinds)) scopeKinds = form.scope_kinds.filter((v): v is string => typeof v === 'string');

    // Generate a new token for the current user.
    const { generatePersonalToken, hashToken: ht } = await import('../auth/tokens.js');
    const rawToken = generatePersonalToken();
    const tokenHash = ht(rawToken);
    try {
      await deps.personalTokens.create({
        userId: user.id,
        tokenHash,
        label,
        scopePermission: perm,
        scopeContexts: scopeContexts.length > 0 ? scopeContexts : undefined,
        scopeKinds: scopeKinds.length > 0 ? scopeKinds : undefined,
        expiresInDays: expiresRaw > 0 ? expiresRaw : undefined,
      });
      setFlash(c, { type: 'success', message: `Token "${label}" created.`, token: rawToken });
    } catch (err) {
      setFlash(c, { type: 'danger', message: 'Token creation failed.' });
    }
    return c.redirect('/tokens');
  });

  app.post('/tokens/:id/revoke', async (c) => {
    const user = c.get('dashboardUser');
    const form = await c.req.parseBody();
    if (!checkCsrf(c, form)) return c.text('CSRF mismatch', 403);
    const tokenId = decodeURIComponent(c.req.param('id'));
    // Only allow revoking own tokens.
    const tokens = await deps.personalTokens.listForUser(user.id);
    const activeTokens = tokens.filter((t) => !t.revoked_at && (!t.expires_at || Date.parse(t.expires_at) > Date.now()));
    if (!tokens.some((t) => t.id === tokenId)) {
      setFlash(c, { type: 'danger', message: 'Token not found.' });
      return c.redirect('/tokens');
    }
    if (activeTokens.length <= 1) {
      setFlash(c, { type: 'danger', message: 'The last active token cannot be revoked.' });
      return c.redirect('/tokens');
    }
    await deps.personalTokens.revoke(tokenId);
    setFlash(c, { type: 'success', message: 'Token revoked.' });
    return c.redirect('/tokens');
  });

  // ---------- Passkey Management ----------
  app.get('/passkeys', async (c) => {
    const user = c.get('dashboardUser');
    const csrfToken = ensureCsrfToken(c);
    const userPasskeys = await deps.passkeys.listForUser(user.id);
    const flash = flashFrom(consumeFlash(c));
    return c.html(
      renderPasskeysPage({
        currentUser: user,
        passkeys: userPasskeys,
        csrfToken,
        flash: flash as { type: 'success' | 'danger' | 'info'; message: string } | undefined,
      })
    );
  });

  app.post('/passkeys/enroll/start', async (c) => {
    const user = c.get('dashboardUser');
    if (!checkCsrfHeader(c)) return c.json({ error: 'csrf_mismatch' }, 403);
    const existing = await deps.passkeys.listForUser(user.id);
    if (existing.length >= 3) {
      return c.json({ error: 'max_passkeys', message: 'Maximum 3 Passkeys pro Account.' }, 400);
    }
    const options = await deps.webauthn.generateEnrollmentOptions(
      user.id,
      user.name,
      existing.map((p) => p.credential_id)
    );
    return c.json(options);
  });

  app.post('/passkeys/enroll/finish', async (c) => {
    const user = c.get('dashboardUser');
    if (!checkCsrfHeader(c)) return c.json({ error: 'csrf_mismatch' }, 403);
    const existing = await deps.passkeys.listForUser(user.id);
    if (existing.length >= 3) {
      return c.json({ error: 'max_passkeys' }, 400);
    }
    let body: { response?: unknown };
    try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
    const response = body.response;
    if (!response || typeof response !== 'object') return c.json({ error: 'invalid_response' }, 400);
    try {
      const result = await deps.webauthn.verifyEnrollment(
        user.id,
        response as Parameters<typeof deps.webauthn.verifyEnrollment>[1]
      );
      await deps.passkeys.create({
        userId: user.id,
        credentialId: result.credentialId,
        publicKey: result.publicKey,
        counter: result.counter,
        transports: result.transports,
        deviceName: (c.req.header('User-Agent') ?? 'unknown').slice(0, 120),
      });
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: 'enrollment_failed', message: (err as Error).message }, 400);
    }
  });

  app.post('/passkeys/:credentialId/delete', async (c) => {
    const user = c.get('dashboardUser');
    const form = await c.req.parseBody();
    if (!checkCsrf(c, form)) return c.text('CSRF mismatch', 403);
    const credentialId = decodeURIComponent(c.req.param('credentialId'));
    const existing = await deps.passkeys.listForUser(user.id);
    if (existing.length <= 1) {
      setFlash(c, { type: 'danger', message: 'The last passkey cannot be removed.' });
      return c.redirect('/passkeys');
    }
    // Only allow deleting own passkeys.
    if (!existing.some((p) => p.credential_id === credentialId)) {
      setFlash(c, { type: 'danger', message: 'Passkey not found.' });
      return c.redirect('/passkeys');
    }
    await deps.passkeys.deleteByCredentialId(credentialId);
    setFlash(c, { type: 'success', message: 'Passkey entfernt.' });
    return c.redirect('/passkeys');
  });

  // ---------- Help ----------
  app.get('/help', async (c) => {
    const user = c.get('dashboardUser');
    const csrfToken = ensureCsrfToken(c);
    return c.html(renderHelpPage({ currentUser: user, csrfToken }));
  });

  // ---------- OAuth Clients ----------
  app.get('/oauth/clients', async (c) => {
    const user = c.get('dashboardUser');
    const csrfToken = ensureCsrfToken(c);
    const grants = await deps.oauth.listGrantedClientsForUser(user.id);
    return c.html(
      renderOAuthClients({
        currentUser: user,
        grants,
        csrfToken,
      })
    );
  });

  app.post('/oauth/clients/:id/revoke', async (c) => {
    const user = c.get('dashboardUser');
    const form = await c.req.parseBody();
    if (!checkCsrf(c, form)) return c.text('CSRF mismatch', 403);
    const clientId = decodeURIComponent(c.req.param('id'));
    await deps.oauth.revokeClientForUser(clientId, user.id);
    setFlash(c, { type: 'success', message: 'Client access revoked.' });
    return c.redirect('/oauth/clients');
  });

  return app;
}
