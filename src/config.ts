/**
 * Environment configuration loader.
 *
 * Validates required env vars on startup — fails fast if secrets are missing
 * or still set to placeholder values.
 */

export interface PlexusConfig {
  readonly port: number;
  readonly baseUrl: string;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';

  readonly adminToken: string;
  /** @deprecated Not currently used. Kept for future HMAC cookie signing. */
  readonly oauthSecret: string;
  /** @deprecated Not currently used. Kept for future OAuth code signing. */
  readonly cookieSecret: string;

  readonly surreal: {
    readonly url: string;
    readonly user: string;
    readonly pass: string;
    readonly namespace: string;
    readonly database: string;
  };

  readonly webauthn: {
    readonly rpId: string;
    readonly rpName: string;
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '' || value.startsWith('change-me')) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `See .env.example and generate secrets via: openssl rand -hex 32`
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid number for env var ${name}: "${raw}"`);
  }
  return n;
}

export function loadConfig(): PlexusConfig {
  const logLevel = optional('PLEXUS_LOG_LEVEL', 'info');
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) {
    throw new Error(`Invalid PLEXUS_LOG_LEVEL: ${logLevel}`);
  }

  return {
    port: optionalNumber('PLEXUS_PORT', 8787),
    baseUrl: optional('PLEXUS_BASE_URL', 'http://localhost:8787'),
    logLevel: logLevel as PlexusConfig['logLevel'],

    adminToken: required('PLEXUS_ADMIN_TOKEN'),
    // These two secrets are reserved for future HMAC signing but not
    // yet referenced in any code path. Kept as optional so deployments
    // that already set them don't break, but new setups don't need them.
    oauthSecret: optional('PLEXUS_OAUTH_SECRET', ''),
    cookieSecret: optional('PLEXUS_COOKIE_SECRET', ''),

    surreal: {
      url: optional('PLEXUS_SURREAL_URL', 'ws://surrealdb:8000/rpc'),
      user: required('PLEXUS_SURREAL_USER'),
      pass: required('PLEXUS_SURREAL_PASS'),
      namespace: optional('PLEXUS_SURREAL_NS', 'plexus'),
      database: optional('PLEXUS_SURREAL_DB', 'main'),
    },

    webauthn: {
      rpId: optional('PLEXUS_RP_ID', 'localhost'),
      rpName: optional('PLEXUS_RP_NAME', 'Plexus'),
    },
  };
}
