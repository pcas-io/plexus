-- Plexus v5 — OAuth 2.1 Schema
-- Migration: 0004_oauth
-- Implements ADR 01KNFQ060M7F2MVC4BFZ18CN6N (Plexus OAuth 2.1 für Remote-MCP-Clients).
--
-- Security invariants:
--   - Raw tokens are NEVER stored; only sha256 hashes.
--   - Auth codes are one-time and short-lived (10 min).
--   - Access tokens are 1h, refresh tokens 30d.
--   - PKCE S256 is required; code_challenge is bound to the auth code.
--   - resource indicator (RFC 8707) is persisted and re-checked on token use.

-- ============================================================
-- OAuth Clients (Dynamic Client Registration, RFC 7591)
-- ============================================================
DEFINE TABLE IF NOT EXISTS oauth_clients SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS client_id ON oauth_clients TYPE string ASSERT string::len($value) > 0;
DEFINE FIELD IF NOT EXISTS client_name ON oauth_clients TYPE string;
DEFINE FIELD IF NOT EXISTS redirect_uris ON oauth_clients TYPE array<string>;
DEFINE FIELD IF NOT EXISTS grant_types ON oauth_clients TYPE array<string> DEFAULT ['authorization_code', 'refresh_token'];
DEFINE FIELD IF NOT EXISTS response_types ON oauth_clients TYPE array<string> DEFAULT ['code'];
DEFINE FIELD IF NOT EXISTS token_endpoint_auth_method ON oauth_clients TYPE string DEFAULT 'none';
DEFINE FIELD IF NOT EXISTS created_at ON oauth_clients TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS created_ip ON oauth_clients TYPE option<string>;
DEFINE FIELD IF NOT EXISTS created_ua ON oauth_clients TYPE option<string>;
DEFINE INDEX IF NOT EXISTS oauth_clients_client_id_unique ON oauth_clients FIELDS client_id UNIQUE;

-- ============================================================
-- OAuth Authorization Codes (RFC 6749 §4.1 + PKCE RFC 7636)
-- ============================================================
DEFINE TABLE IF NOT EXISTS oauth_auth_codes SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS code_hash ON oauth_auth_codes TYPE string ASSERT string::len($value) = 64;
DEFINE FIELD IF NOT EXISTS client ON oauth_auth_codes TYPE record<oauth_clients>;
DEFINE FIELD IF NOT EXISTS user ON oauth_auth_codes TYPE record<users>;
DEFINE FIELD IF NOT EXISTS redirect_uri ON oauth_auth_codes TYPE string;
DEFINE FIELD IF NOT EXISTS code_challenge ON oauth_auth_codes TYPE string;
DEFINE FIELD IF NOT EXISTS code_challenge_method ON oauth_auth_codes TYPE string ASSERT $value = 'S256';
DEFINE FIELD IF NOT EXISTS scope ON oauth_auth_codes TYPE string DEFAULT 'mcp';
DEFINE FIELD IF NOT EXISTS resource ON oauth_auth_codes TYPE option<string>;
DEFINE FIELD IF NOT EXISTS created_at ON oauth_auth_codes TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS expires_at ON oauth_auth_codes TYPE datetime;
DEFINE FIELD IF NOT EXISTS consumed_at ON oauth_auth_codes TYPE option<datetime>;
DEFINE INDEX IF NOT EXISTS oauth_auth_codes_hash_unique ON oauth_auth_codes FIELDS code_hash UNIQUE;

-- ============================================================
-- OAuth Access Tokens (ot_*)
-- ============================================================
DEFINE TABLE IF NOT EXISTS oauth_access_tokens SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS token_hash ON oauth_access_tokens TYPE string ASSERT string::len($value) = 64;
DEFINE FIELD IF NOT EXISTS client ON oauth_access_tokens TYPE record<oauth_clients>;
DEFINE FIELD IF NOT EXISTS user ON oauth_access_tokens TYPE record<users>;
DEFINE FIELD IF NOT EXISTS scope ON oauth_access_tokens TYPE string DEFAULT 'mcp';
DEFINE FIELD IF NOT EXISTS resource ON oauth_access_tokens TYPE option<string>;
DEFINE FIELD IF NOT EXISTS created_at ON oauth_access_tokens TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS expires_at ON oauth_access_tokens TYPE datetime;
DEFINE FIELD IF NOT EXISTS revoked_at ON oauth_access_tokens TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS last_used_at ON oauth_access_tokens TYPE option<datetime>;
DEFINE INDEX IF NOT EXISTS oauth_access_tokens_hash_unique ON oauth_access_tokens FIELDS token_hash UNIQUE;
DEFINE INDEX IF NOT EXISTS oauth_access_tokens_user ON oauth_access_tokens FIELDS user;

-- ============================================================
-- OAuth Refresh Tokens (or_*)
-- ============================================================
DEFINE TABLE IF NOT EXISTS oauth_refresh_tokens SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS token_hash ON oauth_refresh_tokens TYPE string ASSERT string::len($value) = 64;
DEFINE FIELD IF NOT EXISTS client ON oauth_refresh_tokens TYPE record<oauth_clients>;
DEFINE FIELD IF NOT EXISTS user ON oauth_refresh_tokens TYPE record<users>;
DEFINE FIELD IF NOT EXISTS scope ON oauth_refresh_tokens TYPE string DEFAULT 'mcp';
DEFINE FIELD IF NOT EXISTS resource ON oauth_refresh_tokens TYPE option<string>;
DEFINE FIELD IF NOT EXISTS created_at ON oauth_refresh_tokens TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS expires_at ON oauth_refresh_tokens TYPE datetime;
DEFINE FIELD IF NOT EXISTS revoked_at ON oauth_refresh_tokens TYPE option<datetime>;
DEFINE INDEX IF NOT EXISTS oauth_refresh_tokens_hash_unique ON oauth_refresh_tokens FIELDS token_hash UNIQUE;
DEFINE INDEX IF NOT EXISTS oauth_refresh_tokens_user ON oauth_refresh_tokens FIELDS user;
