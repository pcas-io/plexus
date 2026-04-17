import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { VERSION } from './version.js';
import { loadConfig } from './config.js';
import { connectSurreal, type SurrealConnection } from './db/surreal.js';
import { runMigrations } from './db/migrations.js';
import { UserRepository } from './db/repositories/users.js';
import { PasskeyRepository } from './db/repositories/passkeys.js';
import { SessionRepository } from './db/repositories/sessions.js';
import { EntityRepository } from './db/repositories/entities.js';
import { EdgeRepository } from './db/repositories/edges.js';
import { ActivityLogRepository } from './db/repositories/activity_log.js';
import { ShareTokenRepository } from './db/repositories/share_tokens.js';
import { OAuthRepository } from './db/repositories/oauth.js';
import { PersonalTokenRepository } from './db/repositories/personal_tokens.js';
import { SkillRepository } from './db/repositories/skills.js';
import { WebAuthnService } from './auth/webauthn.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { pagesRoutes } from './routes/dashboard.js';
import { shareRoutes, publicShareRoutes } from './routes/shares.js';
import { oauthRoutes } from './routes/oauth.js';
import { wellKnownRoutes } from './routes/wellknown.js';
import { mcpCors } from './auth/cors.js';
import { KindRegistry, RelationRegistry } from './mcp/registries.js';
import { handleMcpRequest } from './mcp/transport.js';
import { hashToken, extractBearerToken, timingSafeStringEqual } from './auth/tokens.js';
import { createHash } from 'node:crypto';
import type { McpAuth, McpScope } from './mcp/server.js';

process.on('uncaughtException', (err) => {
  console.error('[plexus] uncaughtException:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[plexus] unhandledRejection:', reason);
  process.exit(1);
});

const config = loadConfig();

function warnIfInsecureOrigin(baseUrl: string): void {
  try {
    const u = new URL(baseUrl);
    if (u.protocol === 'https:') return;
    const loopback = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (loopback) return;
    console.warn(
      `[plexus] WARNING: PLEXUS_BASE_URL="${baseUrl}" is http but not loopback. ` +
        `WebAuthn (passkeys) will reject this origin with "insecure protocol". ` +
        `For production, put plexus behind TLS; for local, use http://localhost:PORT or http://127.0.0.1:PORT.`
    );
  } catch {
    console.warn(`[plexus] WARNING: PLEXUS_BASE_URL="${baseUrl}" is not a valid URL.`);
  }
}

async function main(): Promise<void> {
  console.log('[plexus] starting v0.0.4...');
  console.log(`[plexus] base url: ${config.baseUrl}`);
  warnIfInsecureOrigin(config.baseUrl);
  console.log(`[plexus] log level: ${config.logLevel}`);
  console.log(`[plexus] surreal url: ${config.surreal.url}`);
  console.log(`[plexus] surreal ns/db: ${config.surreal.namespace}/${config.surreal.database}`);

  console.log('[plexus] calling connectSurreal...');
  const conn: SurrealConnection = await connectSurreal(config.surreal);
  console.log('[plexus] connectSurreal returned');

  await runMigrations(conn.db);

  const users = new UserRepository(conn.db);
  const passkeys = new PasskeyRepository(conn.db);
  const sessions = new SessionRepository(conn.db);
  const entityRepo = new EntityRepository(conn.db);
  const edgeRepo = new EdgeRepository(conn.db);
  const activityRepo = new ActivityLogRepository(conn.db);
  const shareRepo = new ShareTokenRepository(conn.db);
  const oauthRepo = new OAuthRepository(conn.db);
  const personalTokens = new PersonalTokenRepository(conn.db);

  // DCR orphan cleanup (Security-Finding #23): remove oauth_clients
  // that were registered but never used, older than 7 days.
  try {
    const cleaned = await oauthRepo.cleanupOrphanedClients(7);
    if (cleaned > 0) console.log(`[plexus] cleaned ${cleaned} orphaned OAuth clients`);
  } catch (err) {
    console.error('[plexus] DCR cleanup failed:', err);
  }

  const kindRegistry = new KindRegistry(conn.db);
  const relationRegistry = new RelationRegistry(conn.db);
  const skillRepo = new SkillRepository(entityRepo);
  const webauthn = new WebAuthnService({
    rpId: config.webauthn.rpId,
    rpName: config.webauthn.rpName,
    origin: config.baseUrl,
  });

  const app = new Hono();

  // Security headers on every response.
  //
  // script-src includes https://cdn.jsdelivr.net ONLY for the pinned
  // d3@7.9.0 used on /graph. That script tag additionally carries a
  // sha384 SRI integrity attribute, so even if the CDN were tampered
  // with, the browser refuses to execute the mismatched file. Keep
  // this list as short as possible — every origin on it is attack
  // surface.
  app.use('*', async (c, next) => {
    await next();
    c.header('X-Frame-Options', 'DENY');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    c.header(
      'Content-Security-Policy',
      "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; connect-src 'self'; img-src 'self' data:;"
    );
  });

  // Minimal ping for uptime monitors (Uptime Kuma etc.) — no version,
  // no service name, no fingerprint surface.
  app.get('/ping', (c) => c.text('pong'));

  // Health with DB check. Version is only exposed when the caller
  // provides a valid admin token — external scanners see only status
  // and db, not which build we are running.
  app.get('/health', async (c) => {
    const token = extractBearerToken(c.req.header('Authorization'));
    const isAdmin = token ? timingSafeStringEqual(token, config.adminToken) : false;
    try {
      await conn.db.query('INFO FOR DB;');
      const body: Record<string, string> = { status: 'ok', db: 'ok' };
      if (isAdmin) { body.version = VERSION; body.service = 'plexus'; }
      return c.json(body);
    } catch {
      const body: Record<string, string> = { status: 'degraded', db: 'unreachable' };
      if (isAdmin) { body.version = VERSION; body.service = 'plexus'; }
      return c.json(body, 503);
    }
  });

  // Mount auth routes.
  app.route('/auth', authRoutes({ config, users, passkeys, sessions, personalTokens, webauthn }));

  // Mount JSON admin API (existing from Schritt 2a) + dev db-reset.
  app.route('/admin', adminRoutes(config, users, conn.db));

  // OAuth discovery endpoints — must come BEFORE pagesRoutes so the
  // catch-all session middleware doesn't swallow them.
  app.route('/.well-known', wellKnownRoutes(config));

  // OAuth 2.1 authorization server endpoints — also BEFORE pagesRoutes.
  app.route('/oauth', oauthRoutes({
    config,
    users,
    sessions,
    oauth: oauthRepo,
    activity: activityRepo,
  }));

  // MCP endpoint — Bearer-Token auth then delegates to McpServer.
  // Must be registered BEFORE pagesRoutes ('/' mount) because pagesRoutes
  // installs a catch-all requireSession middleware that would otherwise
  // intercept POST /mcp and redirect unauthenticated agent calls to
  // /auth/login instead of returning 401.
  //
  // Accepts two token flavours:
  //   pt_*  — personal tokens (users.token_hash)
  //   ot_*  — OAuth 2.1 access tokens issued by /oauth/token
  //
  // Scope-enforcement lives inside the tools (see src/mcp/tools.ts).
  // For v0.0.4 every user token gets scope { permission: 'write', contexts: [], kinds: [] }
  // (full access to everything the user sees). Per-token scoping UI comes later.

  // CORS for browser-based MCP clients (claude.ai, claude.com). Applies
  // to both OPTIONS preflight and the actual POST.
  app.use('/mcp', mcpCors());

  // Explicit OPTIONS handler so preflight never falls through to the
  // /-catch-all pagesRoutes (which would redirect to /auth/login).
  app.options('/mcp', (c) => c.body(null, 204));

  app.post('/mcp', async (c) => {
    const token = extractBearerToken(c.req.header('Authorization'));

    // Helper to set the RFC 6750 / RFC 9728 WWW-Authenticate header on
    // 401 responses so spec-compliant clients find the discovery URL.
    const baseUrl = config.baseUrl.replace(/\/$/, '');
    const wwwAuthenticate = `Bearer realm="plexus", resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`;
    const unauthorized = (err: string, msg: string) => {
      c.header('WWW-Authenticate', wwwAuthenticate);
      return c.json({ error: err, message: msg }, 401);
    };

    if (!token) {
      return unauthorized('unauthorized', 'Bearer token required');
    }
    // HARD REJECT admin token per Auth-ADR Abschnitt 2.
    if (timingSafeStringEqual(token, config.adminToken)) {
      return c.json(
        {
          error: 'admin_token_not_allowed_on_mcp',
          message: 'Create a user token via /dashboard/users and use that instead.',
        },
        403
      );
    }

    let resolvedUser: Awaited<ReturnType<typeof users.findActiveByTokenHash>> | null = null;
    let resolvedScope: McpScope | null = null;
    let tokenKind: 'pt' | 'ot' | null = null;

    if (token.startsWith('ot_')) {
      // OAuth access token flow.
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const access = await oauthRepo.findActiveAccessToken(tokenHash);
      if (!access) return unauthorized('invalid_token', 'OAuth token unknown, expired or revoked');
      // Resource indicator check: OAuth tokens must be bound to our MCP endpoint.
      if (access.resource && access.resource !== `${baseUrl}/mcp`) {
        return unauthorized('invalid_token', 'token resource does not match this endpoint');
      }
      const candidate = await users.findById(access.user);
      if (!candidate || !candidate.is_active) {
        return unauthorized('user_deactivated', 'OAuth token bound to inactive user');
      }
      await oauthRepo.touchAccessToken(tokenHash);
      resolvedUser = candidate;
      tokenKind = 'ot';
    } else {
      // Personal token flow (pt_*).
      // Check personal_tokens table first (scoped tokens), then fall
      // back to users.token_hash (legacy unscoped tokens).
      const ptHash = hashToken(token);
      const scopedToken = await personalTokens.findActiveByHash(ptHash);
      if (scopedToken) {
        const candidate = await users.findById(scopedToken.user);
        if (!candidate || !candidate.is_active) {
          console.warn('[plexus] pt auth: scoped token found but user inactive/missing', scopedToken.user);
          return unauthorized('user_deactivated', 'user is inactive');
        }
        await personalTokens.touch(ptHash);
        resolvedUser = candidate;
        resolvedScope = {
          permission: (scopedToken.scope_permission as 'read' | 'write' | 'admin') ?? 'write',
          contexts: scopedToken.scope_contexts ?? undefined,
          kinds: scopedToken.scope_kinds ?? undefined,
        };
        tokenKind = 'pt';
      } else {
        // Legacy fallback: users.token_hash (no per-token scope).
        console.warn('[plexus] pt auth: scoped token NOT found, trying legacy users.token_hash fallback');
        const candidate = await users.findActiveByTokenHash(ptHash);
        if (!candidate) return unauthorized('invalid_token', 'unknown personal token');
        if (!candidate.is_active) return unauthorized('user_deactivated', 'user is inactive');
        resolvedUser = candidate;
        tokenKind = 'pt';
      }
    }

    const user = resolvedUser!;
    const scope: McpScope = resolvedScope ?? {
      permission: user.is_admin ? 'admin' : 'write',
    };
    const auth: McpAuth = { user, scope };

    // Audit trail: every MCP call records the token kind so we can
    // correlate requests back to either a personal token or a specific
    // OAuth client session.
    try {
      await activityRepo.create({
        userName: user.name,
        action: 'mcp_request',
        targetType: 'mcp',
        ip: c.req.header('CF-Connecting-IP')
          ?? c.req.header('X-Forwarded-For')?.split(',')[0]?.trim()
          ?? undefined,
        userAgent: c.req.header('User-Agent') ?? undefined,
        metadata: { token_kind: tokenKind },
      });
    } catch (err) {
      console.error('[mcp] activity log write failed:', err);
    }

    return handleMcpRequest(
      c,
      {
        entities: entityRepo,
        edges: edgeRepo,
        activity: activityRepo,
        kinds: kindRegistry,
        relations: relationRegistry,
        skills: skillRepo,
      },
      auth
    );
  });

  // Share routes — two mounts:
  //   /shares → authenticated dashboard routes (step-up, list, revoke)
  //   /share  → public one-time consumption endpoint
  // Both must come BEFORE the catch-all pagesRoutes mount because
  // /share/:token is deliberately session-less.
  const shareDeps = {
    baseUrl: config.baseUrl,
    users, passkeys, sessions,
    entities: entityRepo,
    shares: shareRepo,
    activity: activityRepo,
    webauthn,
  };
  app.route('/shares', shareRoutes(shareDeps));
  app.route('/share', publicShareRoutes(shareDeps));

  // Mount pages (home, entities, graph, users, sessions, bootstrap)
  // directly at root. Has a catch-all requireSession middleware, so
  // must come AFTER every specific route that should bypass session
  // auth (/auth, /admin, /mcp, /shares, /share, /health).
  app.route('/', pagesRoutes({
    config, users, passkeys, sessions,
    entities: entityRepo, edges: edgeRepo, activity: activityRepo,
    oauth: oauthRepo, personalTokens, webauthn,
    kinds: kindRegistry, relations: relationRegistry,
  }));

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  app.onError((err, c) => {
    console.error('[plexus] unhandled error:', err);
    return c.json({ error: 'internal_error' }, 500);
  });

  serve(
    {
      fetch: app.fetch,
      port: config.port,
      hostname: '0.0.0.0',
    },
    (info) => {
      console.log(`[plexus] listening on http://0.0.0.0:${info.port}`);
      console.log('[plexus] ready');
    }
  );

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[plexus] received ${signal}, shutting down...`);
    try {
      await conn.close();
    } catch (err) {
      console.error('[plexus] error closing SurrealDB connection:', err);
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[plexus] fatal error during startup:', err);
  process.exit(1);
});
