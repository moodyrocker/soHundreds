import { query } from '../database/connection.js';
import type { PlanDocument } from '../types/plan.js';
import type { StrategyRequest } from '../types/index.js';
import { ClaudeService } from './claudeService.js';
import { GoogleAdsSnapshotService } from './googleAdsSnapshotService.js';
import { GoogleAnalyticsSnapshotService } from './googleAnalyticsSnapshotService.js';
import { MetaAdsSnapshotService } from './metaAdsSnapshotService.js';
import { ShopifySnapshotService } from './shopifySnapshotService.js';
import { isGoogleAdsEnabled } from '../lib/googleFeatureFlags.js';
import { MCPConnectionService } from './mcpConnectionService.js';
import {
  getBusinessProfile,
  resolveStrategyContext,
} from './businessProfileService.js';
import { countPlanActions } from '../utils/parsePlanJson.js';
import { sanitizeModelStrings, stripWebSearchCitations } from '../utils/stripModelMarkup.js';
import { MarketIntelService } from './marketIntel/marketIntelService.js';
import { AuditLogService } from './auditLogService.js';
import { getAutopilotMode, getAutopilotPace } from './autopilotService.js';
import { ExecutionService } from './executionService.js';
import { ExecutionOrchestratorService } from './executionOrchestratorService.js';
import { filterPlanByIntegrations, stripUnsupportedPlatformsFromPlan } from './integrationPlanFilter.js';
import { LearningKnowledgeService } from './learningKnowledgeService.js';
import { AutopilotActivityService } from './autopilotActivityService.js';
import { GoalProgressService } from './goalProgressService.js';
import { WeekOutcomeService } from './weekOutcomeService.js';
import {
  evaluateMetaAdsCreateThrottle,
  formatMetaAdsThrottleForPrompt,
} from '../lib/paidAdThrottle.js';
import { listLoadedSources, runPlanWorkers } from '../workers/runWorkers.js';
import { logger } from '../lib/logger.js';

const log = logger('strategy');

export type StrategyDataSource =
  | 'analytics'
  | 'google_ads'
  | 'meta_ads'
  | 'shopify'
  | 'multi'
  | 'generic';

export type StrategyStatus = 'generating' | 'active' | 'archived' | 'failed';
export type GoalStatus = 'active' | 'met' | 'paused';

export interface StrategyRecord {
  id: string;
  organizationId: string;
  goal: string;
  context: string | null;
  budget: string | null;
  status: StrategyStatus;
  dataSource: StrategyDataSource;
  plan: PlanDocument | null;
  actionCount: number;
  generationError: string | null;
  parentStrategyId: string | null;
  refinementNotes: string | null;
  currentWeek: number;
  goalStatus: GoalStatus;
  pauseUntil: string | null;
  nextBatchReasoning: string | null;
  createdAt: string;
  updatedAt: string;
}

type StrategyRow = {
  id: string;
  organization_id: string;
  goal: string;
  context: string | null;
  budget: string | null;
  status: StrategyStatus;
  data_source: StrategyDataSource;
  plan_json: PlanDocument | null;
  generation_error: string | null;
  parent_strategy_id: string | null;
  refinement_notes: string | null;
  current_week: number;
  goal_status: GoalStatus;
  pause_until: Date | null;
  next_batch_reasoning: string | null;
  created_at: Date;
  updated_at: Date;
};

const runningJobs = new Set<string>();

function mapRow(row: StrategyRow): StrategyRecord {
  const rawPlan = row.plan_json ? sanitizeModelStrings(row.plan_json) : null;
  const plan = rawPlan ? stripUnsupportedPlatformsFromPlan(rawPlan) : null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    goal: row.goal,
    context: row.context,
    budget: row.budget,
    status: row.status,
    dataSource: row.data_source,
    plan,
    actionCount: plan ? countPlanActions(plan) : 0,
    generationError: row.generation_error,
    parentStrategyId: row.parent_strategy_id,
    refinementNotes: row.refinement_notes
      ? stripWebSearchCitations(row.refinement_notes)
      : null,
    currentWeek: row.current_week ?? 1,
    goalStatus: row.goal_status ?? 'active',
    pauseUntil: row.pause_until?.toISOString() ?? null,
    nextBatchReasoning: row.next_batch_reasoning ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function resolveDataSource(flags: {
  analytics: boolean;
  googleAds: boolean;
  metaAds: boolean;
  shopify: boolean;
}): StrategyDataSource {
  const active: StrategyDataSource[] = [];
  if (flags.analytics) active.push('analytics');
  if (flags.googleAds) active.push('google_ads');
  if (flags.metaAds) active.push('meta_ads');
  if (flags.shopify) active.push('shopify');
  if (active.length >= 2) return 'multi';
  if (active.length === 1) return active[0];
  return 'generic';
}

type SnapshotBundle = {
  dataSource: StrategyDataSource;
  ctx: Parameters<ClaudeService['generatePlanDocument']>[1];
};

export class StrategyService {
  private claude = new ClaudeService();
  private mcp = new MCPConnectionService();
  private gaSnapshot = new GoogleAnalyticsSnapshotService();
  private adsSnapshot = new GoogleAdsSnapshotService();
  private metaSnapshot = new MetaAdsSnapshotService();
  private shopifySnapshot = new ShopifySnapshotService();
  private marketIntel = new MarketIntelService();
  private auditLog = new AuditLogService();
  private goalProgress = new GoalProgressService();
  private weekOutcomes = new WeekOutcomeService();

  private async enrichRequest(
    organizationId: string,
    request: StrategyRequest
  ): Promise<{ enrichedRequest: StrategyRequest; context: string | null; budget: string | null }> {
    const businessProfile = await getBusinessProfile(organizationId);
    const { context, budget } = resolveStrategyContext(
      businessProfile,
      request.context,
      request.budget
    );
    return {
      enrichedRequest: {
        ...request,
        context: context ?? undefined,
        budget: budget ?? undefined,
      },
      context,
      budget,
    };
  }

  private async loadSnapshots(organizationId: string): Promise<SnapshotBundle> {
    const connections = await this.mcp.getActiveConnections(organizationId);
    const analytics = connections.find((c) => c.platform === 'google_analytics');
    const ads = connections.find((c) => c.platform === 'google_ads');
    const meta = connections.find((c) => c.platform === 'meta_ads');
    const shopify = connections.find((c) => c.platform === 'shopify');
    const hasProperty = Boolean(analytics?.propertyId);
    const hasAdsCustomer =
      isGoogleAdsEnabled() && Boolean(ads?.config?.customerId);
    const hasMetaAccount = Boolean(meta?.config?.adAccountId);
    const hasShop = Boolean(shopify?.config?.shopDomain);

    const safeFetch = async <T extends { text: string }>(
      label: string,
      enabled: boolean,
      fetcher: () => Promise<T | null>
    ): Promise<string | undefined> => {
      if (!enabled) return undefined;
      try {
        const snapshot = await fetcher();
        return snapshot?.text;
      } catch (err) {
        log.warn(`${label} snapshot failed:`, err);
        return undefined;
      }
    };

    const [analyticsSnapshotText, googleAdsSnapshotText, metaAdsSnapshotText, shopifySnapshotText] =
      await Promise.all([
        safeFetch('GA', hasProperty, () => this.gaSnapshot.fetchSnapshot(organizationId)),
        safeFetch('Google Ads', hasAdsCustomer, () =>
          this.adsSnapshot.fetchSnapshot(organizationId)
        ),
        safeFetch('Meta Ads', hasMetaAccount, () =>
          this.metaSnapshot.fetchSnapshot(organizationId)
        ),
        safeFetch('Shopify', hasShop, () => this.shopifySnapshot.fetchSnapshot(organizationId)),
      ]);

    const dataSource = resolveDataSource({
      analytics: Boolean(analyticsSnapshotText),
      googleAds: Boolean(googleAdsSnapshotText),
      metaAds: Boolean(metaAdsSnapshotText),
      shopify: Boolean(shopifySnapshotText),
    });

    return {
      dataSource,
      ctx: {
        hasAnalytics: hasProperty,
        propertyId: analytics?.propertyId,
        analyticsSnapshotText,
        hasGoogleAds: hasAdsCustomer,
        googleAdsSnapshotText,
        hasMetaAds: hasMetaAccount,
        metaAdsSnapshotText,
        hasShopify: hasShop,
        shopifySnapshotText,
      },
    };
  }

  /** Returns an in-flight generation for this workspace, if any. */
  async getGenerating(organizationId: string): Promise<StrategyRecord | null> {
    const result = await query<StrategyRow>(
      `SELECT * FROM strategies
       WHERE organization_id = $1 AND status = 'generating'
       ORDER BY created_at DESC
       LIMIT 1`,
      [organizationId]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  /**
   * Insert a generating row and return immediately. Caller should invoke runGeneration() without awaiting.
   */
  async startCreate(organizationId: string, request: StrategyRequest): Promise<StrategyRecord> {
    const existing = await this.getGenerating(organizationId);
    if (existing) {
      log.info(`reusing generating id=${existing.id} org=${organizationId}`);
      return existing;
    }

    const { enrichedRequest, context, budget } = await this.enrichRequest(organizationId, request);

    const result = await query<StrategyRow>(
      `INSERT INTO strategies (
         organization_id, goal, context, budget, status, data_source, plan_json, generation_error
       ) VALUES ($1, $2, $3, $4, 'generating', 'generic', NULL, NULL)
       RETURNING *`,
      [organizationId, enrichedRequest.goal, context, budget]
    );

    const pending = mapRow(result.rows[0]);
    log.info(`queued id=${pending.id} org=${organizationId}`);
    return pending;
  }

  /**
   * Phase 2B: Regenerate from an existing plan with user refinement notes (new row, same goal).
   */
  async startRefine(
    organizationId: string,
    parentStrategyId: string,
    refinementNotes: string
  ): Promise<StrategyRecord> {
    const existing = await this.getGenerating(organizationId);
    if (existing) {
      log.info(`refine reusing generating id=${existing.id} org=${organizationId}`);
      return existing;
    }

    const parent = await this.getById(organizationId, parentStrategyId);
    if (!parent) {
      throw new Error('Plan not found');
    }
    if (parent.status === 'generating') {
      throw new Error('That plan is still generating');
    }
    if (parent.status === 'failed' || !parent.plan) {
      throw new Error('Refine only works on a completed plan');
    }

    const notes = refinementNotes.trim();
    const result = await query<StrategyRow>(
      `INSERT INTO strategies (
         organization_id, goal, context, budget, status, data_source, plan_json,
         generation_error, parent_strategy_id, refinement_notes
       ) VALUES ($1, $2, $3, $4, 'generating', 'generic', NULL, NULL, $5, $6)
       RETURNING *`,
      [organizationId, parent.goal, parent.context, parent.budget, parentStrategyId, notes]
    );

    const pending = mapRow(result.rows[0]);
    log.info(`refine queued id=${pending.id} parent=${parentStrategyId} org=${organizationId}`);
    return pending;
  }

  /** Runs snapshots + Claude and activates the plan. Safe to call in the background. */
  runGeneration(organizationId: string, strategyId: string, request: StrategyRequest): void {
    if (runningJobs.has(strategyId)) return;
    runningJobs.add(strategyId);

    void this.executeGeneration(organizationId, strategyId, request).finally(() => {
      runningJobs.delete(strategyId);
    });
  }

  private async executeGeneration(
    organizationId: string,
    strategyId: string,
    request: StrategyRequest
  ): Promise<void> {
    log.info(`generate start id=${strategyId} org=${organizationId}`);

    try {
      const row = await query<StrategyRow>(
        `SELECT status FROM strategies WHERE id = $1 AND organization_id = $2`,
        [strategyId, organizationId]
      );
      if (!row.rows[0] || row.rows[0].status !== 'generating') {
        log.info(`skip id=${strategyId} (not generating)`);
        return;
      }

      const { enrichedRequest } = await this.enrichRequest(organizationId, request);
      const { dataSource, ctx } = await this.loadSnapshots(organizationId);
      const businessProfile = await getBusinessProfile(organizationId);
      const intelSection = this.marketIntel.buildPromptSection(businessProfile);

      const workerCtx = {
        organizationId,
        request: enrichedRequest,
        businessProfile,
        planContext: ctx,
        dataSource,
      };
      const workerReports = await runPlanWorkers(workerCtx);
      const sourcesLoaded = listLoadedSources(workerCtx);

      const learning = new LearningKnowledgeService();
      const learningCtx = await learning.getPatternsForPlanning(organizationId);
      const metaThrottle = await evaluateMetaAdsCreateThrottle(organizationId);
      const paidGateSection = formatMetaAdsThrottleForPrompt(metaThrottle);
      const learningSection = [learningCtx.promptSection, paidGateSection]
        .filter(Boolean)
        .join('\n');

      const pace = await getAutopilotPace(organizationId);
      let plan = await this.claude.generatePlanDocument(
        enrichedRequest,
        ctx,
        intelSection,
        enrichedRequest.refinementNotes,
        workerReports,
        learningSection || undefined,
        pace
      );

      if (learningCtx.applied.length && plan.weeks[0]) {
        plan = {
          ...plan,
          weeks: plan.weeks.map((w, i) =>
            i === 0 ? { ...w, learningApplied: learningCtx.applied } : w
          ),
        };
      }

      const integrations = await new ExecutionService().getIntegrationFlagsPublic(organizationId);
      plan = filterPlanByIntegrations(plan, integrations).plan;

      const metaRow = await query<{ parent_strategy_id: string | null }>(
        `SELECT parent_strategy_id FROM strategies WHERE id = $1 AND organization_id = $2`,
        [strategyId, organizationId]
      );
      const parentId = metaRow.rows[0]?.parent_strategy_id ?? null;

      await query(
        `UPDATE strategies SET status = 'archived', updated_at = NOW()
         WHERE organization_id = $1 AND status = 'active'`,
        [organizationId]
      );

      await query(
        `UPDATE strategies SET
           status = 'active',
           data_source = $3,
           plan_json = $4::jsonb,
           generation_error = NULL,
           updated_at = NOW()
         WHERE id = $1 AND organization_id = $2 AND status = 'generating'`,
        [strategyId, organizationId, dataSource, JSON.stringify(plan)]
      );

      await this.auditLog.recordPlanGeneration({
        organizationId,
        strategyId,
        eventType: parentId ? 'plan_refined' : 'plan_created',
        dataSource,
        sourcesLoaded,
        workerReports,
        metadata: {
          goal: enrichedRequest.goal.slice(0, 200),
          parentStrategyId: parentId,
          hasRefinementNotes: Boolean(enrichedRequest.refinementNotes?.trim()),
        },
      });

      log.info(`generate ok id=${strategyId} org=${organizationId}`);

      if (learningCtx.applied.length) {
        const activity = new AutopilotActivityService();
        await activity.log({
          organizationId,
          strategyId,
          weekNumber: 1,
          step: 'learning_applied',
          title: 'Plan informed by historical learning',
          detail: learningCtx.applied
            .map((p) => `${p.pattern} (${p.sampleSize} prior actions, ${Math.round(p.confidence * 100)}% confidence)`)
            .join(' · '),
          status: 'info',
        });
      }

      void this.runAutopilotCurrentWeek(organizationId, strategyId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Plan generation failed';
      log.error(`generate failed id=${strategyId} org=${organizationId}:`, message);

      await query(
        `UPDATE strategies SET
           status = 'failed',
           generation_error = $3,
           updated_at = NOW()
         WHERE id = $1 AND organization_id = $2 AND status = 'generating'`,
        [strategyId, organizationId, message.slice(0, 2000)]
      );
    }
  }

  /** After a confirmed autopilot batch — evaluate metrics and maybe advance (hands-off). */
  async afterAutopilotBatch(organizationId: string, strategyId: string): Promise<void> {
    await this.evaluateCurrentWeek(organizationId, strategyId);
    await this.maybeAdvanceAfterAutopilot(organizationId, strategyId);
  }

  private async runAutopilotCurrentWeek(organizationId: string, strategyId: string): Promise<void> {
    try {
      const strategy = await this.getById(organizationId, strategyId);
      if (!strategy || strategy.goalStatus !== 'active') return;

      const week = strategy.currentWeek;
      const execution = new ExecutionService();
      const orchestrator = new ExecutionOrchestratorService();
      log.info(`sequential week ${week} strategy=${strategyId}`);

      // Preflight only — live data pull + reasoning, no parallel execution.
      await execution.runWeekAutopilot(organizationId, strategyId, week, false, false);

      const snapshot = await orchestrator.runUntilBlocked(organizationId, strategyId, week);
      const confirmed = snapshot.actions.filter((a) => a.runStatus === 'confirmed').length;
      log.info(
        `week ${week} sequential strategy=${strategyId} confirmed=${confirmed}/${snapshot.actions.length} block=${snapshot.block?.status ?? 'idle'}`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Autopilot failed';
      log.error(`failed strategy=${strategyId}:`, message);
    }
  }

  /** Read metrics vs goalTarget and record week outcome when the week is fully prepared. */
  async evaluateCurrentWeek(
    organizationId: string,
    strategyId: string
  ): Promise<{
    progress: Awaited<ReturnType<GoalProgressService['checkProgress']>>;
    outcome: import('./weekOutcomeService.js').WeekOutcomeRecord | null;
    weekReady: boolean;
  }> {
    const strategy = await this.getById(organizationId, strategyId);
    if (!strategy?.plan) {
      throw new Error('Plan not found');
    }

    const weekNum = strategy.currentWeek;
    const weekBlock = strategy.plan.weeks.find((w) => w.week === weekNum);
    if (!weekBlock) {
      throw new Error(`Week ${weekNum} not found`);
    }

    const executions = await new ExecutionService().listForStrategy(organizationId, strategyId);
    const actionsPrepared = weekBlock.actions.filter((action) => {
      const ex = executions.find((e) => e.actionId === action.id);
      return ex && (ex.status === 'executed' || ex.status === 'previewed');
    }).length;
    const weekReady = actionsPrepared === weekBlock.actions.length;

    const priorBaseline = await this.weekOutcomes.getLatestBaseline(strategyId);
    const progress = await this.goalProgress.checkProgress(
      organizationId,
      strategy.plan,
      strategy.plan.summary.goalLine,
      priorBaseline,
      strategyId
    );

    await this.auditLog.recordGoalEvent({
      organizationId,
      strategyId,
      eventType: 'goal_progress_check',
      summary: progress.summary,
      metadata: {
        week: weekNum,
        status: progress.status,
        progressPct: progress.progressPct,
        goalMet: progress.goalMet,
      },
    });

    let outcome = null;
    if (weekReady) {
      outcome = await this.weekOutcomes.recordWeekOutcome({
        organizationId,
        strategyId,
        weekNumber: weekNum,
        actionsPrepared,
        actionsTotal: weekBlock.actions.length,
        progress,
      });

      await this.auditLog.recordGoalEvent({
        organizationId,
        strategyId,
        eventType: 'week_outcome_recorded',
        summary: outcome.summary ?? progress.summary,
        metadata: { week: weekNum, outcomeId: outcome.id },
      });
    }

    if (progress.goalMet && strategy.goalStatus === 'active') {
      await query(
        `UPDATE strategies SET goal_status = 'met', updated_at = NOW() WHERE id = $1 AND organization_id = $2`,
        [strategyId, organizationId]
      );
      await this.auditLog.recordGoalEvent({
        organizationId,
        strategyId,
        eventType: 'goal_met',
        summary: progress.summary,
        metadata: { week: weekNum },
      });
    }

    return { progress, outcome, weekReady };
  }

  async getGoalProgress(organizationId: string, strategyId: string) {
    const result = await this.evaluateCurrentWeek(organizationId, strategyId);
    const outcomes = await this.weekOutcomes.listForStrategy(strategyId);
    return { ...result, outcomes };
  }

  /** Hands-off only: when the current week is fully prepared, evaluate metrics and plan next week. */
  private async maybeAdvanceAfterAutopilot(
    organizationId: string,
    strategyId: string
  ): Promise<void> {
    const mode = await getAutopilotMode(organizationId);
    if (mode !== 'hands_off') return;

    const strategy = await this.getById(organizationId, strategyId);
    if (!strategy?.plan || strategy.goalStatus !== 'active') return;

    const weekNum = strategy.currentWeek;
    const weekBlock = strategy.plan.weeks.find((w) => w.week === weekNum);
    if (!weekBlock) return;

    const executions = await new ExecutionService().listForStrategy(organizationId, strategyId);
    const allReady = weekBlock.actions.every((action) => {
      const ex = executions.find((e) => e.actionId === action.id);
      return ex && (ex.status === 'executed' || ex.status === 'previewed');
    });

    if (!allReady) return;

    const { progress } = await this.evaluateCurrentWeek(organizationId, strategyId);
    if (progress.goalMet) {
      log.info(`goal met strategy=${strategyId}`);
      return;
    }

    const nextWeek = weekNum + 1;
    const hasNext = strategy.plan.weeks.some((w) => w.week === nextWeek);

    if (hasNext) {
      await query(
        `UPDATE strategies SET current_week = $2, pause_until = NULL, next_batch_reasoning = NULL, updated_at = NOW() WHERE id = $1 AND organization_id = $3`,
        [strategyId, nextWeek, organizationId]
      );
      await this.runAutopilotCurrentWeek(organizationId, strategyId);
      return;
    }

    void this.generateAndRunNextWeek(organizationId, strategyId, nextWeek);
  }

  /** Manual advance: evaluate week, stop if goal met, else plan/run next week. */
  async advanceToNextWeek(organizationId: string, strategyId: string): Promise<StrategyRecord> {
    const strategy = await this.getById(organizationId, strategyId);
    if (!strategy?.plan) {
      throw new Error('Plan not found');
    }
    if (strategy.goalStatus === 'met') {
      throw new Error('Goal already met');
    }

    const weekBlock = strategy.plan.weeks.find((w) => w.week === strategy.currentWeek);
    if (!weekBlock) {
      throw new Error('Current week not found');
    }

    const executions = await new ExecutionService().listForStrategy(organizationId, strategyId);
    const allReady = weekBlock.actions.every((action) => {
      const ex = executions.find((e) => e.actionId === action.id);
      return ex && (ex.status === 'executed' || ex.status === 'previewed');
    });
    if (!allReady) {
      throw new Error('Finish preparing this week before advancing');
    }

    const { progress } = await this.evaluateCurrentWeek(organizationId, strategyId);
    if (progress.goalMet) {
      const updated = await this.getById(organizationId, strategyId);
      if (!updated) throw new Error('Plan not found');
      return updated;
    }

    const nextWeek = strategy.currentWeek + 1;
    const hasNext = strategy.plan.weeks.some((w) => w.week === nextWeek);

    if (hasNext) {
      await query(
        `UPDATE strategies SET current_week = $2, pause_until = NULL, next_batch_reasoning = NULL, updated_at = NOW() WHERE id = $1 AND organization_id = $3`,
        [strategyId, nextWeek, organizationId]
      );
      void this.runAutopilotCurrentWeek(organizationId, strategyId);
    } else {
      void this.generateAndRunNextWeek(organizationId, strategyId, nextWeek);
    }

    const updated = await this.getById(organizationId, strategyId);
    if (!updated) throw new Error('Plan not found');
    return updated;
  }

  private async generateAndRunNextWeek(
    organizationId: string,
    strategyId: string,
    nextWeek: number
  ): Promise<void> {
    if (runningJobs.has(`${strategyId}:week${nextWeek}`)) return;
    runningJobs.add(`${strategyId}:week${nextWeek}`);

    try {
      const strategy = await this.getById(organizationId, strategyId);
      if (!strategy?.plan || strategy.goalStatus !== 'active') return;

      const request: StrategyRequest = {
        organizationId,
        goal: strategy.goal,
        context: strategy.context ?? undefined,
        budget: strategy.budget ?? undefined,
      };
      const { enrichedRequest } = await this.enrichRequest(organizationId, request);
      const { ctx } = await this.loadSnapshots(organizationId);
      const priorOutcomes = await this.weekOutcomes.listForStrategy(strategyId);
      const outcomeContext = this.weekOutcomes.formatForPrompt(priorOutcomes);

      const priorWeek = nextWeek - 1;
      const checkpointRow = await query<{ checkpoint_reasoning: string | null }>(
        `SELECT checkpoint_reasoning FROM block_run_states
         WHERE strategy_id = $1 AND week_number = $2 AND checkpoint_reasoning IS NOT NULL`,
        [strategyId, priorWeek]
      );
      const checkpointReasoning = checkpointRow.rows[0]?.checkpoint_reasoning?.trim();
      const replanContext = [
        outcomeContext,
        checkpointReasoning
          ? `CHECKPOINT ANALYTICS REASONING (use this to decide next block — explain why in action "why" fields):\n${checkpointReasoning}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      const learning = new LearningKnowledgeService();
      const goalMetricHint = strategy.plan.summary.goalTarget?.metric ?? strategy.goal;
      const learningCtx = await learning.getPatternsForPlanning(organizationId, goalMetricHint);
      const metaThrottle = await evaluateMetaAdsCreateThrottle(organizationId);
      const learningSection = [
        learningCtx.promptSection,
        formatMetaAdsThrottleForPrompt(metaThrottle),
      ]
        .filter(Boolean)
        .join('\n');

      const pace = await getAutopilotPace(organizationId);
      const result = await this.claude.generateNextPlanWeek(
        enrichedRequest,
        strategy.plan,
        nextWeek,
        ctx,
        replanContext,
        learningSection || undefined,
        pace
      );

      if (result.goalMet) {
        await query(
          `UPDATE strategies SET goal_status = 'met', updated_at = NOW() WHERE id = $1 AND organization_id = $2`,
          [strategyId, organizationId]
        );
        log.info(`goal met strategy=${strategyId}`);
        return;
      }

      if (!result.week) {
        log.warn(`next week ${nextWeek} empty for strategy=${strategyId}`);
        return;
      }

      const integrations = await new ExecutionService().getIntegrationFlagsPublic(organizationId);
      const { plan: filteredPlan } = filterPlanByIntegrations(
        { ...strategy.plan, weeks: [result.week] },
        integrations
      );
      let filteredWeek = filteredPlan.weeks[0]!;
      if (learningCtx.applied.length) {
        filteredWeek = { ...filteredWeek, learningApplied: learningCtx.applied };
      }

      const updatedPlan: PlanDocument = {
        ...strategy.plan,
        summary: {
          ...strategy.plan.summary,
          weekCount: nextWeek,
          connectionSuggestions: [
            ...(strategy.plan.summary.connectionSuggestions ?? []),
            ...(filteredPlan.summary.connectionSuggestions ?? []),
          ],
        },
        weeks: [...strategy.plan.weeks, filteredWeek],
      };

      await query(
        `UPDATE strategies SET
           plan_json = $3::jsonb,
           current_week = $4,
           pause_until = NULL,
           next_batch_reasoning = $5,
           updated_at = NOW()
         WHERE id = $1 AND organization_id = $2`,
        [
          strategyId,
          organizationId,
          JSON.stringify(updatedPlan),
          nextWeek,
          filteredWeek.focus,
        ]
      );

      if (learningCtx.applied.length) {
        const activity = new AutopilotActivityService();
        await activity.log({
          organizationId,
          strategyId,
          weekNumber: nextWeek,
          step: 'learning_applied',
          title: `Week ${nextWeek} plan informed by historical learning`,
          detail: learningCtx.applied
            .map((p) => `${p.pattern} (${p.sampleSize} prior actions)`)
            .join(' · '),
          status: 'info',
        });
      }

      log.info(`appended week ${nextWeek} strategy=${strategyId}`);
      await this.runAutopilotCurrentWeek(organizationId, strategyId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Next week generation failed';
      log.error(`next week failed strategy=${strategyId} week=${nextWeek}:`, message);
    } finally {
      runningJobs.delete(`${strategyId}:week${nextWeek}`);
    }
  }

  async getById(organizationId: string, strategyId: string): Promise<StrategyRecord | null> {
    const result = await query<StrategyRow>(
      `SELECT * FROM strategies WHERE id = $1 AND organization_id = $2`,
      [strategyId, organizationId]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async getActive(organizationId: string): Promise<StrategyRecord | null> {
    const result = await query<StrategyRow>(
      `SELECT * FROM strategies
       WHERE organization_id = $1 AND status = 'active'
       ORDER BY created_at DESC
       LIMIT 1`,
      [organizationId]
    );
    const row = result.rows[0];
    if (!row?.plan_json) return null;
    return mapRow(row);
  }

  async delete(organizationId: string, strategyId: string): Promise<boolean> {
    const result = await query(
      `DELETE FROM strategies WHERE id = $1 AND organization_id = $2`,
      [strategyId, organizationId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async list(organizationId: string, limit = 10): Promise<StrategyRecord[]> {
    const result = await query<StrategyRow>(
      `SELECT * FROM strategies
       WHERE organization_id = $1 AND status IN ('active', 'archived', 'failed')
       ORDER BY created_at DESC
       LIMIT $2`,
      [organizationId, limit]
    );
    return result.rows.map(mapRow);
  }
}
