-- Plexus v5 — Personal Tokens with per-token scoping
-- Migration: 0005_personal_tokens
--
-- Moves token management from a single hash on the users table to a
-- dedicated personal_tokens table. Each token can have its own scope
-- (contexts, permission level, kind restrictions) and an optional
-- expiration date. This enables multiple tokens per user with
-- different access levels (e.g. read-only for monitoring, write for
-- Claude Code, scoped to a specific context for a CI job).
--
-- The users.token_hash column stays as-is for backwards compatibility
-- during the migration period. New tokens are created in both places;
-- the MCP auth middleware checks personal_tokens first, then falls
-- back to users.token_hash.

DEFINE TABLE IF NOT EXISTS personal_tokens SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS user ON personal_tokens TYPE record<users>;
DEFINE FIELD IF NOT EXISTS token_hash ON personal_tokens TYPE string ASSERT string::len($value) = 64;
DEFINE FIELD IF NOT EXISTS label ON personal_tokens TYPE option<string>;
DEFINE FIELD IF NOT EXISTS scope_permission ON personal_tokens TYPE string DEFAULT 'write';
DEFINE FIELD IF NOT EXISTS scope_contexts ON personal_tokens TYPE option<array<string>>;
DEFINE FIELD IF NOT EXISTS scope_kinds ON personal_tokens TYPE option<array<string>>;
DEFINE FIELD IF NOT EXISTS created_at ON personal_tokens TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS expires_at ON personal_tokens TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS revoked_at ON personal_tokens TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS last_used_at ON personal_tokens TYPE option<datetime>;
DEFINE INDEX IF NOT EXISTS personal_tokens_hash_unique ON personal_tokens FIELDS token_hash UNIQUE;
DEFINE INDEX IF NOT EXISTS personal_tokens_user ON personal_tokens FIELDS user;
