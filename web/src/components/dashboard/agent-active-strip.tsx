'use client';

import { Chip } from '@/components/hundres/chip';
import type { AutopilotActivityRecord } from '@/lib/autopilot-activity';

type Props = {
  runningActionTitle: string | null;
  latestActivity: AutopilotActivityRecord | null;
  batchRunning: boolean;
};

/** Shown only while the agent is mid-execution on a real action (#4). */
export function AgentActiveStrip({
  runningActionTitle,
  latestActivity,
  batchRunning,
}: Props) {
  const statusTitle = runningActionTitle
    ? `Running: ${runningActionTitle}`
    : latestActivity?.status === 'running' && latestActivity.actionId
      ? latestActivity.title
      : batchRunning
        ? 'Agent preparing this week…'
        : null;

  if (!statusTitle) return null;

  const statusDetail =
    runningActionTitle
      ? 'Creating your deliverable — see Activity log for full history.'
      : latestActivity?.status === 'running'
        ? latestActivity.detail
        : null;

  return (
    <div
      style={{
        marginBottom: 16,
        padding: '10px 14px',
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
  );
}
