-- Phase 5C/5E: goal progress tracking and weekly outcome log

CREATE TABLE IF NOT EXISTS goal_week_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  strategy_id UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  week_number INTEGER NOT NULL,
  actions_prepared INTEGER NOT NULL DEFAULT 0,
  actions_total INTEGER NOT NULL DEFAULT 0,
  metric_key TEXT,
  metric_value NUMERIC,
  metric_baseline NUMERIC,
  metric_target NUMERIC,
  progress_pct NUMERIC,
  goal_met BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('met', 'on_track', 'behind', 'unknown')),
  summary TEXT,
  data_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (strategy_id, week_number)
);

CREATE INDEX IF NOT EXISTS idx_goal_week_outcomes_strategy
  ON goal_week_outcomes (strategy_id, week_number DESC);
