'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/hundres/button';
import { Card } from '@/components/hundres/card';
import { Chip } from '@/components/hundres/chip';
import {
  INTEGRATIONS,
  NICE_TO_HAVE_INTEGRATIONS,
  REQUIRED_INTEGRATIONS,
  type IntegrationDefinition,
  type IntegrationStatus,
} from '@/lib/integrations-catalog';
import {
  disconnectPlatform,
  getGoogleAnalyticsOAuthUrl,
  getMcpCapabilities,
  getMcpServers,
  getMcpStatus,
  getSnapshotHealth,
  listGoogleAnalyticsProperties,
  setGoogleAnalyticsProperty,
  type GAProperty,
  type IntegrationCapability,
  type MCPStatusResponse,
  type McpServerStatus,
  type SnapshotProbeResult,
} from '@/lib/mcp';
import {
  IntegrationDataChip,
  IntegrationSnapshotStatus,
} from '@/components/integrations/integration-snapshot-status';
import { GoogleAdsSection } from '@/components/integrations/google-ads-section';
import { MetaAdsSection } from '@/components/integrations/meta-ads-section';
import { IntegrationUnavailable } from '@/components/integrations/integration-unavailable';
import { ShopifySection } from '@/components/integrations/shopify-section';
import { UnsplashSection } from '@/components/integrations/unsplash-section';
import { InstagramSection } from '@/components/integrations/instagram-section';
import { INTEGRATION_HELP, INTEGRATION_UNAVAILABLE, INTEGRATION_QUICK_LINKS, googleAnalyticsConsoleUrl } from '@/lib/integration-ui-copy';
import { IntegrationOAuthActions } from '@/components/integrations/integration-oauth-actions';
import { IntegrationQuickLink } from '@/components/integrations/integration-quick-link';
import { IntegrationMcpBadge, McpServersPanel } from '@/components/integrations/integration-mcp-panel';
import { useAuth } from '@/providers/auth-provider';

function statusLabel(status: IntegrationStatus): string {
  if (status === 'available') return 'Available';
  if (status === 'coming_soon') return 'Coming soon';
  return 'Planned';
}

function probeFor(
  platform: SnapshotProbeResult['platform'],
  health: SnapshotProbeResult[]
): SnapshotProbeResult | null {
  return health.find((p) => p.platform === platform) ?? null;
}

function serverFor(
  platform: McpServerStatus['platform'],
  servers: McpServerStatus[]
): McpServerStatus | null {
  return servers.find((s) => s.platform === platform) ?? null;
}

function ConnectionStatusBanner({
  loading,
  isConnected,
  isReady,
  propertyId,
  gaProbe,
  healthLoading,
  onRefresh,
}: {
  loading: boolean;
  isConnected: boolean;
  isReady: boolean;
  propertyId?: string | null;
  gaProbe: SnapshotProbeResult | null;
  healthLoading: boolean;
  onRefresh: () => void;
}) {
  let chipVariant: 'default' | 'success' | 'warn' = 'default';
  let title = 'Checking connection…';
  let detail = 'Loading status from your workspace.';

  if (!loading) {
    if (isReady) {
      if (healthLoading) {
        chipVariant = 'success';
        title = 'Google Analytics is connected';
        detail = `GA4 property ${propertyId} is linked. Checking whether live metrics load…`;
      } else if (gaProbe?.dataAvailable) {
        chipVariant = 'success';
        title = 'Google Analytics — data loading OK';
        detail = `GA4 property ${propertyId} is linked and returning live metrics for plan generation.`;
      } else if (gaProbe?.userMessage || gaProbe?.dataAvailable === false) {
        chipVariant = 'warn';
        title = 'Google Analytics connected — data error';
        detail =
          gaProbe?.userMessage ??
          'Live GA4 metrics could not be loaded. Check API enablement and property access.';
      } else {
        chipVariant = 'success';
        title = 'Google Analytics is connected';
        detail = `GA4 property ${propertyId} is linked. New plans can use your real analytics data.`;
      }
    } else if (isConnected) {
      chipVariant = 'warn';
      title = 'Google account linked — one more step';
      detail =
        'OAuth succeeded, but you still need to choose a GA4 property below and click Save property.';
    } else {
      chipVariant = 'warn';
      title = 'Google Analytics is not connected';
      detail = 'Connect below to sign in with Google and link a property to this workspace.';
    }
  }

  return (
    <Card style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <span className="h-eyebrow" style={{ margin: 0 }}>
              Your connection
            </span>
            <Chip variant={chipVariant}>{loading ? 'Checking…' : isReady ? 'Ready' : isConnected ? 'Incomplete' : 'Not connected'}</Chip>
          </div>
          <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>{title}</div>
          <p className="t-dim" style={{ fontSize: 14, lineHeight: 1.55, margin: 0 }}>
            {detail}
          </p>
          {!loading && (
            <ul className="t-dim" style={{ fontSize: 13, margin: '14px 0 0', paddingLeft: 20, lineHeight: 1.7 }}>
              <li style={{ color: isConnected ? 'var(--text)' : undefined }}>
                {isConnected ? '✓' : '○'} Google account authorized
              </li>
              <li style={{ color: isReady ? 'var(--text)' : undefined }}>
                {isReady ? '✓' : '○'} GA4 property selected
              </li>
            </ul>
          )}
        </div>
        <Button variant="ghost" type="button" disabled={loading} onClick={onRefresh}>
          Refresh status
        </Button>
      </div>
    </Card>
  );
}

function capabilityBadge(cap: IntegrationCapability | undefined, fallback: IntegrationStatus): string {
  if (!cap) return statusLabel(fallback);
  if (cap.implemented) return 'Available';
  return statusLabel(cap.uiStatus);
}

function IntegrationRow({
  integration,
  capability,
  badge,
  children,
}: {
  integration: IntegrationDefinition;
  capability?: IntegrationCapability;
  badge?: string;
  children?: ReactNode;
}) {
  const notBuilt = capability && !capability.implemented;

  return (
    <Card tight>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 15, fontWeight: 500 }}>{integration.name}</div>
            <span className="auth-hint" style={{ margin: 0 }}>
              {badge ?? capabilityBadge(capability, integration.status)}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
            {integration.description}
          </p>
          {notBuilt && capability?.userMessage ? (
            <p className="auth-hint" style={{ marginTop: 10, lineHeight: 1.5 }}>
              {capability.userMessage}
            </p>
          ) : null}
        </div>
        {children ? <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>{children}</div> : null}
      </div>
    </Card>
  );
}

export function IntegrationsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { accessToken, activeOrganization, loading: authLoading } = useAuth();

  const [status, setStatus] = useState<MCPStatusResponse | null>(null);
  const [capabilities, setCapabilities] = useState<Record<string, IntegrationCapability>>({});
  const [properties, setProperties] = useState<GAProperty[]>([]);
  const [selectedProperty, setSelectedProperty] = useState('');
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [savingProperty, setSavingProperty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [snapshotHealth, setSnapshotHealth] = useState<SnapshotProbeResult[]>([]);
  const [healthLoading, setHealthLoading] = useState(false);
  const [mcpServers, setMcpServers] = useState<McpServerStatus[]>([]);
  const [analyticalCore, setAnalyticalCore] = useState<McpServerStatus['platform'][]>([
    'google_analytics',
    'google_ads',
    'meta_ads',
  ]);
  const [mcpLoading, setMcpLoading] = useState(false);

  const orgId = activeOrganization?.id;
  const token = accessToken;
  const analytics = status?.connected.find((c) => c.platform === 'google_analytics');
  const isConnected = Boolean(analytics);
  const isReady = Boolean(analytics?.ready);
  const pageLoading = authLoading || loading;
  const oauthConfigured =
    status?.googleOAuthConfigured ?? capabilities.google_analytics?.oauthConfigured ?? false;

  const load = useCallback(async () => {
    if (!token || !orgId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const capsResult = await getMcpCapabilities(token, orgId).catch((err) => {
        console.warn('[integrations] capabilities failed', err);
        return null;
      });
      if (capsResult) {
        setCapabilities(Object.fromEntries(capsResult.integrations.map((c) => [c.id, c])));
      }

      const nextStatus = await getMcpStatus(token, orgId).catch((err) => {
        console.warn('[integrations] status failed', err);
        throw err;
      });
      setStatus(nextStatus);

      const ga = nextStatus.connected.find((c) => c.platform === 'google_analytics');
      if (ga && !ga.ready) {
        const { properties: list } = await listGoogleAnalyticsProperties(token, orgId);
        setProperties(list);
        if (list.length === 1) {
          setSelectedProperty(list[0].property);
        }
      } else {
        setProperties([]);
      }

      const shouldProbeSnapshots = nextStatus.connected.some((c) => c.ready);
      setMcpLoading(true);
      setHealthLoading(shouldProbeSnapshots);
      try {
        const mcp = await getMcpServers(token, orgId);
        setMcpServers(mcp.servers);
        setAnalyticalCore(mcp.analyticalCore);
        if (shouldProbeSnapshots) {
          const health = await getSnapshotHealth(token, orgId);
          setSnapshotHealth(health.platforms);
        } else {
          setSnapshotHealth([]);
        }
      } catch {
        setSnapshotHealth([]);
        setMcpServers([]);
      } finally {
        setHealthLoading(false);
        setMcpLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load integrations');
    } finally {
      setLoading(false);
    }
  }, [orgId, token]);

  useEffect(() => {
    if (authLoading) return;
    void load();
  }, [load, authLoading]);

  useEffect(() => {
    const oauthError = searchParams.get('oauth_error');
    if (oauthError) {
      setError(decodeURIComponent(oauthError));
      router.replace('/integrations');
      return;
    }
    if (searchParams.get('connected') === '1') {
      setNotice('Google Analytics connected. Select your property below.');
      router.replace('/integrations');
    }
    if (searchParams.get('connected_ads') === '1') {
      setNotice('Google Ads connected. Select your Ads customer account below.');
      router.replace('/integrations');
    }
    if (searchParams.get('connected_meta') === '1') {
      setNotice('Meta Ads connected. Select your Meta ad account below.');
      router.replace('/integrations');
    }
    if (searchParams.get('connected_instagram') === '1') {
      setNotice('Instagram connected. @keylo.london is ready for MCP publishing.');
      router.replace('/integrations');
    }
    if (searchParams.get('connected_shopify') === '1') {
      setNotice('Shopify connected. Your store is ready for plan generation.');
      router.replace('/integrations');
    }
  }, [router, searchParams]);

  const onConnect = async () => {
    if (!token || !orgId) return;
    setConnecting(true);
    setError(null);

    try {
      const { url } = await getGoogleAnalyticsOAuthUrl(token, orgId);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start OAuth');
      setConnecting(false);
    }
  };

  const onReconnect = onConnect;

  const onDisconnect = async () => {
    if (!token || !orgId) return;
    setDisconnecting(true);
    setError(null);

    try {
      await disconnectPlatform(token, orgId, 'google_analytics');
      setProperties([]);
      setSelectedProperty('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  };

  const onSaveProperty = async () => {
    if (!token || !orgId || !selectedProperty) return;
    setSavingProperty(true);
    setError(null);

    try {
      await setGoogleAnalyticsProperty(token, orgId, selectedProperty);
      setNotice('Property saved. Analytics is ready for your plans.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save property');
    } finally {
      setSavingProperty(false);
    }
  };

  const niceToHave = NICE_TO_HAVE_INTEGRATIONS.filter(
    (i) => i.id !== 'unsplash' && i.id !== 'instagram'
  );
  const requiredExceptBuiltIn = REQUIRED_INTEGRATIONS.filter(
    (i) =>
      i.id !== 'google_analytics' &&
      i.id !== 'google_ads' &&
      i.id !== 'meta_ads' &&
      i.id !== 'shopify'
  );

  return (
    <>
      <div className="dash-greeting">
        <div>
          <div className="h-eyebrow" style={{ marginBottom: 12 }}>
            Settings
          </div>
          <h1 className="h-display">Integrations</h1>
          <p className="t-dim" style={{ fontSize: 17, marginTop: 10, maxWidth: 560 }}>
            Connect your accounts via OAuth — Hundres reads them through MCP servers. Analytical
            sources (GA, Google Ads, Meta) power your plans; Shopify adds store data and gated
            writes.
          </p>
        </div>
      </div>

      {notice && <p className="auth-hint" style={{ marginBottom: 16 }}>{notice}</p>}
      {error && <p className="auth-error" style={{ marginBottom: 16 }}>{error}</p>}

      <ConnectionStatusBanner
        loading={pageLoading}
        isConnected={isConnected}
        isReady={isReady}
        propertyId={analytics?.propertyId}
        gaProbe={probeFor('google_analytics', snapshotHealth)}
        healthLoading={healthLoading}
        onRefresh={() => void load()}
      />

      <McpServersPanel
        servers={mcpServers}
        analyticalCore={analyticalCore}
        loading={pageLoading || mcpLoading}
      />

      {!pageLoading && !status && error ? (
        <Card style={{ marginBottom: 24 }}>
          <p className="auth-error" style={{ margin: 0 }}>
            Could not load connection status — Connect buttons may be hidden. {error}
          </p>
          <Button variant="default" type="button" style={{ marginTop: 12 }} onClick={() => void load()}>
            Retry
          </Button>
        </Card>
      ) : null}

      <div className="h-eyebrow" style={{ marginBottom: 12 }}>
        Required ({REQUIRED_INTEGRATIONS.length})
      </div>
          <p className="t-dim" style={{ fontSize: 14, marginTop: 0, marginBottom: 16, maxWidth: 560 }}>
        Connect the accounts you use — no API keys or technical setup. Click Connect, sign in, and
        pick your property or account where asked.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32 }}>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 15, fontWeight: 500 }}>Google Analytics</div>
                {!pageLoading && (
                  <>
                    <Chip variant={isReady ? 'success' : isConnected ? 'warn' : 'default'}>
                      {isReady ? 'Connected' : isConnected ? 'Needs property' : 'Not connected'}
                    </Chip>
                    <IntegrationDataChip
                      connectionReady={isReady}
                      probe={probeFor('google_analytics', snapshotHealth)}
                      healthLoading={healthLoading}
                    />
                    <IntegrationMcpBadge server={serverFor('google_analytics', mcpServers)} compact />
                  </>
                )}
              </div>
              <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                {INTEGRATIONS.find((i) => i.id === 'google_analytics')?.description}
              </p>
              {!pageLoading && isReady && (
                <p className="auth-hint" style={{ marginTop: 12 }}>
                  Property · {analytics?.propertyId}
                </p>
              )}
              <IntegrationSnapshotStatus
                connectionReady={isReady}
                probe={probeFor('google_analytics', snapshotHealth)}
                healthLoading={healthLoading}
              />
              {isReady && serverFor('google_analytics', mcpServers)?.tools?.length ? (
                <p className="auth-hint" style={{ marginTop: 8, fontSize: 12, lineHeight: 1.5 }}>
                  MCP tools:{' '}
                  {serverFor('google_analytics', mcpServers)!
                    .tools.map((t) => t.name)
                    .join(', ')}
                </p>
              ) : null}
              {!pageLoading && isConnected && !isReady && (
                <p className="auth-hint" style={{ marginTop: 12 }}>
                  Select a GA4 property to finish setup.
                </p>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <IntegrationQuickLink
                href={googleAnalyticsConsoleUrl(isReady ? analytics?.propertyId : null)}
                label={INTEGRATION_QUICK_LINKS.googleAnalytics.label}
              />
              <IntegrationOAuthActions
                isConnected={isConnected}
                canConnect={Boolean(oauthConfigured)}
                loading={pageLoading}
                connecting={connecting}
                disconnecting={disconnecting}
                connectLabel="Connect with Google"
                onConnect={() => void onConnect()}
                onReconnect={() => void onReconnect()}
                onDisconnect={() => void onDisconnect()}
              />
            </div>
          </div>

          {!pageLoading && oauthConfigured && !isConnected && (
            <p className="auth-hint" style={{ marginTop: 16, lineHeight: 1.5 }}>
              {INTEGRATION_HELP.googleAnalytics}
            </p>
          )}

          {!pageLoading && !oauthConfigured && (
            <IntegrationUnavailable message={INTEGRATION_UNAVAILABLE.googleSignIn} />
          )}

          {isConnected && !isReady && properties.length > 0 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void onSaveProperty();
              }}
              style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border)' }}
            >
              <label className="auth-field">
                <span className="auth-label">GA4 property</span>
                <select
                  className="auth-input"
                  value={selectedProperty}
                  onChange={(e) => setSelectedProperty(e.target.value)}
                  required
                >
                  <option value="">Select a property</option>
                  {properties.map((property) => (
                    <option key={property.property} value={property.property}>
                      {property.displayName} ({property.accountDisplayName})
                    </option>
                  ))}
                </select>
              </label>
              <Button
                variant="primary"
                type="submit"
                disabled={!selectedProperty || savingProperty}
                style={{ marginTop: 12 }}
              >
                Save property
              </Button>
            </form>
          )}

          {isConnected && !isReady && !pageLoading && properties.length === 0 && (
            <p className="auth-hint" style={{ marginTop: 16 }}>
              No GA4 properties found for this Google account.
            </p>
          )}
        </Card>

        <GoogleAdsSection
          status={status}
          capability={capabilities.google_ads}
          loading={pageLoading}
          healthLoading={healthLoading}
          probe={probeFor('google_ads', snapshotHealth)}
          mcpServer={serverFor('google_ads', mcpServers)}
          onRefresh={() => void load()}
        />

        <MetaAdsSection
          status={status}
          capability={capabilities.meta_ads}
          loading={pageLoading}
          healthLoading={healthLoading}
          probe={probeFor('meta_ads', snapshotHealth)}
          mcpServer={serverFor('meta_ads', mcpServers)}
          onRefresh={() => void load()}
        />

        <ShopifySection
          status={status}
          capability={capabilities.shopify}
          loading={pageLoading}
          healthLoading={healthLoading}
          probe={probeFor('shopify', snapshotHealth)}
          mcpServer={serverFor('shopify', mcpServers)}
          onRefresh={() => void load()}
        />

        {requiredExceptBuiltIn.map((integration) => (
          <IntegrationRow
            key={integration.id}
            integration={integration}
            capability={capabilities[integration.id]}
          />
        ))}
      </div>

      <div className="h-eyebrow" style={{ marginBottom: 12 }}>
        Content ({2})
      </div>
      <p className="t-dim" style={{ fontSize: 14, marginTop: 0, marginBottom: 16, maxWidth: 560 }}>
        Stock imagery and organic social publishing. Unsplash is workspace-wide; Instagram uses your
        Meta login and linked Business account.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32 }}>
        <UnsplashSection
          status={status}
          capability={capabilities.unsplash}
          loading={pageLoading}
          mcpLoading={mcpLoading}
          mcpServer={serverFor('unsplash', mcpServers)}
        />
        <InstagramSection
          status={status}
          capability={capabilities.instagram}
          loading={pageLoading}
          mcpLoading={mcpLoading}
          mcpServer={serverFor('instagram', mcpServers)}
          onRefresh={() => void load()}
        />
      </div>

      <div className="h-eyebrow" style={{ marginBottom: 12 }}>
        Nice to have ({niceToHave.length})
      </div>
      <p className="t-dim" style={{ fontSize: 14, marginTop: 0, marginBottom: 16, maxWidth: 560 }}>
        Competitive intel, demand signals, and reviews. Helpful for deeper analysis; estimates are
        labeled with lower confidence than your connected accounts.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {niceToHave.map((integration) => (
          <IntegrationRow
            key={integration.id}
            integration={integration}
            capability={capabilities[integration.id]}
          />
        ))}
      </div>
    </>
  );
}
