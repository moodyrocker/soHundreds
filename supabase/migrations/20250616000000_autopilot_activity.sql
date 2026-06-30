-- Autopilot activity stream (reasoning + decisions visible while running)

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
