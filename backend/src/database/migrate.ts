// Must precede any import that reads process.env at module scope
// (connection.ts constructs its Pool eagerly).
import '../lib/loadEnv.js';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './connection.js';

/**
 * Migration runner.
 *
 * Replaces the previous implementation, which applied a single hand-maintained
 * `schema.sql` as one multi-statement query on every boot. Two problems with
 * that:
 *
 *   1. `schema.sql` was a second, informal source of truth alongside
 *      `supabase/migrations/`, and had drifted badly — 4 missing tables
 *      (action_executions, audit_log, goal_week_outcomes,
 *      plan_action_completions) and 11 missing columns. It also declared a
 *      foreign key to action_executions, a table it never created, so applying
 *      it to a *fresh* database aborted. Existing databases were unaffected only
 *      because `CREATE TABLE IF NOT EXISTS action_run_states` short-circuited
 *      before the dangling reference was evaluated — which is why the bug stayed
 *      hidden.
 *   2. Nothing recorded what had run, so every boot re-executed everything and a
 *      genuinely non-idempotent migration could never be added safely.
 *
 * `supabase/migrations/` is now the only source of truth. Each file is applied at
 * most once, in filename order, inside its own transaction, and recorded in
 * `schema_migrations`.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Serialises concurrent runners. Arbitrary but fixed application-level key. */
const ADVISORY_LOCK_KEY = '8276411903552001';

type MigrationFile = { version: string; path: string; sql: string; checksum: string };

/**
 * Locates `supabase/migrations` across the layouts it is reached from:
 * `tsx src/database/migrate.ts` in the repo, and `node dist/database/migrate.js`
 * in the container.
 */
function resolveMigrationsDir(): string {
  const override = process.env.MIGRATIONS_DIR?.trim();
  const candidates = [
    ...(override ? [override] : []),
    resolve(__dirname, '../../../supabase/migrations'), // backend/src/database -> repo root
    resolve(__dirname, '../../supabase/migrations'), // /app/dist/database -> /app
    resolve(process.cwd(), 'supabase/migrations'),
    resolve(process.cwd(), '../supabase/migrations'),
    '/tmp/migrations', // matches the `docker cp` escape hatch documented in the README
  ];

  for (const dir of candidates) {
    if (existsSync(dir) && readdirSync(dir).some((f) => f.endsWith('.sql'))) {
      return dir;
    }
  }

  throw new Error(
    'Could not locate supabase/migrations. Tried:\n' +
      candidates.map((c) => `  - ${c}`).join('\n') +
      '\nSet MIGRATIONS_DIR to point at it explicitly.'
  );
}

function loadMigrations(dir: string): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    // Filenames are timestamp-prefixed, so lexicographic order is chronological.
    .sort((a, b) => a.localeCompare(b))
    .map((file) => {
      const path = join(dir, file);
      const sql = readFileSync(path, 'utf8');
      return {
        version: file,
        path,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex').slice(0, 16),
      };
    });
}

async function tableExists(qualified: string): Promise<boolean> {
  const result = await pool.query<{ present: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS present`,
    [qualified]
  );
  return result.rows[0]?.present === true;
}

async function migrate(): Promise<void> {
  const dir = resolveMigrationsDir();
  const migrations = loadMigrations(dir);

  if (migrations.length === 0) {
    throw new Error(`No .sql migrations found in ${dir}`);
  }

  console.log(`[migrate] ${migrations.length} migration(s) found in ${dir}`);

  // Supabase's transaction pooler (port 6543) multiplexes statements from one
  // client across different backend sessions, so a session-scoped
  // pg_advisory_lock held across the whole run is not reliable there — it could
  // be taken on one backend and released on another. Detect it and fall back to
  // pg_advisory_xact_lock, which is scoped to a transaction and therefore stays
  // on a single backend under transaction pooling.
  //
  // The session pooler (5432) and direct connections support either.
  const isTransactionPooler = /pooler\.supabase\.com:6543/.test(process.env.DATABASE_URL ?? '');
  if (isTransactionPooler) {
    console.warn(
      '[migrate] transaction pooler detected (:6543) — using per-migration transaction locks. ' +
        'For migrations prefer the session pooler (:5432) or a direct connection.'
    );
  }

  const client = await pool.connect();
  try {
    // Surface NOTICE / WARNING raised by migrations. node-postgres discards these
    // by default, which would silently swallow the RLS coverage assertion at the
    // end of 20260726100000_rls_all_tables.sql — the one place a schema problem
    // announces itself during a container boot.
    client.on('notice', (notice) => {
      const text = notice.message ?? String(notice);
      const level = (notice.severity ?? '').toUpperCase();
      if (level === 'WARNING' || level === 'EXCEPTION') {
        console.warn(`[migrate:db] ${level}: ${text}`);
      } else if (/RLS OK|RLS GAP/i.test(text)) {
        console.log(`[migrate:db] ${text}`);
      }
      // Routine "already exists, skipping" notices stay suppressed — the
      // migrations are idempotent by design and would otherwise emit hundreds.
    });

    if (!isTransactionPooler) {
      await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    }

    const historyExisted = await tableExists('public.schema_migrations');

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     TEXT PRIMARY KEY,
        checksum    TEXT NOT NULL,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        duration_ms INTEGER
      )
    `);

    // This table is created by the runner rather than by a migration, so the
    // blanket RLS work in 20260726100000_rls_all_tables.sql cannot cover it —
    // and its coverage assertion would flag it as a gap on every boot.
    //
    // RLS with no policies denies all access to non-owner roles, which is
    // exactly right: migration history is operational metadata that only the
    // backend (connecting as owner) should ever read.
    await client.query('ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY');
    await client.query('REVOKE ALL ON schema_migrations FROM PUBLIC');

    if (!historyExisted && (await tableExists('public.organizations'))) {
      // Database was built by `supabase db push` or the old schema.sql path,
      // before this runner existed. Run the full set rather than assuming which
      // migrations had already been applied: every current migration is
      // idempotent (verified by applying the whole set three times in a row), so
      // anything already present is a no-op and anything genuinely missing lands.
      console.log(
        '[migrate] existing database with no migration history — backfilling the full set'
      );
    }

    const appliedRows = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations'
    );
    const applied = new Map(appliedRows.rows.map((r) => [r.version, r.checksum]));

    let ran = 0;
    let skipped = 0;

    for (const m of migrations) {
      const priorChecksum = applied.get(m.version);

      if (priorChecksum !== undefined) {
        if (priorChecksum !== m.checksum) {
          // The repo and the database disagree about an already-applied
          // migration. Warn rather than silently re-running, which could be
          // destructive.
          console.warn(
            `[migrate] WARNING ${m.version} changed after it was applied ` +
              `(recorded ${priorChecksum}, on disk ${m.checksum}). Not re-running — ` +
              `add a new migration instead of editing an applied one.`
          );
        }
        skipped++;
        continue;
      }

      const started = Date.now();
      try {
        // Postgres DDL is transactional, so a failure part-way through leaves no
        // half-applied migration behind.
        await client.query('BEGIN');

        if (isTransactionPooler) {
          // Transaction-scoped lock: safe under transaction pooling, released
          // automatically at COMMIT/ROLLBACK. A competing runner blocks here,
          // then finds the version already recorded and skips it via the
          // ON CONFLICT below.
          await client.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_KEY]);

          // Re-check inside the lock — another runner may have applied it while
          // we waited.
          const recheck = await client.query(
            'SELECT 1 FROM schema_migrations WHERE version = $1',
            [m.version]
          );
          if (recheck.rowCount && recheck.rowCount > 0) {
            await client.query('COMMIT');
            skipped++;
            continue;
          }
        }

        await client.query(m.sql);
        await client.query(
          `INSERT INTO schema_migrations (version, checksum, duration_ms)
           VALUES ($1, $2, $3)
           ON CONFLICT (version) DO UPDATE
             SET checksum = EXCLUDED.checksum,
                 applied_at = NOW(),
                 duration_ms = EXCLUDED.duration_ms`,
          [m.version, m.checksum, Date.now() - started]
        );
        await client.query('COMMIT');
        console.log(`[migrate] applied ${m.version} (${Date.now() - started}ms)`);
        ran++;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(
          `[migrate] FAILED ${m.version}: ${err instanceof Error ? err.message : err}`
        );
        throw err;
      }
    }

    console.log(`[migrate] complete — ${ran} applied, ${skipped} already up to date`);
  } finally {
    // xact locks release themselves at COMMIT/ROLLBACK; only the session lock
    // needs an explicit unlock.
    if (!isTransactionPooler) {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => {});
    }
    client.release();
  }
}

migrate()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('[migrate] migration failed:', err instanceof Error ? err.message : err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
