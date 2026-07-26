-- Scheduled hands-off goal cycles (default every 6 hours)

ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS last_autopilot_cycle_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_strategies_autopilot_cycle
  ON strategies (last_autopilot_cycle_at ASC NULLS FIRST)
  WHERE status = 'active';
