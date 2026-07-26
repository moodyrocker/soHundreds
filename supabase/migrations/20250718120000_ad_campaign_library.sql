-- Ad campaign library: reusable Meta/Instagram campaign blueprints + creatives
-- Campaigns live here first; pushing to Meta is optional and always PAUSED.

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
