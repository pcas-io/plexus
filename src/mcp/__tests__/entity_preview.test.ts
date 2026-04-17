import { describe, test, expect } from 'vitest';
import { buildEntityPreview, type EntityLike } from '../entity_preview.js';

function entity(body: string | null, overrides: Partial<EntityLike> = {}): EntityLike {
  return {
    id: 'entities:abc',
    kind: 'concept',
    title: 'Test',
    body,
    attributes: { tag: 'x' },
    context: 'dev',
    status: 'active',
    version: 1,
    created_at: '2026-04-13T00:00:00.000Z',
    updated_at: '2026-04-13T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildEntityPreview', () => {
  test('returns full body when shorter than previewChars', () => {
    const result = buildEntityPreview(entity('hello world'), 300);
    expect(result.body_preview).toBe('hello world');
    expect(result.body_length).toBe(11);
    expect(result.body_truncated).toBe(false);
  });

  test('truncates body with ellipsis when longer than previewChars', () => {
    const long = 'x'.repeat(500);
    const result = buildEntityPreview(entity(long), 100);
    expect(result.body_length).toBe(500);
    expect(result.body_truncated).toBe(true);
    expect(result.body_preview).toBe('x'.repeat(100) + '…');
  });

  test('previewChars = 0 yields null preview but keeps body_length', () => {
    const result = buildEntityPreview(entity('any content here'), 0);
    expect(result.body_preview).toBeNull();
    expect(result.body_length).toBe(16);
    expect(result.body_truncated).toBe(true);
  });

  test('null body produces null preview and zero length', () => {
    const result = buildEntityPreview(entity(null), 300);
    expect(result.body_preview).toBeNull();
    expect(result.body_length).toBe(0);
    expect(result.body_truncated).toBe(false);
  });

  test('empty-string body produces null preview and zero length', () => {
    const result = buildEntityPreview(entity(''), 300);
    expect(result.body_preview).toBeNull();
    expect(result.body_length).toBe(0);
    expect(result.body_truncated).toBe(false);
  });

  test('body exactly at previewChars returns full body, not truncated', () => {
    const body = 'a'.repeat(50);
    const result = buildEntityPreview(entity(body), 50);
    expect(result.body_preview).toBe(body);
    expect(result.body_truncated).toBe(false);
  });

  test('body one char longer than previewChars truncates', () => {
    const body = 'a'.repeat(51);
    const result = buildEntityPreview(entity(body), 50);
    expect(result.body_truncated).toBe(true);
    expect(result.body_preview).toBe('a'.repeat(50) + '…');
  });

  test('trims trailing whitespace before appending ellipsis', () => {
    const body = 'abc   ' + 'x'.repeat(50);
    const result = buildEntityPreview(entity(body), 6);
    expect(result.body_preview).toBe('abc…');
  });

  test('preserves metadata fields unchanged', () => {
    const input = entity('short', {
      id: 'entities:xyz',
      kind: 'task',
      title: 'My task',
      attributes: { priority: 'high', status: 'open' },
      context: 'ifp-labs',
      status: 'active',
      version: 7,
    });
    const result = buildEntityPreview(input, 300);
    expect(result.id).toBe('entities:xyz');
    expect(result.kind).toBe('task');
    expect(result.title).toBe('My task');
    expect(result.attributes).toEqual({ priority: 'high', status: 'open' });
    expect(result.context).toBe('ifp-labs');
    expect(result.version).toBe(7);
  });

  test('preview respects multi-byte characters by string slice length', () => {
    const body = 'ä'.repeat(200);
    const result = buildEntityPreview(entity(body), 100);
    expect(result.body_length).toBe(200);
    expect(result.body_truncated).toBe(true);
    expect(result.body_preview).toBe('ä'.repeat(100) + '…');
  });
});
