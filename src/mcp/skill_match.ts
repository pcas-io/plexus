/**
 * Pure skill matcher.
 *
 * Takes a query string and an already-loaded list of `kind='skill'`
 * entities and returns a match decision. No DB access, no scope checks,
 * no I/O — that is the repository and tool layer's job. Keeping this
 * function pure lets the test suite exercise the full four-tier logic
 * without a running SurrealDB.
 *
 * Tiers:
 *   1. Exact name match on `attributes.name` (case-insensitive).
 *   2. Trigger phrase match on `attributes.trigger_phrases`.
 *   3. (BM25 tier runs in the tool layer because it needs the DB.)
 *   4. not_found, with up to 3 candidate names as recovery hints.
 *
 * Tiers 1 and 2 both prefer the highest `attributes.version` when the
 * same name shows up more than once — this supports Skill Forge's
 * versioned publishing workflow.
 */

import type { Entity } from '../db/repositories/entities.js';
import { compareSkillVersions } from './semver.js';

export type SkillMatch =
  | { kind: 'match'; skill: Entity; tier: 'name' | 'trigger' }
  | { kind: 'not_found'; candidates: string[] };

function skillAttr(s: Entity): { name: string; triggers: string[]; version: string } {
  const a = s.attributes as Record<string, unknown>;
  const name = typeof a.name === 'string' ? a.name : '';
  const triggers = Array.isArray(a.trigger_phrases)
    ? (a.trigger_phrases as unknown[]).filter((t): t is string => typeof t === 'string')
    : [];
  const version = typeof a.version === 'string' ? a.version : 'v0.0.0';
  return { name, triggers, version };
}

function suggestCandidates(query: string, skills: readonly Entity[]): string[] {
  const lower = query.toLowerCase();
  // Score: 2 = exact prefix, 1 = substring, 0 = no match.
  // Stable sort preserves list order within a score bucket.
  const scored = skills
    .map((s) => skillAttr(s).name)
    .filter((n): n is string => typeof n === 'string' && n.length > 0)
    .map((name) => {
      const lowered = name.toLowerCase();
      let score = 0;
      if (lowered.startsWith(lower)) score = 2;
      else if (lowered.includes(lower)) score = 1;
      return { name, score };
    });
  // Sort: highest score first, stable within ties.
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map((x) => x.name);
}

function pickHighestVersion(candidates: Entity[]): Entity {
  const sorted = [...candidates].sort((a, b) => {
    const va = skillAttr(a).version;
    const vb = skillAttr(b).version;
    return compareSkillVersions(vb, va);
  });
  return sorted[0]!;
}

export function matchSkill(rawQuery: string, skills: readonly Entity[]): SkillMatch {
  const query = rawQuery.trim().toLowerCase();
  if (query.length === 0) {
    return { kind: 'not_found', candidates: suggestCandidates('', skills) };
  }

  // Tier 1: exact name match (case-insensitive).
  const nameHits = skills.filter((s) => skillAttr(s).name.toLowerCase() === query);
  if (nameHits.length > 0) {
    return { kind: 'match', skill: pickHighestVersion(nameHits), tier: 'name' };
  }

  // Tier 2: trigger phrase match (case-insensitive, exact phrase).
  const triggerHits = skills.filter((s) =>
    skillAttr(s).triggers.some((t) => t.toLowerCase() === query)
  );
  if (triggerHits.length > 0) {
    return { kind: 'match', skill: pickHighestVersion(triggerHits), tier: 'trigger' };
  }

  // Tier 3 (BM25) runs in the tool layer, not here.
  // Tier 4: not_found. Return up to 3 candidate names as hints.
  return { kind: 'not_found', candidates: suggestCandidates(query, skills) };
}
