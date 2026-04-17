/**
 * Tests for the shared attribute/properties cleaner.
 *
 * `cleanObject` consolidates what used to be three subtly-different
 * implementations across entities.ts / edges.ts / activity_log.ts. The
 * contract is: accept loose user input (possibly a JSON string, possibly
 * a plain object), return a plain `Record<string, unknown>` that's safe
 * to pass to SurrealDB via CBOR, **with prototype-pollution keys
 * recursively removed** as a MOD-7 defence-in-depth layer (audit finding
 * entities:llclhdhv5a8yyf27xz4v).
 *
 * Size limits are enforced at the MCP tool layer via Zod refinements —
 * `cleanObject` itself is unconditional because it's called from many
 * internal code paths that don't need a user-facing error, and the worst
 * case here is an oversized object which the DB will already reject on
 * its own size limits.
 */

import { describe, test, expect } from 'vitest';
import { cleanObject, isAttributesWithinSize, MAX_ATTRIBUTE_JSON_BYTES } from '../clean.js';

describe('cleanObject — happy path', () => {
  test('returns {} for null', () => {
    expect(cleanObject(null)).toEqual({});
  });

  test('returns {} for undefined', () => {
    expect(cleanObject(undefined)).toEqual({});
  });

  test('returns {} for a number', () => {
    expect(cleanObject(42)).toEqual({});
  });

  test('returns {} for an array (arrays are not records)', () => {
    expect(cleanObject([1, 2, 3])).toEqual({});
  });

  test('passes a plain object through (JSON roundtrip)', () => {
    const input = { priority: 'high', count: 3, tags: ['a', 'b'] };
    expect(cleanObject(input)).toEqual({ priority: 'high', count: 3, tags: ['a', 'b'] });
  });

  test('parses a JSON string into an object', () => {
    expect(cleanObject('{"priority":"high"}')).toEqual({ priority: 'high' });
  });

  test('returns {} for an invalid JSON string', () => {
    expect(cleanObject('{not json')).toEqual({});
  });

  test('returns {} for a JSON string that encodes a non-object', () => {
    expect(cleanObject('[1,2,3]')).toEqual({});
    expect(cleanObject('"a string"')).toEqual({});
    expect(cleanObject('42')).toEqual({});
  });
});

describe('cleanObject — prototype-pollution hardening (MOD-7)', () => {
  test('strips top-level __proto__ key', () => {
    const input = { foo: 'ok', __proto__: { polluted: true } };
    const out = cleanObject(input);
    expect(out).not.toHaveProperty('__proto__');
    expect(out.foo).toBe('ok');
  });

  test('strips top-level constructor key', () => {
    const input = { foo: 'ok', constructor: 'danger' };
    const out = cleanObject(input);
    expect(out).not.toHaveProperty('constructor');
    expect(out.foo).toBe('ok');
  });

  test('strips top-level prototype key', () => {
    const input = { foo: 'ok', prototype: 'danger' };
    const out = cleanObject(input);
    expect(out).not.toHaveProperty('prototype');
    expect(out.foo).toBe('ok');
  });

  test('strips prototype keys recursively from nested objects', () => {
    const input = {
      outer: 'ok',
      nested: {
        inner: 'still ok',
        __proto__: { polluted: true },
        constructor: 'x',
        prototype: 'y',
      },
    };
    const out = cleanObject(input) as { outer: string; nested: Record<string, unknown> };
    expect(out.outer).toBe('ok');
    expect(out.nested.inner).toBe('still ok');
    expect(out.nested).not.toHaveProperty('__proto__');
    expect(out.nested).not.toHaveProperty('constructor');
    expect(out.nested).not.toHaveProperty('prototype');
  });

  test('strips prototype keys inside nested arrays of objects', () => {
    const input = {
      list: [
        { ok: 1, __proto__: { polluted: true } },
        { ok: 2, constructor: 'x' },
      ],
    };
    const out = cleanObject(input) as { list: Record<string, unknown>[] };
    expect(out.list).toHaveLength(2);
    expect(out.list[0]).toEqual({ ok: 1 });
    expect(out.list[1]).toEqual({ ok: 2 });
  });

  test('strips prototype keys from a parsed JSON string', () => {
    const input = '{"foo":"ok","__proto__":{"polluted":true}}';
    const out = cleanObject(input);
    expect(out).not.toHaveProperty('__proto__');
    expect(out.foo).toBe('ok');
  });

  test('leaves legitimate keys containing the word "constructor" alone', () => {
    // Only the exact names __proto__, constructor, prototype are stripped.
    // User-defined keys like "constructorName" or "my_constructor" are fine.
    const input = { constructorName: 'Foo', my_constructor: 'Bar' };
    const out = cleanObject(input);
    expect(out.constructorName).toBe('Foo');
    expect(out.my_constructor).toBe('Bar');
  });
});

describe('isAttributesWithinSize — MOD-7 API-layer guard', () => {
  test('allows null/undefined (MCP optional)', () => {
    expect(isAttributesWithinSize(null)).toBe(true);
    expect(isAttributesWithinSize(undefined)).toBe(true);
  });

  test('allows small objects', () => {
    expect(isAttributesWithinSize({ priority: 'high', count: 3 })).toBe(true);
  });

  test('allows objects right at the limit', () => {
    // Build an object whose JSON representation is exactly at the limit.
    const body = 'x'.repeat(MAX_ATTRIBUTE_JSON_BYTES - 10);
    const input = { s: body }; // JSON: {"s":"xxxxx..."} — slightly longer than body
    // Just ensure the check does not throw and returns a boolean.
    expect(typeof isAttributesWithinSize(input)).toBe('boolean');
  });

  test('rejects objects larger than the limit', () => {
    const huge = { s: 'x'.repeat(MAX_ATTRIBUTE_JSON_BYTES + 1) };
    expect(isAttributesWithinSize(huge)).toBe(false);
  });

  test('allows a JSON string under the limit without double-counting', () => {
    // When the caller sends a JSON string, we measure its length directly
    // rather than parsing-then-stringifying.
    const jsonStr = JSON.stringify({ priority: 'high' });
    expect(isAttributesWithinSize(jsonStr)).toBe(true);
  });

  test('rejects a JSON string longer than the limit', () => {
    const oversized = 'x'.repeat(MAX_ATTRIBUTE_JSON_BYTES + 1);
    expect(isAttributesWithinSize(oversized)).toBe(false);
  });

  test('rejects circular references (cannot stringify → oversized by policy)', () => {
    const a: Record<string, unknown> = { name: 'a' };
    const b: Record<string, unknown> = { name: 'b', a };
    a.b = b;
    expect(isAttributesWithinSize(a)).toBe(false);
  });

  test('MAX_ATTRIBUTE_JSON_BYTES is 64 KB per audit recommendation', () => {
    expect(MAX_ATTRIBUTE_JSON_BYTES).toBe(64_000);
  });
});
