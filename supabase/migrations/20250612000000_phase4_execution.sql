CREATE TABLE IF NOT EXISTS action_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  strategy_id UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  action_id TEXT NOT NULL,
  platform VARCHAR(40) NOT NULL,
  execution_type VARCHAR(60) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'previewed',
  risk_level VARCHAR(20) NOT NULL DEFAULT 'low',
  summary TEXT NOT NULL,
  target_label TEXT,
  before_state JSONB,
  proposed_state JSONB NOT NULL,
  after_state JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  executed_at TIMESTAMPTZ,
  rolled_back_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_action_executions_strategy
  ON action_executions (strategy_id, action_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_action_executions_org
  ON action_executions (organization_id, created_at DESC);
