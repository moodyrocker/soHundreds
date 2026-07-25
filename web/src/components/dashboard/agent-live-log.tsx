'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef } from 'react';
import { Chip } from '@/components/hundres/chip';
import type { AutopilotActivityRecord } from '@/lib/autopilot-activity';
import { dedupeActivities, humanActivityLine, isTerminalActivityStep } from '@/lib/activity-human';
import { formatDateTime } from '@/lib/format-datetime';

type Props = {
  activities: AutopilotActivityRecord[];
  running: boolean;
  strategyId?: string;
  actionIdToExecutionId?: Map<string, string>;
};

export function AgentLiveLog({ activities, running, strategyId, actionIdToExecutionId }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => dedupeActivities(activities), [activities]);

  const runFinished =
    !running &&
    lines.length > 0 &&
    lines.some((l) => isTerminalActivityStep(l.step) && l.status !== 'running');

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [lines.length, running]);

  if (!running && lines.length === 0) return null;

  return (
    <div
      className="card"
      style={{
        marginBottom: 16,
        padding: 0,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <div className="h-eyebrow" style={{ margin: 0 }}>
          Agent log
        </div>
        {running ? (
          <>
            <span className="thinking-pulse" style={{ width: 8, height: 8 }} />
            <Chip variant="accent">Running</Chip>
          </>
        ) : runFinished ? (
          <Chip variant="success">Complete</Chip>
        ) : null}
      </div>

      <div
        ref={scrollRef}
        style={{
          maxHeight: 280,
          overflowY: 'auto',
          padding: '10px 14px',
          fontFamily: 'var(--font-mono, ui-monospace, monospace)',
          fontSize: 12,
          lineHeight: 1.6,
        }}
      >
        {lines.length === 0 && running ? (
          <p className="t-dim" style={{ margin: 0, fontFamily: 'inherit' }}>
            Starting…
          </p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {lines.map((item) => (
              <li
                key={item.id}
                style={{
                  marginBottom: 6,
                  color:
                    item.status === 'error'
                      ? 'var(--danger, #ef4444)'
                      : item.status === 'success'
                        ? 'var(--success, #22c55e)'
                        : 'var(--text-dim)',
                }}
              >
                <span style={{ color: 'var(--text-mute)', marginRight: 8 }}>{formatDateTime(item.createdAt)}</span>
                {humanActivityLine(item)}
              </li>
            ))}
          </ul>
        )}

        {runFinished && strategyId ? (
          <div style={{ marginTop: 12, fontFamily: 'inherit' }}>
            <Link href="/activity" className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 0' }}>
              View full activity history →
            </Link>
            {actionIdToExecutionId && actionIdToExecutionId.size > 0 ? (
              <span className="t-dim" style={{ fontSize: 11, marginLeft: 8 }}>
                · Expand any action below for its outcome
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
