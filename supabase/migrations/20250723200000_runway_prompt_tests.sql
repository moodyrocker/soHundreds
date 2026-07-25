-- Runway prompt lab: test prompts, approve/reject, promote winners to visual library

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
