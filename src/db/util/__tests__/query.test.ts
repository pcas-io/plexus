/**
 * Tests for the shared SurrealQL helper fragments.
 */

import { describe, test, expect } from 'vitest';
import { IS_UNSET } from '../query.js';

describe('IS_UNSET', () => {
  test('produces a parenthesised NONE-or-NULL check for the given field', () => {
    expect(IS_UNSET('revoked_at')).toBe('(revoked_at IS NONE OR revoked_at IS NULL)');
  });

  test('works with dotted field paths', () => {
    expect(IS_UNSET('meta.deleted_at')).toBe(
      '(meta.deleted_at IS NONE OR meta.deleted_at IS NULL)',
    );
  });

  test('composes cleanly into a larger SurrealQL clause', () => {
    const clause = `SELECT * FROM share_tokens WHERE ${IS_UNSET('consumed_at')};`;
    expect(clause).toBe(
      'SELECT * FROM share_tokens WHERE (consumed_at IS NONE OR consumed_at IS NULL);',
    );
  });
});
