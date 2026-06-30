'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/hundres/button';
import { Card } from '@/components/hundres/card';
import { Chip } from '@/components/hundres/chip';
import { Icon } from '@/components/hundres/icon';
import { ExecutionModal } from '@/components/plan/execution-modal';
import { ApiError } from '@/lib/api';
import { CHANNELS, type ChannelId } from '@/lib/channels';
import { listExecutions, runWeekExecutions, type ExecutionRecord } from '@/lib/execution';
import { dataSourceLabel, type PlanDocument, type PlanWeek, type StrategyRecord } from '@/lib/plan-types';
import { sanitizePlanDocumentText } from '@/lib/strip-model-markup';
import { getActiveStrategy, getActionCompletions, getStrategy, setActionCompletion } from '@/lib/strategy';
import { useAuth } from '@/providers/auth-provider';
import { useStrategyGeneration } from '@/providers/strategy-generation-provider';

type PlanTab = 'timeline' | 'channels' | 'tasks';

function impactLabel(impact: string) {
  if (impact === 'high') return '↑ High impact';
  if (impact === 'med') return 'Medium';
  return 'Low';
}

function channelMeta(channel: string) {
  const id = channel as ChannelId;
  return CHANNELS[id] ?? CHANNELS.content;
}

function confidenceChip(confidence: string): 'success' | 'default' | 'warn' {
  if (confidence === 'high') return 'success';
  if (confidence === 'low') return 'warn';
  return 'default';
}

function executionStatusLabel(execution: ExecutionRecord): string | null {
  if (execution.executionType === 'assist_deliverable' && execution.status === 'executed') {
    return 'Prepared';
  }
  if (execution.status === 'executed') return 'Executed';
  if (execution.status === 'rolled_back') return 'Rolled back';
  if (execution.status === 'skipped') return 'Skipped';
  if (execution.status === 'failed') return 'Failed';
  if (execution.status === 'previewed') return 'Ready to approve';
  return null;
}

export function PlanView() {
  const searchParams = useSearchParams();
  const { accessToken, activeOrganization } = useAuth();
  const { startRefinement, isGenerating: generationInFlight } = useStrategyGeneration();

  const [strategy, setStrategy] = useState<StrategyRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<PlanTab>('timeline');
  const [openId, setOpenId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [refineOpen, setRefineOpen] = useState(false);
  const [refineText, setRefineText] = useState('');
  const [refineError, setRefineError] = useState<string | null>(null);
  const [refining, setRefining] = useState(false);
  const [completedActionIds, setCompletedActionIds] = useState<Set<string>>(new Set());
  const [completionSaving, setCompletionSaving] = useState<string | null>(null);
  const [executionsByAction, setExecutionsByAction] = useState<Map<string, ExecutionRecord>>(
    new Map()
  );
  const [executionModalAction, setExecutionModalAction] = useState<{
    id: string;
    title: string;
    channel: string;
  } | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const initialLoadDone = useRef(false);

  const strategyId = searchParams.get('id');

  const onDoThisForMe = (action: { id: string; title: string; channel: string }) => {
    setExecutionModalAction(action);
  };

  const onRunWeek = async (week: number) => {
    if (!accessToken || !activeOrganization || !strategy?.id) return;
    setBatchRunning(true);
    setActionNotice(null);
    try {
      const response = await runWeekExecutions(
        accessToken,
        activeOrganization.id,
        strategy.id,
        week,
        true
      );
      const { results } = response;
      const ok = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok);
      setExecutionsByAction((prev) => {
        const next = new Map(prev);
        for (const r of results) {
          if (r.execution) next.set(r.actionId, r.execution);
        }
        return next;
      });
      if (failed.length > 0) {
        setActionNotice(
          `Prepared ${ok}/${results.length} actions for week ${week}. ${failed.length} could not run — open those actions individually.`
        );
      } else {
        setActionNotice(
          `Prepared ${ok} actions for week ${week}. Open each action to copy deliverables or approve Shopify changes.`
        );
      }
    } catch (err) {
      setActionNotice(err instanceof Error ? err.message : 'Batch prepare failed');
    } finally {
      setBatchRunning(false);
    }
  };

  const onExecutionUpdated = (execution: ExecutionRecord) => {
    setExecutionsByAction((prev) => {
      const next = new Map(prev);
      next.set(execution.actionId, execution);
      return next;
    });
    if (execution.status === 'executed') {
      setActionNotice(`"${execution.targetLabel ?? 'Product'}" updated in Shopify. You can rollback from the action if needed.`);
    } else if (execution.status === 'rolled_back') {
      setActionNotice('Shopify SEO fields restored to their previous values.');
    }
  };

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
      setActionNotice('Could not save action completion. Try again.');
    } finally {
      setCompletionSaving(null);
    }
  };

  const onRefineSubmit = async () => {
    if (!strategy?.id || !refineText.trim()) return;
    setRefining(true);
    setRefineError(null);
    try {
      await startRefinement(strategy.id, refineText.trim());
      setRefineOpen(false);
      setRefineText('');
    } catch (err) {
      setRefineError(err instanceof Error ? err.message : 'Failed to start refinement');
    } finally {
      setRefining(false);
    }
  };

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!accessToken || !activeOrganization) return;

    if (!options?.silent && !initialLoadDone.current) {
      setLoading(true);
    }
    setError(null);

    try {
      const { strategy: record } = strategyId
        ? await getStrategy(accessToken, activeOrganization.id, strategyId)
        : await getActiveStrategy(accessToken, activeOrganization.id);

      if (record.status === 'generating' || !record.plan) {
        setStrategy(record);
        setOpenId(null);
        return record;
      }

      setStrategy(record);
      const firstAction = record.plan.weeks[0]?.actions[0];
      setOpenId(firstAction?.id ?? null);

      try {
        const [{ completedActionIds: ids }, { executions }] = await Promise.all([
          getActionCompletions(accessToken, activeOrganization.id, record.id),
          listExecutions(accessToken, activeOrganization.id, record.id),
        ]);
        setCompletedActionIds(new Set(ids));
        setExecutionsByAction(new Map(executions.map((e) => [e.actionId, e])));
      } catch {
        setCompletedActionIds(new Set());
        setExecutionsByAction(new Map());
      }

      return record;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setStrategy(null);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load plan');
      }
      return null;
    } finally {
      initialLoadDone.current = true;
      setLoading(false);
    }
  }, [accessToken, activeOrganization, strategyId]);

  useEffect(() => {
    initialLoadDone.current = false;
    void load();
  }, [load]);

  const isGenerating =
    strategy != null && strategy.status === 'generating' && strategy.plan == null;

  useEffect(() => {
    if (!isGenerating) return;

    const interval = setInterval(() => {
      void load({ silent: true });
    }, 3000);

    return () => clearInterval(interval);
  }, [isGenerating, load]);

  const plan = useMemo((): PlanDocument | null => {
    if (!strategy?.plan) return null;
    return sanitizePlanDocumentText(strategy.plan);
  }, [strategy?.plan]);

  const planSummary = plan?.summary;
  const marketIntel = plan?.marketIntel;
  const weeks = plan?.weeks;

  const channelCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    (weeks ?? []).forEach((w) =>
      w.actions.forEach((a) => {
        counts[a.channel] = (counts[a.channel] || 0) + 1;
      })
    );
    return counts;
  }, [weeks]);

  const allTasks = useMemo(
    () =>
      (weeks ?? []).flatMap((w) =>
        w.actions.map((a) => ({
          ...a,
          week: w.week,
        }))
      ),
    [weeks]
  );

  const planWeeks: PlanWeek[] = weeks ?? [];

  const totalActions = strategy?.actionCount ?? 0;

  if (loading) {
    return (
      <div className="auth-page" style={{ minHeight: '40vh' }}>
        <p className="auth-sub">Loading your plan…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="auth-page" style={{ minHeight: '40vh' }}>
        <p className="auth-error">{error}</p>
        <Button variant="primary" type="button" style={{ marginTop: 16 }} onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  if (strategy && (strategy.status === 'generating' || !strategy.plan)) {
    return (
      <>
        <div className="dash-greeting">
          <h1 className="h-display">Plan still generating</h1>
          <p className="t-dim" style={{ fontSize: 17, marginTop: 10, maxWidth: 520 }}>
            Your 8-week plan is being built on the server. This usually takes 1–3 minutes.
          </p>
        </div>
        <Link href={`/thinking?strategyId=${strategy.id}`} className="btn btn-primary btn-lg">
          View progress
        </Link>
      </>
    );
  }

  if (!strategy || !planSummary) {
    return (
      <>
        <div className="dash-greeting">
          <h1 className="h-display">No plan yet</h1>
          <p className="t-dim" style={{ fontSize: 17, marginTop: 10, maxWidth: 520 }}>
            Describe your marketing goal and we&apos;ll build an 8-week plan for your workspace.
          </p>
        </div>
        <Link href="/new" className="btn btn-primary btn-lg">
          <Icon name="plus" style={{ width: 14, height: 14 }} />
          Create your first plan
        </Link>
      </>
    );
  }

  return (
    <>
      <div className="plan-hero">
        <div>
          <div className="plan-hero-meta">
            <Chip variant="accent">
              <Icon name="sparkle" style={{ width: 11, height: 11 }} />
              {dataSourceLabel(strategy.dataSource)} ·{' '}
              {planSummary.weekCount}-week plan
            </Chip>
            <Chip>{totalActions} actions</Chip>
            <Chip variant={confidenceChip(planSummary.confidence)}>
              <Icon name="check" style={{ width: 11, height: 11 }} />
              {planSummary.confidence} confidence
            </Chip>
          </div>
          <h1 className="h-xl">Your marketing plan</h1>
          <p className="t-dim" style={{ marginTop: 6, fontSize: 14 }}>
            {planSummary.goalLine}
            <Link href="/new" className="btn-ghost" style={{ padding: 0, marginLeft: 8, color: 'var(--accent)', fontSize: 13 }}>
              Start new plan
            </Link>
          </p>
          {strategy.refinementNotes ? (
            <p className="auth-hint" style={{ marginTop: 8, marginBottom: 0, fontSize: 12, lineHeight: 1.5 }}>
              <Icon name="sparkle" style={{ width: 11, height: 11, verticalAlign: -2, marginRight: 4 }} />
              Refinement: {sanitizePlanDocumentText(strategy.refinementNotes)}
            </p>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button
            type="button"
            variant="ghost"
            disabled={generationInFlight || refining}
            onClick={() => {
              setRefineError(null);
              setRefineOpen(true);
            }}
          >
            <Icon name="edit" style={{ width: 13, height: 13 }} />
            Refine this plan
          </Button>
          <Button
            type="button"
            onClick={() =>
              setActionNotice(
                'Plan export is not available yet. Open each week in the timeline or screenshot the plan for now.'
              )
            }
          >
            <Icon name="share" style={{ width: 13, height: 13 }} />
            Export
          </Button>
          <Link href="/" className="btn btn-primary btn-lg">
            <Icon name="check" style={{ width: 14, height: 14 }} />
            Approve & start
          </Link>
        </div>
      </div>

      {refineOpen ? (
        <div
          className="card"
          style={{
            marginBottom: 24,
            padding: '18px 20px',
            border: '1px solid var(--accent)',
          }}
        >
          <div className="h-eyebrow" style={{ marginBottom: 8 }}>
            Refine this plan
          </div>
          <p className="t-dim" style={{ margin: '0 0 12px', fontSize: 13, lineHeight: 1.55 }}>
            Add brand or competitor direction — e.g. analyse a brand, emulate their social strategy,
            focus on a named competitor. Same goal and integrations; generates a new version.
          </p>
          <textarea
            className="profile-textarea auth-input"
            rows={4}
            value={refineText}
            onChange={(e) => setRefineText(e.target.value)}
            placeholder="e.g. Analyse Glossier’s Instagram — I want to emulate their content rhythm, not their pricing."
            autoFocus
          />
          {refineError ? (
            <p className="auth-error" style={{ marginTop: 10, marginBottom: 0, fontSize: 13 }}>
              {refineError}
            </p>
          ) : null}
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <Button
              variant="primary"
              type="button"
              disabled={!refineText.trim() || refining || isGenerating}
              onClick={() => void onRefineSubmit()}
            >
              {refining ? 'Starting…' : 'Regenerate with this context'}
            </Button>
            <Button
              variant="ghost"
              type="button"
              disabled={refining}
              onClick={() => {
                setRefineOpen(false);
                setRefineError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {executionModalAction && strategy?.id && accessToken && activeOrganization ? (
        <ExecutionModal
          open
          action={executionModalAction}
          strategyId={strategy.id}
          existingExecution={executionsByAction.get(executionModalAction.id) ?? null}
          accessToken={accessToken}
          organizationId={activeOrganization.id}
          onClose={() => setExecutionModalAction(null)}
          onUpdated={onExecutionUpdated}
        />
      ) : null}

      <div className="plan-summary">
        <div className="plan-summary-cell">
          <div className="label">
            <Icon name="calendar" style={{ width: 12, height: 12 }} /> Duration
          </div>
          <div className="value">
            {planSummary.duration}
            <span className="unit">{planSummary.durationUnit}</span>
          </div>
        </div>
        <div className="plan-summary-cell">
          <div className="label">
            <Icon name="clock" style={{ width: 12, height: 12 }} /> Your time
          </div>
          <div className="value">
            {planSummary.time}
            <span className="unit">{planSummary.timeUnit}</span>
          </div>
        </div>
        <div className="plan-summary-cell">
          <div className="label">
            <Icon name="bolt" style={{ width: 12, height: 12 }} /> Estimated budget
          </div>
          <div className="value">
            {planSummary.budget}
            <span className="unit">{planSummary.budgetUnit}</span>
          </div>
        </div>
        <div className="plan-summary-cell">
          <div className="label">
            <Icon name="trend" style={{ width: 12, height: 12 }} /> Projected lift
          </div>
          <div className="value">
            {planSummary.lift}
            <span className="unit">{planSummary.liftUnit}</span>
          </div>
        </div>
      </div>

      {marketIntel ? (
        <Card style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <div className="h-eyebrow">Market context</div>
            <Chip variant={marketIntel.confidence === 'medium' ? 'default' : 'warn'}>
              {marketIntel.confidence} confidence · directional
            </Chip>
          </div>
          <p style={{ margin: '0 0 16px', fontSize: 15, lineHeight: 1.55 }}>{marketIntel.headline}</p>
          {marketIntel.competitors.length > 0 ? (
            <div style={{ marginBottom: 14 }}>
              <div className="t-mono" style={{ fontSize: 11, color: 'var(--text-mute)', marginBottom: 6 }}>
                Comparables
              </div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {marketIntel.competitors.map((item) => (
                  <li key={item} style={{ marginBottom: 6, fontSize: 14, lineHeight: 1.5 }}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {marketIntel.trends.length > 0 ? (
            <div style={{ marginBottom: 14 }}>
              <div className="t-mono" style={{ fontSize: 11, color: 'var(--text-mute)', marginBottom: 6 }}>
                Trends
              </div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {marketIntel.trends.map((item) => (
                  <li key={item} style={{ marginBottom: 6, fontSize: 14, lineHeight: 1.5 }}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {marketIntel.emulateNotes.length > 0 ? (
            <div style={{ marginBottom: 14 }}>
              <div className="t-mono" style={{ fontSize: 11, color: 'var(--text-mute)', marginBottom: 6 }}>
                Emulate
              </div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {marketIntel.emulateNotes.map((item) => (
                  <li key={item} style={{ marginBottom: 6, fontSize: 14, lineHeight: 1.5 }}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="auth-hint" style={{ margin: 0, fontSize: 12, lineHeight: 1.5 }}>
            {marketIntel.disclaimer}
          </p>
        </Card>
      ) : null}

      {actionNotice ? (
        <div
          className="card"
          style={{
            marginBottom: 20,
            padding: '14px 18px',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            alignItems: 'flex-start',
          }}
        >
          <p className="auth-hint" style={{ margin: 0, lineHeight: 1.55, flex: 1 }}>
            <Icon name="info" style={{ width: 13, height: 13, verticalAlign: -2, marginRight: 6 }} />
            {actionNotice}
          </p>
          <Button variant="ghost" type="button" onClick={() => setActionNotice(null)}>
            Dismiss
          </Button>
        </div>
      ) : null}

      {strategy.dataSource === 'generic' && (
        <p className="t-dim" style={{ fontSize: 13, marginBottom: 20 }}>
          Connect Google Analytics on{' '}
          <Link href="/integrations" style={{ color: 'var(--accent)' }}>
            Integrations
          </Link>{' '}
          for a sharper, data-informed plan next time.
        </p>
      )}

      <div className="plan-tabs">
        {(
          [
            ['timeline', 'Timeline'],
            ['channels', 'By channel'],
            ['tasks', 'All tasks'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" className={`plan-tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'timeline' && (
        <div className="timeline">
          {planWeeks[0] ? (
            <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button
                variant="primary"
                type="button"
                disabled={batchRunning || !strategy?.id}
                onClick={() => void onRunWeek(planWeeks[0].week)}
              >
                {batchRunning ? 'Preparing week 1…' : 'Hundres prepare week 1'}
              </Button>
              <p className="auth-hint" style={{ margin: 0, fontSize: 12, alignSelf: 'center' }}>
                Generates deliverables for every week-1 action (Instagram, email, SEO, paid, etc.).
              </p>
            </div>
          ) : null}
          {planWeeks.map((week) => (
            <div key={week.week} className="tl-week">
              <div className="tl-week-hd">
                <div className="tl-week-tag">WEEK {String(week.week).padStart(2, '0')}</div>
                <h2 className="tl-week-title">{week.title}</h2>
                <div className="tl-week-dates">{week.dates}</div>
                <div className="tl-week-focus">{week.focus}</div>
              </div>
              <div className="tl-actions">
                {week.actions.map((a) => {
                  const ch = channelMeta(a.channel);
                  const open = openId === a.id;
                  const done = completedActionIds.has(a.id);
                  const execution = executionsByAction.get(a.id);
                  const execLabel = execution ? executionStatusLabel(execution) : null;
                  return (
                    <div key={a.id} className={`tl-action${open ? ' open' : ''}`}>
                      <div
                        className="tl-action-row"
                        onClick={() => setOpenId(open ? null : a.id)}
                        onKeyDown={(e) => e.key === 'Enter' && setOpenId(open ? null : a.id)}
                        role="button"
                        tabIndex={0}
                      >
                        <div
                          className={`checkbox${done ? ' checked' : ''}`}
                          role="checkbox"
                          aria-checked={done}
                          aria-label={done ? 'Mark action incomplete' : 'Mark action complete'}
                          onClick={(e) => {
                            e.stopPropagation();
                            void onToggleActionComplete(a.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              e.stopPropagation();
                              void onToggleActionComplete(a.id);
                            }
                          }}
                          tabIndex={0}
                          style={completionSaving === a.id ? { opacity: 0.5 } : undefined}
                        />
                        <div className="tl-action-main">
                          <div className="tl-action-title">{a.title}</div>
                          <div className="tl-action-meta">
                            <span className="tl-channel-tag" style={{ ['--ch' as string]: ch.color }}>
                              {ch.label}
                            </span>
                            <span className="dot" />
                            <span>{a.day}</span>
                            <span className="dot" />
                            <span>{a.time}</span>
                            <span className="dot" />
                            <span>{a.difficulty}</span>
                            {execLabel ? (
                              <>
                                <span className="dot" />
                                <span style={{ color: 'var(--accent)' }}>{execLabel}</span>
                              </>
                            ) : null}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span className={`tl-impact ${a.impact}`}>{impactLabel(a.impact)}</span>
                          <Icon name="caret" className="expand-caret" />
                        </div>
                      </div>
                      <div className="tl-expand">
                        <div className="tl-expand-inner">
                          <div className="tl-expand-body">
                            <div className="tl-why">
                              <div className="tl-why-label">
                                <Icon name="sparkle" style={{ width: 11, height: 11 }} />
                                WHY THIS WORKS
                              </div>
                              <div className="tl-why-body">{a.why}</div>
                            </div>
                            <div className="tl-side">
                              <div className="tl-side-item">
                                <div className="k">Channel</div>
                                <div className="v" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <Icon name={ch.icon} style={{ width: 13, height: 13, color: ch.color }} />
                                  {ch.label}
                                </div>
                              </div>
                              <div className="tl-side-item">
                                <div className="k">Outcome</div>
                                <div className="v">{a.outcome}</div>
                              </div>
                              <div className="tl-side-item">
                                <div className="k">Track</div>
                                <div className="v">{a.kpi}</div>
                              </div>
                              <Button
                                variant="primary"
                                type="button"
                                style={{ marginTop: 6, justifyContent: 'center', width: '100%' }}
                                onClick={() => onDoThisForMe(a)}
                              >
                                <Icon name="sparkle" style={{ width: 12, height: 12 }} />
                                {execution?.status === 'executed' || execution?.status === 'previewed'
                                  ? 'Open deliverable'
                                  : 'Hundres do this for me'}
                              </Button>
                              <p className="auth-hint" style={{ marginTop: 8, marginBottom: 0, fontSize: 11.5 }}>
                                AI prepares copy and steps automatically. Shopify SEO/content can auto-apply when write access is granted.
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'channels' && totalActions > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          {Object.entries(channelCounts).map(([k, n]) => {
            const ch = channelMeta(k);
            return (
              <div key={k} className="card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 0,
                      background: `${ch.color}22`,
                      color: ch.color,
                      display: 'grid',
                      placeItems: 'center',
                    }}
                  >
                    <Icon name={ch.icon} style={{ width: 16, height: 16 }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{ch.label}</div>
                    <div className="t-mono" style={{ fontSize: 11, color: 'var(--text-mute)' }}>
                      {n} ACTION{n === 1 ? '' : 'S'} · {Math.round((n / totalActions) * 100)}%
                    </div>
                  </div>
                </div>
                <div style={{ height: 4, background: 'var(--bg-elev-3)', borderRadius: 0, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(n / totalActions) * 100}%`, background: ch.color }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'tasks' && (
        <div className="card card-flush">
          {allTasks.map((a, i) => {
            const ch = channelMeta(a.channel);
            return (
              <div
                key={a.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '32px 1fr auto auto',
                  alignItems: 'center',
                  gap: 14,
                  padding: '14px 18px',
                  borderBottom: i < allTasks.length - 1 ? '1px solid var(--border)' : 0,
                }}
              >
                <div className="t-mono" style={{ fontSize: 11, color: 'var(--text-mute)' }}>
                  W{a.week}
                </div>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 450, marginBottom: 4 }}>{a.title}</div>
                  <span className="tl-channel-tag" style={{ ['--ch' as string]: ch.color }}>
                    {ch.label}
                  </span>
                </div>
                <div className="t-mono" style={{ fontSize: 11, color: 'var(--text-mute)' }}>
                  {a.time}
                </div>
                <span className={`tl-impact ${a.impact}`}>{impactLabel(a.impact)}</span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
