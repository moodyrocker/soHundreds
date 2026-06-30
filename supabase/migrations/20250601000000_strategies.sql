CREATE TABLE IF NOT EXISTS strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  goal TEXT NOT NULL,
  context TEXT,
  budget VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  data_source VARCHAR(20) NOT NULL DEFAULT 'generic'
    CHECK (data_source IN ('analytics', 'generic')),
  plan_json JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strategies_org_status
  ON strategies (organization_id, status);

CREATE INDEX IF NOT EXISTS idx_strategies_org_created
  ON strategies (organization_id, created_at DESC);
