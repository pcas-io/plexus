/**
 * Attribute-schema validation for save_entity.
 *
 * Each entity kind carries an `attributes_schema` (populated by
 * migration 0008). This validator enforces the `required` list and type /
 * enum constraints declared in the schema.
 *
 * Rules:
 *   - `required` fields: must be present + pass type/enum check, or the
 *     write is rejected with `attribute_validation_failed`.
 *   - `recommended` fields: never reject; the list is surfaced via
 *     list_kinds so LLM clients can see what we *want* populated.
 *   - Unknown attributes: allowed. The schema is a discoverability tool,
 *     not a lockdown. Callers may add project-specific attrs as needed.
 *
 * Kept as a pure function (no db dependency) so it can be unit-tested
 * without SurrealDB and so save_entity can feed it a kindDef it already
 * fetched from the registry.
 *
 * Conditional handoff validation lives separately in handoff_validation.ts —
 * that check runs in addition to this one for kind=fact + session_type=handoff.
 */

import type { AttributesSchema, AttributeProperty } from '../../mcp/registries.js';

export class AttributeValidationError extends Error {
  readonly code = 'attribute_validation_failed';
  constructor(readonly field: string, message: string) {
    super(`attribute_validation_failed: ${message}`);
    this.name = 'AttributeValidationError';
  }
}

function propertyTypeMatches(prop: AttributeProperty, value: unknown): boolean {
  if (!prop.type) return true;
  switch (prop.type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    default:
      return true;
  }
}

export function validateAttributes(
  kind: string,
  attributes: Record<string, unknown> | undefined,
  schema: AttributesSchema | undefined
): void {
  if (!schema) return;
  const attrs = attributes ?? {};

  for (const field of schema.required ?? []) {
    const value = attrs[field];
    if (value === undefined || value === null) {
      throw new AttributeValidationError(
        field,
        `kind=${kind} requires attribute "${field}"`
      );
    }
    if (typeof value === 'string' && value.trim().length === 0) {
      throw new AttributeValidationError(
        field,
        `attribute "${field}" must not be an empty string`
      );
    }
  }

  for (const [field, value] of Object.entries(attrs)) {
    const prop = schema.properties?.[field];
    if (!prop) continue;
    if (value === undefined || value === null) continue;
    if (!propertyTypeMatches(prop, value)) {
      throw new AttributeValidationError(
        field,
        `attribute "${field}" must be ${prop.type}, got ${typeof value}`
      );
    }
    if (prop.enum && prop.enum.length > 0) {
      if (typeof value !== 'string' || !prop.enum.includes(value)) {
        throw new AttributeValidationError(
          field,
          `attribute "${field}" must be one of [${prop.enum.join(', ')}], got ${JSON.stringify(value)}`
        );
      }
    }
  }
}
