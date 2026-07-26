'use client';

type Props = {
  routing?: string | null;
  ai?: string | null;
  compact?: boolean;
};

export function ReasoningBlock({ routing, ai, compact }: Props) {
  if (!routing && !ai) return null;

  return (
    <div
      style={{
        marginTop: compact ? 8 : 10,
        padding: compact ? '8px 10px' : '10px 12px',
        borderRadius: 8,
        border: '1px solid var(--border)',
        background: 'var(--surface-2, rgba(255,255,255,0.02))',
      }}
    >
      <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', marginBottom: 6 }}>
        AI reasoning
      </div>
      {routing ? (
        <p className="t-dim" style={{ fontSize: 12, margin: '0 0 6px', lineHeight: 1.5 }}>
          <strong style={{ color: 'var(--text)', fontWeight: 500 }}>Route · </strong>
          {routing}
        </p>
      ) : null}
      {ai ? (
        <p className="t-dim" style={{ fontSize: 12, margin: 0, lineHeight: 1.5 }}>
          <strong style={{ color: 'var(--text)', fontWeight: 500 }}>Draft · </strong>
          {ai}
        </p>
      ) : null}
    </div>
  );
}
