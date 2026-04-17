/**
 * Single source of truth for the plexus application version.
 *
 * Reads `version` from package.json at module-load time using ESM-native
 * `import.meta.url` so it resolves correctly both in local dev (where the
 * module lives at src/version.ts and package.json sits one level up from
 * src/) and in the built Docker image (where the module lives at
 * dist/version.js and package.json is copied to /app/package.json one
 * level up from /app/dist/).
 *
 * Why not `import pkg from '../package.json' with { type: 'json' }`: import
 * assertions are still gated behind a Node flag in the TypeScript +
 * verbatimModuleSyntax combination this project uses, and would also pull
 * the entire package.json into the compiled bundle layout. Reading via
 * `fs` keeps the build simple and the runtime honest.
 *
 * Call sites: src/index.ts (/health admin body), src/backup.ts (backup
 * payload), src/mcp/server.ts (MCP server Announce). Adding a new call
 * site is a one-line import. Bumping the version is a one-field edit in
 * package.json — no source-tree search-and-replace required.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(here, '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };

export const VERSION: string = pkg.version;
