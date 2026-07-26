import { apiFetch } from '@/lib/api';
import type { ExecutionPreviewResponse } from '@/lib/execution';
import type { PlanAction } from '@/lib/plan-types';

export type AgentChatTurn = {
  role: 'user' | 'assistant';
  content: string;
};

export type AgentSentiment =
  | 'positive'
  | 'neutral'
  | 'negative'
  | 'frustrated'
  | 'curious'
  | 'urgent';

export type AgentTaskResponse = {
  reply: string;
  supported: boolean;
  unsupportedReason?: string;
  needsClarification?: boolean;
  sentiment?: AgentSentiment;
  action?: PlanAction;
  routing?: string;
  result?: ExecutionPreviewResponse;
  needsHumanGate?: boolean;
};

export function runAgentTask(
  token: string,
  organizationId: string,
  strategyId: string,
  message: string,
  history?: AgentChatTurn[]
) {
  return apiFetch<AgentTaskResponse>('/api/execution/agent-task', {
    method: 'POST',
    token,
    organizationId,
    body: JSON.stringify({ strategyId, message, history }),
    timeoutMs: 900_000,
  });
}
