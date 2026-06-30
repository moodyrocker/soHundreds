'use client';

import { useState } from 'react';
import { Button } from '@/components/hundres/button';
import { Card } from '@/components/hundres/card';
import { Chip } from '@/components/hundres/chip';
import {
  disconnectPlatform,
  getInstagramOAuthUrl,
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

export function InstagramSection({
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

  const ig = status?.connected.find((c) => c.platform === 'instagram');
  const igConnected = Boolean(ig);
  const configured =
    capability?.implemented ?? status?.instagramBusinessLoginConfigured ?? false;
  const mcpReady = Boolean(
    mcpServer?.connectionReady && mcpServer.snapshotOk && mcpServer.bridgeOk
  );

  const startInstagramLogin = async (reconnect: boolean) => {
    if (!accessToken || !activeOrganization) return;
    setConnecting(true);
    setError(null);
    try {
      const { url } = await getInstagramOAuthUrl(accessToken, activeOrganization.id, {
        reconnect,
      });
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start Instagram login');
      setConnecting(false);
    }
  };

  const onDisconnect = async () => {
    if (!accessToken || !activeOrganization) return;
    setDisconnecting(true);
    setError(null);
    try {
      await disconnectPlatform(accessToken, activeOrganization.id, 'instagram');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect Instagram');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 15, fontWeight: 500 }}>Instagram</div>
            {!loading && (
              <>
                <Chip variant={mcpReady ? 'success' : igConnected ? 'warn' : 'default'}>
                  {mcpReady ? 'MCP ready' : igConnected ? 'Checking MCP…' : 'Not connected'}
                </Chip>
                <IntegrationMcpBadge server={mcpServer} compact />
              </>
            )}
          </div>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
            Organic Instagram via MCP server <code style={{ fontSize: 12 }}>instagram</code> — publish
            posts, stories, reels, and manage comments. Sign in as your Business account (e.g.{' '}
            <strong style={{ fontWeight: 500, color: 'var(--text)' }}>@keylo.london</strong>).
          </p>
          {!loading && configured && (
            <p className="auth-hint" style={{ marginTop: 12 }}>
              {INTEGRATION_HELP.instagram}
            </p>
          )}
          {!loading && igConnected && ig?.instagramUsername && (
            <p className="auth-hint" style={{ marginTop: 8, fontSize: 12 }}>
              Connected · @{ig.instagramUsername}
            </p>
          )}
          {mcpLoading ? (
            <p className="auth-hint" style={{ marginTop: 8, fontSize: 12 }}>
              Probing Instagram MCP…
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
          {configured && !igConnected && (
            <Button
              variant="primary"
              disabled={connecting}
              onClick={() => void startInstagramLogin(false)}
            >
              {connecting ? 'Redirecting…' : 'Connect @keylo.london'}
            </Button>
          )}
          {igConnected && (
            <>
              <Button variant="default" disabled={connecting} onClick={() => void startInstagramLogin(true)}>
                {connecting ? 'Redirecting…' : 'Reconnect'}
              </Button>
              <Button variant="ghost" disabled={disconnecting} onClick={() => void onDisconnect()}>
                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </Button>
            </>
          )}
          <IntegrationQuickLink
            href={INTEGRATION_QUICK_LINKS.instagram.href}
            label={INTEGRATION_QUICK_LINKS.instagram.label}
          />
        </div>
      </div>

      {!configured && !loading && (
        <IntegrationUnavailable
          message={capability?.userMessage ?? INTEGRATION_UNAVAILABLE.instagram}
        />
      )}
    </Card>
  );
}
