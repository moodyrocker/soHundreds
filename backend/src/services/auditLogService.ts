import { query } from '../database/connection.js';
import type { WorkerReport } from '../types/workers.js';

const DEFAULT_MODEL =
  process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514';

export type AuditEventType =
  | 'plan_created'
  | 'plan_refined'
  | 'action_executed'
  | 'action_rolled_back'
  | 'goal_progress_check'
  | 'week_outcome_recorded'
  | 'goal_met';

export interface AuditLogEntry {
  id: string;
  organizationId: string;
  strategyId: string | null;
  eventType: AuditEventType;
  model: string | null;
  dataSource: string | null;
  sourcesLoaded: string[];
  workerReports: WorkerReport[];
  metadata: Record<string, unknown>;
  createdAt: string;
}

type AuditRow = {
  id: string;
  organization_id: string;
  strategy_id: string | null;
  event_type: AuditEventType;
  model: string | null;
  data_source: string | null;
  sources_loaded: string[];
  worker_reports: WorkerReport[];
  metadata: Record<string, unknown>;
  created_at: Date;
};

function mapRow(row: AuditRow): AuditLogEntry {
  return {
    id: row.id,
    organizationId: row.organization_id,
    strategyId: row.strategy_id,
    eventType: row.event_type,
    model: row.model,
    dataSource: row.data_source,
    sourcesLoaded: row.sources_loaded ?? [],
    workerReports: row.worker_reports ?? [],
    metadata: row.metadata ?? {},
    createdAt: row.created_at.toISOString(),
  };
}

export class AuditLogService {
  async recordPlanGeneration(input: {
    organizationId: string;
    strategyId: string;
    eventType: AuditEventType;
    dataSource: string;
    sourcesLoaded: string[];
    workerReports: WorkerReport[];
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await query(
      `INSERT INTO audit_log (
         organization_id, strategy_id, event_type, model, data_source,
         sources_loaded, worker_reports, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)`,
      [
        input.organizationId,
        input.strategyId,
        input.eventType,
        DEFAULT_MODEL,
        input.dataSource,
        JSON.stringify(input.sourcesLoaded),
        JSON.stringify(input.workerReports),
        JSON.stringify(input.metadata ?? {}),
      ]
    );
  }

  async getForStrategy(
    organizationId: string,
    strategyId: string
  ): Promise<AuditLogEntry | null> {
    const result = await query<AuditRow>(
      `SELECT * FROM audit_log
       WHERE organization_id = $1 AND strategy_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [organizationId, strategyId]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async recordGoalEvent(input: {
    organizationId: string;
    strategyId: string;
    eventType: 'goal_progress_check' | 'week_outcome_recorded' | 'goal_met';
    summary: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await query(
      `INSERT INTO audit_log (
         organization_id, strategy_id, event_type, model, data_source,
         sources_loaded, worker_reports, metadata
       ) VALUES ($1, $2, $3, NULL, NULL, '[]'::jsonb, '[]'::jsonb, $4::jsonb)`,
      [
        input.organizationId,
        input.strategyId,
        input.eventType,
        JSON.stringify({ summary: input.summary, ...(input.metadata ?? {}) }),
      ]
    );
  }

  async recordExecutionWrite(input: {
    organizationId: string;
    strategyId: string;
    eventType: 'action_executed' | 'action_rolled_back';
    executionId: string;
    actionId: string;
    platform: string;
    beforeState: unknown;
    afterState: unknown;
    summary: string;
  }): Promise<void> {
    await query(
      `INSERT INTO audit_log (
         organization_id, strategy_id, event_type, model, data_source,
         sources_loaded, worker_reports, metadata
       ) VALUES ($1, $2, $3, NULL, $4, '[]'::jsonb, '[]'::jsonb, $5::jsonb)`,
      [
        input.organizationId,
        input.strategyId,
        input.eventType,
        input.platform,
        JSON.stringify({
          executionId: input.executionId,
          actionId: input.actionId,
          summary: input.summary,
          beforeState: input.beforeState,
          afterState: input.afterState,
        }),
      ]
    );
  }
}
