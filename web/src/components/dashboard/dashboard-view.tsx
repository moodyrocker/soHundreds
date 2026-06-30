'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AutopilotPreflightPanel } from '@/components/dashboard/autopilot-preflight-panel';
import { AutopilotActionTable } from '@/components/dashboard/autopilot-action-table';
import { AutopilotActivityPanel } from '@/components/dashboard/autopilot-activity-panel';
import { Button } from '@/components/hundres/button';
import { Card } from '@/components/hundres/card';
import { Chip } from '@/components/hundres/chip';
import { Icon } from '@/components/hundres/icon';
import { ApiError } from '@/lib/api';
import { type AutopilotMode, getBusinessProfile, updateBusinessProfile } from '@/lib/business-profile';
import { CHANNELS, type ChannelId } from '@/lib/channels';
import { listExecutions, previewExecution, approveExecution, runWeekExecutions, type AutopilotPreflight, type ExecutionRecord } from '@/lib/execution';
import {
  listAutopilotActivity,
  type AutopilotActivityRecord,
} from '@/lib/autopilot-activity';
import { getGoalProgress, type GoalProgress, type WeekOutcome } from '@/lib/goal-progress';
import { type StrategyRecord } from '@/lib/plan-types';
import { advanceStrategyWeek, getActiveStrategy, getActionCompletions, setActionCompletion } from '@/lib/strategy';
import { useAuth } from '@/providers/auth-provider';
import { useStrategyGeneration } from '@/providers/strategy-generation-provider';

function channelLabel(channel: string) {
  const id = channel as ChannelId;
  return CHANNELS[id]?.label ?? channel;
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
  const [advancing, setAdvancing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [goalProgress, setGoalProgress] = useState<GoalProgress | null>(null);
  const [weekOutcomes, setWeekOutcomes] = useState<WeekOutcome[]>([]);
  const [progressLoading, setProgressLoading] = useState(false);
  const [activities, setActivities] = useState<AutopilotActivityRecord[]>([]);
  const [preflight, setPreflight] = useState<AutopilotPreflight | null>(null);
  const [preflightConfirmed, setPreflightConfirmed] = useState(false);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [completedActionIds, setCompletedActionIds] = useState<Set<string>>(new Set());
  const [completionSaving, setCompletionSaving] = useState<string | null>(null);
  const [restartingActionId, setRestartingActionId] = useState<string | null>(null);
  const [approvingActionId, setApprovingActionId] = useState<string | null>(null);

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

  const loadGoalProgress = useCallback(
    async (strategyId: string) => {
      if (!accessToken || !activeOrganization) return;
      setProgressLoading(true);
      try {
        const { progress, outcomes } = await getGoalProgress(
          accessToken,
          activeOrganization.id,
          strategyId
        );
        setGoalProgress(progress);
        setWeekOutcomes(outcomes);
      } catch {
        setGoalProgress(null);
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
          loadGoalProgress(record.id),
          loadActivities(record.id),
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
  }, [accessToken, activeOrganization, loadActivities, loadExecutions, loadGoalProgress, loadStrategy]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!completedId || !accessToken || !activeOrganization) return;
    void refresh().then(async (record) => {
      clearCompleted();
      if (record?.id && record.plan) {
        const week = record.currentWeek;
        setPreflightLoading(true);
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
          setPreflightLoading(false);
        }
      }
    });
  }, [completedId, refresh, clearCompleted, accessToken, activeOrganization, loadActivities]);

  useEffect(() => {
    if (!strategy?.id || (!batchRunning && !isGenerating)) return;

    const poll = () => {
      void loadActivities(strategy.id);
      void loadExecutions(strategy.id);
    };
    poll();
    const interval = setInterval(poll, 1500);
    return () => clearInterval(interval);
  }, [strategy?.id, batchRunning, isGenerating, loadActivities, loadExecutions]);

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
  const goalTarget = strategy?.plan?.summary.goalTarget;

  const weekProgress = useMemo(() => {
    if (!currentWeekBlock) return { ready: 0, completed: 0, total: 0 };
    const total = currentWeekBlock.actions.length;
    const ready = currentWeekBlock.actions.filter((a) => {
      const ex = executionsByAction.get(a.id);
      return ex && (ex.status === 'executed' || ex.status === 'previewed');
    }).length;
    const completed = currentWeekBlock.actions.filter((a) => completedActionIds.has(a.id)).length;
    return { ready, completed, total };
  }, [currentWeekBlock, executionsByAction, completedActionIds]);

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

  const onRestartAction = async (actionId: string) => {
    if (!accessToken || !activeOrganization || !strategy?.id || restartingActionId) return;
    setRestartingActionId(actionId);
    setNotice(null);
    try {
      const result = await previewExecution(
        accessToken,
        activeOrganization.id,
        strategy.id,
        actionId
      );
      setExecutionsByAction((prev) => {
        const next = new Map(prev);
        next.set(actionId, result.execution);
        return next;
      });
      await loadActivities(strategy.id);
      setNotice('Deliverable regenerated for this action.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not restart this action');
      await loadActivities(strategy.id);
    } finally {
      setRestartingActionId(null);
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
        updated.executionType === 'create_meta_ads_campaign'
          ? 'Campaign created paused in Meta Ads Manager — open Meta to review and start when ready.'
          : updated.executionType === 'create_google_ads_campaign'
          ? 'Campaign created paused in Google Ads — open Google Ads to review and start when ready.'
          : 'Change applied successfully.'
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

  const onAdvanceWeek = async () => {
    if (!accessToken || !activeOrganization || !strategy?.id) return;
    setAdvancing(true);
    setNotice(null);
    try {
      const { strategy: updated } = await advanceStrategyWeek(
        accessToken,
        activeOrganization.id,
        strategy.id
      );
      setStrategy(updated);
      await Promise.all([loadExecutions(updated.id), loadGoalProgress(updated.id), loadActivities(updated.id)]);
      if (updated.goalStatus === 'met') {
        setNotice('Goal met — Hundres reached your target.');
      } else {
        setNotice(`Week ${updated.currentWeek} is being prepared toward your goal.`);
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not advance to next week');
    } finally {
      setAdvancing(false);
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
        setNotice('Review live data above, then confirm to prepare this week\'s actions.');
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
      const ok = response.results.filter((r) => r.ok).length;
      setNotice(`Autopilot prepared ${ok} of ${response.results.length} actions for this week.`);
      await Promise.all([loadGoalProgress(strategy.id), loadActivities(strategy.id)]);
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

  const onRunAutopilot = () => void runAutopilotBatch(false);
  const onConfirmPreflight = () => void runAutopilotBatch(true);
  const onRefreshPreflight = () => void runAutopilotBatch(false);

  const showWorking = isGenerating || batchRunning || advancing || preflightLoading;

  return (
    <>
      <div className="dash-greeting">
        <div>
          <div className="h-eyebrow" style={{ marginBottom: 12 }}>
            Autopilot
          </div>
          <h1 className="h-display">Hi, {name}.</h1>
          {loading ? (
            <p className="t-dim" style={{ fontSize: 17, marginTop: 10, maxWidth: 560 }}>
              Loading…
            </p>
          ) : isGenerating ? (
            <p className="t-dim" style={{ fontSize: 17, marginTop: 10, maxWidth: 560 }}>
              Hundres is analyzing your goal and preparing this week&apos;s work automatically.
            </p>
          ) : goalMet ? (
            <p className="t-dim" style={{ fontSize: 17, marginTop: 10, maxWidth: 560 }}>
              Goal reached — {strategy!.plan!.summary.goalLine}
            </p>
          ) : hasPlan ? (
            <p className="t-dim" style={{ fontSize: 17, marginTop: 10, maxWidth: 560 }}>
              {strategy!.plan!.summary.goalLine}
            </p>
          ) : (
            <p className="t-dim" style={{ fontSize: 17, marginTop: 10, maxWidth: 560 }}>
              Tell us your goal — Hundres keeps working week by week until it&apos;s met.
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
                  Research, analysis, and this week&apos;s actions run automatically. You can leave this page.
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
          <Card style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                  <Chip variant="accent">Week {strategy!.currentWeek}</Chip>
                  <Chip variant="default">Until goal is met</Chip>
                  <Chip variant={weekProgress.ready === weekProgress.total ? 'success' : 'default'}>
                    {weekProgress.ready}/{weekProgress.total} prepared
                  </Chip>
                  <Chip variant={weekProgress.completed === weekProgress.total ? 'success' : 'default'}>
                    {weekProgress.completed}/{weekProgress.total} done
                  </Chip>
                </div>
                {goalTarget ? (
                  <p className="t-dim" style={{ fontSize: 13, margin: '0 0 10px', lineHeight: 1.5 }}>
                    Target: {goalTarget.metric} → {goalTarget.target}
                    {goalTarget.unit ? ` ${goalTarget.unit}` : ''}
                    {goalTarget.baseline ? ` (from ${goalTarget.baseline})` : ''}
                  </p>
                ) : null}
                {goalProgress ? (
                  <div style={{ marginBottom: 12 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8,
                        fontSize: 12,
                        marginBottom: 6,
                      }}
                    >
                      <span className="t-dim">
                        {goalProgress.status === 'met'
                          ? 'Goal met'
                          : goalProgress.progressPct != null
                            ? `${goalProgress.progressPct}% toward target`
                            : 'Measuring progress…'}
                      </span>
                      <Chip
                        variant={
                          goalProgress.status === 'met'
                            ? 'success'
                            : goalProgress.status === 'on_track'
                              ? 'default'
                              : goalProgress.status === 'behind'
                                ? 'warn'
                                : 'default'
                        }
                      >
                        {goalProgress.status.replace('_', ' ')}
                      </Chip>
                    </div>
                    {goalProgress.progressPct != null && goalProgress.status !== 'met' ? (
                      <div
                        style={{
                          height: 6,
                          borderRadius: 3,
                          background: 'var(--border)',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${Math.min(100, Math.max(0, goalProgress.progressPct))}%`,
                            height: '100%',
                            background: 'var(--accent)',
                          }}
                        />
                      </div>
                    ) : null}
                    <p className="t-dim" style={{ fontSize: 12, margin: '8px 0 0', lineHeight: 1.45 }}>
                      {goalProgress.summary}
                    </p>
                  </div>
                ) : progressLoading ? (
                  <p className="t-dim" style={{ fontSize: 12, margin: '0 0 10px' }}>
                    Checking progress…
                  </p>
                ) : null}
                <h2 className="h-md" style={{ marginBottom: 6 }}>
                  {currentWeekBlock!.title}
                </h2>
                <p className="t-dim" style={{ fontSize: 14, margin: 0, lineHeight: 1.55, maxWidth: 560 }}>
                  {currentWeekBlock!.focus}
                </p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 200 }}>
                <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', letterSpacing: '0.06em' }}>
                  AUTOPILOT MODE
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className={`btn${autopilotMode === 'assist' ? ' btn-primary' : ''}`}
                    disabled={modeSaving}
                    onClick={() => void onModeChange('assist')}
                    style={{ flex: 1, fontSize: 12 }}
                  >
                    Assist
                  </button>
                  <button
                    type="button"
                    className={`btn${autopilotMode === 'hands_off' ? ' btn-primary' : ''}`}
                    disabled={modeSaving}
                    onClick={() => void onModeChange('hands_off')}
                    style={{ flex: 1, fontSize: 12 }}
                  >
                    Hands-off
                  </button>
                </div>
                <p className="t-dim" style={{ fontSize: 11, margin: 0, lineHeight: 1.45 }}>
                  {autopilotMode === 'hands_off'
                    ? 'AI runs each week toward your goal and applies safe store changes when connected.'
                    : 'AI prepares this week\'s work — you paste or approve, then move on.'}
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              <Button
                variant="primary"
                type="button"
                disabled={showWorking}
                onClick={() => void onRunAutopilot()}
              >
                {batchRunning
                  ? 'Running autopilot…'
                  : preflight
                    ? 'Re-check live data'
                    : 'Check data & run autopilot'}
              </Button>
              {weekProgress.completed === weekProgress.total && weekProgress.total > 0 ? (
                <Button variant="ghost" type="button" disabled={showWorking} onClick={() => void onAdvanceWeek()}>
                  {advancing ? 'Planning next week…' : 'Next week →'}
                </Button>
              ) : null}
              <Link href={`/plan?id=${strategy!.id}`} className="btn btn-ghost">
                History
              </Link>
            </div>
            {notice ? (
              <p className="t-dim" style={{ fontSize: 13, margin: '12px 0 0' }}>
                {notice}
              </p>
            ) : null}
          </Card>

          {preflight ? (
            <AutopilotPreflightPanel
              preflight={preflight}
              confirming={batchRunning}
              confirmed={preflightConfirmed}
              onConfirm={() => void onConfirmPreflight()}
              onRefresh={() => void onRefreshPreflight()}
            />
          ) : null}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 360px)',
              gap: 16,
              marginBottom: 24,
              alignItems: 'start',
            }}
          >
            <AutopilotActionTable
              actions={currentWeekBlock!.actions}
              channelLabel={channelLabel}
              executionsByAction={executionsByAction}
              activities={activities}
              batchRunning={batchRunning}
              activeActionId={activeActionId}
              completedActionIds={completedActionIds}
              completionSaving={completionSaving}
              restartingActionId={restartingActionId}
              approvingActionId={approvingActionId}
              onToggleComplete={(actionId) => void onToggleActionComplete(actionId)}
              onPrepareWeek={() => void runAutopilotBatch(true)}
              onRestartAction={(actionId) => void onRestartAction(actionId)}
              onApproveAction={(actionId, executionId) => void onApproveAction(actionId, executionId)}
            />
            <AutopilotActivityPanel
              activities={activities}
              running={batchRunning}
              snapshots={preflight?.snapshots}
            />
          </div>

          {weekOutcomes.length > 0 ? (
            <Card style={{ marginBottom: 24 }}>
              <div className="h-eyebrow" style={{ marginBottom: 8 }}>
                Progress log
              </div>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 13, lineHeight: 1.5 }}>
                {weekOutcomes.map((o) => (
                  <li key={o.id} style={{ padding: '8px 0', borderTop: '1px solid var(--border)' }}>
                    <strong>Week {o.weekNumber}</strong> · {o.actionsPrepared}/{o.actionsTotal} ready
                    {o.summary ? ` — ${o.summary}` : ''}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
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
            <li>Hundres defines a measurable target and runs work week by week</li>
            <li>Each week is prepared automatically — hands-off applies changes when connected</li>
            <li>New weeks are planned from your data until the goal is met</li>
          </ol>
          <Link href="/new" className="btn btn-primary">
            Set your goal
          </Link>
        </Card>
      )}
    </>
  );
}
