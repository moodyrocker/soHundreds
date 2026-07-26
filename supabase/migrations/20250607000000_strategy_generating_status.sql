-- Background plan generation: survive page refresh and navigation

ALTER TABLE strategies DROP CONSTRAINT IF EXISTS strategies_status_check;

ALTER TABLE strategies
  ALTER COLUMN plan_json DROP NOT NULL;

ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS generation_error TEXT;

ALTER TABLE strategies
  ADD CONSTRAINT strategies_status_check
  CHECK (status IN ('generating', 'active', 'archived', 'failed'));

CREATE INDEX IF NOT EXISTS idx_strategies_org_generating
  ON strategies (organization_id, created_at DESC)
  WHERE status = 'generating';
