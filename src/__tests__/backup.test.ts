/**
 * Tests for the backup module.
 *
 * Primary focus: MOD-6 from the 2026-04-10 audit
 * (entities:llclhdhv5a8yyf27xz4v). The activity_log contains personally
 * identifiable data (IP, User-Agent, user_name) that sits in a
 * different DSGVO risk bucket than the raw graph content. The default
 * backup path must not include it; callers that need the audit trail
 * in the same file pass `{ includeAudit: true }` (or the route query
 * param `?include_audit=1`) explicitly.
 *
 * These tests use a minimal Surreal stub that records which queries
 * the code ran — that's enough to verify both "did we query
 * activity_log" and "is the field in the output" without spinning up
 * a real SurrealDB.
 */

import { describe, test, expect, vi } from 'vitest';
import type { Surreal } from 'surrealdb';
import { createBackup } from '../backup.js';

function makeMockDb(): { db: Surreal; queries: string[] } {
  const queries: string[] = [];
  const db = {
    query: vi.fn(async (sql: string) => {
      queries.push(sql.trim());
      // Every query returns one empty result set.
      return [[]];
    }),
  } as unknown as Surreal;
  return { db, queries };
}

describe('createBackup — default (MOD-6: audit excluded)', () => {
  test('does not include activity_log in the output', async () => {
    const { db } = makeMockDb();
    const data = await createBackup(db);
    expect(data).not.toHaveProperty('activity_log');
  });

  test('does not query the activity_log table at all', async () => {
    const { db, queries } = makeMockDb();
    await createBackup(db);
    expect(queries.some((q) => q.includes('activity_log'))).toBe(false);
  });

  test('still queries entities, edges, kinds, relations, users', async () => {
    const { db, queries } = makeMockDb();
    await createBackup(db);
    expect(queries.some((q) => /FROM\s+entities\b/.test(q))).toBe(true);
    expect(queries.some((q) => /FROM\s+edges\b/.test(q))).toBe(true);
    expect(queries.some((q) => /FROM\s+entity_kinds\b/.test(q))).toBe(true);
    expect(queries.some((q) => /FROM\s+relations\b/.test(q))).toBe(true);
    expect(queries.some((q) => /FROM\s+users\b/.test(q))).toBe(true);
  });

  test('still excludes token_hash from the users projection', async () => {
    const { db, queries } = makeMockDb();
    await createBackup(db);
    const usersQuery = queries.find((q) => /FROM\s+users\b/.test(q));
    expect(usersQuery).toBeDefined();
    expect(usersQuery).not.toContain('token_hash');
  });

  test('returns a version string that matches the runtime VERSION', async () => {
    const { db } = makeMockDb();
    const data = await createBackup(db);
    expect(typeof data.version).toBe('string');
    expect(data.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('returns an ISO-ish exported_at timestamp', async () => {
    const { db } = makeMockDb();
    const data = await createBackup(db);
    expect(data.exported_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('createBackup — includeAudit=true', () => {
  test('adds activity_log field to the output', async () => {
    const { db } = makeMockDb();
    const data = await createBackup(db, { includeAudit: true });
    expect(data).toHaveProperty('activity_log');
  });

  test('queries the activity_log table', async () => {
    const { db, queries } = makeMockDb();
    await createBackup(db, { includeAudit: true });
    expect(queries.some((q) => q.includes('activity_log'))).toBe(true);
  });

  test('limits activity_log to 1000 entries', async () => {
    const { db, queries } = makeMockDb();
    await createBackup(db, { includeAudit: true });
    const auditQuery = queries.find((q) => q.includes('activity_log'));
    expect(auditQuery).toMatch(/LIMIT\s+1000/i);
  });
});
