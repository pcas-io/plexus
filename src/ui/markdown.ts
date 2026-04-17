/**
 * Shared Markdown renderer for plexus.
 *
 * Used by entity detail, shared entity (public share links), and
 * anywhere else that needs to render entity bodies as HTML. Supports
 * headings, bold, italic, inline code, links, lists, blockquotes,
 * fenced code blocks, and tables.
 */

import { escapeHtml } from './layout.js';

/**
 * Sanitise a URL from markdown `[text](url)`.
 *
 * Security model (SEC-HIGH-1, 2026-04-10): allow-list instead of deny-list.
 * The WHATWG URL parser strips ASCII tab (U+0009), LF (U+000A), and CR (U+000D)
 * from the input before interpreting the scheme, which means a naive
 * `startsWith('javascript:')` check can be bypassed with
 * `jav\tascript:alert(1)` and similar. Here we pre-strip those characters to
 * match browser behaviour, then parse the URL with a sentinel base so we can
 * read a canonical `protocol`. Only http:, https:, mailto:, and same-origin
 * relative links are allowed — everything else (data:, vbscript:, javascript:,
 * file:, tel:, intent:, …) is rejected.
 */
const URL_BASE_SENTINEL = 'https://plexus.invalid';
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function safeUrl(url: string): string | null {
  const cleaned = url.replace(/[\t\n\r]/g, '');
  // Raw whitespace in a markdown URL is never legitimate — genuine URLs with
  // spaces must be percent-encoded. Rejecting whitespace also closes an edge
  // case where renderMarkdown() joins continuation lines with spaces, which
  // could otherwise let a `jav<LF>ascript:` payload slip through as a
  // relative path that the URL parser considers benign.
  if (/\s/.test(cleaned)) return null;
  try {
    const parsed = new URL(cleaned, URL_BASE_SENTINEL);
    const proto = parsed.protocol.toLowerCase();
    if (ALLOWED_PROTOCOLS.has(proto)) return cleaned;
    // Relative link: URL() resolves against the sentinel base, so the host
    // will match plexus.invalid. Anything else means the link had its own
    // absolute scheme that we don't trust.
    if (proto === 'https:' && parsed.host === 'plexus.invalid') return cleaned;
    return null;
  } catch {
    return null;
  }
}

function inline(text: string): string {
  let s = escapeHtml(text);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, linkText, href) => {
    const safe = safeUrl(href);
    return safe
      ? `<a href="${safe}" rel="noopener nofollow ugc">${linkText}</a>`
      : linkText;
  });
  return s;
}

export function renderMarkdown(md: string): string {
  if (!md) return '';
  const lines = md.split('\n');
  const out: string[] = [];
  let inCode = false;
  let codeLang = '';
  let codeBuffer: string[] = [];
  let listBuffer: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let paraBuffer: string[] = [];

  const flushList = () => {
    if (listBuffer.length > 0 && listType) {
      out.push(`<${listType}>${listBuffer.join('')}</${listType}>`);
      listBuffer = [];
      listType = null;
    }
  };
  const flushPara = () => {
    if (paraBuffer.length > 0) {
      out.push(`<p>${inline(paraBuffer.join(' '))}</p>`);
      paraBuffer = [];
    }
  };

  let tableBuffer: string[] = [];
  const flushTable = () => {
    if (tableBuffer.length < 2) {
      for (const tl of tableBuffer) paraBuffer.push(tl);
      tableBuffer = [];
      return;
    }
    const rows = tableBuffer.filter((r) => !r.match(/^\|[\s-:|]+\|$/));
    if (rows.length === 0) { tableBuffer = []; return; }
    const parseRow = (r: string) =>
      r.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => inline(c.trim()));
    const headerCells = parseRow(rows[0] ?? '');
    const bodyRows = rows.slice(1);
    const thead = `<thead><tr>${headerCells.map((c) => `<th>${c}</th>`).join('')}</tr></thead>`;
    const tbody = bodyRows.length > 0
      ? `<tbody>${bodyRows.map((r) => `<tr>${parseRow(r).map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>`
      : '';
    out.push(`<div class="table-wrapper"><table>${thead}${tbody}</table></div>`);
    tableBuffer = [];
  };

  for (const line of lines) {
    if (line.trimStart().startsWith('|') && line.trimEnd().endsWith('|')) {
      flushPara(); flushList(); tableBuffer.push(line); continue;
    }
    if (tableBuffer.length > 0) flushTable();

    if (line.startsWith('```')) {
      if (!inCode) {
        flushPara(); flushList();
        inCode = true; codeLang = line.slice(3).trim(); codeBuffer = [];
      } else {
        out.push(`<pre><code class="${escapeHtml(codeLang)}">${codeBuffer.map(escapeHtml).join('\n')}</code></pre>`);
        inCode = false; codeLang = ''; codeBuffer = [];
      }
      continue;
    }
    if (inCode) { codeBuffer.push(line); continue; }

    const h1 = line.match(/^# (.+)$/);
    const h2 = line.match(/^## (.+)$/);
    const h3 = line.match(/^### (.+)$/);
    if (h1) { flushPara(); flushList(); out.push(`<h1>${inline(h1[1] ?? '')}</h1>`); continue; }
    if (h2) { flushPara(); flushList(); out.push(`<h2>${inline(h2[1] ?? '')}</h2>`); continue; }
    if (h3) { flushPara(); flushList(); out.push(`<h3>${inline(h3[1] ?? '')}</h3>`); continue; }

    const ulItem = line.match(/^[-*] (.+)$/);
    const olItem = line.match(/^\d+\. (.+)$/);
    if (ulItem) {
      flushPara();
      if (listType !== 'ul') { flushList(); listType = 'ul'; }
      listBuffer.push(`<li>${inline(ulItem[1] ?? '')}</li>`);
      continue;
    }
    if (olItem) {
      flushPara();
      if (listType !== 'ol') { flushList(); listType = 'ol'; }
      listBuffer.push(`<li>${inline(olItem[1] ?? '')}</li>`);
      continue;
    }
    if (line.startsWith('> ')) {
      flushList(); flushPara();
      out.push(`<blockquote><p>${inline(line.slice(2))}</p></blockquote>`);
      continue;
    }
    if (line.trim() === '') { flushPara(); flushList(); continue; }
    flushList();
    paraBuffer.push(line);
  }
  flushPara();
  flushList();
  if (tableBuffer.length > 0) flushTable();
  if (inCode) {
    out.push(`<pre><code class="${escapeHtml(codeLang)}">${codeBuffer.map(escapeHtml).join('\n')}</code></pre>`);
  }
  return out.join('\n');
}
