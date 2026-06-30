import { query } from '../database/connection.js';

export type AutopilotActivityStatus = 'info' | 'running' | 'success' | 'warn' | 'error';

export type AutopilotActivityRecord = {
  id: string;
  organizationId: string;
  strategyId: string;
  weekNumber: number | null;
  actionId: string | null;
  step: string;
  title: string;
  detail: string;
  status: AutopilotActivityStatus;
  createdAt: string;
};

type ActivityRow = {
  id: string;
  organization_id: string;
  strategy_id: string;
  week_number: number | null;
  action_id: string | null;
  step: string;
  title: string;
  detail: string;
  status: AutopilotActivityStatus;
  created_at: Date;
};

function mapRow(row: ActivityRow): AutopilotActivityRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    strategyId: row.strategy_id,
    weekNumber: row.week_number,
    actionId: row.action_id,
    step: row.step,
    title: row.title,
    detail: row.detail,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

export class AutopilotActivityService {
  async log(input: {
    organizationId: string;
    strategyId: string;
    weekNumber?: number | null;
    actionId?: string | null;
    step: string;
    title: string;
    detail: string;
    status?: AutopilotActivityStatus;
  }): Promise<void> {
    await query(
      `INSERT INTO autopilot_activity (
         organization_id, strategy_id, week_number, action_id, step, title, detail, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.organizationId,
        input.strategyId,
        input.weekNumber ?? null,
        input.actionId ?? null,
        input.step,
        input.title,
        input.detail,
        input.status ?? 'info',
      ]
    );
  }

  async listForStrategy(
    organizationId: string,
    strategyId: string,
    limit = 40
  ): Promise<AutopilotActivityRecord[]> {
    const result = await query<ActivityRow>(
      `SELECT * FROM autopilot_activity
       WHERE organization_id = $1 AND strategy_id = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [organizationId, strategyId, limit]
    );
    return result.rows.map(mapRow).reverse();
  }

  async listSince(
    organizationId: string,
    strategyId: string,
    sinceIso: string
  ): Promise<AutopilotActivityRecord[]> {
    const result = await query<ActivityRow>(
      `SELECT * FROM autopilot_activity
       WHERE organization_id = $1 AND strategy_id = $2 AND created_at > $3
       ORDER BY created_at ASC`,
      [organizationId, strategyId, sinceIso]
    );
    return result.rows.map(mapRow);
  }

  /** Mark orphaned in-progress rows so the UI does not stay on Working forever. */
  async clearStaleRunning(
    organizationId: string,
    strategyId: string,
    weekNumber: number
  ): Promise<void> {
    const result = await query<ActivityRow>(
      `SELECT DISTINCT ON (a.action_id) a.*
       FROM autopilot_activity a
       WHERE a.organization_id = $1
         AND a.strategy_id = $2
         AND a.action_id IS NOT NULL
         AND a.status = 'running'
         AND a.created_at < NOW() - INTERVAL '3 minutes'
         AND NOT EXISTS (
           SELECT 1 FROM autopilot_activity newer
           WHERE newer.organization_id = a.organization_id
             AND newer.strategy_id = a.strategy_id
             AND newer.action_id = a.action_id
             AND newer.created_at > a.created_at
             AND newer.step IN ('complete', 'failed', 'skipped')
         )
       ORDER BY a.action_id, a.created_at DESC`,
      [organizationId, strategyId]
    );

    for (const row of result.rows) {
      await this.log({
        organizationId,
        strategyId,
        weekNumber,
        actionId: row.action_id,
        step: 'failed',
        title: `Interrupted: ${row.title.replace(/^Executing: /, '')}`,
        detail: 'Previous run was interrupted (timeout or server restart). Click Confirm & prepare this week to try again.',
        status: 'error',
      });
    }
  }
}
