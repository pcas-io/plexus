# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.2] — 2026-04-27

First sync from the private prod fork (`enki-run/plexus`) per the
OSS-first workflow. Three changes that lived on prod for ~10 days
land back in OSS so the public surface stays the source of truth.

### Added

- **Self-describing registries** (`feat/self-describing-registries`,
  #1). Migration `0008_self_describing_registries.surql` populates
  `attributes_schema` per kind, `allowed_from_kinds` /
  `allowed_to_kinds` per relation, plus new `required_edge_groups`
  and `recommended_attributes` columns on `entity_kinds`. The
  registries now travel through `list_kinds` / `list_relations` /
  `context_load` so non-Claude LLM clients (Mistral Le Chat
  tested) can satisfy plexus conventions without reading a
  CLAUDE.md.
- `save_entity` enforces the registry contract: required
  attributes (with type/enum checks) and `required_edge_groups`
  (e.g. `decision` needs at least one
  `derived_from`/`triggered_by`/`supersedes`/`part_of` edge).
  New `related[]` parameter for atomic save+link satisfying edge
  groups in a single call (rolls back the entity if linking fails).
- `list_entities` and `search_entities` gain `attributes{}`
  (exact-match filter, AND'd), `has_relation{}` (filter by active
  edge — relation, target_id, direction), and `include_eval`
  (defaults `false` to hide self-eval snapshots).

### Fixed

- **`required_edge_groups` quirk on schemaful writes**
  (`fix/required-edge-groups-schemaful`, #2). Migration
  `0009_fix_required_edge_groups_value.surql`. After 0008 first
  shipped, `decision.required_edge_groups` came back as `[]`
  despite the migration setting `[{decision_context, …}]`. Two
  SurrealDB v2 quirks combined: `VALUE $value OR []` collapsed
  non-empty arrays, and `TYPE option<array<object>>` on a
  `SCHEMAFULL` table stripped keys from each array element. 0009
  re-defines both fields without `VALUE` and marks the
  array-of-object field `FLEXIBLE`. New integration test catches
  both quirks if either ever regresses.
- **`cleanupOrphanedClients` deleted active clients on restart**
  (`fix/oauth-cleanup-active-clients`, #3). The `id NOT IN
  (SELECT VALUE client …)` query is unreliable on SurrealDB v2
  for Thing-typed record references — older OAuth clients were
  classified as orphans and deleted on every startup. The query
  also never checked `oauth_refresh_tokens`, so a client whose
  access tokens had expired but whose refresh token was still
  valid would also be wiped. Fix: two-step lookup (candidates +
  every client referenced by access OR refresh tokens), set
  difference in JS. Five integration tests cover orphan deletion,
  active-refresh survival, revoked/expired retention, young-client
  grandfathering, mixed multi-client scenarios.

### Changed

- `package.json` and `server.json` bumped to `0.1.2`. MCP Registry
  entry `io.github.pcas-io/plexus` will be republished against the
  same tag.

### Tests

252 passing (243 → 252 across the three PRs).

## [0.1.1] — 2026-04-17

Post-release polish. Same day as 0.1.0, same public repo. Focus:
first-run experience, full English UI, MCP registry entry, and a
worked LLM-wiki ingest example so external readers see the idea
landing in code.

### Added

- `scripts/bootstrap_env.sh` — idempotent `.env` generator that
  replaces the four placeholder secrets in `.env.example` with
  fresh `openssl rand -hex` output. Refuses to overwrite an
  existing `.env` without `--force`, `chmod 600` on the output.
- `scripts/seed_demo.ts` — populates an empty instance with a
  neutral Apollo-program-themed graph (~18 entities, ~24 edges
  in a `demo` context) for screenshots and smoke-testing a fresh
  deployment. Uses the MCP SDK client, so it doubles as a
  reference implementation for external agent authors.
- `docker-compose.coolify.yml` — overlay that adds the external
  `coolify` network and the Traefik routing label on top of the
  default stack.
- `server.json` at the repo root — registered plexus in the
  official [MCP Registry](https://registry.modelcontextprotocol.io/)
  as `io.github.pcas-io/plexus` under the `streamable-http` remote
  transport.
- `docs/screenshots/` — five production screenshots (home, graph,
  entities search with BM25 highlighting, entity detail, help
  page) embedded at matching README sections.
- README: "Use cases" section with seven concrete scenarios
  (persistent memory, cross-agent handoff, team memory, decision
  archaeology, incident-to-fix loop, research digest, private
  second brain).
- README: "Agent system-prompt template" — a copy-pasteable block
  that drives any MCP-capable agent through the full plexus
  lifecycle (context_load → search → save → link → lint), with
  ADR discipline, handoff-fact schema, optimistic-locking rules,
  memory-routing (plexus vs. local scratchpad), and trigger-phrase
  → skill mapping.
- README: "Example: ingesting a source" — a worked Karpathy-style
  LLM-wiki ingest walked end-to-end against plexus MCP tools, with
  before/after graph shape.
- README: Contents TOC grouped into Understand / Run / Wire /
  Reference / Operate.

### Changed

- **Entire UI and help page translated to English.** 20+ files in
  `src/ui/pages/`, `src/ui/layout.ts`, and `src/routes/` had
  German labels, flash messages, button copy, and placeholder
  text that blocked the project from reading as an international
  OSS project. HTML `lang` attribute flipped from `de` to `en`.
- Help page rewritten with a "First run: the bootstrap" section
  that walks through the eight-step admin-creation flow and
  explains the token-rotation rationale.
- Default `docker-compose.yml` works out-of-the-box: worker
  publishes on `127.0.0.1:8787` (localhost-only so a DNS typo
  cannot accidentally expose the dashboard), no external networks
  required. The previous Coolify-coupled form moved to the new
  overlay file.
- README Quickstart spells out what each of the four generated
  secrets is for and points straight at the admin-token line
  with a copy-ready `grep` command; the first-run section lays
  out the eight bootstrap steps as a "what you do ↔ what plexus
  does" table.
- "Think of it as a wiki, but for LLMs" section now credits
  Andrej Karpathy's April-2026 "The LLM wiki" gist and maps its
  four pattern layers (raw sources / wiki / schema / ingest loop)
  one-to-one onto plexus primitives.

### Fixed

- **Passkey-enrollment loop** (`fc37dd0`). After a successful
  passkey enrollment, `sessions.create` crashed with
  `Found NULL for field 'ip'…but expected a option<string>`
  because SurrealDB v2 rejects explicit `null` on `option<T>`
  fields in a `CREATE ... CONTENT { … }` payload. The worker
  replied 401 to the browser, the browser went back to the login
  screen, the user re-entered the token, plexus again showed
  enrollment (because `passkeys.count` hit 0 on a fresh session),
  and the token rotated once more. Fix: build the CONTENT object
  dynamically, only include `ip` / `user_agent` when they have a
  concrete value.
- **WebAuthn rejected loopback origins** (`12f39e4`). Simplewebauthn
  strictly matches `expectedOrigin`; it treats `http://localhost`
  as secure but not `http://127.0.0.1`. If the server was
  configured for one spelling and the browser was opened with the
  other, enrollment failed with "Invalid request: insecure
  protocol". Fix: when `PLEXUS_BASE_URL` points at a loopback
  address, the WebAuthn service now accepts both spellings as an
  array.
- **`cp .env.example .env` on a fresh clone** (`96b9620`). The
  `.gitignore` rule `.env.*` swallowed the template. Added a
  negation so the template tracks, secrets stay ignored.
- **Demo-seed script bailed on the first entity** (`48bd973`).
  The seed parser expected `{ id: … }` but `save_entity` returns
  `{ entity: { id: … } }`. Fix: unwrap `parsed.entity?.id`.
- **Stray `nico` placeholder** in the bootstrap and user-create
  forms replaced with generic `admin` / `alice`.

### Registry

- Published to https://registry.modelcontextprotocol.io/ under the
  id `io.github.pcas-io/plexus`. One-shot flow: `brew install
  mcp-publisher`, `mcp-publisher login github`, `mcp-publisher
  publish`. Required making the `cosrv` membership in the
  `pcas-io` GitHub org public so the registry could verify
  ownership of the `io.github.pcas-io/` namespace.

## [0.1.0] — 2026-04-17

First public release under `pcas-io/plexus`, licensed Apache-2.0.

### Added

- Typed knowledge-graph core on SurrealDB v2 with 14 entity kinds and 20 relations.
- Model Context Protocol endpoint at `POST /mcp` with 15 tools covering entity CRUD, graph traversal, full-text search, skills, and graph-hygiene linting.
- OAuth 2.1 authorization server with mandatory PKCE S256, Dynamic Client Registration (RFC 7591), Resource Indicators (RFC 8707), and RFC 8414 / RFC 9728 discovery.
- Personal-token auth for first-party clients (`pt_…`) with scoped permissions (read/write/admin × contexts × kinds × expiry).
- WebAuthn-based dashboard authentication; passkeys required for every user, step-up required for share-link creation.
- Read-only dashboard with entity browse, BM25 search with highlighting, D3-force graph view, share-link UI, user/token/passkey/OAuth-client management, and an `/help` page.
- Share-links: single-use read-only tokens, three output formats (HTML/Markdown/JSON) behind one URL, step-up-protected creation, `kind=secret` hard-filtered.
- Full-text search with a BM25 analyzer (`plexus_text`) and optional highlighting via `<mark>` tags. Title weighted 2×.
- Temporal edges: every relation carries `valid_from` / `valid_to` / `confidence` / `source`; `unlink_entity` sets `valid_to = now` rather than deleting history. `get_related` supports `as_of` for point-in-time queries.
- Activity log for every graph-mutating MCP call and every auth / OAuth / share / session event.
- Admin backup endpoint emitting portable JSON; audit rows opt-in.
- Docker Compose deployment with a non-root worker image and an in-memory-ready SurrealDB container for tests.
- CI pipeline: typecheck, build, unit + integration tests against an ephemeral SurrealDB, `npm audit --omit=dev --audit-level=moderate` as a merge gate, `gitleaks` secret scan, and a clean Docker build.

### Security

- Markdown renderer hardened against control-character URL bypass; allow-listed URL parser; `rel="noopener nofollow ugc"` on every generated link.
- Attribute payload limited to 64 KB with prototype-key stripping against prototype pollution.
- Token generation uses rejection sampling over `base62` to eliminate modulo bias.
- Login error path returns a uniform `LOGIN_FAIL` to prevent user enumeration.
- Rate limiter uses deterministic `setInterval` cleanup (unref-ed) rather than probabilistic pruning.
- CSP header with pinned CDN and SRI hash for D3.
- Standard defensive headers: `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.

[Unreleased]: https://github.com/pcas-io/plexus/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/pcas-io/plexus/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/pcas-io/plexus/releases/tag/v0.1.0
