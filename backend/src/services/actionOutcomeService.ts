import { query } from '../database/connection.js';
import type { PlanDocument, PlanAction } from '../types/plan.js';
import type { AnalyticsSnapshot } from './analyticsService.js';
import type { ExecutionRecord } from '../types/execution.js';
import type { ActionOutcomeRecord, EffectivenessRating } from '../types/learning.js';
import { AutopilotActivityService } from './autopilotActivityService.js';
import { ExecutionService } from './executionService.js';

type OutcomeRow = {
  id: string;
  organization_id: string;
  strategy_id: string;
  week_number: number;
  action_id: string;
  execution_type: string;
  action_channel: string | null;
  action_title: string;
  hypothesis: string | null;
  target_metric_key: string | null;
  block_metric_before: string | null;
  block_metric_after: string | null;
  metric_delta: string | null;
  metric_delta_pct: string | null;
  effectiveness_score: string;
  rating: EffectivenessRating;
  goal_context: string | null;
  created_at: Date;
};

function mapRow(row: OutcomeRow): ActionOutcomeRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    strategyId: row.strategy_id,
    weekNumber: row.week_number,
    actionId: row.action_id,
    executionType: row.execution_type,
    actionChannel: row.action_channel,
    actionTitle: row.action_title,
    hypothesis: row.hypothesis,
    targetMetricKey: row.target_metric_key,
    blockMetricBefore: row.block_metric_before != null ? Number(row.block_metric_before) : null,
    blockMetricAfter: row.block_metric_after != null ? Number(row.block_metric_after) : null,
    metricDelta: row.metric_delta != null ? Number(row.metric_delta) : null,
    metricDeltaPct: row.metric_delta_pct != null ? Number(row.metric_delta_pct) : null,
    effectivenessScore: Number(row.effectiveness_score),
    rating: row.rating,
    goalContext: row.goal_context,
    createdAt: row.created_at.toISOString(),
  };
}

/** Heuristic v1 scoring — block-level metric movement attributed by action type/channel. */
export function scoreActionEffectiveness(input: {
  executionType: string;
  channel: string;
  blockDeltaPct: number | null;
  blockImproved: boolean;
}): { rating: EffectivenessRating; score: number } {
  const { executionType, channel, blockDeltaPct, blockImproved } = input;
  if (blockDeltaPct == null) {
    return { rating: 'unknown', score: 0 };
  }

  const strongUp = blockDeltaPct >= 5;
  const strongDown = blockDeltaPct <= -5;

  const isPaid =
    executionType === 'create_meta_ads_campaign' ||
    executionType === 'create_google_ads_campaign' ||
    channel === 'paid';

  const isOrganicContent =
    channel === 'content' ||
    channel === 'instagram' ||
    executionType === 'publish_instagram_photo' ||
    executionType === 'publish_instagram_story' ||
    executionType === 'create_shopify_blog_article' ||
    (executionType === 'assist_deliverable' &&
      (channel === 'content' || channel === 'instagram' || channel === 'local'));

  if (isPaid) {
    if (strongDown) return { rating: 'failure', score: -0.35 };
    if (strongUp) return { rating: 'neutral', score: 0.45 };
    return { rating: 'neutral', score: 0.1 };
  }

  if (isOrganicContent) {
    if (strongUp) return { rating: 'success', score: 0.75 };
    if (strongDown) return { rating: 'failure', score: -0.4 };
    if (blockImproved) return { rating: 'success', score: 0.55 };
    return { rating: 'neutral', score: 0.15 };
  }

  if (executionType === 'create_shopify_page' || executionType === 'update_product_seo') {
    if (strongUp) return { rating: 'success', score: 0.7 };
    if (strongDown) return { rating: 'neutral', score: -0.1 };
    if (blockImproved) return { rating: 'success', score: 0.5 };
  }

  if (
    executionType === 'create_shopify_blog_article' ||
    executionType === 'publish_instagram_photo' ||
    executionType === 'publish_instagram_story'
  ) {
    if (strongUp) return { rating: 'success', score: 0.72 };
    if (strongDown) return { rating: 'failure', score: -0.25 };
    if (blockImproved) return { rating: 'success', score: 0.58 };
  }

  if (executionType === 'assist_deliverable') {
    if (strongUp) return { rating: 'success', score: 0.6 };
    if (strongDown) return { rating: 'failure', score: -0.3 };
    return { rating: 'neutral', score: 0.2 };
  }

  if (strongUp) return { rating: 'success', score: 0.55 };
  if (strongDown) return { rating: 'failure', score: -0.45 };
  return { rating: 'neutral', score: 0 };
}

export class ActionOutcomeService {
  private activity = new AutopilotActivityService();
  private execution = new ExecutionService();

  /**
   * After checkpoint analytics: score and persist each confirmed action in the block.
   */
  async recordBlockOutcomes(input: {
    organizationId: string;
    strategyId: string;
    weekNumber: number;
    plan: PlanDocument;
    goalLine: string;
    analysis: AnalyticsSnapshot;
    confirmedActionIds: string[];
  }): Promise<ActionOutcomeRecord[]> {
    const weekBlock = input.plan.weeks.find((w) => w.week === input.weekNumber);
    if (!weekBlock) return [];

    const executions = await this.execution.listForStrategy(
      input.organizationId,
      input.strategyId
    );
    const activities = await this.activity.listForStrategy(
      input.organizationId,
      input.strategyId
    );

    const goalMetric = input.analysis.goalProgress.metricKey;
    const blockBefore = input.analysis.goalProgress.baselineValue;
    const blockAfter = input.analysis.goalProgress.currentValue;
    const primaryDelta = input.analysis.metricDeltas.find((d) => d.key === goalMetric);
    const blockDelta = primaryDelta?.delta ?? null;
    const blockDeltaPct = primaryDelta?.deltaPct ?? null;
    const blockImproved = blockDelta != null && blockDelta > 0;

    const goalContext =
      input.plan.summary.goalTarget?.metric ?? input.plan.summary.goalLine.slice(0, 120);

    const records: ActionOutcomeRecord[] = [];

    for (const action of weekBlock.actions) {
      if (!input.confirmedActionIds.includes(action.id)) continue;

      const execution = executions.find((e) => e.actionId === action.id);
      if (!execution) continue;

      const hypothesis = this.buildHypothesis(action, execution, activities);
      const { rating, score } = scoreActionEffectiveness({
        executionType: execution.executionType,
        channel: action.channel,
        blockDeltaPct,
        blockImproved,
      });

      const row = await this.upsertOutcome({
        organizationId: input.organizationId,
        strategyId: input.strategyId,
        weekNumber: input.weekNumber,
        actionId: action.id,
        executionType: execution.executionType,
        actionChannel: action.channel,
        actionTitle: action.title,
        hypothesis,
        targetMetricKey: goalMetric,
        blockMetricBefore: blockBefore,
        blockMetricAfter: blockAfter,
        metricDelta: blockDelta,
        metricDeltaPct: blockDeltaPct,
        effectivenessScore: score,
        rating,
        goalContext,
      });
      records.push(row);
    }

    return records;
  }

  async listForOrganization(organizationId: string, limit = 100): Promise<ActionOutcomeRecord[]> {
    const result = await query<OutcomeRow>(
      `SELECT * FROM action_outcomes
       WHERE organization_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [organizationId, limit]
    );
    return result.rows.map(mapRow);
  }

  private buildHypothesis(
    action: PlanAction,
    execution: ExecutionRecord,
    activities: Awaited<ReturnType<AutopilotActivityService['listForStrategy']>>
  ): string {
    const planLine = [action.why, action.outcome, action.kpi].filter(Boolean).join(' · ');
    const activity = activities.find(
      (a) => a.actionId === action.id && (a.step === 'action_plan' || a.step === 'decision')
    );
    const routing = activity?.detail?.trim();
    const parts = [planLine, routing, execution.summary].filter(Boolean);
    return parts.join(' | ').slice(0, 2000);
  }

  private async upsertOutcome(data: {
    organizationId: string;
    strategyId: string;
    weekNumber: number;
    actionId: string;
    executionType: string;
    actionChannel: string;
    actionTitle: string;
    hypothesis: string;
    targetMetricKey: string;
    blockMetricBefore: number | null;
    blockMetricAfter: number | null;
    metricDelta: number | null;
    metricDeltaPct: number | null;
    effectivenessScore: number;
    rating: EffectivenessRating;
    goalContext: string;
  }): Promise<ActionOutcomeRecord> {
    const result = await query<OutcomeRow>(
      `INSERT INTO action_outcomes (
         organization_id, strategy_id, week_number, action_id,
         execution_type, action_channel, action_title, hypothesis,
         target_metric_key, block_metric_before, block_metric_after,
         metric_delta, metric_delta_pct, effectiveness_score, rating, goal_context
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (strategy_id, week_number, action_id) DO UPDATE SET
         execution_type = EXCLUDED.execution_type,
         action_channel = EXCLUDED.action_channel,
         action_title = EXCLUDED.action_title,
         hypothesis = EXCLUDED.hypothesis,
         target_metric_key = EXCLUDED.target_metric_key,
         block_metric_before = EXCLUDED.block_metric_before,
         block_metric_after = EXCLUDED.block_metric_after,
         metric_delta = EXCLUDED.metric_delta,
         metric_delta_pct = EXCLUDED.metric_delta_pct,
         effectiveness_score = EXCLUDED.effectiveness_score,
         rating = EXCLUDED.rating,
         goal_context = EXCLUDED.goal_context
       RETURNING *`,
      [
        data.organizationId,
        data.strategyId,
        data.weekNumber,
        data.actionId,
        data.executionType,
        data.actionChannel,
        data.actionTitle,
        data.hypothesis,
        data.targetMetricKey,
        data.blockMetricBefore,
        data.blockMetricAfter,
        data.metricDelta,
        data.metricDeltaPct,
        data.effectivenessScore,
        data.rating,
        data.goalContext,
      ]
    );
    return mapRow(result.rows[0]);
  }
}
