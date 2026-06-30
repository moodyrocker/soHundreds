-- Per-workspace business context for plans, competitor analysis, and advisor flows

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS business_website TEXT,
  ADD COLUMN IF NOT EXISTS business_one_liner TEXT,
  ADD COLUMN IF NOT EXISTS business_audience TEXT,
  ADD COLUMN IF NOT EXISTS business_offer TEXT,
  ADD COLUMN IF NOT EXISTS business_budget TEXT,
  ADD COLUMN IF NOT EXISTS business_profile_updated_at TIMESTAMPTZ;
