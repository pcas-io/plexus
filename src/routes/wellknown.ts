/**
 * OAuth discovery endpoints (RFC 8414 + RFC 9728).
 *
 * Mounted at /.well-known/* BEFORE pagesRoutes so the catch-all
 * session middleware does not swallow these requests. They are the
 * first thing an MCP client like claude.ai hits.
 */

import { Hono } from 'hono';
import type { PlexusConfig } from '../config.js';
import { mcpCors } from '../auth/cors.js';

export function wellKnownRoutes(cfg: PlexusConfig): Hono {
  const app = new Hono();
  app.use('*', mcpCors());

  // ---------- /.well-known/oauth-authorization-server ----------
  // RFC 8414 authorization server metadata. claude.ai fetches this to
  // learn where to register clients and exchange codes.
  app.get('/oauth-authorization-server', (c) => {
    const base = cfg.baseUrl.replace(/\/$/, '');
    return c.json({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      revocation_endpoint: `${base}/oauth/revoke`,
      scopes_supported: ['mcp'],
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      service_documentation: `${base}/`,
    });
  });

  // ---------- /.well-known/oauth-protected-resource ----------
  // RFC 9728 protected resource metadata. Points clients at the
  // authorization server they should use to get a token for this
  // resource.
  app.get('/oauth-protected-resource', (c) => {
    const base = cfg.baseUrl.replace(/\/$/, '');
    return c.json({
      resource: `${base}/mcp`,
      authorization_servers: [base],
      scopes_supported: ['mcp'],
      bearer_methods_supported: ['header'],
      resource_documentation: `${base}/`,
    });
  });

  return app;
}
