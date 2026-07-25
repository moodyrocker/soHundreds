-- Sequential execution orchestration (#6–#10)

CREATE TABLE IF NOT EXISTS block_run_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  strategy_id UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  week_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle', 'running', 'checkpoint', 'halted', 'complete')),
  checkpoint_reasoning TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (strategy_id, week_number)
);

CREATE TABLE IF NOT EXISTS action_run_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  strategy_id UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  week_number INTEGER NOT NULL,
  action_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  run_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (run_status IN (
      'pending',
      'in_progress',
      'awaiting_confirmation',
      'awaiting_human_action',
      'confirmed',
      'failed'
    )),
  human_gate_reason TEXT,
  execution_id UUID REFERENCES action_executions(id) ON DELETE SET NULL,
  error_message TEXT,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (strategy_id, week_number, action_id)
);

CREATE INDEX IF NOT EXISTS idx_action_run_states_strategy_week
  ON action_run_states (strategy_id, week_number, sort_order);

CREATE INDEX IF NOT EXISTS idx_block_run_states_strategy
  ON block_run_states (strategy_id, week_number);
