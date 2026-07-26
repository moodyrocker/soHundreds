'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/hundres/button';
import { Icon } from '@/components/hundres/icon';
import { getMcpStatus, getSnapshotHealth } from '@/lib/mcp';
import { buildThinkingSteps } from '@/lib/thinking-pipeline';
import { getStrategy } from '@/lib/strategy';
import { pendingForOrganization } from '@/lib/strategy-generation-storage';
import { useAppPreferences } from '@/providers/app-preferences-provider';
import { useAuth } from '@/providers/auth-provider';
import { useGoal } from '@/providers/goal-provider';
import { useStrategyGeneration } from '@/providers/strategy-generation-provider';

export function ThinkingSequence() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { tone } = useAppPreferences();
  const { accessToken, activeOrganization } = useAuth();
  const { goal: contextGoal, setGoal } = useGoal();
  const {
    pending,
    error: generationError,
    completedId,
    startGeneration,
    resumePolling,
    clearError,
    clearCompleted,
  } = useStrategyGeneration();

  const goalFromUrl = searchParams.get('goal');
  const strategyIdFromUrl = searchParams.get('strategyId');
  const goalText = (pending?.goal ?? goalFromUrl ?? contextGoal).trim();

  const [analyticsReady, setAnalyticsReady] = useState(false);
  const [googleAdsReady, setGoogleAdsReady] = useState(false);
  const [metaAdsReady, setMetaAdsReady] = useState(false);
  const [shopifyReady, setShopifyReady] = useState(false);
  const [analyticsLoaded, setAnalyticsLoaded] = useState(false);
  const [googleAdsLoaded, setGoogleAdsLoaded] = useState(false);
  const [metaAdsLoaded, setMetaAdsLoaded] = useState(false);
  const [shopifyLoaded, setShopifyLoaded] = useState(false);
  const [current, setCurrent] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);
  const initDone = useRef(false);

  const strategyId = pending?.strategyId ?? strategyIdFromUrl;
  const error = generationError ?? localError;

  const steps = useMemo(
    () =>
      buildThinkingSteps(goalText, tone, {
        analyticsReady,
        googleAdsReady,
        metaAdsReady,
        shopifyReady,
        analyticsLoaded,
        googleAdsLoaded,
        metaAdsLoaded,
        shopifyLoaded,
        orgName: activeOrganization?.name,
      }),
    [
      goalText,
      tone,
      analyticsReady,
      googleAdsReady,
      metaAdsReady,
      shopifyReady,
      analyticsLoaded,
      googleAdsLoaded,
      metaAdsLoaded,
      shopifyLoaded,
      activeOrganization?.name,
    ]
  );

  useEffect(() => {
    if (goalFromUrl) setGoal(goalFromUrl);
  }, [goalFromUrl, setGoal]);

  useEffect(() => {
    if (!goalText && !strategyIdFromUrl && !pending) {
      router.replace('/new');
    }
  }, [goalText, strategyIdFromUrl, pending, router]);

  useEffect(() => {
    if (!accessToken || !activeOrganization) return;
    void getMcpStatus(accessToken, activeOrganization.id)
      .then((status) => {
        const ga = status.connected.find((c) => c.platform === 'google_analytics');
        const ads = status.connected.find((c) => c.platform === 'google_ads');
        const meta = status.connected.find((c) => c.platform === 'meta_ads');
        const shop = status.connected.find((c) => c.platform === 'shopify');
        setAnalyticsReady(Boolean(ga?.ready));
        setGoogleAdsReady(Boolean(ads?.ready));
        setMetaAdsReady(Boolean(meta?.ready));
        setShopifyReady(Boolean(shop?.ready));
      })
      .catch(() => {
        setAnalyticsReady(false);
        setGoogleAdsReady(false);
        setMetaAdsReady(false);
        setShopifyReady(false);
      });
  }, [accessToken, activeOrganization]);

  useEffect(() => {
    if (!accessToken || !activeOrganization) return;
    void getSnapshotHealth(accessToken, activeOrganization.id)
      .then(({ platforms }) => {
        const ga = platforms.find((p) => p.platform === 'google_analytics');
        const ads = platforms.find((p) => p.platform === 'google_ads');
        const meta = platforms.find((p) => p.platform === 'meta_ads');
        const shop = platforms.find((p) => p.platform === 'shopify');
        setAnalyticsLoaded(Boolean(ga?.dataAvailable));
        setGoogleAdsLoaded(Boolean(ads?.dataAvailable));
        setMetaAdsLoaded(Boolean(meta?.dataAvailable));
        setShopifyLoaded(Boolean(shop?.dataAvailable));
      })
      .catch(() => {
        setAnalyticsLoaded(false);
        setGoogleAdsLoaded(false);
        setMetaAdsLoaded(false);
        setShopifyLoaded(false);
      });
  }, [accessToken, activeOrganization]);

  useEffect(() => {
    if (!accessToken || !activeOrganization || initDone.current) return;

    if (pending) {
      initDone.current = true;
      if (strategyIdFromUrl && strategyIdFromUrl !== pending.strategyId) {
        router.replace(`/thinking?strategyId=${pending.strategyId}`);
      } else if (!strategyIdFromUrl) {
        router.replace(`/thinking?strategyId=${pending.strategyId}`);
      }
      return;
    }

    const stored = pendingForOrganization(activeOrganization.id);
    const resumeId = strategyIdFromUrl ?? stored?.strategyId;
    const resumeGoal = stored?.goal ?? goalText;

    if (resumeId && resumeGoal) {
      initDone.current = true;
      resumePolling(resumeId, resumeGoal);
      if (!strategyIdFromUrl) {
        router.replace(`/thinking?strategyId=${resumeId}`);
      }
      return;
    }

    if (!goalText) return;

    initDone.current = true;
    setLocalError(null);
    clearError();

    void startGeneration(goalText).catch((err) => {
      initDone.current = false;
      setLocalError(err instanceof Error ? err.message : 'Failed to start plan generation');
    });
  }, [
    accessToken,
    activeOrganization,
    goalText,
    strategyIdFromUrl,
    pending,
    resumePolling,
    router,
    startGeneration,
    clearError,
  ]);

  useEffect(() => {
    if (!completedId) return;
    setCurrent(steps.length - 1);
    const t = setTimeout(() => {
      router.replace('/');
      clearCompleted();
    }, 600);
    return () => clearTimeout(t);
  }, [completedId, router, steps.length, clearCompleted]);

  useEffect(() => {
    if (!accessToken || !activeOrganization || !strategyId || pending) return;

    void getStrategy(accessToken, activeOrganization.id, strategyId).then(({ strategy }) => {
      if (strategy.status === 'active' && strategy.plan) {
        router.replace('/');
      }
    });
  }, [accessToken, activeOrganization, strategyId, pending, router]);

  useEffect(() => {
    if (error || completedId) return;
    if (current >= steps.length - 2) return;

    const t = setTimeout(() => setCurrent((c) => Math.min(c + 1, steps.length - 2)), 2800);
    return () => clearTimeout(t);
  }, [current, error, completedId, steps.length]);

  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 0.1), 100);
    return () => clearInterval(t);
  }, []);

  if (!goalText && !strategyId) {
    return null;
  }

  if (!accessToken || !activeOrganization) {
    return (
      <div className="thinking-page">
        <p className="auth-error">Sign in and set up a workspace before generating a plan.</p>
        <Link href="/login" className="btn btn-primary" style={{ marginTop: 16 }}>
          Sign in
        </Link>
      </div>
    );
  }

  const statusLabel = completedId
    ? 'Plan saved — opening…'
    : error
      ? 'Generation failed'
      : current >= 2
        ? 'Calling Claude API (this may take 1–3 min)…'
        : analyticsLoaded || googleAdsLoaded || metaAdsLoaded || shopifyLoaded
          ? 'Loading your connected data…'
          : 'Preparing your plan…';

  return (
    <div className="thinking-page">
      <div className="thinking-goalcard">
        <Icon name="target" style={{ width: 22, height: 22, color: 'var(--accent)', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="label">YOUR GOAL</div>
          <div
            style={{
              fontSize: 14.5,
              color: 'var(--text)',
              lineHeight: 1.45,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {goalText}
          </div>
        </div>
        <Link href="/new" className="btn btn-ghost" style={{ height: 28, fontSize: 12, flexShrink: 0 }}>
          <Icon name="edit" style={{ width: 12, height: 12 }} />
          Edit
        </Link>
      </div>

      <p className="t-dim" style={{ fontSize: 13, marginBottom: 20, lineHeight: 1.5 }}>
        Generation runs on the server. You can leave this page or refresh — we&apos;ll keep working and
        pick up where we left off.
        {strategyId ? (
          <>
            {' '}
            <span className="t-mono" style={{ fontSize: 11 }}>
              Job {strategyId.slice(0, 8)}…
            </span>
          </>
        ) : null}
      </p>

      {error ? (
        <div style={{ marginBottom: 24 }}>
          <p className="auth-error">{error}</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Button
              variant="primary"
              type="button"
              onClick={() => {
                initDone.current = false;
                setLocalError(null);
                clearError();
                if (goalText) void startGeneration(goalText);
              }}
            >
              Try again
            </Button>
            <Link href="/new" className="btn btn-ghost">
              Start new plan
            </Link>
          </div>
        </div>
      ) : null}

      <div className="thinking-status">
        <div className="thinking-pulse" />
        <div className="thinking-status-text">
          <strong>{statusLabel}</strong>
          <span className="thinking-cursor" />
        </div>
        <div className="timer">{elapsed.toFixed(1)}s</div>
      </div>

      <div className="steps">
        {steps.map((s, i) => {
          const state = i < current ? 'done' : i === current ? 'active' : 'pending';
          return (
            <div key={s.title} className={`step show ${state}`}>
              <div className="step-title">{s.line}</div>
              <div className="step-detail">
                {s.details.map(([key, val]) => (
                  <div key={key} className="row">
                    <span className="key">{key}</span>
                    <span style={{ margin: '0 8px', color: 'var(--text-faint)' }}>—</span>
                    <span>{val}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 40, display: 'flex', justifyContent: 'center', gap: 10 }}>
        <Link href="/" className="btn btn-ghost">
          Browse while waiting
        </Link>
        {completedId ? (
          <Button variant="primary" onClick={() => router.replace('/')}>
            Back to autopilot →
          </Button>
        ) : null}
      </div>
    </div>
  );
}
