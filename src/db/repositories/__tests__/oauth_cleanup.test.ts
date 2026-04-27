/**
 * Integration tests for OAuthRepository.cleanupOrphanedClients.
 *
 * Regression target: 2026-04-21 production incident — Claude.ai
 * refresh_token grants failed with client_id_not_found after plexus
 * restarts. Root cause was the startup DCR cleanup deleting clients
 * that still had active refresh tokens, because
 *   (a) `id NOT IN (SELECT VALUE client FROM oauth_access_tokens …)`
 *       is broken for Thing-typed records under SurrealDB v2, and
 *   (b) the query never checked oauth_refresh_tokens at all.
 *
 * These tests lock in: old clients with ANY token (access or refresh,
 * active or expired) must survive cleanup.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { OAuthRepository } from '../oauth.js';
import {
  startSurrealMemory,
  surrealAvailable,
  type SurrealHarness,
} from '../../../__tests__/helpers/surreal_harness.js';

describe.skipIf(!surrealAvailable())('OAuthRepository.cleanupOrphanedClients', () => {
  let harness: SurrealHarness;
  let oauth: OAuthRepository;
  const USER_ID = 'users:test_user_oauth_cleanup';

  beforeAll(async () => {
    harness = await startSurrealMemory();
    oauth = new OAuthRepository(harness.db);
    await harness.db.query(
      `CREATE users:test_user_oauth_cleanup CONTENT { name: "test_user_oauth_cleanup", token_hash: "${'0'.repeat(64)}" };`
    );
  }, 60_000);

  afterAll(async () => {
    if (harness) await harness.stop();
  });

  beforeEach(async () => {
    await harness.db.query(
      'DELETE oauth_refresh_tokens; DELETE oauth_access_tokens; DELETE oauth_auth_codes; DELETE oauth_clients;'
    );
  });

  async function createOldClient(clientId: string): Promise<string> {
    // Force created_at to 10 days ago so the cleanup's `>7 days` filter
    // picks it up.
    const res = await harness.db.query<[Array<{ id: unknown }>]>(
      `CREATE oauth_clients CONTENT {
        client_id: $cid,
        client_name: 'Test Client',
        redirect_uris: ['https://example.com/cb'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        created_at: time::now() - 10d
      } RETURN id;`,
      { cid: clientId }
    );
    return String((res[0]?.[0] as { id: { toString(): string } })?.id);
  }

  test('deletes a client with no tokens at all', async () => {
    await createOldClient('client_orphan_no_tokens');
    const removed = await oauth.cleanupOrphanedClients(7);
    expect(removed).toBe(1);
    const found = await oauth.findClientByClientId('client_orphan_no_tokens');
    expect(found).toBeNull();
  });

  test('keeps a client that has an active refresh_token even if no access_token', async () => {
    const cid = 'client_active_refresh_only';
    await createOldClient(cid);
    const client = await oauth.findClientByClientId(cid);
    expect(client).not.toBeNull();
    await oauth.createRefreshToken({
      tokenHash: 'a'.repeat(64),
      clientId: client!.id,
      userId: USER_ID,
      scope: 'mcp',
      ttlSeconds: 30 * 24 * 3600,
    });

    const removed = await oauth.cleanupOrphanedClients(7);
    expect(removed).toBe(0);
    const stillThere = await oauth.findClientByClientId(cid);
    expect(stillThere).not.toBeNull();
  });

  test('keeps a client referenced by expired/revoked tokens (historical-use marker)', async () => {
    const cid = 'client_only_expired_access_token';
    await createOldClient(cid);
    const client = await oauth.findClientByClientId(cid);
    // Create an access token then revoke it — the row lingers as a
    // historical-use marker. cleanup must not drop the client.
    await oauth.createAccessToken({
      tokenHash: 'b'.repeat(64),
      clientId: client!.id,
      userId: USER_ID,
      scope: 'mcp',
      ttlSeconds: 60,
    });
    await oauth.revokeAccessToken('b'.repeat(64));

    const removed = await oauth.cleanupOrphanedClients(7);
    expect(removed).toBe(0);
    expect(await oauth.findClientByClientId(cid)).not.toBeNull();
  });

  test('keeps clients created within the retention window even if orphaned', async () => {
    // Fresh client, no tokens, but created NOW — should not be touched.
    await harness.db.query(
      `CREATE oauth_clients CONTENT {
        client_id: 'client_fresh_no_tokens',
        client_name: 'Fresh', redirect_uris: ['https://example.com/cb'],
        grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
        token_endpoint_auth_method: 'none'
      };`
    );
    const removed = await oauth.cleanupOrphanedClients(7);
    expect(removed).toBe(0);
    expect(await oauth.findClientByClientId('client_fresh_no_tokens')).not.toBeNull();
  });

  test('mixed scenario: deletes true orphans, keeps clients with tokens', async () => {
    // Two orphans that should go away.
    await createOldClient('orphan_a');
    await createOldClient('orphan_b');
    // One client that should survive — has a refresh token.
    const surviveCid = 'survivor_with_refresh';
    await createOldClient(surviveCid);
    const survivor = await oauth.findClientByClientId(surviveCid);
    await oauth.createRefreshToken({
      tokenHash: 'c'.repeat(64),
      clientId: survivor!.id,
      userId: USER_ID,
      scope: 'mcp',
    });

    const removed = await oauth.cleanupOrphanedClients(7);
    expect(removed).toBe(2);
    expect(await oauth.findClientByClientId('orphan_a')).toBeNull();
    expect(await oauth.findClientByClientId('orphan_b')).toBeNull();
    expect(await oauth.findClientByClientId(surviveCid)).not.toBeNull();
  });
});
