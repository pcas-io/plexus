/**
 * MCP Server factory.
 *
 * Builds a per-request McpServer instance with the plexus tool set.
 * Stateless mode: a fresh server is created for every HTTP request, so
 * there is no shared session state between callers. This is the right
 * pattern for an agent-facing API where each call is independent.
 *
 * The actual tool implementations live in `tools.ts` to keep this file
 * focused on wiring.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VERSION } from '../version.js';
import type { User } from '../db/repositories/users.js';
import type { EntityRepository } from '../db/repositories/entities.js';
import type { EdgeRepository } from '../db/repositories/edges.js';
import type { ActivityLogRepository } from '../db/repositories/activity_log.js';
import type { KindRegistry } from './registries.js';
import type { RelationRegistry } from './registries.js';
import type { SkillRepository } from '../db/repositories/skills.js';
import { registerPlexusTools } from './tools.js';

/**
 * Per-request authorization context. Populated by the MCP auth middleware
 * before the request is handed off to the server.
 */
export interface McpAuth {
  readonly user: User;
  readonly scope: McpScope;
}

export interface McpScope {
  /** Contexts the token is allowed to see. Empty array or undefined = all. */
  readonly contexts?: readonly string[];
  /** Permission level the token grants. */
  readonly permission: 'read' | 'write' | 'admin';
  /** Optional whitelist of entity kinds the token may touch. */
  readonly kinds?: readonly string[];
}

export interface McpDeps {
  readonly entities: EntityRepository;
  readonly edges: EdgeRepository;
  readonly activity: ActivityLogRepository;
  readonly kinds: KindRegistry;
  readonly relations: RelationRegistry;
  readonly skills: SkillRepository;
  readonly auth: McpAuth;
}

export function buildMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer(
    {
      name: 'plexus',
      version: VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        'Plexus — on-prem knowledge graph for AI agents. Use save_entity to store knowledge, link_entities to connect it, search_entities to find it, and get_related to traverse the graph.',
    }
  );

  registerPlexusTools(server, deps);

  return server;
}
