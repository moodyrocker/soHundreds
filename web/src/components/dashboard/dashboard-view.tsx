'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AutopilotPreflightPanel } from '@/components/dashboard/autopilot-preflight-panel';
import { AgentLogsPanel } from '@/components/dashboard/agent-logs-panel';
import { ProgressChartsPanel } from '@/components/dashboard/progress-charts-panel';
import { AutopilotActionTable } from '@/components/dashboard/autopilot-action-table';
import { resolveAgentStatus } from '@/lib/agent-status';
import { sanitizeAgentCopy } from '@/lib/plain-language';
import { Card } from '@/components/hundres/card';
import { Chip } from '@/components/hundres/chip';
import { Icon } from '@/components/hundres/icon';
import { ApiError } from '@/lib/api';
import { type AutopilotMode, getBusinessProfile, updateBusinessProfile } from '@/lib/business-profile';
import { CHANNELS, type ChannelId } from '@/lib/channels';
import { listExecutions, runWeekExecutions, approveExecution, type AutopilotPreflight, type ExecutionRecord } from '@/lib/execution';
import {
  confirmOrchestratorAction,
  getOrchestratorSnapshot,
  runContinuousAutopilot,
  runSequentialWeek,
  type ActionRunState,
  type OrchestratorSnapshot,
} from '@/lib/orchestrator';
import {
  listAutopilotActivity,
  type AutopilotActivityRecord,
} from '@/lib/autopilot-activity';
import { type StrategyRecord } from '@/lib/plan-types';
import { getActiveStrategy, getActionCompletions, setActionCompletion } from '@/lib/strategy';
import { getProgressDashboard, type ProgressChartCard } from '@/lib/progress-dashboard';
import { useAuth } from '@/providers/auth-provider';
import { useStrategyGeneration } from '@/providers/strategy-generation-provider';

function channelLabel(channel: string) {
  const id = channel as ChannelId;
  return CHANNELS[id]?.label ?? channel;
}

function displayGoalLine(goalLine: string): string {
  return sanitizeAgentCopy(goalLine.trim());
}

export function DashboardView() {
  const { user, accessToken, activeOrganization } = useAuth();
  const { pending, isGenerating, error: generationError, completedId, clearCompleted } =
    useStrategyGeneration();

  const [strategy, setStrategy] = useState<StrategyRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [autopilotMode, setAutopilotMode] = useState<AutopilotMode>('assist');
  const [modeSaving, setModeSaving] = useState(false);
  const [executionsByAction, setExecutionsByAction] = useState<Map<string, ExecutionRecord>>(
    new Map()
  );
  const [batchRunning, setBatchRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [activities, setActivities] = useState<AutopilotActivityRecord[]>([]);
  const [preflight, setPreflight] = useState<AutopilotPreflight | null>(null);
  const [preflightConfirmed, setPreflightConfirmed] = useState(false);
  const [completedActionIds, setCompletedActionIds] = useState<Set<string>>(new Set());
  const [completionSaving, setCompletionSaving] = useState<string | null>(null);
  const [approvingActionId, setApprovingActionId] = useState<string | null>(null);
  const [orchestratorState, setOrchestratorState] = useState<OrchestratorSnapshot | null>(null);
  const [confirmingOrchestratorId, setConfirmingOrchestratorId] = useState<string | null>(null);
  const [progressCharts, setProgressCharts] = useState<ProgressChartCard[]>([]);
  const [progressLoading, setProgressLoading] = useState(false);

  const name = user?.email?.split('@')[0] ?? 'there';

  const activeActionId = useMemo(() => {
    const running = [...activities].reverse().find((a) => a.status === 'running' && a.actionId);
    return running?.actionId ?? null;
  }, [activities]);

  const loadStrategy = useCallback(async () => {
    if (!accessToken || !activeOrganization) return null;
    const { strategy: record } = await getActiveStrategy(accessToken, activeOrganization.id);
    setStrategy(record);
    return record;
  }, [accessToken, activeOrganization]);

  const loadActivities = useCallback(
    async (strategyId: string) => {
      if (!accessToken || !activeOrganization) return;
      try {
        const { activities: items } = await listAutopilotActivity(
          accessToken,
          activeOrganization.id,
          strategyId
        );
        setActivities(items);
      } catch {
        /* activity feed is optional until migration runs */
      }
    },
    [accessToken, activeOrganization]
  );

  const loadExecutions = useCallback(
    async (strategyId: string) => {
      if (!accessToken || !activeOrganization) return;
      const [{ executions }, { completedActionIds: ids }] = await Promise.all([
        listExecutions(accessToken, activeOrganization.id, strategyId),
        getActionCompletions(accessToken, activeOrganization.id, strategyId),
      ]);
      setExecutionsByAction(new Map(executions.map((e) => [e.actionId, e])));
      setCompletedActionIds(new Set(ids));
    },
    [accessToken, activeOrganization]
  );

  const loadOrchestrator = useCallback(
    async (strategyId: string, week: number) => {
      if (!accessToken || !activeOrganization) return;
      try {
        const snapshot = await getOrchestratorSnapshot(
          accessToken,
          activeOrganization.id,
          strategyId,
          week
        );
        setOrchestratorState(snapshot);
      } catch {
        setOrchestratorState(null);
      }
    },
    [accessToken, activeOrganization]
  );

  const loadProgressDashboard = useCallback(
    async (strategyId: string) => {
      if (!accessToken || !activeOrganization) return;
      setProgressLoading(true);
      try {
        const { charts } = await getProgressDashboard(accessToken, activeOrganization.id, strategyId);
        setProgressCharts(charts);
      } catch {
        setProgressCharts([]);
      } finally {
        setProgressLoading(false);
      }
    },
    [accessToken, activeOrganization]
  );

  const refresh = useCallback(async () => {
    if (!accessToken || !activeOrganization) {
      setLoading(false);
      return null;
    }
    try {
      const [{ autopilotMode: mode }, record] = await Promise.all([
        getBusinessProfile(accessToken, activeOrganization.id),
        loadStrategy(),
      ]);
      setAutopilotMode(mode);
      if (record?.id) {
        await Promise.all([
          loadExecutions(record.id),
          loadActivities(record.id),
          loadProgressDashboard(record.id),
          record.plan
            ? loadOrchestrator(record.id, record.currentWeek)
            : Promise.resolve(),
        ]);
      }
      return record;
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) {
        setNotice(err instanceof Error ? err.message : 'Failed to load workspace');
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, [accessToken, activeOrganization, loadActivities, loadExecutions, loadOrchestrator, loadProgressDashboard, loadStrategy]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!completedId || !accessToken || !activeOrganization) return;
    void refresh().then(async (record) => {
      clearCompleted();
      if (record?.id && record.plan) {
        const week = record.currentWeek;
        setBatchRunning(true);
        try {
          const response = await runWeekExecutions(
            accessToken,
            activeOrganization.id,
            record.id,
            week,
            false
          );
          setPreflight(response.preflight);
          await loadActivities(record.id);
        } catch {
          /* preflight optional */
        } finally {
          setBatchRunning(false);
        }
      }
    });
  }, [completedId, refresh, clearCompleted, accessToken, activeOrganization, loadActivities]);

  useEffect(() => {
    const agentActive = batchRunning || isGenerating;
    if (!strategy?.id || !agentActive) return;
    const strategyId = strategy.id;
    const week = strategy.currentWeek;

    const poll = () => {
      void loadActivities(strategyId);
      void loadExecutions(strategyId);
      void loadOrchestrator(strategyId, week);
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [
    strategy?.id,
    strategy?.currentWeek,
    batchRunning,
    isGenerating,
    loadActivities,
    loadExecutions,
    loadOrchestrator,
  ]);

  useEffect(() => {
    if (!strategy?.id || batchRunning || isGenerating) return;
    const currentWeekBlock = strategy.plan?.weeks.find((w) => w.week === strategy.currentWeek);
    if (!currentWeekBlock) return;

    const missing = currentWeekBlock.actions.some((a) => !executionsByAction.has(a.id));
    if (!missing) return;

    const interval = setInterval(() => {
      void loadExecutions(strategy.id);
    }, 4000);
    return () => clearInterval(interval);
  }, [strategy, executionsByAction, batchRunning, isGenerating, loadExecutions]);

  const currentWeekBlock = strategy?.plan?.weeks.find((w) => w.week === strategy?.currentWeek);
  const hasPlan = Boolean(strategy?.plan && currentWeekBlock);
  const goalMet = strategy?.goalStatus === 'met';

  const orchestratorByAction = useMemo(() => {
    const map = new Map<string, ActionRunState>();
    for (const row of orchestratorState?.actions ?? []) {
      map.set(row.actionId, row);
    }
    return map;
  }, [orchestratorState]);

  const agentStatus = useMemo(
    () =>
      resolveAgentStatus({
        strategy,
        orchestratorState,
        batchRunning,
        isGenerating,
        activities,
        executionsByAction,
      }),
    [strategy, orchestratorState, batchRunning, isGenerating, activities, executionsByAction]
  );

  const latestRunningActivity = useMemo(() => {
    const runningRows = activities.filter((a) => {
      if (a.status !== 'running') return false;
      if (a.actionId) {
        const ex = executionsByAction.get(a.actionId);
        if (ex?.status === 'executed' || ex?.status === 'skipped') return false;
      }
      return true;
    });
    if (!runningRows.length) return null;
    return runningRows.reduce((best, row) =>
      row.createdAt > best.createdAt ? row : best
    );
  }, [activities, executionsByAction]);

  const onToggleActionComplete = async (actionId: string) => {
    if (!accessToken || !activeOrganization || !strategy?.id) return;
    if (completionSaving === actionId) return;

    const wasCompleted = completedActionIds.has(actionId);
    const nextCompleted = !wasCompleted;

    setCompletedActionIds((prev) => {
      const next = new Set(prev);
      if (nextCompleted) next.add(actionId);
      else next.delete(actionId);
      return next;
    });
    setCompletionSaving(actionId);

    try {
      const { completedActionIds: ids } = await setActionCompletion(
        accessToken,
        activeOrganization.id,
        strategy.id,
        actionId,
        nextCompleted
      );
      setCompletedActionIds(new Set(ids));
    } catch {
      setCompletedActionIds((prev) => {
        const next = new Set(prev);
        if (wasCompleted) next.add(actionId);
        else next.delete(actionId);
        return next;
      });
      setNotice('Could not save action completion. Try again.');
    } finally {
      setCompletionSaving(null);
    }
  };

  const onApproveAction = async (actionId: string, executionId: string) => {
    if (!accessToken || !activeOrganization || !strategy?.id || approvingActionId) return;
    setApprovingActionId(actionId);
    setNotice(null);
    try {
      const { execution: updated } = await approveExecution(
        accessToken,
        activeOrganization.id,
        executionId
      );
      setExecutionsByAction((prev) => {
        const next = new Map(prev);
        next.set(actionId, updated);
        return next;
      });
      await loadActivities(strategy.id);
      setNotice(
        updated.status === 'executed'
          ? updated.executionType === 'create_meta_ads_campaign'
            ? 'Campaign created paused in Meta Ads — open Meta to review and start when ready.'
            : updated.executionType === 'create_google_ads_campaign'
            ? 'Campaign created paused in Google Ads — open Google Ads to review and start when ready.'
            : 'Created in your store successfully.'
          : 'Action ready — expand the row to review before applying.'
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not approve this action');
      await loadExecutions(strategy.id);
    } finally {
      setApprovingActionId(null);
    }
  };

  const onModeChange = async (mode: AutopilotMode) => {
    if (!accessToken || !activeOrganization || modeSaving) return;
    setModeSaving(true);
    setAutopilotMode(mode);
    try {
      await updateBusinessProfile(accessToken, activeOrganization.id, { autopilotMode: mode });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not update autopilot mode');
      void refresh();
    } finally {
      setModeSaving(false);
    }
  };

  const onConfirmOrchestratorAction = async (actionId: string) => {
    if (!accessToken || !activeOrganization || !strategy?.id || !currentWeekBlock) return;
    setConfirmingOrchestratorId(actionId);
    setBatchRunning(true);
    setNotice(null);
    try {
      let snapshot = await confirmOrchestratorAction(
        accessToken,
        activeOrganization.id,
        strategy.id,
        currentWeekBlock.week,
        actionId
      );
      setOrchestratorState(snapshot);
      let resolvedWeek = currentWeekBlock.week;

      if (autopilotMode === 'hands_off') {
        const continuous = await runContinuousAutopilot(
          accessToken,
          activeOrganization.id,
          strategy.id,
          currentWeekBlock.week,
          { handsOff: true }
        );
        snapshot = continuous.snapshot;
        setOrchestratorState(snapshot);
        if (continuous.strategy) {
          resolvedWeek = continuous.strategy.currentWeek;
          setStrategy((prev) =>
            prev
              ? {
                  ...prev,
                  currentWeek: continuous.strategy!.currentWeek,
                  goalStatus: continuous.strategy!.goalStatus as typeof prev.goalStatus,
                }
              : prev
          );
        }
      }

      await Promise.all([
        loadExecutions(strategy.id),
        loadActivities(strategy.id),
        loadOrchestrator(strategy.id, resolvedWeek),
      ]);

      if (snapshot.block?.status === 'checkpoint') {
        setNotice(
          sanitizeAgentCopy(
            snapshot.block.checkpointReasoning ?? 'Round of tasks complete — moving to the next ones.'
          )
        );
      } else if (snapshot.actions.some((a) => a.runStatus === 'awaiting_human_action')) {
        setNotice('Paused campaign is in Ads Manager — review it, then mark done to continue.');
      } else {
        setNotice('Action confirmed — agent continuing sequentially.');
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not confirm action');
    } finally {
      setConfirmingOrchestratorId(null);
      setBatchRunning(false);
    }
  };

  const runAutopilotBatch = async (confirm: boolean) => {
    if (!accessToken || !activeOrganization || !strategy?.id || !currentWeekBlock) return;
    setBatchRunning(true);
    setNotice(null);
    void loadActivities(strategy.id);
    try {
      const response = await runWeekExecutions(
        accessToken,
        activeOrganization.id,
        strategy.id,
        currentWeekBlock.week,
        confirm
      );
      setPreflight(response.preflight);
      if (response.phase === 'preflight') {
        setPreflightConfirmed(false);
        setNotice('Review live data above, then confirm to prepare your next tasks.');
        await loadActivities(strategy.id);
        return;
      }
      setPreflightConfirmed(true);
      setExecutionsByAction((prev) => {
        const next = new Map(prev);
        for (const r of response.results) {
          if (r.execution) next.set(r.actionId, r.execution);
        }
        return next;
      });
      await loadActivities(strategy.id);
      const created = response.results.filter((r) => r.execution?.status === 'executed').length;
      const prepared = response.results.filter((r) => r.ok).length;
      setNotice(
        created > 0
          ? `Agent created ${created} item(s) in your accounts (campaigns start paused). ${prepared} of ${response.results.length} actions processed.`
          : `Agent processed ${prepared} of ${response.results.length} actions. Connect Meta Ads or Shopify write access to auto-create campaigns and store pages.`
      );
      await loadActivities(strategy.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Autopilot run failed';
      await Promise.all([loadExecutions(strategy.id), loadActivities(strategy.id)]);
      if (/timed out/i.test(message)) {
        setNotice(
          'Request timed out in the browser, but preparation may still have finished. Refresh the page — if actions show Ready, expand them to view deliverables.'
        );
      } else {
        setNotice(message);
      }
    } finally {
      setBatchRunning(false);
    }
  };

  const onConfirmPreflight = async () => {
    if (!accessToken || !activeOrganization || !strategy?.id || !currentWeekBlock) return;
    setBatchRunning(true);
    setNotice(null);
    void loadActivities(strategy.id);
    try {
      let snapshot: OrchestratorSnapshot;
      let weekForOrchestrator = currentWeekBlock.week;
      if (autopilotMode === 'hands_off') {
        const result = await runContinuousAutopilot(
          accessToken,
          activeOrganization.id,
          strategy.id,
          currentWeekBlock.week,
          { handsOff: true }
        );
        snapshot = result.snapshot;
        setOrchestratorState(snapshot);
        if (result.strategy) {
          weekForOrchestrator = result.strategy.currentWeek;
          setStrategy((prev) =>
            prev
              ? {
                  ...prev,
                  currentWeek: result.strategy!.currentWeek,
                  goalStatus: result.strategy!.goalStatus as typeof prev.goalStatus,
                }
              : prev
          );
        }
      } else {
        snapshot = await runSequentialWeek(
          accessToken,
          activeOrganization.id,
          strategy.id,
          currentWeekBlock.week
        );
        setOrchestratorState(snapshot);
      }
      setPreflightConfirmed(true);
      await Promise.all([
        loadExecutions(strategy.id),
        loadActivities(strategy.id),
        loadOrchestrator(strategy.id, weekForOrchestrator),
      ]);

      const waitingHuman = snapshot.actions.filter(
        (a) => a.runStatus === 'awaiting_human_action'
      );
      const failed = snapshot.actions.filter((a) => a.runStatus === 'failed');

      if (failed.length) {
        setNotice(`Agent halted — ${failed[0].errorMessage ?? 'action failed'}.`);
      } else if (waitingHuman.length) {
        setNotice(
          'Paused campaign is in Ads Manager — review it, turn on spend when ready, then mark done to continue.'
        );
      } else if (snapshot.block?.status === 'checkpoint') {
        setNotice(
          sanitizeAgentCopy(
            snapshot.block.checkpointReasoning ?? 'Round of tasks complete — moving to the next ones.'
          )
        );
      } else {
        const confirmed = snapshot.actions.filter((a) => a.runStatus === 'confirmed').length;
        setNotice(`Sequential agent confirmed ${confirmed} of ${snapshot.actions.length} actions.`);
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Sequential run failed');
      await loadExecutions(strategy.id);
    } finally {
      setBatchRunning(false);
    }
  };

  const onRefreshPreflight = () => void runAutopilotBatch(false);

  const agentActivelyExecuting =
    isGenerating ||
    (batchRunning && Boolean(latestRunningActivity?.actionId)) ||
    Boolean(latestRunningActivity?.status === 'running' && latestRunningActivity?.actionId);

  return (
    <>
      <div className="dash-greeting">
        <div>
          <div className="h-eyebrow" style={{ marginBottom: 12 }}>
            Autopilot
          </div>
          <p className="t-dim" style={{ fontSize: 15, margin: '0 0 8px', maxWidth: 720 }}>
            Hi, {name}.
          </p>
          {loading ? (
            <p className="t-dim" style={{ fontSize: 17, marginTop: 4, maxWidth: 720 }}>
              Loading…
            </p>
          ) : isGenerating ? (
            <p className="t-dim" style={{ fontSize: 17, marginTop: 4, maxWidth: 720 }}>
              Hundres is analyzing your goal and preparing your first tasks automatically.
            </p>
          ) : goalMet ? (
            <h1 className="h-display" style={{ fontWeight: 700, maxWidth: 900, lineHeight: 1.15 }}>
              Goal reached — {displayGoalLine(strategy!.plan!.summary.goalLine)}
            </h1>
          ) : hasPlan ? (
            <h1 className="h-display" style={{ fontWeight: 700, maxWidth: 900, lineHeight: 1.15 }}>
              {displayGoalLine(strategy!.plan!.summary.goalLine)}
            </h1>
          ) : (
            <p className="t-dim" style={{ fontSize: 17, marginTop: 4, maxWidth: 720 }}>
              Tell us your goal — Hundres keeps working until it&apos;s met.
            </p>
          )}
        </div>
        {!hasPlan && !isGenerating ? (
          <Link href="/new" className="btn btn-primary">
            <Icon name="sparkle" style={{ width: 14, height: 14 }} />
            Set a goal
          </Link>
        ) : null}
      </div>

      {(isGenerating || generationError) && (
        <Card style={{ marginBottom: 24 }}>
          {generationError ? (
            <>
              <p className="auth-error" style={{ margin: 0 }}>
                {generationError}
              </p>
              <Link href="/new" className="btn btn-ghost" style={{ marginTop: 12 }}>
                Try again
              </Link>
            </>
          ) : (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div className="thinking-pulse" />
              <div>
                <div style={{ fontWeight: 500, marginBottom: 4 }}>Building your plan</div>
                <p className="t-dim" style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
                  Research, analysis, and your next tasks run automatically. You can leave this page.
                </p>
                {pending?.goal ? (
                  <p className="t-mono" style={{ fontSize: 11, color: 'var(--text-mute)', marginTop: 8 }}>
                    {pending.goal.slice(0, 120)}
                    {pending.goal.length > 120 ? '…' : ''}
                  </p>
                ) : null}
              </div>
            </div>
          )}
        </Card>
      )}

      {hasPlan && !loading && !goalMet && (
        <>
          <ProgressChartsPanel charts={progressCharts} loading={progressLoading} />

          {preflight ? (
            <AutopilotPreflightPanel
              preflight={preflight}
              confirming={batchRunning}
              confirmed={preflightConfirmed}
              onConfirm={() => void onConfirmPreflight()}
              onRefresh={() => void onRefreshPreflight()}
            />
          ) : null}

          <AutopilotActionTable
            actions={currentWeekBlock!.actions}
            channelLabel={channelLabel}
            executionsByAction={executionsByAction}
            orchestratorByAction={orchestratorByAction}
            activities={activities}
            batchRunning={batchRunning}
            activeActionId={activeActionId}
            completedActionIds={completedActionIds}
            completionSaving={completionSaving}
            approvingActionId={approvingActionId}
            confirmingOrchestratorId={confirmingOrchestratorId}
            agentStatus={agentStatus}
            strategy={strategy}
            orchestratorState={orchestratorState}
            cycleFocus={currentWeekBlock!.focus}
            strategyId={strategy!.id}
            autopilotMode={autopilotMode}
            modeSaving={modeSaving}
            onModeChange={(mode) => void onModeChange(mode)}
            onToggleComplete={(actionId) => void onToggleActionComplete(actionId)}
            onApproveAction={(actionId, executionId) => void onApproveAction(actionId, executionId)}
            onConfirmOrchestratorAction={(actionId) => void onConfirmOrchestratorAction(actionId)}
          />

          {notice ? (
            <p className="t-dim" style={{ fontSize: 13, margin: '0 0 16px' }}>
              {notice}
            </p>
          ) : null}

          <AgentLogsPanel
            activities={activities}
            running={batchRunning || agentActivelyExecuting || isGenerating}
            showFilters
          />
        </>
      )}

      {goalMet && !loading && (
        <Card>
          <Chip variant="success" style={{ marginBottom: 12 }}>
            Goal met
          </Chip>
          <h2 className="h-md" style={{ marginBottom: 8 }}>
            Hundres reached your target
          </h2>
          <p className="t-dim" style={{ fontSize: 14, lineHeight: 1.55, margin: '0 0 16px' }}>
            {strategy?.plan?.summary.goalLine}
          </p>
          <Link href="/new" className="btn btn-primary">
            Set a new goal
          </Link>
        </Card>
      )}

      {!hasPlan && !isGenerating && !loading && (
        <Card>
          <h2 className="h-md" style={{ marginBottom: 8 }}>
            How it works
          </h2>
          <ol style={{ margin: '0 0 20px', paddingLeft: 20, lineHeight: 1.7, fontSize: 14, color: 'var(--text-dim)' }}>
            <li>Hundres defines a measurable target and keeps working until it&apos;s met</li>
            <li>Tasks run continuously — hands-off applies changes when connected</li>
            <li>New actions are planned from your data as you go</li>
          </ol>
          <Link href="/new" className="btn btn-primary">
            Set your goal
          </Link>
        </Card>
      )}
    </>
  );
}
