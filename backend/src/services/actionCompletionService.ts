import { query } from '../database/connection.js';

export class ActionCompletionService {
  async listCompletedActionIds(
    organizationId: string,
    strategyId: string
  ): Promise<string[]> {
    const result = await query<{ action_id: string }>(
      `SELECT action_id FROM plan_action_completions
       WHERE organization_id = $1 AND strategy_id = $2
       ORDER BY completed_at ASC`,
      [organizationId, strategyId]
    );
    return result.rows.map((r) => r.action_id);
  }

  async setCompleted(
    organizationId: string,
    strategyId: string,
    actionId: string,
    completed: boolean
  ): Promise<string[]> {
    if (completed) {
      await query(
        `INSERT INTO plan_action_completions (organization_id, strategy_id, action_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (organization_id, strategy_id, action_id) DO NOTHING`,
        [organizationId, strategyId, actionId]
      );
    } else {
      await query(
        `DELETE FROM plan_action_completions
         WHERE organization_id = $1 AND strategy_id = $2 AND action_id = $3`,
        [organizationId, strategyId, actionId]
      );
    }

    return this.listCompletedActionIds(organizationId, strategyId);
  }
}
