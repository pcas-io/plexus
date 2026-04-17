# Security Policy

## Reporting a vulnerability

**Do not open a public GitHub issue for security reports.**

Send a private report to **security@pcas.io** with:

- A short description of the issue.
- Steps to reproduce, ideally with a minimal proof-of-concept.
- The plexus version or commit SHA you tested against.
- Your assessment of severity and impact.
- Whether you would like public credit in the advisory.

You will get a first acknowledgement within **3 business days**.

## What to expect

1. **Triage** — we confirm the issue is reproducible and classify severity (HIGH / MODERATE / LOW / INFO).
2. **Fix window** — target windows from confirmed report:
   - HIGH: 7 days
   - MODERATE: 30 days
   - LOW: best-effort, next release
3. **Coordinated disclosure** — we agree on an embargo date with you. The fix ships in a tagged release and a [GitHub Security Advisory](https://github.com/pcas-io/plexus/security/advisories) is published.
4. **Credit** — if you want it, you are named in the advisory.

## Scope

In scope:

- `src/` — the plexus worker (HTTP, MCP, OAuth, WebAuthn, share flow, dashboard).
- `migrations/` — SurrealDB schema.
- `Dockerfile`, `docker-compose.yml` — default deployment artefacts.

Out of scope:

- Vulnerabilities in third-party dependencies — please report to the upstream project. If plexus amplifies the impact, tell us.
- Denial-of-service attacks against a specific deployed instance.
- Social-engineering against pcas.io operators.
- Findings that depend on the attacker already having an admin token.

## Defensive posture

plexus ships with a reviewer-verified feature set. The full security audit sits in the project graph and is summarised in the README. Current posture includes:

- PKCE S256 required on every OAuth flow (plain rejected).
- Passkey step-up on share creation with purpose-binding.
- Exact-match redirect URI comparison in constant time.
- Atomic one-shot consumption on auth codes and share tokens.
- Content Security Policy with a pinned CDN + SRI hash for D3.
- Rate limiting on auth and share endpoints.
- Markdown renderer hardened against URL-based XSS (audit finding HIGH-1, closed).
- Attribute payload limit (64 KB) with prototype-key stripping.
- Scope enforcement at the MCP tool boundary (`requireWrite`, `checkContext`, `checkKind`, `rejectSecret`).
- `kind=secret` unreachable via MCP and non-shareable.
- Backup endpoint excludes credentials by default; personally identifiable audit rows are opt-in.

## Hardening your own deployment

- Set `PLEXUS_ADMIN_TOKEN`, `PLEXUS_OAUTH_SECRET`, `PLEXUS_COOKIE_SECRET` to high-entropy values and store them in a secret manager — never in a committed `.env`.
- Put plexus behind TLS. The dashboard sets Secure cookies and will misbehave over plain HTTP in anything other than a local-dev context.
- Run SurrealDB with its own non-default credentials; do not expose port 8000 outside the compose network.
- Enable WebAuthn attestation checks in environments where device identity matters.
