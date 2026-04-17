/**
 * Shared SurrealQL fragment helpers.
 *
 * These are intentionally string-returning — SurrealDB's query builder is
 * just string concatenation with bound `$param` values. No escaping needed
 * here because we don't interpolate user input; we only accept compile-time
 * field names that the caller controls.
 */

/**
 * Build a parenthesised "field is unset" check that matches both the
 * SurrealDB `NONE` state (field was never set, the option<> type default)
 * AND the explicit `NULL` state (field was written as null).
 *
 * Surreal stores option-type fields in one of these two states depending
 * on how they were initialised — the CBOR wire format uses NONE for unset
 * but the JSON HTTP path sometimes writes NULL. A correct "is this still
 * open?" query must match both. Forgetting to do so was the root cause of
 * the self-service-token bug chain fixed on 2026-04-10 (commits `087e263`,
 * `4a706fa`).
 *
 * Usage:
 *   `SELECT * FROM share_tokens WHERE ${IS_UNSET('consumed_at')};`
 *   → `SELECT * FROM share_tokens WHERE (consumed_at IS NONE OR consumed_at IS NULL);`
 */
export function IS_UNSET(field: string): string {
  return `(${field} IS NONE OR ${field} IS NULL)`;
}
