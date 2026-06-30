'use client';

import { Button } from '@/components/hundres/button';
import { Chip } from '@/components/hundres/chip';
import { SnapshotDataViewer } from '@/components/dashboard/snapshot-data-viewer';
import type { AutopilotPreflight } from '@/lib/execution';

type Props = {
  preflight: AutopilotPreflight;
  confirming: boolean;
  confirmed?: boolean;
  onConfirm: () => void;
  onRefresh: () => void;
};

export function AutopilotPreflightPanel({
  preflight,
  confirming,
  confirmed,
  onConfirm,
  onRefresh,
}: Props) {
  return (
    <div
      className="card"
      style={{
        marginBottom: 24,
        borderColor: 'var(--accent-dim, var(--border))',
      }}
    >
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
        <div className="h-eyebrow" style={{ margin: 0 }}>
          Live data check
        </div>
        <Chip variant={confirmed ? 'success' : 'warn'}>
          {confirmed ? 'Data confirmed' : 'Confirm to continue'}
        </Chip>
      </div>
      <p className="t-dim" style={{ fontSize: 14, margin: '0 0 16px', lineHeight: 1.55, maxWidth: 720 }}>
        {preflight.summary} Autopilot will not prepare actions until you confirm the data below looks right.
      </p>

      {preflight.weekReasoning ? (
        <div
          style={{
            marginBottom: 16,
            padding: '12px 14px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--surface-2, rgba(255,255,255,0.02))',
          }}
        >
          <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', marginBottom: 6 }}>
            How autopilot will use this data
          </div>
          <p className="t-dim" style={{ fontSize: 13, margin: 0, lineHeight: 1.55 }}>
            {preflight.weekReasoning}
          </p>
        </div>
      ) : null}

      {preflight.actionReasoning.length > 0 ? (
        <details style={{ marginBottom: 16 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 500, marginBottom: 8 }}>
            Per-action plan ({preflight.actionReasoning.length})
          </summary>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
            {preflight.actionReasoning.map((line) => (
              <li
                key={line.actionId}
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                <div style={{ fontWeight: 500, marginBottom: 4 }}>
                  {line.intent} · {line.title}
                </div>
                <span className="t-dim">{line.routing}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="h-eyebrow" style={{ marginBottom: 10 }}>
        Pulled data (what Claude sees)
      </div>

      <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
        {preflight.snapshots.map((line) => (
          <SnapshotDataViewer key={line.platform} line={line} defaultExpanded={line.loaded} />
        ))}
      </div>

      {preflight.blockedActions.length > 0 ? (
        <div style={{ marginBottom: 16 }}>
          <div className="h-eyebrow" style={{ marginBottom: 8 }}>
            Manual steps required
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 10 }}>
            {preflight.blockedActions.map((blocked) => (
              <li
                key={blocked.actionId}
                style={{
                  padding: '12px 14px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{blocked.title}</div>
                <p className="t-dim" style={{ fontSize: 12, margin: 0, lineHeight: 1.5 }}>
                  {blocked.reason}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {!confirmed ? (
          <Button variant="primary" type="button" disabled={confirming} onClick={onConfirm}>
            {confirming ? 'Preparing actions…' : 'Confirm & prepare this week'}
          </Button>
        ) : null}
        <Button variant="ghost" type="button" disabled={confirming} onClick={onRefresh}>
          Re-check data
        </Button>
      </div>
    </div>
  );
}
