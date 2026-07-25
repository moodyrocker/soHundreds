-- Continuous autopilot: optional pause between action batches

ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS pause_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_batch_reasoning TEXT;
