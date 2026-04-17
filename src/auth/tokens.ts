/**
 * Token generation and hashing utilities.
 *
 * Personal tokens (pt_*) are the primary credential for users. They are
 * generated with 32 bytes of cryptographic randomness, base62-encoded, and
 * stored as SHA-256 hashes — the plaintext token is returned once at
 * creation time and never again.
 *
 * Design: see Plexus v5 Kickoff ADR (buddy 01KNF08JS7VKWPRYF1N8Q8ESMB) and
 * Auth & Security Hardening ADR (buddy 01KNF1YX0DS7BEKAF2EF6F8TG1).
 */

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * The largest byte value strictly below the last complete multiple of 62 in
 * the 0..255 range. Bytes in 0..247 cover each of the 62 base62 slots
 * exactly four times; bytes in 248..255 would wrap around and give
 * slots 0..7 a fifth, fractional count — an ~3.1% bias on the first
 * eight base62 characters. Rejection sampling (LOW-1 fix from the
 * 2026-04-10 audit entities:llclhdhv5a8yyf27xz4v) discards any byte at
 * or above this threshold and keeps pulling fresh randomness until the
 * token is full, giving a perfectly uniform distribution at the cost
 * of ~3% extra entropy consumption per call.
 */
const BASE62_REJECT_THRESHOLD = 248; // 4 × 62

/**
 * Pull exactly `length` uniformly-distributed base62 characters via
 * rejection sampling on cryptographically random bytes. The while-loop
 * almost always exits in a single iteration because we over-allocate
 * the initial randomBytes buffer by ~5% to absorb the expected reject
 * rate without needing a second syscall.
 */
function base62Body(length: number): string {
  const chars: string[] = [];
  while (chars.length < length) {
    const needed = length - chars.length;
    const buf = randomBytes(needed + Math.ceil(needed * 0.05) + 1);
    for (const byte of buf) {
      if (byte >= BASE62_REJECT_THRESHOLD) continue;
      chars.push(BASE62[byte % 62]!);
      if (chars.length === length) break;
    }
  }
  return chars.join('');
}

/**
 * Generates a new personal user token with the `pt_` prefix.
 * Format: pt_ + 32 base62 characters.
 * Total length: 35 characters.
 */
export function generatePersonalToken(): string {
  return `pt_${base62Body(32)}`;
}

/**
 * Generates a session token (for dashboard cookies). Format: st_ + 32 base62.
 */
export function generateSessionToken(): string {
  return `st_${base62Body(32)}`;
}

/**
 * SHA-256 hash of a token, hex-encoded. Used for storage — the plaintext
 * is never persisted.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Timing-safe comparison of a plaintext token against a stored hash.
 */
export function compareTokenToHash(token: string, storedHash: string): boolean {
  const computed = hashToken(token);
  if (computed.length !== storedHash.length) return false;
  return timingSafeEqual(Buffer.from(computed), Buffer.from(storedHash));
}

/**
 * Timing-safe comparison of two plaintext tokens (used for admin token
 * validation, where we compare directly against the env var).
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Extracts a Bearer token from an Authorization header.
 * Returns null if the header is missing or malformed.
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = /^Bearer\s+(.+)$/.exec(authHeader);
  return match?.[1] ?? null;
}
