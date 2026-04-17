import { describe, test, expect } from 'vitest';
import type { Entity } from '../../db/repositories/entities.js';
import { matchSkill, type SkillMatch } from '../skill_match.js';

function skill(name: string, extras: Partial<Entity> & { triggers?: string[]; version?: string } = {}): Entity {
  const { triggers, version, ...rest } = extras;
  return {
    id: `entities:skill-${name}`,
    kind: 'skill',
    title: name,
    body: `# ${name}\n\nBody for ${name}.`,
    attributes: {
      name,
      description: `${name} description`,
      version: version ?? 'v1.0.0',
      trigger_phrases: triggers ?? [],
    },
    context: 'dev',
    status: 'active',
    version: 1,
    created_at: '2026-04-11T00:00:00.000Z',
    updated_at: '2026-04-11T00:00:00.000Z',
    created_by: null,
    updated_by: null,
    ...rest,
  };
}

describe('matchSkill — tier 1 exact name', () => {
  test('returns the skill when query is the exact name', () => {
    const skills = [skill('pre-mortem'), skill('5-whys')];
    const result = matchSkill('pre-mortem', skills);
    expect(result.kind).toBe('match');
    if (result.kind === 'match') {
      expect(result.skill.attributes.name).toBe('pre-mortem');
      expect(result.tier).toBe('name');
    }
  });

  test('normalises query case before matching names', () => {
    const skills = [skill('pre-mortem')];
    const result = matchSkill('Pre-Mortem', skills);
    expect(result.kind).toBe('match');
    if (result.kind === 'match') expect(result.tier).toBe('name');
  });

  test('trims whitespace from the query', () => {
    const skills = [skill('pre-mortem')];
    const result = matchSkill('  pre-mortem  ', skills);
    expect(result.kind).toBe('match');
  });
});

describe('matchSkill — tier 2 trigger phrases', () => {
  test('matches a trigger phrase when the name does not match', () => {
    const skills = [
      skill('5-whys', { triggers: ['5 Whys', 'Root Cause'] }),
      skill('pre-mortem', { triggers: ['Pre-Mortem'] }),
    ];
    const result = matchSkill('Root Cause', skills);
    expect(result.kind).toBe('match');
    if (result.kind === 'match') {
      expect(result.skill.attributes.name).toBe('5-whys');
      expect(result.tier).toBe('trigger');
    }
  });

  test('trigger match is case-insensitive', () => {
    const skills = [skill('5-whys', { triggers: ['Root Cause'] })];
    const result = matchSkill('root cause', skills);
    expect(result.kind).toBe('match');
    if (result.kind === 'match') expect(result.tier).toBe('trigger');
  });

  test('name tier wins over trigger tier when both would match', () => {
    const skills = [
      skill('weekly-review', { triggers: ['Review'] }),
      skill('review', { triggers: [] }),
    ];
    const result = matchSkill('review', skills);
    expect(result.kind).toBe('match');
    if (result.kind === 'match') {
      expect(result.skill.attributes.name).toBe('review');
      expect(result.tier).toBe('name');
    }
  });
});

describe('matchSkill — version preference', () => {
  test('when two active skills share a name, picks the highest version', () => {
    const skills = [
      skill('pre-mortem', { version: 'v1.0.0' }),
      skill('pre-mortem', { version: 'v2.0.0', id: 'entities:skill-pre-mortem-v2' }),
    ];
    const result = matchSkill('pre-mortem', skills);
    expect(result.kind).toBe('match');
    if (result.kind === 'match') {
      expect(result.skill.id).toBe('entities:skill-pre-mortem-v2');
    }
  });
});

describe('matchSkill — empty / not found', () => {
  test('empty query returns not_found', () => {
    const skills = [skill('pre-mortem')];
    const result = matchSkill('', skills);
    expect(result.kind).toBe('not_found');
  });

  test('unknown query with no skills returns not_found', () => {
    const result = matchSkill('xyz', []);
    expect(result.kind).toBe('not_found');
  });

  test('unknown query with skills returns not_found and lists candidates by name', () => {
    const skills = [
      skill('pre-mortem'),
      skill('post-mortem'),
      skill('weekly-review'),
      skill('runbook'),
    ];
    const result = matchSkill('bananarama', skills);
    expect(result.kind).toBe('not_found');
    if (result.kind === 'not_found') {
      expect(result.candidates.length).toBeGreaterThan(0);
      expect(result.candidates.length).toBeLessThanOrEqual(3);
    }
  });

  test('not_found candidates prefer substring matches over list order', () => {
    const skills = [
      skill('pre-mortem'),
      skill('post-mortem'),
      skill('weekly-review'),
      skill('runbook'),
    ];
    // 'mortem' is a substring of pre-mortem and post-mortem but matches
    // neither as a full name or trigger — falls through to not_found, but
    // the hints should include both 'mortem' skills.
    const result = matchSkill('mortem', skills);
    expect(result.kind).toBe('not_found');
    if (result.kind === 'not_found') {
      expect(result.candidates).toContain('pre-mortem');
      expect(result.candidates).toContain('post-mortem');
    }
  });
});
