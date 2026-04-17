# Contributing to plexus

Thanks for your interest. plexus is a small, opinionated project and we want to keep it that way — focused, typed, auditable. Contributions are welcome; please read this first.

## Ways to help

- **File a bug.** Use the bug template. Include reproduction steps, expected vs. actual behaviour, and the plexus version (`git rev-parse --short HEAD`).
- **Propose a feature.** Use the feature template. Start with the problem, not the solution. A one-paragraph description of the user story beats a 20-line spec.
- **Open a pull request.** See below.
- **Report a security issue.** Do **not** open a public issue. See [SECURITY.md](./SECURITY.md).

## Before you open a PR

1. **Open or reference an issue.** We want to discuss direction before code changes. For trivial fixes (typos, broken links, obvious bugs with a one-line fix) an issue is not required.
2. **Fork the repo** and create a topic branch: `git checkout -b fix/short-description`.
3. **Keep the change small.** One logical change per PR. Unrelated refactors belong in separate PRs.

## Development setup

```bash
git clone https://github.com/<your-fork>/plexus.git
cd plexus
npm ci
docker compose up -d surrealdb   # or point PLEXUS_SURREAL_URL at your own instance
cp .env.example .env             # fill in required secrets
npm run dev
```

The dashboard is served at `http://localhost:8787`. The MCP endpoint is `POST /mcp`.

## Coding conventions

- **TypeScript strict mode.** No `any`, no `as unknown as X` to sidestep the type system.
- **File size cap: ~700 lines.** If a file grows past that, split it by responsibility.
- **No new abstractions without a caller.** Extract helpers when the second use site shows up, not before.
- **No `innerHTML` with untrusted content.** Use `document.createTextNode` / `document.createElement` or the existing `escapeHtml` helpers.
- **Tests alongside code changes.** New features and bugfixes ship with tests. We use `vitest`.
- **Conventional Commits** for commit messages: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`. Scope is optional: `feat(mcp): …`.

## What we run in CI

- `npm run typecheck`
- `npm run build`
- `npx vitest run` (with an in-memory SurrealDB container)
- `npm audit --omit=dev --audit-level=moderate` — production CVEs block merge
- `gitleaks detect` — secret scanning
- `docker build` — image builds from a clean slate

Your PR should pass all of these locally before review. The CI workflow is defined in `.github/workflows/ci.yml`.

## PR review

- plexus is currently maintained by a single person. PR review and merge decisions are at their discretion.
- Expect questions about *why* before *how*. If the PR description explains motivation clearly, review moves faster.
- Direct pushes to `main` are disabled. All changes land via PR, including our own.

## Design principles we will ask you to respect

- **Read-only for humans, write-only for agents.** Additions to the human dashboard must not expose new write operations except the narrow set already there (user/session/token/share management).
- **Typed entities, strict relations.** New kinds or relations require an ADR entry explaining the need. We don't add catchall fields.
- **Temporal edges.** Mutations don't delete history. `unlink_entity` sets `valid_to`; it does not remove the edge.
- **Scope enforcement at the MCP boundary.** Every tool handler calls `requireWrite` / `checkContext` / `checkKind` / `rejectSecret` as its first act.
- **Secrets are unreachable via MCP.** `kind=secret` is filtered on read, rejected on write, and never crosses the share boundary.

## Licence

By submitting a pull request you agree that your contribution is licensed under the [Apache License 2.0](./LICENSE). No CLA required.
