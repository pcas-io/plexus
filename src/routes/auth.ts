/**
 * Authentication routes — login, passkey enrollment, passkey auth, logout.
 *
 * The login flow has three modes:
 *   1. initial       — show token entry form
 *   2. enroll        — after token is accepted but user has no passkey yet
 *   3. passkey       — after token is accepted and user has a passkey
 *
 * A short-lived pending-auth cookie carries the user id between steps so
 * the user does not have to re-enter the token for enrollment/passkey.
 */

import { Hono } from 'hono';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import type { PlexusConfig } from '../config.js';
import type { User, UserRepository } from '../db/repositories/users.js';
import type { PasskeyRepository } from '../db/repositories/passkeys.js';
import type { SessionRepository } from '../db/repositories/sessions.js';
import type { PersonalTokenRepository } from '../db/repositories/personal_tokens.js';
import type { WebAuthnService } from '../auth/webauthn.js';
import {
  hashToken,
  timingSafeStringEqual,
} from '../auth/tokens.js';
import { ensureCsrfToken } from '../auth/csrf.js';
import { readSessionCookie, setSessionCookie, clearSessionCookie } from '../auth/sessions.js';
import { RateLimiter } from '../auth/rate_limit.js';
import { renderLoginPage } from '../ui/pages/login.js';

// 5 failed login attempts per IP in 10 minutes → blocked for the window.
const loginLimiter = new RateLimiter(5, 10 * 60 * 1000);

const PENDING_AUTH_COOKIE = 'plexus_pending_auth';
const PENDING_TTL_SECONDS = 300; // 5 minutes
const NEXT_COOKIE = 'plexus_post_login_next';
const NEXT_TTL_SECONDS = 600; // 10 minutes — enough for bootstrap + passkey

/**
 * Validate a `next` redirect target. Only same-origin relative paths
 * are allowed so we cannot be turned into an open redirect. The path
 * must start with `/` and must not contain `//` or `\` (to block
 * protocol-relative URLs and scheme smuggling).
 */
function sanitizeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/')) return null;
  if (raw.startsWith('//')) return null;
  if (raw.includes('\\')) return null;
  if (raw.length > 1024) return null;
  return raw;
}

interface Deps {
  readonly config: PlexusConfig;
  readonly users: UserRepository;
  readonly passkeys: PasskeyRepository;
  readonly sessions: SessionRepository;
  readonly personalTokens: PersonalTokenRepository;
  readonly webauthn: WebAuthnService;
}

function setPendingAuth(c: import('hono').Context, userId: string): void {
  setCookie(c, PENDING_AUTH_COOKIE, userId, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: PENDING_TTL_SECONDS,
  });
}

function readPendingAuth(c: import('hono').Context): string | null {
  return getCookie(c, PENDING_AUTH_COOKIE) ?? null;
}

function clearPendingAuth(c: import('hono').Context): void {
  deleteCookie(c, PENDING_AUTH_COOKIE, { path: '/' });
}

function setNextCookie(c: import('hono').Context, next: string): void {
  setCookie(c, NEXT_COOKIE, next, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax', // Lax so it survives the OAuth redirect bounce
    path: '/',
    maxAge: NEXT_TTL_SECONDS,
  });
}

function readNextCookie(c: import('hono').Context): string | null {
  return sanitizeNext(getCookie(c, NEXT_COOKIE) ?? null);
}

function clearNextCookie(c: import('hono').Context): void {
  deleteCookie(c, NEXT_COOKIE, { path: '/' });
}

// Special sentinel user id for admin-token login that has not been promoted
// to a real user yet. This prompts the admin to create their real account.
const ADMIN_PENDING_USER = '__admin_bootstrap__';

export function authRoutes(deps: Deps): Hono {
  const app = new Hono();

  // ---------- GET /auth/login ----------
  app.get('/login', async (c) => {
    const csrfToken = ensureCsrfToken(c);
    const pending = readPendingAuth(c);

    // If a `next` parameter is present (e.g. OAuth bounce), stash it
    // in a short-lived same-origin cookie so it survives the token +
    // passkey round trip. Only same-origin relative paths are accepted.
    const nextParam = sanitizeNext(new URL(c.req.url).searchParams.get('next'));
    if (nextParam) setNextCookie(c, nextParam);

    if (pending === ADMIN_PENDING_USER) {
      // Admin token was accepted, but no real admin user exists.
      // Redirect to /admin/users (HTML) to bootstrap.
      return c.redirect('/bootstrap');
    }

    if (pending) {
      // User is mid-login. Decide if we need enrollment or passkey challenge.
      const user = await deps.users.findById(pending);
      if (!user || !user.is_active) {
        clearPendingAuth(c);
        return c.html(renderLoginPage({ csrfToken, errorMessage: 'Benutzer nicht mehr aktiv.' }));
      }
      const passkeyCount = await deps.passkeys.countForUser(user.id);
      if (passkeyCount === 0) {
        return c.html(
          renderLoginPage({
            csrfToken,
            mode: 'enroll',
            hint: `Passkey fuer ${user.name}`,
          })
        );
      }
      return c.html(
        renderLoginPage({
          csrfToken,
          mode: 'passkey',
          hint: `Angemeldet als ${user.name}`,
        })
      );
    }

    return c.html(renderLoginPage({ csrfToken }));
  });

  // ---------- POST /auth/login ----------
  // Accepts either PLEXUS_ADMIN_TOKEN or a personal pt_-token.
  app.post('/login', async (c) => {
    const ip = c.req.header('CF-Connecting-IP')
      ?? c.req.header('X-Forwarded-For')?.split(',')[0]?.trim()
      ?? 'unknown';
    if (loginLimiter.hit(ip)) {
      return c.html(renderLoginPage({ csrfToken: ensureCsrfToken(c), errorMessage: 'Zu viele Versuche. Bitte spaeter erneut versuchen.' }), 429);
    }
    const csrfToken = ensureCsrfToken(c);
    const form = await c.req.parseBody();
    const token = typeof form.token === 'string' ? form.token.trim() : '';
    const submittedCsrf = typeof form._csrf === 'string' ? form._csrf : '';

    if (!submittedCsrf || submittedCsrf !== csrfToken) {
      return c.html(renderLoginPage({ csrfToken, errorMessage: 'Ungueltiges CSRF-Token. Seite neu laden und erneut versuchen.' }), 403);
    }

    if (!token) {
      return c.html(
        renderLoginPage({ csrfToken, errorMessage: 'Bitte einen Token eingeben.' }),
        400
      );
    }

    // Uniform error message for ALL login failures — deliberately vague
    // so an attacker cannot distinguish "unknown token" from "admin token
    // on non-bootstrap" from "deactivated user". The only branching info
    // is "empty field" (above) and "CSRF mismatch" (above) which are
    // client errors, not auth failures.
    const LOGIN_FAIL = 'Login fehlgeschlagen.';

    // Admin token path.
    if (timingSafeStringEqual(token, deps.config.adminToken)) {
      const allUsers = await deps.users.list();
      const hasAdminUser = allUsers.some((u) => u.is_admin && u.is_active);
      if (hasAdminUser) {
        return c.html(renderLoginPage({ csrfToken, errorMessage: LOGIN_FAIL }), 401);
      }
      // Bootstrap: no admin user yet.
      setPendingAuth(c, ADMIN_PENDING_USER);
      return c.redirect('/bootstrap');
    }

    // Personal token path.
    //
    // Lookup order matches the MCP auth flow in src/index.ts:
    //   1. personal_tokens (scoped tokens — admin-created AND self-service)
    //   2. users.token_hash (legacy unscoped fallback for tokens that
    //      predate the personal_tokens migration)
    //
    // Without step 1 here, self-service tokens created via /tokens were
    // silently rejected on dashboard login — even though the label on
    // the login form explicitly advertises "pt_" tokens. Scope fields
    // (permission, contexts, kinds) are intentionally ignored at the
    // login stage: the dashboard is read/admin-gated at the page level,
    // and scope enforcement only applies to MCP writes.
    const tokenHash = hashToken(token);
    let user: User | null = null;

    const scopedToken = await deps.personalTokens.findActiveByHash(tokenHash);
    if (scopedToken) {
      const candidate = await deps.users.findById(scopedToken.user);
      if (candidate && candidate.is_active) user = candidate;
    }

    if (!user) {
      user = await deps.users.findActiveByTokenHash(tokenHash);
    }

    if (!user) {
      return c.html(renderLoginPage({ csrfToken, errorMessage: LOGIN_FAIL }), 401);
    }

    setPendingAuth(c, user.id);
    return c.redirect('/auth/login');
  });

  // ---------- POST /auth/passkey/enroll/start ----------
  app.post('/passkey/enroll/start', async (c) => {
    const pending = readPendingAuth(c);
    if (!pending || pending === ADMIN_PENDING_USER) {
      return c.json({ error: 'no_pending_user' }, 401);
    }
    const user = await deps.users.findById(pending);
    if (!user) return c.json({ error: 'user_not_found' }, 401);
    const existing = await deps.passkeys.listForUser(user.id);
    const options = await deps.webauthn.generateEnrollmentOptions(
      user.id,
      user.name,
      existing.map((p) => p.credential_id)
    );
    return c.json(options);
  });

  // ---------- POST /auth/passkey/enroll/finish ----------
  app.post('/passkey/enroll/finish', async (c) => {
    const pending = readPendingAuth(c);
    if (!pending || pending === ADMIN_PENDING_USER) {
      return c.json({ error: 'no_pending_user' }, 401);
    }
    const user = await deps.users.findById(pending);
    if (!user) return c.json({ error: 'user_not_found' }, 401);

    let body: { response?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    const response = body.response;
    if (!response || typeof response !== 'object') {
      return c.json({ error: 'invalid_response' }, 400);
    }

    try {
      const result = await deps.webauthn.verifyEnrollment(user.id, response as Parameters<typeof deps.webauthn.verifyEnrollment>[1]);
      await deps.passkeys.create({
        userId: user.id,
        credentialId: result.credentialId,
        publicKey: result.publicKey,
        counter: result.counter,
        transports: result.transports,
        deviceName: (c.req.header('User-Agent') ?? 'unknown').slice(0, 120),
      });
      // Rotate the user's token on first enrollment — the initial token
      // was a one-time invitation token that may have been seen during
      // transfer. The new token is shown once and the old one is dead.
      const resetResult = await deps.users.resetToken(user.name);
      const newToken = resetResult?.token ?? null;

      // Do NOT create a session here. The user must re-login with the
      // new token + passkey to prove they saved the new token. This
      // makes the flow clean: enroll → see new token → go to login →
      // authenticate fresh with new credentials.
      clearPendingAuth(c);
      const next = readNextCookie(c);
      if (next) clearNextCookie(c);
      return c.json({
        ok: true,
        // Redirect to login, not dashboard — forces re-auth with new token.
        redirect: '/auth/login',
        newToken,
      });
    } catch (err) {
      console.error('[auth] enroll finish error:', err);
      return c.json({ error: 'enrollment_failed', message: 'Passkey-Registrierung fehlgeschlagen.' }, 400);
    }
  });

  // ---------- POST /auth/passkey/auth/start ----------
  app.post('/passkey/auth/start', async (c) => {
    const pending = readPendingAuth(c);
    if (!pending || pending === ADMIN_PENDING_USER) {
      return c.json({ error: 'no_pending_user' }, 401);
    }
    const user = await deps.users.findById(pending);
    if (!user) return c.json({ error: 'user_not_found' }, 401);
    const passkeys = await deps.passkeys.listForUser(user.id);
    if (passkeys.length === 0) {
      return c.json({ error: 'no_passkeys' }, 400);
    }
    const options = await deps.webauthn.generateAuthOptions(
      user.id,
      passkeys.map((p) => p.credential_id)
    );
    return c.json(options);
  });

  // ---------- POST /auth/passkey/auth/finish ----------
  app.post('/passkey/auth/finish', async (c) => {
    const pending = readPendingAuth(c);
    if (!pending || pending === ADMIN_PENDING_USER) {
      return c.json({ error: 'no_pending_user' }, 401);
    }
    const user = await deps.users.findById(pending);
    if (!user) return c.json({ error: 'user_not_found' }, 401);

    let body: { response?: { id?: string } };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    const response = body.response;
    if (!response || typeof response !== 'object' || typeof response.id !== 'string') {
      return c.json({ error: 'invalid_response' }, 400);
    }
    const stored = await deps.passkeys.findByCredentialId(response.id);
    if (!stored) return c.json({ error: 'unknown_credential' }, 401);

    try {
      const result = await deps.webauthn.verifyAuth(
        user.id,
        response as Parameters<typeof deps.webauthn.verifyAuth>[1],
        {
          id: stored.credential_id,
          publicKey: stored.public_key,
          counter: stored.counter,
        }
      );
      await deps.passkeys.updateCounter(stored.credential_id, result.newCounter);
      const { token } = await deps.sessions.create(user.id, {
        ip: c.req.header('X-Forwarded-For') ?? undefined,
        userAgent: c.req.header('User-Agent') ?? undefined,
      });
      setSessionCookie(c, token);
      clearPendingAuth(c);
      const next = readNextCookie(c);
      if (next) clearNextCookie(c);
      return c.json({ ok: true, redirect: next ?? '/' });
    } catch (err) {
      console.error('[auth] passkey auth finish error:', err);
      return c.json({ error: 'auth_failed', message: 'Passkey-Authentifizierung fehlgeschlagen.' }, 401);
    }
  });

  // ---------- POST /auth/logout ----------
  app.post('/logout', async (c) => {
    // If there is a session cookie, revoke the backing session row.
    const sessionToken = readSessionCookie(c);
    if (sessionToken) {
      const session = await deps.sessions.findActiveByTokenHash(hashToken(sessionToken));
      if (session) {
        await deps.sessions.revoke(String(session.id));
      }
    }
    clearSessionCookie(c);
    clearPendingAuth(c);
    return c.redirect('/auth/login');
  });

  return app;
}
