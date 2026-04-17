<!--
Thanks for opening a PR! A few notes before you hit submit:

- For anything non-trivial, please link an issue. We discuss direction before code.
- Keep the PR scoped to one logical change. Unrelated refactors go in separate PRs.
- New features ship with tests. Bugfixes ship with a regression test.
- See CONTRIBUTING.md for full guidelines.
-->

## Summary

<!-- One or two sentences on what changes and why. -->

## Linked issue

Closes #

## Type of change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that changes existing behaviour)
- [ ] Refactor / internal cleanup (no behaviour change)
- [ ] Docs only

## How was this tested?

<!-- Describe what you ran, including the commands and environment. -->

- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npx vitest run`
- [ ] Manually verified the affected flow in the dashboard / via MCP

## Checklist

- [ ] Conventional commit messages (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`)
- [ ] No files exceed the ~700-line soft cap
- [ ] No `innerHTML` with untrusted content
- [ ] No new secrets in code or tests
- [ ] README / docs updated if behaviour changed
