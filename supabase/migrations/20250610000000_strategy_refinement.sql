ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS parent_strategy_id UUID REFERENCES strategies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS refinement_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_strategies_parent
  ON strategies (parent_strategy_id)
  WHERE parent_strategy_id IS NOT NULL;
