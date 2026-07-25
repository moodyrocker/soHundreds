-- Brand visual library: HTTPS image links + theme notes for Instagram / Runway creatives

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

CREATE INDEX IF NOT EXISTS idx_brand_visual_assets_org_active
  ON brand_visual_assets (organization_id, is_active, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_brand_visual_assets_org_tags
  ON brand_visual_assets USING GIN (tags);
