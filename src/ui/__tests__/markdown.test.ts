/**
 * Tests for the shared Markdown renderer.
 *
 * Primary focus: the safeUrl() sanitiser in src/ui/markdown.ts.
 * SEC-HIGH-1 (2026-04-10): the old deny-list approach (trim().toLowerCase().startsWith())
 * could be bypassed by interleaving ASCII tab/CR/LF inside the URL scheme, because the
 * WHATWG URL parser strips those characters before interpreting the protocol. This suite
 * verifies the allow-list rewrite and that unsafe links are rendered as plain text.
 */

import { describe, test, expect } from 'vitest';
import { renderMarkdown } from '../markdown.js';

describe('renderMarkdown — safeUrl', () => {
  // --- blocked schemes ---

  test('blocks plain javascript: URLs', () => {
    const html = renderMarkdown('[x](javascript:alert(1))');
    expect(html).not.toContain('href=');
    expect(html).not.toContain('javascript');
    expect(html).toContain('x');
  });

  test('blocks mixed-case JaVaScRiPt: URLs', () => {
    const html = renderMarkdown('[x](JaVaScRiPt:alert(1))');
    expect(html).not.toContain('href=');
    expect(html.toLowerCase()).not.toContain('javascript');
  });

  test('blocks javascript: with embedded ASCII tab (SEC-HIGH-1)', () => {
    const html = renderMarkdown('[x](jav\tascript:alert(1))');
    expect(html).not.toContain('href=');
    expect(html).not.toContain('alert');
  });

  test('blocks javascript: with embedded CR (SEC-HIGH-1)', () => {
    const html = renderMarkdown('[x](jav\rascript:alert(1))');
    expect(html).not.toContain('href=');
    expect(html).not.toContain('alert');
  });

  test('blocks javascript: with embedded LF (SEC-HIGH-1)', () => {
    const html = renderMarkdown('[x](jav\nascript:alert(1))');
    expect(html).not.toContain('href=');
    expect(html).not.toContain('alert');
  });

  test('blocks data: URLs', () => {
    const html = renderMarkdown('[x](data:text/html,<script>alert(1)</script>)');
    expect(html).not.toContain('href=');
  });

  test('blocks vbscript: URLs', () => {
    const html = renderMarkdown('[x](vbscript:msgbox(1))');
    expect(html).not.toContain('href=');
  });

  test('blocks file: URLs', () => {
    const html = renderMarkdown('[x](file:///etc/passwd)');
    expect(html).not.toContain('href=');
  });

  // --- allowed schemes ---

  test('allows https: URLs', () => {
    const html = renderMarkdown('[OK](https://example.com/docs)');
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain('>OK</a>');
  });

  test('allows http: URLs', () => {
    const html = renderMarkdown('[OK](http://example.com/)');
    expect(html).toContain('href="http://example.com/"');
  });

  test('allows mailto: URLs', () => {
    const html = renderMarkdown('[mail](mailto:ok@test.example)');
    expect(html).toContain('href="mailto:ok@test.example"');
  });

  test('allows relative URLs starting with /', () => {
    const html = renderMarkdown('[home](/entities/abc)');
    expect(html).toContain('href="/entities/abc"');
  });

  // --- hardening on the generated <a> tag ---

  test('adds rel="noopener nofollow ugc" to generated links', () => {
    const html = renderMarkdown('[x](https://example.com/)');
    expect(html).toContain('rel="noopener nofollow ugc"');
  });
});
