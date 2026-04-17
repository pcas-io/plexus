-- Plexus v5 — Seed Kinds & Relations Registry
-- Migration: 0002_seed_kinds_relations
-- Populates the entity_kinds and relations registries with the v1 core set.

-- ============================================================
-- Entity Kinds — Core Set v1
-- ============================================================
INSERT IGNORE INTO entity_kinds [
    { name: 'concept', description: 'Abstract concept or idea', module: 'core' },
    { name: 'decision', description: 'Architecture Decision Record or general decision', module: 'core' },
    { name: 'fact', description: 'Atomic factual statement', module: 'core' },
    { name: 'config', description: 'Configuration values and URLs', module: 'core' },
    { name: 'secret', description: 'Encrypted secret', module: 'core' },
    { name: 'template', description: 'Reusable template or pattern', module: 'core' },
    { name: 'project', description: 'Project container', module: 'core' },
    { name: 'task', description: 'Actionable work item', module: 'core' },
    { name: 'document', description: 'Document with approval workflow', module: 'core' },
    { name: 'note', description: 'Free-form note', module: 'core' },
    { name: 'inbox_item', description: 'GTD inbox capture', module: 'core' },
    { name: 'user', description: 'User reference', module: 'core' },
    { name: 'tag', description: 'Categorization tag', module: 'core' }
];

-- ============================================================
-- Relations — Core Set v1
-- ============================================================
INSERT IGNORE INTO relations [
    { name: 'contains', description: 'X contains Y', cardinality: '1:n', inverse: 'part_of', module: 'core' },
    { name: 'part_of', description: 'X is part of Y', cardinality: 'n:1', inverse: 'contains', module: 'core' },
    { name: 'relates_to', description: 'Generic soft relation', cardinality: 'n:m', module: 'core' },
    { name: 'depends_on', description: 'X requires Y', cardinality: 'n:m', module: 'core' },
    { name: 'blocks', description: 'X blocks Y', cardinality: 'n:m', module: 'core' },
    { name: 'supersedes', description: 'X replaces Y', cardinality: '1:1', inverse: 'superseded_by', module: 'core' },
    { name: 'superseded_by', description: 'X was replaced by Y', cardinality: '1:1', inverse: 'supersedes', module: 'core' },
    { name: 'documented_by', description: 'X is documented by Y', cardinality: 'n:m', inverse: 'documents', module: 'core' },
    { name: 'documents', description: 'X documents Y', cardinality: 'n:m', inverse: 'documented_by', module: 'core' },
    { name: 'implements', description: 'X implements Y', cardinality: 'n:m', module: 'core' },
    { name: 'produces', description: 'X produces Y as output', cardinality: 'n:m', inverse: 'produced_by', module: 'core' },
    { name: 'produced_by', description: 'X was produced by Y', cardinality: 'n:m', inverse: 'produces', module: 'core' },
    { name: 'consumes', description: 'X consumes Y as input', cardinality: 'n:m', module: 'core' },
    { name: 'mentions', description: 'X mentions Y', cardinality: 'n:m', module: 'core' },
    { name: 'derived_from', description: 'X is derived from Y', cardinality: 'n:m', module: 'core' },
    { name: 'triggered_by', description: 'X was triggered by Y', cardinality: 'n:m', module: 'core' },
    { name: 'has_version', description: 'X has version Y', cardinality: '1:n', module: 'core' },
    { name: 'variant_of', description: 'X is a variant of Y', cardinality: 'n:m', module: 'core' },
    { name: 'executed_by', description: 'X is executed by role Y', cardinality: 'n:m', module: 'core' },
    { name: 'owned_by', description: 'X is owned by Y', cardinality: 'n:m', module: 'core' }
];
