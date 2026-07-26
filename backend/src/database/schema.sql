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

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS autopilot_pace TEXT NOT NULL DEFAULT 'normal';

DO $$ BEGIN
  ALTER TABLE organizations
    ADD CONSTRAINT organizations_autopilot_pace_check
    CHECK (autopilot_pace IN ('normal', 'high', 'intense'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
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

CREATE INDEX IF NOT EXISTS idx_autopilot_activity_org_strategy_created
  ON autopilot_activity (organization_id, strategy_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_autopilot_activity_org_strategy_step_created
  ON autopilot_activity (organization_id, strategy_id, step, created_at DESC);

-- Sequential execution orchestration (#6–#10)
CREATE TABLE IF NOT EXISTS block_run_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  strategy_id UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  week_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle', 'running', 'checkpoint', 'halted', 'complete')),
  checkpoint_reasoning TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (strategy_id, week_number)
);

CREATE TABLE IF NOT EXISTS action_run_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  strategy_id UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  week_number INTEGER NOT NULL,
  action_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  run_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (run_status IN (
      'pending',
      'in_progress',
      'awaiting_confirmation',
      'awaiting_human_action',
      'confirmed',
      'failed'
    )),
  human_gate_reason TEXT,
  execution_id UUID REFERENCES action_executions(id) ON DELETE SET NULL,
  error_message TEXT,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (strategy_id, week_number, action_id)
);

CREATE INDEX IF NOT EXISTS idx_action_run_states_strategy_week
  ON action_run_states (strategy_id, week_number, sort_order);

CREATE INDEX IF NOT EXISTS idx_block_run_states_strategy
  ON block_run_states (strategy_id, week_number);

-- Learning & prompt-adaptation layer
CREATE TABLE IF NOT EXISTS action_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  strategy_id UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  week_number INTEGER NOT NULL,
  action_id TEXT NOT NULL,
  execution_type TEXT NOT NULL,
  action_channel TEXT,
  action_title TEXT NOT NULL,
  hypothesis TEXT,
  target_metric_key TEXT,
  block_metric_before NUMERIC,
  block_metric_after NUMERIC,
  metric_delta NUMERIC,
  metric_delta_pct NUMERIC,
  effectiveness_score NUMERIC NOT NULL DEFAULT 0,
  rating TEXT NOT NULL DEFAULT 'unknown'
    CHECK (rating IN ('success', 'neutral', 'failure', 'unknown')),
  goal_context TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (strategy_id, week_number, action_id)
);

CREATE INDEX IF NOT EXISTS idx_action_outcomes_org_created
  ON action_outcomes (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_action_outcomes_org_type
  ON action_outcomes (organization_id, execution_type, action_channel);

CREATE TABLE IF NOT EXISTS learning_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pattern_key TEXT NOT NULL,
  pattern_text TEXT NOT NULL,
  execution_type TEXT,
  action_channel TEXT,
  confidence NUMERIC NOT NULL DEFAULT 0,
  sample_size INTEGER NOT NULL DEFAULT 0,
  success_rate NUMERIC,
  avg_score NUMERIC,
  goal_context_hint TEXT,
  last_reinforced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, pattern_key)
);

CREATE INDEX IF NOT EXISTS idx_learning_patterns_org_confidence
  ON learning_patterns (organization_id, confidence DESC, sample_size DESC);

-- Reusable content generation recipes (Runway / Canva knowledge base)
CREATE TABLE IF NOT EXISTS content_recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  medium TEXT NOT NULL DEFAULT 'video'
    CHECK (medium IN ('video', 'image')),
  provider TEXT NOT NULL DEFAULT 'runway'
    CHECK (provider IN ('runway', 'canva', 'generic')),
  channel TEXT,
  prompt_template TEXT NOT NULL,
  style_notes TEXT,
  negative_prompt TEXT,
  model TEXT,
  aspect_ratio TEXT,
  duration_seconds INTEGER
    CHECK (duration_seconds IS NULL OR (duration_seconds >= 2 AND duration_seconds <= 15)),
  tags TEXT[] NOT NULL DEFAULT '{}',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_content_recipes_org_active
  ON content_recipes (organization_id, is_active, medium, provider);

CREATE INDEX IF NOT EXISTS idx_content_recipes_org_default
  ON content_recipes (organization_id, is_default)
  WHERE is_default = TRUE AND is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_content_recipes_org_tags
  ON content_recipes USING GIN (tags);

ALTER TABLE content_recipes DROP CONSTRAINT IF EXISTS content_recipes_duration_seconds_check;
ALTER TABLE content_recipes ADD CONSTRAINT content_recipes_duration_seconds_check
  CHECK (duration_seconds IS NULL OR (duration_seconds >= 2 AND duration_seconds <= 15));

-- Brand visual library (HTTPS image links + Instagram inspiration + themes)
CREATE TABLE IF NOT EXISTS brand_visual_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  image_url TEXT NOT NULL,
  theme TEXT,
  notes TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  use_for TEXT NOT NULL DEFAULT 'any'
    CHECK (use_for IN ('any', 'feed', 'story', 'reel', 'product', 'lifestyle')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE brand_visual_assets
  ADD COLUMN IF NOT EXISTS asset_kind TEXT NOT NULL DEFAULT 'image';

DO $$ BEGIN
  ALTER TABLE brand_visual_assets
    ADD CONSTRAINT brand_visual_assets_asset_kind_check
    CHECK (asset_kind IN ('image', 'instagram_link'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_brand_visual_assets_org_active
  ON brand_visual_assets (organization_id, is_active, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_brand_visual_assets_org_tags
  ON brand_visual_assets USING GIN (tags);

-- Runway prompt lab (test stills → approve/reject → visual library)
CREATE TABLE IF NOT EXISTS runway_prompt_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  rendered_prompt TEXT,
  style_notes TEXT,
  negative_prompt TEXT,
  use_library_reference BOOLEAN NOT NULL DEFAULT TRUE,
  library_image_url TEXT,
  library_title TEXT,
  task_id TEXT,
  image_url TEXT,
  generation_status TEXT NOT NULL DEFAULT 'succeeded'
    CHECK (generation_status IN ('succeeded', 'failed')),
  generation_error TEXT,
  review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'approved', 'rejected')),
  review_notes TEXT,
  brand_visual_id UUID REFERENCES brand_visual_assets(id) ON DELETE SET NULL,
  recipe_id UUID REFERENCES content_recipes(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_runway_prompt_tests_org_created
  ON runway_prompt_tests (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_runway_prompt_tests_org_review
  ON runway_prompt_tests (organization_id, review_status, created_at DESC);

-- Ad campaign library (Meta / Instagram blueprints + creatives)
CREATE TABLE IF NOT EXISTS ad_campaign_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  channel TEXT NOT NULL DEFAULT 'meta'
    CHECK (channel IN ('meta', 'instagram', 'both')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'ready', 'pushed', 'archived')),
  objective TEXT NOT NULL DEFAULT 'OUTCOME_TRAFFIC'
    CHECK (objective IN ('OUTCOME_TRAFFIC', 'OUTCOME_SALES')),
  daily_budget NUMERIC(12, 2) NOT NULL DEFAULT 10,
  currency_code TEXT NOT NULL DEFAULT 'GBP'
    CHECK (currency_code IN ('GBP', 'USD', 'EUR')),
  duration_days INTEGER,
  targeting JSONB NOT NULL DEFAULT '{}'::jsonb,
  ads JSONB NOT NULL DEFAULT '[]'::jsonb,
  reasoning TEXT,
  recipe_slug TEXT,
  source_execution_id UUID,
  meta_campaign_id TEXT,
  meta_ad_set_id TEXT,
  meta_ad_account_id TEXT,
  meta_pushed_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_ad_campaign_library_org_active
  ON ad_campaign_library (organization_id, is_active, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_campaign_library_org_channel
  ON ad_campaign_library (organization_id, channel, status);

-- Continuous autopilot pause + scheduled cycle bookkeeping
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS pause_until TIMESTAMPTZ;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS next_batch_reasoning TEXT;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS last_autopilot_cycle_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_strategies_autopilot_cycle
  ON strategies (last_autopilot_cycle_at ASC NULLS FIRST)
  WHERE status = 'active';
