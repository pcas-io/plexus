/**
 * Required-edge-group validation.
 *
 * Spec: kinds can declare `required_edge_groups` — on save_entity the
 * caller must supply at least `min` edges whose relation+direction
 * matches a group. Decisions require ≥1 of
 * [derived_from, triggered_by, supersedes, part_of] out-edges (CLAUDE.md
 * ADR-Pflicht-Edge).
 */

import { describe, expect, test } from 'vitest';
import {
  RequiredEdgeValidationError,
  validateRequiredEdges,
} from '../required_edge_validation.js';
import type { RequiredEdgeGroup } from '../../../mcp/registries.js';

const DECISION_GROUPS: RequiredEdgeGroup[] = [
  {
    name: 'decision_context',
    relations: ['derived_from', 'triggered_by', 'supersedes', 'part_of'],
    direction: 'out',
    min: 1,
  },
];

describe('validateRequiredEdges', () => {
  test('passes when groups list is empty', () => {
    expect(() => validateRequiredEdges('fact', [], [])).not.toThrow();
  });

  test('passes when min satisfied by part_of', () => {
    expect(() =>
      validateRequiredEdges('decision', DECISION_GROUPS, [
        { relation: 'part_of', direction: 'out' },
      ])
    ).not.toThrow();
  });

  test('passes when min satisfied by derived_from', () => {
    expect(() =>
      validateRequiredEdges('decision', DECISION_GROUPS, [
        { relation: 'derived_from', direction: 'out' },
      ])
    ).not.toThrow();
  });

  test('rejects when no edges provided', () => {
    expect(() =>
      validateRequiredEdges('decision', DECISION_GROUPS, [])
    ).toThrow(RequiredEdgeValidationError);
  });

  test('rejects when only unrelated edges provided', () => {
    expect(() =>
      validateRequiredEdges('decision', DECISION_GROUPS, [
        { relation: 'mentions', direction: 'out' },
      ])
    ).toThrow(/requires at least 1 out-edge/);
  });

  test('rejects when direction mismatches', () => {
    expect(() =>
      validateRequiredEdges('decision', DECISION_GROUPS, [
        { relation: 'part_of', direction: 'in' },
      ])
    ).toThrow(RequiredEdgeValidationError);
  });

  test('error exposes the offending group name + code', () => {
    try {
      validateRequiredEdges('decision', DECISION_GROUPS, []);
    } catch (err) {
      expect(err).toBeInstanceOf(RequiredEdgeValidationError);
      const e = err as RequiredEdgeValidationError;
      expect(e.group).toBe('decision_context');
      expect(e.code).toBe('required_edge_missing');
    }
  });

  test('respects min > 1', () => {
    const groups: RequiredEdgeGroup[] = [
      { name: 'double_link', relations: ['documents'], direction: 'out', min: 2 },
    ];
    expect(() =>
      validateRequiredEdges('document', groups, [
        { relation: 'documents', direction: 'out' },
      ])
    ).toThrow(/at least 2 out-edge/);
    expect(() =>
      validateRequiredEdges('document', groups, [
        { relation: 'documents', direction: 'out' },
        { relation: 'documents', direction: 'out' },
      ])
    ).not.toThrow();
  });
});
