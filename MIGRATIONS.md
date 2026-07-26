# Database Migrations

`supabase/migrations/` is the single source of truth for the schema.

## How it works

`backend/src/database/migrate.ts` applies every `.sql` file in
`supabase/migrations/`, in filename order, at most once each, and records what it
did in `schema_migrations`.

```
api container boots
   └─ docker-entrypoint.sh (CONTAINER_ROLE=api)
        └─ node dist/database/migrate.js
             ├─ pg_advisory_lock          — serialises concurrent replicas
             ├─ CREATE TABLE IF NOT EXISTS schema_migrations
             ├─ for each file not yet recorded:
             │     BEGIN → apply → INSERT history → COMMIT
             └─ pg_advisory_unlock
```

Properties worth knowing:

- **Applied once.** A migration already in `schema_migrations` is skipped, so boots stay fast and non-idempotent migrations become safe to write.
- **Atomic per file.** Postgres DDL is transactional; a failure part-way leaves nothing half-applied. The runner exits non-zero and the container restart policy surfaces it.
- **Safe with replicas.** An advisory lock means two API containers booting together cannot run the same DDL concurrently. Only the `api` role migrates — `worker` waits for the schema instead.
- **Ordering is chronological.** Filenames are timestamp-prefixed, so lexicographic sort is chronological. Keep the `YYYYMMDDHHMMSS_description.sql` convention.
- **Edits to applied migrations are detected.** The runner stores a checksum. If a recorded file changes on disk it warns and does not re-run.

## Adding a migration

```bash
# Name it with a UTC timestamp so it sorts after everything existing.
touch supabase/migrations/$(date -u +%Y%m%d%H%M%S)_add_widget_table.sql
```

Write idempotent SQL where you reasonably can — `IF NOT EXISTS`, `DROP POLICY IF
EXISTS` before `CREATE POLICY`, `ADD COLUMN IF NOT EXISTS`. The runner no longer
depends on it, but it keeps recovery and manual re-application painless.

Then either restart the API, or run it directly:

```bash
cd backend && npm run db:migrate
```

## Inspecting state

```sql
SELECT version, applied_at, duration_ms
FROM schema_migrations
ORDER BY version;
```

## Existing databases

A database built before this runner existed (via `supabase db push` or the old
`schema.sql`) has no `schema_migrations` table. On first run the runner detects
this, logs `existing database with no migration history — backfilling the full
set`, and executes every migration. Everything already present is a no-op —
all current migrations are idempotent, verified by applying the full set three
times consecutively — and anything genuinely missing is applied. Subsequent
boots skip everything.

No manual baselining is needed.

## Why `schema.sql` was removed

`backend/src/database/schema.sql` used to be applied on every boot as a single
multi-statement query, in parallel with `supabase/migrations/` being the
"real" migration history. Being hand-maintained, it drifted:

- **4 tables missing:** `action_executions`, `audit_log`, `goal_week_outcomes`, `plan_action_completions`
- **11 columns missing**, including `strategies.current_week`, `strategies.pause_until`, `organizations.autopilot_mode`
- **A dangling foreign key:** `action_run_states.execution_id` referenced `action_executions(id)`, a table the file never created

That last one meant `schema.sql` **could not be applied to a fresh database** —
it aborted, and since `migrate.ts` called `process.exit(1)` on failure, a
brand-new Supabase project would have crash-looped the API container. Existing
databases never hit it because `CREATE TABLE IF NOT EXISTS action_run_states`
short-circuited before the reference was evaluated, which is exactly why the bug
went unnoticed.

Two sources of truth with nothing enforcing agreement is the root cause. Now
there is one.

## Escape hatch

If the runner cannot locate the migrations directory (unusual layout, running
outside the container), point it explicitly:

```bash
MIGRATIONS_DIR=/path/to/supabase/migrations npm run db:migrate:prod
```

Or copy them into a running container:

```bash
docker cp supabase/migrations $(docker compose ps -q api):/tmp/migrations
docker compose exec api node dist/database/migrate.js
```

`/tmp/migrations` is one of the paths the runner checks.
