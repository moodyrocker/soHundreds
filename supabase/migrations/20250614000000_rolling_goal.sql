-- Rolling goal pursuit: track active week and goal completion (not a fixed 8-week calendar)

ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS current_week INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS goal_status TEXT NOT NULL DEFAULT 'active'
    CHECK (goal_status IN ('active', 'met', 'paused'));
