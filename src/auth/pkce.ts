/**
 * PKCE helpers (RFC 7636).
 *
 * plexus requires S256. `plain` is explicitly rejected — it's weaker
 * and the MCP Authorization spec disallows it.
 */

import { createHash } from 'node:crypto';

/**
 * Compute the S256 challenge of a verifier: base64url(sha256(verifier)).
 * Matches exactly what a spec-compliant client produces.
 */
export function s256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Constant-time check of a PKCE verifier against a stored S256 challenge.
 * Uses length-aware equality; both strings are base64url so they are
 * identical length for a given hash size.
 */
export function verifyPkce(verifier: string, storedChallenge: string): boolean {
  const computed = s256Challenge(verifier);
  if (computed.length !== storedChallenge.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ storedChallenge.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Validate a verifier's shape per RFC 7636 §4.1: 43–128 chars,
 * unreserved URL characters only.
 */
export function isValidVerifier(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 43 && v.length <= 128 && /^[A-Za-z0-9\-._~]+$/.test(v);
}

/**
 * Validate the challenge format likewise — must be base64url of a
 * 32-byte sha256 hash, so exactly 43 chars, base64url alphabet.
 */
export function isValidChallenge(c: unknown): c is string {
  return typeof c === 'string' && c.length === 43 && /^[A-Za-z0-9\-_]+$/.test(c);
}
