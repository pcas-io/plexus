/**
 * Tests for the audit-log page renderer — specifically the row-body
 * path that regressed on first preview by stringifying `raw()`-wrapped
 * helpers into `[object Object]` inside a plain template literal.
 */

import { describe, expect, test } from 'vitest';
import { renderAuditPage } from '../audit.js';
import type { ActivityLogEntry } from '../../../db/repositories/activity_log.js';

const USER = { name: 'alice', is_admin: true };

const SAMPLE_ENTRY: ActivityLogEntry = {
  id: 'activity_log:abc',
  timestamp: '2026-04-16T16:19:34.664Z',
  user_name: 'alice',
  action: 'update_entity',
  target_type: 'entity',
  target_id: 'entities:tckt3piig1ggql0tzpws',
  ip: '160.79.106.35',
  user_agent: 'curl/8',
  outcome: 'success',
  metadata: { kind: 'task', context: 'dev' },
};

function render(entries: ActivityLogEntry[]): string {
  return renderAuditPage({
    currentUser: USER,
    entries,
    totalCount: entries.length,
    limit: 100,
    offset: 0,
    filter: {},
    actionOptions: ['update_entity', 'save_entity'],
    userOptions: ['alice'],
    csrfToken: 'csrf-test',
  });
}

describe('renderAuditPage', () => {
  test('never emits "[object Object]" in the rendered output', () => {
    const html = render([SAMPLE_ENTRY]);
    expect(html).not.toContain('[object Object]');
  });

  test('renders target id as a link to the entity page for entity targets', () => {
    const html = render([SAMPLE_ENTRY]);
    expect(html).toContain(
      'href="/entities/entities%3Atckt3piig1ggql0tzpws"'
    );
  });

  test('renders outcome as a styled badge, not raw text', () => {
    const html = render([SAMPLE_ENTRY]);
    expect(html).toContain('<span class="badge badge-active">success</span>');
  });

  test('renders outcome=failure with the danger badge', () => {
    const html = render([{ ...SAMPLE_ENTRY, outcome: 'failure' }]);
    expect(html).toContain('<span class="badge badge-danger">failure</span>');
  });

  test('empty result set renders the "keine Eintraege" placeholder row', () => {
    const html = render([]);
    expect(html).toContain('Keine Eintraege');
  });

  test('metadata preview surfaces first few keys as key=value pairs', () => {
    const html = render([SAMPLE_ENTRY]);
    expect(html).toContain('kind=task');
    expect(html).toContain('context=dev');
  });

  test('target id of a non-entity target renders as plain mono text', () => {
    const html = render([
      { ...SAMPLE_ENTRY, target_type: 'session', target_id: 'user_sessions:xyz' },
    ]);
    expect(html).not.toContain('href="/entities/user_sessions');
    expect(html).toContain('user_sessions:xyz');
  });

  test('missing target id shows the em-dash placeholder', () => {
    const html = render([
      { ...SAMPLE_ENTRY, target_type: null as unknown as string, target_id: null as unknown as string },
    ]);
    // The targetCell returns <span class="subtle">—</span> when no target_id.
    expect(html).toContain('<span class="subtle">—</span>');
  });
});
