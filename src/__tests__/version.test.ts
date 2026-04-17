/**
 * Tests for the runtime version constant.
 *
 * `src/version.ts` is the single source of truth for the application's
 * version string. It reads package.json at runtime so that a version bump
 * in package.json is automatically reflected everywhere — no hardcoded
 * version strings in the source tree that can drift out of sync.
 *
 * These tests lock that contract:
 *   1. `VERSION` matches whatever `package.json` says right now
 *   2. `VERSION` is a plausible semver string
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { VERSION } from '../version.js';

describe('VERSION', () => {
  test('matches package.json version field (drift detector)', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = resolve(here, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });

  test('is a plausible semver string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(?:-[\w.]+)?(?:\+[\w.]+)?$/);
  });

  test('is a non-empty string', () => {
    expect(typeof VERSION).toBe('string');
    expect(VERSION.length).toBeGreaterThan(0);
  });
});
