'use client';

import Link from 'next/link';
import { Icon } from '@/components/hundres/icon';
import { useStrategyGenerationOptional } from '@/providers/strategy-generation-provider';

export function GenerationBanner() {
  const gen = useStrategyGenerationOptional();
  if (!gen?.isGenerating || !gen.pending) return null;

  return (
    <Link href={`/thinking?strategyId=${gen.pending.strategyId}`} className="generation-banner">
      <Icon name="sparkle" style={{ width: 14, height: 14, flexShrink: 0 }} />
      <span>
        Building your plan… <em style={{ fontStyle: 'normal', opacity: 0.85 }}>View progress</em>
      </span>
    </Link>
  );
}
