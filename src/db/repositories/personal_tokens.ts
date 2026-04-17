/**
 * Personal Token Repository — scoped pt_* tokens.
 *
 * Each user can have multiple personal tokens, each with its own
 * scope (permission level, context whitelist, kind whitelist) and
 * optional expiration. This replaces the single token_hash on the
 * users table for scope-aware auth.
 */

import type { Surreal } from 'surrealdb';
import { normalizeThingId, rawIdPart } from '../util/record_id.js';
import { IS_UNSET } from '../util/query.js';

export interface PersonalToken {
  readonly id: string;
  readonly user: string;
  readonly label: string | null;
  readonly scope_permission: string;
  readonly scope_contexts: string[] | null;
  readonly scope_kinds: string[] | null;
  readonly created_at: string;
  readonly expires_at: string | null;
  readonly revoked_at: string | null;
  readonly last_used_at: string | null;
}

export interface NewPersonalToken {
  readonly userId: string;
  readonly tokenHash: string;
  readonly label?: string;
  readonly scopePermission?: 'read' | 'write' | 'admin';
  readonly scopeContexts?: string[];
  readonly scopeKinds?: string[];
  readonly expiresInDays?: number;
}

function normalizeRow(raw: unknown): PersonalToken {
  const r = raw as Record<string, unknown>;
  return {
    id: normalizeThingId(r.id),
    user: normalizeThingId(r.user),
    label: r.label == null ? null : String(r.label),
    scope_permission: String(r.scope_permission ?? 'write'),
    scope_contexts: Array.isArray(r.scope_contexts) ? (r.scope_contexts as string[]) : null,
    scope_kinds: Array.isArray(r.scope_kinds) ? (r.scope_kinds as string[]) : null,
    created_at: String(r.created_at),
    expires_at: r.expires_at == null ? null : String(r.expires_at),
    revoked_at: r.revoked_at == null ? null : String(r.revoked_at),
    last_used_at: r.last_used_at == null ? null : String(r.last_used_at),
  };
}

const RETURN_COLS =
  'id, user, label, scope_permission, scope_contexts, scope_kinds, created_at, expires_at, revoked_at, last_used_at';

export class PersonalTokenRepository {
  constructor(private readonly db: Surreal) {}

  async create(input: NewPersonalToken): Promise<PersonalToken> {
    const userRaw = rawIdPart(input.userId, 'users');
    const fields: string[] = [
      `user: type::thing('users', $uid_raw)`,
      'token_hash: $token_hash',
      'scope_permission: $scope_permission',
    ];
    const params: Record<string, unknown> = {
      uid_raw: userRaw,
      token_hash: input.tokenHash,
      scope_permission: input.scopePermission ?? 'write',
    };
    if (input.label != null) {
      fields.push('label: $label');
      params.label = input.label;
    }
    if (input.scopeContexts != null && input.scopeContexts.length > 0) {
      fields.push('scope_contexts: $scope_contexts');
      params.scope_contexts = input.scopeContexts;
    }
    if (input.scopeKinds != null && input.scopeKinds.length > 0) {
      fields.push('scope_kinds: $scope_kinds');
      params.scope_kinds = input.scopeKinds;
    }
    if (input.expiresInDays != null && input.expiresInDays > 0) {
      const days = Math.min(input.expiresInDays, 365);
      fields.push(`expires_at: time::now() + ${days}d`);
    }
    const result = await this.db.query<[unknown[]]>(
      `CREATE personal_tokens CONTENT { ${fields.join(', ')} } RETURN ${RETURN_COLS};`,
      params
    );
    const row = result[0]?.[0];
    if (!row) throw new Error('Failed to create personal token');
    return normalizeRow(row);
  }

  /**
   * Find an active personal token by its hash. Returns null for
   * revoked, expired, or unknown tokens.
   */
  async findActiveByHash(tokenHash: string): Promise<PersonalToken | null> {
    // Defensive: IS_UNSET() matches both NONE and NULL — SurrealDB v2
    // stores unset option<T> fields as either depending on the write path.
    const result = await this.db.query<[unknown[]]>(
      `SELECT ${RETURN_COLS} FROM personal_tokens
         WHERE token_hash = $h
           AND ${IS_UNSET('revoked_at')}
           AND (${IS_UNSET('expires_at')} OR expires_at > time::now())
         LIMIT 1;`,
      { h: tokenHash }
    );
    const row = result[0]?.[0];
    return row ? normalizeRow(row) : null;
  }

  async touch(tokenHash: string): Promise<void> {
    await this.db.query(
      `UPDATE personal_tokens SET last_used_at = time::now() WHERE token_hash = $h;`,
      { h: tokenHash }
    );
  }

  /** List all tokens for a user (active + revoked + expired). */
  async listForUser(userId: string): Promise<PersonalToken[]> {
    const result = await this.db.query<[unknown[]]>(
      `SELECT ${RETURN_COLS} FROM personal_tokens
         WHERE user = type::thing('users', $raw)
         ORDER BY created_at DESC LIMIT 50;`,
      { raw: rawIdPart(userId, 'users') }
    );
    return (result[0] ?? []).map(normalizeRow);
  }

  async revoke(tokenId: string): Promise<void> {
    await this.db.query(
      `UPDATE personal_tokens SET revoked_at = time::now()
         WHERE id = type::thing('personal_tokens', $raw)
           AND ${IS_UNSET('revoked_at')};`,
      { raw: rawIdPart(tokenId, 'personal_tokens') }
    );
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.db.query(
      `UPDATE personal_tokens SET revoked_at = time::now()
         WHERE user = type::thing('users', $raw)
           AND ${IS_UNSET('revoked_at')};`,
      { raw: rawIdPart(userId, 'users') }
    );
  }
}
