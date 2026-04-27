/**
 * Plexus MCP tools.
 *
 * Implements the tool interface defined in the Kickoff ADR (buddy node
 * 01KNF08JS7VKWPRYF1N8Q8ESMB, Abschnitt "MCP-Interface"):
 *
 *   Read:
 *     get_entity, list_entities, search_entities, get_related,
 *     kinds.list, relations.list, context_load
 *
 *   Write (enforced via scope.permission >= 'write'):
 *     save_entity, update_entity, archive_entity,
 *     link_entities, unlink_entity
 *
 * Scope enforcement (Auth-ADR 01KNF1YX0DS7BEKAF2EF6F8TG1 Abschnitt 2):
 *   - read tools require permission 'read' | 'write' | 'admin'
 *   - write tools require permission 'write' | 'admin'
 *   - all tools filter by the token's contexts whitelist
 *   - kind filter rejects if the token restricts kinds and the requested
 *     kind is not in the whitelist
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Entity } from '../db/repositories/entities.js';
import { VersionConflictError } from '../db/repositories/entities.js';
import { isAttributesWithinSize, MAX_ATTRIBUTE_JSON_BYTES } from '../db/util/clean.js';
import {
  HandoffValidationError,
  isHandoffFact,
  validateHandoffCreation,
} from '../db/util/handoff_validation.js';
import {
  AttributeValidationError,
  validateAttributes,
} from '../db/util/attribute_validation.js';
import {
  RequiredEdgeValidationError,
  validateRequiredEdges,
  type PlannedEdge,
} from '../db/util/required_edge_validation.js';
import { buildEntityPreview } from './entity_preview.js';
import type { McpDeps, McpScope } from './server.js';
import { registerSkillTools } from './skill_tools.js';

// ---------------- Shared Zod helpers ----------------

/**
 * Accept any-shaped JSON input for `attributes` / `properties` but reject
 * payloads larger than MAX_ATTRIBUTE_JSON_BYTES (MOD-7 from the 2026-04-10
 * audit). The refine message intentionally includes the limit so MCP
 * clients can surface it to humans without needing a docs lookup.
 */
function boundedAttributes() {
  return z
    .any()
    .refine(isAttributesWithinSize, {
      message: `attributes exceed the maximum JSON size of ${MAX_ATTRIBUTE_JSON_BYTES} bytes`,
    })
    .optional();
}

// ---------------- Scope helpers ----------------

class ScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScopeError';
  }
}

function requireWrite(scope: McpScope): void {
  if (scope.permission === 'read') {
    throw new ScopeError(
      'scope_read_only: this token has read-only permission and cannot perform write operations'
    );
  }
}

function checkContext(scope: McpScope, context: string | undefined): void {
  if (!context) return;
  if (!scope.contexts || scope.contexts.length === 0) return;
  if (!scope.contexts.includes(context)) {
    throw new ScopeError(
      `scope_context_denied: token not allowed in context "${context}" (allowed: ${scope.contexts.join(', ')})`
    );
  }
}

function checkKind(scope: McpScope, kind: string | undefined): void {
  if (!kind) return;
  if (!scope.kinds || scope.kinds.length === 0) return;
  if (!scope.kinds.includes(kind)) {
    throw new ScopeError(
      `scope_kind_denied: token not allowed for kind "${kind}" (allowed: ${scope.kinds.join(', ')})`
    );
  }
}

/**
 * KRITISCH-1 fix: kind='secret' entities must never be returned via
 * MCP. Share-links already block them, but MCP read-tools did not.
 * This filter runs on every MCP response that includes entity data.
 */
function filterSecrets<T extends { kind: string }>(entities: T[]): T[] {
  return entities.filter((e) => e.kind !== 'secret');
}

function rejectSecret(kind: string): void {
  if (kind === 'secret') {
    throw new ScopeError('kind_secret_blocked: secret entities cannot be accessed via MCP');
  }
}

function firstAllowedContextForScope(scope: McpScope): string | undefined {
  return scope.contexts && scope.contexts.length > 0 ? scope.contexts[0] : undefined;
}

// ---------------- Result helpers ----------------

function jsonResult(data: unknown): CallToolResult {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errorResult(message: string, code?: string): CallToolResult {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ error: code ?? 'error', message }, null, 2),
      },
    ],
    isError: true,
  };
}

// ---------------- Tool registration ----------------

export function registerPlexusTools(server: McpServer, deps: McpDeps): void {
  const { entities, edges, activity, kinds: kindRegistry, relations: relationRegistry, skills, auth } = deps;
  const scope = auth.scope;
  const userId = auth.user.id;
  const userName = auth.user.name;

  // Best-effort audit log write. Never throws — audit failure must not
  // abort a successful mutation.
  const audit = async (
    action: string,
    targetType: 'entity' | 'edge',
    targetId: string,
    metadata?: Record<string, unknown>
  ): Promise<void> => {
    try {
      await activity.create({
        userName,
        action,
        targetType,
        targetId,
        outcome: 'success',
        metadata,
      });
    } catch (err) {
      console.error('[plexus] activity log write failed:', err);
    }
  };

  // ---------- save_entity ----------
  server.tool(
    'save_entity',
    'Create a new entity in the knowledge graph. Use for new knowledge, decisions, facts, tasks, projects, and any other typed record. Handoff-facts (kind=fact, attributes.session_type=handoff) require the session_date/session_id/agent_id attributes and a part_of project id. Decisions require at least one context edge (derived_from/triggered_by/supersedes/part_of) — pass via part_of or the related[] parameter for atomic save+link. Call list_kinds to discover attribute schemas and required_edge_groups per kind.',
    {
      kind: z.string().describe('Entity type (concept, decision, fact, project, task, document, note, …). Must exist in the kinds registry; call list_kinds to enumerate.'),
      title: z.string().min(1).max(500),
      body: z.string().optional().describe('Long-form markdown body.'),
      attributes: boundedAttributes().describe('Kind-specific structured attributes. list_kinds returns the attributes_schema (required + recommended fields + enum constraints) for each kind.'),
      context: z.string().describe('Organisational context. Use list_entities or context_load to discover available contexts.'),
      part_of: z
        .string()
        .optional()
        .describe('Entity id of an active project to link via a part_of edge. Required when attributes.session_type=handoff; often satisfies required_edge_groups on its own.'),
      related: z
        .array(z.object({
          to_id: z.string().describe('Target entity id.'),
          relation: z.string().describe('Relation name (derived_from, triggered_by, supersedes, documents, implements, …). Call list_relations to enumerate.'),
        }))
        .optional()
        .describe('Additional edges to create atomically alongside the entity. Use to satisfy required_edge_groups for kinds like decision (needs derived_from/triggered_by/supersedes/part_of). On edge-link failure the newly created entity is rolled back.'),
    },
    async ({ kind, title, body, attributes, context, part_of, related }) => {
      try {
        requireWrite(scope);
        checkContext(scope, context);
        checkKind(scope, kind);
        rejectSecret(kind);
        const kindDef = await kindRegistry.findByName(kind);
        if (!kindDef) {
          return errorResult(`unknown kind: ${kind}`, 'unknown_kind');
        }

        // Attribute-schema validation (P1a). Runs before any DB write so
        // the entity never lands when required attrs are missing.
        const attrsRecord = (attributes ?? undefined) as
          | Record<string, unknown>
          | undefined;
        validateAttributes(kind, attrsRecord, kindDef.attributes_schema);

        // Handoff-fact pre-flight: resolve part_of target so the
        // validator sees the real entity (kind + status), not just a
        // bare id. This runs before the DB insert so a broken handoff
        // never leaves a zombie entity behind.
        const handoff = isHandoffFact(kind, attrsRecord);
        let partOfTarget: Awaited<ReturnType<typeof entities.get>> = null;
        if (part_of) {
          partOfTarget = await entities.get(part_of);
          if (!partOfTarget) {
            return errorResult(`part_of entity not found: ${part_of}`, 'not_found');
          }
          checkContext(scope, partOfTarget.context);
          checkKind(scope, partOfTarget.kind);
        }
        if (handoff) {
          validateHandoffCreation({
            attributes: attrsRecord,
            partOfEntity: partOfTarget,
            kind,
          });
        }

        // Resolve the `related` targets up front so we can reject
        // unknown ids before creating the entity. Each entry becomes
        // an out-edge from the new entity. We also record the relations
        // in the planned-edges list for required_edge_groups validation.
        const relatedTargets: Array<{
          toId: string;
          relation: string;
          target: Entity;
        }> = [];
        for (const rel of related ?? []) {
          const target = await entities.get(rel.to_id);
          if (!target) {
            return errorResult(`related entity not found: ${rel.to_id}`, 'not_found');
          }
          checkContext(scope, target.context);
          checkKind(scope, target.kind);
          relatedTargets.push({ toId: target.id, relation: rel.relation, target });
        }

        const plannedEdges: PlannedEdge[] = [];
        if (part_of) plannedEdges.push({ relation: 'part_of', direction: 'out' });
        for (const rt of relatedTargets) {
          plannedEdges.push({ relation: rt.relation, direction: 'out' });
        }
        validateRequiredEdges(kind, kindDef.required_edge_groups, plannedEdges);

        const created = await entities.save({ kind, title, body, attributes, context }, userId);
        await audit('save_entity', 'entity', created.id, { kind, context });

        // Any edge failure below triggers entity rollback (archive) to
        // avoid leaving a zombie without its required/requested
        // relations. Applies both to handoff-facts (historical rule)
        // and to required_edge_groups members (decision, …).
        const rollback = async (reason: string): Promise<void> => {
          try {
            await entities.archive(created.id, userId);
          } catch (archiveErr) {
            console.error(`[plexus] rollback archive failed (${reason}):`, archiveErr);
            throw archiveErr;
          }
        };

        const needsRollbackOnEdgeFailure =
          handoff || kindDef.required_edge_groups.length > 0;

        if (part_of && partOfTarget) {
          try {
            const edge = await edges.link(
              { fromId: created.id, toId: partOfTarget.id, relation: 'part_of' },
              userId
            );
            await audit('link_entities', 'edge', edge.id, {
              from_id: edge.from_entity,
              to_id: edge.to_entity,
              relation: edge.relation,
              reason: 'save_entity_part_of',
            });
          } catch (linkErr) {
            const linkMsg = (linkErr as Error).message;
            if (needsRollbackOnEdgeFailure) {
              try {
                await rollback('part_of link failure');
              } catch {
                return errorResult(
                  `failed to link part_of edge: ${linkMsg} — and rollback archive also failed; orphan entity id: ${created.id}`,
                  'rollback_failed'
                );
              }
              return errorResult(
                `failed to link part_of edge: ${linkMsg} — rolled back entity ${created.id}`,
                'link_failed'
              );
            }
            return errorResult(`failed to link part_of edge: ${linkMsg}`, 'link_failed');
          }
        }

        for (const rt of relatedTargets) {
          try {
            const edge = await edges.link(
              { fromId: created.id, toId: rt.toId, relation: rt.relation },
              userId
            );
            await audit('link_entities', 'edge', edge.id, {
              from_id: edge.from_entity,
              to_id: edge.to_entity,
              relation: edge.relation,
              reason: 'save_entity_related',
            });
          } catch (linkErr) {
            const linkMsg = (linkErr as Error).message;
            if (needsRollbackOnEdgeFailure) {
              try {
                await rollback(`related[${rt.relation}] link failure`);
              } catch {
                return errorResult(
                  `failed to link related edge (${rt.relation} → ${rt.toId}): ${linkMsg} — rollback archive also failed; orphan entity id: ${created.id}`,
                  'rollback_failed'
                );
              }
              return errorResult(
                `failed to link related edge (${rt.relation} → ${rt.toId}): ${linkMsg} — rolled back entity ${created.id}`,
                'link_failed'
              );
            }
            return errorResult(
              `failed to link related edge (${rt.relation} → ${rt.toId}): ${linkMsg}`,
              'link_failed'
            );
          }
        }

        // Re-fetch to get a clean entity with attributes intact — the
        // CREATE result loses nested objects during CBOR roundtrip.
        const entity = await entities.get(created.id) ?? created;
        return jsonResult({ entity });
      } catch (err) {
        if (err instanceof ScopeError) return errorResult(err.message, 'scope_denied');
        if (err instanceof HandoffValidationError) {
          return errorResult(err.message, err.code);
        }
        if (err instanceof AttributeValidationError) {
          return errorResult(err.message, err.code);
        }
        if (err instanceof RequiredEdgeValidationError) {
          return errorResult(err.message, err.code);
        }
        return errorResult((err as Error).message, 'save_failed');
      }
    }
  );

  // ---------- get_entity ----------
  server.tool(
    'get_entity',
    'Fetch a single entity by id.',
    {
      id: z.string().describe('Entity id (full "entities:abc..." or raw "abc...").'),
    },
    async ({ id }) => {
      try {
        const entity = await entities.get(id);
        if (!entity) return errorResult(`entity not found: ${id}`, 'not_found');
        rejectSecret(entity.kind);
        checkContext(scope, entity.context);
        checkKind(scope, entity.kind);
        return jsonResult({ entity });
      } catch (err) {
        if (err instanceof ScopeError) return errorResult(err.message, 'scope_denied');
        return errorResult((err as Error).message, 'get_failed');
      }
    }
  );

  // ---------- list_entities ----------
  server.tool(
    'list_entities',
    'List entities with optional filters. If context is omitted, lists across ALL contexts the token has access to — no per-context loop needed. Defaults to status=active and excludes eval snapshots (attributes.is_eval=true); pass include_eval=true to see them.',
    {
      kind: z.string().optional().describe('Filter by entity kind (fact, task, decision, ...). Omit to include all kinds.'),
      context: z.string().optional().describe('Filter by context namespace. Omit to search across all accessible contexts.'),
      status: z.string().optional().describe('Filter by status (default: active). Pass "archived" to include soft-deleted entities.'),
      limit: z.coerce.number().int().min(1).max(500).optional(),
      offset: z.coerce.number().int().min(0).optional(),
      attributes: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe('Exact-match filter on attribute values, AND\'d together. Example: {"priority":"high","is_milestone":true}. Field names must match [a-zA-Z0-9_]+.'),
      has_relation: z
        .object({
          relation: z.string().describe('Relation name (part_of, triggered_by, ...). Call list_relations to enumerate.'),
          target_id: z.string().optional().describe('Target entity id. Omit to match any target of this relation.'),
          direction: z.enum(['out', 'in', 'any']).optional().describe('out (default any): entity has an out-edge of this relation.'),
        })
        .optional()
        .describe('Restrict to entities that currently have an active edge matching this relation. Example: {"relation":"triggered_by","target_id":"entities:foo"} returns all entities triggered by foo.'),
      include_eval: z
        .boolean()
        .optional()
        .describe('Set true to include entities marked attributes.is_eval=true (graph self-evaluations, benchmark snapshots). Default false.'),
    },
    async ({ kind, context, status, limit, offset, attributes, has_relation, include_eval }) => {
      try {
        if (context) checkContext(scope, context);
        if (kind) checkKind(scope, kind);
        let results = await entities.list({
          kind,
          context,
          status,
          limit,
          offset,
          attributes,
          has_relation,
          exclude_eval: include_eval !== true,
        });
        // If the scope restricts contexts but no context filter was given,
        // post-filter to the allowed set.
        if (!context && scope.contexts && scope.contexts.length > 0) {
          const allowed = new Set(scope.contexts);
          results = results.filter((e) => allowed.has(e.context));
        }
        if (!kind && scope.kinds && scope.kinds.length > 0) {
          const allowed = new Set(scope.kinds);
          results = results.filter((e) => allowed.has(e.kind));
        }
        results = filterSecrets(results);
        return jsonResult({ entities: results, count: results.length });
      } catch (err) {
        if (err instanceof ScopeError) return errorResult(err.message, 'scope_denied');
        return errorResult((err as Error).message, 'list_failed');
      }
    }
  );

  // ---------- search_entities ----------
  server.tool(
    'search_entities',
    'Full-text search (BM25) across entity title and body. If context is omitted, searches ALL accessible contexts — do not loop per-context. Defaults exclude eval snapshots (attributes.is_eval=true); pass include_eval=true to see them. Pass body_preview_chars for wide queries to stay under the MCP 10k token response limit. Full bodies remain reachable via get_entity.',
    {
      query: z.string().min(1).describe('BM25 search query. Literal tokens only — no fuzzy matching, no synonyms yet. Typos return empty results.'),
      kind: z.string().optional().describe('Filter by entity kind. Omit to include all kinds.'),
      context: z.string().optional().describe('Filter by context namespace. Omit to search across all accessible contexts.'),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      body_preview_chars: z.coerce.number().int().min(0).max(2000).optional().describe('Characters of body to include per result as body_preview. When set, body is replaced by body_preview + body_length + body_truncated (analogous to context_load). When unset, full bodies are returned (backward compatible). Set to 0 for metadata only.'),
      attributes: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe('Exact-match filter on attribute values, AND\'d together. Example: {"priority":"high"}.'),
      has_relation: z
        .object({
          relation: z.string(),
          target_id: z.string().optional(),
          direction: z.enum(['out', 'in', 'any']).optional(),
        })
        .optional()
        .describe('Restrict to entities that currently have an active edge matching this relation.'),
      include_eval: z
        .boolean()
        .optional()
        .describe('Set true to include entities marked attributes.is_eval=true. Default false.'),
    },
    async ({ query, kind, context, limit, body_preview_chars, attributes, has_relation, include_eval }) => {
      try {
        if (context) checkContext(scope, context);
        if (kind) checkKind(scope, kind);
        let results = await entities.search(query, {
          kind,
          context,
          limit,
          attributes,
          has_relation,
          exclude_eval: include_eval !== true,
        });
        if (!context && scope.contexts && scope.contexts.length > 0) {
          const allowed = new Set(scope.contexts);
          results = results.filter((e) => allowed.has(e.context));
        }
        if (!kind && scope.kinds && scope.kinds.length > 0) {
          const allowed = new Set(scope.kinds);
          results = results.filter((e) => allowed.has(e.kind));
        }
        results = filterSecrets(results);
        if (body_preview_chars !== undefined) {
          const slim = results.map((e) => buildEntityPreview(e, body_preview_chars));
          return jsonResult({ results: slim, count: slim.length });
        }
        return jsonResult({ results, count: results.length });
      } catch (err) {
        if (err instanceof ScopeError) return errorResult(err.message, 'scope_denied');
        return errorResult((err as Error).message, 'search_failed');
      }
    }
  );

  // ---------- update_entity ----------
  server.tool(
    'update_entity',
    'Update an existing entity. Uses optimistic locking via expected_version — if the stored version does not match, returns a version_conflict error and the caller should re-read and retry.',
    {
      id: z.string(),
      expected_version: z.coerce.number().int().min(1),
      title: z.string().optional(),
      body: z.string().optional(),
      attributes: boundedAttributes(),
      status: z.string().optional(),
    },
    async ({ id, expected_version, title, body, attributes, status }) => {
      try {
        requireWrite(scope);
        const current = await entities.get(id);
        if (!current) return errorResult(`entity not found: ${id}`, 'not_found');
        checkContext(scope, current.context);
        checkKind(scope, current.kind);
        const updated = await entities.update(
          id,
          expected_version,
          { title, body, attributes, status },
          userId
        );
        await audit('update_entity', 'entity', updated.id, {
          kind: updated.kind,
          context: updated.context,
          version: updated.version,
        });
        // Re-fetch for clean attributes (CBOR roundtrip fix).
        const entity = await entities.get(updated.id) ?? updated;
        return jsonResult({ entity });
      } catch (err) {
        if (err instanceof VersionConflictError) {
          return errorResult(err.message, 'version_conflict');
        }
        if (err instanceof ScopeError) return errorResult(err.message, 'scope_denied');
        return errorResult((err as Error).message, 'update_failed');
      }
    }
  );

  // ---------- archive_entity ----------
  server.tool(
    'archive_entity',
    'Soft-delete an entity by setting its status to "archived". Archived entities are excluded from list/search results by default.',
    {
      id: z.string(),
    },
    async ({ id }) => {
      try {
        requireWrite(scope);
        const current = await entities.get(id);
        if (!current) return errorResult(`entity not found: ${id}`, 'not_found');
        checkContext(scope, current.context);
        checkKind(scope, current.kind);
        const archived = await entities.archive(id, userId);
        await audit('archive_entity', 'entity', archived.id, {
          kind: archived.kind,
          context: archived.context,
        });
        return jsonResult({ entity: archived });
      } catch (err) {
        if (err instanceof ScopeError) return errorResult(err.message, 'scope_denied');
        return errorResult((err as Error).message, 'archive_failed');
      }
    }
  );

  // ---------- link_entities ----------
  server.tool(
    'link_entities',
    'Create an edge between two entities. Edges are temporal: the edge is "currently active" until unlink_entity is called, which sets its valid_to timestamp.',
    {
      from_id: z.string(),
      to_id: z.string(),
      relation: z.string().describe('Relation name from the relations registry (relates_to, depends_on, supersedes, …).'),
      properties: boundedAttributes(),
      confidence: z.coerce.number().min(0).max(1).optional(),
      source: z.enum(['manual', 'llm-inferred', 'computed', 'imported']).optional(),
    },
    async ({ from_id, to_id, relation, properties, confidence, source }) => {
      try {
        requireWrite(scope);
        const [fromEntity, toEntity, relationDef] = await Promise.all([
          entities.get(from_id),
          entities.get(to_id),
          relationRegistry.findByName(relation),
        ]);
        if (!fromEntity) return errorResult(`from entity not found: ${from_id}`, 'not_found');
        if (!toEntity) return errorResult(`to entity not found: ${to_id}`, 'not_found');
        if (!relationDef) return errorResult(`unknown relation: ${relation}`, 'unknown_relation');
        checkContext(scope, fromEntity.context);
        checkContext(scope, toEntity.context);
        checkKind(scope, fromEntity.kind);
        checkKind(scope, toEntity.kind);
        const edge = await edges.link(
          { fromId: from_id, toId: to_id, relation, properties, confidence, source },
          userId
        );
        await audit('link_entities', 'edge', edge.id, {
          from_id: edge.from_entity,
          to_id: edge.to_entity,
          relation: edge.relation,
        });
        // Touch both endpoints so project activity scores pick up linking
        // as activity on the project itself, not just on the new edge row.
        await audit('link_entities', 'entity', edge.from_entity, { relation, peer: edge.to_entity });
        await audit('link_entities', 'entity', edge.to_entity, { relation, peer: edge.from_entity });
        return jsonResult({ edge });
      } catch (err) {
        if (err instanceof ScopeError) return errorResult(err.message, 'scope_denied');
        return errorResult((err as Error).message, 'link_failed');
      }
    }
  );

  // ---------- unlink_entity ----------
  server.tool(
    'unlink_entity',
    'Invalidate an edge by setting its valid_to timestamp. The edge stays in the graph as history for point-in-time queries.',
    {
      edge_id: z.string(),
    },
    async ({ edge_id }) => {
      try {
        requireWrite(scope);
        const edge = await edges.unlink(edge_id);
        if (!edge) return errorResult(`edge not found or already inactive: ${edge_id}`, 'not_found');
        await audit('unlink_entity', 'edge', edge.id, {
          from_id: edge.from_entity,
          to_id: edge.to_entity,
          relation: edge.relation,
        });
        await audit('unlink_entity', 'entity', edge.from_entity, { relation: edge.relation });
        await audit('unlink_entity', 'entity', edge.to_entity, { relation: edge.relation });
        return jsonResult({ edge });
      } catch (err) {
        if (err instanceof ScopeError) return errorResult(err.message, 'scope_denied');
        return errorResult((err as Error).message, 'unlink_failed');
      }
    }
  );

  // ---------- get_related ----------
  server.tool(
    'get_related',
    'Get edges related to an entity, optionally filtered by relation and direction. Supports point-in-time queries via as_of (ISO timestamp).',
    {
      entity_id: z.string(),
      relation: z.string().optional(),
      direction: z.enum(['in', 'out', 'both']).optional(),
      as_of: z.string().optional().describe('ISO timestamp for point-in-time queries. Default: now.'),
      limit: z.coerce.number().int().min(1).max(500).optional(),
    },
    async ({ entity_id, relation, direction, as_of, limit }) => {
      try {
        const entity = await entities.get(entity_id);
        if (!entity) return errorResult(`entity not found: ${entity_id}`, 'not_found');
        checkContext(scope, entity.context);
        const related = await edges.getRelated(entity_id, { relation, direction, asOf: as_of, limit });
        return jsonResult({ edges: related, count: related.length });
      } catch (err) {
        if (err instanceof ScopeError) return errorResult(err.message, 'scope_denied');
        return errorResult((err as Error).message, 'get_related_failed');
      }
    }
  );

  // ---------- kinds.list ----------
  server.tool(
    'list_kinds',
    'List all entity kinds in the registry with their attribute schemas.',
    {},
    async () => {
      try {
        const list = await kindRegistry.list();
        return jsonResult({ kinds: list });
      } catch (err) {
        return errorResult((err as Error).message, 'list_kinds_failed');
      }
    }
  );

  // ---------- relations.list ----------
  server.tool(
    'list_relations',
    'List all relations in the registry with their allowed kind pairs and cardinality.',
    {},
    async () => {
      try {
        const list = await relationRegistry.list();
        return jsonResult({ relations: list });
      } catch (err) {
        return errorResult((err as Error).message, 'list_relations_failed');
      }
    }
  );

  // ---------- context_load ----------
  server.tool(
    'context_load',
    'Session-start warm-up. Returns the 20 most recent entities (id + kind + title + attributes + a short body preview, NOT full body) plus the kinds/relations registries and the caller identity. Call get_entity for a full body. Default preview is 300 characters — pass body_preview_chars to adjust (max 2000). Full-body access via get_entity or list_entities + get_entity follow-ups.',
    {
      context: z.string().optional().describe('Target context. If omitted, loads across all contexts the token can see.'),
      body_preview_chars: z.coerce.number().int().min(0).max(2000).optional().describe('Characters of body to include per entity as body_preview. Default 300. Set to 0 to omit previews entirely and get metadata only.'),
    },
    async ({ context, body_preview_chars }) => {
      try {
        if (context) checkContext(scope, context);
        // If no context given and scope restricts to specific contexts,
        // use the first allowed one. If scope has no restriction (full
        // access), load across ALL contexts — no error.
        const target = context ?? firstAllowedContextForScope(scope) ?? undefined;
        const [recent, kindList, relationList] = await Promise.all([
          entities.list({ context: target, limit: 20 }),
          kindRegistry.list(),
          relationRegistry.list(),
        ]);
        // If scope restricts contexts and no explicit filter was given,
        // post-filter to the allowed set.
        let filteredRecent = recent;
        if (!target && scope.contexts && scope.contexts.length > 0) {
          const allowed = new Set(scope.contexts);
          filteredRecent = recent.filter((e) => allowed.has(e.context));
        }
        // Trim each entity's body to a preview via the shared helper in
        // entity_preview.ts. The full body is still reachable via
        // get_entity. Without this trimming the warm-up response hits
        // the MCP 10k token response limit as soon as a few ADRs or
        // runbooks land in the recent list (observed ~128 KB on the dev
        // context on 2026-04-11).
        const previewChars = body_preview_chars ?? 300;
        const slim = filterSecrets(filteredRecent).map((e) => buildEntityPreview(e, previewChars));
        return jsonResult({
          context: target ?? 'all',
          recent_entities: slim,
          kinds: kindList,
          relations: relationList,
          user: { name: auth.user.name, is_admin: auth.user.is_admin },
          hint: 'Entities carry body_preview (first 300 chars by default). Call get_entity for the full body when you need to read or update an entity.',
        });
      } catch (err) {
        if (err instanceof ScopeError) return errorResult(err.message, 'scope_denied');
        return errorResult((err as Error).message, 'context_load_failed');
      }
    }
  );

  // ---------- lint_graph ----------
  server.tool(
    'lint_graph',
    'Run a health check on the knowledge graph. Finds orphan entities (no edges), stale entities (not updated in N days), entities with only one connection (weak cross-referencing), and potential duplicate titles. Use this as part of the weekly lint cycle.',
    {
      context: z.string().optional().describe('Filter by context. Default: all contexts the token can see.'),
      stale_days: z.coerce.number().int().min(1).max(365).optional().describe('Threshold in days for stale detection. Default: 30.'),
    },
    async ({ context, stale_days }) => {
      try {
        if (context) checkContext(scope, context);
        const staleDays = stale_days ?? 30;
        const filter = context ? { context, limit: 50 } : { limit: 50 };

        const [orphans, stale, duplicates, totalCount] = await Promise.all([
          entities.findOrphans(filter),
          entities.findStale(staleDays, filter),
          entities.findDuplicateTitles(filter),
          entities.count(context ? { context } : {}),
        ]);

        // Scope-filter orphans and stale if token restricts contexts.
        let filteredOrphans = orphans;
        let filteredStale = stale;
        if (!context && scope.contexts && scope.contexts.length > 0) {
          const allowed = new Set(scope.contexts);
          filteredOrphans = orphans.filter((e) => allowed.has(e.context));
          filteredStale = stale.filter((e) => allowed.has(e.context));
        }

        return jsonResult({
          summary: {
            total_entities: totalCount,
            orphans: filteredOrphans.length,
            stale: filteredStale.length,
            duplicate_titles: duplicates.length,
          },
          orphans: filteredOrphans.map((e) => ({
            id: e.id, kind: e.kind, title: e.title, context: e.context, updated_at: e.updated_at,
          })),
          stale: filteredStale.map((e) => ({
            id: e.id, kind: e.kind, title: e.title, context: e.context, updated_at: e.updated_at,
          })),
          duplicate_titles: duplicates,
          lint_config: { stale_days: staleDays, context: context ?? 'all' },
        });
      } catch (err) {
        if (err instanceof ScopeError) return errorResult(err.message, 'scope_denied');
        return errorResult((err as Error).message, 'lint_failed');
      }
    }
  );

  // Skill library tools (extracted to skill_tools.ts to keep this file
  // under the 700-line cap). They need the same closure helpers we
  // define above, so we pass them in as a deps bundle.
  registerSkillTools(server, {
    skills,
    scope,
    audit,
    checkContext,
    checkKind,
    firstAllowedContextForScope,
    jsonResult,
    errorResult,
    ScopeError,
  });
}
