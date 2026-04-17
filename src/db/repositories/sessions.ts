/**
 * Session Repository — Dashboard session lifecycle.
 *
 * Sessions are identified by a random session token (st_*) whose SHA-256
 * hash is stored. The plaintext token lives only in the browser cookie.
 */

import type { Surreal } from 'surrealdb';
import { generateSessionToken, hashToken } from '../../auth/tokens.js';
import { rawIdPart } from '../util/record_id.js';
import { IS_UNSET } from '../util/query.js';

export interface Session {
  readonly id: string;
  readonly user: string;
  readonly ip: string | null;
  readonly user_agent: string | null;
  readonly created_at: string;
  readonly expires_at: string;
  readonly last_active_at: string;
  readonly revoked_at: string | null;
}

export interface CreatedSession {
  readonly session: Session;
  readonly token: string;
}

const SESSION_TTL_HOURS = 8;

function normalizeSession(raw: unknown): Session {
  const r = raw as Record<string, unknown>;
  return {
    id: String(r.id),
    user: String(r.user),
    ip: r.ip == null ? null : String(r.ip),
    user_agent: r.user_agent == null ? null : String(r.user_agent),
    created_at: String(r.created_at),
    expires_at: String(r.expires_at),
    last_active_at: String(r.last_active_at),
    revoked_at: r.revoked_at == null ? null : String(r.revoked_at),
  };
}

export class SessionRepository {
  constructor(private readonly db: Surreal) {}

  async create(
    userId: string,
    meta: { ip?: string; userAgent?: string }
  ): Promise<CreatedSession> {
    const token = generateSessionToken();
    const tokenHash = hashToken(token);
    // SurrealDB v2 rejects an explicit NULL on an `option<T>` field in
    // a CREATE ... CONTENT {...} payload — it only accepts the field
    // being absent or set to a concrete value. Build the CONTENT object
    // dynamically so we don't set ip/user_agent when they are missing
    // (common on local-loopback deployments with no reverse proxy).
    const fields: string[] = [
      `user: type::thing('users', $uid_raw)`,
      `session_token_hash: $hash`,
      `expires_at: time::now() + ${SESSION_TTL_HOURS}h`,
    ];
    const params: Record<string, unknown> = {
      uid_raw: rawIdPart(userId, 'users'),
      hash: tokenHash,
    };
    if (meta.ip != null && meta.ip !== '') {
      fields.push('ip: $ip');
      params.ip = meta.ip;
    }
    if (meta.userAgent != null && meta.userAgent !== '') {
      fields.push('user_agent: $ua');
      params.ua = meta.userAgent;
    }
    const result = await this.db.query<[unknown[]]>(
      `CREATE user_sessions CONTENT { ${fields.join(', ')} }
       RETURN id, user, ip, user_agent, created_at, expires_at, last_active_at, revoked_at;`,
      params
    );
    const row = result[0]?.[0];
    if (!row) throw new Error('Failed to create session');
    return { session: normalizeSession(row), token };
  }

  async findActiveByTokenHash(tokenHash: string): Promise<Session | null> {
    const result = await this.db.query<[unknown[]]>(
      `SELECT id, user, ip, user_agent, created_at, expires_at, last_active_at, revoked_at
       FROM user_sessions
       WHERE session_token_hash = $hash
         AND ${IS_UNSET('revoked_at')}
         AND expires_at > time::now()
       LIMIT 1;`,
      { hash: tokenHash }
    );
    const row = result[0]?.[0];
    return row ? normalizeSession(row) : null;
  }

  async touch(sessionId: string): Promise<void> {
    await this.db.query(
      'UPDATE user_sessions SET last_active_at = time::now() WHERE id = type::thing("user_sessions", $raw);',
      { raw: rawIdPart(sessionId, 'user_sessions') }
    );
  }

  async revoke(sessionId: string): Promise<void> {
    await this.db.query(
      'UPDATE user_sessions SET revoked_at = time::now() WHERE id = type::thing("user_sessions", $raw);',
      { raw: rawIdPart(sessionId, 'user_sessions') }
    );
  }

  async listActiveForUser(userId: string): Promise<Session[]> {
    const result = await this.db.query<[unknown[]]>(
      `SELECT id, user, ip, user_agent, created_at, expires_at, last_active_at, revoked_at
       FROM user_sessions
       WHERE user = type::thing('users', $uid_raw)
         AND ${IS_UNSET('revoked_at')}
         AND expires_at > time::now()
       ORDER BY created_at DESC;`,
      { uid_raw: rawIdPart(userId, 'users') }
    );
    return (result[0] ?? []).map(normalizeSession);
  }
}
