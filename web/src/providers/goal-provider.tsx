'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
const GOAL_STORAGE_KEY = 'hundres:goal';

interface GoalContextValue {
  goal: string;
  setGoal: (goal: string) => void;
}

const GoalContext = createContext<GoalContextValue | null>(null);

export function GoalProvider({ children }: { children: ReactNode }) {
  const [goal, setGoalState] = useState('');

  useEffect(() => {
    const stored = sessionStorage.getItem(GOAL_STORAGE_KEY);
    if (stored) setGoalState(stored);
  }, []);

  const setGoal = (value: string) => {
    setGoalState(value);
    sessionStorage.setItem(GOAL_STORAGE_KEY, value);
  };

  return <GoalContext.Provider value={{ goal, setGoal }}>{children}</GoalContext.Provider>;
}

export function useGoal() {
  const ctx = useContext(GoalContext);
  if (!ctx) throw new Error('useGoal must be used within GoalProvider');
  return ctx;
}

export function readGoalFromSearchParams(searchParams: URLSearchParams): string | null {
  return searchParams.get('goal');
}
