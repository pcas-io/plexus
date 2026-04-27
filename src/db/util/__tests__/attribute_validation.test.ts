/**
 * Attribute-schema validation (migration 0008 surfaces the schemas;
 * save_entity enforces them through this validator).
 *
 * Spec: every entity kind carries an `attributes_schema`. On save_entity,
 * required fields must be present and non-empty; enum/type constraints
 * on declared properties are enforced. Unknown attributes are allowed
 * — the schema is discoverability, not lockdown.
 */

import { describe, expect, test } from 'vitest';
import {
  AttributeValidationError,
  validateAttributes,
} from '../attribute_validation.js';
import type { AttributesSchema } from '../../../mcp/registries.js';

const DECISION_SCHEMA: AttributesSchema = {
  required: ['status'],
  recommended: ['adr_date'],
  properties: {
    status: { type: 'string', enum: ['proposed', 'accepted', 'rejected', 'superseded'] },
    adr_date: { type: 'string' },
    severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
    stakeholders: { type: 'array' },
  },
};

describe('validateAttributes', () => {
  test('passes when schema is undefined', () => {
    expect(() => validateAttributes('fact', { foo: 'bar' }, undefined)).not.toThrow();
  });

  test('passes when no required fields', () => {
    expect(() =>
      validateAttributes('task', {}, { required: [], properties: {} })
    ).not.toThrow();
  });

  test('rejects when required field is missing', () => {
    expect(() => validateAttributes('decision', {}, DECISION_SCHEMA)).toThrow(
      AttributeValidationError
    );
  });

  test('rejects when required field is empty string', () => {
    expect(() =>
      validateAttributes('decision', { status: '   ' }, DECISION_SCHEMA)
    ).toThrow(/must not be an empty string/);
  });

  test('rejects when required field is null', () => {
    expect(() =>
      validateAttributes('decision', { status: null }, DECISION_SCHEMA)
    ).toThrow(/requires attribute "status"/);
  });

  test('accepts valid required field', () => {
    expect(() =>
      validateAttributes('decision', { status: 'accepted' }, DECISION_SCHEMA)
    ).not.toThrow();
  });

  test('rejects enum mismatch on declared property', () => {
    expect(() =>
      validateAttributes(
        'decision',
        { status: 'accepted', severity: 'catastrophic' },
        DECISION_SCHEMA
      )
    ).toThrow(/must be one of \[low, medium, high, critical\]/);
  });

  test('rejects type mismatch on declared property', () => {
    expect(() =>
      validateAttributes(
        'decision',
        { status: 'accepted', stakeholders: 'alice' },
        DECISION_SCHEMA
      )
    ).toThrow(/must be array, got string/);
  });

  test('allows unknown attributes', () => {
    expect(() =>
      validateAttributes(
        'decision',
        { status: 'accepted', project_specific_flag: 42 },
        DECISION_SCHEMA
      )
    ).not.toThrow();
  });

  test('ignores null values on optional declared properties', () => {
    expect(() =>
      validateAttributes(
        'decision',
        { status: 'accepted', severity: null },
        DECISION_SCHEMA
      )
    ).not.toThrow();
  });

  test('error includes the violating field name', () => {
    try {
      validateAttributes('decision', {}, DECISION_SCHEMA);
    } catch (err) {
      expect(err).toBeInstanceOf(AttributeValidationError);
      expect((err as AttributeValidationError).field).toBe('status');
      expect((err as AttributeValidationError).code).toBe('attribute_validation_failed');
    }
  });
});
