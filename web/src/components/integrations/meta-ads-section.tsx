'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/hundres/button';
import { Card } from '@/components/hundres/card';
import { Chip } from '@/components/hundres/chip';
import {
  disconnectPlatform,
  getMetaAdsOAuthUrl,
  listMetaAdAccounts,
  setMetaAdAccount,
  type IntegrationCapability,
  type MCPStatusResponse,
  type MetaAdAccount,
  type SnapshotProbeResult,
} from '@/lib/mcp';
import {
  IntegrationDataChip,
  IntegrationSnapshotStatus,
} from '@/components/integrations/integration-snapshot-status';
import { IntegrationMcpBadge } from '@/components/integrations/integration-mcp-panel';
import { IntegrationOAuthActions } from '@/components/integrations/integration-oauth-actions';
import { IntegrationUnavailable } from '@/components/integrations/integration-unavailable';
import { IntegrationQuickLink } from '@/components/integrations/integration-quick-link';
import { INTEGRATION_HELP, INTEGRATION_UNAVAILABLE, INTEGRATION_QUICK_LINKS, metaAdsConsoleUrl } from '@/lib/integration-ui-copy';
import { useAuth } from '@/providers/auth-provider';
import type { McpServerStatus } from '@/lib/mcp';

type Props = {
  status: MCPStatusResponse | null;
  capability?: IntegrationCapability;
  loading: boolean;
  healthLoading: boolean;
  probe: SnapshotProbeResult | null;
  mcpServer?: McpServerStatus | null;
  onRefresh: () => void;
};

export function MetaAdsSection({
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<MetaAdAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState('');

  const meta = status?.connected.find((c) => c.platform === 'meta_ads');
  const isConnected = Boolean(meta);
  const isReady = Boolean(meta?.ready);
  const canConnect =
    capability?.implemented &&
    (status?.metaOAuthConfigured ?? capability?.oauthConfigured ?? false);

  const loadAccounts = useCallback(async () => {
    if (!accessToken || !activeOrganization || !isConnected || isReady) return;
    try {
      const { accounts: list } = await listMetaAdAccounts(
        accessToken,
        activeOrganization.id
      );
      setAccounts(list);
      if (list.length === 1) setSelectedAccount(list[0].adAccountId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ad accounts');
    }
  }, [accessToken, activeOrganization, isConnected, isReady]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const startOAuth = async (reconnect: boolean) => {
    if (!accessToken || !activeOrganization) return;
    setConnecting(true);
    setError(null);
    try {
      const { url } = await getMetaAdsOAuthUrl(accessToken, activeOrganization.id, { reconnect });
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start OAuth');
      setConnecting(false);
    }
  };

  const onConnect = () => void startOAuth(false);
  const onReconnect = () => void startOAuth(true);

  const onDisconnect = async () => {
    if (!accessToken || !activeOrganization) return;
    setDisconnecting(true);
    setError(null);
    try {
      await disconnectPlatform(accessToken, activeOrganization.id, 'meta_ads');
      setAccounts([]);
      setSelectedAccount('');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  };

  const onSaveAccount = async () => {
    if (!accessToken || !activeOrganization || !selectedAccount) return;
    setSaving(true);
    setError(null);
    try {
      await setMetaAdAccount(accessToken, activeOrganization.id, selectedAccount);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save ad account');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 15, fontWeight: 500 }}>Meta Ads</div>
              {!loading && (
                <>
                  <Chip variant={isReady ? 'success' : isConnected ? 'warn' : 'default'}>
                    {isReady ? 'Connected' : isConnected ? 'Needs account' : 'Not connected'}
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
              Analytical core — Facebook &amp; Instagram ads via MCP server{' '}
              <code style={{ fontSize: 12 }}>meta-ads-mcp</code>.
            </p>
            {!loading && isReady && meta?.adAccountId && (
              <p className="auth-hint" style={{ marginTop: 12 }}>
                Ad account · {meta.adAccountId}
              </p>
            )}
            <IntegrationSnapshotStatus
              connectionReady={isReady}
              probe={probe}
              healthLoading={healthLoading}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <IntegrationQuickLink
              href={metaAdsConsoleUrl(isReady ? meta?.adAccountId : null)}
              label={INTEGRATION_QUICK_LINKS.metaAds.label}
            />
            <IntegrationOAuthActions
              isConnected={isConnected}
              canConnect={Boolean(canConnect)}
              loading={loading}
              connecting={connecting}
              disconnecting={disconnecting}
              connectLabel="Connect with Meta"
              onConnect={onConnect}
              onReconnect={onReconnect}
              onDisconnect={() => void onDisconnect()}
            />
          </div>
        </div>

        {canConnect && !isConnected && (
          <p className="auth-hint" style={{ marginTop: 16, lineHeight: 1.5 }}>
            {INTEGRATION_HELP.metaAds}
          </p>
        )}

        {!canConnect && !loading && (
          <IntegrationUnavailable
            message={capability?.userMessage ?? INTEGRATION_UNAVAILABLE.metaAds}
          />
        )}

        {isConnected && !isReady && accounts.length > 0 && (
          <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
            <label className="auth-field">
              <span className="auth-label">Meta ad account</span>
              <select
                className="auth-input"
                value={selectedAccount}
                onChange={(e) => setSelectedAccount(e.target.value)}
              >
                <option value="">Select account</option>
                {accounts.map((a) => (
                  <option key={a.adAccountId} value={a.adAccountId}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="primary"
              type="button"
              disabled={!selectedAccount || saving}
              style={{ marginTop: 12 }}
              onClick={() => void onSaveAccount()}
            >
              Save account
            </Button>
          </div>
        )}

        {isConnected && !isReady && !loading && accounts.length === 0 && !error && (
          <p className="auth-hint" style={{ marginTop: 16 }}>
            No ad accounts found for this Meta user. Check app permissions (ads_read) and Business Manager access.
          </p>
        )}
      </Card>
      {error ? <p className="auth-error">{error}</p> : null}
    </div>
  );
}
