import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { logger } from '../lib/logger.js';

const log = logger('db');

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * TLS for the Postgres connection.
 *
 * This was `{ rejectUnauthorized: false }`, which establishes TLS and then
 * ignores whether the certificate is trusted or matches the host — encrypting
 * the connection while giving up the guarantee that the other end is actually
 * Supabase. Anyone able to intercept the connection could present their own
 * certificate and read every query, including the decrypted OAuth credentials
 * this service reads and writes.
 *
 * Supabase's poolers present certificates chained to a public CA, so Node's
 * bundled trust store verifies them with no extra configuration. A pinned CA
 * file is supported for the direct-connection case (`db.<ref>.supabase.co`),
 * where Supabase issues from its own CA.
 *
 * Resolution order:
 *   1. DATABASE_CA_CERT       — PEM contents inline (suits container secrets)
 *   2. DATABASE_CA_CERT_PATH  — path to a PEM file
 *   3. backend/certs/supabase-ca.crt, if present
 *   4. Node's built-in trust store
 *
 * DATABASE_SSL_INSECURE=true restores the old unverified behaviour. It exists
 * because losing database access in an emergency is worse than a temporary
 * downgrade, but it logs loudly every boot so it cannot be left on quietly.
 */
function resolveCaCert(): { pem: string; source: string } | null {
  const inline = process.env.DATABASE_CA_CERT?.trim();
  if (inline) {
    // Allow a single-line env var with escaped newlines.
    return { pem: inline.replace(/\\n/g, '\n'), source: 'DATABASE_CA_CERT' };
  }

  const candidates = [
    process.env.DATABASE_CA_CERT_PATH?.trim(),
    resolve(__dirname, '../../certs/supabase-ca.crt'), // dist/database -> backend/certs
    resolve(__dirname, '../../../certs/supabase-ca.crt'), // src/database -> backend/certs
  ].filter((p): p is string => Boolean(p));

  for (const path of candidates) {
    if (existsSync(path)) {
      return { pem: readFileSync(path, 'utf8'), source: path };
    }
  }

  return null;
}

function getPoolConfig(): pg.PoolConfig {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  const config: pg.PoolConfig = { connectionString };

  // Supabase (and most hosted Postgres) require SSL.
  const useSsl =
    process.env.DATABASE_SSL === 'true' ||
    connectionString.includes('supabase.co') ||
    connectionString.includes('supabase.com');

  if (!useSsl) return config;

  if (process.env.DATABASE_SSL_INSECURE?.trim().toLowerCase() === 'true') {
    log.warn(
      'DATABASE_SSL_INSECURE=true — TLS certificate verification is DISABLED. ' +
        'The connection is encrypted but unauthenticated, so it can be intercepted. ' +
        'Unset this as soon as the underlying certificate problem is fixed.'
    );
    config.ssl = { rejectUnauthorized: false };
    return config;
  }

  const ca = resolveCaCert();
  if (ca) {
    config.ssl = { rejectUnauthorized: true, ca: ca.pem };
    log.info(`TLS verification on, CA from ${ca.source}`);
  } else {
    // Node's bundled roots. Correct for the Supabase poolers.
    config.ssl = { rejectUnauthorized: true };
  }

  return config;
}

export const pool = new Pool(getPoolConfig());

// A pool error with no listener is an unhandled 'error' event, which crashes the
// process. Idle backends get closed by Supabase's pooler routinely, so this is
// not an exceptional path.
pool.on('error', (err) => {
  log.error('idle client error:', err);
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}
