import { apiFetch } from '@/lib/api';

export type GoalProgressStatus = 'met' | 'on_track' | 'behind' | 'unknown';

export type GoalProgress = {
  status: GoalProgressStatus;
  goalMet: boolean;
  metricKey: string;
  currentValue: number | null;
  baselineValue: number | null;
  targetValue: number | null;
  progressPct: number | null;
  summary: string;
  dataSources: string[];
};

export type WeekOutcome = {
  id: string;
  weekNumber: number;
  actionsPrepared: number;
  actionsTotal: number;
  progressPct: number | null;
  goalMet: boolean;
  status: string;
  summary: string | null;
  createdAt: string;
};

export type GoalProgressResponse = {
  progress: GoalProgress;
  outcome: WeekOutcome | null;
  weekReady: boolean;
  outcomes: WeekOutcome[];
};

export function getGoalProgress(token: string, organizationId: string, strategyId: string) {
  return apiFetch<GoalProgressResponse>(`/api/strategy/${strategyId}/goal-progress`, {
    token,
    organizationId,
  });
}
