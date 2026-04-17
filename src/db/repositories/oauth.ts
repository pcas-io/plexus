/**
 * OAuth Repository — persistence layer for the plexus OAuth 2.1
 * authorization server (ADR 01KNFQ060M7F2MVC4BFZ18CN6N).
 *
 * Security invariants enforced here:
 *   - Every token goes through a sha256 hash before it touches the DB.
 *     The raw token value is only ever in memory for the duration of
 *     the request that creates or verifies it.
 *   - Authorization codes are one-time: consume() atomically sets
 *     consumed_at and will refuse to return a row that has already
 *     been consumed, is expired, or was revoked.
 *   - Access tokens are verified via an atomic "is active NOW" query
 *     that checks both expires_at and revoked_at, so a revocation
 *     race cannot let an already-revoked token slip through.
 *
 * Keeping all OAuth SQL in one file makes it easier to audit than
 * scattering it across routes.
 */

import type { Surreal } from 'surrealdb';
import { normalizeThingId, rawIdPart } from '../util/record_id.js';
import { IS_UNSET } from '../util/query.js';

// ============================================================
// Types
// ============================================================

export interface OAuthClient {
  readonly id: string;
  readonly client_id: string;
  readonly client_name: string;
  readonly redirect_uris: string[];
  readonly grant_types: string[];
  readonly response_types: string[];
  readonly token_endpoint_auth_method: string;
  readonly created_at: string;
}

export interface NewOAuthClient {
  readonly clientId: string;
  readonly clientName: string;
  readonly redirectUris: string[];
  readonly grantTypes?: string[];
  readonly responseTypes?: string[];
  readonly tokenEndpointAuthMethod?: string;
  readonly createdIp?: string;
  readonly createdUa?: string;
}

export interface OAuthAuthCode {
  readonly id: string;
  readonly client: string;
  readonly user: string;
  readonly redirect_uri: string;
  readonly code_challenge: string;
  readonly code_challenge_method: string;
  readonly scope: string;
  readonly resource: string | null;
  readonly created_at: string;
  readonly expires_at: string;
  readonly consumed_at: string | null;
}

export interface NewAuthCode {
  readonly codeHash: string;
  readonly clientId: string;
  readonly userId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly scope: string;
  readonly resource?: string;
  /** TTL in seconds (default 600 = 10 min) */
  readonly ttlSeconds?: number;
}

export interface OAuthAccessToken {
  readonly id: string;
  readonly client: string;
  readonly user: string;
  readonly scope: string;
  readonly resource: string | null;
  readonly created_at: string;
  readonly expires_at: string;
  readonly revoked_at: string | null;
  readonly last_used_at: string | null;
}

export interface NewAccessToken {
  readonly tokenHash: string;
  readonly clientId: string;
  readonly userId: string;
  readonly scope: string;
  readonly resource?: string;
  /** TTL in seconds (default 3600 = 1h) */
  readonly ttlSeconds?: number;
}

export interface NewRefreshToken {
  readonly tokenHash: string;
  readonly clientId: string;
  readonly userId: string;
  readonly scope: string;
  readonly resource?: string;
  /** TTL in seconds (default 2592000 = 30 days) */
  readonly ttlSeconds?: number;
}

export interface OAuthRefreshToken {
  readonly id: string;
  readonly client: string;
  readonly user: string;
  readonly scope: string;
  readonly resource: string | null;
  readonly created_at: string;
  readonly expires_at: string;
  readonly revoked_at: string | null;
}

// ============================================================
// Normalization helpers
// ============================================================

function normalizeClient(raw: unknown): OAuthClient {
  const r = raw as Record<string, unknown>;
  return {
    id: normalizeThingId(r.id),
    client_id: String(r.client_id),
    client_name: String(r.client_name),
    redirect_uris: Array.isArray(r.redirect_uris) ? (r.redirect_uris as string[]) : [],
    grant_types: Array.isArray(r.grant_types) ? (r.grant_types as string[]) : [],
    response_types: Array.isArray(r.response_types) ? (r.response_types as string[]) : [],
    token_endpoint_auth_method: String(r.token_endpoint_auth_method ?? 'none'),
    created_at: String(r.created_at),
  };
}

function normalizeCode(raw: unknown): OAuthAuthCode {
  const r = raw as Record<string, unknown>;
  return {
    id: normalizeThingId(r.id),
    client: normalizeThingId(r.client),
    user: normalizeThingId(r.user),
    redirect_uri: String(r.redirect_uri),
    code_challenge: String(r.code_challenge),
    code_challenge_method: String(r.code_challenge_method),
    scope: String(r.scope),
    resource: r.resource == null ? null : String(r.resource),
    created_at: String(r.created_at),
    expires_at: String(r.expires_at),
    consumed_at: r.consumed_at == null ? null : String(r.consumed_at),
  };
}

function normalizeAccessToken(raw: unknown): OAuthAccessToken {
  const r = raw as Record<string, unknown>;
  return {
    id: normalizeThingId(r.id),
    client: normalizeThingId(r.client),
    user: normalizeThingId(r.user),
    scope: String(r.scope),
    resource: r.resource == null ? null : String(r.resource),
    created_at: String(r.created_at),
    expires_at: String(r.expires_at),
    revoked_at: r.revoked_at == null ? null : String(r.revoked_at),
    last_used_at: r.last_used_at == null ? null : String(r.last_used_at),
  };
}

function normalizeRefreshToken(raw: unknown): OAuthRefreshToken {
  const r = raw as Record<string, unknown>;
  return {
    id: normalizeThingId(r.id),
    client: normalizeThingId(r.client),
    user: normalizeThingId(r.user),
    scope: String(r.scope),
    resource: r.resource == null ? null : String(r.resource),
    created_at: String(r.created_at),
    expires_at: String(r.expires_at),
    revoked_at: r.revoked_at == null ? null : String(r.revoked_at),
  };
}

// ============================================================
// Repository
// ============================================================

export class OAuthRepository {
  constructor(private readonly db: Surreal) {}

  // ---------------- Clients ----------------

  async createClient(input: NewOAuthClient): Promise<OAuthClient> {
    // Dynamic CONTENT so null option<> fields are omitted (SurrealDB
    // v2 rejects explicit null on option<T> columns).
    const fields: string[] = [
      'client_id: $client_id',
      'client_name: $client_name',
      'redirect_uris: $redirect_uris',
      'grant_types: $grant_types',
      'response_types: $response_types',
      'token_endpoint_auth_method: $token_endpoint_auth_method',
    ];
    const params: Record<string, unknown> = {
      client_id: input.clientId,
      client_name: input.clientName,
      redirect_uris: input.redirectUris,
      grant_types: input.grantTypes ?? ['authorization_code', 'refresh_token'],
      response_types: input.responseTypes ?? ['code'],
      token_endpoint_auth_method: input.tokenEndpointAuthMethod ?? 'none',
    };
    if (input.createdIp != null) {
      fields.push('created_ip: $created_ip');
      params.created_ip = input.createdIp;
    }
    if (input.createdUa != null) {
      fields.push('created_ua: $created_ua');
      params.created_ua = input.createdUa;
    }
    const result = await this.db.query<[unknown[]]>(
      `CREATE oauth_clients CONTENT { ${fields.join(', ')} }
         RETURN id, client_id, client_name, redirect_uris, grant_types, response_types, token_endpoint_auth_method, created_at;`,
      params
    );
    const row = result[0]?.[0];
    if (!row) throw new Error('Failed to create OAuth client');
    return normalizeClient(row);
  }

  async findClientByClientId(clientId: string): Promise<OAuthClient | null> {
    const result = await this.db.query<[unknown[]]>(
      `SELECT id, client_id, client_name, redirect_uris, grant_types, response_types, token_endpoint_auth_method, created_at
         FROM oauth_clients WHERE client_id = $cid LIMIT 1;`,
      { cid: clientId }
    );
    const row = result[0]?.[0];
    return row ? normalizeClient(row) : null;
  }

  // ---------------- Authorization codes ----------------

  async createAuthCode(input: NewAuthCode): Promise<OAuthAuthCode> {
    const ttl = Math.max(30, Math.min(input.ttlSeconds ?? 600, 15 * 60));
    const clientRaw = rawIdPart(input.clientId, 'oauth_clients');
    const userRaw = rawIdPart(input.userId, 'users');
    const fields: string[] = [
      'code_hash: $code_hash',
      `client: type::thing('oauth_clients', $cid_raw)`,
      `user: type::thing('users', $uid_raw)`,
      'redirect_uri: $redirect_uri',
      'code_challenge: $code_challenge',
      `code_challenge_method: 'S256'`,
      'scope: $scope',
      `expires_at: time::now() + ${ttl}s`,
    ];
    const params: Record<string, unknown> = {
      code_hash: input.codeHash,
      cid_raw: clientRaw,
      uid_raw: userRaw,
      redirect_uri: input.redirectUri,
      code_challenge: input.codeChallenge,
      scope: input.scope,
    };
    if (input.resource != null) {
      fields.push('resource: $resource');
      params.resource = input.resource;
    }
    const result = await this.db.query<[unknown[]]>(
      `CREATE oauth_auth_codes CONTENT { ${fields.join(', ')} }
         RETURN id, code_hash, client, user, redirect_uri, code_challenge, code_challenge_method, scope, resource, created_at, expires_at, consumed_at;`,
      params
    );
    const row = result[0]?.[0];
    if (!row) throw new Error('Failed to create auth code');
    return normalizeCode(row);
  }

  /**
   * Atomically consume an auth code: returns the row only if it is
   * still unconsumed AND not expired, and marks it as consumed in the
   * same UPDATE. Any subsequent consume() returns null.
   */
  async consumeAuthCode(codeHash: string): Promise<OAuthAuthCode | null> {
    const result = await this.db.query<[unknown[]]>(
      `UPDATE oauth_auth_codes SET consumed_at = time::now()
         WHERE code_hash = $code_hash
           AND ${IS_UNSET('consumed_at')}
           AND expires_at > time::now()
         RETURN id, code_hash, client, user, redirect_uri, code_challenge, code_challenge_method, scope, resource, created_at, expires_at, consumed_at;`,
      { code_hash: codeHash }
    );
    const row = result[0]?.[0];
    return row ? normalizeCode(row) : null;
  }

  // ---------------- Access tokens ----------------

  async createAccessToken(input: NewAccessToken): Promise<OAuthAccessToken> {
    const ttl = Math.max(60, Math.min(input.ttlSeconds ?? 3600, 24 * 3600));
    const clientRaw = rawIdPart(input.clientId, 'oauth_clients');
    const userRaw = rawIdPart(input.userId, 'users');
    const fields: string[] = [
      'token_hash: $token_hash',
      `client: type::thing('oauth_clients', $cid_raw)`,
      `user: type::thing('users', $uid_raw)`,
      'scope: $scope',
      `expires_at: time::now() + ${ttl}s`,
    ];
    const params: Record<string, unknown> = {
      token_hash: input.tokenHash,
      cid_raw: clientRaw,
      uid_raw: userRaw,
      scope: input.scope,
    };
    if (input.resource != null) {
      fields.push('resource: $resource');
      params.resource = input.resource;
    }
    const result = await this.db.query<[unknown[]]>(
      `CREATE oauth_access_tokens CONTENT { ${fields.join(', ')} }
         RETURN id, token_hash, client, user, scope, resource, created_at, expires_at, revoked_at, last_used_at;`,
      params
    );
    const row = result[0]?.[0];
    if (!row) throw new Error('Failed to create access token');
    return normalizeAccessToken(row);
  }

  /**
   * Look up an access token and verify it is currently active in a
   * single atomic query. Returns null for expired, revoked or unknown
   * tokens so callers cannot accidentally accept a stale row.
   */
  async findActiveAccessToken(tokenHash: string): Promise<OAuthAccessToken | null> {
    const result = await this.db.query<[unknown[]]>(
      `SELECT id, token_hash, client, user, scope, resource, created_at, expires_at, revoked_at, last_used_at
         FROM oauth_access_tokens
         WHERE token_hash = $h
           AND ${IS_UNSET('revoked_at')}
           AND expires_at > time::now()
         LIMIT 1;`,
      { h: tokenHash }
    );
    const row = result[0]?.[0];
    return row ? normalizeAccessToken(row) : null;
  }

  async touchAccessToken(tokenHash: string): Promise<void> {
    await this.db.query(
      `UPDATE oauth_access_tokens SET last_used_at = time::now() WHERE token_hash = $h;`,
      { h: tokenHash }
    );
  }

  async revokeAccessToken(tokenHash: string): Promise<void> {
    await this.db.query(
      `UPDATE oauth_access_tokens SET revoked_at = time::now()
         WHERE token_hash = $h AND ${IS_UNSET('revoked_at')};`,
      { h: tokenHash }
    );
  }

  // ---------------- Refresh tokens ----------------

  async createRefreshToken(input: NewRefreshToken): Promise<OAuthRefreshToken> {
    const ttl = Math.max(3600, Math.min(input.ttlSeconds ?? 30 * 24 * 3600, 90 * 24 * 3600));
    const clientRaw = rawIdPart(input.clientId, 'oauth_clients');
    const userRaw = rawIdPart(input.userId, 'users');
    const fields: string[] = [
      'token_hash: $token_hash',
      `client: type::thing('oauth_clients', $cid_raw)`,
      `user: type::thing('users', $uid_raw)`,
      'scope: $scope',
      `expires_at: time::now() + ${ttl}s`,
    ];
    const params: Record<string, unknown> = {
      token_hash: input.tokenHash,
      cid_raw: clientRaw,
      uid_raw: userRaw,
      scope: input.scope,
    };
    if (input.resource != null) {
      fields.push('resource: $resource');
      params.resource = input.resource;
    }
    const result = await this.db.query<[unknown[]]>(
      `CREATE oauth_refresh_tokens CONTENT { ${fields.join(', ')} }
         RETURN id, token_hash, client, user, scope, resource, created_at, expires_at, revoked_at;`,
      params
    );
    const row = result[0]?.[0];
    if (!row) throw new Error('Failed to create refresh token');
    return normalizeRefreshToken(row);
  }

  async findActiveRefreshToken(tokenHash: string): Promise<OAuthRefreshToken | null> {
    const result = await this.db.query<[unknown[]]>(
      `SELECT id, token_hash, client, user, scope, resource, created_at, expires_at, revoked_at
         FROM oauth_refresh_tokens
         WHERE token_hash = $h
           AND ${IS_UNSET('revoked_at')}
           AND expires_at > time::now()
         LIMIT 1;`,
      { h: tokenHash }
    );
    const row = result[0]?.[0];
    return row ? normalizeRefreshToken(row) : null;
  }

  async revokeRefreshToken(tokenHash: string): Promise<void> {
    await this.db.query(
      `UPDATE oauth_refresh_tokens SET revoked_at = time::now()
         WHERE token_hash = $h AND ${IS_UNSET('revoked_at')};`,
      { h: tokenHash }
    );
  }

  /**
   * Delete oauth_clients rows that have no associated access tokens and
   * were created more than `olderThanDays` days ago. Returns the number
   * of rows removed.
   *
   * This is the DCR orphan cleanup from Security-Finding #23. Intended
   * to run once at startup and optionally on a daily timer.
   */
  async cleanupOrphanedClients(olderThanDays = 7): Promise<number> {
    const days = Math.max(1, Math.floor(olderThanDays));
    // Two-step: first find IDs, then delete. SurrealDB v2 does not
    // support DELETE with a subquery-based WHERE elegantly, so we
    // query first and delete in a second pass.
    const result = await this.db.query<[Array<{ id: unknown }>]>(
      `SELECT id FROM oauth_clients
         WHERE created_at < time::now() - ${days}d
           AND id NOT IN (SELECT VALUE client FROM oauth_access_tokens GROUP BY client)
         ;`
    );
    const rows = result[0] ?? [];
    if (rows.length === 0) return 0;
    for (const row of rows) {
      const id = normalizeThingId(row.id);
      const raw = rawIdPart(id, 'oauth_clients');
      await this.db.query(
        `DELETE oauth_clients WHERE id = type::thing('oauth_clients', $raw);`,
        { raw }
      );
    }
    return rows.length;
  }

  /**
   * Revoke every active token for the given user — used when an admin
   * deactivates the account so no existing OAuth grant can still reach
   * the MCP endpoint.
   */
  /**
   * List OAuth clients that a specific user has granted access to
   * (i.e. the user has at least one access or refresh token for the
   * client). Returns the client info + the most recent token metadata.
   */
  async listGrantedClientsForUser(userId: string): Promise<Array<{
    client: OAuthClient;
    activeTokens: number;
    lastUsedAt: string | null;
    grantedAt: string;
  }>> {
    const raw = rawIdPart(userId, 'users');
    // Find distinct clients that have issued tokens to this user.
    // We count active access tokens and find the earliest created_at
    // (= when the grant was first issued) and latest last_used_at.
    const result = await this.db.query<[Array<Record<string, unknown>>]>(
      `SELECT
         client,
         count() AS active_tokens,
         math::min(created_at) AS granted_at,
         math::max(last_used_at) AS last_used_at
       FROM oauth_access_tokens
       WHERE user = type::thing('users', $raw)
         AND ${IS_UNSET('revoked_at')}
         AND expires_at > time::now()
       GROUP BY client;`,
      { raw }
    );
    const rows = result[0] ?? [];
    const out: Array<{
      client: OAuthClient;
      activeTokens: number;
      lastUsedAt: string | null;
      grantedAt: string;
    }> = [];
    for (const row of rows) {
      const clientId = normalizeThingId(row.client);
      const clientRaw = rawIdPart(clientId, 'oauth_clients');
      const clientResult = await this.db.query<[unknown[]]>(
        `SELECT id, client_id, client_name, redirect_uris, grant_types, response_types, token_endpoint_auth_method, created_at
           FROM oauth_clients WHERE id = type::thing('oauth_clients', $raw) LIMIT 1;`,
        { raw: clientRaw }
      );
      const clientRow = clientResult[0]?.[0];
      if (!clientRow) continue;
      out.push({
        client: normalizeClient(clientRow),
        activeTokens: Number(row.active_tokens ?? 0),
        lastUsedAt: row.last_used_at == null ? null : String(row.last_used_at),
        grantedAt: String(row.granted_at),
      });
    }
    return out;
  }

  /**
   * Revoke all active tokens for a specific client + user pair.
   */
  async revokeClientForUser(clientId: string, userId: string): Promise<void> {
    const clientRaw = rawIdPart(clientId, 'oauth_clients');
    const userRaw = rawIdPart(userId, 'users');
    await this.db.query(
      `UPDATE oauth_access_tokens SET revoked_at = time::now()
         WHERE client = type::thing('oauth_clients', $craw)
           AND user = type::thing('users', $uraw)
           AND ${IS_UNSET('revoked_at')};
       UPDATE oauth_refresh_tokens SET revoked_at = time::now()
         WHERE client = type::thing('oauth_clients', $craw)
           AND user = type::thing('users', $uraw)
           AND ${IS_UNSET('revoked_at')};`,
      { craw: clientRaw, uraw: userRaw }
    );
  }

  async revokeAllForUser(userId: string): Promise<void> {
    const raw = rawIdPart(userId, 'users');
    await this.db.query(
      `UPDATE oauth_access_tokens SET revoked_at = time::now()
         WHERE user = type::thing('users', $uid_raw) AND ${IS_UNSET('revoked_at')};
       UPDATE oauth_refresh_tokens SET revoked_at = time::now()
         WHERE user = type::thing('users', $uid_raw) AND ${IS_UNSET('revoked_at')};`,
      { uid_raw: raw }
    );
  }
}
