/**
 * Backup module — exports the plexus graph state to a JSON file.
 *
 * The export format is DB-agnostic: entities + edges + kinds + relations
 * as plain JSON arrays. This is the "portable JSON export" from the
 * Kickoff-ADR Backup-Konzept (Punkt 3) and the SurrealQL Lock-in
 * mitigation (buddy node 01KNEYF2BRCJ147SXPG71YK5YG).
 *
 * Usage:
 *   - Called via GET /admin/backup (Admin-Token required)
 *   - Returns the JSON directly as a download
 *   - Can be run on a cron schedule via curl
 *
 * What's always included:
 *   entities, edges, entity_kinds, relations,
 *   users (without token_hash)
 *
 * What's opt-in only (MOD-6 from the 2026-04-10 audit
 * entities:llclhdhv5a8yyf27xz4v):
 *   activity_log (last 1000 entries) — contains IP addresses, User-Agent
 *   strings and user names, which are personally identifiable data in a
 *   different DSGVO risk bucket than the raw graph content. The audit
 *   log ships only when the caller explicitly passes `?include_audit=1`
 *   on the HTTP endpoint or `{ includeAudit: true }` on the function.
 *   Backing up the audit trail for long-term retention should prefer a
 *   separate, more tightly-controlled storage location.
 *
 * What's never included (these fields either carry credentials or are
 * session state that's meaningful only live):
 *   session state, passkeys, OAuth clients/tokens, share tokens,
 *   personal_tokens
 */

import type { Surreal } from 'surrealdb';
import { VERSION } from './version.js';

export interface BackupData {
  readonly version: string;
  readonly exported_at: string;
  readonly entities: unknown[];
  readonly edges: unknown[];
  readonly entity_kinds: unknown[];
  readonly relations: unknown[];
  readonly users: unknown[];
  /**
   * Only present when `createBackup()` was called with
   * `{ includeAudit: true }`. See module docstring for the rationale.
   */
  readonly activity_log?: unknown[];
}

export interface BackupOptions {
  /**
   * Include the last 1000 activity_log entries in the backup. Default
   * `false` — opt-in because the rows contain personal data.
   */
  readonly includeAudit?: boolean;
}

export async function createBackup(
  db: Surreal,
  options: BackupOptions = {},
): Promise<BackupData> {
  const [entitiesR, edgesR, kindsR, relationsR, usersR] = await Promise.all([
    db.query<[unknown[]]>('SELECT * FROM entities;'),
    db.query<[unknown[]]>('SELECT * FROM edges;'),
    db.query<[unknown[]]>('SELECT * FROM entity_kinds;'),
    db.query<[unknown[]]>('SELECT * FROM relations;'),
    // Exclude token_hash from the user export.
    db.query<[unknown[]]>(
      'SELECT id, name, is_active, is_admin, created_at, updated_at FROM users;',
    ),
  ]);

  const base: BackupData = {
    version: VERSION,
    exported_at: new Date().toISOString(),
    entities: entitiesR[0] ?? [],
    edges: edgesR[0] ?? [],
    entity_kinds: kindsR[0] ?? [],
    relations: relationsR[0] ?? [],
    users: usersR[0] ?? [],
  };

  if (!options.includeAudit) {
    return base;
  }

  const activityR = await db.query<[unknown[]]>(
    'SELECT * FROM activity_log ORDER BY timestamp DESC LIMIT 1000;',
  );
  return { ...base, activity_log: activityR[0] ?? [] };
}
