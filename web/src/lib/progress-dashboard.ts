import { apiFetch } from '@/lib/api';

export type ProgressTrend = 'up' | 'down' | 'flat' | 'unknown';

export type ProgressChartCard = {
  id: string;
  label: string;
  value: string;
  sublabel: string | null;
  series: number[];
  trend: ProgressTrend;
  color: string;
  connected: boolean;
  progressPct: number | null;
};

export type ProgressDashboard = {
  charts: ProgressChartCard[];
  updatedAt: string;
};

export function getProgressDashboard(
  token: string,
  organizationId: string,
  strategyId: string
) {
  return apiFetch<ProgressDashboard>(`/api/strategy/${strategyId}/progress-dashboard`, {
    token,
    organizationId,
  });
}
