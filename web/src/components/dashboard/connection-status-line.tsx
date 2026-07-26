'use client';

import { useEffect, useState } from 'react';
import { getMcpStatus, type MCPStatusResponse } from '@/lib/mcp';
import type { SnapshotPreflightLine } from '@/lib/execution';
import { useAuth } from '@/providers/auth-provider';

type Props = {
  snapshots?: SnapshotPreflightLine[];
};

const PLATFORM_LABELS: Record<string, string> = {
  google_analytics: 'Analytics',
  google_ads: 'Google Ads',
  meta_ads: 'Meta Ads',
  shopify: 'Shopify',
};

function snapshotGlyph(line: SnapshotPreflightLine): string {
  if (!line.connected) return '○';
  if (line.loaded) return '✓';
  return '!';
}

export function ConnectionStatusLine({ snapshots }: Props) {
  const { accessToken, activeOrganization } = useAuth();
  const [mcpStatus, setMcpStatus] = useState<MCPStatusResponse | null>(null);

  useEffect(() => {
    if (!accessToken || !activeOrganization) return;
    void getMcpStatus(accessToken, activeOrganization.id)
      .then(setMcpStatus)
      .catch(() => setMcpStatus(null));
  }, [accessToken, activeOrganization]);

  if (snapshots?.length) {
    const parts = snapshots
      .filter((s) => s.connected || s.loaded)
      .map((s) => `${PLATFORM_LABELS[s.platform] ?? s.label} ${snapshotGlyph(s)}`);
    if (!parts.length) return null;
    return (
      <p
        className="t-mono"
        style={{
          fontSize: 11,
          color: 'var(--text-mute)',
          margin: '0 0 10px',
          lineHeight: 1.5,
          whiteSpace: 'normal',
        }}
      >
        {parts.join(' · ')}
      </p>
    );
  }

  if (!mcpStatus) return null;

  const items: string[] = [];
  if (mcpStatus.hasAnalytics) {
    const ga = mcpStatus.connected.find((c) => c.platform === 'google_analytics');
    items.push(`Analytics ${ga?.ready ? '✓' : '○'}`);
  }
  if (mcpStatus.hasMetaAds) {
    const meta = mcpStatus.connected.find((c) => c.platform === 'meta_ads');
    items.push(`Meta Ads ${meta?.ready ? '✓' : '○'}`);
  }
  if (mcpStatus.hasShopify) {
    const shop = mcpStatus.connected.find((c) => c.platform === 'shopify');
    items.push(`Shopify ${shop?.ready ? '✓' : '○'}`);
  }

  if (!items.length) return null;

  return (
    <p
      className="t-mono"
      style={{
        fontSize: 11,
        color: 'var(--text-mute)',
        margin: '0 0 10px',
        lineHeight: 1.5,
      }}
    >
      {items.join(' · ')}
    </p>
  );
}
