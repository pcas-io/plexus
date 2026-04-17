/**
 * Kind + Relation registry helpers.
 *
 * Simple read helpers for the entity_kinds and relations tables. Writes
 * are not yet exposed via MCP (admin-only via dashboard in a later step)
 * but the read side is useful for tool-discovery and validation.
 */

import type { Surreal } from 'surrealdb';

export interface KindDef {
  readonly name: string;
  readonly description: string | null;
  readonly module: string;
  readonly attributes_schema: Record<string, unknown>;
}

export interface RelationDef {
  readonly name: string;
  readonly description: string | null;
  readonly allowed_from_kinds: readonly string[] | null;
  readonly allowed_to_kinds: readonly string[] | null;
  readonly cardinality: string;
  readonly inverse: string | null;
  readonly is_temporal: boolean;
  readonly module: string;
}

function normKind(raw: unknown): KindDef {
  const r = raw as Record<string, unknown>;
  return {
    name: String(r.name),
    description: r.description == null ? null : String(r.description),
    module: String(r.module ?? 'core'),
    attributes_schema: (r.attributes_schema as Record<string, unknown>) ?? {},
  };
}

function normRelation(raw: unknown): RelationDef {
  const r = raw as Record<string, unknown>;
  return {
    name: String(r.name),
    description: r.description == null ? null : String(r.description),
    allowed_from_kinds: (r.allowed_from_kinds as string[] | null) ?? null,
    allowed_to_kinds: (r.allowed_to_kinds as string[] | null) ?? null,
    cardinality: String(r.cardinality ?? 'n:m'),
    inverse: r.inverse == null ? null : String(r.inverse),
    is_temporal: Boolean(r.is_temporal ?? true),
    module: String(r.module ?? 'core'),
  };
}

export class KindRegistry {
  constructor(private readonly db: Surreal) {}

  async list(): Promise<KindDef[]> {
    const result = await this.db.query<[unknown[]]>(
      'SELECT name, description, module, attributes_schema FROM entity_kinds ORDER BY name ASC;'
    );
    return (result[0] ?? []).map(normKind);
  }

  async findByName(name: string): Promise<KindDef | null> {
    const result = await this.db.query<[unknown[]]>(
      'SELECT name, description, module, attributes_schema FROM entity_kinds WHERE name = $name LIMIT 1;',
      { name }
    );
    const row = result[0]?.[0];
    return row ? normKind(row) : null;
  }
}

export class RelationRegistry {
  constructor(private readonly db: Surreal) {}

  async list(): Promise<RelationDef[]> {
    const result = await this.db.query<[unknown[]]>(
      'SELECT name, description, allowed_from_kinds, allowed_to_kinds, cardinality, inverse, is_temporal, module FROM relations ORDER BY name ASC;'
    );
    return (result[0] ?? []).map(normRelation);
  }

  async findByName(name: string): Promise<RelationDef | null> {
    const result = await this.db.query<[unknown[]]>(
      'SELECT name, description, allowed_from_kinds, allowed_to_kinds, cardinality, inverse, is_temporal, module FROM relations WHERE name = $name LIMIT 1;',
      { name }
    );
    const row = result[0]?.[0];
    return row ? normRelation(row) : null;
  }
}
