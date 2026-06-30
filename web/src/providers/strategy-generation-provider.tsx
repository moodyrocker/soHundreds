'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiError } from '@/lib/api';
import {
  clearPendingGeneration,
  pendingForOrganization,
  writePendingGeneration,
} from '@/lib/strategy-generation-storage';
import {
  createStrategy,
  getGeneratingStrategy,
  getStrategy,
  pollStrategyUntilDone,
  refineStrategy,
} from '@/lib/strategy';
import { useAuth } from '@/providers/auth-provider';

type StrategyGenerationContextValue = {
  pending: { strategyId: string; goal: string } | null;
  isGenerating: boolean;
  error: string | null;
  completedId: string | null;
  startGeneration: (goal: string) => Promise<string>;
  startRefinement: (parentStrategyId: string, refinementNotes: string) => Promise<string>;
  resumePolling: (strategyId: string, goal: string) => void;
  clearError: () => void;
  clearCompleted: () => void;
};

const StrategyGenerationContext = createContext<StrategyGenerationContextValue | null>(null);

export function StrategyGenerationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { accessToken, activeOrganization } = useAuth();
  const [pending, setPending] = useState<{ strategyId: string; goal: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completedId, setCompletedId] = useState<string | null>(null);
  const pollAbort = useRef<AbortController | null>(null);
  const activePollId = useRef<string | null>(null);

  const beginPoll = useCallback(
    (strategyId: string, goal: string, organizationId: string) => {
      if (!accessToken) return;
      if (activePollId.current === strategyId) return;

      pollAbort.current?.abort();
      const controller = new AbortController();
      pollAbort.current = controller;
      activePollId.current = strategyId;

      setPending({ strategyId, goal });
      setError(null);
      setCompletedId(null);
      writePendingGeneration({
        organizationId,
        strategyId,
        goal,
        startedAt: new Date().toISOString(),
      });

      void pollStrategyUntilDone(accessToken, organizationId, strategyId, {
        signal: controller.signal,
      })
        .then((strategy) => {
          clearPendingGeneration();
          setPending(null);
          setCompletedId(strategy.id);
        })
        .catch((err) => {
          if (err instanceof Error && err.message === 'Polling cancelled') return;
          clearPendingGeneration();
          setPending(null);
          if (err instanceof ApiError) {
            setError(err.message);
          } else {
            setError(err instanceof Error ? err.message : 'Plan generation failed');
          }
        })
        .finally(() => {
          if (activePollId.current === strategyId) {
            activePollId.current = null;
          }
        });
    },
    [accessToken]
  );

  const resumeIfNeeded = useCallback(
    async (strategyId: string, goal: string, organizationId: string) => {
      if (!accessToken) return;
      if (activePollId.current === strategyId) return;

      try {
        const { strategy } = await getStrategy(accessToken, organizationId, strategyId);
        if (strategy.status === 'active' && strategy.plan) {
          clearPendingGeneration();
          setPending(null);
          return;
        }
        if (strategy.status === 'failed') {
          clearPendingGeneration();
          setPending(null);
          setError(strategy.generationError ?? 'Plan generation failed');
          return;
        }
      } catch {
        clearPendingGeneration();
        setPending(null);
        return;
      }

      beginPoll(strategyId, goal, organizationId);
    },
    [accessToken, beginPoll]
  );

  const syncFromServer = useCallback(async () => {
    if (!accessToken || !activeOrganization) {
      setPending(null);
      return;
    }

    const orgId = activeOrganization.id;
    const stored = pendingForOrganization(orgId);
    if (stored) {
      setPending({ strategyId: stored.strategyId, goal: stored.goal });
      await resumeIfNeeded(stored.strategyId, stored.goal, orgId);
      return;
    }

    try {
      const { strategy } = await getGeneratingStrategy(accessToken, orgId);
      if (strategy.status === 'generating') {
        await resumeIfNeeded(strategy.id, strategy.goal, orgId);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setPending(null);
      }
    }
  }, [accessToken, activeOrganization, resumeIfNeeded]);

  useEffect(() => {
    void syncFromServer();
  }, [syncFromServer]);

  useEffect(() => {
    return () => pollAbort.current?.abort();
  }, []);

  const startGeneration = useCallback(
    async (goal: string) => {
      if (!accessToken || !activeOrganization) {
        throw new Error('Sign in and select a workspace first');
      }

      const { strategy } = await createStrategy(accessToken, activeOrganization.id, { goal });
      beginPoll(strategy.id, strategy.goal, activeOrganization.id);
      router.replace('/');
      return strategy.id;
    },
    [accessToken, activeOrganization, beginPoll, router]
  );

  const startRefinement = useCallback(
    async (parentStrategyId: string, refinementNotes: string) => {
      if (!accessToken || !activeOrganization) {
        throw new Error('Sign in and select a workspace first');
      }

      const { strategy } = await refineStrategy(
        accessToken,
        activeOrganization.id,
        parentStrategyId,
        refinementNotes
      );
      beginPoll(strategy.id, strategy.goal, activeOrganization.id);
      router.replace('/');
      return strategy.id;
    },
    [accessToken, activeOrganization, beginPoll, router]
  );

  const resumePolling = useCallback(
    (strategyId: string, goal: string) => {
      if (!activeOrganization) return;
      beginPoll(strategyId, goal, activeOrganization.id);
    },
    [activeOrganization, beginPoll]
  );

  const value: StrategyGenerationContextValue = {
    pending,
    isGenerating: Boolean(pending),
    error,
    completedId,
    startGeneration,
    startRefinement,
    resumePolling,
    clearError: () => setError(null),
    clearCompleted: () => setCompletedId(null),
  };

  return (
    <StrategyGenerationContext.Provider value={value}>{children}</StrategyGenerationContext.Provider>
  );
}

export function useStrategyGeneration() {
  const ctx = useContext(StrategyGenerationContext);
  if (!ctx) {
    throw new Error('useStrategyGeneration must be used within StrategyGenerationProvider');
  }
  return ctx;
}

export function useStrategyGenerationOptional() {
  return useContext(StrategyGenerationContext);
}
