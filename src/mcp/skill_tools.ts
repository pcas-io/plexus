/**
 * Skill MCP tools — list_skills + load_skill.
 *
 * Extracted from tools.ts to keep that file under the 700-line-per-file
 * rule and to give the skill subsystem a clear home. Called from
 * registerPlexusTools in tools.ts via registerSkillTools().
 *
 * See src/mcp/skill_match.ts for the pure matching logic and
 * src/db/repositories/skills.ts for the DB access wrapper.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Entity } from '../db/repositories/entities.js';
import type { SkillRepository } from '../db/repositories/skills.js';
import type { McpScope } from './server.js';
import { matchSkill } from './skill_match.js';

export interface SkillToolDeps {
  readonly skills: SkillRepository;
  readonly scope: McpScope;
  readonly audit: (action: string, targetType: 'entity' | 'edge', targetId: string, metadata?: Record<string, unknown>) => Promise<void>;
  readonly checkContext: (scope: McpScope, context: string | undefined) => void;
  readonly checkKind: (scope: McpScope, kind: string | undefined) => void;
  readonly firstAllowedContextForScope: (scope: McpScope) => string | undefined;
  readonly jsonResult: (data: unknown) => CallToolResult;
  readonly errorResult: (message: string, code?: string) => CallToolResult;
  readonly ScopeError: new (message: string) => Error;
}

function serializeFullSkill(s: Entity) {
  const a = s.attributes as Record<string, unknown>;
  return {
    id: s.id,
    name: typeof a.name === 'string' ? a.name : null,
    description: typeof a.description === 'string' ? a.description : null,
    version: typeof a.version === 'string' ? a.version : null,
    category: typeof a.category === 'string' ? a.category : null,
    trigger_phrases: Array.isArray(a.trigger_phrases)
      ? (a.trigger_phrases as unknown[]).filter((t): t is string => typeof t === 'string')
      : [],
    body: s.body ?? '',
    context: s.context,
  };
}

export function registerSkillTools(server: McpServer, deps: SkillToolDeps): void {
  const { skills, scope, audit, checkContext, checkKind, firstAllowedContextForScope, jsonResult, errorResult, ScopeError } = deps;

  // ---------- list_skills ----------
  server.tool(
    'list_skills',
    'List every skill available to the token. Returns a compact index — name, description, version, category, trigger phrases, id — but NOT the Markdown body. Call load_skill to fetch a full skill by name or trigger phrase. Default context is the first one the token can see; pass context to target a specific namespace.',
    {
      context: z.string().optional().describe('Target context. If omitted, uses the first context the token can see.'),
    },
    async ({ context }) => {
      try {
        if (context) checkContext(scope, context);
        checkKind(scope, 'skill');
        const target = context ?? firstAllowedContextForScope(scope) ?? undefined;
        const rows = await skills.list({ context: target });
        const index = rows.map((s) => {
          const a = s.attributes as Record<string, unknown>;
          return {
            id: s.id,
            name: typeof a.name === 'string' ? a.name : null,
            description: typeof a.description === 'string' ? a.description : null,
            version: typeof a.version === 'string' ? a.version : null,
            category: typeof a.category === 'string' ? a.category : null,
            trigger_phrases: Array.isArray(a.trigger_phrases)
              ? (a.trigger_phrases as unknown[]).filter((t): t is string => typeof t === 'string')
              : [],
            context: s.context,
          };
        });
        return jsonResult({
          skills: index,
          count: index.length,
          hint: 'Call load_skill with a name or trigger phrase to fetch the Markdown body.',
        });
      } catch (err) {
        if (err instanceof ScopeError) return errorResult((err as Error).message, 'scope_denied');
        return errorResult((err as Error).message, 'list_skills_failed');
      }
    }
  );

  // ---------- load_skill ----------
  server.tool(
    'load_skill',
    'Load a single skill by name, trigger phrase, or fuzzy match. Matching tiers: (1) exact name, (2) exact trigger phrase, (3) BM25 full-text fallback, (4) not_found. Returns the full Markdown body so the caller can follow the skill instructions. Audit log records which tier matched.',
    {
      query: z.string().min(1).describe('Skill name ("pre-mortem"), trigger phrase ("Pre-Mortem", "Root Cause"), or a freeform search for BM25 fallback.'),
      context: z.string().optional().describe('Target context. If omitted, uses the first context the token can see.'),
    },
    async ({ query, context }) => {
      try {
        if (context) checkContext(scope, context);
        checkKind(scope, 'skill');
        const target = context ?? firstAllowedContextForScope(scope) ?? undefined;

        // Load all active skills in the target context once so tiers 1
        // and 2 can run in memory. The active-skill set is small
        // (dozens, not thousands) so this is cheap.
        const all = await skills.list({ context: target });
        const decision = matchSkill(query, all);

        if (decision.kind === 'match') {
          const s = decision.skill;
          await audit('load_skill', 'entity', s.id, {
            skill_name: (s.attributes as Record<string, unknown>).name ?? null,
            match_tier: decision.tier,
            query,
          });
          return jsonResult({ skill: serializeFullSkill(s), match_tier: decision.tier });
        }

        // Tier 3: BM25 fallback via the FTS indexes.
        const hits = await skills.search(query, { context: target, limit: 3 });
        if (hits.length === 0) {
          return errorResult(
            `skill_not_found: no skill matched "${query}". Candidates: ${decision.candidates.join(', ') || 'none'}.`,
            'skill_not_found'
          );
        }
        if (hits.length === 1) {
          const s = hits[0]!;
          await audit('load_skill', 'entity', s.id, {
            skill_name: (s.attributes as Record<string, unknown>).name ?? null,
            match_tier: 'bm25',
            query,
          });
          return jsonResult({ skill: serializeFullSkill(s), match_tier: 'bm25' });
        }

        // Multiple BM25 hits. We do not surface per-row BM25 scores out
        // of entities.search(), so we fall back to "clear winner =
        // single result". 2+ hits means the caller must disambiguate.
        const candidateNames = hits.map((s) => {
          const a = s.attributes as Record<string, unknown>;
          return typeof a.name === 'string' ? a.name : s.id;
        });
        return errorResult(
          `skill_ambiguous: multiple skills matched "${query}" (${candidateNames.join(', ')}). Call load_skill with a specific name.`,
          'skill_ambiguous'
        );
      } catch (err) {
        if (err instanceof ScopeError) return errorResult((err as Error).message, 'scope_denied');
        return errorResult((err as Error).message, 'load_skill_failed');
      }
    }
  );
}
