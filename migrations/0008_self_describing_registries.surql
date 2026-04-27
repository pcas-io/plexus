-- Plexus v5 — Self-describing Kinds & Relations
-- Migration: 0008_self_describing_registries
-- Populates attributes_schema per kind + allowed_from_kinds / allowed_to_kinds
-- per relation + new `required_edge_groups` field on entity_kinds.
--
-- Why: synthesis entity entities:2o2vqscphb4c2219m9iy (Mistral+Claude UX evals
-- 2026-04-21) showed that external LLM clients fail at handoff-facts and ADRs
-- because the plexus conventions live only in CLAUDE.md. Moving them into
-- list_kinds / list_relations responses makes the registry self-describing
-- and every LLM-native, without client-side prompt engineering.
--
-- Schema format (attributes_schema):
--   {
--     required:      [field, ...]        # hard enforce in save_entity
--     recommended:   [field, ...]        # hint only, surfaces via list_kinds
--     properties: {
--       field_name: { type, enum?, description? }
--     }
--   }
--
-- required_edge_groups format on entity_kinds:
--   [ { name, relations: [relation, ...], direction: 'out'|'in', min: 1 } ]
-- At save time, the entity must have at least `min` edges matching any of the
-- relations in the group. Example: decisions need ≥1 of
-- derived_from/triggered_by/supersedes/part_of (Pflicht-Edge from CLAUDE.md).

-- ============================================================
-- Schema additions on entity_kinds
-- ============================================================
-- option<> wrap is load-bearing: SurrealDB v2 SCHEMAFULL does NOT back-fill
-- DEFAULT values into rows that existed before the DEFINE FIELD ran. A plain
-- `array<...>` type would therefore reject any SELECT/UPDATE on old rows with
-- "Found NONE for field X, expected array<...>". Modeling the field as
-- option<array<...>> lets NONE be a valid stored value; the normKind helper
-- in registries.ts collapses NONE to []. New rows still get the explicit
-- default via VALUE.
DEFINE FIELD IF NOT EXISTS required_edge_groups ON entity_kinds TYPE option<array<object>> VALUE $value OR [];
DEFINE FIELD IF NOT EXISTS recommended_attributes ON entity_kinds TYPE option<array<string>> VALUE $value OR [];

-- Back-fill existing rows so list_kinds responses stay uniform.
UPDATE entity_kinds SET required_edge_groups = [] WHERE required_edge_groups = NONE;
UPDATE entity_kinds SET recommended_attributes = [] WHERE recommended_attributes = NONE;

-- ============================================================
-- Attribute schemas per kind
-- ============================================================

-- fact: atomic statements. Handoff-facts have their own hardened validator
-- (handoff_validation.ts) but we surface the expected attribute shape here
-- so fresh LLM clients discover it without reading CLAUDE.md.
UPDATE entity_kinds SET attributes_schema = {
    required: [],
    recommended: ['severity', 'outcome'],
    properties: {
        session_type: { type: 'string', enum: ['handoff', 'incident', 'milestone', 'review', 'eval'], description: 'Fact sub-type. Handoff-facts require session_date/session_id/agent_id and a part_of project edge.' },
        session_date: { type: 'string', description: 'ISO date (YYYY-MM-DD) or RFC 3339 timestamp. Required for handoffs.' },
        session_id: { type: 'string', description: 'Free-form but stable session handle. Required for handoffs.' },
        agent_id: { type: 'string', description: 'Agent identity (e.g. claude-opus-4-7, gpt-5, mesh agent id). Required for handoffs.' },
        git_branch: { type: 'string', description: 'Branch at session end. Optional, strongly recommended for dev-context handoffs.' },
        severity: { type: 'string', enum: ['info', 'low', 'medium', 'high', 'critical'], description: 'Impact severity. Required for incident-flavored facts.' },
        outcome: { type: 'string', description: 'What resulted / whether the problem was solved. Strongly recommended — lets future readers judge relevance without supersedes-chain traversal.' },
        next_review: { type: 'string', description: 'ISO date for the next planned review.' },
        is_eval: { type: 'boolean', description: 'True for self-evaluation facts (graph health, benchmark snapshots). Excluded from search_entities by default.' }
    }
} WHERE name = 'fact';

-- decision: ADRs. CLAUDE.md enforces the Pflicht-Edge.
UPDATE entity_kinds SET attributes_schema = {
    required: ['status'],
    recommended: ['adr_date', 'decision_type', 'outcome'],
    properties: {
        status: { type: 'string', enum: ['proposed', 'accepted', 'rejected', 'superseded'], description: 'Lifecycle state.' },
        adr_date: { type: 'string', description: 'ISO date the decision was taken.' },
        decision_type: { type: 'string', description: 'Classifier — e.g. architecture, workflow, graph-convention, system-deprecation.' },
        severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        chosen: { type: 'string', description: 'One-line summary of what was chosen.' },
        rejected: { type: 'string', description: 'What was considered and rejected.' },
        outcome: { type: 'string', description: 'Post-hoc observed outcome. Populate when the decision has been in effect long enough to judge.' },
        stakeholders: { type: 'array', description: 'Names/roles involved in the decision.' },
        revisit_trigger: { type: 'string', description: 'Condition under which this ADR should be re-opened.' },
        related_adr: { type: 'string', description: 'Entity id of a related ADR for cross-reference (prefer supersedes/derived_from edges over this attribute).' }
    }
}, required_edge_groups = [
    { name: 'decision_context', relations: ['derived_from', 'triggered_by', 'supersedes', 'part_of'], direction: 'out', min: 1 }
] WHERE name = 'decision';

-- task: actionable work items. No hard-required attrs — tasks are used very
-- freely — but priority/bucket/deadline carry the weight for filtered queries.
UPDATE entity_kinds SET attributes_schema = {
    required: [],
    recommended: ['priority', 'outcome'],
    properties: {
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        bucket: { type: 'string', description: 'Planning bucket — e.g. burn-in, backlog, doing, blocked.' },
        deadline: { type: 'string', description: 'ISO date.' },
        source: { type: 'string', description: 'Origin marker — e.g. adr-foo-2026-04-13, pre-mortem, user-request.' },
        category: { type: 'string', description: 'Optional classifier — e.g. adr, ops, refactor, feature.' },
        effort: { type: 'string', enum: ['XS', 'S', 'M', 'L', 'XL'] },
        is_milestone: { type: 'boolean' },
        outcome: { type: 'string', description: 'Result after completion. Populate when status→done so later readers can judge impact.' },
        stakeholders: { type: 'array' }
    }
} WHERE name = 'task';

-- document: covers runbooks, PRDs, post-mortems, meeting protocols.
UPDATE entity_kinds SET attributes_schema = {
    required: ['document_type'],
    recommended: ['owner'],
    properties: {
        document_type: { type: 'string', enum: ['runbook', 'prd', 'post-mortem', 'pre-mortem', 'adr-notes', 'meeting-protocol', 'design', 'spec', 'usability_report', 'test_report', 'post-mortem-notes', 'lessons-learned'] },
        owner: { type: 'string' },
        category: { type: 'string', description: 'Domain classifier — e.g. identity, ops, security.' },
        risk_level: { type: 'string', enum: ['low', 'medium', 'high'] },
        reversible: { type: 'boolean' },
        triggered_by: { type: 'string', description: 'Prefer an edge of the same name over this attribute.' }
    }
} WHERE name = 'document';

-- config: URLs, UUIDs, secret-store pointers.
UPDATE entity_kinds SET attributes_schema = {
    required: [],
    recommended: ['url'],
    properties: {
        url: { type: 'string' },
        is_sensitive: { type: 'boolean', description: 'True if this config contains secret references. Value itself must stay in the external secret store (ADR: kind=secret is blocked in MCP).' },
        secret_store_pointer: { type: 'string', description: 'Path/URI to the external secret store entry.' }
    }
} WHERE name = 'config';

-- project: top-level containers.
UPDATE entity_kinds SET attributes_schema = {
    required: [],
    recommended: ['status'],
    properties: {
        status: { type: 'string', enum: ['active', 'paused', 'archived'] },
        owner: { type: 'string' },
        live_since: { type: 'string', description: 'ISO date of production go-live.' },
        live_url: { type: 'string' },
        url: { type: 'string' }
    }
} WHERE name = 'project';

-- concept: general knowledge, patterns, ideas.
UPDATE entity_kinds SET attributes_schema = {
    required: [],
    recommended: [],
    properties: {
        status: { type: 'string', description: 'Free-form lifecycle marker.' },
        tags: { type: 'array' }
    }
} WHERE name = 'concept';

-- inbox_item: GTD captures.
UPDATE entity_kinds SET attributes_schema = {
    required: [],
    recommended: ['status'],
    properties: {
        status: { type: 'string', enum: ['inbox', 'next', 'waiting', 'done', 'discarded'] },
        priority: { type: 'string', enum: ['low', 'medium', 'high'] }
    }
} WHERE name = 'inbox_item';

-- template: reusable patterns.
UPDATE entity_kinds SET attributes_schema = {
    required: [],
    recommended: [],
    properties: {
        category: { type: 'string' },
        version: { type: 'string' }
    }
} WHERE name = 'template';

-- note: free-form, no constraints.
UPDATE entity_kinds SET attributes_schema = {
    required: [],
    recommended: [],
    properties: {}
} WHERE name = 'note';

-- ============================================================
-- Relation allowed_from_kinds / allowed_to_kinds
-- ============================================================
-- Non-null lists serve as documentation + soft validation hint.
-- Current link_entities does not enforce kind pairs yet — only surfaces them
-- to LLM clients via list_relations. Hard enforcement is a separate task
-- (tracked as recommended follow-up in the synthesis concept). Relations
-- that should stay "any kind" are left as NONE via UNSET so the field
-- matches its option<array<string>> declaration (NONE, not NULL).
UPDATE relations SET allowed_to_kinds = ['project'] WHERE name = 'part_of';
UPDATE relations SET allowed_from_kinds = ['project'] WHERE name = 'contains';
UPDATE relations SET allowed_from_kinds = ['document'] WHERE name = 'documents';
UPDATE relations SET allowed_to_kinds = ['document'] WHERE name = 'documented_by';
UPDATE relations SET allowed_from_kinds = ['task', 'fact'], allowed_to_kinds = ['decision', 'concept', 'document'] WHERE name = 'implements';
