import { apiFetch, ApiError } from '@/lib/api';
import type { StrategyRecord } from '@/lib/plan-types';

const CREATE_TIMEOUT_MS = 30_000;
const POLL_TIMEOUT_MS = 15_000;

export type CreateStrategyResponse = {
  strategy: StrategyRecord;
  accepted?: boolean;
};

export function createStrategy(
  token: string,
  organizationId: string,
  body: { goal: string; context?: string; budget?: string }
) {
  return apiFetch<CreateStrategyResponse>('/api/strategy/create', {
    method: 'POST',
    token,
    organizationId,
    body: JSON.stringify(body),
    timeoutMs: CREATE_TIMEOUT_MS,
  });
}

export function advanceStrategyWeek(token: string, organizationId: string, strategyId: string) {
  return apiFetch<{ strategy: StrategyRecord }>(`/api/strategy/${strategyId}/advance-week`, {
    method: 'POST',
    token,
    organizationId,
    body: JSON.stringify({}),
    timeoutMs: 120_000,
  });
}

export function refineStrategy(
  token: string,
  organizationId: string,
  parentStrategyId: string,
  refinementNotes: string
) {
  return apiFetch<CreateStrategyResponse>(`/api/strategy/${parentStrategyId}/refine`, {
    method: 'POST',
    token,
    organizationId,
    body: JSON.stringify({ refinementNotes }),
    timeoutMs: CREATE_TIMEOUT_MS,
  });
}

export function getGeneratingStrategy(token: string, organizationId: string) {
  return apiFetch<{ strategy: StrategyRecord }>('/api/strategy/generating', {
    token,
    organizationId,
  });
}

export function getActiveStrategy(token: string, organizationId: string) {
  return apiFetch<{ strategy: StrategyRecord }>('/api/strategy/active', {
    token,
    organizationId,
  });
}

export function listStrategies(token: string, organizationId: string, limit = 25) {
  return apiFetch<{ strategies: StrategyRecord[] }>(`/api/strategy/list?limit=${limit}`, {
    token,
    organizationId,
  });
}

export function deleteStrategy(token: string, organizationId: string, strategyId: string) {
  return apiFetch<void>(`/api/strategy/${strategyId}`, {
    method: 'DELETE',
    token,
    organizationId,
  });
}

export function getStrategy(token: string, organizationId: string, strategyId: string) {
  return apiFetch<{ strategy: StrategyRecord }>(`/api/strategy/${strategyId}`, {
    token,
    organizationId,
    timeoutMs: POLL_TIMEOUT_MS,
  });
}

export function getActionCompletions(
  token: string,
  organizationId: string,
  strategyId: string
) {
  return apiFetch<{ completedActionIds: string[] }>(
    `/api/strategy/${strategyId}/completions`,
    { token, organizationId }
  );
}

export function setActionCompletion(
  token: string,
  organizationId: string,
  strategyId: string,
  actionId: string,
  completed: boolean
) {
  return apiFetch<{ completedActionIds: string[] }>(
    `/api/strategy/${strategyId}/completions/${encodeURIComponent(actionId)}`,
    {
      method: 'PUT',
      token,
      organizationId,
      body: JSON.stringify({ completed }),
    }
  );
}

export async function pollStrategyUntilDone(
  token: string,
  organizationId: string,
  strategyId: string,
  options: {
    intervalMs?: number;
    onUpdate?: (strategy: StrategyRecord) => void;
    signal?: AbortSignal;
  } = {}
): Promise<StrategyRecord> {
  const intervalMs = options.intervalMs ?? 3000;

  for (;;) {
    if (options.signal?.aborted) {
      throw new Error('Polling cancelled');
    }

    const { strategy } = await getStrategy(token, organizationId, strategyId);
    options.onUpdate?.(strategy);

    if (strategy.status === 'active' && strategy.plan) {
      return strategy;
    }
    if (strategy.status === 'failed') {
      throw new ApiError(
        strategy.generationError ?? 'Plan generation failed',
        500
      );
    }

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, intervalMs);
      options.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          reject(new Error('Polling cancelled'));
        },
        { once: true }
      );
    });
  }
}
