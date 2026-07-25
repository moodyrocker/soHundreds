import { query } from '../database/connection.js';
import type { ExecutionRecord } from '../types/execution.js';
import type { PlanAction } from '../types/plan.js';
import type {
  ActionRunStateRecord,
  ActionRunStatus,
  BlockRunStateRecord,
  BlockRunStatus,
  OrchestratorSnapshot,
} from '../types/orchestrator.js';
import { ExecutionService } from './executionService.js';
import { StrategyService } from './strategyService.js';
import { AnalyticsService } from './analyticsService.js';
import { AutopilotActivityService } from './autopilotActivityService.js';
import { ActionOutcomeService } from './actionOutcomeService.js';
import { LearningKnowledgeService } from './learningKnowledgeService.js';
import { getAutopilotMode } from './autopilotService.js';
import type { StrategyRecord } from './strategyService.js';
import { ActionCompletionService } from './actionCompletionService.js';
import { buildPaidAdHumanGateReason } from '../lib/paidAdHumanGate.js';
import { evaluateMetaAdsCreateThrottle } from '../lib/paidAdThrottle.js';
import { classifyActionIntent } from '../executors/actionRouter.js';
import { getPaceProfile } from '../lib/autopilotPaceConfig.js';
import { getAutopilotPace } from './autopilotService.js';

type ActionRunRow = {
  id: string;
  organization_id: string;
  strategy_id: string;
  week_number: number;
  action_id: string;
  sort_order: number;
  run_status: ActionRunStatus;
  human_gate_reason: string | null;
  execution_id: string | null;
  error_message: string | null;
  confirmed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type BlockRunRow = {
  id: string;
  organization_id: string;
  strategy_id: string;
  week_number: number;
  status: BlockRunStatus;
  checkpoint_reasoning: string | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
};

function mapActionRow(row: ActionRunRow): ActionRunStateRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    strategyId: row.strategy_id,
    weekNumber: row.week_number,
    actionId: row.action_id,
    sortOrder: row.sort_order,
    runStatus: row.run_status,
    humanGateReason: row.human_gate_reason,
    executionId: row.execution_id,
    errorMessage: row.error_message,
    confirmedAt: row.confirmed_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapBlockRow(row: BlockRunRow): BlockRunStateRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    strategyId: row.strategy_id,
    weekNumber: row.week_number,
    status: row.status,
    checkpointReasoning: row.checkpoint_reasoning,
    errorMessage: row.error_message,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const HUMAN_GATE_COPY =
  'Paused campaign created in Ads Manager — review it there, enable spend when ready, then mark done to continue.';

type ConfidenceLevel = 'high' | 'medium' | 'low';
type CheckpointGateDecision = {
  confidence: ConfidenceLevel;
  shouldPause: boolean;
  pauseHours: number;
  reason: string;
};

function decideCheckpointGate(
  analysis: Awaited<ReturnType<AnalyticsService['analyzeForCheckpoint']>>,
  scoredOutcomes: number,
  pauseHours: number
): CheckpointGateDecision {
  const progress = analysis.goalProgress;
  const hasGoalSource = progress.dataSources.length > 0;

  if (progress.status === 'met') {
    return {
      confidence: 'high',
      shouldPause: false,
      pauseHours: 0,
      reason: 'Goal met — no pause required.',
    };
  }

  if (!hasGoalSource || progress.status === 'unknown') {
    return {
      confidence: 'low',
      shouldPause: true,
      pauseHours,
      reason: `Low confidence: goal metric source is missing or progress is unknown. Review in ≤${pauseHours}h.`,
    };
  }

  if (progress.status === 'behind') {
    return {
      confidence: 'low',
      shouldPause: true,
      pauseHours,
      reason: `Low confidence: goal progress is behind target. Review in ≤${pauseHours}h.`,
    };
  }

  if (progress.status === 'on_track' && scoredOutcomes <= 0) {
    return {
      confidence: 'medium',
      shouldPause: false,
      pauseHours: 0,
      reason: 'Medium confidence: on track, but outcomes are still sparse.',
    };
  }

  return {
    confidence: 'high',
    shouldPause: false,
    pauseHours: 0,
    reason: 'High confidence: on track with live goal data and scored outcomes.',
  };
}

export class ExecutionOrchestratorService {
  private execution = new ExecutionService();
  private strategy = new StrategyService();
  private analytics = new AnalyticsService();
  private activity = new AutopilotActivityService();
  private actionOutcomes = new ActionOutcomeService();
  private learning = new LearningKnowledgeService();
  private completions = new ActionCompletionService();

  async getSnapshot(
    organizationId: string,
    strategyId: string,
    week: number
  ): Promise<OrchestratorSnapshot> {
    let actions = await this.listActionRows(organizationId, strategyId, week);

    // Lazily initialize sequential state so the current week always reflects reality,
    // even when actions were prepared by a background batch (hands-off) rather than
    // stepped through the orchestrator.
    if (actions.length === 0) {
      const strategy = await this.strategy.getById(organizationId, strategyId);
      const weekBlock = strategy?.plan?.weeks.find((w) => w.week === week);
      if (weekBlock && weekBlock.actions.length > 0) {
        await this.initializeWeek(organizationId, strategyId, week, weekBlock.actions);
        actions = await this.listActionRows(organizationId, strategyId, week);
      }
    }

    let block = await this.getBlockRow(organizationId, strategyId, week);

    // If every action is already confirmed but we never reached a checkpoint (e.g. a
    // background batch prepared them), run the checkpoint analysis now so the agent's
    // reasoning is surfaced instead of the week silently looking "done".
    const allConfirmed =
      actions.length > 0 && actions.every((a) => a.run_status === 'confirmed');
    if (
      allConfirmed &&
      block &&
      block.status !== 'checkpoint' &&
      block.status !== 'complete'
    ) {
      const strategy = await this.strategy.getById(organizationId, strategyId);
      if (strategy?.plan) {
        await this.enterCheckpoint(organizationId, strategyId, week, strategy.plan, strategy.goal);
        block = await this.getBlockRow(organizationId, strategyId, week);
      }
    }

    const current = actions.find(
      (a) =>
        a.run_status === 'in_progress' ||
        a.run_status === 'awaiting_confirmation' ||
        a.run_status === 'awaiting_human_action'
    );
    return {
      block: block ? mapBlockRow(block) : null,
      actions: actions.map(mapActionRow),
      currentActionId: current?.action_id ?? null,
    };
  }

  async initializeWeek(
    organizationId: string,
    strategyId: string,
    week: number,
    actions: PlanAction[]
  ): Promise<void> {
    await query(
      `INSERT INTO block_run_states (organization_id, strategy_id, week_number, status)
       VALUES ($1, $2, $3, 'idle')
       ON CONFLICT (strategy_id, week_number) DO NOTHING`,
      [organizationId, strategyId, week]
    );

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      await query(
        `INSERT INTO action_run_states (
           organization_id, strategy_id, week_number, action_id, sort_order, run_status
         ) VALUES ($1, $2, $3, $4, $5, 'pending')
         ON CONFLICT (strategy_id, week_number, action_id) DO NOTHING`,
        [organizationId, strategyId, week, action.id, i]
      );
    }

    await this.syncFromExecutions(organizationId, strategyId, week);
  }

  /** Reconcile run states with existing execution records (avoids duplicate previews). */
  private async syncFromExecutions(
    organizationId: string,
    strategyId: string,
    week: number
  ): Promise<void> {
    const executions = await this.execution.listForStrategy(organizationId, strategyId);
    const rows = await this.listActionRows(organizationId, strategyId, week);

    for (const row of rows) {
      const reconcilable =
        row.run_status === 'pending' ||
        row.run_status === 'failed' ||
        row.run_status === 'in_progress' ||
        row.run_status === 'awaiting_confirmation';
      if (!reconcilable) continue;
      const execution = executions.find((e) => e.actionId === row.action_id);
      if (!execution) continue;

      const gate = this.resolveGate(execution);
      if (gate === 'human') {
        const gateCopy = buildPaidAdHumanGateReason(execution);
        await query(
          `UPDATE action_run_states SET
             run_status = 'awaiting_human_action',
             human_gate_reason = $3,
             execution_id = $4,
             updated_at = NOW()
           WHERE id = $1 AND organization_id = $2`,
          [row.id, organizationId, gateCopy, execution.id]
        );
      } else if (execution.status === 'executed' || execution.status === 'skipped') {
        await this.markConfirmed(organizationId, strategyId, row.id, row.action_id, execution.id);
      } else if (execution.status === 'failed') {
        await query(
          `UPDATE action_run_states SET run_status = 'failed', execution_id = $3,
             error_message = $4, updated_at = NOW()
           WHERE id = $1 AND organization_id = $2`,
          [
            row.id,
            organizationId,
            execution.id,
            execution.errorMessage?.slice(0, 2000) ?? 'Action failed',
          ]
        );
      }
    }
  }

  /**
   * After checkpoint: mark block complete, advance strategy, optionally start next week (hands-off).
   */
  async advanceFromCheckpoint(
    organizationId: string,
    strategyId: string,
    week: number
  ): Promise<{ snapshot: OrchestratorSnapshot; strategy: StrategyRecord; continued: boolean }> {
    const block = await this.getBlockRow(organizationId, strategyId, week);
    if (!block || block.status !== 'checkpoint') {
      throw new Error('Week block is not at checkpoint');
    }

    await this.setBlockStatus(organizationId, strategyId, week, 'complete');

    const strategy = await this.strategy.advanceToNextWeek(organizationId, strategyId);
    if (strategy.goalStatus === 'met') {
      return {
        snapshot: await this.getSnapshot(organizationId, strategyId, week),
        strategy,
        continued: false,
      };
    }

    const mode = await getAutopilotMode(organizationId);
    if (mode !== 'hands_off') {
      return {
        snapshot: await this.getSnapshot(organizationId, strategyId, week),
        strategy,
        continued: false,
      };
    }

    const nextWeek = strategy.currentWeek;
    const nextBlock = strategy.plan?.weeks.find((w) => w.week === nextWeek);
    if (!nextBlock) {
      return {
        snapshot: await this.getSnapshot(organizationId, strategyId, week),
        strategy,
        continued: false,
      };
    }

    await this.initializeWeek(organizationId, strategyId, nextWeek, nextBlock.actions);
    const snapshot = await this.runNextStep(organizationId, strategyId, nextWeek);

    await this.activity.log({
      organizationId,
      strategyId,
      weekNumber: nextWeek,
      step: 'continuous',
      title: `Hands-off — started week ${nextWeek}`,
      detail: block.checkpoint_reasoning ?? 'Continuing after checkpoint.',
      status: 'info',
    });

    return { snapshot, strategy, continued: true };
  }

  /**
   * Run the next pending action. Paid-ad human gates are parked so other actions
   * (Instagram, Shopify, etc.) keep moving — agentic loops must not stall on ads review.
   */
  async runNextStep(
    organizationId: string,
    strategyId: string,
    week: number,
    attemptedFailed: Set<string> = new Set()
  ): Promise<OrchestratorSnapshot> {
    const strategy = await this.strategy.getById(organizationId, strategyId);
    const weekBlock = strategy?.plan?.weeks.find((w) => w.week === week);
    if (!strategy?.plan || !weekBlock) {
      throw new Error(`Week ${week} not found`);
    }

    await this.initializeWeek(organizationId, strategyId, week, weekBlock.actions);

    const block = await this.getBlockRow(organizationId, strategyId, week);
    if (block?.status === 'checkpoint' || block?.status === 'complete') {
      return this.getSnapshot(organizationId, strategyId, week);
    }

    await this.setBlockStatus(organizationId, strategyId, week, 'running');

    const rows = await this.listActionRows(organizationId, strategyId, week);

    const next =
      rows.find((r) => r.run_status === 'pending') ??
      rows.find(
        (r) => r.run_status === 'failed' && !attemptedFailed.has(r.action_id)
      );
    if (!next) {
      // Parked ads + failed actions do not block checkpoint — agent keeps cycling.
      const allSettled = rows.every(
        (r) =>
          r.run_status === 'confirmed' ||
          r.run_status === 'awaiting_human_action' ||
          r.run_status === 'failed'
      );
      if (allSettled && rows.length > 0) {
        await this.enterCheckpoint(organizationId, strategyId, week, strategy.plan, strategy.goal);
      }
      return this.getSnapshot(organizationId, strategyId, week);
    }

    if (next.run_status === 'failed') {
      attemptedFailed.add(next.action_id);
    }

    const planAction = weekBlock.actions.find((a) => a.id === next.action_id);
    if (planAction && classifyActionIntent(planAction) === 'meta_ads_campaign') {
      const throttle = await evaluateMetaAdsCreateThrottle(organizationId);
      if (!throttle.allowCreate) {
        await query(
          `UPDATE action_run_states SET
             run_status = 'awaiting_human_action',
             human_gate_reason = $3,
             error_message = NULL,
             updated_at = NOW()
           WHERE id = $1 AND organization_id = $2`,
          [next.id, organizationId, throttle.reason.slice(0, 2000)]
        );
        await this.activity.log({
          organizationId,
          strategyId,
          weekNumber: week,
          actionId: next.action_id,
          step: 'awaiting_human',
          title: 'Skipped new Meta campaign — no spend data yet',
          detail: `${throttle.reason} Agent continues Instagram / content / SEO without creating another paused ad.`,
          status: 'warn',
        });
        return this.getSnapshot(organizationId, strategyId, week);
      }
    }

    await this.updateActionStatus(organizationId, next.id, 'in_progress', null);

    try {
      const result = await this.execution.preview(
        organizationId,
        strategyId,
        next.action_id
      );
      const finalized = await this.execution.finalizeForSequentialStep(
        organizationId,
        result.execution
      );
      const execution = finalized.execution;

      if (finalized.needsHumanGate) {
        const gateCopy = buildPaidAdHumanGateReason(execution);
        await query(
          `UPDATE action_run_states SET
             run_status = 'awaiting_human_action',
             human_gate_reason = $3,
             execution_id = $4,
             error_message = NULL,
             updated_at = NOW()
           WHERE id = $1 AND organization_id = $2`,
          [next.id, organizationId, gateCopy, execution.id]
        );
        await this.activity.log({
          organizationId,
          strategyId,
          weekNumber: week,
          actionId: next.action_id,
          step: 'awaiting_human',
          title: 'Paid campaign parked — agent continues other work',
          detail: `${gateCopy} Other plan actions (Instagram, content, SEO) keep running automatically.`,
          status: 'warn',
        });
      } else {
        await this.markConfirmed(
          organizationId,
          strategyId,
          next.id,
          next.action_id,
          execution.id
        );
        await this.activity.log({
          organizationId,
          strategyId,
          weekNumber: week,
          actionId: next.action_id,
          step: 'complete',
          title: weekBlock.actions.find((a) => a.id === next.action_id)?.title ?? next.action_id,
          detail: execution.summary,
          status: 'success',
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Action failed';
      await query(
        `UPDATE action_run_states SET run_status = 'failed', error_message = $3, updated_at = NOW()
         WHERE id = $1 AND organization_id = $2`,
        [next.id, organizationId, message.slice(0, 2000)]
      );
      // Do not halt the whole week — park the failure and keep processing remaining actions.
      await this.activity.log({
        organizationId,
        strategyId,
        weekNumber: week,
        actionId: next.action_id,
        step: 'failed',
        title: 'Action failed — agent continues with remaining work',
        detail: message,
        status: 'error',
      });
    }

    return this.getSnapshot(organizationId, strategyId, week);
  }

  async confirmHumanAction(
    organizationId: string,
    strategyId: string,
    week: number,
    actionId: string
  ): Promise<OrchestratorSnapshot> {
    const row = await this.getActionRow(organizationId, strategyId, week, actionId);
    if (!row) throw new Error('Action run state not found');
    if (row.run_status !== 'awaiting_human_action') {
      throw new Error(`Action is not awaiting human confirmation (status: ${row.run_status})`);
    }

    await this.markConfirmed(
      organizationId,
      strategyId,
      row.id,
      actionId,
      row.execution_id
    );
    await this.setBlockStatus(organizationId, strategyId, week, 'running');

    await this.activity.log({
      organizationId,
      strategyId,
      weekNumber: week,
      actionId,
      step: 'human_confirmed',
      title: 'Ad spend enabled — continuing sequence',
      detail: 'Human confirmed paid ad is live; agent moving to next action.',
      status: 'success',
    });

    return this.runNextStep(organizationId, strategyId, week);
  }

  /**
   * Run sequential steps until no pending work remains (or checkpoint).
   * Paid-ad human gates do not stop the loop. Failed actions are retried once per pass.
   */
  async runUntilBlocked(
    organizationId: string,
    strategyId: string,
    week: number,
    maxSteps = 50
  ): Promise<OrchestratorSnapshot> {
    const attemptedFailed = new Set<string>();
    let snapshot = await this.runNextStep(organizationId, strategyId, week, attemptedFailed);

    for (let i = 0; i < maxSteps; i++) {
      if (snapshot.block?.status === 'checkpoint') {
        return snapshot;
      }
      const pending = snapshot.actions.some((a) => a.runStatus === 'pending');
      const retryableFailed = snapshot.actions.some(
        (a) => a.runStatus === 'failed' && !attemptedFailed.has(a.actionId)
      );
      if (!pending && !retryableFailed) {
        // One more step so we can enter checkpoint when only parked/failed remain.
        return this.runNextStep(organizationId, strategyId, week, attemptedFailed);
      }
      snapshot = await this.runNextStep(organizationId, strategyId, week, attemptedFailed);
    }

    return this.runNextStep(organizationId, strategyId, week, attemptedFailed);
  }

  private resolveGate(execution: ExecutionRecord): 'human' | 'none' {
    if (execution.executionType === 'create_meta_ads_campaign') {
      if (execution.status !== 'executed') return 'none';
      const state = execution.afterState;
      if (state?.kind === 'meta_ads_campaign' && state.campaignId) {
        return 'human';
      }
      return 'none';
    }
    if (execution.executionType === 'create_google_ads_campaign') {
      if (execution.status === 'executed') {
        return 'human';
      }
    }
    return 'none';
  }

  private async markConfirmed(
    organizationId: string,
    strategyId: string,
    actionRunId: string,
    actionId: string,
    executionId: string | null
  ): Promise<void> {
    await query(
      `UPDATE action_run_states SET
         run_status = 'confirmed',
         execution_id = COALESCE($3, execution_id),
         confirmed_at = NOW(),
         error_message = NULL,
         updated_at = NOW()
       WHERE id = $1 AND organization_id = $2`,
      [actionRunId, organizationId, executionId]
    );
    await this.completions.setCompleted(organizationId, strategyId, actionId, true);
  }

  private async enterCheckpoint(
    organizationId: string,
    strategyId: string,
    week: number,
    plan: NonNullable<Awaited<ReturnType<StrategyService['getById']>>>['plan'],
    goalLine: string
  ): Promise<void> {
    const analysis = await this.analytics.analyzeForCheckpoint(
      organizationId,
      plan!,
      goalLine
    );
    const reasoning = analysis.reasoningLines.join(' ');

    const actionRows = await this.listActionRows(organizationId, strategyId, week);
    const confirmedActionIds = actionRows
      .filter((r) => r.run_status === 'confirmed')
      .map((r) => r.action_id);

    const outcomes = await this.actionOutcomes.recordBlockOutcomes({
      organizationId,
      strategyId,
      weekNumber: week,
      plan: plan!,
      goalLine,
      analysis,
      confirmedActionIds,
    });

    const scoredOutcomes = outcomes.filter((o) => o.rating !== 'unknown').length;
    const pace = await getAutopilotPace(organizationId);
    const pauseHours = getPaceProfile(pace).checkpointPauseHours;
    const gate = decideCheckpointGate(analysis, scoredOutcomes, pauseHours);

    const patterns = await this.learning.refreshPatterns(organizationId);

    await query(
      `UPDATE block_run_states SET
         status = 'checkpoint',
         checkpoint_reasoning = $4,
         updated_at = NOW()
       WHERE organization_id = $1 AND strategy_id = $2 AND week_number = $3`,
      [organizationId, strategyId, week, reasoning]
    );

    if (gate.shouldPause && gate.pauseHours > 0) {
      await query(
        `UPDATE strategies SET
           pause_until = NOW() + ($3 || ' hours')::interval,
           next_batch_reasoning = $4,
           updated_at = NOW()
         WHERE id = $1 AND organization_id = $2`,
        [strategyId, organizationId, String(gate.pauseHours), reasoning]
      );
    } else {
      await query(
        `UPDATE strategies SET
           pause_until = NULL,
           next_batch_reasoning = $3,
           updated_at = NOW()
         WHERE id = $1 AND organization_id = $2`,
        [strategyId, organizationId, reasoning]
      );
    }

    await this.activity.log({
      organizationId,
      strategyId,
      weekNumber: week,
      step: 'checkpoint',
      title: 'Block complete — re-analyzing performance',
      detail: reasoning,
      status: 'info',
    });

    await this.activity.log({
      organizationId,
      strategyId,
      weekNumber: week,
      step: 'decision',
      title: `Decision gate — ${gate.confidence} confidence`,
      detail: `${gate.reason}${gate.shouldPause ? ` Scheduled review in ${gate.pauseHours}h.` : ' Continuing cycle.'}`,
      status: gate.shouldPause ? 'warn' : 'info',
    });

    if (outcomes.length) {
      await this.activity.log({
        organizationId,
        strategyId,
        weekNumber: week,
        step: 'learning_scored',
        title: `Learning layer — scored ${scoredOutcomes} action outcome(s)`,
        detail: outcomes
          .map((o) => `${o.actionTitle}: ${o.rating} (${o.rating === 'success' ? '+' : ''}${Math.round(o.effectivenessScore * 100)}%)`)
          .join(' · '),
        status: 'info',
      });
    }

    if (patterns.length) {
      await this.activity.log({
        organizationId,
        strategyId,
        weekNumber: week,
        step: 'learning_patterns',
        title: `Updated ${patterns.length} learning pattern(s) for future plans`,
        detail: patterns.map((p) => p.patternText).join(' '),
        status: 'info',
      });
    }
  }

  private async setBlockStatus(
    organizationId: string,
    strategyId: string,
    week: number,
    status: BlockRunStatus,
    errorMessage?: string
  ): Promise<void> {
    await query(
      `UPDATE block_run_states SET status = $4, error_message = $5, updated_at = NOW()
       WHERE organization_id = $1 AND strategy_id = $2 AND week_number = $3`,
      [organizationId, strategyId, week, status, errorMessage?.slice(0, 2000) ?? null]
    );
  }

  private async updateActionStatus(
    organizationId: string,
    id: string,
    status: ActionRunStatus,
    error: string | null
  ): Promise<void> {
    await query(
      `UPDATE action_run_states SET run_status = $3, error_message = $4, updated_at = NOW()
       WHERE id = $1 AND organization_id = $2`,
      [id, organizationId, status, error]
    );
  }

  private async getBlockRow(
    organizationId: string,
    strategyId: string,
    week: number
  ): Promise<BlockRunRow | null> {
    const result = await query<BlockRunRow>(
      `SELECT * FROM block_run_states
       WHERE organization_id = $1 AND strategy_id = $2 AND week_number = $3`,
      [organizationId, strategyId, week]
    );
    return result.rows[0] ?? null;
  }

  private async listActionRows(
    organizationId: string,
    strategyId: string,
    week: number
  ): Promise<ActionRunRow[]> {
    const result = await query<ActionRunRow>(
      `SELECT * FROM action_run_states
       WHERE organization_id = $1 AND strategy_id = $2 AND week_number = $3
       ORDER BY sort_order ASC`,
      [organizationId, strategyId, week]
    );
    return result.rows;
  }

  private async getActionRow(
    organizationId: string,
    strategyId: string,
    week: number,
    actionId: string
  ): Promise<ActionRunRow | null> {
    const result = await query<ActionRunRow>(
      `SELECT * FROM action_run_states
       WHERE organization_id = $1 AND strategy_id = $2 AND week_number = $3 AND action_id = $4`,
      [organizationId, strategyId, week, actionId]
    );
    return result.rows[0] ?? null;
  }
}
