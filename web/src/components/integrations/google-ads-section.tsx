'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/hundres/button';
import { Card } from '@/components/hundres/card';
import { Chip } from '@/components/hundres/chip';
import {
  disconnectPlatform,
  getGoogleAdsOAuthUrl,
  listGoogleAdsCustomers,
  setGoogleAdsCustomer,
  type GoogleAdsCustomer,
  type IntegrationCapability,
  type MCPStatusResponse,
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
import { INTEGRATION_HELP, INTEGRATION_UNAVAILABLE, INTEGRATION_QUICK_LINKS, googleAdsConsoleUrl } from '@/lib/integration-ui-copy';
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

export function GoogleAdsSection({
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
  const [customers, setCustomers] = useState<GoogleAdsCustomer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState('');

  const ads = status?.connected.find((c) => c.platform === 'google_ads');
  const isConnected = Boolean(ads);
  const isReady = Boolean(ads?.ready);
  const canConnect =
    capability?.implemented &&
    (status?.googleOAuthConfigured ?? capability?.oauthConfigured ?? false);

  const loadCustomers = useCallback(async () => {
    if (!accessToken || !activeOrganization || !isConnected || isReady) return;
    try {
      const { customers: list } = await listGoogleAdsCustomers(
        accessToken,
        activeOrganization.id
      );
      setCustomers(list);
      if (list.length === 1) setSelectedCustomer(list[0].customerId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ad accounts');
    }
  }, [accessToken, activeOrganization, isConnected, isReady]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  const onConnect = async () => {
    if (!accessToken || !activeOrganization) return;
    setConnecting(true);
    setError(null);
    try {
      const { url } = await getGoogleAdsOAuthUrl(accessToken, activeOrganization.id);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start OAuth');
      setConnecting(false);
    }
  };

  const onReconnect = onConnect;

  const onDisconnect = async () => {
    if (!accessToken || !activeOrganization) return;
    setDisconnecting(true);
    setError(null);
    try {
      await disconnectPlatform(accessToken, activeOrganization.id, 'google_ads');
      setCustomers([]);
      setSelectedCustomer('');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  };

  const onSaveCustomer = async () => {
    if (!accessToken || !activeOrganization || !selectedCustomer) return;
    setSaving(true);
    setError(null);
    try {
      await setGoogleAdsCustomer(accessToken, activeOrganization.id, selectedCustomer);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save customer');
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
              <div style={{ fontSize: 15, fontWeight: 500 }}>Google Ads</div>
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
              Analytical core — paid search via MCP server <code style={{ fontSize: 12 }}>google-ads-mcp</code>.
            </p>
            {!loading && isReady && ads?.customerId && (
              <p className="auth-hint" style={{ marginTop: 12 }}>
                Customer ID · {ads.customerId}
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
              href={googleAdsConsoleUrl(isReady ? ads?.customerId : null)}
              label={INTEGRATION_QUICK_LINKS.googleAds.label}
            />
            <IntegrationOAuthActions
              isConnected={isConnected}
              canConnect={Boolean(canConnect)}
              loading={loading}
              connecting={connecting}
              disconnecting={disconnecting}
              connectLabel="Connect with Google"
              onConnect={() => void onConnect()}
              onReconnect={() => void onReconnect()}
              onDisconnect={() => void onDisconnect()}
            />
          </div>
        </div>

        {canConnect && !isConnected && (
          <p className="auth-hint" style={{ marginTop: 16, lineHeight: 1.5 }}>
            {INTEGRATION_HELP.googleAds}
          </p>
        )}

        {!canConnect && !loading && (
          <IntegrationUnavailable
            message={
              capability?.userMessage ?? INTEGRATION_UNAVAILABLE.googleAds
            }
          />
        )}

        {isConnected && !isReady && customers.length > 0 && (
          <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
            <label className="auth-field">
              <span className="auth-label">Ads customer account</span>
              <select
                className="auth-input"
                value={selectedCustomer}
                onChange={(e) => setSelectedCustomer(e.target.value)}
              >
                <option value="">Select account</option>
                {customers.map((c) => (
                  <option key={c.customerId} value={c.customerId}>
                    {c.displayName}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="primary"
              type="button"
              disabled={!selectedCustomer || saving}
              style={{ marginTop: 12 }}
              onClick={() => void onSaveCustomer()}
            >
              Save account
            </Button>
          </div>
        )}

        {isConnected && !isReady && !loading && customers.length === 0 && !error && (
          <p className="auth-hint" style={{ marginTop: 16 }}>
            No accessible Ads accounts for this Google user. Check API access and developer token.
          </p>
        )}
      </Card>
      {error ? <p className="auth-error">{error}</p> : null}
    </div>
  );
}
