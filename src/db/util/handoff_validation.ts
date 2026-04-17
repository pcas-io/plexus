/**
 * Handoff-fact schema validation.
 *
 * Enforces that `fact` entities carrying `attributes.session_type === 'handoff'`
 * provide the metadata needed for multi-agent coordination:
 *
 *   - session_date  (ISO date: YYYY-MM-DD or full RFC 3339 timestamp)
 *   - session_id    (non-empty string, free-form but required)
 *   - agent_id      (non-empty string — agent-mesh id, Claude model id, …)
 *   - part_of       (edge to an active project entity)
 *
 * `git_branch` is optional but strongly recommended in CLAUDE.md.
 *
 * The check is callable as a pure function so the MCP layer can resolve
 * the `part_of` target via `entities.get()` before invoking the validator,
 * keeping this module free of database dependencies and trivially
 * unit-testable.
 *
 * Grandfathering: only applies to new writes. Pre-existing handoff-facts
 * without these attributes stay valid and readable.
 *
 * Known limitation (TOCTOU): the caller resolves part_of, validates, then
 * writes. A concurrent archive of the project between pre-fetch and insert
 * will slip through unnoticed. This is an instance of the broader
 * multi-agent concurrency issue tracked as entities:xq5s3wmxytitbb8g0h0s —
 * fixing it here would require a DB-side transaction (no SurrealDB v2
 * support yet) or an extra post-insert re-read + compensating archive.
 * Deferred; acceptable because project-archive is rare and the edge
 * points at an archived project, not a live leak.
 *
 * ADR entities:8ui2s496aa64pla3x5zb §6, Task entities:k33z6xev2jb8spdn5ju9,
 * blocks milestone Skill-Forge-F6.
 */

export class HandoffValidationError extends Error {
  readonly code = 'handoff_validation_failed';
  constructor(readonly field: string, message: string) {
    super(`handoff_validation_failed: ${message}`);
    this.name = 'HandoffValidationError';
  }
}

export interface HandoffPartOfTarget {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
}

export interface HandoffCreationInput {
  readonly attributes: Record<string, unknown> | undefined;
  readonly partOfEntity: HandoffPartOfTarget | null;
  /** Defaults to `'fact'`. Only fact entities can be handoffs. */
  readonly kind?: string;
}

// Matches YYYY-MM-DD or full RFC 3339 timestamps (2026-04-16T15:35:39.023Z).
// Shape check only — calendar validity (no 2026-99-99) is enforced via
// `Date.parse` + `isNaN` after the regex passes.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function isCalendarValid(isoLike: string): boolean {
  // For bare YYYY-MM-DD, append T00:00:00Z so Date treats it as UTC and
  // doesn't get caught by the host's local timezone offset shifting the
  // day backwards across the dateline.
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(isoLike)
    ? `${isoLike}T00:00:00Z`
    : isoLike;
  const ts = Date.parse(normalized);
  if (Number.isNaN(ts)) return false;
  // Date.parse accepts 2026-02-30 on some engines by rolling forward.
  // Reject if the resulting ISO string's date portion differs from the
  // input's date portion.
  const expected = isoLike.slice(0, 10);
  const actual = new Date(ts).toISOString().slice(0, 10);
  return expected === actual;
}

export function isHandoffFact(
  kind: string,
  attributes: Record<string, unknown> | undefined
): boolean {
  if (kind !== 'fact') return false;
  if (!attributes) return false;
  return attributes.session_type === 'handoff';
}

function requireNonEmptyString(
  attributes: Record<string, unknown>,
  field: string
): string {
  const raw = attributes[field];
  if (raw === undefined || raw === null) {
    throw new HandoffValidationError(
      field,
      `handoff-facts require attribute "${field}"`
    );
  }
  if (typeof raw !== 'string') {
    throw new HandoffValidationError(
      field,
      `attribute "${field}" must be a string, got ${typeof raw}`
    );
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new HandoffValidationError(
      field,
      `attribute "${field}" must not be empty`
    );
  }
  return trimmed;
}

export function validateHandoffCreation(input: HandoffCreationInput): void {
  const kind = input.kind ?? 'fact';
  if (!isHandoffFact(kind, input.attributes)) return;
  const attrs = input.attributes as Record<string, unknown>;

  const sessionDate = requireNonEmptyString(attrs, 'session_date');
  if (!ISO_DATE_RE.test(sessionDate) || !isCalendarValid(sessionDate)) {
    throw new HandoffValidationError(
      'session_date',
      `attribute "session_date" must be a valid ISO date (YYYY-MM-DD or RFC 3339), got ${JSON.stringify(sessionDate)}`
    );
  }
  requireNonEmptyString(attrs, 'session_id');
  requireNonEmptyString(attrs, 'agent_id');

  // git_branch is optional. If present, enforce it to be a string so
  // downstream consumers don't have to defend against number/bool types.
  const gitBranch = attrs.git_branch;
  if (gitBranch !== undefined && gitBranch !== null && typeof gitBranch !== 'string') {
    throw new HandoffValidationError(
      'git_branch',
      `attribute "git_branch" must be a string when set, got ${typeof gitBranch}`
    );
  }

  if (!input.partOfEntity) {
    throw new HandoffValidationError(
      'part_of',
      'handoff-facts require a part_of edge to an active project entity — pass part_of to save_entity'
    );
  }
  if (input.partOfEntity.kind !== 'project') {
    throw new HandoffValidationError(
      'part_of',
      `part_of target must be a project entity, got kind=${input.partOfEntity.kind}`
    );
  }
  if (input.partOfEntity.status === 'archived') {
    throw new HandoffValidationError(
      'part_of',
      `part_of project ${input.partOfEntity.id} is archived; point handoff at an active project`
    );
  }
}
