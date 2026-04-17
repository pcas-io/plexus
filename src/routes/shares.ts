/**
 * Share-Link routes — Dashboard-only, step-up-passkey protected.
 *
 * Per the Kickoff-ADR (buddy 01KNF08JS7VKWPRYF1N8Q8ESMB) and the
 * Auth-ADR (01KNF1YX0DS7BEKAF2EF6F8TG1), share-link operations live
 * exclusively in the dashboard. There is NO MCP tool for share create,
 * list, consume or revoke — that is by design, to prevent a
 * compromised agent token from exfiltrating data through share links.
 *
 * Routes:
 *
 *   POST /shares/step-up/start   — start a WebAuthn step-up challenge
 *                                  bound to a specific entity_id
 *   POST /shares/step-up/finish  — verify passkey, create the share
 *                                  token, return the raw URL
 *   POST /shares/:id/revoke      — revoke an active share token
 *   GET  /shares                 — management view (active/consumed/
 *                                  inactive tabs)
 *
 * And a separate mount at /share for public consumption:
 *
 *   GET  /share/:token           — consume a one-time share link and
 *                                  render the entity read-only
 *
 * All share-mutating actions (create, consume, revoke) append an
 * entry to activity_log with target_type='share'.
 */

import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import { randomBytes, createHash } from 'node:crypto';
import type { UserRepository } from '../db/repositories/users.js';
import type { PasskeyRepository } from '../db/repositories/passkeys.js';
import type { SessionRepository } from '../db/repositories/sessions.js';
import type { EntityRepository } from '../db/repositories/entities.js';
import type { ShareTokenRepository } from '../db/repositories/share_tokens.js';
import type { ActivityLogRepository } from '../db/repositories/activity_log.js';
import type { WebAuthnService } from '../auth/webauthn.js';
import { ensureCsrfToken } from '../auth/csrf.js';
import { readSessionCookie, clearSessionCookie } from '../auth/sessions.js';
import { hashToken } from '../auth/tokens.js';
import { RateLimiter } from '../auth/rate_limit.js';
import { renderSharesList } from '../ui/pages/shares.js';
import { renderSharedEntity } from '../ui/pages/shared_entity.js';
import {
  parseShareFormat,
  renderSharedEntityMarkdown,
  renderSharedEntityJson,
  CONTENT_TYPES,
} from '../ui/pages/shared_entity_formats.js';
import { layout, html } from '../ui/layout.js';

const STEP_UP_PURPOSE = 'share';
const DEFAULT_TTL_SECONDS = 60 * 60; // 60 min per ADR

export interface ShareDeps {
  readonly baseUrl: string;
  readonly users: UserRepository;
  readonly passkeys: PasskeyRepository;
  readonly sessions: SessionRepository;
  readonly entities: EntityRepository;
  readonly shares: ShareTokenRepository;
  readonly activity: ActivityLogRepository;
  readonly webauthn: WebAuthnService;
}

function clientIp(c: Context): string {
  return c.req.header('CF-Connecting-IP')
    ?? c.req.header('X-Forwarded-For')?.split(',')[0]?.trim()
    ?? 'unknown';
}

function checkCsrfForm(c: Context, form: Record<string, unknown>): boolean {
  const cookie = ensureCsrfToken(c);
  const submitted = typeof form._csrf === 'string' ? form._csrf : '';
  return submitted !== '' && submitted === cookie;
}

function checkCsrfHeader(c: Context): boolean {
  const cookie = ensureCsrfToken(c);
  const submitted = c.req.header('X-Csrf-Token') ?? '';
  return submitted !== '' && submitted === cookie;
}

function wantsHtml(c: Context): boolean {
  const accept = c.req.header('Accept') ?? '';
  return accept.includes('text/html');
}

function unauthorized(c: Context, code: string) {
  if (wantsHtml(c)) return c.redirect('/auth/login');
  return c.json({ error: code }, 401);
}

function requireSession(deps: ShareDeps): MiddlewareHandler {
  return async (c, next) => {
    const token = readSessionCookie(c);
    if (!token) return unauthorized(c, 'no_session');
    const session = await deps.sessions.findActiveByTokenHash(hashToken(token));
    if (!session) {
      clearSessionCookie(c);
      return unauthorized(c, 'session_expired');
    }
    const user = await deps.users.findById(session.user);
    if (!user || !user.is_active) {
      clearSessionCookie(c);
      return unauthorized(c, 'user_inactive');
    }
    await deps.sessions.touch(session.id);
    c.set('shareUser', user);
    await next();
    return;
  };
}

declare module 'hono' {
  interface ContextVariableMap {
    shareUser: import('../db/repositories/users.js').User;
  }
}

/**
 * Authenticated share routes — mounted at /shares. Every handler
 * requires a valid session cookie.
 */
export function shareRoutes(deps: ShareDeps): Hono {
  const app = new Hono();

  app.use('*', requireSession(deps));

  // ---------- POST /shares/step-up/start ----------
  // Requests a WebAuthn step-up challenge for the current user bound
  // to the entity they want to share. Returns the challenge JSON so
  // the frontend can call navigator.credentials.get().
  app.post('/step-up/start', async (c) => {
    const user = c.get('shareUser');
    if (!checkCsrfHeader(c)) return c.json({ error: 'csrf_mismatch' }, 403);
    let body: { entity_id?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    const entityId = typeof body.entity_id === 'string' ? body.entity_id : '';
    if (!entityId) return c.json({ error: 'missing_entity_id' }, 400);
    const entity = await deps.entities.get(entityId);
    if (!entity) return c.json({ error: 'entity_not_found' }, 404);
    if (entity.kind === 'secret') {
      return c.json({ error: 'entity_not_shareable', message: 'kind=secret entities cannot be shared.' }, 403);
    }
    const passkeys = await deps.passkeys.listForUser(user.id);
    if (passkeys.length === 0) {
      return c.json({ error: 'no_passkeys', message: 'Enroll a passkey before sharing.' }, 400);
    }
    const options = await deps.webauthn.generateStepUpOptions(
      user.id,
      STEP_UP_PURPOSE,
      passkeys.map((p) => p.credential_id)
    );
    return c.json({ options, entity: { id: entity.id, title: entity.title, kind: entity.kind } });
  });

  // ---------- POST /shares/step-up/finish ----------
  // Verifies the step-up challenge, creates a new share token, revokes
  // any previously active one for the same entity in the same call.
  // Returns the full share URL once (plaintext) and its expiry.
  app.post('/step-up/finish', async (c) => {
    const user = c.get('shareUser');
    if (!checkCsrfHeader(c)) return c.json({ error: 'csrf_mismatch' }, 403);
    let body: { entity_id?: unknown; response?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    const entityId = typeof body.entity_id === 'string' ? body.entity_id : '';
    const response = body.response;
    if (!entityId || !response || typeof response !== 'object') {
      return c.json({ error: 'invalid_request' }, 400);
    }
    const entity = await deps.entities.get(entityId);
    if (!entity) return c.json({ error: 'entity_not_found' }, 404);
    if (entity.kind === 'secret') {
      return c.json({ error: 'entity_not_shareable' }, 403);
    }

    const authRespId = (response as { id?: unknown }).id;
    if (typeof authRespId !== 'string') {
      return c.json({ error: 'invalid_response' }, 400);
    }
    const stored = await deps.passkeys.findByCredentialId(authRespId);
    if (!stored || stored.user !== user.id) {
      return c.json({ error: 'unknown_credential' }, 401);
    }

    try {
      const result = await deps.webauthn.verifyStepUp(
        user.id,
        STEP_UP_PURPOSE,
        response as Parameters<typeof deps.webauthn.verifyStepUp>[2],
        {
          id: stored.credential_id,
          publicKey: stored.public_key,
          counter: stored.counter,
        }
      );
      await deps.passkeys.updateCounter(stored.credential_id, result.newCounter);
    } catch (err) {
      return c.json({ error: 'step_up_failed', message: (err as Error).message }, 401);
    }

    // Generate a 32-byte token and store only its hash.
    const rawToken = 'st_' + randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const share = await deps.shares.create(tokenHash, {
      entityId: entity.id,
      createdByUserId: user.id,
      ttlSeconds: DEFAULT_TTL_SECONDS,
      passkeyDeviceId: stored.credential_id,
    });
    await deps.activity.create({
      userName: user.name,
      action: 'share_create',
      targetType: 'share',
      targetId: share.id,
      ip: clientIp(c),
      userAgent: c.req.header('User-Agent') ?? undefined,
      metadata: { entity_id: entity.id, entity_kind: entity.kind, expires_at: share.expires_at },
    });
    return c.json({
      ok: true,
      share: {
        id: share.id,
        url: `${deps.baseUrl.replace(/\/$/, '')}/share/${rawToken}`,
        expires_at: share.expires_at,
      },
    });
  });

  // ---------- POST /shares/:id/revoke ----------
  // Revokes an active share token by id. The revoking user must be the
  // creator or an admin; a separate step-up is NOT required (active
  // tokens can be killed quickly in case of a leak).
  app.post('/:id/revoke', async (c) => {
    const user = c.get('shareUser');
    const form = await c.req.parseBody();
    if (!checkCsrfForm(c, form)) return c.text('CSRF mismatch', 403);
    const id = decodeURIComponent(c.req.param('id'));
    const existing = await deps.shares.get(id);
    if (!existing) return c.text('share not found', 404);
    if (existing.created_by !== user.id && !user.is_admin) {
      return c.text('forbidden', 403);
    }
    const revoked = await deps.shares.revoke(id, user.id);
    if (!revoked) return c.redirect('/shares');
    await deps.activity.create({
      userName: user.name,
      action: 'share_revoke',
      targetType: 'share',
      targetId: revoked.id,
      ip: clientIp(c),
      userAgent: c.req.header('User-Agent') ?? undefined,
      metadata: { entity_id: revoked.entity },
    });
    return c.redirect('/shares');
  });

  // ---------- GET /shares ----------
  // Non-admins only see their own tokens. Admins see everything.
  app.get('/', async (c) => {
    const user = c.get('shareUser');
    const csrfToken = ensureCsrfToken(c);
    const filterUser = user.is_admin ? undefined : user.id;
    const [active, consumed, inactive] = await Promise.all([
      deps.shares.listActive(50, filterUser),
      deps.shares.listConsumed(50, filterUser),
      deps.shares.listInactive(50, filterUser),
    ]);
    // Enrich with entity titles for display.
    const ids = new Set<string>();
    for (const s of [...active, ...consumed, ...inactive]) ids.add(s.entity);
    const entities = new Map<string, { id: string; title: string; kind: string }>();
    for (const id of ids) {
      const e = await deps.entities.get(id);
      if (e) entities.set(e.id, { id: e.id, title: e.title, kind: e.kind });
    }
    return c.html(
      renderSharesList({
        currentUser: user,
        active,
        consumed,
        inactive,
        entityMap: entities,
        csrfToken,
      })
    );
  });

  return app;
}

/**
 * Public share consumption — mounted at /share. No session required,
 * rate-limited per IP. Consuming a token flips its state to "consumed"
 * permanently; a second request on the same URL returns 410 Gone.
 */
export function publicShareRoutes(deps: ShareDeps): Hono {
  const app = new Hono();

  // Rate limit: 10 requests per minute per IP, per ADR Abschnitt 3.
  const limiter = new RateLimiter(10, 60_000);

  app.get('/:token', async (c) => {
    const ip = clientIp(c);
    if (limiter.hit(ip)) {
      return c.text('rate limited', 429);
    }
    const rawToken = c.req.param('token');
    if (!rawToken || !rawToken.startsWith('st_')) {
      return c.html(
        layout({
          title: 'Ungueltiger Share-Link',
          body: html`<div class="login-page"><div class="login-box"><h1>Ungueltig</h1><p class="login-hint">Der Share-Link ist ungueltig oder abgelaufen.</p></div></div>`,
        }),
        404
      );
    }
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    // Look up first. If it does not exist → 404. If it exists but is
    // already consumed/revoked/expired → 410. Otherwise consume.
    const existing = await deps.shares.findByHash(tokenHash);
    if (!existing) {
      return c.html(
        layout({
          title: 'Share-Link unbekannt',
          body: html`<div class="login-page"><div class="login-box"><h1>Unbekannt</h1><p class="login-hint">Dieser Share-Link ist unbekannt.</p></div></div>`,
        }),
        404
      );
    }
    const nowMs = Date.now();
    const expiresMs = Date.parse(existing.expires_at);
    const isExpired = Number.isFinite(expiresMs) && expiresMs <= nowMs;
    if (existing.consumed_at || existing.revoked_at || isExpired) {
      return c.html(
        layout({
          title: 'Share-Link verbraucht',
          body: html`<div class="login-page"><div class="login-box"><h1>Verbraucht</h1><p class="login-hint">Dieser Share-Link ist nicht mehr gueltig.</p></div></div>`,
        }),
        410
      );
    }

    const consumed = await deps.shares.consume(tokenHash, {
      ip,
      userAgent: c.req.header('User-Agent') ?? undefined,
    });
    if (!consumed) {
      return c.html(
        layout({
          title: 'Share-Link verbraucht',
          body: html`<div class="login-page"><div class="login-box"><h1>Verbraucht</h1><p class="login-hint">Dieser Share-Link ist nicht mehr gueltig.</p></div></div>`,
        }),
        410
      );
    }
    const entity = await deps.entities.get(consumed.entity);
    if (!entity) {
      return c.text('entity not found', 404);
    }
    // Parse the output format from the URL before the activity log
    // call, so the audit entry can record whether a human, an LLM, or
    // a CLI pipeline consumed the link. This helps separate "alice
    // clicked her browser bookmark" from "cron-job curl'd the URL".
    const url = new URL(c.req.url);
    const format = parseShareFormat(url.searchParams);

    await deps.activity.create({
      action: 'share_consume',
      targetType: 'share',
      targetId: consumed.id,
      ip,
      userAgent: c.req.header('User-Agent') ?? undefined,
      metadata: { entity_id: entity.id, entity_kind: entity.kind, format },
    });

    if (format === 'md') {
      return c.body(renderSharedEntityMarkdown(entity), 200, {
        'Content-Type': CONTENT_TYPES.md,
      });
    }
    if (format === 'json') {
      return c.body(renderSharedEntityJson(entity), 200, {
        'Content-Type': CONTENT_TYPES.json,
      });
    }
    return c.html(renderSharedEntity({ entity }));
  });

  return app;
}
