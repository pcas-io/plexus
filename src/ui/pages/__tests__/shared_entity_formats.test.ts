/**
 * Tests for the shared-entity output format negotiation.
 *
 * The public share page `/share/:token` now supports three output
 * formats via URL query params:
 *
 *   (default)               → HTML (the existing human-facing render)
 *   ?raw  OR  ?format=md    → Markdown (LLM-friendly, pipeable into glow)
 *   ?raw=json OR ?format=json → JSON (CLI, pipeable into jq)
 *
 * These tests cover the pure helpers that parse the format param and
 * shape the non-HTML output. The HTML path stays in shared_entity.ts.
 */

import { describe, test, expect } from 'vitest';
import type { Entity } from '../../../db/repositories/entities.js';
import {
  parseShareFormat,
  renderSharedEntityMarkdown,
  renderSharedEntityJson,
  CONTENT_TYPES,
} from '../shared_entity_formats.js';

const FIXTURE: Entity = {
  id: 'entities:abc123',
  kind: 'decision',
  title: 'Use SurrealDB v2 as the single-node backend',
  body: '# Decision\n\nSurrealDB v2 with RocksDB wins on operational simplicity.\n\n- Single binary\n- Native BM25\n- Temporal records',
  attributes: { severity: 'high', status: 'accepted', tags: ['db', 'architecture'] },
  context: 'dev',
  status: 'active',
  version: 3,
  created_at: '2026-04-05T21:33:15.156755691Z',
  updated_at: '2026-04-11T11:09:49.337875645Z',
  created_by: 'users:abc',
  updated_by: 'users:abc',
};

describe('parseShareFormat', () => {
  test('returns html when no param is set', () => {
    expect(parseShareFormat(new URLSearchParams())).toBe('html');
  });

  test('?raw (no value) returns md', () => {
    expect(parseShareFormat(new URLSearchParams('raw'))).toBe('md');
  });

  test('?raw (empty value) returns md', () => {
    expect(parseShareFormat(new URLSearchParams('raw='))).toBe('md');
  });

  test('?raw=md returns md', () => {
    expect(parseShareFormat(new URLSearchParams('raw=md'))).toBe('md');
  });

  test('?raw=json returns json', () => {
    expect(parseShareFormat(new URLSearchParams('raw=json'))).toBe('json');
  });

  test('?format=md returns md', () => {
    expect(parseShareFormat(new URLSearchParams('format=md'))).toBe('md');
  });

  test('?format=json returns json', () => {
    expect(parseShareFormat(new URLSearchParams('format=json'))).toBe('json');
  });

  test('?format=html returns html', () => {
    expect(parseShareFormat(new URLSearchParams('format=html'))).toBe('html');
  });

  test('unknown values fall back to html', () => {
    expect(parseShareFormat(new URLSearchParams('format=xml'))).toBe('html');
    expect(parseShareFormat(new URLSearchParams('raw=yaml'))).toBe('html');
  });

  test('case-insensitive', () => {
    expect(parseShareFormat(new URLSearchParams('format=MD'))).toBe('md');
    expect(parseShareFormat(new URLSearchParams('raw=JSON'))).toBe('json');
  });

  test('?raw wins over ?format when both are set (more explicit)', () => {
    expect(parseShareFormat(new URLSearchParams('raw=json&format=md'))).toBe('json');
  });
});

describe('renderSharedEntityMarkdown', () => {
  test('starts with H1 containing the entity title', () => {
    const out = renderSharedEntityMarkdown(FIXTURE);
    expect(out).toMatch(/^# Use SurrealDB v2 as the single-node backend/);
  });

  test('includes the entity body verbatim', () => {
    const out = renderSharedEntityMarkdown(FIXTURE);
    expect(out).toContain('SurrealDB v2 with RocksDB wins on operational simplicity.');
  });

  test('includes a metadata section with kind and context', () => {
    const out = renderSharedEntityMarkdown(FIXTURE);
    // Match across the bold-markdown markup — the line is written as
    // `**kind:** decision` so we accept anything between the label and
    // the value.
    expect(out).toMatch(/kind.*?decision/i);
    expect(out).toMatch(/context.*?dev/i);
  });

  test('includes attributes as a JSON code block when non-empty', () => {
    const out = renderSharedEntityMarkdown(FIXTURE);
    expect(out).toMatch(/```json/);
    expect(out).toContain('"severity": "high"');
  });

  test('omits the attributes block when attributes are empty', () => {
    const empty: Entity = { ...FIXTURE, attributes: {} };
    const out = renderSharedEntityMarkdown(empty);
    expect(out).not.toMatch(/```json/);
  });

  test('handles an entity without body gracefully', () => {
    const noBody: Entity = { ...FIXTURE, body: null };
    const out = renderSharedEntityMarkdown(noBody);
    expect(out).toMatch(/^# /);
    // Should not contain an empty paragraph or "null"
    expect(out).not.toContain('null');
  });

  test('includes a plexus share footer', () => {
    const out = renderSharedEntityMarkdown(FIXTURE);
    expect(out.toLowerCase()).toMatch(/plexus/);
    expect(out.toLowerCase()).toMatch(/share/);
  });
});

describe('renderSharedEntityJson', () => {
  test('is valid JSON', () => {
    const out = renderSharedEntityJson(FIXTURE);
    expect(() => JSON.parse(out)).not.toThrow();
  });

  test('roundtrips the entity fields', () => {
    const out = renderSharedEntityJson(FIXTURE);
    const parsed = JSON.parse(out);
    expect(parsed.id).toBe(FIXTURE.id);
    expect(parsed.kind).toBe(FIXTURE.kind);
    expect(parsed.title).toBe(FIXTURE.title);
    expect(parsed.body).toBe(FIXTURE.body);
    expect(parsed.attributes).toEqual(FIXTURE.attributes);
    expect(parsed.context).toBe(FIXTURE.context);
  });

  test('omits credentials-adjacent fields (created_by, updated_by)', () => {
    // Share consumers are anonymous and should not see WHO created the
    // entity — that's dashboard-internal metadata.
    const out = renderSharedEntityJson(FIXTURE);
    const parsed = JSON.parse(out);
    expect(parsed).not.toHaveProperty('created_by');
    expect(parsed).not.toHaveProperty('updated_by');
  });

  test('pretty-prints with 2-space indent', () => {
    const out = renderSharedEntityJson(FIXTURE);
    expect(out).toContain('\n  "id"');
  });
});

describe('CONTENT_TYPES', () => {
  test('has a UTF-8 content-type for every supported format', () => {
    expect(CONTENT_TYPES.html).toMatch(/^text\/html;\s*charset=utf-8$/i);
    expect(CONTENT_TYPES.md).toMatch(/^text\/markdown;\s*charset=utf-8$/i);
    expect(CONTENT_TYPES.json).toMatch(/^application\/json;\s*charset=utf-8$/i);
  });
});
