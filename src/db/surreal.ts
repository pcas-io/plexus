/**
 * SurrealDB connection helper with startup retry.
 *
 * Uses surrealdb v2 client API: connect() takes URL + ConnectOptions with
 * namespace, database, and authentication in one call. The resulting Surreal
 * instance is also a Session (via inheritance), so query() is available
 * directly on it.
 *
 * Lock-in mitigation: this file is the only place in plexus that imports
 * from 'surrealdb' directly. All repositories take a Surreal reference.
 */

import { createConnection } from 'node:net';
import { lookup } from 'node:dns/promises';
import { Surreal } from 'surrealdb';
import type { PlexusConfig } from '../config.js';

/**
 * DNS lookup diagnostic — logs what a hostname resolves to.
 * Used once at startup to trace network issues.
 */
async function dnsDiagnostic(hostname: string): Promise<void> {
  try {
    const result = await lookup(hostname, { all: true });
    console.log(`[surreal] dns ${hostname} →`, JSON.stringify(result));
  } catch (err) {
    console.log(`[surreal] dns ${hostname} → LOOKUP FAILED: ${(err as Error).message}`);
  }
}

/**
 * Raw TCP reachability test. Used as diagnostic before the full Surreal
 * connect — if this fails, the issue is network/DNS, not the client.
 */
async function tcpPing(host: string, port: number, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

export interface SurrealConnection {
  readonly db: Surreal;
  readonly close: () => Promise<void>;
}

const CONNECT_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function attemptConnect(config: PlexusConfig['surreal']): Promise<Surreal> {
  // SurrealDB v2 client accepts URL without /rpc — it appends the path itself.
  // Strip trailing /rpc and upgrade ws:// to http:// (v2 client handles the
  // upgrade internally and http:// is more reliable on Docker networks).
  const cleanUrl = config.url.replace(/\/rpc\/?$/, '').replace(/^ws(s?):/, 'http$1:');
  const parsed = new URL(cleanUrl);

  // Diagnostic: DNS lookup + raw TCP reachability before the full connect.
  await dnsDiagnostic(parsed.hostname);
  // Try a few alternate hostnames too in case service-name DNS is broken.
  if (parsed.hostname === 'surrealdb') {
    await dnsDiagnostic('surrealdb.plexus_net');
    await dnsDiagnostic('plexus-surrealdb');
  }
  const port = parsed.port ? Number.parseInt(parsed.port, 10) : 80;
  const tcpOk = await tcpPing(parsed.hostname, port);
  console.log(
    `[surreal] tcp ping ${parsed.hostname}:${port} → ${tcpOk ? 'reachable' : 'UNREACHABLE'}`
  );
  if (!tcpOk) {
    throw new Error(`TCP unreachable: ${parsed.hostname}:${port}`);
  }

  console.log(
    `[surreal] attempting connect to ${cleanUrl} (ns=${config.namespace}, db=${config.database})`
  );
  const db = new Surreal();
  await withTimeout(
    db.connect(parsed, {
      namespace: config.namespace,
      database: config.database,
      authentication: {
        username: config.user,
        password: config.pass,
      },
    }),
    CONNECT_TIMEOUT_MS,
    'db.connect'
  );
  return db;
}

export async function connectSurreal(
  config: PlexusConfig['surreal'],
  maxAttempts = 30,
  delayMs = 2000
): Promise<SurrealConnection> {
  let lastErr: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const db = await attemptConnect(config);
      if (attempt > 1) {
        console.log(`[surreal] connected on attempt ${attempt}/${maxAttempts}`);
      } else {
        console.log('[surreal] connected');
      }
      return {
        db,
        close: async () => {
          await db.close();
        },
      };
    } catch (err) {
      lastErr = err;
      const msg = (err as Error)?.message ?? String(err);
      if (attempt < maxAttempts) {
        console.log(
          `[surreal] connect attempt ${attempt}/${maxAttempts} failed (${msg}), retrying in ${delayMs}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } else {
        console.error(`[surreal] final attempt ${attempt} failed:`, err);
      }
    }
  }

  throw new Error(
    `Failed to connect to SurrealDB after ${maxAttempts} attempts: ${(lastErr as Error)?.message ?? lastErr}`
  );
}
