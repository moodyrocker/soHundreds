'use client';

import { useState } from 'react';
import { Chip } from '@/components/hundres/chip';
import { SnapshotDataViewer } from '@/components/dashboard/snapshot-data-viewer';
import type { AutopilotActivityRecord } from '@/lib/autopilot-activity';
import type { SnapshotPreflightLine } from '@/lib/execution';

type Props = {
  activities: AutopilotActivityRecord[];
  running: boolean;
  snapshots?: SnapshotPreflightLine[];
};

function statusVariant(status: AutopilotActivityRecord['status']) {
  if (status === 'success') return 'success' as const;
  if (status === 'error') return 'warn' as const;
  if (status === 'running') return 'accent' as const;
  if (status === 'warn') return 'warn' as const;
  return 'default' as const;
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

function isReasoningStep(step: string) {
  return (
    step === 'decision' ||
    step === 'ai_reasoning' ||
    step === 'action_plan' ||
    step === 'week_reasoning' ||
    step === 'blocked'
  );
}

function stepLabel(step: string) {
  if (step === 'ai_reasoning') return 'reasoning';
  if (step === 'week_reasoning') return 'week plan';
  if (step === 'action_plan') return 'action plan';
  return step.replace(/_/g, ' ');
}

export function AutopilotActivityPanel({ activities, running, snapshots }: Props) {
  const [expandedDataId, setExpandedDataId] = useState<string | null>(null);

  const snapshotForActivity = (item: AutopilotActivityRecord): SnapshotPreflightLine | null => {
    if (item.step !== 'data_pull' || !snapshots?.length) return null;
    const label = item.title.split(' — ')[0]?.trim();
    return snapshots.find((s) => s.label === label) ?? null;
  };

  return (
    <div
      className="card"
      style={{
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 320,
        maxHeight: 640,
      }}
    >
      <div
        style={{
          padding: '12px 14px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <div className="h-eyebrow" style={{ margin: 0 }}>
          Live activity
        </div>
        {running ? (
          <>
            <div className="thinking-pulse" style={{ width: 8, height: 8 }} />
            <Chip variant="accent">Running</Chip>
          </>
        ) : null}
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 0',
        }}
      >
        {activities.length === 0 ? (
          <p className="t-dim" style={{ fontSize: 13, margin: 0, padding: '12px 14px', lineHeight: 1.5 }}>
            {running
              ? 'Autopilot is starting…'
              : 'Run autopilot to see reasoning and decisions here.'}
          </p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {activities.map((item) => {
              const snapshotLine = snapshotForActivity(item);
              const showFullData = expandedDataId === item.id && snapshotLine?.text;

              return (
              <li
                key={item.id}
                style={{
                  padding: '10px 14px',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 4 }}>
                  <Chip
                    variant={statusVariant(item.status)}
                    style={{
                      flexShrink: 0,
                      ...(isReasoningStep(item.step)
                        ? { borderColor: 'var(--accent-dim, var(--border))' }
                        : {}),
                    }}
                  >
                    {stepLabel(item.step)}
                  </Chip>
                  <span className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', marginLeft: 'auto' }}>
                    {formatTime(item.createdAt)}
                  </span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.4, marginBottom: 4 }}>
                  {item.title}
                </div>
                <p className="t-dim" style={{ fontSize: 12, margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                  {item.detail}
                </p>
                {snapshotLine?.text ? (
                  <div style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 11, padding: '2px 0', color: 'var(--accent)' }}
                      onClick={() =>
                        setExpandedDataId(showFullData ? null : item.id)
                      }
                    >
                      {showFullData ? 'Hide full snapshot' : 'Show full snapshot'}
                    </button>
                    {showFullData ? (
                      <div style={{ marginTop: 8 }}>
                        <SnapshotDataViewer line={snapshotLine} defaultExpanded compact />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
