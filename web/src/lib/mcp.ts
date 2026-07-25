import { apiFetch } from '@/lib/api';

export interface MCPConnectionStatus {
  platform: string;
  propertyId: string | null;
  customerId: string | null;
  adAccountId: string | null;
  pageId: string | null;
  instagramUsername: string | null;
  canvaDisplayName: string | null;
  shopDomain: string | null;
  mailchimpAccountName?: string | null;
  mailchimpListId?: string | null;
  mailchimpListName?: string | null;
  grantedScopes: string | null;
  ready: boolean;
  lastSyncAt: string | null;
}

export interface MCPStatusResponse {
  connected: MCPConnectionStatus[];
  hasAnalytics: boolean;
  hasGoogleAds: boolean;
  hasMetaAds: boolean;
  hasShopify: boolean;
  hasUnsplash: boolean;
  hasRunway: boolean;
  hasCanva: boolean;
  hasInstagram: boolean;
  hasMailchimp?: boolean;
  canvaConnectConfigured?: boolean;
  instagramBusinessLoginConfigured?: boolean;
  googleOAuthConfigured: boolean;
  googleAdsConfigured: boolean;
  metaOAuthConfigured: boolean;
  shopifyConfigured: boolean;
  unsplashConfigured: boolean;
  runwayConfigured: boolean;
  mailchimpConfigured?: boolean;
  googleOAuthRedirectUri: string | null;
  metaOAuthRedirectUri: string | null;
  canvaOAuthRedirectUri?: string | null;
}

export interface GoogleAdsCustomer {
  customerId: string;
  resourceName: string;
  displayName: string;
}

export interface MetaAdAccount {
  adAccountId: string;
  name: string;
  accountStatus?: number;
}

export interface MetaFacebookPage {
  pageId: string;
  name: string;
  instagramUsername?: string;
  instagramBusinessAccountId?: string;
}

export interface GAProperty {
  property: string;
  displayName: string;
  accountDisplayName: string;
}

export interface IntegrationCapability {
  id: string;
  platform: string | null;
  name: string;
  implemented: boolean;
  oauthConfigured: boolean;
  uiStatus: 'available' | 'coming_soon' | 'planned';
  mcpTier?: 'analytical_core' | 'commerce' | 'actuation';
  feedsPlans?: boolean;
  userMessage?: string;
}

export type SnapshotPlatform =
  | 'google_analytics'
  | 'google_ads'
  | 'meta_ads'
  | 'shopify'
  | 'unsplash'
  | 'canva'
  | 'runway'
  | 'instagram'
  | 'mailchimp';

export interface SnapshotProbeResult {
  platform: SnapshotPlatform;
  connectionReady: boolean;
  dataAvailable: boolean;
  error: string | null;
  errorCode: string | null;
  userMessage: string | null;
}

export interface SnapshotHealthResponse {
  platforms: SnapshotProbeResult[];
}

export type McpTier = 'analytical_core' | 'commerce' | 'actuation';

export interface McpServerToolInfo {
  name: string;
  description: string;
}

export interface McpServerStatus {
  platform: SnapshotPlatform;
  tier: McpTier;
  serverName: string;
  label: string;
  bridgePath: string;
  publicUrl: string;
  connectionReady: boolean;
  tools: McpServerToolInfo[];
  snapshotOk: boolean;
  bridgeOk: boolean;
  excerpt: string | null;
  error: string | null;
}

export interface McpServersResponse {
  analyticalCore: SnapshotPlatform[];
  servers: McpServerStatus[];
}

export function getMcpCapabilities(token: string, organizationId: string) {
  return apiFetch<{
    integrations: IntegrationCapability[];
    analyticalCore?: SnapshotPlatform[];
  }>('/api/mcp/capabilities', {
    token,
    organizationId,
  });
}

export function getMcpStatus(token: string, organizationId: string) {
  return apiFetch<MCPStatusResponse>('/api/mcp/status', { token, organizationId });
}

export function getSnapshotHealth(token: string, organizationId: string) {
  return apiFetch<SnapshotHealthResponse>('/api/mcp/snapshot-health', {
    token,
    organizationId,
  });
}

export function getMcpServers(token: string, organizationId: string) {
  return apiFetch<McpServersResponse>('/api/mcp/servers', {
    token,
    organizationId,
  });
}

export function probeGoogleAds(token: string, organizationId: string) {
  return apiFetch<SnapshotProbeResult>('/api/mcp/google-ads/probe', {
    token,
    organizationId,
  });
}

export function getGoogleAnalyticsOAuthUrl(token: string, organizationId: string) {
  return apiFetch<{ url: string }>('/api/mcp/oauth/google-analytics', {
    token,
    organizationId,
  });
}

export function getGoogleAdsOAuthUrl(token: string, organizationId: string) {
  return apiFetch<{ url: string }>('/api/mcp/oauth/google-ads', {
    token,
    organizationId,
  });
}

export function getInstagramOAuthUrl(
  token: string,
  organizationId: string,
  options?: { reconnect?: boolean }
) {
  const params = new URLSearchParams();
  if (options?.reconnect) params.set('reconnect', '1');
  const qs = params.toString();
  return apiFetch<{ url: string }>(`/api/mcp/oauth/instagram${qs ? `?${qs}` : ''}`, {
    token,
    organizationId,
  });
}

export function getCanvaOAuthUrl(token: string, organizationId: string) {
  return apiFetch<{ url: string }>('/api/mcp/oauth/canva', {
    token,
    organizationId,
  });
}

export function getMetaAdsOAuthUrl(
  token: string,
  organizationId: string,
  options?: { reconnect?: boolean; includeInstagram?: boolean }
) {
  const params = new URLSearchParams();
  if (options?.reconnect) params.set('reconnect', '1');
  if (options?.includeInstagram) params.set('instagram', '1');
  const qs = params.toString();
  return apiFetch<{ url: string }>(`/api/mcp/oauth/meta-ads${qs ? `?${qs}` : ''}`, {
    token,
    organizationId,
  });
}

export function getShopifyOAuthUrl(
  token: string,
  organizationId: string,
  shop: string
) {
  const params = new URLSearchParams({ shop });
  return apiFetch<{ url: string }>(`/api/mcp/oauth/shopify?${params}`, {
    token,
    organizationId,
  });
}

export function connectMcpPlatform(
  token: string,
  organizationId: string,
  platform: 'google_analytics' | 'google_ads' | 'meta_ads' | 'shopify' | 'canva' | 'instagram',
  oauthCode: string,
  options?: { shop?: string }
) {
  return apiFetch<{ success: boolean }>('/api/mcp/connect', {
    method: 'POST',
    token,
    organizationId,
    body: JSON.stringify({
      platform,
      oauthCode,
      ...(options?.shop ? { shop: options.shop } : {}),
    }),
  });
}

export function connectMailchimp(
  token: string,
  organizationId: string,
  apiKey: string,
  defaultListId?: string
) {
  return apiFetch<{
    success: boolean;
    platform: string;
    accountName?: string;
    lists?: Array<{ id: string; name: string }>;
  }>('/api/mcp/connect', {
    method: 'POST',
    token,
    organizationId,
    body: JSON.stringify({
      platform: 'mailchimp',
      apiKey,
      ...(defaultListId ? { defaultListId } : {}),
    }),
  });
}

export function listMailchimpAudiences(token: string, organizationId: string) {
  return apiFetch<{
    audiences: Array<{ id: string; name: string; memberCount: number }>;
  }>('/api/mcp/mailchimp/audiences', {
    token,
    organizationId,
  });
}

export function setMailchimpAudience(
  token: string,
  organizationId: string,
  listId: string,
  listName?: string
) {
  return apiFetch<{ success: boolean; listId: string }>('/api/mcp/mailchimp/audience', {
    method: 'PUT',
    token,
    organizationId,
    body: JSON.stringify({ listId, ...(listName ? { listName } : {}) }),
  });
}

/** @deprecated Use connectMcpPlatform */
export function connectGoogleAnalytics(
  token: string,
  organizationId: string,
  oauthCode: string
) {
  return connectMcpPlatform(token, organizationId, 'google_analytics', oauthCode);
}

export function disconnectPlatform(token: string, organizationId: string, platform: string) {
  return apiFetch<{ success: boolean }>(`/api/mcp/disconnect/${platform}`, {
    method: 'DELETE',
    token,
    organizationId,
  });
}

export function listGoogleAnalyticsProperties(token: string, organizationId: string) {
  return apiFetch<{ properties: GAProperty[] }>('/api/mcp/google-analytics/properties', {
    token,
    organizationId,
  });
}

export function setGoogleAnalyticsProperty(
  token: string,
  organizationId: string,
  propertyId: string
) {
  return apiFetch<{ success: boolean; propertyId: string }>(
    '/api/mcp/google-analytics/property',
    {
      method: 'PUT',
      token,
      organizationId,
      body: JSON.stringify({ propertyId }),
    }
  );
}

export function listGoogleAdsCustomers(token: string, organizationId: string) {
  return apiFetch<{ customers: GoogleAdsCustomer[] }>('/api/mcp/google-ads/customers', {
    token,
    organizationId,
  });
}

export function setGoogleAdsCustomer(
  token: string,
  organizationId: string,
  customerId: string
) {
  return apiFetch<{ success: boolean; customerId: string }>('/api/mcp/google-ads/customer', {
    method: 'PUT',
    token,
    organizationId,
    body: JSON.stringify({ customerId }),
  });
}

export function listMetaAdAccounts(token: string, organizationId: string) {
  return apiFetch<{ accounts: MetaAdAccount[] }>('/api/mcp/meta-ads/accounts', {
    token,
    organizationId,
  });
}

export function setMetaAdAccount(
  token: string,
  organizationId: string,
  adAccountId: string
) {
  return apiFetch<{ success: boolean; adAccountId: string }>('/api/mcp/meta-ads/account', {
    method: 'PUT',
    token,
    organizationId,
    body: JSON.stringify({ adAccountId }),
  });
}

export function listMetaFacebookPages(token: string, organizationId: string) {
  return apiFetch<{ pages: MetaFacebookPage[] }>('/api/mcp/meta-ads/pages', {
    token,
    organizationId,
  });
}

export function setMetaFacebookPage(
  token: string,
  organizationId: string,
  pageId: string
) {
  return apiFetch<{ success: boolean; pageId: string }>('/api/mcp/meta-ads/page', {
    method: 'PUT',
    token,
    organizationId,
    body: JSON.stringify({ pageId }),
  });
}
