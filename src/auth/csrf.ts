/**
 * CSRF protection — Double Submit Cookie pattern.
 *
 * On GET: set a `plexus_csrf` cookie and expose the value to each page
 * as a hidden `_csrf` field for form submits and as a JS-readable
 * cookie for fetch()-based JSON submits (which send the value back in
 * the `X-Csrf-Token` header). On mutating requests: compare the
 * submitted value against the cookie, constant-time.
 *
 * Why the CSRF cookie is **not** httpOnly (LOW-3 trade-off from the
 * 2026-04-10 audit entities:llclhdhv5a8yyf27xz4v): the dashboard uses
 * client-side fetch() for several flows (⌘K search, token self-service,
 * passkey enrolment) that need to include the CSRF token in a request
 * header. `httpOnly: false` lets the page script read
 * `document.cookie` to pull the token. The alternative is to render
 * the token into every page as a `<meta>` tag or DOM-attached data
 * attribute and never store it in a cookie at all.
 *
 * Trade-off: a JS-readable CSRF cookie is useless to an attacker in
 * the absence of an XSS vector, but becomes a free bypass the moment
 * one appears. That's why HIGH-1 (Markdown safeUrl hardening, fixed
 * 2026-04-11 in commit 0e97df2) and strict `escapeHtml` at every
 * template interpolation site are load-bearing for this design — if
 * a new XSS slips through, CSRF protection collapses with it.
 *
 * The DOM-delivery alternative is tracked for a future hardening
 * round. For now the cookie is deliberate, documented, and every
 * mutating route is double-submit-checked.
 */

import type { Context, MiddlewareHandler } from 'hono';
import { setCookie, getCookie } from 'hono/cookie';
import { randomBytes, timingSafeEqual } from 'node:crypto';

export const CSRF_COOKIE = 'plexus_csrf';

export function generateCsrfToken(): string {
  return randomBytes(24).toString('base64url');
}

export function ensureCsrfToken(c: Context): string {
  const existing = getCookie(c, CSRF_COOKIE);
  if (existing && existing.length >= 32) return existing;
  const token = generateCsrfToken();
  setCookie(c, CSRF_COOKIE, token, {
    // Deliberately JS-readable so client-side fetch() code in the
    // dashboard can pull the token out of document.cookie and include
    // it in the X-Csrf-Token header. Full rationale and LOW-3 audit
    // trade-off in the module docstring above. Keep this line in sync
    // with any future migration to DOM-delivered CSRF tokens.
    httpOnly: false,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: 60 * 60 * 8,
  });
  return token;
}

export function requireCsrf(): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.method === 'OPTIONS') {
      await next();
      return;
    }
    const cookieToken = getCookie(c, CSRF_COOKIE);
    if (!cookieToken) {
      return c.json({ error: 'csrf_missing' }, 403);
    }
    const contentType = c.req.header('Content-Type') ?? '';
    let submitted: string | undefined;
    if (contentType.includes('application/json')) {
      submitted = c.req.header('X-Csrf-Token') ?? undefined;
    } else {
      try {
        const form = await c.req.parseBody();
        submitted = typeof form._csrf === 'string' ? form._csrf : undefined;
        // Re-attach parsed body for downstream handlers
        (c as unknown as { _parsedBody?: unknown })._parsedBody = form;
      } catch {
        submitted = undefined;
      }
    }
    if (!submitted || submitted.length !== cookieToken.length) {
      return c.json({ error: 'csrf_mismatch' }, 403);
    }
    try {
      if (!timingSafeEqual(Buffer.from(submitted), Buffer.from(cookieToken))) {
        return c.json({ error: 'csrf_mismatch' }, 403);
      }
    } catch {
      return c.json({ error: 'csrf_mismatch' }, 403);
    }
    await next();
    return;
  };
}
