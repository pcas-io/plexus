/**
 * Regression tests for the public /share/:token HTML renderer.
 *
 * Primary focus: the 2026-04-11 double-escape bug where the Attributes
 * block was rendered as literal text (`<h2>Attributes</h2><div class=...`)
 * instead of real HTML. Root cause: a nested `html\`...\`` template was
 * being interpolated into the outer `html\`...\`` which then ran its
 * string output through `escapeHtml()` because it wasn't wrapped in
 * `raw()`. These tests lock the correct shape: the Attributes section
 * ships as rendered HTML, not as text.
 */

import { describe, test, expect } from 'vitest';
import type { Entity } from '../../../db/repositories/entities.js';
import { renderSharedEntity } from '../shared_entity.js';

const FIXTURE: Entity = {
  id: 'entities:abc123',
  kind: 'project',
  title: 'buddy v5 codename plexus',
  body: '# plexus\n\nKnowledge graph backend for AI agents.',
  attributes: {
    buddy_project_id: '01KNEC9TR71SEKCJF6B7N3PHY2',
    status: 'planning',
  },
  context: 'dev',
  status: 'active',
  version: 1,
  created_at: '2026-04-05T21:33:15.156755691Z',
  updated_at: '2026-04-11T11:09:49.337875645Z',
  created_by: 'users:abc',
  updated_by: 'users:abc',
};

describe('renderSharedEntity — Attributes rendering', () => {
  test('renders the Attributes heading as real HTML (not escaped)', () => {
    const out = renderSharedEntity({ entity: FIXTURE });
    // Before the fix the output contained `&lt;h2&gt;Attributes&lt;/h2&gt;`
    // as visible text. The correct contract: the `<h2>` tag reaches the
    // browser unescaped.
    expect(out).toContain('<h2>Attributes</h2>');
    expect(out).not.toContain('&lt;h2&gt;Attributes&lt;/h2&gt;');
  });

  test('renders the pre block with the attributes JSON, not as escaped text', () => {
    const out = renderSharedEntity({ entity: FIXTURE });
    // A correctly-rendered pre tag appears as `<pre style=...>` in source.
    expect(out).toMatch(/<pre[^>]*>/);
    // The inner JSON values should be HTML-escaped once (for display),
    // not twice. Single escape: `&quot;`. Double escape: `&amp;quot;`.
    expect(out).toContain('&quot;buddy_project_id&quot;');
    expect(out).not.toContain('&amp;quot;buddy_project_id&amp;quot;');
  });

  test('the attributes block is inside the card wrapper, not adjacent to it', () => {
    const out = renderSharedEntity({ entity: FIXTURE });
    // The <pre> must be a descendant of the .card div, not a sibling
    // rendered as text after the tag.
    const cardStart = out.indexOf('<div class="card">');
    const preStart = out.indexOf('<pre', cardStart);
    const cardEnd = out.indexOf('</div>', cardStart);
    expect(cardStart).toBeGreaterThan(-1);
    expect(preStart).toBeGreaterThan(cardStart);
    expect(preStart).toBeLessThan(cardEnd);
  });
});

describe('renderSharedEntity — empty attributes', () => {
  test('omits the Attributes section entirely when attributes is empty', () => {
    const out = renderSharedEntity({
      entity: { ...FIXTURE, attributes: {} },
    });
    expect(out).not.toContain('<h2>Attributes</h2>');
  });
});

describe('renderSharedEntity — footer', () => {
  test('contains the one-time-link consumption notice', () => {
    const out = renderSharedEntity({ entity: FIXTURE });
    expect(out).toMatch(/verbraucht|einmal|funktioniert beim zweiten/i);
  });

  test('does NOT invite the reader to retry with ?raw on a consumed link', () => {
    // The share is one-shot — the reader already consumed the token by
    // viewing this page. Telling them "add ?raw and try again" would
    // just produce a 410 Gone. The dashboard share-create flow is the
    // correct place to pick the format.
    const out = renderSharedEntity({ entity: FIXTURE });
    expect(out).not.toContain('?raw');
    expect(out).not.toMatch(/Alternative Ausgabe/i);
  });
});
