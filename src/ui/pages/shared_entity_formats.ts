/**
 * Output format helpers for the public `/share/:token` route.
 *
 * The share link renders an entity in one of three formats, chosen via
 * URL query params:
 *
 *   (default)                   → HTML  (human in a browser)
 *   ?raw    or ?format=md       → MD    (LLM / terminal via `glow`)
 *   ?raw=json or ?format=json   → JSON  (CLI / `jq` / pipes)
 *
 * `?raw` wins over `?format` when both are set (it's the more explicit
 * signal that the caller is a machine). Unknown values fall back to
 * HTML so a typo never produces a broken 406.
 *
 * The HTML path keeps its existing renderer in `shared_entity.ts`
 * (full page layout, CSS, etc.). This file only exposes the two
 * non-HTML serialisers plus the format-negotiation helper, so the
 * dashboard layout code stays isolated from CLI/agent concerns.
 */

import type { Entity } from '../../db/repositories/entities.js';

export type ShareFormat = 'html' | 'md' | 'json';

/** Content-Type headers for each supported format. */
export const CONTENT_TYPES: Record<ShareFormat, string> = {
  html: 'text/html; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  json: 'application/json; charset=utf-8',
};

/**
 * Decide which format to render based on the URL query string.
 *
 * Accepts a URLSearchParams object rather than a Hono Context or raw
 * string so callers can unit-test against any source (Hono, Node
 * `URL`, fetch `Request`) without coupling.
 */
export function parseShareFormat(query: URLSearchParams): ShareFormat {
  const raw = query.get('raw');
  // `?raw` alone (no value) or `?raw=` (empty value) counts as "raw=md"
  // per the human-reading intent — you typed "raw", you wanted the
  // non-HTML form, and markdown is the most useful default non-HTML.
  if (raw !== null) {
    if (raw === '' || raw.toLowerCase() === 'md') return 'md';
    if (raw.toLowerCase() === 'json') return 'json';
    if (raw.toLowerCase() === 'html') return 'html';
    // Unknown raw value → fall back to html (safer than returning 406)
    return 'html';
  }

  const format = query.get('format');
  if (format !== null) {
    const norm = format.toLowerCase();
    if (norm === 'md' || norm === 'markdown') return 'md';
    if (norm === 'json') return 'json';
    if (norm === 'html') return 'html';
    return 'html';
  }

  return 'html';
}

/**
 * Serialise an entity as a plain markdown document suitable for LLM
 * consumption or terminal rendering (`curl … | glow`).
 *
 * Shape:
 *
 *   # {title}
 *
 *   {body, verbatim — already markdown}
 *
 *   ---
 *
 *   **kind:** {kind}
 *   **context:** {context}
 *
 *   ```json
 *   {attributes, pretty-printed}
 *   ```
 *
 *   ---
 *   *Shared via plexus — read-only snapshot, one-time link.*
 */
export function renderSharedEntityMarkdown(entity: Entity): string {
  const parts: string[] = [];
  parts.push(`# ${entity.title}`);
  parts.push('');

  if (entity.body && entity.body.trim().length > 0) {
    parts.push(entity.body);
    parts.push('');
  }

  parts.push('---');
  parts.push('');
  parts.push(`**kind:** ${entity.kind}  `);
  parts.push(`**context:** ${entity.context}  `);
  parts.push(`**status:** ${entity.status}`);
  parts.push('');

  const hasAttributes = Object.keys(entity.attributes).length > 0;
  if (hasAttributes) {
    parts.push('```json');
    parts.push(JSON.stringify(entity.attributes, null, 2));
    parts.push('```');
    parts.push('');
  }

  parts.push('---');
  parts.push('');
  parts.push('*Shared via plexus — read-only snapshot, one-time link.*');
  parts.push('');

  return parts.join('\n');
}

/**
 * Serialise an entity as JSON for pipe-friendly CLI consumption
 * (`curl … | jq`). Pretty-printed with 2-space indent so a human
 * glancing at the raw response can still read it.
 *
 * Security note: this is a PUBLIC endpoint (anyone with the one-time
 * share token can hit it), so we strip dashboard-internal attribution
 * (`created_by`, `updated_by`) from the payload. The share recipient
 * is anonymous and has no business knowing which user ID authored
 * the entity — they just want the content.
 */
export function renderSharedEntityJson(entity: Entity): string {
  const {
    id,
    kind,
    title,
    body,
    attributes,
    context,
    status,
    version,
    created_at,
    updated_at,
  } = entity;

  const payload = {
    id,
    kind,
    title,
    body,
    attributes,
    context,
    status,
    version,
    created_at,
    updated_at,
  };

  return JSON.stringify(payload, null, 2);
}
