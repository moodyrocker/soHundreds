import { query } from '../database/connection.js';
import {
  getAutopilotCycleTickMinutes,
  isAutopilotCycleWorkerEnabled,
} from '../lib/autopilotCycleConfig.js';
import { getPaceProfile } from '../lib/autopilotPaceConfig.js';
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

const running = new Set<string>();
let tickTimer: ReturnType<typeof setInterval> | null = null;
let tickInFlight = false;

async function listDueStrategies(): Promise<DueStrategyRow[]> {
  // Due if: overdue by org pace cadence, pause elapsed, OR open pending/failed work.
  const result = await query<DueStrategyRow>(
    `SELECT s.id, s.organization_id, s.current_week, s.pause_until, s.last_autopilot_cycle_at, s.goal,
            o.autopilot_pace,
            EXISTS (
              SELECT 1 FROM action_run_states ars
              WHERE ars.strategy_id = s.id
                AND ars.week_number = s.current_week
                AND ars.run_status IN ('pending', 'failed')
            ) AS has_pending_work
     FROM strategies s
     INNER JOIN organizations o ON o.id = s.organization_id
     WHERE s.status = 'active'
       AND COALESCE(s.goal_status, 'active') = 'active'
       AND o.autopilot_mode = 'hands_off'
       AND s.plan_json IS NOT NULL
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
     LIMIT 20`
  );
  return result.rows;
}

async function markCycleStarted(organizationId: string, strategyId: string): Promise<void> {
  await query(
    `UPDATE strategies SET last_autopilot_cycle_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND organization_id = $2`,
    [strategyId, organizationId]
  );
}

/**
 * One agentic pass for an active hands-off strategy:
 * - always log cycle + goal reasoning
 * - park paid-ad gates; keep executing Instagram/content/SEO
 * - advance checkpoints when pause has elapsed
 */
export async function runScheduledCycleForStrategy(
  organizationId: string,
  strategyId: string
): Promise<void> {
  const key = `${organizationId}:${strategyId}`;
  if (running.has(key)) return;
  running.add(key);

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
    await markCycleStarted(organizationId, strategyId);

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
    running.delete(key);
  }
}

export async function runDueAutopilotCycles(): Promise<number> {
  const due = await listDueStrategies();
  for (const row of due) {
    await runScheduledCycleForStrategy(row.organization_id, row.id);
  }
  return due.length;
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
    `[autopilot-cycle] agentic worker on — cadence from org pace (normal 60m / high 30m / intense 15m), wake every ${getAutopilotCycleTickMinutes()}m, pending work runs immediately`
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
