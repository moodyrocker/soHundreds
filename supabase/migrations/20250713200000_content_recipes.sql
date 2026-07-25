-- Org-scoped knowledge base of reusable content generation recipes (Runway / Canva / etc.)

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
    CHECK (duration_seconds IS NULL OR duration_seconds IN (5, 10)),
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
