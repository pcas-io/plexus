/**
 * Share Token Repository — one-time read-only share links for entities.
 *
 * Per the Kickoff-ADR (buddy node 01KNF08JS7VKWPRYF1N8Q8ESMB Abschnitt 4)
 * and the Auth-ADR (01KNF1YX0DS7BEKAF2EF6F8TG1 Abschnitt 4):
 *
 * - Dashboard-only, NO MCP tools for share operations.
 * - Each share requires a fresh Step-Up Passkey tap before creation.
 * - At most one active token per entity: creating a new one revokes the
 *   previous active one inside the same transaction.
 * - Consumed tokens stay in the audit history forever.
 * - Default expiration: 60 minutes.
 * - kind='secret' entities are never shareable; kind with
 *   attributes.pii_masked=true need an explicit admin force flag (not
 *   implemented in v1 of this feature).
 *
 * A "currently active" token has IS_UNSET(consumed_at) AND
 * IS_UNSET(revoked_at) AND expires_at > now.
 */

import type { Surreal } from 'surrealdb';
import { normalizeThingId, rawIdPart } from '../util/record_id.js';
import { IS_UNSET } from '../util/query.js';

export interface ShareToken {
  readonly id: string;
  readonly entity: string;
  readonly created_by: string;
  readonly created_at: string;
  readonly expires_at: string;
  readonly consumed_at: string | null;
  readonly consumed_ip: string | null;
  readonly consumed_ua: string | null;
  readonly revoked_at: string | null;
  readonly revoked_by: string | null;
  readonly note: string | null;
  readonly passkey_device_id: string | null;
}

export interface NewShareToken {
  readonly entityId: string;
  readonly createdByUserId: string;
  /** TTL in seconds, default 3600 (60 min). */
  readonly ttlSeconds?: number;
  readonly note?: string;
  readonly passkeyDeviceId?: string;
}

function normalizeRow(raw: unknown): ShareToken {
  const r = raw as Record<string, unknown>;
  return {
    id: normalizeThingId(r.id),
    entity: normalizeThingId(r.entity),
    created_by: normalizeThingId(r.created_by),
    created_at: String(r.created_at),
    expires_at: String(r.expires_at),
    consumed_at: r.consumed_at == null ? null : String(r.consumed_at),
    consumed_ip: r.consumed_ip == null ? null : String(r.consumed_ip),
    consumed_ua: r.consumed_ua == null ? null : String(r.consumed_ua),
    revoked_at: r.revoked_at == null ? null : String(r.revoked_at),
    revoked_by: r.revoked_by == null ? null : normalizeThingId(r.revoked_by),
    note: r.note == null ? null : String(r.note),
    passkey_device_id: r.passkey_device_id == null ? null : String(r.passkey_device_id),
  };
}

const RETURN_COLS =
  'id, entity, created_by, created_at, expires_at, consumed_at, consumed_ip, consumed_ua, revoked_at, revoked_by, note, passkey_device_id';

export class ShareTokenRepository {
  constructor(private readonly db: Surreal) {}

  /**
   * Create a new share token. Revokes any currently-active token for the
   * same entity in the same call so "at most one active per entity" is
   * enforced even without a unique index.
   *
   * `tokenHash` is the sha256 hex of the raw token string — never store
   * the raw token itself.
   */
  async create(
    tokenHash: string,
    input: NewShareToken
  ): Promise<ShareToken> {
    const ttl = Math.max(60, Math.min(input.ttlSeconds ?? 3600, 24 * 60 * 60));
    const entityRaw = rawIdPart(input.entityId, 'entities');
    const userRaw = rawIdPart(input.createdByUserId, 'users');

    // Step 1: revoke the previous active token for this entity, if any.
    await this.db.query(
      `UPDATE share_tokens SET revoked_at = time::now(), revoked_by = type::thing('users', $uid_raw)
         WHERE entity = type::thing('entities', $ent_raw)
           AND ${IS_UNSET('consumed_at')}
           AND ${IS_UNSET('revoked_at')}
           AND expires_at > time::now();`,
      { ent_raw: entityRaw, uid_raw: userRaw }
    );

    // Step 2: create the new token row. Only include option<> fields
    // when we actually have a value — SurrealDB v2 rejects explicit
    // null on option<T> columns.
    const fields: string[] = [
      'token_hash: $token_hash',
      `entity: type::thing('entities', $ent_raw)`,
      `created_by: type::thing('users', $uid_raw)`,
      `expires_at: time::now() + ${ttl}s`,
    ];
    const params: Record<string, unknown> = {
      token_hash: tokenHash,
      ent_raw: entityRaw,
      uid_raw: userRaw,
    };
    if (input.note != null) {
      fields.push('note: $note');
      params.note = input.note;
    }
    if (input.passkeyDeviceId != null) {
      fields.push('passkey_device_id: $passkey_device_id');
      params.passkey_device_id = input.passkeyDeviceId;
    }
    const result = await this.db.query<[unknown[]]>(
      `CREATE share_tokens CONTENT { ${fields.join(', ')} } RETURN ${RETURN_COLS};`,
      params
    );
    const row = result[0]?.[0];
    if (!row) throw new Error('Failed to create share token');
    return normalizeRow(row);
  }

  /**
   * Look up a share token by its sha256 hash. Returns the row even if
   * consumed/revoked/expired — the consume handler decides what to do.
   */
  async findByHash(tokenHash: string): Promise<ShareToken | null> {
    const result = await this.db.query<[unknown[]]>(
      `SELECT ${RETURN_COLS} FROM share_tokens WHERE token_hash = $hash LIMIT 1;`,
      { hash: tokenHash }
    );
    const row = result[0]?.[0];
    return row ? normalizeRow(row) : null;
  }

  async get(id: string): Promise<ShareToken | null> {
    const result = await this.db.query<[unknown[]]>(
      `SELECT ${RETURN_COLS} FROM share_tokens WHERE id = type::thing('share_tokens', $raw) LIMIT 1;`,
      { raw: rawIdPart(id, 'share_tokens') }
    );
    const row = result[0]?.[0];
    return row ? normalizeRow(row) : null;
  }

  /**
   * Mark a share token as consumed. Returns null if the row is not in a
   * state that can be consumed (already consumed, revoked, or expired).
   */
  async consume(
    tokenHash: string,
    consumeInfo: { ip?: string; userAgent?: string }
  ): Promise<ShareToken | null> {
    const result = await this.db.query<[unknown[]]>(
      `UPDATE share_tokens SET consumed_at = time::now(), consumed_ip = $ip, consumed_ua = $ua
         WHERE token_hash = $hash
           AND ${IS_UNSET('consumed_at')}
           AND ${IS_UNSET('revoked_at')}
           AND expires_at > time::now()
         RETURN ${RETURN_COLS};`,
      {
        hash: tokenHash,
        ip: consumeInfo.ip ?? null,
        ua: consumeInfo.userAgent ?? null,
      }
    );
    const row = result[0]?.[0];
    return row ? normalizeRow(row) : null;
  }

  /**
   * Revoke an active share token by id. Returns null if the row was not
   * active (already consumed/revoked/expired).
   */
  async revoke(id: string, revokedByUserId: string): Promise<ShareToken | null> {
    const result = await this.db.query<[unknown[]]>(
      `UPDATE share_tokens SET revoked_at = time::now(), revoked_by = type::thing('users', $uid_raw)
         WHERE id = type::thing('share_tokens', $raw)
           AND ${IS_UNSET('consumed_at')}
           AND ${IS_UNSET('revoked_at')}
           AND expires_at > time::now()
         RETURN ${RETURN_COLS};`,
      { raw: rawIdPart(id, 'share_tokens'), uid_raw: rawIdPart(revokedByUserId, 'users') }
    );
    const row = result[0]?.[0];
    return row ? normalizeRow(row) : null;
  }

  /**
   * List tokens currently active. If `createdByUserId` is provided,
   * only that user's tokens are returned — admins pass undefined to
   * see all.
   */
  async listActive(limit = 100, createdByUserId?: string): Promise<ShareToken[]> {
    const cap = Math.min(Math.max(limit, 1), 500);
    const where = `${IS_UNSET('consumed_at')} AND ${IS_UNSET('revoked_at')} AND expires_at > time::now()`;
    if (createdByUserId) {
      const result = await this.db.query<[unknown[]]>(
        `SELECT ${RETURN_COLS} FROM share_tokens
           WHERE ${where} AND created_by = type::thing('users', $uid_raw)
           ORDER BY created_at DESC LIMIT ${cap};`,
        { uid_raw: rawIdPart(createdByUserId, 'users') }
      );
      return (result[0] ?? []).map(normalizeRow);
    }
    const result = await this.db.query<[unknown[]]>(
      `SELECT ${RETURN_COLS} FROM share_tokens WHERE ${where} ORDER BY created_at DESC LIMIT ${cap};`
    );
    return (result[0] ?? []).map(normalizeRow);
  }

  async listConsumed(limit = 100, createdByUserId?: string): Promise<ShareToken[]> {
    const cap = Math.min(Math.max(limit, 1), 500);
    if (createdByUserId) {
      const result = await this.db.query<[unknown[]]>(
        `SELECT ${RETURN_COLS} FROM share_tokens
           WHERE (consumed_at IS NOT NONE AND consumed_at IS NOT NULL) AND created_by = type::thing('users', $uid_raw)
           ORDER BY consumed_at DESC LIMIT ${cap};`,
        { uid_raw: rawIdPart(createdByUserId, 'users') }
      );
      return (result[0] ?? []).map(normalizeRow);
    }
    const result = await this.db.query<[unknown[]]>(
      `SELECT ${RETURN_COLS} FROM share_tokens
         WHERE (consumed_at IS NOT NONE AND consumed_at IS NOT NULL)
         ORDER BY consumed_at DESC LIMIT ${cap};`
    );
    return (result[0] ?? []).map(normalizeRow);
  }

  async listInactive(limit = 100, createdByUserId?: string): Promise<ShareToken[]> {
    const cap = Math.min(Math.max(limit, 1), 500);
    const where = `${IS_UNSET('consumed_at')} AND ((revoked_at IS NOT NONE AND revoked_at IS NOT NULL) OR expires_at <= time::now())`;
    if (createdByUserId) {
      const result = await this.db.query<[unknown[]]>(
        `SELECT ${RETURN_COLS} FROM share_tokens
           WHERE ${where} AND created_by = type::thing('users', $uid_raw)
           ORDER BY created_at DESC LIMIT ${cap};`,
        { uid_raw: rawIdPart(createdByUserId, 'users') }
      );
      return (result[0] ?? []).map(normalizeRow);
    }
    const result = await this.db.query<[unknown[]]>(
      `SELECT ${RETURN_COLS} FROM share_tokens WHERE ${where} ORDER BY created_at DESC LIMIT ${cap};`
    );
    return (result[0] ?? []).map(normalizeRow);
  }
}
