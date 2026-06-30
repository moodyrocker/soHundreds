import { query } from '../database/connection.js';
import type { GoalProgressResult } from './goalProgressService.js';

export type WeekOutcomeRecord = {
  id: string;
  organizationId: string;
  strategyId: string;
  weekNumber: number;
  actionsPrepared: number;
  actionsTotal: number;
  metricKey: string | null;
  metricValue: number | null;
  metricBaseline: number | null;
  metricTarget: number | null;
  progressPct: number | null;
  goalMet: boolean;
  status: string;
  summary: string | null;
  dataSources: string[];
  createdAt: string;
};

type OutcomeRow = {
  id: string;
  organization_id: string;
  strategy_id: string;
  week_number: number;
  actions_prepared: number;
  actions_total: number;
  metric_key: string | null;
  metric_value: string | null;
  metric_baseline: string | null;
  metric_target: string | null;
  progress_pct: string | null;
  goal_met: boolean;
  status: string;
  summary: string | null;
  data_sources: string[];
  created_at: Date;
};

function mapRow(row: OutcomeRow): WeekOutcomeRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    strategyId: row.strategy_id,
    weekNumber: row.week_number,
    actionsPrepared: row.actions_prepared,
    actionsTotal: row.actions_total,
    metricKey: row.metric_key,
    metricValue: row.metric_value != null ? Number(row.metric_value) : null,
    metricBaseline: row.metric_baseline != null ? Number(row.metric_baseline) : null,
    metricTarget: row.metric_target != null ? Number(row.metric_target) : null,
    progressPct: row.progress_pct != null ? Number(row.progress_pct) : null,
    goalMet: row.goal_met,
    status: row.status,
    summary: row.summary,
    dataSources: row.data_sources ?? [],
    createdAt: row.created_at.toISOString(),
  };
}

export class WeekOutcomeService {
  async recordWeekOutcome(input: {
    organizationId: string;
    strategyId: string;
    weekNumber: number;
    actionsPrepared: number;
    actionsTotal: number;
    progress: GoalProgressResult;
  }): Promise<WeekOutcomeRecord> {
    const result = await query<OutcomeRow>(
      `INSERT INTO goal_week_outcomes (
         organization_id, strategy_id, week_number,
         actions_prepared, actions_total,
         metric_key, metric_value, metric_baseline, metric_target,
         progress_pct, goal_met, status, summary, data_sources
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
       ON CONFLICT (strategy_id, week_number) DO UPDATE SET
         actions_prepared = EXCLUDED.actions_prepared,
         actions_total = EXCLUDED.actions_total,
         metric_key = EXCLUDED.metric_key,
         metric_value = EXCLUDED.metric_value,
         metric_baseline = EXCLUDED.metric_baseline,
         metric_target = EXCLUDED.metric_target,
         progress_pct = EXCLUDED.progress_pct,
         goal_met = EXCLUDED.goal_met,
         status = EXCLUDED.status,
         summary = EXCLUDED.summary,
         data_sources = EXCLUDED.data_sources
       RETURNING *`,
      [
        input.organizationId,
        input.strategyId,
        input.weekNumber,
        input.actionsPrepared,
        input.actionsTotal,
        input.progress.metricKey,
        input.progress.currentValue,
        input.progress.baselineValue,
        input.progress.targetValue,
        input.progress.progressPct,
        input.progress.goalMet,
        input.progress.status,
        input.progress.summary,
        JSON.stringify(input.progress.dataSources),
      ]
    );
    return mapRow(result.rows[0]);
  }

  async listForStrategy(strategyId: string, limit = 12): Promise<WeekOutcomeRecord[]> {
    const result = await query<OutcomeRow>(
      `SELECT * FROM goal_week_outcomes
       WHERE strategy_id = $1
       ORDER BY week_number ASC
       LIMIT $2`,
      [strategyId, limit]
    );
    return result.rows.map(mapRow);
  }

  async getLatestBaseline(strategyId: string): Promise<number | null> {
    const result = await query<{ metric_baseline: string | null }>(
      `SELECT metric_baseline FROM goal_week_outcomes
       WHERE strategy_id = $1 AND metric_baseline IS NOT NULL
       ORDER BY week_number ASC
       LIMIT 1`,
      [strategyId]
    );
    const val = result.rows[0]?.metric_baseline;
    return val != null ? Number(val) : null;
  }

  formatForPrompt(outcomes: WeekOutcomeRecord[]): string {
    if (!outcomes.length) return '';
    return outcomes
      .map(
        (o) =>
          `Week ${o.weekNumber}: ${o.actionsPrepared}/${o.actionsTotal} actions prepared. ` +
          `${o.summary ?? 'No metric summary.'}`
      )
      .join('\n');
  }
}
