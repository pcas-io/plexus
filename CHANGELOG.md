# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/pcas-io/plexus/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/pcas-io/plexus/releases/tag/v0.1.0
