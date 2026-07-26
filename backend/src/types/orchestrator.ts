export type ActionRunStatus =
  | 'pending'
  | 'in_progress'
  | 'awaiting_confirmation'
  | 'awaiting_human_action'
  | 'confirmed'
  | 'failed';

export type BlockRunStatus = 'idle' | 'running' | 'checkpoint' | 'halted' | 'complete';

export type ActionRunStateRecord = {
  id: string;
  organizationId: string;
  strategyId: string;
  weekNumber: number;
  actionId: string;
  sortOrder: number;
  runStatus: ActionRunStatus;
  humanGateReason: string | null;
  executionId: string | null;
  errorMessage: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BlockRunStateRecord = {
  id: string;
  organizationId: string;
  strategyId: string;
  weekNumber: number;
  status: BlockRunStatus;
  checkpointReasoning: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OrchestratorSnapshot = {
  block: BlockRunStateRecord | null;
  actions: ActionRunStateRecord[];
  currentActionId: string | null;
};
