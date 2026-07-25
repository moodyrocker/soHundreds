import type { OrchestratorSnapshot } from '@/lib/orchestrator';
import type { PlanAction, StrategyRecord } from '@/lib/plan-types';
import { formatDateTime } from '@/lib/format-datetime';

export type UpcomingScheduleItem = {
  actionId: string;
  title: string;
  channel: string;
  whenLabel: string;
  status: 'pending' | 'in_progress' | 'queued';
};

export type UpcomingScheduleSummary = {
  nextRunLabel: string | null;
  nextRunAt: string | null;
  weekNumber: number;
  items: UpcomingScheduleItem[];
  remainingCount: number;
};

function channelLabel(channel: string): string {
  if (channel === 'instagram') return 'Instagram';
  if (channel === 'email') return 'Email';
  if (channel === 'seo' || channel === 'content') return 'Shopify / content';
  if (channel === 'paid') return 'Paid ads';
  return channel;
}

/** Build a simple “what’s next” view from the current plan week + orchestrator. */
export function buildUpcomingSchedule(
  strategy: StrategyRecord | null,
  orchestrator: OrchestratorSnapshot | null
): UpcomingScheduleSummary | null {
  if (!strategy?.plan) return null;

  const weekNumber = strategy.currentWeek || 1;
  const week = strategy.plan.weeks.find((w) => w.week === weekNumber) ?? strategy.plan.weeks[0];
  if (!week?.actions?.length) return null;

  const runById = new Map(
    (orchestrator?.actions ?? []).map((a) => [a.actionId, a.runStatus] as const)
  );

  const pendingOrOpen = week.actions.filter((a) => {
    const status = runById.get(a.id);
    if (!status) return true;
    return status === 'pending' || status === 'in_progress';
  });

  const items: UpcomingScheduleItem[] = pendingOrOpen.slice(0, 6).map((a: PlanAction) => {
    const status = runById.get(a.id);
    return {
      actionId: a.id,
      title: a.title,
      channel: channelLabel(a.channel),
      whenLabel: [a.day, a.time].filter(Boolean).join(' · ') || 'This week',
      status:
        status === 'in_progress' ? 'in_progress' : status === 'pending' ? 'pending' : 'queued',
    };
  });

  const pauseUntil = strategy.pauseUntil;
  const pauseMs = pauseUntil ? new Date(pauseUntil).getTime() : NaN;
  const nextRunAt =
    Number.isFinite(pauseMs) && pauseMs > Date.now() ? pauseUntil : null;
  const nextRunLabel = nextRunAt
    ? `Next agent run ${formatDateTime(nextRunAt)}`
    : items.length > 0
      ? 'Next agent run on the next autopilot cycle'
      : 'No open actions this week — agent will re-plan after checkpoint';

  return {
    nextRunLabel,
    nextRunAt,
    weekNumber,
    items,
    remainingCount: pendingOrOpen.length,
  };
}
