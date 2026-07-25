'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { ActionDetailDrawer } from '@/components/dashboard/action-detail-drawer';
import { Button } from '@/components/hundres/button';
import type { AgentStatusSnapshot } from '@/lib/agent-status';
import type { AutopilotActivityRecord } from '@/lib/autopilot-activity';
import type { AutopilotMode } from '@/lib/business-profile';
import type { ExecutionRecord } from '@/lib/execution';
import { extractExecutionReasoning } from '@/lib/execution';
import { getExecutionOutcomeLink } from '@/lib/execution-outcome';
import { buildCycleOverview, reevaluationRowStatus } from '@/lib/cycle-overview';
import { sanitizeAgentCopy } from '@/lib/plain-language';
import type { PlanAction, StrategyRecord } from '@/lib/plan-types';
import type { ActionRunState, OrchestratorSnapshot } from '@/lib/orchestrator';
import { formatDateTime } from '@/lib/format-datetime';

type ActionProgress =
  | 'queued'
  | 'working'
  | 'ready'
  | 'review'
  | 'failed'
  | 'skipped'
  | 'done'
  | 'awaiting_human'
  | 'awaiting_confirm';

type Props = {
  actions: PlanAction[];
  channelLabel: (channel: string) => string;
  executionsByAction: Map<string, ExecutionRecord>;
  orchestratorByAction?: Map<string, ActionRunState>;
  activities: AutopilotActivityRecord[];
  batchRunning: boolean;
  activeActionId: string | null;
  completedActionIds: Set<string>;
  completionSaving: string | null;
  restartingActionId?: string | null;
  approvingActionId: string | null;
  confirmingOrchestratorId?: string | null;
  agentStatus: AgentStatusSnapshot;
  strategy?: StrategyRecord | null;
  orchestratorState?: OrchestratorSnapshot | null;
  cycleFocus?: string | null;
  strategyId?: string;
  autopilotMode?: AutopilotMode;
  modeSaving?: boolean;
  onModeChange?: (mode: AutopilotMode) => void;
  onToggleComplete: (actionId: string) => void;
  onApproveAction?: (actionId: string, executionId: string) => void;
  onConfirmOrchestratorAction?: (actionId: string) => void;
};

type ActionRowMeta = {
  action: PlanAction;
  progress: ActionProgress;
  chipProgress: ActionProgress;
  execution: ExecutionRecord | undefined;
  orchestrator: ActionRunState | undefined;
  userCompleted: boolean;
};

const REASONING_STEPS = new Set([
  'executing',
  'decision',
  'action_plan',
  'ai_reasoning',
  'complete',
  'failed',
  'skipped',
  'awaiting_human',
  'human_confirmed',
  'learning_applied',
  'learning_scored',
  'learning_patterns',
  'checkpoint',
]);

function isActivelyWorking(
  actionId: string,
  execution: ExecutionRecord | undefined,
  activities: AutopilotActivityRecord[],
  batchRunning: boolean,
  activeActionId: string | null,
  runningActionId: string | null
): boolean {
  if (execution?.status === 'executed' || execution?.status === 'skipped') return false;
  if (runningActionId === actionId) return true;
  if (!batchRunning && !runningActionId) return false;
  if (activeActionId === actionId) return true;
  return activities.some((a) => a.actionId === actionId && a.status === 'running');
}

function resolveProgress(
  actionId: string,
  execution: ExecutionRecord | undefined,
  orchestrator: ActionRunState | undefined,
  activities: AutopilotActivityRecord[],
  batchRunning: boolean,
  activeActionId: string | null,
  runningActionId: string | null
): ActionProgress {
  if (execution?.status === 'executed') return 'ready';
  if (execution?.status === 'skipped') return 'skipped';
  if (execution?.status === 'failed') return 'failed';

  if (orchestrator) {
    switch (orchestrator.runStatus) {
      case 'in_progress':
        if (!execution || execution.status === 'previewed') return 'working';
        break;
      case 'awaiting_human_action':
        return 'awaiting_human';
      case 'awaiting_confirmation':
        return 'awaiting_confirm';
      case 'confirmed':
        return 'ready';
      case 'failed':
        return 'failed';
      case 'pending':
        break;
    }
  }

  const actionActivities = activities.filter((a) => a.actionId === actionId);
  if (execution?.status === 'previewed') return 'review';

  if (
    isActivelyWorking(actionId, execution, activities, batchRunning, activeActionId, runningActionId)
  ) {
    return 'working';
  }

  const hasComplete = actionActivities.some((a) => a.step === 'complete' || a.step === 'skipped');
  if (hasComplete) return 'ready';

  const latest = actionActivities.reduce<AutopilotActivityRecord | null>((best, row) => {
    if (!best) return row;
    return row.createdAt > best.createdAt ? row : best;
  }, null);
  if ((latest?.step === 'failed' || latest?.status === 'error') && !execution) return 'failed';

  return 'queued';
}

function displayProgress(
  progress: ActionProgress,
  userCompleted: boolean,
  execution?: ExecutionRecord
): ActionProgress {
  if (userCompleted) return 'done';
  if (execution?.status === 'executed') return 'done';
  if (progress === 'ready') return 'done';
  return progress;
}

function progressLabel(progress: ActionProgress) {
  switch (progress) {
    case 'working':
      return 'In progress';
    case 'review':
    case 'awaiting_human':
    case 'awaiting_confirm':
      return 'Needs your approval';
    case 'done':
      return 'Completed';
    case 'failed':
      return 'Something went wrong';
    case 'skipped':
      return 'Skipped';
    default:
      return 'Scheduled';
  }
}

function progressVariant(progress: ActionProgress): 'success' | 'warn' | 'accent' | 'default' {
  switch (progress) {
    case 'working':
      return 'accent';
    case 'done':
      return 'success';
    case 'review':
    case 'awaiting_human':
    case 'awaiting_confirm':
    case 'failed':
      return 'warn';
    default:
      return 'default';
  }
}

function rowStatusMeta(progress: ActionProgress): {
  border: string;
  color: string;
  icon: string;
  label: string;
} {
  switch (progress) {
    case 'done':
      return {
        border: 'rgba(34, 197, 94, 0.7)',
        color: 'var(--success, #22c55e)',
        icon: '✓',
        label: 'Completed',
      };
    case 'working':
      return {
        border: 'rgba(99, 102, 241, 0.7)',
        color: 'var(--accent, #6366f1)',
        icon: '→',
        label: 'In progress',
      };
    case 'awaiting_human':
    case 'awaiting_confirm':
    case 'review':
      return {
        border: 'rgba(234, 179, 8, 0.7)',
        color: 'var(--warn, #eab308)',
        icon: '!',
        label: 'Needs approval',
      };
    case 'failed':
      return {
        border: 'rgba(239, 68, 68, 0.7)',
        color: 'var(--danger, #ef4444)',
        icon: '!',
        label: 'Error',
      };
    default:
      return {
        border: 'rgba(128, 128, 128, 0.35)',
        color: 'var(--text-mute)',
        icon: '—',
        label: 'Scheduled',
      };
  }
}

function actionRoutingReasoning(actionId: string, activities: AutopilotActivityRecord[]): string | null {
  const decision = activities.find(
    (a) => a.actionId === actionId && (a.step === 'decision' || a.step === 'action_plan')
  );
  return decision?.detail ?? null;
}

function actionAiReasoning(actionId: string, activities: AutopilotActivityRecord[]): string | null {
  const row = activities.find((a) => a.actionId === actionId && a.step === 'ai_reasoning');
  return row?.detail ?? null;
}

function actionReasoningTrail(
  actionId: string,
  activities: AutopilotActivityRecord[]
): AutopilotActivityRecord[] {
  return activities
    .filter((a) => a.actionId === actionId && REASONING_STEPS.has(a.step) && a.detail)
    .sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
}

function formatActionSchedule(action: PlanAction): string | null {
  if (action.day && action.time) return `${action.day} @ ${action.time}`;
  if (action.day) return action.day;
  return null;
}

function simpleActionTitle(title: string): string {
  return sanitizeAgentCopy(
    title
      .replace(/^Publish\s+/i, 'Publishing ')
      .replace(/^Launch\s+/i, 'Launching ')
      .replace(/^Activate\s+/i, 'Setting up ')
      .replace(/^Create\s+/i, 'Creating ')
      .replace(/^Generate\s+/i, 'Creating ')
  );
}

function buildActionMeta(
  action: PlanAction,
  ctx: {
    executionsByAction: Map<string, ExecutionRecord>;
    orchestratorByAction?: Map<string, ActionRunState>;
    activities: AutopilotActivityRecord[];
    batchRunning: boolean;
    activeActionId: string | null;
    restartingActionId: string | null;
    completedActionIds: Set<string>;
  }
): ActionRowMeta {
  const execution = ctx.executionsByAction.get(action.id);
  const orchestrator = ctx.orchestratorByAction?.get(action.id);
  const userCompleted = ctx.completedActionIds.has(action.id);
  const isRestarting = ctx.restartingActionId === action.id;
  const progress = isRestarting
    ? ('working' as ActionProgress)
    : resolveProgress(
        action.id,
        execution,
        orchestrator,
        ctx.activities,
        ctx.batchRunning,
        ctx.activeActionId,
        ctx.restartingActionId
      );
  const chipProgress = displayProgress(progress, userCompleted, execution);
  return { action, progress, chipProgress, execution, orchestrator, userCompleted };
}

function FlowRow({
  border,
  color,
  icon,
  label,
  title,
  subtitle,
  isActive,
  trailing,
}: {
  border: string;
  color: string;
  icon: string;
  label: string;
  title: string;
  subtitle: string;
  isActive?: boolean;
  trailing: ReactNode;
}) {
  return (
    <li
      style={{
        borderBottom: '1px solid var(--border)',
        background: isActive ? 'rgba(99, 102, 241, 0.04)' : undefined,
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr auto',
          gap: '4px 12px',
          padding: '10px 16px',
          alignItems: 'start',
        }}
      >
        <div
          style={{
            borderLeft: `3px solid ${border}`,
            paddingLeft: 8,
            minWidth: 88,
            paddingTop: 2,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              color,
              letterSpacing: '0.02em',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {isActive ? (
              <span className="thinking-pulse" style={{ width: 6, height: 6, flexShrink: 0 }} />
            ) : null}
            {icon} {label}
          </span>
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: isActive ? 15 : 14,
              fontWeight: isActive ? 600 : 500,
              lineHeight: 1.4,
            }}
          >
            {title}
          </div>
          <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', marginTop: 3 }}>
            {subtitle}
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            gap: 6,
            flexShrink: 0,
            alignItems: 'center',
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
          }}
        >
          {trailing}
        </div>
      </div>
    </li>
  );
}

export function AutopilotActionTable({
  actions,
  channelLabel,
  executionsByAction,
  orchestratorByAction,
  activities,
  batchRunning,
  activeActionId,
  completedActionIds,
  restartingActionId = null,
  approvingActionId,
  confirmingOrchestratorId,
  agentStatus,
  strategy,
  orchestratorState,
  cycleFocus,
  strategyId,
  autopilotMode,
  modeSaving,
  onModeChange,
  onApproveAction,
  onConfirmOrchestratorAction,
}: Props) {
  const [detailActionId, setDetailActionId] = useState<string | null>(null);
  const [detailReevaluation, setDetailReevaluation] = useState(false);

  const rows = useMemo(
    () =>
      actions.map((a) =>
        buildActionMeta(a, {
          executionsByAction,
          orchestratorByAction,
          activities,
          batchRunning,
          activeActionId,
          restartingActionId,
          completedActionIds,
        })
      ),
    [
      actions,
      executionsByAction,
      orchestratorByAction,
      activities,
      batchRunning,
      activeActionId,
      restartingActionId,
      completedActionIds,
    ]
  );

  const lastActivityAt = useMemo(() => {
    if (!activities.length) return null;
    return activities.reduce((best, row) => (row.createdAt > best ? row.createdAt : best), activities[0].createdAt);
  }, [activities]);

  const allActionsDone = rows.every((r) => r.chipProgress === 'done');

  const overview = useMemo(
    () =>
      buildCycleOverview({
        strategy: strategy ?? null,
        orchestratorState: orchestratorState ?? null,
        activities,
        cycleFocus: cycleFocus ?? null,
        allActionsDone,
      }),
    [strategy, orchestratorState, activities, cycleFocus, allActionsDone]
  );

  const detailMeta = useMemo(
    () => rows.find((r) => r.action.id === detailActionId) ?? null,
    [rows, detailActionId]
  );

  const openDetails = (actionId: string) => {
    setDetailReevaluation(false);
    setDetailActionId(actionId);
  };
  const openReevaluationDetails = () => {
    setDetailActionId(null);
    setDetailReevaluation(true);
  };
  const closeDetails = () => {
    setDetailActionId(null);
    setDetailReevaluation(false);
  };

  const renderDetailDrawer = () => {
    if (detailReevaluation) {
      const rev =
        overview.reevaluation ??
        (agentStatus.resumeLabel
          ? {
              state: 'scheduled' as const,
              reviewAt: strategy?.pauseUntil ?? null,
              completedAt: null,
              title: 'Review your data and plan next steps',
              subtitle: `Agent will review your data on ${agentStatus.resumeLabel} to reevaluate progress.`,
              assessment: overview.assessment,
              nextRotation: overview.whatHappensNext,
            }
          : null);
      if (!rev) return null;
      const status = reevaluationRowStatus(rev.state);
      return (
        <ActionDetailDrawer
          open
          onClose={closeDetails}
          statusLabel={status.label}
          statusVariant={rev.state === 'completed' ? 'success' : 'warn'}
          reevaluation={rev}
          decisions={overview.decisions}
        />
      );
    }

    if (!detailMeta) return null;
    const { action, progress, chipProgress, execution } = detailMeta;
    const isRestarting = restartingActionId === action.id;
    const isApproving = approvingActionId === action.id;
    const isConfirming = confirmingOrchestratorId === action.id;
    const routing = actionRoutingReasoning(action.id, activities);
    const aiReasoning =
      actionAiReasoning(action.id, activities) ??
      (execution ? extractExecutionReasoning(execution) : null);
    const actionActivities = activities.filter((a) => a.actionId === action.id);
    const hasComplete = actionActivities.some((a) => a.step === 'complete' || a.step === 'skipped');
    const latestActivity = actionActivities.reduce<AutopilotActivityRecord | null>((best, row) => {
      if (!best) return row;
      return row.createdAt > best.createdAt ? row : best;
    }, null);
    const actionError =
      execution?.status === 'failed'
        ? execution.errorMessage
        : execution?.errorMessage && execution.status === 'previewed'
          ? execution.errorMessage
          : !execution &&
              !hasComplete &&
              (latestActivity?.step === 'failed' || latestActivity?.status === 'error')
            ? (latestActivity?.detail ?? null)
            : null;
    const needsConfirm =
      progress === 'awaiting_human' || progress === 'awaiting_confirm';

    return (
      <ActionDetailDrawer
        open
        onClose={closeDetails}
        action={action}
        channel={channelLabel(action.channel)}
        statusLabel={progressLabel(chipProgress)}
        statusVariant={progressVariant(chipProgress)}
        execution={execution ?? null}
        pending={(batchRunning && activeActionId === action.id) || isRestarting}
        error={actionError}
        routingReasoning={routing}
        aiReasoning={aiReasoning}
        reasoningTrail={actionReasoningTrail(action.id, activities).map((item) => ({
          id: item.id,
          step: item.step,
          status: item.status,
          detail: item.detail ?? '',
        }))}
        onApprove={
          execution?.status === 'previewed' && onApproveAction
            ? () => onApproveAction(action.id, execution.id)
            : undefined
        }
        approving={isApproving}
        needsConfirm={needsConfirm}
        onConfirm={
          needsConfirm && onConfirmOrchestratorAction
            ? () => onConfirmOrchestratorAction(action.id)
            : undefined
        }
        confirming={isConfirming}
      />
    );
  };

  return (
    <>
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ padding: '16px 16px 0' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 16,
              flexWrap: 'wrap',
              marginBottom: 16,
            }}
          >
            <div style={{ flex: 1, minWidth: 240 }}>
              <div className="h-eyebrow" style={{ marginBottom: 8 }}>
                What&apos;s happening right now?
              </div>
              {overview.focus ? (
                <p style={{ fontSize: 15, fontWeight: 500, margin: '0 0 12px', lineHeight: 1.55, maxWidth: 640 }}>
                  {overview.focus}
                </p>
              ) : (
                <p className="t-dim" style={{ fontSize: 14, margin: '0 0 12px', lineHeight: 1.55, maxWidth: 640 }}>
                  The agent runs actions automatically until your goal is met. Ads pause for your approval.
                </p>
              )}

              {overview.assessment && overview.assessment !== overview.focus ? (
                <div style={{ marginBottom: 12 }}>
                  <div className="h-eyebrow" style={{ marginBottom: 6, fontSize: 10 }}>
                    Assessment
                  </div>
                  <p className="t-dim" style={{ fontSize: 14, margin: 0, lineHeight: 1.6, maxWidth: 640 }}>
                    {overview.assessment}
                  </p>
                </div>
              ) : null}

              {overview.decisions.length > 0 ? (
                <div style={{ marginBottom: 12 }}>
                  <div className="h-eyebrow" style={{ marginBottom: 8, fontSize: 10 }}>
                    What the agent decided
                  </div>
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {overview.decisions.slice(0, 3).map((d) => (
                      <li
                        key={d.id}
                        style={{
                          borderLeft: '3px solid var(--border)',
                          paddingLeft: 10,
                        }}
                      >
                        <span className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', letterSpacing: '0.04em' }}>
                          {d.label}
                        </span>
                        <p className="t-dim" style={{ fontSize: 13, margin: '3px 0 0', lineHeight: 1.5 }}>
                          {d.summary}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {overview.whatHappensNext ? (
                <div style={{ marginBottom: 4 }}>
                  <div className="h-eyebrow" style={{ marginBottom: 6, fontSize: 10 }}>
                    What happens next
                  </div>
                  <p className="t-dim" style={{ fontSize: 14, margin: 0, lineHeight: 1.6, maxWidth: 640 }}>
                    {overview.whatHappensNext}
                  </p>
                  {(() => {
                    const executionTime =
                      overview.scheduledReanalysisLabel ?? agentStatus.resumeLabel;
                    const showTime =
                      executionTime &&
                      /after the review|plan your next|next set of actions|next rotation/i.test(
                        overview.whatHappensNext ?? ''
                      );
                    if (!showTime) return null;
                    return (
                      <p
                        style={{
                          fontSize: 14,
                          margin: '10px 0 0',
                          lineHeight: 1.5,
                          fontWeight: 500,
                          color: 'var(--text)',
                        }}
                      >
                        Scheduled execution:{' '}
                        <span style={{ color: 'var(--accent, #6366f1)' }}>{executionTime}</span>
                      </p>
                    );
                  })()}
                </div>
              ) : null}

              {lastActivityAt ? (
                <p className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', marginTop: 10 }}>
                  Last update {formatDateTime(lastActivityAt)}
                </p>
              ) : null}
            </div>
            {onModeChange && autopilotMode ? (
              <div style={{ minWidth: 180 }}>
                <div
                  className="t-mono"
                  style={{ fontSize: 10, color: 'var(--text-mute)', letterSpacing: '0.06em', marginBottom: 6 }}
                >
                  AUTOPILOT MODE
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className={`btn${autopilotMode === 'assist' ? ' btn-primary' : ''}`}
                    disabled={modeSaving}
                    onClick={() => onModeChange('assist')}
                    style={{ flex: 1, fontSize: 12 }}
                  >
                    Assist
                  </button>
                  <button
                    type="button"
                    className={`btn${autopilotMode === 'hands_off' ? ' btn-primary' : ''}`}
                    disabled={modeSaving}
                    onClick={() => onModeChange('hands_off')}
                    style={{ flex: 1, fontSize: 12 }}
                  >
                    Hands-off
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--border)' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
              padding: '12px 16px 8px',
              flexWrap: 'wrap',
            }}
          >
            <div className="h-eyebrow" style={{ margin: 0 }}>
              Action flow
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Link href="/activity" className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }}>
                View logs
              </Link>
              {strategyId ? (
                <Link href={`/plan?id=${strategyId}`} className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }}>
                  Control room
                </Link>
              ) : null}
            </div>
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {rows.map((meta) => {
              const { action, progress, chipProgress, execution } = meta;
              const status = rowStatusMeta(chipProgress);
              const isActive = chipProgress === 'working';
              const needsConfirm =
                progress === 'awaiting_human' || progress === 'awaiting_confirm';
              const isConfirming = confirmingOrchestratorId === action.id;
              const schedule = formatActionSchedule(action);
              const outcomeLink = getExecutionOutcomeLink(execution);
              const completedAt = execution?.executedAt
                ? formatDateTime(execution.executedAt)
                : null;

              return (
                <FlowRow
                  key={action.id}
                  border={status.border}
                  color={status.color}
                  icon={status.icon}
                  label={status.label}
                  title={simpleActionTitle(action.title)}
                  subtitle={
                    completedAt
                      ? completedAt
                      : schedule
                        ? `Scheduled: ${schedule}`
                        : channelLabel(action.channel)
                  }
                  isActive={isActive}
                  trailing={
                    <>
                      {needsConfirm && onConfirmOrchestratorAction ? (
                        <Button
                          variant="primary"
                          type="button"
                          disabled={isConfirming || batchRunning}
                          onClick={() => onConfirmOrchestratorAction(action.id)}
                          style={{ fontSize: 12, padding: '4px 10px' }}
                        >
                          {isConfirming ? 'Continuing…' : 'Approve'}
                        </Button>
                      ) : null}
                      {outcomeLink ? (
                        <a
                          href={outcomeLink.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-ghost"
                          style={{ fontSize: 11, padding: '4px 8px' }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {outcomeLink.label} →
                        </a>
                      ) : null}
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ fontSize: 11, padding: '4px 8px' }}
                        onClick={() => openDetails(action.id)}
                      >
                        Details
                      </button>
                    </>
                  }
                />
              );
            })}

            {overview.reevaluation ? (
              (() => {
                const rev = overview.reevaluation!;
                const status = reevaluationRowStatus(rev.state);
                const completedAt = rev.completedAt
                  ? formatDateTime(rev.completedAt)
                  : null;
                return (
                  <FlowRow
                    key="__reevaluation"
                    border={status.border}
                    color={status.color}
                    icon={status.icon}
                    label={status.label}
                    title={rev.title}
                    subtitle={completedAt ?? rev.subtitle}
                    trailing={
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ fontSize: 11, padding: '4px 8px' }}
                        onClick={openReevaluationDetails}
                      >
                        Details
                      </button>
                    }
                  />
                );
              })()
            ) : agentStatus.kind === 'paused' && agentStatus.resumeLabel && !overview.reevaluation ? (
              <FlowRow
                key="__pause"
                border="rgba(234, 179, 8, 0.7)"
                color="var(--warn, #eab308)"
                icon="||"
                label="Paused"
                title="Review your data and plan next steps"
                subtitle={`Agent will review your data on ${agentStatus.resumeLabel} to reevaluate progress.`}
                trailing={
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: 11, padding: '4px 8px' }}
                    onClick={openReevaluationDetails}
                  >
                    Details
                  </button>
                }
              />
            ) : null}
          </ul>
        </div>
      </div>

      {renderDetailDrawer()}
    </>
  );
}
