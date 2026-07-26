'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/hundres/button';
import { Card } from '@/components/hundres/card';
import { Chip } from '@/components/hundres/chip';
import { Icon } from '@/components/hundres/icon';
import { ApiError } from '@/lib/api';
import {
  getCheckupHistory,
  getLatestCheckup,
  HEALTH_LABELS,
  runCheckup,
  SOURCE_LABELS,
  type CheckupRecord,
} from '@/lib/checkup';
import { dataSourceLabel, type StrategyDataSource } from '@/lib/plan-types';
import { useAuth } from '@/providers/auth-provider';
import { formatDateTime } from '@/lib/format-datetime';

function healthChipVariant(
  health: CheckupRecord['report']['overallHealth']
): 'success' | 'warn' | 'default' {
  if (health === 'good') return 'success';
  if (health === 'fair' || health === 'weak') return 'warn';
  return 'default';
}

export function CheckupView() {
  const { accessToken, activeOrganization } = useAuth();
  const [active, setActive] = useState<CheckupRecord | null>(null);
  const [history, setHistory] = useState<CheckupRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken || !activeOrganization) return;
    setLoading(true);
    setError(null);
    try {
      const [latestRes, historyRes] = await Promise.all([
        getLatestCheckup(accessToken, activeOrganization.id).catch((err) => {
          if (err instanceof ApiError && err.status === 404) return null;
          throw err;
        }),
        getCheckupHistory(accessToken, activeOrganization.id, 8),
      ]);
      if (latestRes) setActive(latestRes.checkup);
      else setActive(historyRes.checkups[0] ?? null);
      setHistory(historyRes.checkups);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load check-up');
    } finally {
      setLoading(false);
    }
  }, [accessToken, activeOrganization]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRun = async () => {
    if (!accessToken || !activeOrganization) return;
    setRunning(true);
    setError(null);
    try {
      const { checkup } = await runCheckup(accessToken, activeOrganization.id);
      setActive(checkup);
      const { checkups } = await getCheckupHistory(accessToken, activeOrganization.id, 8);
      setHistory(checkups);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check-up failed');
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="auth-page" style={{ minHeight: '40vh' }}>
        <p className="auth-sub">Loading check-up…</p>
      </div>
    );
  }

  const report = active?.report;

  return (
    <>
      <div className="dash-greeting">
        <div>
          <div className="h-eyebrow" style={{ marginBottom: 12 }}>
            Assessment
          </div>
          <h1 className="h-display">Marketing check-up</h1>
          <p className="t-dim" style={{ fontSize: 17, marginTop: 10, maxWidth: 560 }}>
            A snapshot of what&apos;s working, what&apos;s weak, and what to fix first — from your
            connected data. Run again anytime to track progress.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <Button variant="primary" type="button" disabled={running} onClick={() => void onRun()}>
            <Icon name="sparkle" style={{ width: 14, height: 14 }} />
            {running ? 'Running…' : active ? 'Run again' : 'Run check-up'}
          </Button>
        </div>
      </div>

      {error ? <p className="auth-error" style={{ marginBottom: 16 }}>{error}</p> : null}

      {running ? (
        <Card style={{ marginBottom: 24 }}>
          <p className="t-dim" style={{ margin: 0, lineHeight: 1.55 }}>
            Loading snapshots from GA, Ads, and Meta, then writing your report… usually 30–60
            seconds.
          </p>
        </Card>
      ) : null}

      {!report && !running ? (
        <Card>
          <p style={{ margin: '0 0 16px', lineHeight: 1.55 }}>
            No check-up yet. Connect integrations, then run your first snapshot.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link href="/integrations" className="btn">
              Integrations
            </Link>
            <Button variant="primary" type="button" onClick={() => void onRun()}>
              Run check-up
            </Button>
          </div>
        </Card>
      ) : null}

      {report && active && !running ? (
        <>
          <Card style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              <Chip variant={healthChipVariant(report.overallHealth)}>
                {HEALTH_LABELS[report.overallHealth]}
              </Chip>
              <Chip variant={report.confidence === 'high' ? 'success' : 'default'}>
                {report.confidence} confidence
              </Chip>
              <Chip variant="accent">
                {dataSourceLabel(active.dataSource as StrategyDataSource)}
              </Chip>
              <Chip>{formatDateTime(active.createdAt)}</Chip>
            </div>
            <h2 className="h-md" style={{ marginBottom: 10 }}>
              {report.headline}
            </h2>
            <p className="t-dim" style={{ margin: 0, lineHeight: 1.6, fontSize: 15 }}>
              {report.summary}
            </p>
          </Card>

          {report.liveMetrics.length > 0 ? (
            <div className="plan-summary" style={{ marginBottom: 24 }}>
              {report.liveMetrics.map((m) => (
                <div key={`${m.source}-${m.label}`} className="plan-summary-cell">
                  <div className="label">{SOURCE_LABELS[m.source] ?? m.source}</div>
                  <div className="value" style={{ fontSize: 22 }}>
                    {m.value}
                  </div>
                  <div className="unit" style={{ marginTop: 4 }}>
                    {m.label}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <Card style={{ marginBottom: 24 }}>
            <div className="h-eyebrow" style={{ marginBottom: 12 }}>
              Data coverage
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {report.dataCoverage.map((row) => (
                <div
                  key={row.source}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    alignItems: 'flex-start',
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <strong style={{ fontSize: 14 }}>{SOURCE_LABELS[row.source]}</strong>
                    <div className="t-mono" style={{ fontSize: 11, color: 'var(--text-mute)', marginTop: 4 }}>
                      {row.connected ? (row.loaded ? 'Connected · data OK' : 'Connected · data error') : 'Not connected'}
                    </div>
                    {row.note ? (
                      <p className="auth-hint" style={{ margin: '6px 0 0', fontSize: 12 }}>
                        {row.note}
                      </p>
                    ) : null}
                  </div>
                  <Chip variant={row.loaded ? 'success' : row.connected ? 'warn' : 'default'}>
                    {row.loaded ? 'Live' : row.connected ? 'Error' : 'Off'}
                  </Chip>
                </div>
              ))}
            </div>
          </Card>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 16,
              marginBottom: 24,
            }}
          >
            <InsightList title="What's working" items={report.whatsWorking} tone="success" />
            <InsightList title="What's weak" items={report.whatsWeak} tone="warn" />
            <InsightList title="What's missing" items={report.whatsMissing} tone="default" />
          </div>

          <Card style={{ marginBottom: 24 }}>
            <div className="h-eyebrow" style={{ marginBottom: 16 }}>
              Top priorities
            </div>
            <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
              {report.topPriorities.map((p) => (
                <li key={p.title} style={{ lineHeight: 1.55 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 15 }}>{p.title}</strong>
                    <Chip variant={p.impact === 'high' ? 'accent' : 'default'}>
                      {p.impact === 'high' ? 'High impact' : p.impact === 'med' ? 'Medium' : 'Low'}
                    </Chip>
                  </div>
                  <p className="t-dim" style={{ margin: 0, fontSize: 14 }}>
                    {p.why}
                  </p>
                </li>
              ))}
            </ol>
            <div style={{ marginTop: 20, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Link href="/new" className="btn btn-primary">
                Turn into 8-week plan
              </Link>
              <Link href="/integrations" className="btn btn-ghost">
                Integrations
              </Link>
            </div>
          </Card>
        </>
      ) : null}

      {history.length > 1 ? (
        <Card>
          <div className="h-eyebrow" style={{ marginBottom: 12 }}>
            Past check-ups
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {history.map((item, i) => (
              <li
                key={item.id}
                style={{
                  padding: '12px 0',
                  borderTop: i > 0 ? '1px solid var(--border)' : undefined,
                }}
              >
                <button
                  type="button"
                  className="btn-ghost"
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: 0,
                    border: 0,
                    background: 'none',
                    cursor: 'pointer',
                    color: item.id === active?.id ? 'var(--accent)' : 'var(--text)',
                  }}
                  onClick={() => setActive(item)}
                >
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{item.report.headline}</div>
                  <div className="t-mono" style={{ fontSize: 11, color: 'var(--text-mute)', marginTop: 4 }}>
                    {formatDateTime(item.createdAt)} · {HEALTH_LABELS[item.report.overallHealth]}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}

function InsightList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: 'success' | 'warn' | 'default';
}) {
  if (items.length === 0) return null;
  const border =
    tone === 'success'
      ? 'var(--accent)'
      : tone === 'warn'
        ? 'var(--warn, #c9a227)'
        : 'var(--border)';
  return (
    <Card>
      <div className="h-eyebrow" style={{ marginBottom: 12 }}>
        {title}
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, borderLeft: `3px solid ${border}` }}>
        {items.map((item) => (
          <li key={item} style={{ marginBottom: 10, lineHeight: 1.5, fontSize: 14 }}>
            {item}
          </li>
        ))}
      </ul>
    </Card>
  );
}
