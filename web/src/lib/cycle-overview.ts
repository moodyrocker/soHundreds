import type { AutopilotActivityRecord } from '@/lib/autopilot-activity';
import { humanizeStatusReason } from '@/lib/agent-status';
import { sanitizeAgentCopy } from '@/lib/plain-language';
import type { StrategyRecord } from '@/lib/plan-types';
import type { OrchestratorSnapshot } from '@/lib/orchestrator';
import { formatDateTime } from '@/lib/format-datetime';

export type CycleDecision = {
  id: string;
  label: string;
  summary: string;
  at: string;
};

export type ReevaluationState = 'scheduled' | 'completed' | null;

export type ReevaluationFlow = {
  state: ReevaluationState;
  reviewAt: string | null;
  completedAt: string | null;
  title: string;
  subtitle: string;
  assessment: string | null;
  nextRotation: string | null;
};

export type CycleOverview = {
  focus: string | null;
  assessment: string | null;
  decisions: CycleDecision[];
  whatHappensNext: string | null;
  scheduledReanalysisAt: string | null;
  scheduledReanalysisLabel: string | null;
  reevaluation: ReevaluationFlow | null;
};

const DECISION_STEPS = new Set([
  'checkpoint',
  'decision',
  'action_plan',
  'ai_reasoning',
  'learning_scored',
  'learning_patterns',
  'learning_applied',
]);

function decisionLabel(step: string): string {
  switch (step) {
    case 'checkpoint':
      return 'Data review';
    case 'decision':
    case 'action_plan':
      return 'Decision';
    case 'ai_reasoning':
      return 'Reasoning';
    case 'learning_scored':
      return 'Results scored';
    case 'learning_patterns':
      return 'Patterns updated';
    case 'learning_applied':
      return 'Past learnings applied';
    default:
      return 'Update';
  }
}

function formatReviewTime(iso: string): string {
  return formatDateTime(iso);
}

export function buildCycleOverview(input: {
  strategy: StrategyRecord | null;
  orchestratorState: OrchestratorSnapshot | null;
  activities: AutopilotActivityRecord[];
  cycleFocus: string | null;
  allActionsDone: boolean;
}): CycleOverview {
  const { strategy, orchestratorState, activities, cycleFocus, allActionsDone } = input;

  const checkpointReasoning =
    orchestratorState?.block?.checkpointReasoning?.trim() ??
    activities
      .filter((a) => a.step === 'checkpoint')
      .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))[0]
      ?.detail?.trim() ??
    null;

  const nextRotation =
    strategy?.nextBatchReasoning?.trim() ??
    (allActionsDone && checkpointReasoning
      ? 'The agent will plan your next set of actions after the review.'
      : null);

  const assessment = checkpointReasoning
    ? humanizeStatusReason(checkpointReasoning)
    : cycleFocus
      ? sanitizeAgentCopy(cycleFocus)
      : null;

  const decisions: CycleDecision[] = activities
    .filter((a) => DECISION_STEPS.has(a.step) && a.detail?.trim())
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))
    .slice(0, 6)
    .map((a) => ({
      id: a.id,
      label: decisionLabel(a.step),
      summary: sanitizeAgentCopy(a.detail!.slice(0, 280) + (a.detail!.length > 280 ? '…' : '')),
      at: a.createdAt,
    }));

  const pauseUntil = strategy?.pauseUntil ? new Date(strategy.pauseUntil) : null;
  const atCheckpoint = orchestratorState?.block?.status === 'checkpoint';
  const pauseInFuture = Boolean(pauseUntil && pauseUntil > new Date());
  const checkpointActivity = activities
    .filter((a) => a.step === 'checkpoint')
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))[0];

  let reevaluation: ReevaluationFlow | null = null;

  if (allActionsDone && pauseInFuture && strategy?.pauseUntil) {
    reevaluation = {
      state: 'scheduled',
      reviewAt: strategy.pauseUntil,
      completedAt: null,
      title: 'Review your data and plan next steps',
      subtitle: `Agent will review your data on ${formatReviewTime(strategy.pauseUntil)} to reevaluate progress.`,
      assessment: assessment,
      nextRotation: nextRotation ? sanitizeAgentCopy(nextRotation) : null,
    };
  } else if (allActionsDone && (atCheckpoint || checkpointActivity) && !pauseInFuture) {
    reevaluation = {
      state: 'completed',
      reviewAt: strategy?.pauseUntil ?? null,
      completedAt: checkpointActivity?.createdAt ?? strategy?.pauseUntil ?? null,
      title: 'Data review complete',
      subtitle: nextRotation
        ? sanitizeAgentCopy(nextRotation)
        : 'Setting up the next rotation of actions.',
      assessment: assessment,
      nextRotation: nextRotation ? sanitizeAgentCopy(nextRotation) : null,
    };
  }

  let whatHappensNext: string | null = null;
  let scheduledReanalysisAt: string | null = null;
  let scheduledReanalysisLabel: string | null = null;

  if (reevaluation?.state === 'scheduled' && strategy?.pauseUntil) {
    whatHappensNext = 'The agent will plan your next set of actions after the review.';
    scheduledReanalysisAt = strategy.pauseUntil;
    scheduledReanalysisLabel = formatReviewTime(strategy.pauseUntil);
  } else if (reevaluation?.state === 'completed' && reevaluation.nextRotation) {
    whatHappensNext = reevaluation.nextRotation;
  } else if (reevaluation?.state === 'completed') {
    whatHappensNext = 'Setting up the next rotation of actions.';
  } else if (nextRotation) {
    whatHappensNext = sanitizeAgentCopy(nextRotation);
  } else if (allActionsDone) {
    whatHappensNext = 'The agent is finishing this round and will plan what to do next.';
  } else {
    whatHappensNext = 'The agent keeps running tasks automatically. Ads will pause for your approval.';
  }

  if (!scheduledReanalysisLabel && strategy?.pauseUntil) {
    const pauseDate = new Date(strategy.pauseUntil);
    if (pauseDate > new Date()) {
      scheduledReanalysisAt = strategy.pauseUntil;
      scheduledReanalysisLabel = formatReviewTime(strategy.pauseUntil);
    }
  }

  return {
    focus: cycleFocus ? sanitizeAgentCopy(cycleFocus) : null,
    assessment,
    decisions,
    whatHappensNext,
    scheduledReanalysisAt,
    scheduledReanalysisLabel,
    reevaluation,
  };
}

export function reevaluationRowStatus(state: ReevaluationState): {
  border: string;
  color: string;
  icon: string;
  label: string;
} {
  if (state === 'completed') {
    return {
      border: 'rgba(34, 197, 94, 0.7)',
      color: 'var(--success, #22c55e)',
      icon: '✓',
      label: 'Completed',
    };
  }
  return {
    border: 'rgba(234, 179, 8, 0.7)',
    color: 'var(--warn, #eab308)',
    icon: '||',
    label: 'Paused',
  };
}
