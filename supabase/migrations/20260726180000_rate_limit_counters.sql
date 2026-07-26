-- =============================================================================
-- Rate limit counters
-- =============================================================================
--
-- Nothing throttled the endpoints that spend money. A loop against
-- POST /api/strategy/create burns the Anthropic budget (each call is up to 8
-- turns at 16k tokens, plus web search); a loop against the execution routes
-- creates Shopify content, Instagram posts and funded ad campaigns.
--
-- Why Postgres rather than express-rate-limit's default in-memory store:
-- the API is designed to scale to several replicas, and an in-memory counter
-- multiplies the effective limit by the replica count — exactly wrong for the
-- endpoints where the limit is a cost ceiling. Cost-critical routes are
-- low-volume, so a single indexed upsert per request is cheap.
--
-- High-volume cheap routes keep an in-memory limiter (see lib/rateLimit.ts);
-- approximate is fine there.
--
-- Idempotent — safe to re-run.
-- =============================================================================

CREATE TABLE IF NOT EXISTS rate_limit_counters (
  -- Composite identity: who is being limited, and for which bucket of routes.
  scope           TEXT NOT NULL,
  subject         TEXT NOT NULL,
  -- Start of the fixed window this row counts. Fixed windows rather than a
  -- sliding log: one row per subject per window, no unbounded growth, and the
  -- burst-at-boundary weakness does not matter for a cost ceiling.
  window_start    TIMESTAMPTZ NOT NULL,
  count           INTEGER NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope, subject, window_start)
);

COMMENT ON TABLE rate_limit_counters IS
  'Fixed-window request counters for cost-critical endpoints. Shared across API replicas so a limit is a real ceiling rather than per-process.';
COMMENT ON COLUMN rate_limit_counters.scope IS
  'Route bucket, e.g. ai_generation, paid_ads, content_publish.';
COMMENT ON COLUMN rate_limit_counters.subject IS
  'Usually an organization id. Falls back to a user id or ip for pre-tenant routes.';

-- Supports the sweep of expired windows.
CREATE INDEX IF NOT EXISTS idx_rate_limit_counters_window
  ON rate_limit_counters (window_start);

-- Operational metadata, not tenant data, but RLS keeps the coverage assertion in
-- 20260726100000_rls_all_tables.sql satisfied and denies non-owner roles by
-- default (no policies = deny all).
ALTER TABLE rate_limit_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rate_limit_counters FROM PUBLIC;

-- =============================================================================
-- Atomic increment
-- =============================================================================
-- Returns the count *after* incrementing, so the caller compares against its
-- limit with no read-then-write race. The upsert is a single statement, so
-- concurrent requests across replicas serialise on the primary key.

CREATE OR REPLACE FUNCTION public.bump_rate_limit(
  p_scope       TEXT,
  p_subject     TEXT,
  p_window_secs INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  w_start TIMESTAMPTZ;
  new_count INTEGER;
BEGIN
  -- Floor now() to the window boundary so every replica agrees on the bucket.
  w_start := to_timestamp(
    floor(extract(epoch FROM clock_timestamp()) / p_window_secs) * p_window_secs
  );

  INSERT INTO rate_limit_counters (scope, subject, window_start, count, updated_at)
  VALUES (p_scope, p_subject, w_start, 1, NOW())
  ON CONFLICT (scope, subject, window_start)
  DO UPDATE SET count = rate_limit_counters.count + 1, updated_at = NOW()
  RETURNING count INTO new_count;

  RETURN new_count;
END $$;

COMMENT ON FUNCTION public.bump_rate_limit(TEXT, TEXT, INTEGER) IS
  'Increments and returns the counter for (scope, subject) in the current fixed window. Single statement, so safe under concurrency across replicas.';

-- =============================================================================
-- Housekeeping
-- =============================================================================

CREATE OR REPLACE FUNCTION public.prune_rate_limit_counters(p_older_than_secs INTEGER DEFAULT 86400)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  removed INTEGER;
BEGIN
  DELETE FROM rate_limit_counters
  WHERE window_start < NOW() - (p_older_than_secs || ' seconds')::interval;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END $$;

COMMENT ON FUNCTION public.prune_rate_limit_counters(INTEGER) IS
  'Deletes counter rows for long-expired windows. Called opportunistically by the API.';
