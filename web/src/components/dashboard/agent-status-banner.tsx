'use client';

import Link from 'next/link';
import { Button } from '@/components/hundres/button';
import { Chip } from '@/components/hundres/chip';
import type { AgentStatusSnapshot } from '@/lib/agent-status';

type Props = {
  status: AgentStatusSnapshot;
  busy?: boolean;
  onResume?: () => void;
  onConfirm?: (actionId: string) => void;
};

const STATUS_STYLES: Record<
  AgentStatusSnapshot['kind'],
  { border: string; bg: string; chip: 'success' | 'warn' | 'accent' }
> = {
  active: {
    border: 'rgba(99, 102, 241, 0.35)',
    bg: 'rgba(99, 102, 241, 0.06)',
    chip: 'accent',
  },
  paused: {
    border: 'rgba(234, 179, 8, 0.35)',
    bg: 'rgba(234, 179, 8, 0.06)',
    chip: 'warn',
  },
  error: {
    border: 'rgba(239, 68, 68, 0.35)',
    bg: 'rgba(239, 68, 68, 0.06)',
    chip: 'warn',
  },
};

export function AgentStatusBanner({ status, busy, onResume, onConfirm }: Props) {
  const style = STATUS_STYLES[status.kind];

  return (
    <div
      className="card"
      style={{
        marginBottom: 16,
        padding: '14px 16px',
        borderColor: style.border,
        background: style.bg,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'flex-start',
        }}
      >
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            {status.kind === 'active' && !busy ? (
              <span
                aria-hidden
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: 'var(--accent, #6366f1)',
                  flexShrink: 0,
                }}
              />
            ) : status.kind === 'active' && busy ? (
              <span className="thinking-pulse" style={{ width: 8, height: 8, flexShrink: 0 }} />
            ) : null}
            <Chip variant={style.chip}>{status.label}</Chip>
            {status.resumeLabel ? (
              <span className="t-mono" style={{ fontSize: 11, color: 'var(--text-mute)' }}>
                Next run {status.resumeLabel}
              </span>
            ) : null}
          </div>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, fontWeight: 500 }}>
            {status.reason}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {status.showLogsCta ? (
            <Link href="/activity" className="btn btn-ghost" style={{ fontSize: 12 }}>
              View logs
            </Link>
          ) : null}
          {status.showConfirmCta && status.confirmActionId && onConfirm ? (
            <Button
              variant="primary"
              type="button"
              disabled={busy}
              onClick={() => onConfirm(status.confirmActionId!)}
            >
              {busy ? 'Continuing…' : 'Mark done & continue'}
            </Button>
          ) : null}
          {status.showResumeCta && onResume ? (
            <Button variant="primary" type="button" disabled={busy} onClick={onResume}>
              {busy ? 'Loading…' : 'Load next actions'}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
