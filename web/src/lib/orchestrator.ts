import { apiFetch } from '@/lib/api';

export type ActionRunStatus =
  | 'pending'
  | 'in_progress'
  | 'awaiting_confirmation'
  | 'awaiting_human_action'
  | 'confirmed'
  | 'failed';

export type BlockRunStatus = 'idle' | 'running' | 'checkpoint' | 'halted' | 'complete';

export type ActionRunState = {
  id: string;
  actionId: string;
  sortOrder: number;
  runStatus: ActionRunStatus;
  humanGateReason: string | null;
  executionId: string | null;
  errorMessage: string | null;
};

export type OrchestratorSnapshot = {
  block: {
    status: BlockRunStatus;
    checkpointReasoning: string | null;
    errorMessage: string | null;
  } | null;
  actions: ActionRunState[];
  currentActionId: string | null;
};

export function getOrchestratorSnapshot(
  token: string,
  organizationId: string,
  strategyId: string,
  week: number
) {
  return apiFetch<OrchestratorSnapshot>(`/api/execution/orchestrate/${strategyId}/${week}`, {
    token,
    organizationId,
  });
}

export function runOrchestratorStep(
  token: string,
  organizationId: string,
  strategyId: string,
  week: number
) {
  return apiFetch<OrchestratorSnapshot>('/api/execution/orchestrate/step', {
    method: 'POST',
    token,
    organizationId,
    body: JSON.stringify({ strategyId, week }),
    timeoutMs: 900_000,
  });
}

export function confirmOrchestratorAction(
  token: string,
  organizationId: string,
  strategyId: string,
  week: number,
  actionId: string
) {
  return apiFetch<OrchestratorSnapshot>('/api/execution/orchestrate/confirm', {
    method: 'POST',
    token,
    organizationId,
    body: JSON.stringify({ strategyId, week, actionId }),
    timeoutMs: 900_000,
  });
}

export type AdvanceCheckpointResult = {
  snapshot: OrchestratorSnapshot;
  strategy: { id: string; currentWeek: number; goalStatus: string };
  continued: boolean;
};

export function advanceFromCheckpoint(
  token: string,
  organizationId: string,
  strategyId: string,
  week: number
) {
  return apiFetch<AdvanceCheckpointResult>('/api/execution/orchestrate/advance-checkpoint', {
    method: 'POST',
    token,
    organizationId,
    body: JSON.stringify({ strategyId, week }),
    timeoutMs: 900_000,
  });
}

/** Run sequential steps until blocked on human/confirmation or block completes. */
export async function runSequentialWeek(
  token: string,
  organizationId: string,
  strategyId: string,
  week: number
): Promise<OrchestratorSnapshot> {
  let snapshot = await runOrchestratorStep(token, organizationId, strategyId, week);
  const maxSteps = 50;

  for (let i = 0; i < maxSteps; i++) {
    const halted = snapshot.actions.some(
      (a) => a.runStatus === 'awaiting_human_action' || a.runStatus === 'failed'
    );
    const pending = snapshot.actions.some((a) => a.runStatus === 'pending');
    if (halted || !pending || snapshot.block?.status === 'checkpoint') {
      return snapshot;
    }
    snapshot = await runOrchestratorStep(token, organizationId, strategyId, week);
  }

  return snapshot;
}

/**
 * Hands-off continuous loop: sequential week runs, checkpoint advance, repeat until
 * human gate, failure, goal met, or max blocks.
 */
export async function runContinuousAutopilot(
  token: string,
  organizationId: string,
  strategyId: string,
  startWeek: number,
  options?: { handsOff?: boolean }
): Promise<{
  snapshot: OrchestratorSnapshot;
  strategy: AdvanceCheckpointResult['strategy'] | null;
  weeksRun: number;
}> {
  let week = startWeek;
  let snapshot = await runSequentialWeek(token, organizationId, strategyId, week);
  let strategy: AdvanceCheckpointResult['strategy'] | null = null;
  const maxBlocks = options?.handsOff ? 6 : 1;

  for (let block = 0; block < maxBlocks; block++) {
    const blocked = snapshot.actions.some(
      (a) => a.runStatus === 'awaiting_human_action' || a.runStatus === 'failed'
    );
    if (blocked || snapshot.block?.status !== 'checkpoint') {
      return { snapshot, strategy, weeksRun: block + 1 };
    }

    if (!options?.handsOff) {
      return { snapshot, strategy, weeksRun: block + 1 };
    }

    const advanced = await advanceFromCheckpoint(token, organizationId, strategyId, week);
    strategy = advanced.strategy;
    snapshot = advanced.snapshot;
    week = advanced.strategy.currentWeek;

    if (!advanced.continued || advanced.strategy.goalStatus === 'met') {
      return { snapshot, strategy, weeksRun: block + 1 };
    }

    snapshot = await runSequentialWeek(token, organizationId, strategyId, week);
  }

  return { snapshot, strategy, weeksRun: maxBlocks };
}
