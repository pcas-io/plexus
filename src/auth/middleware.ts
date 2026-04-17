/**
 * Authentication middleware for Hono.
 *
 * Exposes `requireAdminToken` only — strictly scoped to the dashboard
 * login bootstrap and `/admin/*` JSON routes. Compares the Bearer token
 * against `PLEXUS_ADMIN_TOKEN`.
 *
 * MCP auth is deliberately NOT implemented here. It lives inline in
 * `src/index.ts` (POST /mcp handler) because it needs the full personal
 * token + OAuth access token resolution flow with per-token scope, which
 * a generic middleware cannot model without leaking request-specific
 * state into its type signature. An earlier `requireUserToken` middleware
 * that only checked `users.token_hash` was removed because it silently
 * disagreed with the inline MCP flow and was never wired up.
 */

import type { Context, MiddlewareHandler } from 'hono';
import type { PlexusConfig } from '../config.js';
import { extractBearerToken, timingSafeStringEqual } from './tokens.js';

function unauthorized(c: Context, message = 'Missing or invalid Bearer token') {
  return c.json({ error: 'unauthorized', message }, 401);
}

/**
 * Middleware for `/admin/*` routes. Accepts ONLY the configured
 * `PLEXUS_ADMIN_TOKEN`. Never accepts personal or OAuth tokens —
 * admin actions are reserved for humans holding the env-var secret.
 */
export function requireAdminToken(cfg: PlexusConfig): MiddlewareHandler {
  return async (c, next) => {
    const token = extractBearerToken(c.req.header('Authorization'));
    if (!token) return unauthorized(c);
    if (!timingSafeStringEqual(token, cfg.adminToken)) {
      return c.json({ error: 'invalid_admin_token' }, 401);
    }
    await next();
    return;
  };
}
