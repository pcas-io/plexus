-- Plexus v5 — Initial Schema
-- Migration: 0001_init
-- Creates: users, user_sessions, user_passkeys, entities, edges,
--          entity_kinds, relations, share_tokens, activity_log
-- All tables use SCHEMAFULL for deterministic shape + validation.

-- ============================================================
-- Users
-- ============================================================
DEFINE TABLE IF NOT EXISTS users SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS name ON users TYPE string ASSERT string::len($value) > 0;
DEFINE FIELD IF NOT EXISTS token_hash ON users TYPE string ASSERT string::len($value) = 64;
DEFINE FIELD IF NOT EXISTS is_active ON users TYPE bool DEFAULT true;
DEFINE FIELD IF NOT EXISTS is_admin ON users TYPE bool DEFAULT false;
DEFINE FIELD IF NOT EXISTS created_at ON users TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS updated_at ON users TYPE datetime VALUE time::now();
DEFINE INDEX IF NOT EXISTS users_name_unique ON users FIELDS name UNIQUE;
DEFINE INDEX IF NOT EXISTS users_token_hash_unique ON users FIELDS token_hash UNIQUE;
DEFINE INDEX IF NOT EXISTS users_active ON users FIELDS is_active;

-- ============================================================
-- User Sessions (Dashboard logins)
-- ============================================================
DEFINE TABLE IF NOT EXISTS user_sessions SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS user ON user_sessions TYPE record<users>;
DEFINE FIELD IF NOT EXISTS session_token_hash ON user_sessions TYPE string;
DEFINE FIELD IF NOT EXISTS ip ON user_sessions TYPE option<string>;
DEFINE FIELD IF NOT EXISTS user_agent ON user_sessions TYPE option<string>;
DEFINE FIELD IF NOT EXISTS created_at ON user_sessions TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS expires_at ON user_sessions TYPE datetime;
DEFINE FIELD IF NOT EXISTS last_active_at ON user_sessions TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS revoked_at ON user_sessions TYPE option<datetime>;
DEFINE INDEX IF NOT EXISTS sessions_token_hash_unique ON user_sessions FIELDS session_token_hash UNIQUE;
DEFINE INDEX IF NOT EXISTS sessions_user ON user_sessions FIELDS user;

-- ============================================================
-- User Passkeys (WebAuthn credentials) — populated in Schritt 2b
-- ============================================================
DEFINE TABLE IF NOT EXISTS user_passkeys SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS user ON user_passkeys TYPE record<users>;
DEFINE FIELD IF NOT EXISTS credential_id ON user_passkeys TYPE string;
DEFINE FIELD IF NOT EXISTS public_key ON user_passkeys TYPE string;
DEFINE FIELD IF NOT EXISTS counter ON user_passkeys TYPE int DEFAULT 0;
DEFINE FIELD IF NOT EXISTS transports ON user_passkeys TYPE option<array<string>>;
DEFINE FIELD IF NOT EXISTS device_name ON user_passkeys TYPE option<string>;
DEFINE FIELD IF NOT EXISTS created_at ON user_passkeys TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS last_used_at ON user_passkeys TYPE option<datetime>;
DEFINE INDEX IF NOT EXISTS passkeys_credential_id_unique ON user_passkeys FIELDS credential_id UNIQUE;
DEFINE INDEX IF NOT EXISTS passkeys_user ON user_passkeys FIELDS user;

-- ============================================================
-- Entity Kinds Registry
-- ============================================================
DEFINE TABLE IF NOT EXISTS entity_kinds SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS name ON entity_kinds TYPE string;
DEFINE FIELD IF NOT EXISTS description ON entity_kinds TYPE option<string>;
DEFINE FIELD IF NOT EXISTS attributes_schema ON entity_kinds TYPE object DEFAULT {};
DEFINE FIELD IF NOT EXISTS module ON entity_kinds TYPE string DEFAULT 'core';
DEFINE FIELD IF NOT EXISTS created_at ON entity_kinds TYPE datetime DEFAULT time::now();
DEFINE INDEX IF NOT EXISTS entity_kinds_name_unique ON entity_kinds FIELDS name UNIQUE;

-- ============================================================
-- Relations Registry
-- ============================================================
DEFINE TABLE IF NOT EXISTS relations SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS name ON relations TYPE string;
DEFINE FIELD IF NOT EXISTS description ON relations TYPE option<string>;
DEFINE FIELD IF NOT EXISTS allowed_from_kinds ON relations TYPE option<array<string>>;
DEFINE FIELD IF NOT EXISTS allowed_to_kinds ON relations TYPE option<array<string>>;
DEFINE FIELD IF NOT EXISTS cardinality ON relations TYPE string DEFAULT 'n:m';
DEFINE FIELD IF NOT EXISTS inverse ON relations TYPE option<string>;
DEFINE FIELD IF NOT EXISTS is_temporal ON relations TYPE bool DEFAULT true;
DEFINE FIELD IF NOT EXISTS module ON relations TYPE string DEFAULT 'core';
DEFINE FIELD IF NOT EXISTS created_at ON relations TYPE datetime DEFAULT time::now();
DEFINE INDEX IF NOT EXISTS relations_name_unique ON relations FIELDS name UNIQUE;

-- ============================================================
-- Entities (core graph table)
-- ============================================================
DEFINE TABLE IF NOT EXISTS entities SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS kind ON entities TYPE string;
DEFINE FIELD IF NOT EXISTS title ON entities TYPE string;
DEFINE FIELD IF NOT EXISTS body ON entities TYPE option<string>;
DEFINE FIELD IF NOT EXISTS attributes ON entities TYPE object DEFAULT {};
DEFINE FIELD IF NOT EXISTS context ON entities TYPE string;
DEFINE FIELD IF NOT EXISTS status ON entities TYPE string DEFAULT 'active';
DEFINE FIELD IF NOT EXISTS version ON entities TYPE int DEFAULT 1;
DEFINE FIELD IF NOT EXISTS created_at ON entities TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS updated_at ON entities TYPE datetime VALUE time::now();
DEFINE FIELD IF NOT EXISTS created_by ON entities TYPE option<record<users>>;
DEFINE FIELD IF NOT EXISTS updated_by ON entities TYPE option<record<users>>;
DEFINE INDEX IF NOT EXISTS entities_kind_context_status ON entities FIELDS kind, context, status;
DEFINE INDEX IF NOT EXISTS entities_context ON entities FIELDS context;
DEFINE INDEX IF NOT EXISTS entities_kind ON entities FIELDS kind;

-- ============================================================
-- Edges (graph relationships, temporal-first)
-- ============================================================
DEFINE TABLE IF NOT EXISTS edges SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS from_entity ON edges TYPE record<entities>;
DEFINE FIELD IF NOT EXISTS to_entity ON edges TYPE record<entities>;
DEFINE FIELD IF NOT EXISTS relation ON edges TYPE string;
DEFINE FIELD IF NOT EXISTS properties ON edges TYPE object DEFAULT {};
DEFINE FIELD IF NOT EXISTS confidence ON edges TYPE float DEFAULT 1.0;
DEFINE FIELD IF NOT EXISTS source ON edges TYPE string DEFAULT 'manual';
DEFINE FIELD IF NOT EXISTS valid_from ON edges TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS valid_to ON edges TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS created_at ON edges TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS created_by ON edges TYPE option<record<users>>;
DEFINE INDEX IF NOT EXISTS edges_from ON edges FIELDS from_entity, relation;
DEFINE INDEX IF NOT EXISTS edges_to ON edges FIELDS to_entity, relation;
DEFINE INDEX IF NOT EXISTS edges_temporal ON edges FIELDS valid_from, valid_to;

-- ============================================================
-- Share Tokens — Dashboard only, NEVER via MCP
-- ============================================================
DEFINE TABLE IF NOT EXISTS share_tokens SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS token_hash ON share_tokens TYPE string;
DEFINE FIELD IF NOT EXISTS entity ON share_tokens TYPE record<entities>;
DEFINE FIELD IF NOT EXISTS created_by ON share_tokens TYPE record<users>;
DEFINE FIELD IF NOT EXISTS created_at ON share_tokens TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS expires_at ON share_tokens TYPE datetime;
DEFINE FIELD IF NOT EXISTS consumed_at ON share_tokens TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS consumed_ip ON share_tokens TYPE option<string>;
DEFINE FIELD IF NOT EXISTS consumed_ua ON share_tokens TYPE option<string>;
DEFINE FIELD IF NOT EXISTS revoked_at ON share_tokens TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS revoked_by ON share_tokens TYPE option<record<users>>;
DEFINE FIELD IF NOT EXISTS note ON share_tokens TYPE option<string>;
DEFINE FIELD IF NOT EXISTS passkey_device_id ON share_tokens TYPE option<string>;
DEFINE INDEX IF NOT EXISTS share_tokens_hash_unique ON share_tokens FIELDS token_hash UNIQUE;
DEFINE INDEX IF NOT EXISTS share_tokens_entity ON share_tokens FIELDS entity;

-- ============================================================
-- Activity Log
-- ============================================================
DEFINE TABLE IF NOT EXISTS activity_log SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS timestamp ON activity_log TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS user_name ON activity_log TYPE option<string>;
DEFINE FIELD IF NOT EXISTS action ON activity_log TYPE string;
DEFINE FIELD IF NOT EXISTS target_type ON activity_log TYPE option<string>;
DEFINE FIELD IF NOT EXISTS target_id ON activity_log TYPE option<string>;
DEFINE FIELD IF NOT EXISTS ip ON activity_log TYPE option<string>;
DEFINE FIELD IF NOT EXISTS user_agent ON activity_log TYPE option<string>;
DEFINE FIELD IF NOT EXISTS outcome ON activity_log TYPE string DEFAULT 'success';
DEFINE FIELD IF NOT EXISTS metadata ON activity_log TYPE object DEFAULT {};
DEFINE INDEX IF NOT EXISTS activity_timestamp ON activity_log FIELDS timestamp;
DEFINE INDEX IF NOT EXISTS activity_user ON activity_log FIELDS user_name;
DEFINE INDEX IF NOT EXISTS activity_action ON activity_log FIELDS action;
