-- =============================================================================
-- Post-migration health check — single consolidated report
-- =============================================================================
-- Read-only. Works in the Supabase SQL Editor and in psql:
--   psql "$DATABASE_URL" -f supabase/verify_state.sql
--
-- Returns one row per check. Scan the `status` column: everything should be OK.
-- =============================================================================

WITH
tables AS (
  SELECT c.relname, c.relrowsecurity
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
),
checks AS (

  -- 1. Migration history -----------------------------------------------------
  SELECT 1 AS ord, 'migrations' AS area, 'total applied' AS check_name,
    count(*)::text AS detail,
    CASE WHEN count(*) >= 33 THEN 'OK' ELSE 'CHECK — expected >= 33' END AS status
  FROM schema_migrations

  UNION ALL
  SELECT 2, 'migrations', 'RLS migration applied',
    COALESCE(max(applied_at)::timestamp(0)::text, 'never'),
    CASE WHEN count(*) = 1 THEN 'OK' ELSE 'FAIL — not applied' END
  FROM schema_migrations WHERE version = '20260726100000_rls_all_tables.sql'

  UNION ALL
  SELECT 3, 'migrations', 'claim-columns migration applied',
    COALESCE(max(applied_at)::timestamp(0)::text, 'never'),
    CASE WHEN count(*) = 1 THEN 'OK' ELSE 'FAIL — not applied' END
  FROM schema_migrations WHERE version = '20260726110000_atomic_work_claiming.sql'

  -- 2. RLS coverage (§3.1) ---------------------------------------------------
  UNION ALL
  SELECT 10, 'rls', 'tables with RLS enabled',
    count(*) FILTER (WHERE relrowsecurity) || ' of ' || count(*),
    CASE WHEN count(*) FILTER (WHERE NOT relrowsecurity) = 0
         THEN 'OK' ELSE 'FAIL — see unprotected_tables below' END
  FROM tables

  UNION ALL
  SELECT 11, 'rls', 'unprotected tables',
    COALESCE(string_agg(relname, ', ' ORDER BY relname), 'none'),
    CASE WHEN count(*) = 0 THEN 'OK' ELSE 'FAIL' END
  FROM tables WHERE NOT relrowsecurity

  UNION ALL
  SELECT 12, 'rls', 'policies installed',
    count(*) || ' across ' || count(DISTINCT tablename) || ' tables',
    CASE WHEN count(*) >= 19 THEN 'OK' ELSE 'CHECK — expected ~21' END
  FROM pg_policies WHERE schemaname = 'public'

  -- 3. Grants (§3.1, second layer) -------------------------------------------
  UNION ALL
  SELECT 20, 'grants', 'tables reachable by anon',
    count(*)::text,
    CASE WHEN count(*) = 0 THEN 'OK' ELSE 'FAIL — reachable with the public anon key' END
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND grantee = 'anon'

  UNION ALL
  SELECT 21, 'grants', 'tables reachable by authenticated',
    count(*)::text,
    CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK — RLS still scopes rows, but direct access is open' END
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND grantee = 'authenticated'

  UNION ALL
  SELECT 22, 'grants', 'membership helpers executable',
    count(*) || ' of 2',
    CASE WHEN count(*) = 2 THEN 'OK' ELSE 'FAIL — policies cannot evaluate' END
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN ('is_org_member','has_org_role')
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')

  -- 4. Atomic claiming (§3.2) ------------------------------------------------
  UNION ALL
  SELECT 30, 'claiming', 'claim columns present',
    count(*) || ' of 5',
    CASE WHEN count(*) = 5 THEN 'OK' ELSE 'FAIL — worker will refuse to start' END
  FROM information_schema.columns
  WHERE table_schema = 'public' AND (
    (table_name = 'strategies' AND column_name IN ('cycle_claimed_at','cycle_claimed_by'))
    OR (table_name = 'action_executions' AND column_name IN ('claimed_at','claimed_by','attempt_count')))

  -- 5. Tables the old schema.sql omitted -------------------------------------
  UNION ALL
  SELECT 40, 'schema', 'previously-missing tables',
    count(*) || ' of 4',
    CASE WHEN count(*) = 4 THEN 'OK' ELSE 'FAIL' END
  FROM tables
  WHERE relname IN ('action_executions','audit_log','goal_week_outcomes','plan_action_completions')

  -- 6. Live autopilot state --------------------------------------------------
  UNION ALL
  SELECT 50, 'runtime', 'strategies (total / active)',
    count(*) || ' / ' || count(*) FILTER (WHERE status = 'active'),
    'INFO'
  FROM strategies

  UNION ALL
  SELECT 51, 'runtime', 'strategies currently claimed',
    count(*) FILTER (WHERE cycle_claimed_by IS NOT NULL)::text,
    'INFO'
  FROM strategies

  UNION ALL
  SELECT 52, 'runtime', 'stale claims (> 30 min)',
    count(*)::text,
    CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK — reaper should clear these next tick' END
  FROM strategies
  WHERE cycle_claimed_at IS NOT NULL AND cycle_claimed_at < NOW() - interval '30 minutes'

  UNION ALL
  SELECT 53, 'runtime', 'executions stuck mid-write',
    count(*)::text,
    CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK — verify upstream state before retrying' END
  FROM action_executions
  WHERE status = 'executing' AND claimed_at < NOW() - interval '30 minutes'

  UNION ALL
  SELECT 54, 'runtime', 'executions by status',
    COALESCE((SELECT string_agg(s || '=' || n, ', ' ORDER BY n DESC)
              FROM (SELECT status AS s, count(*) AS n FROM action_executions GROUP BY status) x),
             'none yet'),
    'INFO'
)
SELECT area, check_name, detail, status
FROM checks
ORDER BY ord;
