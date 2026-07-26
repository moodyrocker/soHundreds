-- =============================================================================
-- CRITICAL RELIABILITY FIX — atomic work claiming
-- =============================================================================
--
-- Problem this fixes:
--   The autopilot worker guarded concurrency with two in-process primitives:
--
--     const running = new Set<string>();   // per-strategy
--     let tickInFlight = false;            // per-tick
--
--   Those hold within a single Node process and nowhere else. With two API
--   containers, an autoscale event, or a rolling deploy where old and new
--   overlap, both instances select the same due strategies and both execute
--   them — duplicate Instagram posts, duplicate Shopify articles, and
--   duplicate Meta/Google ad campaigns spending real budget.
--
--   Separately, every approve* path in executionService did a read-then-check
--   ("if status !== 'previewed' throw"), called the external API, then wrote
--   status = 'executed'. Two callers can both pass the check before either
--   writes — so a user double-clicking Approve could double-create a campaign
--   even on a single instance.
--
-- What this migration adds:
--   1. Claim columns on `strategies` for FOR UPDATE SKIP LOCKED claiming.
--   2. Claim columns on `action_executions` so previewed -> executing is a
--      single atomic conditional UPDATE.
--   3. Indexes supporting the claim queries and the stale-claim reaper.
--
-- Idempotent — safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Strategy-level claims (autopilot cycle)
-- -----------------------------------------------------------------------------

ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS cycle_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cycle_claimed_by TEXT;

COMMENT ON COLUMN strategies.cycle_claimed_at IS
  'Set when a worker claims this strategy for an autopilot cycle; NULL when idle. Claims older than the stale threshold are reclaimable.';
COMMENT ON COLUMN strategies.cycle_claimed_by IS
  'Opaque worker instance id (hostname:pid:uuid) holding the current claim. Diagnostic only — correctness comes from the atomic UPDATE.';

-- Partial index: the reaper only ever scans rows that hold a claim.
CREATE INDEX IF NOT EXISTS idx_strategies_cycle_claimed
  ON strategies (cycle_claimed_at)
  WHERE cycle_claimed_at IS NOT NULL;

-- Supports the due-strategy claim query's filter and ordering.
CREATE INDEX IF NOT EXISTS idx_strategies_autopilot_due
  ON strategies (last_autopilot_cycle_at NULLS FIRST)
  WHERE status = 'active';

-- -----------------------------------------------------------------------------
-- 2. Execution-level claims (external write idempotency)
-- -----------------------------------------------------------------------------
--
-- `action_executions.status` has no CHECK constraint, so introducing the
-- intermediate 'executing' value needs no constraint change. States are now:
--
--   previewed  -> executing -> executed        (success)
--              -> executing -> previewed       (pre-flight refusal, retryable)
--              -> executing -> failed          (external API error)
--              -> skipped
--   executed   -> rolled_back
--
-- Only a transition out of 'previewed' can start external work, and that
-- transition is a single UPDATE ... WHERE status = 'previewed', so exactly one
-- caller can ever win it.

ALTER TABLE action_executions
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claimed_by TEXT,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN action_executions.claimed_at IS
  'Set when a caller wins the atomic previewed -> executing transition. Used to detect executions orphaned by a process crash.';
COMMENT ON COLUMN action_executions.claimed_by IS
  'Worker/request instance id that holds the current execution claim.';
COMMENT ON COLUMN action_executions.attempt_count IS
  'Incremented on each successful claim. Lets the reaper stop retrying an execution that repeatedly dies mid-flight.';

CREATE INDEX IF NOT EXISTS idx_action_executions_claimed
  ON action_executions (claimed_at)
  WHERE status = 'executing';

CREATE INDEX IF NOT EXISTS idx_action_executions_org_status
  ON action_executions (organization_id, status);

-- -----------------------------------------------------------------------------
-- 3. Recover anything already mid-flight at deploy time
-- -----------------------------------------------------------------------------
-- No rows can be in 'executing' yet (the state is new as of this migration),
-- but this makes the migration safe to re-run after a partial rollout.

UPDATE action_executions
SET status = 'previewed',
    claimed_at = NULL,
    claimed_by = NULL,
    updated_at = NOW()
WHERE status = 'executing'
  AND claimed_at < NOW() - INTERVAL '1 hour';

UPDATE strategies
SET cycle_claimed_at = NULL,
    cycle_claimed_by = NULL,
    updated_at = NOW()
WHERE cycle_claimed_at IS NOT NULL
  AND cycle_claimed_at < NOW() - INTERVAL '1 hour';
