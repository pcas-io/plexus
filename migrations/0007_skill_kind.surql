-- Plexus v5 — Skill Kind
-- Migration: 0007_skill_kind
-- Registers the new `skill` kind so load_skill / list_skills can rely on
-- `kind = 'skill'` as a stable discriminator. Skills reuse the entities
-- table — no new table is created. Matches design
-- docs/superpowers/specs/2026-04-11-plexus-native-skill-library-design.md

INSERT IGNORE INTO entity_kinds [
    {
        name: 'skill',
        description: 'Reusable agent skill (Markdown instructions + trigger phrases). Loaded via the load_skill MCP tool. Can be authored by Skill Forge or seeded from migrations/seed_skills/.',
        module: 'core'
    }
];
