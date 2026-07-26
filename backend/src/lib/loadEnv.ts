import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/**
 * Loads environment files for every backend entrypoint.
 *
 * Replaces bare `import 'dotenv/config'`, which reads only `$CWD/.env` and never
 * looks anywhere else. That produced a genuinely confusing failure: a stale
 * `backend/.env` pointing at `localhost:5432/seo_hundreds` silently shadowed the
 * real root `.env`, so `npm run db:migrate` from `backend/` tried to reach a
 * local Postgres and failed with `role "postgres" does not exist` — nothing in
 * the error hinted that the wrong file had been loaded.
 *
 * Now both locations are checked and the resolved list is logged, so shadowing is
 * visible instead of silent.
 *
 * Precedence: first file to define a key wins (dotenv never overwrites an
 * already-set value, and real environment variables always beat both files).
 *
 *   1. process.env        — Docker `env_file`, CI, shell exports
 *   2. backend/.env       — optional local override
 *   3. <repo root>/.env   — the shared source of truth
 *
 * Beware that keys duplicated between the two files with different values are a
 * hazard, not a feature — ENCRYPTION_KEY in particular, since it decrypts stored
 * OAuth credentials and a mismatch makes them permanently unreadable. Prefer
 * keeping only the root file.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

function candidatePaths(): string[] {
  // src/lib -> backend, and dist/lib -> /app in the container.
  const backendDir = resolve(__dirname, '../..');
  const repoRoot = resolve(backendDir, '..');

  return [
    resolve(process.cwd(), '.env'),
    resolve(backendDir, '.env'),
    resolve(repoRoot, '.env'),
  ].filter((p, i, all) => all.indexOf(p) === i); // de-duplicate
}

let loaded: string[] | null = null;

export function loadEnv(): string[] {
  if (loaded) return loaded;

  const found: string[] = [];
  for (const path of candidatePaths()) {
    if (!existsSync(path)) continue;
    dotenv.config({ path });
    found.push(path);
  }

  if (found.length === 0) {
    // Not fatal: Docker and CI inject variables directly. Whatever is genuinely
    // required fails later with a specific message (e.g. 'DATABASE_URL is required').
    console.warn('[env] no .env file found — relying on the process environment');
  } else if (found.length > 1) {
    console.warn(
      `[env] multiple .env files loaded, earlier wins: ${found.join(' > ')}. ` +
        'Duplicate keys with different values will shadow silently — consider keeping only the root .env.'
    );
  } else {
    console.log(`[env] loaded ${found[0]}`);
  }

  loaded = found;
  return found;
}

loadEnv();
