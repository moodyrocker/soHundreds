-- Faster activity list: match the org+strategy filter used by the API
CREATE INDEX IF NOT EXISTS idx_autopilot_activity_org_strategy_created
  ON autopilot_activity (organization_id, strategy_id, created_at DESC);

-- Outcome lookups (Published / Done / Errors) without scanning planning noise
CREATE INDEX IF NOT EXISTS idx_autopilot_activity_org_strategy_step_created
  ON autopilot_activity (organization_id, strategy_id, step, created_at DESC);
