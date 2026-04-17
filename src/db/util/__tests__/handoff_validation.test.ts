/**
 * Tests for the handoff-fact validation helper.
 *
 * Spec: when `attributes.session_type === 'handoff'` on a `kind=fact`
 * entity, save_entity must enforce (a) the core metadata attributes —
 * session_date, session_id, agent_id — and (b) a `part_of` edge to an
 * active project entity. Without either, save_entity rejects with a
 * structured `handoff_validation_failed` error.
 *
 * Grandfathering: pre-existing handoff-facts without these attributes
 * remain readable; the rule only applies to new writes.
 *
 * Related: ADR entities:8ui2s496aa64pla3x5zb (Memory-Routing ADR) §6,
 * Task entities:k33z6xev2jb8spdn5ju9, blocks milestone Skill-Forge-F6.
 */

import { describe, test, expect } from 'vitest';
import {
  isHandoffFact,
  validateHandoffCreation,
  HandoffValidationError,
} from '../handoff_validation.js';

const VALID_ATTRS = {
  session_type: 'handoff',
  session_date: '2026-04-16',
  session_id: 'plexus-self-assessment-2026-04-16',
  agent_id: 'claude-opus-4-7',
};

const PROJECT_ENTITY = {
  id: 'entities:fbq6bjxsrn3sk41psf2e',
  kind: 'project',
  status: 'active',
};

describe('isHandoffFact', () => {
  test('true for fact with session_type=handoff', () => {
    expect(isHandoffFact('fact', { session_type: 'handoff' })).toBe(true);
  });

  test('false for fact without session_type', () => {
    expect(isHandoffFact('fact', { severity: 'info' })).toBe(false);
  });

  test('false for non-fact kind even with session_type=handoff', () => {
    expect(isHandoffFact('decision', { session_type: 'handoff' })).toBe(false);
  });

  test('false when attrs are undefined', () => {
    expect(isHandoffFact('fact', undefined)).toBe(false);
  });
});

describe('validateHandoffCreation — happy path', () => {
  test('(a) valid attributes plus active project part_of passes', () => {
    expect(() =>
      validateHandoffCreation({ attributes: VALID_ATTRS, partOfEntity: PROJECT_ENTITY })
    ).not.toThrow();
  });

  test('git_branch is optional — handoff passes without it', () => {
    const attrsWithoutBranch = { ...VALID_ATTRS };
    expect(() =>
      validateHandoffCreation({ attributes: attrsWithoutBranch, partOfEntity: PROJECT_ENTITY })
    ).not.toThrow();
  });

  test('non-handoff fact with session_type unset skips all checks', () => {
    expect(() =>
      validateHandoffCreation({
        attributes: { severity: 'info' },
        partOfEntity: null,
        kind: 'fact',
      })
    ).not.toThrow();
  });
});

describe('validateHandoffCreation — attribute violations', () => {
  test('(b) missing session_id throws HandoffValidationError', () => {
    const attrs = { ...VALID_ATTRS };
    delete (attrs as Record<string, unknown>).session_id;
    let caught: HandoffValidationError | undefined;
    try {
      validateHandoffCreation({ attributes: attrs, partOfEntity: PROJECT_ENTITY });
    } catch (err) {
      caught = err as HandoffValidationError;
    }
    expect(caught).toBeInstanceOf(HandoffValidationError);
    expect(caught?.field).toBe('session_id');
  });

  test('empty session_id (whitespace only) throws', () => {
    const attrs = { ...VALID_ATTRS, session_id: '   ' };
    expect(() =>
      validateHandoffCreation({ attributes: attrs, partOfEntity: PROJECT_ENTITY })
    ).toThrowError(/session_id/);
  });

  test('missing session_date throws', () => {
    const attrs = { ...VALID_ATTRS };
    delete (attrs as Record<string, unknown>).session_date;
    expect(() =>
      validateHandoffCreation({ attributes: attrs, partOfEntity: PROJECT_ENTITY })
    ).toThrowError(/session_date/);
  });

  test('missing agent_id throws', () => {
    const attrs = { ...VALID_ATTRS };
    delete (attrs as Record<string, unknown>).agent_id;
    expect(() =>
      validateHandoffCreation({ attributes: attrs, partOfEntity: PROJECT_ENTITY })
    ).toThrowError(/agent_id/);
  });

  test('non-ISO session_date throws', () => {
    const attrs = { ...VALID_ATTRS, session_date: 'yesterday' };
    expect(() =>
      validateHandoffCreation({ attributes: attrs, partOfEntity: PROJECT_ENTITY })
    ).toThrowError(/session_date/);
  });

  test('calendar-impossible session_date (month 99) throws', () => {
    const attrs = { ...VALID_ATTRS, session_date: '2026-99-99' };
    expect(() =>
      validateHandoffCreation({ attributes: attrs, partOfEntity: PROJECT_ENTITY })
    ).toThrowError(/session_date/);
  });

  test('calendar-impossible session_date (Feb 30) throws', () => {
    const attrs = { ...VALID_ATTRS, session_date: '2026-02-30' };
    expect(() =>
      validateHandoffCreation({ attributes: attrs, partOfEntity: PROJECT_ENTITY })
    ).toThrowError(/session_date/);
  });

  test('non-string git_branch throws', () => {
    const attrs = { ...VALID_ATTRS, git_branch: 42 };
    expect(() =>
      validateHandoffCreation({ attributes: attrs, partOfEntity: PROJECT_ENTITY })
    ).toThrowError(/git_branch/);
  });
});

describe('validateHandoffCreation — part_of edge violations', () => {
  test('(c) missing part_of entity throws HandoffValidationError', () => {
    let caught: HandoffValidationError | undefined;
    try {
      validateHandoffCreation({ attributes: VALID_ATTRS, partOfEntity: null });
    } catch (err) {
      caught = err as HandoffValidationError;
    }
    expect(caught).toBeInstanceOf(HandoffValidationError);
    expect(caught?.field).toBe('part_of');
  });

  test('part_of pointing to a non-project kind throws', () => {
    expect(() =>
      validateHandoffCreation({
        attributes: VALID_ATTRS,
        partOfEntity: { id: 'entities:xyz', kind: 'fact', status: 'active' },
      })
    ).toThrowError(/part_of/);
  });

  test('part_of pointing to an archived project throws', () => {
    expect(() =>
      validateHandoffCreation({
        attributes: VALID_ATTRS,
        partOfEntity: { id: 'entities:old', kind: 'project', status: 'archived' },
      })
    ).toThrowError(/part_of/);
  });
});
