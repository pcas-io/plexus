/**
 * MCP HTTP transport adapter for Hono.
 *
 * Uses the WebStandardStreamableHTTPServerTransport from the MCP SDK,
 * which is fetch-native (takes a Request, returns a Response). We run
 * in stateless mode — one server instance per HTTP call — so there is
 * no shared session state and auth is enforced fresh on every request.
 */

import type { Context } from 'hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { buildMcpServer, type McpAuth } from './server.js';
import type { EntityRepository } from '../db/repositories/entities.js';
import type { EdgeRepository } from '../db/repositories/edges.js';
import type { ActivityLogRepository } from '../db/repositories/activity_log.js';
import type { KindRegistry, RelationRegistry } from './registries.js';
import type { SkillRepository } from '../db/repositories/skills.js';

export interface McpHandlerDeps {
  readonly entities: EntityRepository;
  readonly edges: EdgeRepository;
  readonly activity: ActivityLogRepository;
  readonly kinds: KindRegistry;
  readonly relations: RelationRegistry;
  readonly skills: SkillRepository;
}

/**
 * Returns a Hono handler that serves the MCP protocol on POST /mcp.
 * The caller must have already validated the user token and attached
 * the McpAuth context via c.set('mcpAuth', ...).
 */
export async function handleMcpRequest(
  c: Context,
  deps: McpHandlerDeps,
  auth: McpAuth
): Promise<Response> {
  const server = buildMcpServer({ ...deps, auth });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
}
