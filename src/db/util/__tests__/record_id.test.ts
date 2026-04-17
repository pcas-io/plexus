/**
 * Tests for the centralised SurrealDB record-id helpers.
 *
 * Until this module existed, every repository shipped its own copy of
 * `normalizeThingId` and `rawIdPart` — 8 normalisers and 9 raw-id-part
 * variants total, each with slight drift (hardcoded table names,
 * different default-table semantics). These tests lock the unified
 * behaviour so call sites can be migrated with confidence.
 */

import { describe, test, expect } from 'vitest';
import { normalizeThingId, rawIdPart } from '../record_id.js';

describe('normalizeThingId', () => {
  test('returns empty string for null', () => {
    expect(normalizeThingId(null)).toBe('');
  });

  test('returns empty string for undefined', () => {
    expect(normalizeThingId(undefined)).toBe('');
  });

  test('passes through plain "table:id" strings unchanged', () => {
    expect(normalizeThingId('users:abc')).toBe('users:abc');
  });

  test('strips corner brackets from stringified RecordId', () => {
    expect(normalizeThingId('users:⟨abc⟩')).toBe('users:abc');
  });

  test('strips multiple corner brackets anywhere in string form', () => {
    expect(normalizeThingId('⟨users⟩:⟨abc⟩')).toBe('users:abc');
  });

  test('formats RecordId-object form {tb, id}', () => {
    expect(normalizeThingId({ tb: 'users', id: 'abc123' })).toBe('users:abc123');
  });

  test('strips corner brackets from RecordId-object id field', () => {
    expect(normalizeThingId({ tb: 'users', id: '⟨abc123⟩' })).toBe('users:abc123');
  });

  test('coerces non-string tb/id fields via String()', () => {
    expect(normalizeThingId({ tb: 'users', id: 42 })).toBe('users:42');
  });

  test('falls back to String() coercion for unknown shapes', () => {
    expect(normalizeThingId(42)).toBe('42');
  });
});

describe('rawIdPart', () => {
  test('strips table prefix from plain "table:id" string', () => {
    expect(rawIdPart('users:abc', 'users')).toBe('abc');
  });

  test('strips table prefix from bracketed string', () => {
    expect(rawIdPart('users:⟨abc⟩', 'users')).toBe('abc');
  });

  test('strips table prefix from RecordId-object form', () => {
    expect(rawIdPart({ tb: 'users', id: 'abc' }, 'users')).toBe('abc');
  });

  test('returns the bare id unchanged if the prefix does not match', () => {
    expect(rawIdPart('abc', 'users')).toBe('abc');
  });

  test('works with different tables', () => {
    expect(rawIdPart('entities:xyz', 'entities')).toBe('xyz');
    expect(rawIdPart('personal_tokens:pt_abc', 'personal_tokens')).toBe('pt_abc');
    expect(rawIdPart('share_tokens:st_xyz', 'share_tokens')).toBe('st_xyz');
  });

  test('handles RecordId object with bracketed id for non-users tables', () => {
    expect(rawIdPart({ tb: 'entities', id: '⟨fbq6bjxsrn3sk41psf2e⟩' }, 'entities')).toBe(
      'fbq6bjxsrn3sk41psf2e',
    );
  });

  test('does NOT strip when the table name is a substring-prefix mismatch', () => {
    // "user" is a substring of "users" — we must only strip when the
    // full "user:" prefix matches, not when "user" is inside "users:...".
    // The caller passed the wrong table, the safest thing is to pass the
    // value through unchanged so the downstream query errors out loudly
    // instead of silently dropping characters.
    expect(rawIdPart('users:abc', 'user')).toBe('users:abc');
  });
});
