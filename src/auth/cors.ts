/**
 * CORS middleware with a strict origin allowlist.
 *
 * Used on the OAuth discovery, OAuth endpoints and the MCP endpoint so
 * that Claude Web (and other spec-compliant MCP clients) can reach
 * them from a browser context. A dedicated allowlist is used instead
 * of `*` because these endpoints accept bearer tokens and perform
 * writes — a lax CORS policy would turn every XSS anywhere into a
 * graph-leak primitive.
 *
 * Non-browser clients (Claude Desktop, Claude Code, Cursor, curl) do
 * not need CORS at all and are unaffected.
 */

import type { Context, MiddlewareHandler } from 'hono';

// Origins that are allowed to talk to the MCP + OAuth endpoints from
// a browser context. Kept in one place so it's easy to audit.
const ALLOWED_ORIGINS = new Set<string>([
  'https://claude.ai',
  'https://claude.com',
]);

const ALLOWED_METHODS = 'GET, POST, OPTIONS';
const ALLOWED_HEADERS =
  'Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version';
const EXPOSE_HEADERS = 'Mcp-Session-Id, Mcp-Protocol-Version, WWW-Authenticate';
const MAX_AGE = '86400';

function applyCorsHeaders(c: Context, origin: string): void {
  c.header('Access-Control-Allow-Origin', origin);
  c.header('Access-Control-Allow-Methods', ALLOWED_METHODS);
  c.header('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  c.header('Access-Control-Expose-Headers', EXPOSE_HEADERS);
  c.header('Access-Control-Max-Age', MAX_AGE);
  c.header('Vary', 'Origin');
}

/**
 * Attach this middleware to /mcp, /oauth/* and /.well-known/*.
 *
 * - For OPTIONS preflights from an allowed origin: answer 204 with
 *   the full CORS header set and DO NOT continue into the route
 *   handler (preflights must not run the real handler).
 * - For normal requests from an allowed origin: set the CORS headers
 *   before the handler runs, then continue.
 * - For requests without an Origin header (curl, native clients): do
 *   nothing and let the handler run unchanged.
 * - For requests from disallowed origins: do not echo the origin back
 *   (browsers will block the response) but still run the handler so
 *   non-browser usage keeps working.
 */
export function mcpCors(): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header('Origin');

    if (c.req.method === 'OPTIONS') {
      if (origin && ALLOWED_ORIGINS.has(origin)) {
        applyCorsHeaders(c, origin);
        return c.body(null, 204);
      }
      // Non-browser OPTIONS or disallowed origin — return 204 anyway
      // so intermediaries don't choke, but without CORS grants.
      return c.body(null, 204);
    }

    if (origin && ALLOWED_ORIGINS.has(origin)) {
      applyCorsHeaders(c, origin);
    }
    await next();
    return;
  };
}
