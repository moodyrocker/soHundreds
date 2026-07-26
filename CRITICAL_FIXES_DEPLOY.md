# Critical Fixes — Deployment Guide

Fixes for §3.1, §3.2 and §3.3 of `CODE_REVIEW_2026-07-26.md`, plus a latent
migration bug found while verifying them.

`docker compose up --build -d` is the whole deploy — the API container migrates
itself on boot, and the worker waits for the schema before starting.

---

## What changed

### §3.1 — Row Level Security on all 19 tables

`supabase/migrations/20260726100000_rls_all_tables.sql`

- Adds `is_org_member(uuid)` and `has_org_role(uuid, text[])` as `SECURITY DEFINER` helpers. This also fixes the pre-existing `org_members_select` policy, which referenced `organization_members` inside its own `USING` clause and would have failed with infinite recursion the moment RLS was relied on.
- Enables RLS on all 19 tables (was 4).
- Adds `FOR ALL` policies with both `USING` and `WITH CHECK` on the 16 organization-scoped tables, so a member of org A can neither read nor insert nor reparent a row into org B.
- `profiles` scoped to `auth.uid()`; `organizations` renameable only by `owner`/`admin`.
- Revokes `anon`/`authenticated` grants on the public schema, and revokes default privileges so future tables don't silently reopen the hole.

The backend is unaffected — it connects as the database owner over `DATABASE_URL`, which bypasses both RLS and these grants.

### §3.2 — Atomic work claiming

`supabase/migrations/20260726110000_atomic_work_claiming.sql` plus code changes.

| File | Change |
|---|---|
| `backend/src/lib/workerIdentity.ts` | New. `INSTANCE_ID`, claim-staleness and batch/concurrency config. |
| `backend/src/lib/concurrency.ts` | New. `mapWithConcurrency` — bounded parallelism, per-item error isolation. |
| `backend/src/workers/autopilotCycleWorker.ts` | `listDueStrategies` → `claimDueStrategies` using `FOR UPDATE SKIP LOCKED`. In-memory `running` Set removed. Adds `releaseClaim`, `reapStaleClaims`, `stopAutopilotCycleWorker`. |
| `backend/src/services/executionService.ts` | Adds `claimExecutionForWrite` / `releaseExecutionClaim`. `approve()` now claims atomically before dispatching to any handler that writes to an external platform. |
| `backend/src/types/execution.ts`, `web/src/lib/execution.ts` | New `executing` status in the lifecycle union. |
| 4 web components | Render `executing` as busy; never offer Approve in that state. |

### §3.3 — Worker in its own container

| File | Change |
|---|---|
| `backend/src/workers/autopilotWorkerMain.ts` | New entrypoint with SIGTERM/SIGINT handling that releases claims on shutdown. |
| `backend/src/index.ts` | API no longer starts the loop. Requires an explicit `AUTOPILOT_CYCLE_WORKER=true` opt-in, and warns loudly if set. |
| `backend/docker-entrypoint.sh` | `CONTAINER_ROLE` selects `api` (migrate + serve) or `worker` (wait for schema + run loop). Only `api` migrates. |
| `docker-compose.yml` | New `worker` service, same image, `stop_grace_period: 60s`. |
| `backend/package.json` | Adds `dev:worker`, `start:worker`, `typecheck`. |

### Bonus — migration runner (found while verifying the above)

`backend/src/database/schema.sql` was a second, hand-maintained source of truth
beside `supabase/migrations/`, and had drifted: 4 tables and 11 columns missing,
plus a foreign key to `action_executions` — a table it never created. That made
it **unappliable to a fresh database**, so a brand-new Supabase project would
have crash-looped the API container. Existing databases never hit it because
`CREATE TABLE IF NOT EXISTS action_run_states` short-circuited before the
dangling reference was evaluated.

| File | Change |
|---|---|
| `backend/src/database/migrate.ts` | Rewritten as a real runner: applies `supabase/migrations/*.sql` in order, once each, per-migration transaction, `schema_migrations` history, advisory lock, checksum drift detection, surfaces DB notices. |
| `backend/src/database/schema.sql` | **Deleted.** Contained nothing the migrations don't. |
| `backend/scripts/apply-pending-migrations.mjs` | **Deleted.** Superseded. |
| `backend/Dockerfile` | Builds from repo root so `supabase/migrations` can be copied in. |
| `docker-compose.yml` | `api`/`worker` build `context: .`, `dockerfile: ./backend/Dockerfile`. |
| `.dockerignore` | Rewritten for the root context; keeps `supabase/migrations` in, excludes `web`/`docs`/`UIHundreds`. Context is 1.7 MB. |
| `scripts/ec2-rsync.filter` | Now ships `supabase/migrations` — it was previously excluded, which would have broken EC2 builds. |
| `MIGRATIONS.md`, `README.md` | New docs. |

`supabase/migrations/` is now the only source of truth.

---

## Deploy

### 1. Rebuild and start — migrations apply themselves

The API container now runs a proper migration runner on boot (see `MIGRATIONS.md`), so there is no manual SQL step.

```bash
docker compose up --build -d
docker compose logs api | grep '\[migrate'
```

Expected on an existing database:

```
[migrate] 33 migration(s) found in /app/supabase/migrations
[migrate] existing database with no migration history — backfilling the full set
[migrate:db] RLS OK — every table in public has row level security enabled.
[migrate] complete — 33 applied, 0 already up to date
```

Every current migration is idempotent, so the backfill is a no-op on everything already present and applies only what's genuinely missing. Subsequent boots print `0 applied, 33 already up to date`.

A `RLS GAP — tables without RLS: ...` line means a table was created outside the migration list. Add it to `20260726100000_rls_all_tables.sql`'s table array in a **new** migration (don't edit the applied one — the runner will warn about the checksum change).

> **Build context changed.** The api/worker image now builds from the repository root, because it needs `supabase/migrations`. Compose handles this; if you build by hand use
> `docker build -f backend/Dockerfile -t hundres-api .` from the repo root, not from inside `backend/`.

### 2. Confirm the claim columns landed

```sql
SELECT version, applied_at FROM schema_migrations ORDER BY version DESC LIMIT 3;

SELECT column_name FROM information_schema.columns
WHERE table_name = 'strategies' AND column_name LIKE 'cycle_claimed%';
-- expect: cycle_claimed_at, cycle_claimed_by
```

The worker container refuses to start without these, so this is also checked automatically.

### 3. Watch the worker come up

```bash
docker compose logs -f worker
```

Expected worker output:

```
[autopilot-worker] starting — instance <host>:<pid>:<uuid>
[autopilot-cycle] agentic worker on — instance ..., cadence from org pace ...,
  batch 10 @ concurrency 3, claim stale after 30m, pending work runs immediately
```

The API should no longer log `[autopilot-cycle] agentic worker on`. If it does, `AUTOPILOT_CYCLE_WORKER=true` is still set somewhere.

### 4. Verify isolation from the browser

In your app's console while logged in:

```js
const { data, error } = await supabase.from('strategies').select('*');
console.log(data, error);
```

Expect `error` with a permission-denied code and `data === null`. Before this change it returned every tenant's strategies.

---

## New environment variables

All optional — the defaults below apply if unset.

| Variable | Default | Purpose |
|---|---|---|
| `CONTAINER_ROLE` | `api` | `api` or `worker`. Set per service in Compose. |
| `AUTOPILOT_CYCLE_CONCURRENCY` | `3` | Strategies processed at once per worker. |
| `AUTOPILOT_CYCLE_BATCH_SIZE` | `10` | Strategies claimed per tick. |
| `AUTOPILOT_CLAIM_STALE_MINUTES` | `30` | When an orphaned claim becomes reclaimable. Must exceed your longest cycle. |
| `AUTOPILOT_CYCLE_WORKER` | unset (off in API) | Set `true` only for a single-process local run with no worker container. |
| `MIGRATIONS_DIR` | auto-detected | Override the migrations path. Only needed for unusual layouts. |

---

## Rollback

Code and Compose changes revert with git. The migrations are additive, but if you need to undo RLS:

```sql
-- Restores the pre-fix (exposed) state. Only as an emergency measure.
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
DO $$ DECLARE t TEXT;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relkind='r'
  LOOP EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t); END LOOP;
END $$;
```

The claim columns can be left in place — the old code ignores them.

---

## Verification performed

All of the following were run against a real PostgreSQL instance, bootstrapped by the new migration runner. **60 assertions, 0 failures.**

**Build**

- `tsc --noEmit` clean on `backend` and `web`
- Full `tsc` build emits `dist/database/migrate.js`, `dist/workers/autopilotWorkerMain.js` and both new lib files
- `sh -n backend/docker-entrypoint.sh` clean; `docker-compose.yml` parses, all env values are strings
- Every `COPY` source in `backend/Dockerfile` resolves from the repo root; `.dockerignore` confirmed not to exclude `supabase/migrations`; simulated build context is 1.7 MB containing all 33 migrations

**Migration runner — 27/27 passed**

- Fresh database: 33 applied, 19 app tables created, exit 0 — this is the case that previously crash-looped the API
- The 4 tables `schema.sql` omitted (`action_executions`, `audit_log`, `goal_week_outcomes`, `plan_action_completions`) all present
- Re-run is a clean no-op: `0 applied, 33 already up to date`
- Adoption of a pre-runner database backfills all 33 and leaves existing data intact
- Editing an applied migration warns with both checksums and does not re-run
- Two runners started simultaneously: both exit 0, exactly one does the work, no duplicate history rows
- A deliberately broken migration exits 1, is named in the log, is not recorded in history, and leaves no partial table
- `schema_migrations` has RLS enabled and is denied to both `anon` and `authenticated`
- The RLS coverage assertion now surfaces in container logs (`[migrate:db] RLS OK — …`); it was previously discarded by node-postgres

**RLS — 15/15 passed**

- `anon` and `authenticated` both denied on `strategies`, `action_executions`, `ad_campaign_library`, `audit_log`, `autopilot_activity`
- With grants deliberately restored, Alice (Org A) sees only Org A's rows and Bob only Org B's — proving RLS is an independent second layer
- Cross-org `INSERT` rejected by `WITH CHECK`; cross-org `UPDATE` and `DELETE` affect zero rows
- `organization_members` select does not recurse
- A `member` cannot rename the organization; `owner`/`admin` can
- Zero public tables without RLS (20 of 20, including `schema_migrations`); 21 policies installed
- Re-verified after bootstrapping via the runner rather than hand-applied SQL

**Concurrency — 9/9 passed**

- 8 simultaneous workers claiming from 12 due strategies: 12 claims, 12 distinct, zero overlap
- A later worker claims nothing while claims are held
- Claims aged past the stale window are reclaimable
- 10 simultaneous approvals of one Meta ad campaign: exactly 1 winner
- `releaseExecutionClaim` returns a pre-flight refusal to `previewed`, and is a no-op once a handler has set `failed`
- Reaper marks an execution `failed` after 3 interrupted attempts instead of retrying an external write forever
- `mapWithConcurrency`: peak concurrency respects the limit, per-item failures isolated, results index-aligned, never rejects

**End-to-end — real worker processes, not simulated SQL**

- Single worker booted against the test database: claimed 4 strategies, processed them at concurrency 2, logged per-strategy failures in isolation, released all 4 claims, exited cleanly on SIGTERM
- **Two worker processes launched simultaneously against 10 due strategies:** claims split 6/4 (and 0/10 on a repeat run), all 10 claimed exactly once, **zero strategies processed twice**, zero claims leaked at shutdown
- API booted with `AUTOPILOT_CYCLE_WORKER` unset: no autopilot loop started. Set to `true`: loop starts with the intended warning

**Negative control** — the same tests run against the *original* logic reproduced both bugs: 4 workers each picked up all 12 strategies (48 selections for 12 strategies), and 9 of 10 concurrent approvals reached the external API call — i.e. 9 live ad campaigns where 1 was intended. Both are what the new code was tested against.

## Not verified

- `npm run lint` on `web` — `node_modules` is macOS-built, so esbuild will not execute in a Linux sandbox. Both typechecks are clean; run lint locally before deploying.
- An actual `docker build` — no Docker daemon available. The build plumbing was verified statically (every `COPY` source resolves, `.dockerignore` keeps migrations, context simulated at 1.7 MB) but the first real build is worth watching.
- Your live Supabase database. Confirm there with the queries in step 2 and the browser check in step 4.
