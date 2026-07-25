'use client';

import type { ProgressChartCard, ProgressTrend } from '@/lib/progress-dashboard';

type Props = {
  charts: ProgressChartCard[];
  loading?: boolean;
};

const SPARKLINE_HEIGHT = 48;
const HEADER_HEIGHT = 18;
const VALUE_HEIGHT = 34;
const SUBLABEL_HEIGHT = 34;
const PROGRESS_HEIGHT = 14;

function trendLabel(trend: ProgressTrend): string {
  switch (trend) {
    case 'up':
      return 'Trending up';
    case 'down':
      return 'Trending down';
    case 'flat':
      return 'Steady';
    default:
      return 'No trend yet';
  }
}

function Sparkline({ series, color, id }: { series: number[]; color: string; id: string }) {
  if (!series.length) {
    return (
      <div
        style={{
          height: SPARKLINE_HEIGHT,
          borderRadius: 6,
          background: 'var(--border)',
          opacity: 0.35,
        }}
      />
    );
  }

  const w = 120;
  const h = SPARKLINE_HEIGHT;
  const step = series.length > 1 ? w / (series.length - 1) : w;
  const points = series
    .map((v, i) => `${i * step},${h - (v / 100) * (h - 8) - 4}`)
    .join(' ');
  const gradId = `grad-${id}`;

  return (
    <svg width="100%" height={SPARKLINE_HEIGHT} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${points} ${w},${h}`} fill={`url(#${gradId})`} />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChartCard({ card, isLast }: { card: ProgressChartCard; isLast?: boolean }) {
  const trendColor =
    card.trend === 'up' ? '#22c55e' : card.trend === 'down' ? '#ef4444' : 'var(--text-mute)';

  return (
    <div
      style={{
        padding: '14px 16px',
        borderRight: isLast ? undefined : '1px solid var(--border)',
        borderTop: `3px solid ${card.connected ? card.color : 'var(--border)'}`,
        opacity: card.connected ? 1 : 0.75,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        height: '100%',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 8,
          minHeight: HEADER_HEIGHT,
          alignItems: 'center',
        }}
      >
        <span className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', letterSpacing: '0.05em' }}>
          {card.label.toUpperCase()}
        </span>
        <span style={{ fontSize: 10, color: trendColor, fontWeight: 500, whiteSpace: 'nowrap' }}>
          {trendLabel(card.trend)}
        </span>
      </div>
      <div
        style={{
          fontSize: 26,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          minHeight: VALUE_HEIGHT,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        {card.value}
      </div>
      <p
        className="t-dim"
        style={{
          fontSize: 12,
          margin: 0,
          lineHeight: 1.4,
          minHeight: SUBLABEL_HEIGHT,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {card.sublabel ?? '\u00a0'}
      </p>
      <div style={{ height: SPARKLINE_HEIGHT, flexShrink: 0 }}>
        <Sparkline series={card.series} color={card.color} id={card.id} />
      </div>
      <div style={{ minHeight: PROGRESS_HEIGHT, marginTop: 10, flexShrink: 0 }}>
        {card.progressPct != null ? (
          <div
            style={{
              height: 4,
              borderRadius: 2,
              background: 'var(--border)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${Math.min(100, card.progressPct)}%`,
                height: '100%',
                background: card.color,
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ProgressChartsPanel({ charts, loading }: Props) {
  if (loading) {
    return (
      <div className="card" style={{ marginBottom: 16, padding: '16px' }}>
        <div className="h-eyebrow" style={{ marginBottom: 12 }}>
          Progress
        </div>
        <p className="t-dim" style={{ margin: 0, fontSize: 14 }}>
          Loading your metrics…
        </p>
      </div>
    );
  }

  if (!charts.length) return null;

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <div className="h-eyebrow" style={{ margin: 0 }}>
          Progress
        </div>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${charts.length}, minmax(0, 1fr))`,
        }}
      >
        {charts.map((card, index) => (
          <ChartCard key={card.id} card={card} isLast={index === charts.length - 1} />
        ))}
      </div>
    </div>
  );
}
