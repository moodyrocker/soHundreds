-- Phase 1D: marketing check-up snapshots (assessment history per workspace)

CREATE TABLE IF NOT EXISTS checkup_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  data_source TEXT NOT NULL DEFAULT 'generic',
  report_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checkup_reports_org_created
  ON checkup_reports (organization_id, created_at DESC);
