-- Autopilot: AI prepares and optionally applies week actions without manual orchestration

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS autopilot_mode TEXT NOT NULL DEFAULT 'assist'
  CHECK (autopilot_mode IN ('assist', 'hands_off'));
