-- Phase 2: businesses to emulate (market intel seed)

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS business_emulate TEXT;
