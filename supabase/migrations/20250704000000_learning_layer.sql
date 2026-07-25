-- Learning & prompt-adaptation layer (action outcomes + distilled patterns)

CREATE TABLE IF NOT EXISTS action_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  strategy_id UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  week_number INTEGER NOT NULL,
  action_id TEXT NOT NULL,
  execution_type TEXT NOT NULL,
  action_channel TEXT,
  action_title TEXT NOT NULL,
  hypothesis TEXT,
  target_metric_key TEXT,
  block_metric_before NUMERIC,
  block_metric_after NUMERIC,
  metric_delta NUMERIC,
  metric_delta_pct NUMERIC,
  effectiveness_score NUMERIC NOT NULL DEFAULT 0,
  rating TEXT NOT NULL DEFAULT 'unknown'
    CHECK (rating IN ('success', 'neutral', 'failure', 'unknown')),
  goal_context TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (strategy_id, week_number, action_id)
);

CREATE INDEX IF NOT EXISTS idx_action_outcomes_org_created
  ON action_outcomes (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_action_outcomes_org_type
  ON action_outcomes (organization_id, execution_type, action_channel);

CREATE TABLE IF NOT EXISTS learning_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pattern_key TEXT NOT NULL,
  pattern_text TEXT NOT NULL,
  execution_type TEXT,
  action_channel TEXT,
  confidence NUMERIC NOT NULL DEFAULT 0,
  sample_size INTEGER NOT NULL DEFAULT 0,
  success_rate NUMERIC,
  avg_score NUMERIC,
  goal_context_hint TEXT,
  last_reinforced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, pattern_key)
);

CREATE INDEX IF NOT EXISTS idx_learning_patterns_org_confidence
  ON learning_patterns (organization_id, confidence DESC, sample_size DESC);
