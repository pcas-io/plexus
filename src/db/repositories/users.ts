/**
 * User Repository — CRUD for users with token lifecycle.
 *
 * Tokens are generated here and returned once in plaintext on creation
 * (and on reset). Only hashes are persisted. Never logs tokens.
 */

import type { Surreal } from 'surrealdb';
import { generatePersonalToken, hashToken } from '../../auth/tokens.js';
import { normalizeThingId, rawIdPart } from '../util/record_id.js';
import { IS_UNSET } from '../util/query.js';

export interface User {
  readonly id: string;
  readonly name: string;
  readonly is_active: boolean;
  readonly is_admin: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface UserCreationResult {
  readonly user: User;
  /** Plaintext token — shown once, never retrievable again. */
  readonly token: string;
}

function normalizeUser(raw: unknown): User {
  const r = raw as Record<string, unknown>;
  return {
    id: normalizeThingId(r.id),
    name: String(r.name),
    is_active: Boolean(r.is_active),
    is_admin: Boolean(r.is_admin),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

export class UserRepository {
  constructor(private readonly db: Surreal) {}

  async list(): Promise<User[]> {
    const result = await this.db.query<[unknown[]]>(
      'SELECT id, name, is_active, is_admin, created_at, updated_at FROM users ORDER BY created_at DESC;'
    );
    return (result[0] ?? []).map(normalizeUser);
  }

  async findByName(name: string): Promise<User | null> {
    const result = await this.db.query<[unknown[]]>(
      'SELECT id, name, is_active, is_admin, created_at, updated_at FROM users WHERE name = $name LIMIT 1;',
      { name }
    );
    const row = result[0]?.[0];
    return row ? normalizeUser(row) : null;
  }

  async findActiveByTokenHash(tokenHash: string): Promise<User | null> {
    const result = await this.db.query<[unknown[]]>(
      'SELECT id, name, is_active, is_admin, created_at, updated_at FROM users WHERE token_hash = $hash AND is_active = true LIMIT 1;',
      { hash: tokenHash }
    );
    const row = result[0]?.[0];
    return row ? normalizeUser(row) : null;
  }

  async findById(id: string): Promise<User | null> {
    // Accepts any of: "users:abc", "users:⟨abc⟩", a RecordId-Thing object,
    // or the bare raw id part "abc". rawIdPart normalizes all of these to
    // the plain identifier before we feed it to type::thing().
    const result = await this.db.query<[unknown[]]>(
      'SELECT id, name, is_active, is_admin, created_at, updated_at FROM users WHERE id = type::thing("users", $raw) LIMIT 1;',
      { raw: rawIdPart(id, 'users') }
    );
    const row = result[0]?.[0];
    return row ? normalizeUser(row) : null;
  }

  async create(
    name: string,
    isAdmin = false,
    tokenScope?: {
      permission?: 'read' | 'write' | 'admin';
      contexts?: string[];
      kinds?: string[];
      label?: string;
      expiresInDays?: number;
    }
  ): Promise<UserCreationResult> {
    const token = generatePersonalToken();
    const tokenHash = hashToken(token);
    const result = await this.db.query<[unknown[]]>(
      `CREATE users CONTENT {
         name: $name,
         token_hash: $hash,
         is_active: true,
         is_admin: $is_admin
       } RETURN id, name, is_active, is_admin, created_at, updated_at;`,
      { name, hash: tokenHash, is_admin: isAdmin }
    );
    const row = result[0]?.[0];
    if (!row) throw new Error('Failed to create user');
    const user = normalizeUser(row);
    // Also create a personal_tokens entry so the MCP auth can resolve
    // scoped tokens. Scope defaults to full access matching admin status.
    // rawIdPart normalizes any bracketed thing-id form so the reference
    // actually points at the user row we just created.
    const rawId = rawIdPart(user.id, 'users');
    const ptFields: string[] = [
      `user: type::thing('users', $uid_raw)`,
      'token_hash: $hash',
      'scope_permission: $perm',
    ];
    const ptParams: Record<string, unknown> = {
      uid_raw: rawId,
      hash: tokenHash,
      perm: tokenScope?.permission ?? (isAdmin ? 'admin' : 'write'),
    };
    const label = tokenScope?.label ?? 'default';
    ptFields.push('label: $label');
    ptParams.label = label;
    if (tokenScope?.contexts && tokenScope.contexts.length > 0) {
      ptFields.push('scope_contexts: $scope_contexts');
      ptParams.scope_contexts = tokenScope.contexts;
    }
    if (tokenScope?.kinds && tokenScope.kinds.length > 0) {
      ptFields.push('scope_kinds: $scope_kinds');
      ptParams.scope_kinds = tokenScope.kinds;
    }
    if (tokenScope?.expiresInDays && tokenScope.expiresInDays > 0) {
      const days = Math.min(tokenScope.expiresInDays, 365);
      ptFields.push(`expires_at: time::now() + ${days}d`);
    }
    await this.db.query(
      `CREATE personal_tokens CONTENT { ${ptFields.join(', ')} };`,
      ptParams
    );
    return { user, token };
  }

  async deactivate(name: string): Promise<User | null> {
    const result = await this.db.query<[unknown[]]>(
      'UPDATE users SET is_active = false WHERE name = $name RETURN id, name, is_active, is_admin, created_at, updated_at;',
      { name }
    );
    const row = result[0]?.[0];
    return row ? normalizeUser(row) : null;
  }

  async resetToken(name: string): Promise<UserCreationResult | null> {
    const token = generatePersonalToken();
    const tokenHash = hashToken(token);
    const result = await this.db.query<[unknown[]]>(
      'UPDATE users SET token_hash = $hash WHERE name = $name RETURN id, name, is_active, is_admin, created_at, updated_at;',
      { name, hash: tokenHash }
    );
    const row = result[0]?.[0];
    if (!row) return null;
    const user = normalizeUser(row);
    // Revoke all old personal_tokens for this user, then create a fresh
    // one with default scope matching the user's admin status.
    const rawId = rawIdPart(user.id, 'users');
    await this.db.query(
      `UPDATE personal_tokens SET revoked_at = time::now()
         WHERE user = type::thing('users', $uid_raw)
           AND ${IS_UNSET('revoked_at')};`,
      { uid_raw: rawId }
    );
    await this.db.query(
      `CREATE personal_tokens CONTENT {
         user: type::thing('users', $uid_raw),
         token_hash: $hash,
         scope_permission: $perm,
         label: 'default'
       };`,
      { uid_raw: rawId, hash: tokenHash, perm: user.is_admin ? 'admin' : 'write' }
    );
    return { user, token };
  }
}
