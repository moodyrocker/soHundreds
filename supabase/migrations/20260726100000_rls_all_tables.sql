-- =============================================================================
-- CRITICAL SECURITY FIX — Row Level Security on every tenant table
-- =============================================================================
--
-- Problem this fixes:
--   RLS was enabled on only 4 of 19 tables (profiles, organizations,
--   organization_members, mcp_connections). No GRANT/REVOKE statements existed
--   anywhere, so Supabase's default grants to the `anon` and `authenticated`
--   roles applied to every table in the `public` schema.
--
--   Supabase exposes the public schema through PostgREST at the project URL.
--   Both NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are, by
--   design, present in the browser bundle. Any person who signed up could
--   therefore read and write every other tenant's strategies, ad campaigns,
--   executions and audit log directly — bypassing authMiddleware and
--   tenantMiddleware entirely, because those guard the Express API, not the
--   database.
--
-- What this migration does:
--   1. Adds a SECURITY DEFINER membership helper (also fixes the infinitely
--      recursive organization_members SELECT policy from 20250523000000).
--   2. Enables RLS on all 19 tables.
--   3. Adds org-membership policies for the 16 organization-scoped tables.
--   4. Revokes anon/authenticated PostgREST grants on the public schema.
--
-- The backend is unaffected: it connects over DATABASE_URL as the database
-- owner, which bypasses RLS and is not subject to these grants.
--
-- Idempotent — safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Membership helper
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER + a stable signature lets policies test membership without
-- re-entering RLS on organization_members. The previous org_members_select
-- policy referenced organization_members inside its own USING clause, which
-- Postgres evaluates recursively — it would error at query time once RLS was
-- being relied on. Routing every check through this function removes that.

CREATE OR REPLACE FUNCTION public.is_org_member(org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE organization_id = org_id
      AND user_id = auth.uid()
  );
$$;

COMMENT ON FUNCTION public.is_org_member(UUID) IS
  'True when the current Supabase auth user is a member of the given organization. SECURITY DEFINER to avoid recursive RLS evaluation on organization_members.';

CREATE OR REPLACE FUNCTION public.has_org_role(org_id UUID, roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE organization_id = org_id
      AND user_id = auth.uid()
      AND role = ANY(roles)
  );
$$;

COMMENT ON FUNCTION public.has_org_role(UUID, TEXT[]) IS
  'True when the current Supabase auth user holds one of the given roles in the organization.';

REVOKE ALL ON FUNCTION public.is_org_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_org_role(UUID, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_org_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_org_role(UUID, TEXT[]) TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. Enable RLS everywhere
-- -----------------------------------------------------------------------------
-- Enabling RLS with no matching policy denies all access to non-owner roles,
-- which is the correct default. Policies below re-open only what belongs to
-- the caller's organizations.

DO $$
DECLARE
  t TEXT;
  all_tables TEXT[] := ARRAY[
    'organizations',
    'organization_members',
    'profiles',
    'mcp_connections',
    'strategies',
    'checkup_reports',
    'plan_action_completions',
    'audit_log',
    'action_executions',
    'action_run_states',
    'block_run_states',
    'action_outcomes',
    'autopilot_activity',
    'goal_week_outcomes',
    'learning_patterns',
    'content_recipes',
    'brand_visual_assets',
    'ad_campaign_library',
    'runway_prompt_tests'
  ];
BEGIN
  FOREACH t IN ARRAY all_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      -- FORCE also applies RLS to the table owner. We deliberately do NOT set
      -- this: the backend connects as owner over DATABASE_URL and must retain
      -- unrestricted access for cross-org worker queries.
    ELSE
      RAISE NOTICE 'RLS skip — table public.% does not exist', t;
    END IF;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Policies — organization-scoped tables
-- -----------------------------------------------------------------------------
-- All 16 of these carry an organization_id column, so one uniform policy shape
-- covers them. FOR ALL with both USING (read/update/delete visibility) and
-- WITH CHECK (insert/update payload validation) prevents a member of org A
-- from inserting or reparenting a row into org B.

DO $$
DECLARE
  t TEXT;
  org_tables TEXT[] := ARRAY[
    'mcp_connections',
    'strategies',
    'checkup_reports',
    'plan_action_completions',
    'audit_log',
    'action_executions',
    'action_run_states',
    'block_run_states',
    'action_outcomes',
    'autopilot_activity',
    'goal_week_outcomes',
    'learning_patterns',
    'content_recipes',
    'brand_visual_assets',
    'ad_campaign_library',
    'runway_prompt_tests'
  ];
BEGIN
  FOREACH t IN ARRAY org_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = t
        AND column_name = 'organization_id'
    ) THEN
      RAISE NOTICE 'policy skip — public.% has no organization_id', t;
      CONTINUE;
    END IF;

    -- Drop the legacy read-only policy where one existed (mcp_connections)
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS mcp_connections_select ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_org_access', t);

    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR ALL
        TO authenticated
        USING (public.is_org_member(organization_id))
        WITH CHECK (public.is_org_member(organization_id))
    $f$, t || '_org_access', t);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 4. Policies — the three tables that are not organization-scoped
-- -----------------------------------------------------------------------------

-- profiles: a user sees and edits only their own row.
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;

CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- No INSERT policy: rows are created by the handle_new_user() trigger, which
-- is SECURITY DEFINER and therefore not subject to RLS.
-- No DELETE policy: profile removal cascades from auth.users.

-- organizations: readable by members; only owners/admins may rename.
DROP POLICY IF EXISTS orgs_select ON public.organizations;
DROP POLICY IF EXISTS organizations_select ON public.organizations;
DROP POLICY IF EXISTS organizations_update ON public.organizations;

CREATE POLICY organizations_select ON public.organizations
  FOR SELECT TO authenticated
  USING (public.is_org_member(id));

CREATE POLICY organizations_update ON public.organizations
  FOR UPDATE TO authenticated
  USING (public.has_org_role(id, ARRAY['owner', 'admin']))
  WITH CHECK (public.has_org_role(id, ARRAY['owner', 'admin']));

-- No INSERT/DELETE policy: organization creation runs through the backend's
-- transactional createOrganization (organizationService), and deletion is not
-- a client-facing operation.

-- organization_members: a member sees the full roster of their own orgs.
-- Membership changes go through the backend only.
DROP POLICY IF EXISTS org_members_select ON public.organization_members;
DROP POLICY IF EXISTS organization_members_select ON public.organization_members;

CREATE POLICY organization_members_select ON public.organization_members
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

-- -----------------------------------------------------------------------------
-- 5. Revoke PostgREST grants
-- -----------------------------------------------------------------------------
-- Second, independent layer. Nothing in web/src queries these tables directly
-- (only supabase.auth), so removing table access from the browser-facing roles
-- costs nothing today and closes the exposure even if a future policy is
-- written incorrectly.
--
-- To re-open direct browser reads later: GRANT SELECT on the specific tables
-- needed to `authenticated`. The RLS policies above will still scope the rows.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- The helper functions must stay callable by `authenticated` for the policies
-- above to evaluate; re-grant after the blanket function revoke.
GRANT EXECUTE ON FUNCTION public.is_org_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_org_role(UUID, TEXT[]) TO authenticated;

-- -----------------------------------------------------------------------------
-- 6. Verification
-- -----------------------------------------------------------------------------
-- Emits a NOTICE listing any public table still missing RLS. Expected: none.

DO $$
DECLARE
  unprotected TEXT;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
  INTO unprotected
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND NOT c.relrowsecurity;

  IF unprotected IS NULL THEN
    RAISE NOTICE 'RLS OK — every table in public has row level security enabled.';
  ELSE
    RAISE WARNING 'RLS GAP — tables without RLS: %', unprotected;
  END IF;
END $$;
