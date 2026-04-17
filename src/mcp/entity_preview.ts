/**
 * Shared body-preview projection used by `context_load` and
 * `search_entities`. Keeps MCP responses well under the 10k token
 * response limit when a query surfaces large entities (ADRs, runbooks,
 * handoffs). Full bodies remain reachable via `get_entity`.
 *
 * Semantics:
 *   previewChars === 0 → body_preview is null (metadata only, body_length still set)
 *   previewChars  >  0 → body_preview is the first N chars, ellipsis when truncated
 *
 * `search_entities` passes `undefined` to opt out entirely and keep the
 * pre-2026-04-13 response shape for callers that never set the param.
 */

export interface EntityLike {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string | null;
  readonly attributes: Record<string, unknown>;
  readonly context: string;
  readonly status: string;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface EntityPreview {
  id: string;
  kind: string;
  title: string;
  context: string;
  status: string;
  version: number;
  attributes: Record<string, unknown>;
  body_preview: string | null;
  body_length: number;
  body_truncated: boolean;
  created_at: string;
  updated_at: string;
}

export function buildEntityPreview(entity: EntityLike, previewChars: number): EntityPreview {
  const bodyLen = entity.body ? entity.body.length : 0;
  const truncated = bodyLen > previewChars;
  let body_preview: string | null;
  if (previewChars === 0 || !entity.body) {
    body_preview = null;
  } else if (truncated) {
    body_preview = entity.body.slice(0, previewChars).trimEnd() + '…';
  } else {
    body_preview = entity.body;
  }
  return {
    id: entity.id,
    kind: entity.kind,
    title: entity.title,
    context: entity.context,
    status: entity.status,
    version: entity.version,
    attributes: entity.attributes,
    body_preview,
    body_length: bodyLen,
    body_truncated: truncated,
    created_at: entity.created_at,
    updated_at: entity.updated_at,
  };
}
