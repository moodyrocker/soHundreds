'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AgentLogsPanel } from '@/components/dashboard/agent-logs-panel';
import { UpcomingSchedulePanel } from '@/components/dashboard/upcoming-schedule-panel';
import { Card } from '@/components/hundres/card';
import { listAutopilotActivity, type AutopilotActivityRecord } from '@/lib/autopilot-activity';
import { getOrchestratorSnapshot, type OrchestratorSnapshot } from '@/lib/orchestrator';
import { getActiveStrategy } from '@/lib/strategy';
import type { StrategyRecord } from '@/lib/plan-types';
import { buildUpcomingSchedule } from '@/lib/upcoming-schedule';
import { useAuth } from '@/providers/auth-provider';

export function ActivityLogView() {
  const { accessToken, activeOrganization, user } = useAuth();
  const [activities, setActivities] = useState<AutopilotActivityRecord[]>([]);
  const [strategy, setStrategy] = useState<StrategyRecord | null>(null);
  const [orchestrator, setOrchestrator] = useState<OrchestratorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const name = user?.email?.split('@')[0] ?? 'there';

  const load = useCallback(async () => {
    if (!accessToken || !activeOrganization) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { strategy: active } = await getActiveStrategy(accessToken, activeOrganization.id);
      if (!active?.id) {
        setActivities([]);
        setStrategy(null);
        setOrchestrator(null);
        return;
      }
      setStrategy(active);
      const week = active.currentWeek || 1;
      const [{ activities: items }, snap] = await Promise.all([
        listAutopilotActivity(accessToken, activeOrganization.id, active.id),
        getOrchestratorSnapshot(accessToken, activeOrganization.id, active.id, week).catch(
          () => null
        ),
      ]);
      setActivities(items);
      setOrchestrator(snap);
    } catch {
      setActivities([]);
      setStrategy(null);
      setOrchestrator(null);
    } finally {
      setLoading(false);
    }
  }, [accessToken, activeOrganization]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!strategy?.id || !accessToken || !activeOrganization) return;
    const interval = setInterval(() => {
      void listAutopilotActivity(accessToken, activeOrganization.id, strategy.id).then(
        ({ activities: items }) => setActivities(items)
      );
      const week = strategy.currentWeek || 1;
      void getOrchestratorSnapshot(
        accessToken,
        activeOrganization.id,
        strategy.id,
        week
      )
        .then(setOrchestrator)
        .catch(() => undefined);
    }, 8000);
    return () => clearInterval(interval);
  }, [strategy?.id, strategy?.currentWeek, accessToken, activeOrganization]);

  const schedule = useMemo(
    () => buildUpcomingSchedule(strategy, orchestrator),
    [strategy, orchestrator]
  );

  const goalLine = strategy?.plan?.summary.goalLine ?? null;

  return (
    <>
      <div className="dash-greeting">
        <div>
          <div className="h-eyebrow" style={{ marginBottom: 12 }}>
            Autopilot
          </div>
          <h1 className="h-display">Activity log</h1>
          <p className="t-dim" style={{ fontSize: 17, marginTop: 10, maxWidth: 560 }}>
            {goalLine ?? `What the agent published, and what’s scheduled next for ${name}.`}
          </p>
        </div>
        <Link href="/" className="btn btn-ghost">
          Back to dashboard
        </Link>
      </div>

      {loading ? (
        <Card>
          <p className="t-dim" style={{ margin: 0 }}>
            Loading activity…
          </p>
        </Card>
      ) : !strategy?.id ? (
        <Card>
          <p className="t-dim" style={{ margin: 0, lineHeight: 1.55 }}>
            No active goal yet.{' '}
            <Link href="/new" style={{ color: 'var(--accent)' }}>
              Set a goal
            </Link>{' '}
            to start the agent.
          </p>
        </Card>
      ) : (
        <>
          <UpcomingSchedulePanel schedule={schedule} />
          <AgentLogsPanel
            activities={activities}
            running={false}
            limit={300}
            dedupe={false}
            showWhenEmpty
            hideHistoryLink
            showFilters
            defaultFilter="results"
          />
        </>
      )}
    </>
  );
}
