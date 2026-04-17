# plexus (_graph)

**A typed, on-prem knowledge graph for AI agents. Read-only for humans, write-only for agents, spoken over the Model Context Protocol.**

Part of the [pcas.io](https://pcas.io) product line.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-informational)](./package.json)
[![CI](https://github.com/pcas-io/plexus/actions/workflows/ci.yml/badge.svg)](https://github.com/pcas-io/plexus/actions/workflows/ci.yml)

---

## TL;DR

Knowledge management has been a document sport for twenty years — folders, notes, wikis, editor wars. plexus inverts that.

In plexus, every piece of information is a **typed entity** — `concept`, `decision`, `fact`, `project`, `task`, `document`, `skill`, … — with **hard, temporally-valid edges** between them. No free-form text, no forgotten tags, no "I'll clean that up later." Writing and linking happen **exclusively through MCP** — from your agent. The dashboard shows you the graph; it has **no edit buttons**.

That gets you three things:

1. Your agent doesn't have to ask you — it just builds, with strict kind-and-relation discipline.
2. The wiki never goes stale, because lint, supersede, and provenance are part of the workflow.
3. You can share a single idea, not your graph — passkey-gated one-shot links that burn on first click.

Runs in Docker Compose on your own hardware. Apache-2.0 licensed.

---

## Quickstart

```bash
# 1. Clone
git clone https://github.com/pcas-io/plexus.git
cd plexus

# 2. Configure — writes .env with fresh 32-byte secrets for all four
#    required fields (admin token, OAuth/cookie secrets, SurrealDB password).
scripts/bootstrap_env.sh

# 3. Start
docker compose up -d

# 4. Open the dashboard
open http://localhost:8787
```

Full configuration reference is in [`.env.example`](./.env.example). Deployment notes for Coolify, plain Docker, and Kubernetes are below.

---

## First run — the bootstrap flow

plexus boots on an empty database with no user. The `PLEXUS_ADMIN_TOKEN` from your `.env` is used **once** to create the first admin account, then steps aside.

1. Open the dashboard (`http://localhost:8787` by default). plexus notices there is no user yet and redirects to `/bootstrap`.
2. Enter an admin name (letters, digits, `_`, `-`, `.`). Submit. The admin token is matched via the login-cookie path — you never paste it into the browser.
3. plexus creates the admin user and shows a personal token (`pt_…`) **exactly once**. Copy it into a password manager right now.
4. Click **Continue to login**. You land on `/auth/login`.
5. Paste the `pt_` token. plexus sees you have no passkey yet and shows the enrollment screen.
6. Click **Register passkey now** — confirm with Touch ID / Face ID / Windows Hello / YubiKey.
7. plexus **automatically rotates the token** and shows the new one. The initial token is now dead. Overwrite your password-manager entry with the new token.
8. Click **Sign in with new token**. Paste the new token, tap the passkey again — you land on `/home`.

After this one-time setup, `PLEXUS_ADMIN_TOKEN` is only used for admin-plane endpoints (backup, reset). It is **rejected on MCP** and on dashboard login.

**Why the rotation?** The initial token is a one-shot invitation code. If anything intercepted it during handoff — mail, chat, a screen share — rotation makes that capture worthless the moment you sign in. For additional users you create later via `/users`, the same admin→user handoff + first-enroll rotation protects them the same way.

After the bootstrap, the `/help` page inside the dashboard covers everything else: MCP integration, token scoping, passkey management, share links, graph view.

---

## Connecting an agent

plexus speaks **Model Context Protocol** over `POST /mcp`. Any MCP-capable client can connect.

### Claude.ai (web)

Settings → Integrations → Add Custom Integration → `https://<your-plexus-host>/mcp`. plexus handles OAuth automatically — you'll see a consent screen once.

### Claude Code (CLI)

```bash
claude mcp add plexus --transport http \
  --header "Authorization: Bearer pt_YOUR_TOKEN" \
  https://<your-plexus-host>/mcp
```

### Claude Desktop

In `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "plexus": {
      "type": "http",
      "url": "https://<your-plexus-host>/mcp",
      "headers": { "Authorization": "Bearer pt_YOUR_TOKEN" }
    }
  }
}
```

---

## MCP tools

plexus exposes 15 tools.

| Tool | Purpose | Scope |
|---|---|---|
| `save_entity` | Create a new entity | write |
| `get_entity` | Fetch a single entity by id | read |
| `list_entities` | List with filters (kind, context, status) | read |
| `search_entities` | BM25-ranked full-text search with optional highlighting | read |
| `update_entity` | Update with optimistic locking (`expected_version`) | write |
| `archive_entity` | Soft-delete (status → archived) | write |
| `link_entities` | Create a temporal edge between two entities | write |
| `unlink_entity` | Invalidate an edge (`valid_to = now`) | write |
| `get_related` | Traverse edges with direction + point-in-time filter | read |
| `list_kinds` | Query the kind registry | read |
| `list_relations` | Query the relation registry | read |
| `context_load` | Session warm-up — 20 most recent entities + registries | read |
| `lint_graph` | Orphans + duplicate-title check | read |
| `list_skills` | Compact index of all skills | read |
| `load_skill` | Load one skill by name, trigger phrase, or BM25 fallback | read |

Every tool enforces scope at the handler boundary: `requireWrite()`, `checkContext()`, `checkKind()`, and `rejectSecret()`. `kind=secret` is unreachable via MCP and filtered out of every read response.

---

## What the graph knows

### Kinds

| Kind | Meaning |
|---|---|
| `concept` | Abstract knowledge, pattern |
| `decision` | Architecture Decision Record |
| `fact` | Atomic statement, incident, milestone |
| `project` | Container |
| `task` | Work item (attribute `is_milestone` for milestones) |
| `document` | Design doc, runbook, post-mortem, protocol |
| `note` | Source, provenance anchor |
| `template` | Reusable pattern |
| `config` | URL, environment variable |
| `secret` | Credential — MCP-unreachable, dashboard-only with step-up passkey |
| `inbox_item` | GTD quick-capture |
| `user` | User reference |
| `tag` | Categorization |
| `skill` | Markdown skill with trigger phrases, loaded via `load_skill` |

### Relations

`contains` / `part_of` · `relates_to` · `depends_on` / `blocks` · `supersedes` / `superseded_by` · `documents` / `documented_by` · `implements` · `produces` / `produced_by` · `consumes` · `mentions` · `derived_from` · `triggered_by` · `has_version` · `variant_of` · `executed_by` · `owned_by`

Every edge carries `valid_from`, `valid_to`, `confidence`, and `source` (`manual` / `llm-inferred` / `computed` / `imported`). `unlink_entity` sets `valid_to = now`; the edge survives as history. `get_related(as_of: …)` gives you the graph state at any point in the past.

---

## Authentication

### For humans: passkeys

The dashboard is passkey-only. Token + passkey at first login rotates the token automatically — the initial token is a one-shot invitation code that dies on enrollment. Up to 3 passkeys per user (laptop, phone, hardware key); the last one cannot be deleted.

### For agents: personal tokens and OAuth

**Personal tokens** (`pt_…`) are first-party, self-service tokens issued from the dashboard with an explicit scope: `permission × contexts × kinds × expires_in_days`. Use them for `claude code`, CLI automation, or any MCP client you trust with a long-lived credential.

**OAuth 2.1 tokens** (`ot_…`) are for third-party MCP clients. plexus ships a full authorization server:

- Discovery via RFC 8414 (Authorization Server Metadata) and RFC 9728 (Protected Resource Metadata).
- Dynamic Client Registration (RFC 7591).
- PKCE with `S256` is **mandatory**; `plain` is rejected by schema and code.
- Resource indicators (RFC 8707) on both authorize and token endpoints.
- Exact-match redirect-URI comparison in constant time.
- Token rotation on refresh — the old refresh token is revoked the moment a new one is issued, enabling compromise detection.

Admin tokens are rejected on `/mcp` with a hard 403. There is no "just use the admin token" escape hatch.

---

## Sharing

You can share a single entity as a read-only one-shot link, without handing out your graph.

1. Open the entity in the dashboard. Click **Share**.
2. Step-up passkey prompt with purpose-binding (`stepup:share:<userId>`) — a share challenge cannot be replayed as a reset challenge.
3. plexus issues a 32-byte `st_` token. Only the SHA-256 hash is stored. The URL is shown once.
4. The recipient opens `GET /share/:token` — no login required, rate-limited, read-only.
5. Second call returns `410 Gone`. You can revoke at any time.

One share URL, three formats:

| URL | Content-Type | Use |
|---|---|---|
| `/share/:token` | `text/html` | Browser |
| `/share/:token?raw` | `text/markdown` | Pipe to an LLM or `glow` |
| `/share/:token?raw=json` | `application/json` | `jq`-friendly automation |

`kind=secret` entities cannot be shared — the check happens **before** token creation.

---

## Search

`search_entities` runs on a SurrealDB BM25 index with a custom analyzer (`plexus_text`):

- `blank` + `class` tokenizers, `lowercase` + `ascii` filters (Unicode-to-ASCII folding — `ü` matches `u`, `ß` matches `ss`).
- Two indexes: `entities_title_search` and `entities_body_search`.
- Ranking: `search::score(0) * 2 + search::score(1)` — title weighs twice.
- Optional highlighting wraps matches in `<mark>` tags.
- Optional `body_preview_chars` (0–2000) to cap response size — recommended for wide queries.

---

## Architecture

```
┌──────────────────────────────────────────────┐
│  agents (Claude web / CLI / Desktop / ...)   │
└───────────────┬──────────────────────────────┘
                │ MCP over HTTPS + Bearer token
                ▼
┌──────────────────────────────────────────────┐
│  plexus worker (Hono + TypeScript, Node 22)  │
│  ├─ POST /mcp      — MCP tool dispatcher     │
│  ├─ /oauth/*       — OAuth 2.1 AS + PRM      │
│  ├─ /auth/*        — WebAuthn passkey flow   │
│  ├─ /share/:token  — one-shot read links     │
│  ├─ /dashboard     — read-only human UI      │
│  └─ /admin/backup  — portable JSON export    │
└───────────────┬──────────────────────────────┘
                │ SurrealQL
                ▼
┌──────────────────────────────────────────────┐
│  SurrealDB v2 (RocksDB, persistent volume)   │
│  entities · edges · registries · activity    │
└──────────────────────────────────────────────┘
```

### Source layout

```
src/
├── index.ts              # HTTP bootstrap, CSP, security headers
├── auth/                 # passkeys, sessions, CORS allow-list
├── db/                   # SurrealDB client, repositories, util
├── mcp/                  # MCP tool handlers, skill tools, dispatcher
├── routes/               # dashboard, oauth, shares, admin, well-known
├── ui/                   # layout, styles, pages, markdown renderer
├── backup.ts             # portable JSON export
└── version.ts            # build-embedded version string
migrations/               # SurrealDB schema in migration order
scripts/                  # one-off admin / ops helpers
```

File-size soft cap: ~700 lines. Files that grow past that get split by responsibility.

---

## Configuration

All configuration is via environment variables. See [`.env.example`](./.env.example) for the full list with defaults.

| Variable | Required | Description |
|---|:-:|---|
| `PLEXUS_ADMIN_TOKEN` | ✓ | Bootstrap admin token. Use a secret manager in production. |
| `PLEXUS_OAUTH_SECRET` | ✓ | Signs authorization codes and OAuth state. |
| `PLEXUS_COOKIE_SECRET` | ✓ | Signs the dashboard session cookie. |
| `PLEXUS_SURREAL_URL` | ✓ | SurrealDB endpoint — defaults to `http://surrealdb:8000` inside the compose network. |
| `PLEXUS_SURREAL_USER` | ✓ | SurrealDB root user. |
| `PLEXUS_SURREAL_PASS` | ✓ | SurrealDB root password. |
| `PLEXUS_SURREAL_NS` | | Namespace (default `plexus`). |
| `PLEXUS_SURREAL_DB` | | Database (default `main`). |
| `PLEXUS_RP_ID` | | WebAuthn relying-party ID — must match the hostname. Default `localhost`. |
| `PLEXUS_RP_NAME` | | Display name shown on passkey prompts. |
| `PLEXUS_BASE_URL` | | Canonical base URL used by OAuth metadata. |
| `PLEXUS_PORT` | | HTTP listen port (default `8787`). |
| `PLEXUS_LOG_LEVEL` | | `debug` / `info` / `warn` / `error`. |

Generate high-entropy secrets:

```bash
openssl rand -hex 32
```

---

## Self-hosting

### Docker Compose (recommended)

The shipped `docker-compose.yml` brings up the plexus worker and SurrealDB together. The worker is published on `127.0.0.1:8787` — localhost only — so a typo in a public DNS record cannot accidentally expose the dashboard. Put a reverse proxy in front for anything beyond your own machine.

```bash
docker compose up -d
docker compose logs -f plexus
```

For Coolify hosts, stack the Coolify overlay on top to attach the external `coolify` Traefik network and pin the routing label:

```bash
docker compose -f docker-compose.yml -f docker-compose.coolify.yml up -d
```

### Behind a reverse proxy

plexus expects TLS in production. The dashboard sets `Secure` cookies and will misbehave over plain HTTP outside of `localhost`. Use a proxy such as Caddy, Traefik, or nginx; a minimal Caddy config is in [`Caddyfile`](./Caddyfile).

The CSP header pins `cdn.jsdelivr.net` for D3 (with an SRI hash). If you serve the dashboard behind a different CDN, update the CSP in `src/index.ts` accordingly.

### Backups

```bash
curl -H "Authorization: Bearer $PLEXUS_ADMIN_TOKEN" \
  https://<your-plexus-host>/admin/backup \
  > plexus-backup-$(date +%Y-%m-%d).json
```

The export contains entities, edges, kinds, relations, and users (without token hashes). It does **not** contain sessions, passkeys, OAuth tokens, personal tokens, or share tokens — credentials and session state are never backed up. Pass `?include_audit=1` to include the last 1000 activity-log rows under a separate filename (opt-in because those rows contain personal data).

---

## Development

```bash
npm ci
docker compose up -d surrealdb
cp .env.example .env        # fill in required fields
npm run dev                 # live reload on :8787
```

Quality gates:

```bash
npm run typecheck
npm run build
npx vitest run
npm audit --omit=dev --audit-level=moderate
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for commit conventions, PR expectations, and design principles we enforce during review.

---

## Security

- Markdown is rendered through an allow-listed URL parser; links carry `rel="noopener nofollow ugc"`.
- Attribute payloads are capped at 64 KB and rejected at the Zod boundary; prototype keys (`__proto__`, `constructor`, `prototype`) are stripped recursively.
- Token generation uses rejection sampling over base62 to avoid modulo bias.
- WebAuthn challenges are stepped-up with purpose binding for sensitive operations.
- The login error path returns a uniform `LOGIN_FAIL` regardless of which of (user, passkey, rate-limit) failed — no user enumeration.
- `kind=secret` is unreachable via MCP, non-shareable, and admin-only in the dashboard with a step-up passkey.

Report vulnerabilities privately — see [SECURITY.md](./SECURITY.md). Do **not** open a public issue for security matters.

---

## Licence

Apache License 2.0. See [LICENSE](./LICENSE).

`plexus` and `pcas.io` are trademarks of the pcas.io project. The Apache licence covers the code; it does not grant trademark rights.

---

## Acknowledgements

plexus is built on [SurrealDB](https://surrealdb.com), [Hono](https://hono.dev), [the Model Context Protocol SDK](https://modelcontextprotocol.io), [SimpleWebAuthn](https://simplewebauthn.dev), [Zod](https://zod.dev), and [D3](https://d3js.org).
