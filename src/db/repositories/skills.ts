/**
 * Skill Repository — thin wrapper over EntityRepository for kind='skill'.
 *
 * Skills live in the entities table. This repository exists so the MCP
 * tools layer has a single named source for skill queries and so future
 * skill-specific query shapes (e.g. "all skills created by Skill Forge")
 * do not leak into tools.ts.
 *
 * No unit tests — per the plexus convention, repository code that only
 * composes EntityRepository calls is exercised through the MCP tool
 * tests and not tested in isolation. Pure matching logic lives in
 * src/mcp/skill_match.ts where it is unit-tested.
 */

import type { Entity, EntityRepository } from './entities.js';

export interface SkillFilter {
  readonly context?: string;
  readonly limit?: number;
}

export class SkillRepository {
  constructor(private readonly entities: EntityRepository) {}

  /** All active skills in the given context (or any context when omitted). */
  async list(filter: SkillFilter = {}): Promise<Entity[]> {
    return this.entities.list({
      kind: 'skill',
      context: filter.context,
      status: 'active',
      limit: filter.limit ?? 200,
    });
  }

  /**
   * Full-text search restricted to skills, used by tier 3 of the match
   * algorithm in `load_skill`. Returns the raw BM25-ranked results —
   * the caller decides whether the top hit is a clear winner.
   */
  async search(query: string, filter: SkillFilter = {}): Promise<Entity[]> {
    return this.entities.search(query, {
      kind: 'skill',
      context: filter.context,
      limit: filter.limit ?? 10,
    });
  }
}
