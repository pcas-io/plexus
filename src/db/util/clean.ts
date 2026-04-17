/**
 * Shared attribute/properties cleaner.
 *
 * Consolidates three near-identical implementations that used to live in
 * `entities.ts`, `edges.ts`, and `activity_log.ts`. The contract:
 *
 * 1. **Accept loose input.** MCP clients sometimes send attributes as a
 *    JSON string ('{"priority":"high"}') instead of a parsed object, so
 *    we handle both. Arrays, strings, numbers, booleans, and nulls all
 *    collapse to `{}` — this function only produces record shapes.
 *
 * 2. **Force a JSON roundtrip.** SurrealDB's CBOR wire format does not
 *    cleanly roundtrip object instances created via `zod.any()` (some
 *    properties get silently dropped). A `JSON.parse(JSON.stringify(...))`
 *    trip guarantees a plain JSON object that CBOR can serialise without
 *    surprises.
 *
 * 3. **Strip prototype-pollution keys recursively.** The literal keys
 *    `__proto__`, `constructor`, and `prototype` are stripped from every
 *    object at every depth, including inside arrays. This is a MOD-7
 *    defence-in-depth layer from the 2026-04-10 security audit
 *    (entities:llclhdhv5a8yyf27xz4v). The existing consumer code paths
 *    don't actively exploit these keys, but downstream backup importers
 *    might, and keeping them out of the DB is cheap insurance.
 *
 * 4. **No size limit here.** Size enforcement lives in the Zod schemas at
 *    the MCP tool layer where we can return a structured validation error
 *    to the caller. `cleanObject` is called from many internal paths that
 *    don't need that error shape; failing loudly at the API boundary is
 *    the right place.
 */

/**
 * Maximum serialised size of an attributes/properties payload, in bytes.
 * Rejected above this threshold by the MCP tool layer via
 * `isAttributesWithinSize()`. 64 KB is the MOD-7 recommendation from the
 * 2026-04-10 security audit (entities:llclhdhv5a8yyf27xz4v) — generous
 * enough for typical structured attributes, tight enough to prevent a
 * single MCP client from bloating the DB with multi-MB objects.
 */
export const MAX_ATTRIBUTE_JSON_BYTES = 64_000;

/**
 * Check whether an attributes payload is within the configured size limit.
 *
 * Accepts plain objects, JSON strings, arrays, primitives, or null/undefined.
 * null/undefined always pass (these are the MCP "optional" representation).
 *
 * Circular references are counted as oversized — they cannot be stringified
 * by `JSON.stringify`, and since the DB layer would reject them anyway, the
 * safest behaviour at the API boundary is a clean rejection with a
 * structured validation error instead of a mysterious TypeError later.
 */
export function isAttributesWithinSize(input: unknown): boolean {
  if (input == null) return true;
  if (typeof input === 'string') {
    return input.length <= MAX_ATTRIBUTE_JSON_BYTES;
  }
  try {
    const serialized = JSON.stringify(input);
    if (serialized === undefined) return false;
    return serialized.length <= MAX_ATTRIBUTE_JSON_BYTES;
  } catch {
    return false;
  }
}

const PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function stripProtoKeys(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) {
    return value.map(stripProtoKeys);
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    // Use Object.keys to enumerate own-enumerable string keys only.
    // `for...in` would walk the prototype chain.
    for (const key of Object.keys(value)) {
      if (PROTO_KEYS.has(key)) continue;
      out[key] = stripProtoKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function cleanObject(input: unknown): Record<string, unknown> {
  // Accept JSON string (MCP clients sometimes send it this way).
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return stripProtoKeys(parsed) as Record<string, unknown>;
      }
    } catch {
      /* not valid JSON, fall through to {} */
    }
    return {};
  }

  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }

  // Force JSON roundtrip for CBOR safety, then strip proto keys.
  try {
    const roundtripped = JSON.parse(JSON.stringify(input));
    if (roundtripped != null && typeof roundtripped === 'object' && !Array.isArray(roundtripped)) {
      return stripProtoKeys(roundtripped) as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}
