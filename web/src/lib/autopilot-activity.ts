import { apiFetch } from '@/lib/api';

export type AutopilotActivityStatus = 'info' | 'running' | 'success' | 'warn' | 'error';

export type AutopilotActivityRecord = {
  id: string;
  organizationId: string;
  strategyId: string;
  weekNumber: number | null;
  actionId: string | null;
  step: string;
  title: string;
  detail: string;
  status: AutopilotActivityStatus;
  createdAt: string;
};

export function listAutopilotActivity(
  token: string,
  organizationId: string,
  strategyId: string
) {
  return apiFetch<{ activities: AutopilotActivityRecord[] }>(
    `/api/execution/strategy/${strategyId}/activity`,
    { token, organizationId }
  );
}
