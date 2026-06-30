CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  strategy_id UUID REFERENCES strategies(id) ON DELETE SET NULL,
  event_type VARCHAR(40) NOT NULL,
  model VARCHAR(120),
  data_source VARCHAR(20),
  sources_loaded JSONB NOT NULL DEFAULT '[]'::jsonb,
  worker_reports JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_org_created
  ON audit_log (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_strategy
  ON audit_log (strategy_id)
  WHERE strategy_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS plan_action_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  strategy_id UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  action_id TEXT NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, strategy_id, action_id)
);

CREATE INDEX IF NOT EXISTS idx_plan_action_completions_strategy
  ON plan_action_completions (strategy_id);
