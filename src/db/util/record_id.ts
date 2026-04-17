/**
 * Centralised SurrealDB record-id helpers.
 *
 * SurrealDB v2 returns record ids in a handful of shapes depending on the
 * client/codec combination: plain "table:id" strings, corner-bracketed
 * "table:⟨id⟩" strings (the SurrealDB "escaped id" form for ids that
 * contain special characters), and RecordId objects of the shape
 * `{ tb: string, id: string }`. These helpers collapse all three into a
 * canonical `"table:id"` string, and into the bare id part that can be
 * safely fed into `type::thing('table', $raw)` queries.
 *
 * Before this module, every repository shipped its own copy — 8 copies of
 * `normalizeThingId` and 9 of `rawIdPart`, with slight drift (sessions.ts
 * and passkeys.ts hardcoded the "users:" prefix, others parameterised the
 * table name but with inconsistent defaults). Plexus step 9.3 consolidates
 * all of them here.
 */

/**
 * Normalise any SurrealDB id representation to the canonical "table:id"
 * string form. Idempotent — calling it twice is safe.
 *
 * Accepted inputs:
 *   - `null` / `undefined`                → `""`
 *   - `"users:abc"`                       → `"users:abc"`
 *   - `"users:⟨abc⟩"`                     → `"users:abc"`
 *   - `{ tb: "users", id: "abc" }`        → `"users:abc"`
 *   - `{ tb: "users", id: "⟨abc⟩" }`     → `"users:abc"`
 *   - anything else                       → `String(value)` with brackets
 *                                            stripped
 */
export function normalizeThingId(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'object') {
    const obj = raw as { tb?: unknown; id?: unknown };
    if ('tb' in obj && 'id' in obj) {
      const tb = typeof obj.tb === 'string' ? obj.tb : String(obj.tb);
      const idPart = typeof obj.id === 'string' ? obj.id : String(obj.id);
      return `${tb}:${idPart.replace(/^⟨/, '').replace(/⟩$/, '')}`;
    }
  }
  return String(raw).replace(/⟨/g, '').replace(/⟩/g, '');
}

/**
 * Extract the bare identifier part from a SurrealDB record id, stripping
 * the `${table}:` prefix if present. Useful when the caller wants to
 * reconstruct a Thing via `type::thing('table', $raw)` inside a SurrealQL
 * query — passing the bare id avoids double-prefixing.
 *
 * `table` is required. Earlier per-repo copies had defaults (sometimes
 * "users", sometimes "entities") that made it easy to accidentally pass
 * an id from the wrong table. Requiring the caller to be explicit makes
 * that class of bug impossible.
 */
export function rawIdPart(id: unknown, table: string): string {
  const normalized = normalizeThingId(id);
  const prefix = `${table}:`;
  if (normalized.startsWith(prefix)) {
    return normalized.slice(prefix.length);
  }
  return normalized;
}
