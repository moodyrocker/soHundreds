'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { getMcpStatus, type MCPStatusResponse } from '@/lib/mcp';
import type { SnapshotPreflightLine } from '@/lib/execution';
import { useAuth } from '@/providers/auth-provider';
import { formatDateTime } from '@/lib/format-datetime';

type ServiceRow = {
  id: string;
  label: string;
  connected: boolean;
  healthy: boolean;
  detail: string;
  lastSync: string | null;
};

const SERVICE_DEFS = [
  { id: 'shopify', label: 'Shopify', flag: 'hasShopify' as const, platform: 'shopify' },
  { id: 'instagram', label: 'Instagram', flag: 'hasInstagram' as const, platform: 'instagram' },
  { id: 'meta_ads', label: 'Meta Ads', flag: 'hasMetaAds' as const, platform: 'meta_ads' },
  { id: 'google_analytics', label: 'Analytics', flag: 'hasAnalytics' as const, platform: 'google_analytics' },
  { id: 'google_ads', label: 'Google Ads', flag: 'hasGoogleAds' as const, platform: 'google_ads' },
];

type Props = {
  snapshots?: SnapshotPreflightLine[];
};

function formatSync(iso: string | null): string {
  if (!iso) return 'Never synced';
  return formatDateTime(iso);
}

export function ServiceStatusPanel({ snapshots }: Props) {
  const { accessToken, activeOrganization } = useAuth();
  const [mcpStatus, setMcpStatus] = useState<MCPStatusResponse | null>(null);

  useEffect(() => {
    if (!accessToken || !activeOrganization) return;
    void getMcpStatus(accessToken, activeOrganization.id)
      .then(setMcpStatus)
      .catch(() => setMcpStatus(null));
  }, [accessToken, activeOrganization]);

  const rows = useMemo((): ServiceRow[] => {
    const snapshotByPlatform = new Map(
      (snapshots ?? []).map((s) => [s.platform, s] as const)
    );

    return SERVICE_DEFS.map((def) => {
      const conn = mcpStatus?.connected.find((c) => c.platform === def.platform);
      const igConn = mcpStatus?.connected.find(
        (c) => c.platform === 'instagram' || c.instagramUsername
      );
      const snap = snapshotByPlatform.get(def.platform);
      const connected =
        def.id === 'instagram'
          ? Boolean(mcpStatus?.hasInstagram)
          : Boolean(conn?.ready || snap?.connected || (mcpStatus?.[def.flag] && conn));
      const healthy =
        def.id === 'instagram'
          ? Boolean(mcpStatus?.hasInstagram && igConn?.ready)
          : connected && (snap ? snap.loaded && !snap.error : Boolean(conn?.ready));
      let detail = 'Not connected';
      if (connected) {
        if (snap?.error) detail = snap.error;
        else if (!healthy) detail = 'Connected — finishing setup';
        else if (def.platform === 'shopify' && conn?.shopDomain) detail = conn.shopDomain;
        else if (def.id === 'instagram' && igConn?.instagramUsername)
          detail = `@${igConn.instagramUsername}`;
        else if (def.platform === 'meta_ads' && conn?.adAccountId) detail = conn.adAccountId;
        else if (snap?.excerpt) detail = snap.excerpt.slice(0, 48);
        else detail = 'Connected';
      }

      return {
        id: def.id,
        label: def.label,
        connected,
        healthy,
        detail,
        lastSync: (def.id === 'instagram' ? igConn?.lastSyncAt : conn?.lastSyncAt) ?? null,
      };
    });
  }, [mcpStatus, snapshots]);

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
          gap: 8,
        }}
      >
        <div className="h-eyebrow" style={{ margin: 0 }}>
          Services
        </div>
        <Link href="/integrations" className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 6px' }}>
          Manage →
        </Link>
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((row) => (
          <li
            key={row.id}
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr auto',
              gap: '4px 10px',
              alignItems: 'center',
              fontSize: 12,
            }}
          >
            <span
              aria-hidden
              style={{
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: 11,
                color: row.connected ? (row.healthy ? 'var(--success, #22c55e)' : 'var(--text-mute)') : 'var(--text-faint)',
                width: 14,
              }}
            >
              {row.connected ? (row.healthy ? '✓' : '!') : '✗'}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 500 }}>{row.label}</div>
              <div className="t-dim" style={{ fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {row.detail}
              </div>
            </div>
            <span className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', whiteSpace: 'nowrap' }}>
              {row.connected ? formatSync(row.lastSync) : '—'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
