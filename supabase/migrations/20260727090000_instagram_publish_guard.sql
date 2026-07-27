-- =============================================================================
-- Duplicate-publish guard for the non-approve write paths
-- =============================================================================
--
-- `approve()` is protected by the atomic claim added in 20260726110000: a row is
-- moved previewed -> executing in one statement, and only the winner writes to the
-- platform.
--
-- `runInstagramPublish` never had that protection. It publishes to Instagram
-- *first* and inserts the execution row afterwards, so there is no row to claim.
-- Its only guard is a read-then-check in runWeekActions:
--
--     const priorSameType = existing.find(e => e.actionId === action.id && ...)
--     if (priorSameType) { skip }
--
-- which is the same shape as the bug fixed in 7400720 — two callers both read
-- "no prior execution", both publish, and the customer's followers see the post
-- twice. INSTAGRAM_AUTO_PUBLISH makes that path unattended, so nobody is watching
-- when it happens.
--
-- This index makes a concurrent duplicate structurally impossible: at most one
-- execution per (organization, strategy, action, type) may sit in `executing` at
-- a time, so the losing INSERT conflicts and that caller never reaches Instagram.
--
-- Scoped to `executing` only, deliberately:
--   * it is the in-flight state, which is exactly the race being closed;
--   * it makes no claim about history, so the migration cannot fail on existing
--     data and no historical row has to be rewritten to make the invariant true;
--   * a genuine retry after `failed` still works, because failed rows are not in
--     the index.
--
-- Idempotent — safe to re-run.
-- =============================================================================

DO $$
DECLARE
  in_flight INTEGER;
BEGIN
  -- Rows already sitting in `executing` would block index creation. There should
  -- be none: the state is only held for the duration of a single write, and the
  -- reaper in autopilotCycleWorker clears anything orphaned.
  SELECT count(*) INTO in_flight
  FROM (
    SELECT organization_id, strategy_id, action_id, execution_type
    FROM action_executions
    WHERE status = 'executing'
    GROUP BY 1, 2, 3, 4
    HAVING count(*) > 1
  ) dupes;

  IF in_flight > 0 THEN
    RAISE WARNING
      'Found % (org, strategy, action, type) group(s) with more than one execution stuck in "executing". Clearing them — they are orphaned in-flight rows, not completed work.',
      in_flight;

    -- Keep the newest attempt, release the rest back to previewed so they can be
    -- retried. after_state is untouched, so nothing is lost.
    UPDATE action_executions e
    SET status = 'previewed', claimed_at = NULL, claimed_by = NULL, updated_at = NOW()
    WHERE e.status = 'executing'
      AND e.id <> (
        SELECT id FROM action_executions x
        WHERE x.organization_id = e.organization_id
          AND x.strategy_id = e.strategy_id
          AND x.action_id = e.action_id
          AND x.execution_type = e.execution_type
          AND x.status = 'executing'
        ORDER BY x.claimed_at DESC NULLS LAST, x.created_at DESC
        LIMIT 1
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_action_executions_in_flight
  ON action_executions (organization_id, strategy_id, action_id, execution_type)
  WHERE status = 'executing';

COMMENT ON INDEX uniq_action_executions_in_flight IS
  'At most one in-flight execution per action per type. Closes the duplicate-publish race on the paths that create their execution row at write time rather than claiming an existing one (Instagram publish).';
