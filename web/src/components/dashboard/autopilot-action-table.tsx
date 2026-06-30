'use client';

import { useState } from 'react';
import { ActionDeliverableCard } from '@/components/dashboard/action-deliverable-card';
import { Chip } from '@/components/hundres/chip';
import type { AutopilotActivityRecord } from '@/lib/autopilot-activity';
import type { ExecutionRecord } from '@/lib/execution';
import { extractExecutionReasoning } from '@/lib/execution';
import type { PlanAction } from '@/lib/plan-types';

type ActionProgress = 'queued' | 'working' | 'ready' | 'review' | 'failed' | 'skipped' | 'done';

type Props = {
  actions: PlanAction[];
  channelLabel: (channel: string) => string;
  executionsByAction: Map<string, ExecutionRecord>;
  activities: AutopilotActivityRecord[];
  batchRunning: boolean;
  activeActionId: string | null;
  completedActionIds: Set<string>;
  completionSaving: string | null;
  restartingActionId: string | null;
  approvingActionId: string | null;
  onToggleComplete: (actionId: string) => void;
  onPrepareWeek?: () => void;
  onRestartAction?: (actionId: string) => void;
  onApproveAction?: (actionId: string, executionId: string) => void;
};

const SUMMARY_BG = 'rgba(255, 255, 255, 0.06)';
const SUMMARY_BORDER = 'rgba(255, 255, 255, 0.22)';
const DETAIL_BG = 'rgba(255, 255, 255, 0.03)';
const DETAIL_BORDER = 'rgba(255, 255, 255, 0.12)';

function isActivelyWorking(
  actionId: string,
  activities: AutopilotActivityRecord[],
  batchRunning: boolean,
  activeActionId: string | null
): boolean {
  if (!batchRunning) return false;
  if (activeActionId === actionId) return true;
  return activities.some((a) => a.actionId === actionId && a.status === 'running');
}

function resolveProgress(
  actionId: string,
  execution: ExecutionRecord | undefined,
  activities: AutopilotActivityRecord[],
  batchRunning: boolean,
  activeActionId: string | null
): ActionProgress {
  const actionActivities = activities.filter((a) => a.actionId === actionId);

  if (execution) {
    if (execution.status === 'executed') return 'ready';
    if (execution.status === 'previewed') return 'review';
    if (execution.status === 'skipped') return 'skipped';
    if (execution.status === 'failed') return 'failed';
  }

  if (isActivelyWorking(actionId, activities, batchRunning, activeActionId)) {
    return 'working';
  }

  const hasComplete = actionActivities.some(
    (a) => a.step === 'complete' || a.step === 'skipped'
  );
  if (hasComplete) {
    return execution?.status === 'previewed' ? 'review' : 'ready';
  }

  const latest = actionActivities.reduce<AutopilotActivityRecord | null>((best, row) => {
    if (!best) return row;
    return row.createdAt > best.createdAt ? row : best;
  }, null);
  const failed = latest?.step === 'failed' || latest?.status === 'error';
  if (failed && !execution) return 'failed';

  return 'queued';
}

function displayProgress(progress: ActionProgress, userCompleted: boolean): ActionProgress {
  return userCompleted ? 'done' : progress;
}

function progressLabel(progress: ActionProgress) {
  switch (progress) {
    case 'working':
      return 'Working…';
    case 'ready':
      return 'Ready';
    case 'review':
      return 'Needs review';
    case 'done':
      return 'Done';
    case 'failed':
      return 'Failed';
    case 'skipped':
      return 'Skipped';
    default:
      return 'Queued';
  }
}

function actionRoutingReasoning(
  actionId: string,
  activities: AutopilotActivityRecord[]
): string | null {
  const decision = activities.find(
    (a) => a.actionId === actionId && (a.step === 'decision' || a.step === 'action_plan')
  );
  return decision?.detail ?? null;
}

function actionAiReasoning(
  actionId: string,
  activities: AutopilotActivityRecord[]
): string | null {
  const row = activities.find((a) => a.actionId === actionId && a.step === 'ai_reasoning');
  return row?.detail ?? null;
}

function progressVariant(progress: ActionProgress) {
  switch (progress) {
    case 'working':
      return 'accent' as const;
    case 'ready':
    case 'done':
      return 'success' as const;
    case 'review':
      return 'warn' as const;
    case 'failed':
      return 'warn' as const;
    default:
      return 'default' as const;
  }
}

export function AutopilotActionTable({
  actions,
  channelLabel,
  executionsByAction,
  activities,
  batchRunning,
  activeActionId,
  completedActionIds,
  completionSaving,
  restartingActionId,
  approvingActionId,
  onToggleComplete,
  onPrepareWeek,
  onRestartAction,
  onApproveAction,
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {actions.map((action) => {
          const execution = executionsByAction.get(action.id);
          const userCompleted = completedActionIds.has(action.id);
          const isRestarting = restartingActionId === action.id;
          const isApproving = approvingActionId === action.id;
          const progress = isRestarting
            ? ('working' as ActionProgress)
            : resolveProgress(
                action.id,
                execution,
                activities,
                batchRunning,
                activeActionId
              );
          const chipProgress = displayProgress(progress, userCompleted);
          const expanded = expandedId === action.id;
          const routing = actionRoutingReasoning(action.id, activities);
          const actionActivities = activities.filter((a) => a.actionId === action.id);
          const latestActivity = actionActivities.reduce<AutopilotActivityRecord | null>((best, row) => {
            if (!best) return row;
            return row.createdAt > best.createdAt ? row : best;
          }, null);
          const hasComplete = actionActivities.some((a) => a.step === 'complete' || a.step === 'skipped');
          const actionError =
            execution?.status === 'failed'
              ? execution.errorMessage
              : !execution &&
                  !hasComplete &&
                  (latestActivity?.step === 'failed' || latestActivity?.status === 'error')
                ? latestActivity?.detail ?? null
                : null;
          const aiReasoning =
            actionAiReasoning(action.id, activities) ??
            (execution ? extractExecutionReasoning(execution) : null);
          const canView = true;
          const canMarkDone = progress !== 'working' || userCompleted;
          const canRestart =
            Boolean(onRestartAction) &&
            chipProgress !== 'working' &&
            !userCompleted &&
            !batchRunning;
          const summaryText =
            action.outcome ??
            (action.why
              ? action.why.slice(0, 160) + (action.why.length > 160 ? '…' : '')
              : null);

          return (
            <li key={action.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <div
                style={{
                  padding: '12px 14px',
                  background: SUMMARY_BG,
                  borderLeft: `3px solid ${SUMMARY_BORDER}`,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    gap: 10,
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', gap: 10, flex: 1, minWidth: 0 }}>
                    <div
                      className={`checkbox${userCompleted ? ' checked' : ''}`}
                      role="checkbox"
                      aria-checked={userCompleted}
                      aria-label={userCompleted ? 'Mark action incomplete' : 'Mark action complete'}
                      onClick={() => {
                        if (completionSaving === action.id) return;
                        onToggleComplete(action.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          if (completionSaving === action.id) return;
                          onToggleComplete(action.id);
                        }
                      }}
                      tabIndex={0}
                      style={{
                        marginTop: 22,
                        opacity: completionSaving === action.id ? 0.5 : 1,
                        cursor: completionSaving === action.id ? 'wait' : 'pointer',
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        gap: 8,
                        flexWrap: 'wrap',
                        marginBottom: 8,
                        alignItems: 'center',
                      }}
                    >
                      <Chip variant={progressVariant(chipProgress)}>
                        {chipProgress === 'working' ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span className="thinking-pulse" style={{ width: 6, height: 6 }} />
                            {progressLabel(chipProgress)}
                          </span>
                        ) : (
                          progressLabel(chipProgress)
                        )}
                      </Chip>
                      <span className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)' }}>
                        {channelLabel(action.channel)}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 500,
                        lineHeight: 1.45,
                        marginBottom: 6,
                        ...(userCompleted
                          ? {
                              color: 'var(--text-mute)',
                              textDecoration: 'line-through',
                              textDecorationColor: 'var(--text-faint)',
                            }
                          : null),
                      }}
                    >
                      {action.title}
                    </div>
                    {summaryText ? (
                      <p className="t-dim" style={{ fontSize: 13, margin: 0, lineHeight: 1.55 }}>
                        {summaryText}
                      </p>
                    ) : null}
                    {actionError && !expanded ? (
                      <p className="auth-error" style={{ fontSize: 12, margin: '8px 0 0' }}>
                        {actionError}
                      </p>
                    ) : null}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0, alignItems: 'flex-end' }}>
                    {canView ? (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ fontSize: 12, padding: '4px 10px' }}
                        onClick={() => setExpandedId(expanded ? null : action.id)}
                      >
                        {expanded ? 'Hide' : 'View'}
                      </button>
                    ) : null}
                    {canRestart ? (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ fontSize: 12, padding: '4px 10px' }}
                        disabled={isRestarting}
                        onClick={() => onRestartAction?.(action.id)}
                      >
                        {isRestarting ? 'Restarting…' : 'Restart'}
                      </button>
                    ) : null}
                    {canMarkDone ? (
                      <button
                        type="button"
                        className={`btn${userCompleted ? ' btn-primary' : ' btn-ghost'}`}
                        style={{ fontSize: 12, padding: '4px 10px' }}
                        disabled={completionSaving === action.id}
                        onClick={() => onToggleComplete(action.id)}
                      >
                        {userCompleted ? 'Completed' : 'Mark done'}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>

              {expanded && canView ? (
                <div
                  style={{
                    padding: '12px 14px 14px',
                    background: DETAIL_BG,
                    borderLeft: `3px solid ${DETAIL_BORDER}`,
                  }}
                >
                  <ActionDeliverableCard
                    embedded
                    title={action.title}
                    channel={channelLabel(action.channel)}
                    why={action.why}
                    outcome={action.outcome}
                    kpi={action.kpi}
                    execution={execution ?? null}
                    pending={(batchRunning && activeActionId === action.id) || isRestarting}
                    error={actionError ?? null}
                    routingReasoning={routing}
                    aiReasoning={aiReasoning}
                    onPrepare={!execution ? onPrepareWeek : undefined}
                    preparing={batchRunning}
                    onRestart={onRestartAction ? () => onRestartAction(action.id) : undefined}
                    restarting={isRestarting}
                    onApprove={
                      execution?.status === 'previewed' && onApproveAction
                        ? () => onApproveAction(action.id, execution.id)
                        : undefined
                    }
                    approving={isApproving}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
