-- Plexus v5 — Allow arbitrary JSON in attributes/properties fields
-- Migration: 0003_flexible_json_fields
--
-- In SurrealDB v2 SCHEMAFULL tables a field defined as `TYPE object` with
-- no sub-field definitions accepts only an empty object: any properties
-- sent by the client are silently dropped because they are not part of
-- the declared schema. The `FLEXIBLE` qualifier tells SurrealDB to accept
-- any JSON structure in this field.
--
-- Uses OVERWRITE because the previous definition already exists from
-- migration 0001 and SurrealDB v2 refuses a plain DEFINE FIELD on an
-- existing field.

DEFINE FIELD OVERWRITE attributes ON entities FLEXIBLE TYPE object DEFAULT {};

DEFINE FIELD OVERWRITE properties ON edges FLEXIBLE TYPE object DEFAULT {};

DEFINE FIELD OVERWRITE attributes_schema ON entity_kinds FLEXIBLE TYPE object DEFAULT {};

DEFINE FIELD OVERWRITE metadata ON activity_log FLEXIBLE TYPE object DEFAULT {};
