-- Plexus v5 — Fix required_edge_groups storage
-- Migration: 0009_fix_required_edge_groups_value
-- Two bugs in 0008 surfaced on the live deploy:
--   1. `VALUE $value OR []` collapsed non-empty arrays in SurrealDB v2.
--   2. `TYPE option<array<object>>` on a SCHEMAFULL table stripped all
--      keys from the object array elements — writes like
--      `[{name, relations, direction, min}]` round-tripped to `[{}]`.
-- Fix: REMOVE + re-DEFINE the two registry fields without the VALUE
-- clause AND with FLEXIBLE on the array-of-object field so per-element
-- properties survive the write.

REMOVE FIELD IF EXISTS required_edge_groups ON entity_kinds;
REMOVE FIELD IF EXISTS recommended_attributes ON entity_kinds;

DEFINE FIELD required_edge_groups ON entity_kinds FLEXIBLE TYPE option<array<object>> DEFAULT [];
DEFINE FIELD recommended_attributes ON entity_kinds TYPE option<array<string>> DEFAULT [];

-- Back-fill rows that lost the field in the REMOVE/DEFINE cycle.
UPDATE entity_kinds SET required_edge_groups = []
  WHERE required_edge_groups = NONE OR required_edge_groups IS NULL;
UPDATE entity_kinds SET recommended_attributes = []
  WHERE recommended_attributes = NONE OR recommended_attributes IS NULL;

-- Re-assert the decision Pflicht-Edge group so list_kinds returns the
-- payload LLM clients expect.
UPDATE entity_kinds SET required_edge_groups = [
    { name: 'decision_context', relations: ['derived_from', 'triggered_by', 'supersedes', 'part_of'], direction: 'out', min: 1 }
] WHERE name = 'decision';
