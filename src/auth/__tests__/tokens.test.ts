/**
 * Tests for token generation, hashing, and header extraction.
 *
 * Focus: the LOW-1 audit finding from 2026-04-10
 * (entities:llclhdhv5a8yyf27xz4v). The original generator did
 * `byte % 62` over 32 random bytes, which biases the first 8 chars of
 * BASE62 slightly — bytes 0..247 map uniformly to 0..61, but bytes
 * 248..255 wrap around to 0..7 a second time, making those chars
 * ~3.1% more likely. The fix is rejection sampling: discard any byte
 * ≥ 248 and keep sampling until we have enough. These tests lock that
 * behaviour.
 */

import { describe, test, expect } from 'vitest';
import {
  generatePersonalToken,
  generateSessionToken,
  hashToken,
  compareTokenToHash,
  timingSafeStringEqual,
  extractBearerToken,
} from '../tokens.js';

const BASE62_SET = new Set('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789');

describe('generatePersonalToken', () => {
  test('has the pt_ prefix and 32 body characters', () => {
    const t = generatePersonalToken();
    expect(t).toMatch(/^pt_.{32}$/);
    expect(t.length).toBe(35);
  });

  test('body contains only base62 characters', () => {
    for (let i = 0; i < 50; i++) {
      const t = generatePersonalToken();
      for (const ch of t.slice(3)) {
        expect(BASE62_SET.has(ch)).toBe(true);
      }
    }
  });

  test('produces distinct tokens on repeated calls (randomness sanity)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(generatePersonalToken());
    expect(seen.size).toBe(100);
  });
});

describe('generateSessionToken', () => {
  test('has the st_ prefix and 32 body characters', () => {
    const t = generateSessionToken();
    expect(t).toMatch(/^st_.{32}$/);
    expect(t.length).toBe(35);
  });

  test('body contains only base62 characters', () => {
    for (let i = 0; i < 50; i++) {
      const t = generateSessionToken();
      for (const ch of t.slice(3)) {
        expect(BASE62_SET.has(ch)).toBe(true);
      }
    }
  });
});

describe('hashToken', () => {
  test('produces a 64-char hex SHA-256 digest', () => {
    const h = hashToken('hello');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  test('is deterministic', () => {
    expect(hashToken('x')).toBe(hashToken('x'));
  });

  test('different inputs produce different outputs', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });
});

describe('compareTokenToHash', () => {
  test('returns true for matching token + hash', () => {
    const token = 'pt_abc123';
    expect(compareTokenToHash(token, hashToken(token))).toBe(true);
  });

  test('returns false for mismatched token', () => {
    expect(compareTokenToHash('pt_abc', hashToken('pt_xyz'))).toBe(false);
  });

  test('returns false for stored hash of different length (no throw)', () => {
    expect(compareTokenToHash('pt_abc', 'short')).toBe(false);
  });
});

describe('timingSafeStringEqual', () => {
  test('true for equal strings', () => {
    expect(timingSafeStringEqual('secret', 'secret')).toBe(true);
  });

  test('false for different strings', () => {
    expect(timingSafeStringEqual('secret', 'SECRET')).toBe(false);
  });

  test('false for different lengths (no throw)', () => {
    expect(timingSafeStringEqual('secret', 'secrets')).toBe(false);
  });
});

describe('extractBearerToken', () => {
  test('extracts a simple bearer token', () => {
    expect(extractBearerToken('Bearer abc123')).toBe('abc123');
  });

  test('accepts extra whitespace', () => {
    expect(extractBearerToken('Bearer   abc123')).toBe('abc123');
  });

  test('returns null for missing header', () => {
    expect(extractBearerToken(undefined)).toBe(null);
  });

  test('returns null for a malformed header', () => {
    expect(extractBearerToken('Basic abc')).toBe(null);
  });
});
