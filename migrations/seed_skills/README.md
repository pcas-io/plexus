# Seed Skills

Markdown files here are the canonical source of the nine buddy-v3-derived
skills plexus ships with. Each file has YAML frontmatter plus a Markdown body.

**Frontmatter schema:**

- name: 5-whys            (required, kebab-case, unique)
- description: one-liner  (required)
- version: v1.0.0         (required, semver-ish — see src/mcp/semver.ts)
- category: analysis      (optional)
- trigger_phrases:        (optional list)
  - "5 Whys"
  - "Root Cause"

**How to import:**

    npx tsx scripts/import_seed_skills.ts --context dev

The script is idempotent: it checks for an existing skill with the same
`name` in the target context and skips it if found. Archive the existing
skill via the dashboard to force a re-import.

**Adding a new skill:** drop a new .md file in this directory and re-run
the import. Or, better, write it into plexus via save_entity directly —
files here are a bootstrapping convenience, not the long-term source of truth.
