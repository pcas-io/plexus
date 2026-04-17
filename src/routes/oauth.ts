/**
 * OAuth 2.1 Authorization Server routes for plexus.
 *
 * Implements the minimum surface the MCP Authorization spec requires:
 *
 *   POST /oauth/register    — Dynamic Client Registration (RFC 7591)
 *   GET  /oauth/authorize   — Consent screen (session-gated)
 *   POST /oauth/authorize   — Consent decision (issues auth code)
 *   POST /oauth/token       — Token exchange (auth code + refresh)
 *   POST /oauth/revoke      — Token revocation (RFC 7009, optional)
 *
 * Security properties (audit-worthy):
 *   - All tokens are sha256-hashed before touching the database.
 *   - PKCE S256 is mandatory; plain is rejected on authorize and the
 *     verifier is constant-time compared on token exchange.
 *   - Auth codes are one-time (atomic consume) and 10-minute TTL.
 *   - redirect_uri is validated as an exact string match against the
 *     client's registered list on BOTH authorize and token endpoints.
 *   - resource parameter (RFC 8707) is bound to the auth code and
 *     re-checked on token issuance so a code issued for /mcp cannot
 *     be exchanged for a token against a different resource.
 *   - Every state-changing operation writes an activity_log entry
 *     with target_type='oauth' so the full flow is auditable.
 *   - Authorization endpoint requires an active dashboard session;
 *     the user who is currently logged in is the subject of the
 *     issued tokens. There is no way to get an OAuth token without
 *     going through the dashboard login (including its passkey MFA).
 *   - Access tokens are 1h, refresh tokens 30d, both rotated on
 *     refresh (the old refresh token is revoked and a fresh one
 *     returned).
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import type { PlexusConfig } from '../config.js';
import type { UserRepository } from '../db/repositories/users.js';
import type { SessionRepository } from '../db/repositories/sessions.js';
import type { OAuthRepository } from '../db/repositories/oauth.js';
import type { ActivityLogRepository } from '../db/repositories/activity_log.js';
import { ensureCsrfToken } from '../auth/csrf.js';
import { readSessionCookie, clearSessionCookie } from '../auth/sessions.js';
import { hashToken } from '../auth/tokens.js';
import { verifyPkce, isValidChallenge, isValidVerifier } from '../auth/pkce.js';
import { mcpCors } from '../auth/cors.js';
import { RateLimiter } from '../auth/rate_limit.js';
import { renderOAuthConsent } from '../ui/pages/oauth_consent.js';

export interface OAuthDeps {
  readonly config: PlexusConfig;
  readonly users: UserRepository;
  readonly sessions: SessionRepository;
  readonly oauth: OAuthRepository;
  readonly activity: ActivityLogRepository;
}

// ---------------- Helpers ----------------

function clientIp(c: Context): string {
  return c.req.header('CF-Connecting-IP')
    ?? c.req.header('X-Forwarded-For')?.split(',')[0]?.trim()
    ?? 'unknown';
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function generateOpaqueToken(prefix: 'ot' | 'or' | 'code' | 'client'): string {
  return `${prefix}_` + randomBytes(32).toString('base64url');
}

/**
 * Constant-time compare of two strings (e.g. redirect_uri) using
 * timingSafeEqual on equal-length buffers. Falls through to false for
 * differing lengths.
 */
function constantTimeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

// ---------------- Routes ----------------

export function oauthRoutes(deps: OAuthDeps): Hono {
  const app = new Hono();
  app.use('*', mcpCors());

  // Basic rate limits so a leaked or rogue client cannot brute-force
  // our endpoints. Counted per IP.
  const registerLimiter = new RateLimiter(10, 60 * 60 * 1000);  // 10/h per IP
  const authorizeLimiter = new RateLimiter(30, 10 * 60 * 1000); // 30/10min per IP
  const tokenLimiter = new RateLimiter(60, 10 * 60 * 1000);     // 60/10min per IP

  const baseUrl = deps.config.baseUrl.replace(/\/$/, '');
  const expectedResource = `${baseUrl}/mcp`;

  // ================================================================
  // POST /oauth/register — Dynamic Client Registration (RFC 7591)
  // ================================================================
  app.post('/register', async (c) => {
    const ip = clientIp(c);
    if (registerLimiter.hit(ip)) {
      return c.json({ error: 'too_many_requests' }, 429);
    }
    let body: {
      client_name?: unknown;
      redirect_uris?: unknown;
      grant_types?: unknown;
      response_types?: unknown;
      token_endpoint_auth_method?: unknown;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_client_metadata', error_description: 'Body must be JSON' }, 400);
    }

    const clientName =
      typeof body.client_name === 'string' && body.client_name.length > 0 && body.client_name.length <= 200
        ? body.client_name
        : 'Unnamed MCP Client';

    // redirect_uris is required and must be a non-empty array of https URLs
    // (or http://localhost for dev clients like MCP Inspector).
    const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === 'string') : [];
    if (redirectUris.length === 0) {
      return c.json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris required' }, 400);
    }
    for (const uri of redirectUris) {
      try {
        const parsed = new URL(uri);
        const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
        if (parsed.protocol !== 'https:' && !isLocal) {
          return c.json(
            {
              error: 'invalid_redirect_uri',
              error_description: `redirect_uri must be https:// (or http://localhost): ${uri}`,
            },
            400
          );
        }
      } catch {
        return c.json({ error: 'invalid_redirect_uri', error_description: `malformed uri: ${uri}` }, 400);
      }
    }

    const grantTypes = Array.isArray(body.grant_types)
      ? body.grant_types.filter((g): g is string => typeof g === 'string')
      : ['authorization_code', 'refresh_token'];
    for (const g of grantTypes) {
      if (g !== 'authorization_code' && g !== 'refresh_token') {
        return c.json(
          { error: 'invalid_client_metadata', error_description: `unsupported grant_type: ${g}` },
          400
        );
      }
    }

    const responseTypes = Array.isArray(body.response_types)
      ? body.response_types.filter((r): r is string => typeof r === 'string')
      : ['code'];
    for (const r of responseTypes) {
      if (r !== 'code') {
        return c.json(
          { error: 'invalid_client_metadata', error_description: `unsupported response_type: ${r}` },
          400
        );
      }
    }

    const clientId = generateOpaqueToken('client');
    const client = await deps.oauth.createClient({
      clientId,
      clientName,
      redirectUris,
      grantTypes,
      responseTypes,
      tokenEndpointAuthMethod: 'none',
      createdIp: ip,
      createdUa: c.req.header('User-Agent'),
    });

    await deps.activity.create({
      action: 'oauth_client_register',
      targetType: 'oauth',
      targetId: client.id,
      ip,
      userAgent: c.req.header('User-Agent') ?? undefined,
      metadata: { client_name: clientName, redirect_uris: redirectUris },
    });

    // RFC 7591 §3.2.1 response shape.
    return c.json(
      {
        client_id: client.client_id,
        client_name: client.client_name,
        redirect_uris: client.redirect_uris,
        grant_types: client.grant_types,
        response_types: client.response_types,
        token_endpoint_auth_method: client.token_endpoint_auth_method,
        client_id_issued_at: Math.floor(Date.parse(client.created_at) / 1000),
      },
      201
    );
  });

  // ================================================================
  // GET /oauth/authorize — show the consent screen
  // ================================================================
  // Flow: if the user is not logged in, redirect to /auth/login with a
  // `next` parameter pointing back at the current URL so they come
  // back here post-login. If they are logged in, render the consent
  // page with client name + redirect URI + scope.
  app.get('/authorize', async (c) => {
    const ip = clientIp(c);
    if (authorizeLimiter.hit(ip)) return c.text('too many requests', 429);

    const url = new URL(c.req.url);
    const clientId = url.searchParams.get('client_id') ?? '';
    const redirectUri = url.searchParams.get('redirect_uri') ?? '';
    const responseType = url.searchParams.get('response_type') ?? '';
    const codeChallenge = url.searchParams.get('code_challenge') ?? '';
    const codeChallengeMethod = url.searchParams.get('code_challenge_method') ?? '';
    const scope = url.searchParams.get('scope') ?? 'mcp';
    const state = url.searchParams.get('state') ?? '';
    const resource = url.searchParams.get('resource') ?? '';

    if (responseType !== 'code') {
      return c.text('unsupported_response_type — only "code" is supported', 400);
    }
    if (codeChallengeMethod !== 'S256' || !isValidChallenge(codeChallenge)) {
      return c.text('invalid_request — PKCE S256 required', 400);
    }
    if (!clientId || !redirectUri) {
      return c.text('invalid_request — client_id and redirect_uri required', 400);
    }

    const client = await deps.oauth.findClientByClientId(clientId);
    if (!client) return c.text('invalid_client', 400);

    // Exact-match check of redirect_uri against the registered list.
    // Prevents open-redirect attacks via a subtly different URI.
    const registeredMatch = client.redirect_uris.find((u) => constantTimeStringEqual(u, redirectUri));
    if (!registeredMatch) return c.text('invalid_redirect_uri', 400);

    // RFC 8707 resource indicator: if present, it must point at our MCP
    // endpoint. If absent we default to that same value so downstream
    // is always pinned.
    const effectiveResource = resource || expectedResource;
    if (effectiveResource !== expectedResource) {
      return c.text('invalid_target — resource must be the plexus MCP endpoint', 400);
    }

    // Session check — must be an active dashboard session.
    const sessionToken = readSessionCookie(c);
    let user: Awaited<ReturnType<typeof deps.users.findById>> | null = null;
    if (sessionToken) {
      const session = await deps.sessions.findActiveByTokenHash(hashToken(sessionToken));
      if (session) {
        const candidate = await deps.users.findById(session.user);
        if (candidate && candidate.is_active) {
          await deps.sessions.touch(session.id);
          user = candidate;
        }
      }
    }
    if (!user) {
      // Bounce to login with a next= pointing at the full authorize URL
      // so claude.ai's exact query string survives the round trip.
      const nextParam = encodeURIComponent(`/oauth/authorize?${url.searchParams.toString()}`);
      return c.redirect(`/auth/login?next=${nextParam}`);
    }

    const csrfToken = ensureCsrfToken(c);
    return c.html(
      renderOAuthConsent({
        currentUser: user,
        client,
        redirectUri,
        scope,
        state,
        codeChallenge,
        resource: effectiveResource,
        csrfToken,
      })
    );
  });

  // ================================================================
  // POST /oauth/authorize — consent decision
  // ================================================================
  // Only reached from the consent form on the GET page. CSRF protected
  // via double-submit cookie. On "allow", generates a one-time auth
  // code bound to (client, user, redirect_uri, code_challenge, resource).
  app.post('/authorize', async (c) => {
    const ip = clientIp(c);
    if (authorizeLimiter.hit(ip)) return c.text('too many requests', 429);

    const form = await c.req.parseBody();
    const csrfCookie = ensureCsrfToken(c);
    const submittedCsrf = typeof form._csrf === 'string' ? form._csrf : '';
    if (!submittedCsrf || submittedCsrf !== csrfCookie) {
      return c.text('csrf_mismatch', 403);
    }

    const decision = typeof form.decision === 'string' ? form.decision : '';
    const clientId = typeof form.client_id === 'string' ? form.client_id : '';
    const redirectUri = typeof form.redirect_uri === 'string' ? form.redirect_uri : '';
    const state = typeof form.state === 'string' ? form.state : '';
    const codeChallenge = typeof form.code_challenge === 'string' ? form.code_challenge : '';
    const scope = typeof form.scope === 'string' ? form.scope : 'mcp';
    const resource = typeof form.resource === 'string' ? form.resource : expectedResource;

    if (!clientId || !redirectUri || !isValidChallenge(codeChallenge)) {
      return c.text('invalid_request', 400);
    }

    const client = await deps.oauth.findClientByClientId(clientId);
    if (!client) return c.text('invalid_client', 400);
    const registeredMatch = client.redirect_uris.find((u) => constantTimeStringEqual(u, redirectUri));
    if (!registeredMatch) return c.text('invalid_redirect_uri', 400);
    if (resource !== expectedResource) return c.text('invalid_target', 400);

    // Re-check session on the POST as well; the cookie may have
    // expired between GET and POST.
    const sessionToken = readSessionCookie(c);
    if (!sessionToken) return c.redirect('/auth/login');
    const session = await deps.sessions.findActiveByTokenHash(hashToken(sessionToken));
    if (!session) {
      clearSessionCookie(c);
      return c.redirect('/auth/login');
    }
    const user = await deps.users.findById(session.user);
    if (!user || !user.is_active) {
      clearSessionCookie(c);
      return c.redirect('/auth/login');
    }
    await deps.sessions.touch(session.id);

    if (decision !== 'allow') {
      // User denied — redirect back with error per RFC 6749 §4.1.2.1.
      await deps.activity.create({
        userName: user.name,
        action: 'oauth_authorize_deny',
        targetType: 'oauth',
        targetId: client.id,
        ip,
        userAgent: c.req.header('User-Agent') ?? undefined,
        metadata: { client_name: client.client_name },
      });
      const params = new URLSearchParams({ error: 'access_denied' });
      if (state) params.set('state', state);
      return c.redirect(`${redirectUri}?${params.toString()}`);
    }

    // Allow branch: generate one-time auth code, persist its hash.
    const rawCode = generateOpaqueToken('code');
    const codeHash = sha256(rawCode);
    const authCode = await deps.oauth.createAuthCode({
      codeHash,
      clientId: client.id,
      userId: user.id,
      redirectUri,
      codeChallenge,
      scope,
      resource,
      ttlSeconds: 600,
    });
    await deps.activity.create({
      userName: user.name,
      action: 'oauth_authorize_allow',
      targetType: 'oauth',
      targetId: authCode.id,
      ip,
      userAgent: c.req.header('User-Agent') ?? undefined,
      metadata: { client_name: client.client_name, scope, resource },
    });

    const params = new URLSearchParams({ code: rawCode });
    if (state) params.set('state', state);
    return c.redirect(`${redirectUri}?${params.toString()}`);
  });

  // ================================================================
  // POST /oauth/token — code + refresh grants
  // ================================================================
  app.post('/token', async (c) => {
    const ip = clientIp(c);
    if (tokenLimiter.hit(ip)) {
      return c.json({ error: 'too_many_requests' }, 429);
    }

    // RFC 6749 requires application/x-www-form-urlencoded for the token
    // endpoint. We accept it via Hono's parseBody which also handles
    // JSON (some clients are sloppy) — the grant_type field decides.
    const form = await c.req.parseBody();
    const grantType = typeof form.grant_type === 'string' ? form.grant_type : '';
    const clientId = typeof form.client_id === 'string' ? form.client_id : '';

    // Every failure path writes an oauth_token_invalid row with a reason
    // tag so post-hoc diagnosis via /admin/backup is possible even when
    // the container stdout buffer is too short to help (Coolify's log
    // endpoint only surfaces the first ~15 stdout lines). Payload stays
    // compact — no secrets, just the reason + the bits we need to
    // reproduce. Audit benefit is the main reason to keep this after
    // the initial bug hunt is over.
    const logFailure = async (reason: string, extra: Record<string, unknown> = {}) => {
      try {
        await deps.activity.create({
          action: 'oauth_token_invalid',
          targetType: 'oauth',
          targetId: clientId ? clientId.slice(0, 24) : 'unknown',
          ip,
          userAgent: c.req.header('User-Agent') ?? undefined,
          outcome: 'failure',
          metadata: { reason, grant: grantType || 'unknown', ...extra },
        });
      } catch (err) {
        console.error('[oauth/token] activity log write failed:', err);
      }
    };

    if (!clientId) {
      await logFailure('client_id_missing');
      return c.json({ error: 'invalid_request', error_description: 'client_id required' }, 400);
    }
    const client = await deps.oauth.findClientByClientId(clientId);
    if (!client) {
      await logFailure('client_id_not_found', { clientIdPrefix: clientId.slice(0, 16) });
      return c.json({ error: 'invalid_client' }, 401);
    }

    if (grantType === 'authorization_code') {
      const code = typeof form.code === 'string' ? form.code : '';
      const redirectUri = typeof form.redirect_uri === 'string' ? form.redirect_uri : '';
      const codeVerifier = typeof form.code_verifier === 'string' ? form.code_verifier : '';
      const requestedResource = typeof form.resource === 'string' ? form.resource : expectedResource;

      if (!code || !redirectUri || !isValidVerifier(codeVerifier)) {
        await logFailure('missing_code_or_redirect_or_verifier', {
          hasCode: !!code, hasRedirect: !!redirectUri, verifierValid: isValidVerifier(codeVerifier),
          verifierLen: codeVerifier.length,
        });
        return c.json({ error: 'invalid_request' }, 400);
      }

      let stored;
      try {
        stored = await deps.oauth.consumeAuthCode(sha256(code));
      } catch (err) {
        console.error('[oauth/token] consumeAuthCode threw:', err);
        await logFailure('consumeAuthCode_exception', { error: (err as Error).message });
        return c.json({ error: 'server_error', error_description: 'auth code lookup failed' }, 500);
      }
      if (!stored) {
        await logFailure('code_not_found_or_expired', {
          codeHashPrefix: sha256(code).slice(0, 12),
        });
        return c.json({ error: 'invalid_grant' }, 400);
      }

      // Audit-critical bindings must all match the original auth request.
      if (stored.client !== client.id) {
        await logFailure('client_mismatch', {
          storedClient: stored.client, requestClient: client.id,
        });
        return c.json({ error: 'invalid_grant', error_description: 'client mismatch' }, 400);
      }
      if (!constantTimeStringEqual(stored.redirect_uri, redirectUri)) {
        await logFailure('redirect_uri_mismatch', {
          storedRedirect: stored.redirect_uri, requestRedirect: redirectUri,
          storedLen: stored.redirect_uri.length, requestLen: redirectUri.length,
        });
        return c.json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }, 400);
      }
      if (!verifyPkce(codeVerifier, stored.code_challenge)) {
        await logFailure('pkce_failed', {
          challengePrefix: stored.code_challenge.slice(0, 12),
          verifierLen: codeVerifier.length,
        });
        return c.json({ error: 'invalid_grant', error_description: 'pkce failed' }, 400);
      }
      if ((stored.resource ?? expectedResource) !== requestedResource) {
        await logFailure('stored_resource_mismatch', {
          storedResource: stored.resource, requestedResource, expectedResource,
        });
        return c.json({ error: 'invalid_target' }, 400);
      }
      if (requestedResource !== expectedResource) {
        await logFailure('requested_resource_mismatch', {
          requestedResource, expectedResource,
        });
        return c.json({ error: 'invalid_target' }, 400);
      }

      // Issue tokens. Wrapped in a try so that SurrealDB CREATE failures
      // (schema rejection, record id issues, etc.) get logged into the
      // activity log with the specific stage that blew up.
      const rawAccess = generateOpaqueToken('ot');
      const rawRefresh = generateOpaqueToken('or');
      try {
        await deps.oauth.createAccessToken({
          tokenHash: sha256(rawAccess),
          clientId: client.id,
          userId: stored.user,
          scope: stored.scope,
          resource: requestedResource,
          ttlSeconds: 3600,
        });
      } catch (err) {
        console.error('[oauth/token] createAccessToken threw:', err);
        await logFailure('createAccessToken_exception', {
          error: (err as Error).message,
          storedUser: stored.user,
        });
        return c.json({ error: 'server_error', error_description: 'access token creation failed' }, 500);
      }
      try {
        await deps.oauth.createRefreshToken({
          tokenHash: sha256(rawRefresh),
          clientId: client.id,
          userId: stored.user,
          scope: stored.scope,
          resource: requestedResource,
          ttlSeconds: 30 * 24 * 3600,
        });
      } catch (err) {
        console.error('[oauth/token] createRefreshToken threw:', err);
        await logFailure('createRefreshToken_exception', {
          error: (err as Error).message,
          storedUser: stored.user,
        });
        return c.json({ error: 'server_error', error_description: 'refresh token creation failed' }, 500);
      }
      await deps.activity.create({
        action: 'oauth_token_issue',
        targetType: 'oauth',
        targetId: client.id,
        ip,
        userAgent: c.req.header('User-Agent') ?? undefined,
        metadata: { grant: 'authorization_code', user: stored.user, scope: stored.scope },
      });

      return c.json({
        access_token: rawAccess,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: rawRefresh,
        scope: stored.scope,
      });
    }

    if (grantType === 'refresh_token') {
      const refreshTokenRaw = typeof form.refresh_token === 'string' ? form.refresh_token : '';
      const requestedResource = typeof form.resource === 'string' ? form.resource : expectedResource;
      if (!refreshTokenRaw) {
        return c.json({ error: 'invalid_request', error_description: 'refresh_token required' }, 400);
      }
      if (requestedResource !== expectedResource) {
        return c.json({ error: 'invalid_target' }, 400);
      }
      const storedRefresh = await deps.oauth.findActiveRefreshToken(sha256(refreshTokenRaw));
      if (!storedRefresh || storedRefresh.client !== client.id) {
        await deps.activity.create({
          action: 'oauth_token_invalid',
          targetType: 'oauth',
          targetId: client.id,
          ip,
          userAgent: c.req.header('User-Agent') ?? undefined,
          outcome: 'failure',
          metadata: { reason: 'refresh_invalid', grant: 'refresh_token' },
        });
        return c.json({ error: 'invalid_grant' }, 400);
      }
      if (storedRefresh.resource && storedRefresh.resource !== requestedResource) {
        return c.json({ error: 'invalid_target' }, 400);
      }

      // Rotate: revoke old refresh, issue new access + refresh.
      await deps.oauth.revokeRefreshToken(sha256(refreshTokenRaw));
      const rawAccess = generateOpaqueToken('ot');
      const rawRefresh = generateOpaqueToken('or');
      await deps.oauth.createAccessToken({
        tokenHash: sha256(rawAccess),
        clientId: client.id,
        userId: storedRefresh.user,
        scope: storedRefresh.scope,
        resource: requestedResource,
        ttlSeconds: 3600,
      });
      await deps.oauth.createRefreshToken({
        tokenHash: sha256(rawRefresh),
        clientId: client.id,
        userId: storedRefresh.user,
        scope: storedRefresh.scope,
        resource: requestedResource,
        ttlSeconds: 30 * 24 * 3600,
      });
      await deps.activity.create({
        action: 'oauth_token_refresh',
        targetType: 'oauth',
        targetId: client.id,
        ip,
        userAgent: c.req.header('User-Agent') ?? undefined,
        metadata: { grant: 'refresh_token', user: storedRefresh.user, scope: storedRefresh.scope },
      });
      return c.json({
        access_token: rawAccess,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: rawRefresh,
        scope: storedRefresh.scope,
      });
    }

    await logFailure('unsupported_grant_type', { grantType });
    return c.json({ error: 'unsupported_grant_type' }, 400);
  });

  // ================================================================
  // POST /oauth/revoke — RFC 7009
  // ================================================================
  app.post('/revoke', async (c) => {
    const ip = clientIp(c);
    const form = await c.req.parseBody();
    const token = typeof form.token === 'string' ? form.token : '';
    const tokenHint = typeof form.token_type_hint === 'string' ? form.token_type_hint : '';
    if (!token) return c.json({ error: 'invalid_request' }, 400);
    const tokenHash = sha256(token);

    // Try both access and refresh token tables so clients don't have
    // to know which type they're revoking (hint is advisory per RFC).
    if (tokenHint !== 'refresh_token') {
      await deps.oauth.revokeAccessToken(tokenHash);
    }
    if (tokenHint !== 'access_token') {
      await deps.oauth.revokeRefreshToken(tokenHash);
    }
    await deps.activity.create({
      action: 'oauth_token_revoke',
      targetType: 'oauth',
      targetId: token.slice(0, 8),
      ip,
      userAgent: c.req.header('User-Agent') ?? undefined,
      metadata: { hint: tokenHint },
    });
    // RFC 7009 §2.2: always return 200 on success; do NOT leak whether
    // the token existed.
    return c.body(null, 200);
  });

  return app;
}
