'use client';

import { useState } from 'react';
import { Button } from '@/components/hundres/button';
import { Card } from '@/components/hundres/card';
import { Chip } from '@/components/hundres/chip';
import {
  disconnectPlatform,
  getCanvaOAuthUrl,
  type IntegrationCapability,
  type MCPStatusResponse,
  type McpServerStatus,
} from '@/lib/mcp';
import { IntegrationMcpBadge } from '@/components/integrations/integration-mcp-panel';
import { IntegrationUnavailable } from '@/components/integrations/integration-unavailable';
import { IntegrationQuickLink } from '@/components/integrations/integration-quick-link';
import {
  INTEGRATION_HELP,
  INTEGRATION_QUICK_LINKS,
  INTEGRATION_UNAVAILABLE,
} from '@/lib/integration-ui-copy';
import { useAuth } from '@/providers/auth-provider';

type Props = {
  status: MCPStatusResponse | null;
  capability?: IntegrationCapability;
  loading: boolean;
  mcpLoading: boolean;
  mcpServer?: McpServerStatus | null;
  onRefresh: () => void;
};

export function CanvaSection({
  status,
  capability,
  loading,
  mcpLoading,
  mcpServer,
  onRefresh,
}: Props) {
  const { accessToken, activeOrganization } = useAuth();
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canva = status?.connected.find((c) => c.platform === 'canva');
  const canvaConnected = Boolean(canva?.ready);
  const configured = capability?.implemented ?? status?.canvaConnectConfigured ?? false;
  const mcpReady = Boolean(
    mcpServer?.connectionReady && mcpServer.snapshotOk && mcpServer.bridgeOk
  );

  const startCanvaLogin = async () => {
    if (!accessToken || !activeOrganization) return;
    setConnecting(true);
    setError(null);
    try {
      const { url } = await getCanvaOAuthUrl(accessToken, activeOrganization.id);
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start Canva login');
      setConnecting(false);
    }
  };

  const onDisconnect = async () => {
    if (!accessToken || !activeOrganization) return;
    setDisconnecting(true);
    setError(null);
    try {
      await disconnectPlatform(accessToken, activeOrganization.id, 'canva');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect Canva');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 15, fontWeight: 500 }}>Canva</div>
            {!loading && (
              <>
                <Chip variant={mcpReady ? 'success' : canvaConnected ? 'warn' : 'default'}>
                  {mcpReady ? 'MCP ready' : canvaConnected ? 'Checking MCP…' : 'Not connected'}
                </Chip>
                <IntegrationMcpBadge server={mcpServer} compact />
              </>
            )}
          </div>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
            Design creatives via MCP server <code style={{ fontSize: 12 }}>canva</code> — create
            Instagram-sized designs, export PNG, then chain to Instagram publishing.
          </p>
          {!loading && configured && (
            <p className="auth-hint" style={{ marginTop: 12 }}>
              {INTEGRATION_HELP.canva}
            </p>
          )}
          {!loading && configured && !canvaConnected && status?.canvaOAuthRedirectUri ? (
            <p className="auth-hint" style={{ marginTop: 8, fontSize: 12, lineHeight: 1.5 }}>
              Required once in{' '}
              <a href="https://www.canva.dev/" target="_blank" rel="noreferrer">
                canva.dev
              </a>
              :
              <br />
              1. Authentication → add redirect URI:
              <br />
              <code style={{ fontSize: 11, wordBreak: 'break-all' }}>
                {status.canvaOAuthRedirectUri}
              </code>
              <br />
              2. Scopes → enable: design:meta:read, design:content:read, design:content:write,
              profile:read
              <br />
              If Connect fails with “scopes are not allowed”, step 2 is missing.
            </p>
          ) : null}
          {!loading && canvaConnected && canva?.canvaDisplayName && (
            <p className="auth-hint" style={{ marginTop: 8, fontSize: 12 }}>
              Connected · {canva.canvaDisplayName}
            </p>
          )}
          {mcpLoading ? (
            <p className="auth-hint" style={{ marginTop: 8, fontSize: 12 }}>
              Probing Canva MCP…
            </p>
          ) : null}
          {mcpServer?.excerpt ? (
            <p className="auth-hint" style={{ marginTop: 8, fontSize: 12, lineHeight: 1.5 }}>
              {mcpServer.excerpt}
            </p>
          ) : mcpServer?.error ? (
            <p className="auth-error" style={{ marginTop: 8, fontSize: 12 }}>
              {mcpServer.error}
            </p>
          ) : null}
          {error ? (
            <p className="auth-error" style={{ marginTop: 8, fontSize: 12 }}>
              {error}
            </p>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {configured && !canvaConnected && (
            <Button variant="primary" disabled={connecting} onClick={() => void startCanvaLogin()}>
              {connecting ? 'Redirecting…' : 'Connect Canva'}
            </Button>
          )}
          {canvaConnected && (
            <>
              <Button variant="default" disabled={connecting} onClick={() => void startCanvaLogin()}>
                {connecting ? 'Redirecting…' : 'Reconnect'}
              </Button>
              <Button variant="ghost" disabled={disconnecting} onClick={() => void onDisconnect()}>
                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </Button>
            </>
          )}
          <IntegrationQuickLink
            href={INTEGRATION_QUICK_LINKS.canva.href}
            label={INTEGRATION_QUICK_LINKS.canva.label}
          />
        </div>
      </div>

      {!configured && !loading && (
        <IntegrationUnavailable
          message={capability?.userMessage ?? INTEGRATION_UNAVAILABLE.canva}
        />
      )}
    </Card>
  );
}
