import { query } from '../database/connection.js';
import {
  getAutopilotCycleTickMinutes,
  isAutopilotCycleWorkerEnabled,
} from '../lib/autopilotCycleConfig.js';
import { getPaceProfile } from '../lib/autopilotPaceConfig.js';
import { mapWithConcurrency } from '../lib/concurrency.js';
import {
  INSTANCE_ID,
  getClaimStaleMinutes,
  getCycleBatchSize,
  getCycleConcurrency,
} from '../lib/workerIdentity.js';
import { AutopilotActivityService } from '../services/autopilotActivityService.js';
import { ExecutionOrchestratorService } from '../services/executionOrchestratorService.js';
import { ExecutionService } from '../services/executionService.js';
import { StrategyService } from '../services/strategyService.js';
import { GoalProgressService } from '../services/goalProgressService.js';
import { getAutopilotPace } from '../services/autopilotService.js';

type DueStrategyRow = {
  id: string;
  organization_id: string;
  current_week: number;
  pause_until: Date | null;
  last_autopilot_cycle_at: Date | null;
  goal: string;
  has_pending_work: boolean;
  autopilot_pace: string | null;
};

let tickTimer: ReturnType<typeof setInterval> | null = null;
let tickInFlight = false;

/**
 * Atomically claims up to `limit` due strategies for this worker instance.
 *
 * This replaces the previous read-then-process pattern, which relied on an
 * in-process `Set` for mutual exclusion and therefore provided no protection
 * across containers. Two instances would both select the same rows and both
 * execute them — duplicate Instagram posts and, worse, duplicate paid ad
 * campaigns spending real budget.
 *
 * The claim is a single statement: the inner SELECT takes row locks with
 * SKIP LOCKED so concurrent claimers never queue behind each other or see the
 * same row, and the outer UPDATE stamps ownership before any work begins.
 * `cycle_claimed_at IS NULL OR < stale threshold` lets a claim orphaned by a
 * crashed container be picked up again rather than blocking the strategy
 * forever.
 *
 * `last_autopilot_cycle_at` is set here, in the same statement, so the cadence
 * filter is advanced atomically with the claim. Previously markCycleStarted()
 * ran several awaits later, leaving a window where a second caller still saw
 * the strategy as due.
 */
async function claimDueStrategies(limit: number): Promise<DueStrategyRow[]> {
  const staleMinutes = getClaimStaleMinutes();

  const result = await query<DueStrategyRow>(
    `WITH due AS (
       SELECT s.id
       FROM strategies s
       INNER JOIN organizations o ON o.id = s.organization_id
       WHERE s.status = 'active'
         AND COALESCE(s.goal_status, 'active') = 'active'
         AND o.autopilot_mode = 'hands_off'
         AND s.plan_json IS NOT NULL
         -- unclaimed, or the holding worker died and the claim went stale
         AND (
           s.cycle_claimed_at IS NULL
           OR s.cycle_claimed_at <= NOW() - ($2 || ' minutes')::interval
         )
         AND (
           s.last_autopilot_cycle_at IS NULL
           OR s.last_autopilot_cycle_at <= NOW() - (
             CASE COALESCE(o.autopilot_pace, 'normal')
               WHEN 'intense' THEN interval '15 minutes'
               WHEN 'high' THEN interval '30 minutes'
               ELSE interval '60 minutes'
             END
           )
           OR (s.pause_until IS NOT NULL AND s.pause_until <= NOW())
           OR EXISTS (
                SELECT 1 FROM action_run_states ars
                WHERE ars.strategy_id = s.id
                  AND ars.week_number = s.current_week
                  AND ars.run_status IN ('pending', 'failed')
              )
         )
       ORDER BY
         CASE WHEN EXISTS (
           SELECT 1 FROM action_run_states ars
           WHERE ars.strategy_id = s.id
             AND ars.week_number = s.current_week
             AND ars.run_status IN ('pending', 'failed')
         ) THEN 0 ELSE 1 END,
         COALESCE(s.last_autopilot_cycle_at, s.created_at) ASC
       LIMIT $3
       FOR UPDATE OF s SKIP LOCKED
     )
     UPDATE strategies s
     SET cycle_claimed_at = NOW(),
         cycle_claimed_by = $1,
         last_autopilot_cycle_at = NOW(),
         updated_at = NOW()
     FROM due, organizations o
     WHERE s.id = due.id
       AND o.id = s.organization_id
     RETURNING s.id, s.organization_id, s.current_week, s.pause_until,
               s.last_autopilot_cycle_at, s.goal,
               o.autopilot_pace,
               EXISTS (
                 SELECT 1 FROM action_run_states ars
                 WHERE ars.strategy_id = s.id
                   AND ars.week_number = s.current_week
                   AND ars.run_status IN ('pending', 'failed')
               ) AS has_pending_work`,
    [INSTANCE_ID, String(staleMinutes), limit]
  );

  return result.rows;
}

/**
 * Releases this worker's claim so the strategy becomes eligible again on its
 * normal cadence. Scoped to INSTANCE_ID so a claim already stolen by another
 * worker (because ours went stale) is not clobbered.
 */
async function releaseClaim(organizationId: string, strategyId: string): Promise<void> {
  await query(
    `UPDATE strategies
     SET cycle_claimed_at = NULL, cycle_claimed_by = NULL, updated_at = NOW()
     WHERE id = $1 AND organization_id = $2 AND cycle_claimed_by = $3`,
    [strategyId, organizationId, INSTANCE_ID]
  );
}

/**
 * Clears claims whose holding process died. Runs at the top of each tick.
 *
 * Without this, a container killed mid-cycle leaves its strategies claimed
 * until the stale window elapses on each individual claim check; sweeping up
 * front keeps the due-query cheap and makes recovery observable in logs.
 */
async function reapStaleClaims(): Promise<number> {
  const staleMinutes = getClaimStaleMinutes();

  const strategies = await query(
    `UPDATE strategies
     SET cycle_claimed_at = NULL, cycle_claimed_by = NULL, updated_at = NOW()
     WHERE cycle_claimed_at IS NOT NULL
       AND cycle_claimed_at <= NOW() - ($1 || ' minutes')::interval
     RETURNING id`,
    [String(staleMinutes)]
  );

  // Executions orphaned mid-flight: return them to 'previewed' so they can be
  // retried, unless they have already burned through their attempt budget —
  // an execution that repeatedly dies mid-call may be half-applied upstream,
  // and retrying it forever risks duplicate external writes.
  const executions = await query(
    `UPDATE action_executions
     SET status = CASE WHEN attempt_count >= 3 THEN 'failed' ELSE 'previewed' END,
         error_message = CASE
           WHEN attempt_count >= 3
             THEN 'Abandoned after 3 interrupted attempts — verify upstream state manually before retrying.'
           ELSE error_message
         END,
         claimed_at = NULL,
         claimed_by = NULL,
         updated_at = NOW()
     WHERE status = 'executing'
       AND claimed_at <= NOW() - ($1 || ' minutes')::interval
     RETURNING id`,
    [String(staleMinutes)]
  );

  const total = (strategies.rowCount ?? 0) + (executions.rowCount ?? 0);
  if (total > 0) {
    console.warn(
      `[autopilot-cycle] reaped ${strategies.rowCount ?? 0} stale strategy claim(s) and ` +
        `${executions.rowCount ?? 0} orphaned execution(s) older than ${staleMinutes}m`
    );
  }
  return total;
}

/**
 * One agentic pass for an active hands-off strategy:
 * - always log cycle + goal reasoning
 * - park paid-ad gates; keep executing Instagram/content/SEO
 * - advance checkpoints when pause has elapsed
 *
 * Mutual exclusion is the caller's responsibility and is enforced in the
 * database by claimDueStrategies(). The previous in-process `running` Set was
 * removed: it gave a false sense of safety, since it could not see claims held
 * by another container.
 *
 * `alreadyClaimed` distinguishes the two entry points. The worker tick passes
 * true (it holds a DB claim and releases it in the finally block). Manual or
 * route-triggered invocations pass false and take their own claim here, so an
 * operator-triggered cycle cannot collide with a scheduled one.
 */
export async function runScheduledCycleForStrategy(
  organizationId: string,
  strategyId: string,
  alreadyClaimed = false
): Promise<void> {
  if (!alreadyClaimed) {
    const claimed = await query(
      `UPDATE strategies
       SET cycle_claimed_at = NOW(), cycle_claimed_by = $3, updated_at = NOW()
       WHERE id = $1 AND organization_id = $2
         AND (
           cycle_claimed_at IS NULL
           OR cycle_claimed_at <= NOW() - ($4 || ' minutes')::interval
         )
       RETURNING id`,
      [strategyId, organizationId, INSTANCE_ID, String(getClaimStaleMinutes())]
    );
    if (claimed.rowCount === 0) {
      console.log(
        `[autopilot-cycle] strategy=${strategyId} already claimed by another worker — skipping`
      );
      return;
    }
  }

  const activity = new AutopilotActivityService();
  const orchestrator = new ExecutionOrchestratorService();
  const execution = new ExecutionService();
  const strategies = new StrategyService();
  const goalProgress = new GoalProgressService();
  const pace = await getAutopilotPace(organizationId);
  const paceProfile = getPaceProfile(pace);

  try {
    const strategy = await strategies.getById(organizationId, strategyId);
    if (!strategy || strategy.status !== 'active' || strategy.goalStatus !== 'active') {
      return;
    }
    if (!strategy.plan) return;

    const week = strategy.currentWeek;

    await activity.log({
      organizationId,
      strategyId,
      weekNumber: week,
      step: 'continuous',
      title: `Agent cycle — ${paceProfile.label} pace (≤${paceProfile.cycleMinutes}m)`,
      detail: `Working on “${strategy.goal.slice(0, 120)}”. Pending plan actions run now; paid ad campaigns stay parked for your review without blocking Instagram or content.`,
      status: 'running',
    });

    // Lightweight goal read so Activity always shows reasoning even mid-week
    try {
      const progress = await goalProgress.checkProgress(
        organizationId,
        strategy.plan,
        strategy.plan.summary.goalLine,
        null,
        strategyId
      );
      await activity.log({
        organizationId,
        strategyId,
        weekNumber: week,
        step: 'ai_reasoning',
        title: `Goal check — ${progress.status}`,
        detail: progress.summary.slice(0, 2000),
        status: progress.status === 'behind' ? 'warn' : 'info',
      });
    } catch (err) {
      await activity.log({
        organizationId,
        strategyId,
        weekNumber: week,
        step: 'ai_reasoning',
        title: 'Goal check — limited data',
        detail: err instanceof Error ? err.message.slice(0, 500) : 'Could not refresh goal metrics this cycle.',
        status: 'warn',
      });
    }

    const pauseUntil = strategy.pauseUntil ? new Date(strategy.pauseUntil) : null;
    const pauseActive = Boolean(pauseUntil && pauseUntil.getTime() > Date.now());

    let snapshot = await orchestrator.getSnapshot(organizationId, strategyId, week);

    const parked = snapshot.actions.filter((a) => a.runStatus === 'awaiting_human_action');
    if (parked.length) {
      await activity.log({
        organizationId,
        strategyId,
        weekNumber: week,
        actionId: parked[0].actionId,
        step: 'awaiting_human',
        title: `${parked.length} paid campaign(s) parked — continuing other work`,
        detail:
          parked[0].humanGateReason ??
          'Review paused ad(s) in Ads Manager when ready. The agent is not waiting — Instagram and other actions keep running.',
        status: 'warn',
      });
    }

    if (snapshot.block?.status === 'checkpoint') {
      if (pauseActive) {
        await activity.log({
          organizationId,
          strategyId,
          weekNumber: week,
          step: 'decision',
          title: 'Between batches — pause active',
          detail: `Next week advance after ${pauseUntil!.toISOString()}. ${
            snapshot.block.checkpointReasoning ?? strategy.nextBatchReasoning ?? ''
          }`.slice(0, 1500),
          status: 'info',
        });
        // Still drain any leftover pending/failed if state is inconsistent
        const leftover = snapshot.actions.some(
          (a) => a.runStatus === 'pending' || a.runStatus === 'failed'
        );
        if (leftover) {
          snapshot = await orchestrator.runUntilBlocked(organizationId, strategyId, week);
        }
        return;
      }

      const advanced = await orchestrator.advanceFromCheckpoint(
        organizationId,
        strategyId,
        week
      );
      await activity.log({
        organizationId,
        strategyId,
        weekNumber: advanced.strategy.currentWeek,
        step: 'decision',
        title: advanced.continued
          ? `Advanced to week ${advanced.strategy.currentWeek}`
          : 'Checkpoint reviewed — not continuing',
        detail: (
          snapshot.block.checkpointReasoning ??
          advanced.strategy.nextBatchReasoning ??
          'Re-evaluated goal progress after scheduled pause.'
        ).slice(0, 1500),
        status: 'info',
      });

      if (!advanced.continued) {
        if (advanced.strategy.goalStatus === 'met') {
          await activity.log({
            organizationId,
            strategyId,
            weekNumber: week,
            step: 'complete',
            title: 'Goal met',
            detail: 'Agent cycle found the goal already met — no further actions.',
            status: 'success',
          });
        }
        return;
      }

      snapshot = await orchestrator.runUntilBlocked(
        organizationId,
        strategyId,
        advanced.strategy.currentWeek
      );
    } else {
      await execution.runWeekAutopilot(organizationId, strategyId, week, false, false);
      snapshot = await orchestrator.runUntilBlocked(organizationId, strategyId, week);
    }

    const finishedWeek =
      snapshot.actions[0]?.weekNumber ?? snapshot.block?.weekNumber ?? week;

    const confirmed = snapshot.actions.filter((a) => a.runStatus === 'confirmed').length;
    const pending = snapshot.actions.filter(
      (a) => a.runStatus === 'pending' || a.runStatus === 'failed'
    ).length;
    const parkedCount = snapshot.actions.filter(
      (a) => a.runStatus === 'awaiting_human_action'
    ).length;
    const reasoning =
      snapshot.block?.checkpointReasoning ??
      (await strategies.getById(organizationId, strategyId))?.nextBatchReasoning ??
      null;

    await activity.log({
      organizationId,
      strategyId,
      weekNumber: finishedWeek,
      step: 'complete',
      title: `Agent cycle done — ${confirmed} done, ${pending} open, ${parkedCount} parked ads`,
      detail: (
        reasoning ??
        `Block: ${snapshot.block?.status ?? 'idle'}. Open actions will retry on the next tick.`
      ).slice(0, 1500),
      status: pending ? 'warn' : 'success',
    });

    if (reasoning) {
      await activity.log({
        organizationId,
        strategyId,
        weekNumber: finishedWeek,
        step: 'ai_reasoning',
        title: 'Cycle reasoning',
        detail: reasoning.slice(0, 2000),
        status: 'info',
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Scheduled cycle failed';
    console.error(`[autopilot-cycle] strategy=${strategyId}:`, message);
    try {
      await activity.log({
        organizationId,
        strategyId,
        step: 'failed',
        title: 'Agent cycle failed',
        detail: message.slice(0, 1500),
        status: 'error',
      });
    } catch {
      /* ignore */
    }
  } finally {
    // Always release, even on failure — the strategy should become due again on
    // its normal cadence rather than waiting out the stale window.
    try {
      await releaseClaim(organizationId, strategyId);
    } catch (err) {
      console.error(
        `[autopilot-cycle] failed to release claim for strategy=${strategyId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
}

/**
 * One tick: reap orphaned claims, atomically claim a batch, then process the
 * batch with bounded parallelism.
 *
 * Previously this was a serial `for...of` over up to 20 strategies. Because a
 * single cycle can run for many minutes (multiple Claude calls plus external
 * API work — Runway video alone is documented at 10-15 minutes), one slow
 * tenant starved every other tenant on the tick. Concurrency is bounded rather
 * than unlimited so we do not stampede the Anthropic API or the Postgres pool.
 */
export async function runDueAutopilotCycles(): Promise<number> {
  await reapStaleClaims();

  const claimed = await claimDueStrategies(getCycleBatchSize());
  if (claimed.length === 0) return 0;

  const concurrency = getCycleConcurrency();
  console.log(
    `[autopilot-cycle] claimed ${claimed.length} strateg${
      claimed.length === 1 ? 'y' : 'ies'
    } (concurrency ${concurrency}, instance ${INSTANCE_ID})`
  );

  const results = await mapWithConcurrency(claimed, concurrency, (row) =>
    runScheduledCycleForStrategy(row.organization_id, row.id, true)
  );

  // runScheduledCycleForStrategy already logs and swallows per-strategy errors,
  // so anything surfacing here is unexpected. Report it without failing the tick.
  for (const result of results) {
    if (result.error) {
      console.error(
        `[autopilot-cycle] unhandled error for strategy=${result.item.id}:`,
        result.error instanceof Error ? result.error.message : result.error
      );
    }
  }

  return claimed.length;
}

export function startAutopilotCycleWorker(): void {
  if (!isAutopilotCycleWorkerEnabled()) {
    console.log('[autopilot-cycle] worker disabled (AUTOPILOT_CYCLE_WORKER=false)');
    return;
  }
  if (tickTimer) return;

  const tickMs = getAutopilotCycleTickMinutes() * 60_000;

  const tick = async () => {
    if (tickInFlight) return;
    tickInFlight = true;
    try {
      const n = await runDueAutopilotCycles();
      if (n > 0) {
        console.log(`[autopilot-cycle] processed ${n} due strateg${n === 1 ? 'y' : 'ies'}`);
      }
    } catch (err) {
      console.error('[autopilot-cycle] tick failed:', err instanceof Error ? err.message : err);
    } finally {
      tickInFlight = false;
    }
  };

  console.log(
    `[autopilot-cycle] agentic worker on — instance ${INSTANCE_ID}, ` +
      `cadence from org pace (normal 60m / high 30m / intense 15m), ` +
      `wake every ${getAutopilotCycleTickMinutes()}m, ` +
      `batch ${getCycleBatchSize()} @ concurrency ${getCycleConcurrency()}, ` +
      `claim stale after ${getClaimStaleMinutes()}m, pending work runs immediately`
  );

  // Clamp overly long pauses to intense-safe max (6h) so Intense orgs are not stuck waiting days.
  void query(
    `UPDATE strategies SET pause_until = NOW() + interval '6 hours', updated_at = NOW()
     WHERE pause_until IS NOT NULL
       AND pause_until > NOW() + interval '6 hours'
       AND status = 'active'
       AND COALESCE(goal_status, 'active') = 'active'`
  ).catch((err) => {
    console.warn(
      '[autopilot-cycle] pause clamp skipped:',
      err instanceof Error ? err.message : err
    );
  });

  setTimeout(() => void tick(), 15_000);
  tickTimer = setInterval(() => void tick(), tickMs);
  if (typeof tickTimer.unref === 'function') tickTimer.unref();
}

/**
 * Stops the tick loop and releases every claim this instance holds, so a
 * SIGTERM during a rolling deploy does not leave strategies parked for the full
 * stale window. In-flight cycles are not interrupted — their own finally block
 * releases them, and the reaper covers a hard kill.
 */
export async function stopAutopilotCycleWorker(): Promise<void> {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  try {
    const released = await query(
      `UPDATE strategies
       SET cycle_claimed_at = NULL, cycle_claimed_by = NULL, updated_at = NOW()
       WHERE cycle_claimed_by = $1
       RETURNING id`,
      [INSTANCE_ID]
    );
    if ((released.rowCount ?? 0) > 0) {
      console.log(`[autopilot-cycle] released ${released.rowCount} claim(s) on shutdown`);
    }
  } catch (err) {
    console.error(
      '[autopilot-cycle] failed to release claims on shutdown:',
      err instanceof Error ? err.message : err
    );
  }
}
