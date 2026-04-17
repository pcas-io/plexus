/**
 * SurrealDB test harness for integration tests.
 *
 * Strategy:
 *   - If `PLEXUS_TEST_SURREAL_URL` is set (CI or manual), connect to that
 *     server. Assumes a `root`/`root` in-memory engine reachable at the URL.
 *   - Otherwise spawn a throwaway `surrealdb/surrealdb:v2.1` container via
 *     Docker on a free port, started with the in-memory storage backend,
 *     and tear it down on stop().
 *
 * Each harness uses a unique namespace+database so parallel test files
 * never cross-contaminate. Migrations are re-run per namespace; the
 * shipped migrations all use `IF NOT EXISTS` / `INSERT IGNORE`, so they
 * are idempotent.
 *
 * Tests that need the harness should gate on `surrealAvailable()` to
 * skip cleanly on machines without Docker and without a pre-provisioned
 * server — this keeps `npm test` green for every contributor.
 */

import { execFileSync, spawn } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Surreal } from 'surrealdb';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'migrations');

const IMAGE = 'surrealdb/surrealdb:v2.1';
const STARTUP_TIMEOUT_MS = 30_000;

export interface SurrealHarness {
  readonly db: Surreal;
  readonly url: string;
  readonly namespace: string;
  readonly database: string;
  readonly stop: () => Promise<void>;
}

function uniqueSuffix(): string {
  return `${process.pid}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

async function tcpReady(host: string, port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const sock = createConnection({ host, port });
      const done = (result: boolean) => {
        sock.removeAllListeners();
        sock.destroy();
        resolve(result);
      };
      sock.once('connect', () => done(true));
      sock.once('error', () => done(false));
      setTimeout(() => done(false), 500);
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`surrealdb at ${host}:${port} did not accept TCP within ${timeoutMs}ms`);
}

async function httpReady(url: string, timeoutMs: number): Promise<void> {
  // TCP accept ≠ HTTP ready. SurrealDB opens its listener before the
  // HTTP stack fully initialises; connecting clients see "other side
  // closed" if we hand them the URL as soon as TCP succeeds. Poll
  // /health until it answers 2xx.
  const healthUrl = `${url.replace(/\/$/, '')}/health`;
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 500);
      const res = await fetch(healthUrl, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(
    `surrealdb /health at ${healthUrl} did not return 2xx within ${timeoutMs}ms (last error: ${(lastErr as Error)?.message ?? 'none'})`
  );
}

function dockerRunMemoryContainer(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      'run', '-d', '--rm',
      '-p', `127.0.0.1:${port}:8000`,
      IMAGE,
      'start',
      '--user', 'root',
      '--pass', 'root',
      '--bind', '0.0.0.0:8000',
      '--log', 'warn',
      'memory',
    ];
    const proc = spawn('docker', args);
    const stdout: Buffer[] = [];
    let stderr = '';
    proc.stdout.on('data', (c) => stdout.push(c));
    proc.stderr.on('data', (c) => (stderr += c.toString()));
    proc.once('error', reject);
    proc.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(`docker run exited with ${code}: ${stderr.trim()}`));
        return;
      }
      resolve(Buffer.concat(stdout).toString().trim());
    });
  });
}

function dockerStopContainer(id: string): Promise<void> {
  return new Promise((resolve) => {
    const proc = spawn('docker', ['stop', '-t', '1', id], { stdio: 'ignore' });
    proc.once('close', () => resolve());
    proc.once('error', () => resolve());
  });
}

async function applyMigrations(db: Surreal): Promise<void> {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.surql'))
    .sort();
  for (const file of files) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    await db.query(sql);
  }
}

export async function startSurrealMemory(): Promise<SurrealHarness> {
  const namespace = `plexus_test_${uniqueSuffix()}`;
  const database = 'plexus_test';

  const externalUrl = process.env.PLEXUS_TEST_SURREAL_URL;
  if (externalUrl) {
    const db = new Surreal();
    await db.connect(new URL(externalUrl), {
      namespace,
      database,
      authentication: {
        username: process.env.PLEXUS_TEST_SURREAL_USER ?? 'root',
        password: process.env.PLEXUS_TEST_SURREAL_PASS ?? 'root',
      },
    });
    await applyMigrations(db);
    return {
      db,
      url: externalUrl,
      namespace,
      database,
      stop: async () => {
        try { await db.close(); } catch { /* ignore */ }
      },
    };
  }

  const port = await findFreePort();
  const url = `http://127.0.0.1:${port}`;
  const containerId = await dockerRunMemoryContainer(port);
  try {
    await tcpReady('127.0.0.1', port, STARTUP_TIMEOUT_MS);
    await httpReady(url, STARTUP_TIMEOUT_MS);
    const db = new Surreal();
    await db.connect(new URL(url), {
      namespace,
      database,
      authentication: { username: 'root', password: 'root' },
    });
    await applyMigrations(db);
    return {
      db,
      url,
      namespace,
      database,
      stop: async () => {
        try { await db.close(); } catch { /* ignore */ }
        await dockerStopContainer(containerId);
      },
    };
  } catch (err) {
    await dockerStopContainer(containerId);
    throw err;
  }
}

/**
 * Synchronous availability check — returns true if either an external
 * server URL is configured or Docker is reachable. Tests use this to
 * decide whether to skip.
 */
export function surrealAvailable(): boolean {
  if (process.env.PLEXUS_TEST_SURREAL_URL) return true;
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
}
