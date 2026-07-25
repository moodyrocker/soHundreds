-- Autopilot pace: normal | high | intense (per workspace)
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS autopilot_pace TEXT NOT NULL DEFAULT 'normal';

ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_autopilot_pace_check;
ALTER TABLE organizations
  ADD CONSTRAINT organizations_autopilot_pace_check
  CHECK (autopilot_pace IN ('normal', 'high', 'intense'));
