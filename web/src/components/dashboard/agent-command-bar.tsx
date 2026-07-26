'use client';

import { Button } from '@/components/hundres/button';
import { Chip } from '@/components/hundres/chip';
import type { AutopilotActivityRecord } from '@/lib/autopilot-activity';

type Props = {
  busy: boolean;
  batchRunning: boolean;
  runningActionTitle: string | null;
  latestActivity: AutopilotActivityRecord | null;
  hasPreflight: boolean;
  preflightConfirmed: boolean;
  onStartAgent: () => void;
  onPrepareAll: () => void;
  onRunWeek: () => void;
};

export function AgentCommandBar({
  busy,
  batchRunning,
  runningActionTitle,
  latestActivity,
  hasPreflight,
  preflightConfirmed,
  onStartAgent,
  onPrepareAll,
  onRunWeek,
}: Props) {
  const statusTitle = runningActionTitle
    ? `Running: ${runningActionTitle}`
    : latestActivity?.status === 'running'
      ? latestActivity.title
      : batchRunning
        ? 'Agent preparing this week…'
        : null;

  const statusDetail =
    !runningActionTitle && latestActivity?.status === 'running'
      ? latestActivity.detail
      : runningActionTitle
        ? 'Claude is generating your deliverable — watch Live activity for progress.'
        : null;

  return (
    <div
      className="agent-command-bar"
      style={{
        marginBottom: 16,
        padding: '14px 16px',
        borderRadius: 10,
        border: '1px solid var(--border)',
        background: 'rgba(255, 255, 255, 0.04)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          marginBottom: statusTitle ? 12 : 0,
        }}
      >
        <div style={{ flex: 1, minWidth: 200 }}>
          <div className="h-eyebrow" style={{ marginBottom: 6 }}>
            AI agent
          </div>
          <p className="t-dim" style={{ margin: 0, fontSize: 13, lineHeight: 1.5, maxWidth: 520 }}>
            The agent drafts and creates paused ad campaigns, Shopify pages, and SEO updates when integrations are connected.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button variant="primary" type="button" disabled={busy} onClick={onStartAgent}>
            {batchRunning ? 'Agent running…' : hasPreflight ? 'Re-check data' : '1. Check data'}
          </Button>
          {hasPreflight && !preflightConfirmed ? (
            <Button variant="primary" type="button" disabled={busy} onClick={onPrepareAll}>
              {batchRunning ? 'Preparing…' : '2. Prepare all actions'}
            </Button>
          ) : null}
          <Button variant="ghost" type="button" disabled={busy} onClick={onRunWeek}>
            Run agent for this week
          </Button>
        </div>
      </div>

      {statusTitle ? (
        <div
          style={{
            padding: '10px 12px',
            borderRadius: 8,
            background: 'rgba(99, 102, 241, 0.08)',
            border: '1px solid rgba(99, 102, 241, 0.25)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: statusDetail ? 6 : 0 }}>
            <div className="thinking-pulse" style={{ width: 8, height: 8, flexShrink: 0 }} />
            <Chip variant="accent">Agent active</Chip>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{statusTitle}</span>
          </div>
          {statusDetail ? (
            <p className="t-dim" style={{ margin: 0, fontSize: 12, lineHeight: 1.5, paddingLeft: 16 }}>
              {statusDetail}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
