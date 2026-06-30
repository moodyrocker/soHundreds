CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mcp_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  platform VARCHAR(50) NOT NULL,
  credentials_encrypted TEXT NOT NULL,
  property_id VARCHAR(255),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) DEFAULT 'connected',
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organization_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_mcp_connections_org
  ON mcp_connections (organization_id);

CREATE TABLE IF NOT EXISTS strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  goal TEXT NOT NULL,
  context TEXT,
  budget VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  data_source VARCHAR(20) NOT NULL DEFAULT 'generic'
    CHECK (data_source IN ('analytics', 'google_ads', 'multi', 'generic')),
  plan_json JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strategies_org_status
  ON strategies (organization_id, status);

CREATE INDEX IF NOT EXISTS idx_strategies_org_created
  ON strategies (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS checkup_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  data_source TEXT NOT NULL DEFAULT 'generic',
  report_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checkup_reports_org_created
  ON checkup_reports (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL DEFAULT 'member'
    CHECK (role IN ('owner', 'admin', 'member')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_organization_members_user
  ON organization_members (user_id);

CREATE INDEX IF NOT EXISTS idx_organization_members_org
  ON organization_members (organization_id);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Per-workspace business profile (plans, market intel, check-up)
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS business_website TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS business_one_liner TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS business_audience TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS business_offer TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS business_emulate TEXT;
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS autopilot_mode TEXT NOT NULL DEFAULT 'assist'
  CHECK (autopilot_mode IN ('assist', 'hands_off'));
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS business_budget TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS business_profile_updated_at TIMESTAMPTZ;

-- Autopilot activity stream (reasoning + decisions while running)
CREATE TABLE IF NOT EXISTS autopilot_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  strategy_id UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  week_number INTEGER,
  action_id TEXT,
  step TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'info'
    CHECK (status IN ('info', 'running', 'success', 'warn', 'error')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_autopilot_activity_strategy
  ON autopilot_activity (strategy_id, created_at DESC);
