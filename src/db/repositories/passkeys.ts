/**
 * Passkey Repository — WebAuthn credential storage.
 *
 * Stores public keys and credential IDs in base64url form (so SurrealQL
 * can handle them as plain strings). The counter field is used by
 * WebAuthn to detect cloned authenticators.
 */

import type { Surreal } from 'surrealdb';
import { normalizeThingId, rawIdPart } from '../util/record_id.js';

export interface Passkey {
  readonly id: string;
  readonly user: string;
  readonly credential_id: string;
  readonly public_key: string;
  readonly counter: number;
  readonly transports: string[] | null;
  readonly device_name: string | null;
  readonly created_at: string;
  readonly last_used_at: string | null;
}

export interface NewPasskey {
  readonly userId: string;
  readonly credentialId: string;
  readonly publicKey: string;
  readonly counter: number;
  readonly transports?: string[];
  readonly deviceName?: string;
}

function normalizePasskey(raw: unknown): Passkey {
  const r = raw as Record<string, unknown>;
  return {
    id: normalizeThingId(r.id),
    user: normalizeThingId(r.user),
    credential_id: String(r.credential_id),
    public_key: String(r.public_key),
    counter: Number(r.counter),
    transports: Array.isArray(r.transports) ? (r.transports as string[]) : null,
    device_name: r.device_name == null ? null : String(r.device_name),
    created_at: String(r.created_at),
    last_used_at: r.last_used_at == null ? null : String(r.last_used_at),
  };
}

export class PasskeyRepository {
  constructor(private readonly db: Surreal) {}

  async findByCredentialId(credentialId: string): Promise<Passkey | null> {
    const result = await this.db.query<[unknown[]]>(
      'SELECT * FROM user_passkeys WHERE credential_id = $cid LIMIT 1;',
      { cid: credentialId }
    );
    const row = result[0]?.[0];
    return row ? normalizePasskey(row) : null;
  }

  async listForUser(userId: string): Promise<Passkey[]> {
    const result = await this.db.query<[unknown[]]>(
      'SELECT * FROM user_passkeys WHERE user = type::thing("users", $raw) ORDER BY created_at ASC;',
      { raw: rawIdPart(userId, 'users') }
    );
    return (result[0] ?? []).map(normalizePasskey);
  }

  async countForUser(userId: string): Promise<number> {
    const list = await this.listForUser(userId);
    return list.length;
  }

  async create(input: NewPasskey): Promise<void> {
    await this.db.query(
      `CREATE user_passkeys CONTENT {
         user: type::thing('users', $uid_raw),
         credential_id: $cid,
         public_key: $pk,
         counter: $counter,
         transports: $transports,
         device_name: $device_name
       };`,
      {
        uid_raw: rawIdPart(input.userId, 'users'),
        cid: input.credentialId,
        pk: input.publicKey,
        counter: input.counter,
        transports: input.transports ?? null,
        device_name: input.deviceName ?? null,
      }
    );
  }

  async deleteByCredentialId(credentialId: string): Promise<boolean> {
    const result = await this.db.query<[unknown[]]>(
      'DELETE user_passkeys WHERE credential_id = $cid RETURN BEFORE;',
      { cid: credentialId }
    );
    return (result[0] ?? []).length > 0;
  }

  async updateCounter(credentialId: string, counter: number): Promise<void> {
    await this.db.query(
      'UPDATE user_passkeys SET counter = $counter, last_used_at = time::now() WHERE credential_id = $cid;',
      { cid: credentialId, counter }
    );
  }
}
