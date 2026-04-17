/**
 * Admin HTTP routes — requires PLEXUS_ADMIN_TOKEN.
 *
 * These routes manage users and tokens. They are NOT exposed via MCP —
 * plexus never lets agents manage users, only humans with the admin token
 * (and, in Schritt 2b, step-up passkey auth on critical actions).
 */

import { Hono } from 'hono';
import type { Surreal } from 'surrealdb';
import type { PlexusConfig } from '../config.js';
import type { UserRepository } from '../db/repositories/users.js';
import { requireAdminToken } from '../auth/middleware.js';
import { createBackup } from '../backup.js';

interface CreateUserBody {
  readonly name?: unknown;
  readonly is_admin?: unknown;
}

interface ResetBody {
  readonly confirm?: unknown;
}

// Tables the reset endpoint wipes. entity_kinds and relations are NOT
// in this list — they are registry tables populated by migration 0002
// and should survive a dev reset so kinds/relations stay available.
const RESET_TABLES = [
  'users',
  'user_sessions',
  'user_passkeys',
  'personal_tokens',
  'entities',
  'edges',
  'share_tokens',
  'activity_log',
];

export function adminRoutes(
  cfg: PlexusConfig,
  users: UserRepository,
  db: Surreal
): Hono {
  const app = new Hono();

  // All admin routes require the admin token.
  app.use('*', requireAdminToken(cfg));

  // POST /admin/db-reset — DEV-ONLY: wipe all user-state tables so the
  // dashboard can be re-tested from a clean slate. Requires the admin
  // token AND an explicit confirm phrase in the body so it cannot be
  // triggered by accident. Leaves the registry tables (entity_kinds,
  // relations) intact.
  //
  // Usage:
  //   curl -X POST -H "Authorization: Bearer $PLEXUS_ADMIN_TOKEN" \
  //        -H "Content-Type: application/json" \
  //        -d '{"confirm":"RESET ALL USER STATE"}' \
  //        https://<your-plexus-host>/admin/db-reset
  // POST /admin/auth-reset — wipe ONLY auth state (users, sessions,
  // passkeys, personal_tokens) but keep content (entities, edges,
  // activity_log, share_tokens, oauth_clients/tokens).
  // GET /admin/backup — export the graph content as portable JSON.
  // Can be called from a cron job:
  //   curl -H "Authorization: Bearer $PLEXUS_ADMIN_TOKEN" \
  //        https://<your-plexus-host>/admin/backup > backup-$(date +%Y%m%d).json
  //
  // Default response contains entities, edges, entity_kinds, relations,
  // and users (without token_hash). Pass `?include_audit=1` to also
  // include the last 1000 activity_log rows — opt-in per MOD-6 from
  // the 2026-04-10 audit (entities:llclhdhv5a8yyf27xz4v) because the
  // audit trail contains personally identifiable data (IP, UA, user
  // name) that should be backed up under a tighter retention policy
  // than the raw graph.
  app.get('/backup', async (c) => {
    try {
      const includeAudit = c.req.query('include_audit') === '1';
      const data = await createBackup(db, { includeAudit });
      const dateSlice = data.exported_at.slice(0, 10);
      const filename = includeAudit
        ? `plexus-backup-with-audit-${dateSlice}.json`
        : `plexus-backup-${dateSlice}.json`;
      c.header('Content-Disposition', `attachment; filename="${filename}"`);
      return c.json(data);
    } catch (err) {
      console.error('[admin/backup] failed:', err);
      return c.json({ error: 'backup_failed', message: (err as Error).message }, 500);
    }
  });

  app.post('/auth-reset', async (c) => {
    let body: ResetBody;
    try { body = (await c.req.json()) as ResetBody; } catch { return c.json({ error: 'invalid_json' }, 400); }
    if (body.confirm !== 'RESET AUTH STATE') {
      return c.json({
        error: 'confirm_required',
        message: 'Pass {"confirm":"RESET AUTH STATE"} to wipe users, sessions, passkeys and personal_tokens. Content (entities, edges) stays intact.',
      }, 400);
    }
    const authTables = ['users', 'user_sessions', 'user_passkeys', 'personal_tokens'];
    const deleted: Record<string, number> = {};
    for (const table of authTables) {
      try {
        const countResult = await db.query<[Array<{ count: number }>]>(
          `SELECT count() AS count FROM ${table} GROUP ALL;`
        );
        const before = (countResult[0] ?? [])[0]?.count ?? 0;
        await db.query(`DELETE ${table};`);
        deleted[table] = before;
      } catch (err) {
        console.error(`[admin/auth-reset] failed on table ${table}:`, err);
        deleted[table] = -1;
      }
    }
    console.warn('[admin/auth-reset] wiped auth state:', deleted);
    return c.json({ ok: true, deleted, note: 'Content (entities, edges, activity_log) was intentionally preserved.' });
  });

  app.post('/db-reset', async (c) => {
    let body: ResetBody;
    try {
      body = (await c.req.json()) as ResetBody;
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    if (body.confirm !== 'RESET ALL USER STATE') {
      return c.json(
        {
          error: 'confirm_required',
          message:
            'Pass {"confirm":"RESET ALL USER STATE"} to wipe users, sessions, passkeys, entities, edges, share_tokens and activity_log.',
        },
        400
      );
    }

    const deleted: Record<string, number> = {};
    for (const table of RESET_TABLES) {
      try {
        // SurrealDB v2: count rows first, then DELETE <table>; which
        // removes every row but keeps the table definition and its
        // indices. Two separate queries keeps the result typing simple.
        const countResult = await db.query<[Array<{ count: number }>]>(
          `SELECT count() AS count FROM ${table} GROUP ALL;`
        );
        const before = (countResult[0] ?? [])[0]?.count ?? 0;
        await db.query(`DELETE ${table};`);
        deleted[table] = before;
      } catch (err) {
        console.error(`[admin/db-reset] failed on table ${table}:`, err);
        deleted[table] = -1;
      }
    }

    console.warn('[admin/db-reset] wiped user state:', deleted);
    return c.json({
      ok: true,
      deleted,
      note: 'Registry tables (entity_kinds, relations) were intentionally left intact.',
    });
  });

  // GET /admin/users — list all users (without token hashes).
  app.get('/users', async (c) => {
    const list = await users.list();
    return c.json({ users: list });
  });

  // POST /admin/users — create a new user; returns the plaintext token ONCE.
  app.post('/users', async (c) => {
    let body: CreateUserBody;
    try {
      body = (await c.req.json()) as CreateUserBody;
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    if (typeof body?.name !== 'string' || body.name.trim().length === 0) {
      return c.json(
        { error: 'invalid_input', message: 'name is required and must be a non-empty string' },
        400
      );
    }
    if (body.name.length > 64) {
      return c.json({ error: 'invalid_input', message: 'name too long (max 64)' }, 400);
    }

    const isAdmin = typeof body.is_admin === 'boolean' ? body.is_admin : false;

    try {
      const result = await users.create(body.name.trim(), isAdmin);
      return c.json(
        {
          user: result.user,
          token: result.token,
          warning: 'This token is shown ONCE. Store it in a password manager now — it cannot be retrieved later.',
        },
        201
      );
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('already exists') || msg.includes('Duplicated')) {
        return c.json({ error: 'user_exists' }, 409);
      }
      console.error('[admin] create user error:', err);
      return c.json({ error: 'internal_error' }, 500);
    }
  });

  // POST /admin/users/:name/reset-token — rotate a user's token.
  app.post('/users/:name/reset-token', async (c) => {
    const name = c.req.param('name');
    const result = await users.resetToken(name);
    if (!result) return c.json({ error: 'not_found' }, 404);
    return c.json({
      user: result.user,
      token: result.token,
      warning: 'This token is shown ONCE. The previous token has been invalidated immediately.',
    });
  });

  // DELETE /admin/users/:name — deactivate (soft delete). Deactivated users
  // cannot reactivate — a new account must be created.
  app.delete('/users/:name', async (c) => {
    const name = c.req.param('name');
    const user = await users.deactivate(name);
    if (!user) return c.json({ error: 'not_found' }, 404);
    return c.json({ user });
  });

  return app;
}
