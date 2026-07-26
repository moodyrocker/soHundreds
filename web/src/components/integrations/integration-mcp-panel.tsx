'use client';

import { Chip } from '@/components/hundres/chip';
import type { McpServerStatus, McpTier } from '@/lib/mcp';

const TIER_LABEL: Record<McpTier, string> = {
  analytical_core: 'Analytical core',
  commerce: 'Commerce',
  actuation: 'Actuation',
};

type Props = {
  server: McpServerStatus | null | undefined;
  compact?: boolean;
};

export function IntegrationMcpBadge({ server, compact }: Props) {
  if (!server) return null;

  if (!server.connectionReady) {
    return compact ? null : (
      <Chip variant="default">MCP · not connected</Chip>
    );
  }

  const ok = server.snapshotOk && server.bridgeOk;
  const variant = ok ? 'success' : server.snapshotOk || server.bridgeOk ? 'warn' : 'warn';

  return (
    <Chip variant={variant}>
      MCP · {server.serverName}
      {ok ? '' : ' · check'}
    </Chip>
  );
}

type PanelProps = {
  servers: McpServerStatus[];
  analyticalCore: string[];
  loading: boolean;
};

export function McpServersPanel({ servers, analyticalCore, loading }: PanelProps) {
  if (loading) {
    return (
      <div className="card" style={{ marginBottom: 24, padding: 20 }}>
        <div className="h-eyebrow" style={{ marginBottom: 8 }}>
          MCP servers
        </div>
        <p className="t-dim" style={{ margin: 0, fontSize: 14 }}>
          Checking MCP bridges…
        </p>
      </div>
    );
  }

  const coreServers = servers.filter((s) => analyticalCore.includes(s.platform));
  const otherServers = servers.filter((s) => !analyticalCore.includes(s.platform));
  const readyCount = servers.filter((s) => s.connectionReady && s.snapshotOk && s.bridgeOk).length;

  return (
    <div className="card" style={{ marginBottom: 24, padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <div className="h-eyebrow" style={{ marginBottom: 8 }}>
            MCP servers
          </div>
          <p className="t-dim" style={{ margin: 0, fontSize: 14, lineHeight: 1.55, maxWidth: 560 }}>
            Hundres connects Claude to your data through MCP bridges.{' '}
            <strong style={{ fontWeight: 500, color: 'var(--text)' }}>
              Analytical core
            </strong>{' '}
            (GA, Google Ads, Meta) drives plans first; Shopify adds store context and gated writes;
            Unsplash supplies stock photos for blog and page content.
            {' '}
            Use <strong style={{ fontWeight: 500, color: 'var(--text)' }}>Reconnect</strong> in each
            section below to refresh OAuth permissions (e.g. grant your Facebook Page for Meta ads).
          </p>
        </div>
        <Chip variant={readyCount > 0 ? 'success' : 'default'}>
          {readyCount} / {servers.length} MCP ready
        </Chip>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div className="auth-hint" style={{ marginBottom: 8, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Analytical core
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          {coreServers.map((s) => (
            <McpServerRow key={s.platform} server={s} />
          ))}
        </div>
      </div>

      {otherServers.length > 0 ? (
        <div>
          <div className="auth-hint" style={{ marginBottom: 8, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Commerce &amp; actuation
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {otherServers.map((s) => (
              <McpServerRow key={s.platform} server={s} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function McpServerRow({ server }: { server: McpServerStatus }) {
  const tierLabel = TIER_LABEL[server.tier];
  const ready = server.connectionReady;
  const healthy = ready && server.snapshotOk && server.bridgeOk;

  return (
    <div
      style={{
        padding: '12px 14px',
        borderRadius: 8,
        border: '1px solid var(--border)',
        background: 'var(--surface-2, transparent)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>{server.label}</span>
            <span className="auth-hint" style={{ margin: 0, fontSize: 11 }}>
              {tierLabel}
            </span>
            <Chip variant={healthy ? 'success' : ready ? 'warn' : 'default'}>
              {!ready ? 'Not connected' : healthy ? 'MCP ready' : 'MCP issue'}
            </Chip>
          </div>
          <p className="auth-hint" style={{ margin: '0 0 6px', fontSize: 12, fontFamily: 'var(--font-mono, monospace)' }}>
            {server.serverName} · {server.bridgePath}
          </p>
          {ready ? (
            <p className="auth-hint" style={{ margin: 0, fontSize: 12, lineHeight: 1.5 }}>
              Tools: {server.tools.map((t) => t.name).join(', ')}
            </p>
          ) : null}
          {ready && !healthy && server.error ? (
            <p className="auth-error" style={{ margin: '8px 0 0', fontSize: 12, lineHeight: 1.5 }}>
              {server.error}
            </p>
          ) : null}
          {ready && server.excerpt ? (
            <p
              className="auth-hint t-mono"
              style={{
                margin: '10px 0 0',
                fontSize: 11,
                lineHeight: 1.45,
                whiteSpace: 'pre-wrap',
                padding: 8,
                borderRadius: 6,
                background: 'var(--surface)',
              }}
            >
              {server.excerpt}
            </p>
          ) : null}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text-dim)', flexShrink: 0 }}>
          <span>{ready ? (server.snapshotOk ? '✓ Data' : '✗ Data') : '— Data'}</span>
          <span>{ready ? (server.bridgeOk ? '✓ Bridge' : '✗ Bridge') : '— Bridge'}</span>
        </div>
      </div>
    </div>
  );
}
