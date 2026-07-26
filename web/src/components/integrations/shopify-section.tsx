'use client';

import { useState } from 'react';
import { Button } from '@/components/hundres/button';
import { Card } from '@/components/hundres/card';
import { Chip } from '@/components/hundres/chip';
import { Icon } from '@/components/hundres/icon';
import {
  disconnectPlatform,
  getShopifyOAuthUrl,
  type IntegrationCapability,
  type MCPStatusResponse,
  type SnapshotProbeResult,
  type McpServerStatus,
} from '@/lib/mcp';
import {
  IntegrationDataChip,
  IntegrationSnapshotStatus,
} from '@/components/integrations/integration-snapshot-status';
import { IntegrationMcpBadge } from '@/components/integrations/integration-mcp-panel';
import { IntegrationOAuthActions } from '@/components/integrations/integration-oauth-actions';
import { IntegrationUnavailable } from '@/components/integrations/integration-unavailable';
import { IntegrationQuickLink } from '@/components/integrations/integration-quick-link';
import { INTEGRATION_HELP, INTEGRATION_UNAVAILABLE, INTEGRATION_QUICK_LINKS, shopifyAdminUrl } from '@/lib/integration-ui-copy';
import { useAuth } from '@/providers/auth-provider';

type Props = {
  status: MCPStatusResponse | null;
  capability?: IntegrationCapability;
  loading: boolean;
  healthLoading: boolean;
  probe: SnapshotProbeResult | null;
  mcpServer?: McpServerStatus | null;
  onRefresh: () => void;
};

export function ShopifySection({
  status,
  capability,
  loading,
  healthLoading,
  probe,
  mcpServer,
  onRefresh,
}: Props) {
  const { accessToken, activeOrganization } = useAuth();
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shopInput, setShopInput] = useState('');

  const shopify = status?.connected.find((c) => c.platform === 'shopify');
  const isConnected = Boolean(shopify);
  const isReady = Boolean(shopify?.ready);
  const canConnect =
    capability?.implemented &&
    (status?.shopifyConfigured ?? capability?.oauthConfigured ?? false);
  const grantedScopes = shopify?.grantedScopes ?? '';
  const scopeList = grantedScopes
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const READ_SCOPES = ['read_orders', 'read_products', 'read_content'] as const;
  const WRITE_SCOPES = ['write_content', 'write_products'] as const;
  const missingRead = READ_SCOPES.filter((s) => !scopeList.includes(s));
  const missingWrite = WRITE_SCOPES.filter((s) => !scopeList.includes(s));
  const readOnlyMode = isConnected && missingRead.length === 0 && missingWrite.length > 0;

  const onConnect = async () => {
    if (!accessToken || !activeOrganization || !shopInput.trim()) return;
    setConnecting(true);
    setError(null);
    try {
      const { url } = await getShopifyOAuthUrl(
        accessToken,
        activeOrganization.id,
        shopInput.trim()
      );
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start OAuth');
      setConnecting(false);
    }
  };

  const onReconnect = async () => {
    const domain = shopify?.shopDomain ?? shopInput.trim();
    if (!domain) {
      setError('Enter your store domain, then click Reconnect.');
      return;
    }
    if (!shopInput.trim() && shopify?.shopDomain) {
      setShopInput(shopify.shopDomain);
    }
    setConnecting(true);
    setError(null);
    try {
      const { url } = await getShopifyOAuthUrl(accessToken!, activeOrganization!.id, domain);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start OAuth');
      setConnecting(false);
    }
  };

  const onDisconnect = async () => {
    if (!accessToken || !activeOrganization) return;
    setDisconnecting(true);
    setError(null);
    try {
      await disconnectPlatform(accessToken, activeOrganization.id, 'shopify');
      setShopInput('');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 15, fontWeight: 500 }}>Shopify</div>
              {!loading && (
                <>
                  <Chip variant={isReady ? 'success' : isConnected ? 'warn' : 'default'}>
                    {isReady ? (readOnlyMode ? 'Connected · read-only' : 'Connected') : isConnected ? 'Incomplete' : 'Not connected'}
                  </Chip>
                  <IntegrationDataChip
                    connectionReady={isReady}
                    probe={probe}
                    healthLoading={healthLoading}
                  />
                  <IntegrationMcpBadge server={mcpServer} compact />
                </>
              )}
            </div>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
              Commerce &amp; actuation — orders, catalog, and gated store writes via MCP server{' '}
              <code style={{ fontSize: 12 }}>shopify</code>.
            </p>
            {!loading && isReady && shopify?.shopDomain && (
              <p className="auth-hint" style={{ marginTop: 12 }}>
                Store · {shopify.shopDomain}
                {grantedScopes ? (
                  <>
                    <br />
                    Permissions · {grantedScopes.replace(/,/g, ', ')}
                  </>
                ) : null}
              </p>
            )}
            {readOnlyMode ? (
              <p className="auth-hint" style={{ marginTop: 12, fontSize: 13, lineHeight: 1.5 }}>
                Read-only mode — Shopify app review pending. Hundres reads via MCP for planning.
                Store writes (pages, product SEO, blog) need <strong>write_content</strong> and{' '}
                <strong>write_products</strong>; add scopes in Partners, update{' '}
                <code>SHOPIFY_SCOPES</code>, and reconnect.
              </p>
            ) : null}
            {missingRead.length > 0 ? (
              <p className="auth-error" style={{ marginTop: 12, fontSize: 13 }}>
                Missing read permissions: {missingRead.join(', ')}. In Shopify Partners → your app →
                Configuration, enable those scopes, save/release, then disconnect and connect again.
              </p>
            ) : null}
              <IntegrationSnapshotStatus
                connectionReady={isReady}
                probe={probe}
                healthLoading={healthLoading}
              />
              {isReady && mcpServer?.tools?.length ? (
                <p className="auth-hint" style={{ marginTop: 8, fontSize: 12, lineHeight: 1.5 }}>
                  MCP tools: {mcpServer.tools.map((t) => t.name).join(', ')}
                </p>
              ) : null}
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <IntegrationQuickLink
              href={shopifyAdminUrl(isReady ? shopify?.shopDomain : null)}
              label={INTEGRATION_QUICK_LINKS.shopify.label}
            />
            <IntegrationOAuthActions
              isConnected={isConnected}
              canConnect={Boolean(isConnected && canConnect)}
              loading={loading}
              connecting={connecting}
              disconnecting={disconnecting}
              connectLabel="Connect store"
              onConnect={() => void onConnect()}
              onReconnect={() => void onReconnect()}
              onDisconnect={() => void onDisconnect()}
            />
          </div>
        </div>

        {!canConnect && !loading && (
          <IntegrationUnavailable
            message={capability?.userMessage ?? INTEGRATION_UNAVAILABLE.shopify}
          />
        )}

        {!isConnected && canConnect && (
          <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
            <label className="auth-field">
              <span className="auth-label">Shopify store domain</span>
              <input
                className="auth-input"
                type="text"
                placeholder="your-store.myshopify.com"
                value={shopInput}
                onChange={(e) => setShopInput(e.target.value)}
                autoComplete="off"
              />
            </label>
            <p className="auth-hint" style={{ marginTop: 8 }}>
              {INTEGRATION_HELP.shopify}
            </p>
            <p className="auth-hint" style={{ marginTop: 8 }}>
              Sign in on the same URL as your Shopify redirect (e.g. your ngrok host, not
              localhost) before connecting.
            </p>
            <Button
              variant="primary"
              type="button"
              disabled={!shopInput.trim() || connecting}
              style={{ marginTop: 12 }}
              onClick={() => void onConnect()}
            >
              Connect store
              <Icon name="arrow-right" style={{ width: 13, height: 13 }} />
            </Button>
          </div>
        )}
      </Card>
      {error ? <p className="auth-error">{error}</p> : null}
    </div>
  );
}
