import type { AutopilotActivityRecord } from '@/lib/autopilot-activity';
import { sanitizeAgentCopy } from '@/lib/plain-language';
import type { ExecutionRecord } from '@/lib/execution';
import type { OrchestratorSnapshot } from '@/lib/orchestrator';
import type { StrategyRecord } from '@/lib/plan-types';
import { formatDateTime } from '@/lib/format-datetime';

export type AgentStatusKind = 'active' | 'paused' | 'error';

export type AgentStatusSnapshot = {
  kind: AgentStatusKind;
  label: string;
  reason: string;
  expectation: string | null;
  resumeAt: string | null;
  resumeLabel: string | null;
  showResumeCta: boolean;
  showLogsCta: boolean;
  showConfirmCta: boolean;
  confirmActionId: string | null;
};

type Input = {
  strategy: StrategyRecord | null;
  orchestratorState: OrchestratorSnapshot | null;
  batchRunning: boolean;
  isGenerating: boolean;
  activities: AutopilotActivityRecord[];
  executionsByAction: Map<string, ExecutionRecord>;
};

/** Strip jargon and metric dumps from backend status strings. */
export function humanizeStatusReason(raw: string): string {
  const text = raw.trim();
  if (!text) return text;

  const lower = text.toLowerCase();
  if (
    lower.includes('could not read') &&
    (lower.includes('engagement') || lower.includes('engagementrate'))
  ) {
    return "The agent couldn't get your latest engagement data yet, but it's still working on scheduled tasks.";
  }
  if (lower.includes('connected sources')) {
    return 'Your account data is still syncing. Scheduled tasks will continue normally.';
  }

  const withoutMetricDumps = text
    .replace(/\s*Sessions\s*\([^)]*\)[^.]*\.?/gi, '')
    .replace(/\s*Orders\s*\([^)]*\)[^.]*\.?/gi, '')
    .replace(/\s*\(live\s+[^)]+\)/gi, '')
    .replace(/engagementRate/gi, 'engagement data')
    .replace(/google_analytics/gi, 'Analytics')
    .replace(/shopify/gi, 'Shopify')
    .trim();

  if (/checkpoint|batch complete|resting before/i.test(withoutMetricDumps)) {
    return 'This round of tasks is finished. The agent keeps checking progress on schedule.';
  }
  if (/waiting for you|paused ad|ads manager/i.test(withoutMetricDumps)) {
    return 'A paid campaign is parked for your review — other tasks keep running.';
  }
  if (/ready to load the next|load the next actions/i.test(withoutMetricDumps)) {
    return 'This round of tasks is finished. The agent will start the next ones soon.';
  }

  return sanitizeAgentCopy(withoutMetricDumps || text);
}

export function resolveAgentStatus(input: Input): AgentStatusSnapshot {
  const {
    strategy,
    orchestratorState,
    batchRunning,
    isGenerating,
    activities,
    executionsByAction,
  } = input;

  const failedAction = orchestratorState?.actions.find((a) => a.runStatus === 'failed');
  const openWork = orchestratorState?.actions.some(
    (a) => a.runStatus === 'pending' || a.runStatus === 'in_progress'
  );

  // A single failed action must not freeze the whole agent — keep going if other work remains.
  if (failedAction && !openWork && !batchRunning && !isGenerating) {
    const reason = humanizeStatusReason(
      failedAction.errorMessage ?? 'Something went wrong. Check the log below for details.'
    );
    return {
      kind: 'error',
      label: 'One task needs attention',
      reason,
      expectation:
        'The agent retries failed tasks on its next cycle and keeps monitoring your goal.',
      resumeAt: null,
      resumeLabel: null,
      showResumeCta: false,
      showLogsCta: true,
      showConfirmCta: false,
      confirmActionId: null,
    };
  }

  const humanGate = orchestratorState?.actions.find(
    (a) => a.runStatus === 'awaiting_human_action'
  );

  // Paid ads are parked for review — the agent itself keeps running other work.
  if (humanGate && !batchRunning && !isGenerating && !openWork) {
    return {
      kind: 'active',
      label: 'Working',
      reason:
        'A paid campaign is parked for your review. The agent keeps analyzing and running Instagram and other tasks on schedule.',
      expectation: 'Open the ad in Meta when ready, then tap Continue for that campaign only.',
      resumeAt: null,
      resumeLabel: null,
      showResumeCta: false,
      showLogsCta: true,
      showConfirmCta: true,
      confirmActionId: humanGate.actionId,
    };
  }

  const pauseUntil = strategy?.pauseUntil ? new Date(strategy.pauseUntil) : null;
  const isScheduledPause = pauseUntil && pauseUntil > new Date();
  if (isScheduledPause && !batchRunning && !isGenerating) {
    const hoursLeft = Math.max(
      1,
      Math.round((pauseUntil!.getTime() - Date.now()) / 3_600_000) || 1
    );
    return {
      kind: 'active',
      label: 'Monitoring',
      reason: humanizeStatusReason(
        orchestratorState?.block?.checkpointReasoning ??
          strategy?.nextBatchReasoning ??
          'Between batches — the agent is still checking progress on its schedule.'
      ),
      expectation: `Next batch starts within ~${hoursLeft}h. Goal checks still run regularly.`,
      resumeAt: strategy!.pauseUntil,
      resumeLabel: formatResumeLabel(pauseUntil!),
      showResumeCta: false,
      showLogsCta: true,
      showConfirmCta: Boolean(humanGate),
      confirmActionId: humanGate?.actionId ?? null,
    };
  }

  if (batchRunning || isGenerating) {
    const running = [...activities]
      .filter((a) => a.status === 'running')
      .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))[0];
    const runningTitle = sanitizeAgentCopy(
      running?.title?.replace(/^Executing: /, '') ?? 'your next task'
    );
    return {
      kind: 'active',
      label: 'Working',
      reason: isGenerating
        ? 'Building your plan and preparing your first tasks.'
        : `Creating: ${runningTitle}`,
      expectation: 'The agent is working. No action needed from you.',
      resumeAt: null,
      resumeLabel: null,
      showResumeCta: false,
      showLogsCta: true,
      showConfirmCta: false,
      confirmActionId: null,
    };
  }

  const staleRunning = activities.some((a) => {
    if (a.status !== 'running' || !a.actionId) return false;
    const ex = executionsByAction.get(a.actionId);
    return ex?.status === 'executed' || ex?.status === 'skipped';
  });
  if (!staleRunning) {
    const liveRunning = activities.some((a) => a.status === 'running' && a.actionId);
    if (liveRunning) {
      return {
        kind: 'active',
        label: 'Working',
        reason: 'The agent is running a task right now.',
        expectation: 'No action needed from you.',
        resumeAt: null,
        resumeLabel: null,
        showResumeCta: false,
        showLogsCta: true,
        showConfirmCta: false,
        confirmActionId: null,
      };
    }
  }

  if (orchestratorState?.block?.status === 'checkpoint') {
    const resumeLabel =
      pauseUntil && pauseUntil > new Date() ? formatResumeLabel(pauseUntil) : null;
    return {
      kind: 'active',
      label: 'Monitoring',
      reason: humanizeStatusReason(
        orchestratorState.block.checkpointReasoning ??
          'This round of tasks is finished. The agent keeps checking progress.'
      ),
      expectation: resumeLabel
        ? `Next tasks start ${resumeLabel}.`
        : 'The agent will start the next tasks automatically.',
      resumeAt: strategy?.pauseUntil ?? null,
      resumeLabel,
      showResumeCta: false,
      showLogsCta: true,
      showConfirmCta: Boolean(humanGate),
      confirmActionId: humanGate?.actionId ?? null,
    };
  }

  return {
    kind: 'active',
    label: humanGate ? 'Working' : 'Ready',
    reason: humanGate
      ? 'A paid campaign is parked for your review. Other work keeps running on schedule.'
      : 'The agent analyzes and acts on its own — no trigger needed from you.',
    expectation: humanGate
      ? 'Open the ad in Meta when ready, then tap Continue for that campaign only.'
      : 'No action needed from you.',
    resumeAt: null,
    resumeLabel: null,
    showResumeCta: false,
    showLogsCta: true,
    showConfirmCta: Boolean(humanGate),
    confirmActionId: humanGate?.actionId ?? null,
  };
}

function formatResumeLabel(date: Date): string {
  return formatDateTime(date);
}
