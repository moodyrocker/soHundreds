import { formatOAuthState } from '../lib/oauthState.js';
import { normalizeShopDomain } from '../lib/shopDomain.js';
import { query } from '../database/connection.js';
import type {
  GAPropertySummary,
  GoogleAdsCustomerSummary,
  MetaAdAccountSummary,
  MetaFacebookPageSummary,
  MCPConnection,
  MCPConnectionConfig,
  MCPPlatform,
  OAuthTokens,
} from '../types/index.js';

import { decrypt, encrypt } from '../utils/encryption.js';
import { getMcpDefinition } from '../lib/mcpRegistry.js';
import { isGoogleAdsEnabled } from '../lib/googleFeatureFlags.js';
import { mcpBridgePublicUrl } from '../lib/mcpBridgeToken.js';
import {
  resolveInstagramBusinessAccount,
  type InstagramContext,
} from '../lib/instagramGraphClient.js';
import {
  exchangeInstagramBusinessCode,
  fetchInstagramBusinessUsername,
  instagramAppCredentials,
  INSTAGRAM_BUSINESS_OAUTH_SCOPES,
  instagramOAuthRedirectUri,
  isInstagramBusinessLoginConfigured,
  refreshInstagramBusinessToken,
} from '../lib/instagramBusinessLogin.js';
import {
  buildCanvaAuthorizeUrl,
  exchangeCanvaCode,
  generateCanvaPkce,
  isCanvaConnectConfigured,
  refreshCanvaToken,
} from '../lib/canvaConnect.js';

const META_GRAPH_VERSION = process.env.META_GRAPH_API_VERSION ?? 'v21.0';

/** Meta OAuth scopes for ads + Facebook Page (always safe to request). */
export const META_ADS_OAUTH_SCOPES = [
  'ads_read',
  'ads_management',
  'pages_show_list',
  'pages_read_engagement',
  'business_management',
].join(',');

/** Extra scopes for organic Instagram MCP (Facebook Login for Business path). */
export const META_INSTAGRAM_OAUTH_SCOPES = [
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_comments',
].join(',');

/** Full scope string (ads + Instagram). Override via META_OAUTH_SCOPES in .env if needed. */
export const META_OAUTH_SCOPES = `${META_ADS_OAUTH_SCOPES},${META_INSTAGRAM_OAUTH_SCOPES}`;

function resolveMetaOAuthScopes(includeInstagram: boolean): string {
  const envOverride = process.env.META_OAUTH_SCOPES?.trim();
  if (envOverride) return envOverride;
  return includeInstagram ? META_OAUTH_SCOPES : META_ADS_OAUTH_SCOPES;
}

const GA_MCP_URL = 'https://analytics-mcp.googleapis.com/mcp/v1';
const GA_MCP_NAME = 'analytics-mcp';

function platformUrl(platform: MCPPlatform): string {
  const def = getMcpDefinition(platform);
  if (def) return def.resolvePublicUrl();
  return mcpBridgePublicUrl(platform);
}

function platformName(platform: MCPPlatform): string {
  return getMcpDefinition(platform)?.serverName ?? platform;
}

const PLATFORM_URLS: Record<MCPPlatform, string> = {
  google_analytics: platformUrl('google_analytics'),
  google_ads: platformUrl('google_ads'),
  meta_ads: platformUrl('meta_ads'),
  shopify: platformUrl('shopify'),
  unsplash: platformUrl('unsplash'),
  canva: platformUrl('canva'),
  runway: platformUrl('runway'),
  instagram: platformUrl('instagram'),
  mailchimp: platformUrl('mailchimp'),
};

const PLATFORM_NAMES: Record<MCPPlatform, string> = {
  google_analytics: platformName('google_analytics'),
  google_ads: platformName('google_ads'),
  meta_ads: platformName('meta_ads'),
  shopify: platformName('shopify'),
  unsplash: platformName('unsplash'),
  canva: platformName('canva'),
  runway: platformName('runway'),
  instagram: platformName('instagram'),
  mailchimp: platformName('mailchimp'),
};

const DEFAULT_SHOPIFY_SCOPES = 'read_orders,read_products,read_content,write_content,write_products';

const TOKEN_REFRESH_BUFFER_MS = 60_000;

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() &&
      process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim()
  );
}

export function isGoogleAdsConfigured(): boolean {
  return Boolean(
    isGoogleAdsEnabled() &&
      isGoogleOAuthConfigured() &&
      process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim()
  );
}

export function isMetaOAuthConfigured(): boolean {
  return Boolean(
    process.env.META_APP_ID?.trim() &&
      process.env.META_APP_SECRET?.trim() &&
      (process.env.META_OAUTH_REDIRECT_URI?.trim() ||
        process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim())
  );
}

export function isShopifyConfigured(): boolean {
  const uri =
    process.env.SHOPIFY_OAUTH_REDIRECT_URI?.trim() ||
    process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  return Boolean(
    process.env.SHOPIFY_CLIENT_ID?.trim() &&
      process.env.SHOPIFY_CLIENT_SECRET?.trim() &&
      uri
  );
}

export function isUnsplashMcpConfigured(): boolean {
  return Boolean(process.env.UNSPLASH_ACCESS_KEY?.trim());
}

export function isRunwayMcpConfigured(): boolean {
  return Boolean(process.env.RUNWAY_API_KEY?.trim());
}

export { isInstagramBusinessLoginConfigured, isCanvaConnectConfigured };

export function isConnectionReady(
  platform: MCPPlatform,
  row: { property_id?: string | null; config?: MCPConnectionConfig | null }
): boolean {
  if (platform === 'google_analytics') return Boolean(row.property_id);
  if (platform === 'google_ads') return Boolean(row.config?.customerId);
  if (platform === 'meta_ads') return Boolean(row.config?.adAccountId);
  if (platform === 'shopify') return Boolean(row.config?.shopDomain);
  if (platform === 'canva') return Boolean(row.config?.canvaUserId);
  if (platform === 'instagram') return Boolean(row.config?.instagramBusinessAccountId);
  if (platform === 'mailchimp') {
    return Boolean(row.config?.mailchimpDatacenter && row.config?.mailchimpListId);
  }
  return false;
}

function shopifyRedirectUri(): string {
  const uri =
    process.env.SHOPIFY_OAUTH_REDIRECT_URI?.trim() ||
    process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  if (!uri) {
    throw new Error('SHOPIFY_OAUTH_REDIRECT_URI or GOOGLE_OAUTH_REDIRECT_URI is required');
  }
  return uri;
}

function shopifyScopes(): string {
  return process.env.SHOPIFY_SCOPES?.trim() || DEFAULT_SHOPIFY_SCOPES;
}

type ConnectionRow = {
  id: string;
  platform: MCPPlatform;
  credentials_encrypted: string;
  property_id: string | null;
  config: MCPConnectionConfig | null;
  last_sync_at?: Date | null;
};

export class MCPConnectionService {
  async getActiveConnections(organizationId: string): Promise<MCPConnection[]> {
    const result = await query<ConnectionRow>(
      `SELECT id, platform, credentials_encrypted, property_id, config
       FROM mcp_connections
       WHERE organization_id = $1 AND status = 'connected'`,
      [organizationId]
    );

    const connections: MCPConnection[] = [];

    for (const conn of result.rows) {
      const credentials = await this.ensureValidTokens(
        organizationId,
        conn.platform,
        conn.credentials_encrypted
      );
      const platform = conn.platform;

      connections.push({
        id: conn.id,
        platform,
        name: PLATFORM_NAMES[platform],
        url: PLATFORM_URLS[platform],
        accessToken: credentials.access_token,
        propertyId: conn.property_id ?? undefined,
        config: conn.config ?? undefined,
      });
    }

    return connections;
  }

  async getConnectionRows(organizationId: string): Promise<ConnectionRow[]> {
    const result = await query<ConnectionRow>(
      `SELECT id, platform, credentials_encrypted, property_id, config, last_sync_at
       FROM mcp_connections
       WHERE organization_id = $1 AND status = 'connected'`,
      [organizationId]
    );

    return result.rows.map((row) => ({
      ...row,
      config: (row.config as MCPConnectionConfig) ?? {},
    }));
  }

  async hasPlatform(organizationId: string, platform: MCPPlatform): Promise<boolean> {
    const result = await query(
      `SELECT 1 FROM mcp_connections
       WHERE organization_id = $1 AND platform = $2 AND status = 'connected'
       LIMIT 1`,
      [organizationId, platform]
    );
    return result.rowCount !== null && result.rowCount > 0;
  }

  async connectAnalytics(organizationId: string, oauthCode: string): Promise<void> {
    const tokens = await this.exchangeGoogleOAuthCode(oauthCode);
    await this.upsertConnection(organizationId, 'google_analytics', tokens);
  }

  async connectGoogleAds(organizationId: string, oauthCode: string): Promise<void> {
    const tokens = await this.exchangeGoogleOAuthCode(oauthCode);
    await this.upsertConnection(organizationId, 'google_ads', tokens, true);
  }

  async connectMetaAds(organizationId: string, oauthCode: string): Promise<void> {
    const shortLived = await this.exchangeMetaOAuthCode(oauthCode);
    const tokens = await this.exchangeMetaLongLivedToken(shortLived.access_token);
    await this.upsertConnection(organizationId, 'meta_ads', tokens, true);
  }

  /** Instagram Business Login — direct @keylo.london auth (recommended). */
  async connectInstagramBusiness(organizationId: string, oauthCode: string): Promise<void> {
    const { tokens, igUserId } = await exchangeInstagramBusinessCode(oauthCode);
    const username = await fetchInstagramBusinessUsername(tokens.access_token);
    await this.upsertConnection(organizationId, 'instagram', tokens, true, {
      instagramBusinessAccountId: igUserId,
      instagramUsername: username,
      instagramLoginMethod: 'instagram_business',
    });
  }

  /** Canva Connect OAuth (PKCE) — design create/export for Instagram workflow. */
  async connectCanva(
    organizationId: string,
    oauthCode: string,
    codeVerifier: string
  ): Promise<void> {
    const { tokens, profile } = await exchangeCanvaCode(oauthCode, codeVerifier);
    await this.upsertConnection(organizationId, 'canva', tokens, true, {
      canvaUserId: profile.id,
      canvaDisplayName: profile.displayName,
    });
  }

  getCanvaOAuthAuthorizeUrl(organizationId: string): { url: string; codeVerifier: string } {
    if (!isCanvaConnectConfigured()) {
      throw new Error(
        'Canva Connect is not configured. Set CANVA_CLIENT_ID, CANVA_CLIENT_SECRET, and redirect URI in .env.'
      );
    }

    const { codeVerifier, codeChallenge } = generateCanvaPkce();
    const state = formatOAuthState(organizationId, 'canva', { codeVerifier });
    const url = buildCanvaAuthorizeUrl({ organizationId, state, codeChallenge });
    return { url, codeVerifier };
  }

  getInstagramOAuthAuthorizeUrl(
    organizationId: string,
    options?: { reconnect?: boolean }
  ): string {
    if (!isInstagramBusinessLoginConfigured()) {
      throw new Error(
        'Instagram Business Login is not configured. Set INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET, and redirect URI in .env.'
      );
    }

    const creds = instagramAppCredentials()!;

    const params = new URLSearchParams({
      client_id: creds.appId,
      redirect_uri: instagramOAuthRedirectUri(),
      response_type: 'code',
      scope: INSTAGRAM_BUSINESS_OAUTH_SCOPES,
      state: formatOAuthState(organizationId, 'instagram'),
    });

    if (options?.reconnect) {
      params.set('force_reauth', 'true');
    }

    return `https://www.instagram.com/oauth/authorize?${params}`;
  }

  async connectShopify(
    organizationId: string,
    oauthCode: string,
    shop: string
  ): Promise<void> {
    const shopDomain = normalizeShopDomain(shop);
    const { tokens, grantedScopes } = await this.exchangeShopifyOAuthCode(oauthCode, shopDomain);
    await this.upsertConnection(organizationId, 'shopify', tokens, true, {
      shopDomain,
      grantedScopes,
    });
  }

  getShopifyOAuthAuthorizeUrl(organizationId: string, shop: string): string {
    if (!isShopifyConfigured()) {
      throw new Error(
        'Shopify OAuth is not configured. Set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET in .env, then restart the API.'
      );
    }

    const shopDomain = normalizeShopDomain(shop);
    const clientId = process.env.SHOPIFY_CLIENT_ID!;
    const state = formatOAuthState(organizationId, 'shopify');

    const params = new URLSearchParams({
      client_id: clientId,
      scope: shopifyScopes(),
      redirect_uri: shopifyRedirectUri(),
      state,
    });

    return `https://${shopDomain}/admin/oauth/authorize?${params}`;
  }

  async getShopifyContext(
    organizationId: string
  ): Promise<{ accessToken: string; shopDomain: string } | null> {
    const row = await this.getConnectionRow(organizationId, 'shopify');
    if (!row?.config?.shopDomain) return null;

    const credentials = JSON.parse(
      decrypt(row.credentials_encrypted)
    ) as OAuthTokens;

    return {
      accessToken: credentials.access_token,
      shopDomain: row.config.shopDomain,
    };
  }

  async getPlatformConfig(
    organizationId: string,
    platform: MCPPlatform
  ): Promise<MCPConnectionConfig | null> {
    const row = await this.getConnectionRow(organizationId, platform);
    return row?.config ?? null;
  }

  async connectPlatform(
    organizationId: string,
    platform: MCPPlatform,
    tokens: OAuthTokens
  ): Promise<void> {
    await this.upsertConnection(organizationId, platform, tokens);
  }

  async listGoogleAnalyticsProperties(organizationId: string): Promise<GAPropertySummary[]> {
    const row = await this.getConnectionRow(organizationId, 'google_analytics');
    if (!row) {
      throw new Error('Google Analytics is not connected');
    }

    const credentials = await this.ensureValidTokens(
      organizationId,
      'google_analytics',
      row.credentials_encrypted
    );

    const response = await fetch(
      'https://analyticsadmin.googleapis.com/v1beta/accountSummaries',
      {
        headers: { Authorization: `Bearer ${credentials.access_token}` },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to list GA properties: ${error}`);
    }

    const data = (await response.json()) as {
      accountSummaries?: Array<{
        displayName?: string;
        propertySummaries?: Array<{ property?: string; displayName?: string }>;
      }>;
    };

    const properties: GAPropertySummary[] = [];

    for (const account of data.accountSummaries ?? []) {
      for (const property of account.propertySummaries ?? []) {
        if (!property.property) continue;
        properties.push({
          property: property.property,
          displayName: property.displayName ?? property.property,
          accountDisplayName: account.displayName ?? 'Account',
        });
      }
    }

    return properties;
  }

  async setGoogleAnalyticsProperty(
    organizationId: string,
    propertyId: string
  ): Promise<void> {
    const normalized = propertyId.startsWith('properties/')
      ? propertyId
      : `properties/${propertyId}`;

    const result = await query(
      `UPDATE mcp_connections
       SET property_id = $1, last_sync_at = NOW()
       WHERE organization_id = $2 AND platform = 'google_analytics' AND status = 'connected'`,
      [normalized, organizationId]
    );

    if (result.rowCount === 0) {
      throw new Error('Google Analytics is not connected');
    }
  }

  getOAuthAuthorizeUrl(organizationId: string, platform: MCPPlatform): string {
    if (!isGoogleOAuthConfigured()) {
      throw new Error(
        'Google OAuth is not configured. Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_OAUTH_REDIRECT_URI in .env, then restart the API.'
      );
    }

    if (platform === 'google_ads' && !isGoogleAdsConfigured()) {
      throw new Error(
        'Google Ads is not configured. Set GOOGLE_ADS_DEVELOPER_TOKEN in .env and enable the Google Ads API.'
      );
    }

    if (platform === 'meta_ads') {
      throw new Error('Use getMetaOAuthAuthorizeUrl for Meta Ads OAuth');
    }

    const scope =
      platform === 'google_ads'
        ? 'https://www.googleapis.com/auth/adwords'
        : 'https://www.googleapis.com/auth/analytics.readonly';

    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID!;
    const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI!;
    const state = formatOAuthState(organizationId, platform);

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope,
      access_type: 'offline',
      prompt: 'consent',
      state,
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  getMetaOAuthAuthorizeUrl(
    organizationId: string,
    options?: { reconnect?: boolean; includeInstagram?: boolean }
  ): string {
    if (!isMetaOAuthConfigured()) {
      throw new Error(
        'Meta OAuth is not configured. Set META_APP_ID, META_APP_SECRET, and META_OAUTH_REDIRECT_URI in .env, then restart the API.'
      );
    }

    const clientId = process.env.META_APP_ID!;
    const redirectUri = this.metaRedirectUri();
    const state = formatOAuthState(organizationId, 'meta_ads');

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: resolveMetaOAuthScopes(options?.includeInstagram ?? false),
      state,
    });

    if (options?.reconnect) {
      params.set('auth_type', 'rerequest');
    }

    if (options?.includeInstagram) {
      // Required by Meta for Instagram API with Facebook Login onboarding
      params.set('extras', JSON.stringify({ setup: { channel: 'IG_API_ONBOARDING' } }));
    }

    return `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth?${params}`;
  }

  async listMetaAdAccounts(organizationId: string): Promise<MetaAdAccountSummary[]> {
    const row = await this.getConnectionRow(organizationId, 'meta_ads');
    if (!row) {
      throw new Error('Meta Ads is not connected');
    }

    const credentials = await this.ensureValidTokens(
      organizationId,
      'meta_ads',
      row.credentials_encrypted
    );

    const url = new URL(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/me/adaccounts`
    );
    url.searchParams.set('fields', 'id,name,account_status');
    url.searchParams.set('limit', '100');
    url.searchParams.set('access_token', credentials.access_token);

    const response = await fetch(url);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to list Meta ad accounts: ${error}`);
    }

    const data = (await response.json()) as {
      data?: Array<{ id?: string; name?: string; account_status?: number }>;
    };

    const accounts: MetaAdAccountSummary[] = [];

    for (const account of data.data ?? []) {
      if (!account.id) continue;
      accounts.push({
        adAccountId: account.id,
        name: account.name ?? account.id,
        accountStatus: account.account_status,
      });
    }

    return accounts;
  }

  async setMetaAdAccount(organizationId: string, adAccountId: string): Promise<void> {
    const normalized = adAccountId.trim().startsWith('act_')
      ? adAccountId.trim()
      : `act_${adAccountId.replace(/[^\d]/g, '')}`;

    if (!/^act_\d+$/.test(normalized)) {
      throw new Error('Invalid Meta ad account ID');
    }

    const result = await query(
      `UPDATE mcp_connections
       SET config = COALESCE(config, '{}'::jsonb) || $1::jsonb, last_sync_at = NOW()
       WHERE organization_id = $2 AND platform = 'meta_ads' AND status = 'connected'`,
      [JSON.stringify({ adAccountId: normalized }), organizationId]
    );

    if (result.rowCount === 0) {
      throw new Error('Meta Ads is not connected');
    }
  }

  async getMetaAdsContext(
    organizationId: string
  ): Promise<{ accessToken: string; adAccountId: string } | null> {
    const row = await this.getConnectionRow(organizationId, 'meta_ads');
    if (!row?.config?.adAccountId) return null;

    const credentials = await this.ensureValidTokens(
      organizationId,
      'meta_ads',
      row.credentials_encrypted
    );

    return {
      accessToken: credentials.access_token,
      adAccountId: row.config.adAccountId,
    };
  }

  /** Facebook Page used for ads and Instagram — prefers saved config.pageId. */
  async getMetaPromotePageId(organizationId: string): Promise<string | null> {
    const row = await this.getConnectionRow(organizationId, 'meta_ads');
    if (!row) return null;

    if (row.config?.pageId) return row.config.pageId;

    const pageId = (await this.listMetaPages(organizationId))[0]?.pageId ?? null;
    if (pageId) {
      await this.mergeMetaConfig(organizationId, { pageId });
    }
    return pageId;
  }

  async listMetaPages(organizationId: string): Promise<MetaFacebookPageSummary[]> {
    const row = await this.getConnectionRow(organizationId, 'meta_ads');
    if (!row) {
      throw new Error('Meta Ads is not connected');
    }

    const credentials = await this.ensureValidTokens(
      organizationId,
      'meta_ads',
      row.credentials_encrypted
    );

    const version = process.env.META_GRAPH_API_VERSION ?? 'v21.0';
    const url = new URL(`https://graph.facebook.com/${version}/me/accounts`);
    url.searchParams.set('fields', 'id,name,instagram_business_account{id,username}');
    url.searchParams.set('limit', '25');
    url.searchParams.set('access_token', credentials.access_token);

    const response = await fetch(url);
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to list Meta Facebook Pages: ${error}`);
    }

    const data = (await response.json()) as {
      data?: Array<{
        id?: string;
        name?: string;
        instagram_business_account?: { id?: string; username?: string };
      }>;
    };

    const pages: MetaFacebookPageSummary[] = [];
    for (const page of data.data ?? []) {
      if (!page.id) continue;
      pages.push({
        pageId: page.id,
        name: page.name ?? page.id,
        instagramUsername: page.instagram_business_account?.username,
        instagramBusinessAccountId: page.instagram_business_account?.id,
      });
    }
    return pages;
  }

  async setMetaPage(organizationId: string, pageId: string): Promise<void> {
    const normalized = pageId.trim();
    if (!/^\d+$/.test(normalized)) {
      throw new Error('Invalid Facebook Page ID');
    }

    const pages = await this.listMetaPages(organizationId);
    const match = pages.find((p) => p.pageId === normalized);
    if (!match) {
      throw new Error('Facebook Page not found for this Meta user');
    }

    const result = await query(
      `UPDATE mcp_connections
       SET config = COALESCE(config, '{}'::jsonb)
         || $1::jsonb
         - 'instagramBusinessAccountId'
         - 'instagramUsername',
         last_sync_at = NOW()
       WHERE organization_id = $2 AND platform = 'meta_ads' AND status = 'connected'`,
      [
        JSON.stringify({
          pageId: normalized,
          pageName: match.name,
          ...(match.instagramBusinessAccountId
            ? {
                instagramBusinessAccountId: match.instagramBusinessAccountId,
                instagramUsername: match.instagramUsername,
              }
            : {}),
        }),
        organizationId,
      ]
    );

    if (result.rowCount === 0) {
      throw new Error('Meta Ads is not connected');
    }
  }

  private async mergeMetaConfig(
    organizationId: string,
    patch: Partial<MCPConnectionConfig>
  ): Promise<void> {
    await query(
      `UPDATE mcp_connections
       SET config = COALESCE(config, '{}'::jsonb) || $1::jsonb, last_sync_at = NOW()
       WHERE organization_id = $2 AND platform = 'meta_ads' AND status = 'connected'`,
      [JSON.stringify(patch), organizationId]
    );
  }

  private async mergeInstagramConfig(
    organizationId: string,
    patch: Partial<MCPConnectionConfig>
  ): Promise<void> {
    await query(
      `UPDATE mcp_connections
       SET config = COALESCE(config, '{}'::jsonb) || $1::jsonb, last_sync_at = NOW()
       WHERE organization_id = $2 AND platform = 'instagram' AND status = 'connected'`,
      [JSON.stringify(patch), organizationId]
    );
  }

  /**
   * Instagram MCP context — prefers Instagram Business Login, falls back to Page-linked Meta token.
   */
  async getInstagramContext(organizationId: string): Promise<InstagramContext | null> {
    const igRow = await this.getConnectionRow(organizationId, 'instagram');
    if (igRow?.config?.instagramBusinessAccountId) {
      try {
        const credentials = await this.ensureValidTokens(
          organizationId,
          'instagram',
          igRow.credentials_encrypted
        );
        let username = igRow.config.instagramUsername;
        if (!username) {
          username = await fetchInstagramBusinessUsername(credentials.access_token);
          if (username) {
            await this.mergeInstagramConfig(organizationId, { instagramUsername: username });
          }
        }
        return {
          accessToken: credentials.access_token,
          igUserId: igRow.config.instagramBusinessAccountId,
          username,
          graphHost: 'https://graph.instagram.com',
        };
      } catch (err) {
        console.warn(
          '[instagram] Business Login token invalid:',
          err instanceof Error ? err.message : err
        );
        return null;
      }
    }

    const row = await this.getConnectionRow(organizationId, 'meta_ads');
    if (!row) return null;

    const credentials = await this.ensureValidTokens(
      organizationId,
      'meta_ads',
      row.credentials_encrypted
    );

    let pageId = row.config?.pageId;
    if (!pageId) {
      try {
        pageId = (await this.getMetaPromotePageId(organizationId)) ?? undefined;
        if (pageId) {
          await this.mergeMetaConfig(organizationId, { pageId });
        }
      } catch (err) {
        console.warn(
          '[instagram] Meta page lookup failed:',
          err instanceof Error ? err.message : err
        );
        return null;
      }
    }
    if (!pageId) return null;

    try {
      const resolved = await resolveInstagramBusinessAccount(pageId, credentials.access_token);
      if (!resolved) return null;

      await this.mergeMetaConfig(organizationId, {
        pageId,
        instagramBusinessAccountId: resolved.id,
        instagramUsername: resolved.username,
        instagramLoginMethod: 'facebook_page',
      });

      return {
        accessToken: credentials.access_token,
        igUserId: resolved.id,
        pageId,
        username: resolved.username,
        graphHost: 'https://graph.facebook.com',
      };
    } catch (err) {
      console.warn(
        '[instagram] Meta fallback IG lookup failed:',
        err instanceof Error ? err.message : err
      );
      return null;
    }
  }

  async isInstagramReady(organizationId: string): Promise<boolean> {
    try {
      const ctx = await this.getInstagramContext(organizationId);
      return ctx !== null;
    } catch (err) {
      console.warn(
        '[instagram] readiness check failed:',
        err instanceof Error ? err.message : err
      );
      return false;
    }
  }

  async getCanvaContext(organizationId: string): Promise<{ accessToken: string } | null> {
    const row = await this.getConnectionRow(organizationId, 'canva');
    if (!row?.config?.canvaUserId) return null;

    const credentials = await this.ensureValidTokens(
      organizationId,
      'canva',
      row.credentials_encrypted
    );
    return { accessToken: credentials.access_token };
  }

  async isCanvaReady(organizationId: string): Promise<boolean> {
    try {
      const ctx = await this.getCanvaContext(organizationId);
      return ctx !== null;
    } catch (err) {
      console.warn('[canva] readiness check failed:', err instanceof Error ? err.message : err);
      return false;
    }
  }

  async connectMailchimp(
    organizationId: string,
    apiKey: string,
    opts?: { defaultListId?: string | null }
  ): Promise<{ accountName: string; datacenter: string; lists: Array<{ id: string; name: string }> }> {
    const { parseMailchimpApiKey, mailchimpPing, mailchimpListAudiences } = await import(
      '../lib/mailchimpClient.js'
    );
    const parsed = parseMailchimpApiKey(apiKey);
    const ctx = {
      apiKey: parsed.apiKey,
      datacenter: parsed.datacenter,
      defaultListId: opts?.defaultListId ?? null,
    };
    const ping = await mailchimpPing(ctx);
    const lists = await mailchimpListAudiences(ctx);
    const defaultList =
      (opts?.defaultListId && lists.find((l) => l.id === opts.defaultListId)) || lists[0] || null;

    await this.upsertConnection(
      organizationId,
      'mailchimp',
      { access_token: parsed.apiKey, token_type: 'Bearer' },
      true,
      {
        mailchimpDatacenter: parsed.datacenter,
        mailchimpAccountName: ping.accountName,
        mailchimpListId: defaultList?.id,
        mailchimpListName: defaultList?.name,
      }
    );

    return {
      accountName: ping.accountName,
      datacenter: parsed.datacenter,
      lists: lists.map((l) => ({ id: l.id, name: l.name })),
    };
  }

  async getMailchimpContext(organizationId: string): Promise<import('../lib/mailchimpClient.js').MailchimpContext | null> {
    const row = await this.getConnectionRow(organizationId, 'mailchimp');
    if (!row?.config?.mailchimpDatacenter) return null;
    const credentials = await this.ensureValidTokens(
      organizationId,
      'mailchimp',
      row.credentials_encrypted
    );
    return {
      apiKey: credentials.access_token,
      datacenter: row.config.mailchimpDatacenter,
      defaultListId: row.config.mailchimpListId ?? null,
      accountName: row.config.mailchimpAccountName ?? null,
    };
  }

  async isMailchimpReady(organizationId: string): Promise<boolean> {
    try {
      const ctx = await this.getMailchimpContext(organizationId);
      return Boolean(ctx?.defaultListId);
    } catch (err) {
      console.warn(
        '[mailchimp] readiness check failed:',
        err instanceof Error ? err.message : err
      );
      return false;
    }
  }

  async setMailchimpDefaultList(
    organizationId: string,
    listId: string,
    listName?: string
  ): Promise<void> {
    const id = listId.trim();
    if (!id) throw new Error('Mailchimp audience id is required');

    let name = listName?.trim() || null;
    if (!name) {
      const ctx = await this.getMailchimpContext(organizationId);
      if (!ctx) throw new Error('Mailchimp is not connected');
      const { mailchimpListAudiences } = await import('../lib/mailchimpClient.js');
      const lists = await mailchimpListAudiences(ctx);
      name = lists.find((l) => l.id === id)?.name ?? null;
    }

    const result = await query(
      `UPDATE mcp_connections
       SET config = COALESCE(config, '{}'::jsonb) || $1::jsonb, last_sync_at = NOW()
       WHERE organization_id = $2 AND platform = 'mailchimp' AND status = 'connected'`,
      [
        JSON.stringify({
          mailchimpListId: id,
          ...(name ? { mailchimpListName: name } : {}),
        }),
        organizationId,
      ]
    );

    if (result.rowCount === 0) {
      throw new Error('Mailchimp is not connected');
    }
  }

  async listGoogleAdsCustomers(organizationId: string): Promise<GoogleAdsCustomerSummary[]> {
    const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
    if (!devToken) {
      throw new Error('GOOGLE_ADS_DEVELOPER_TOKEN is not configured');
    }

    const row = await this.getConnectionRow(organizationId, 'google_ads');
    if (!row) {
      throw new Error('Google Ads is not connected');
    }

    const credentials = await this.ensureValidTokens(
      organizationId,
      'google_ads',
      row.credentials_encrypted
    );

    const apiVersion = process.env.GOOGLE_ADS_API_VERSION ?? 'v21';
    const response = await fetch(
      `https://googleads.googleapis.com/${apiVersion}/customers:listAccessibleCustomers`,
      {
        headers: {
          Authorization: `Bearer ${credentials.access_token}`,
          'developer-token': devToken,
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      const hint =
        response.status === 404
          ? ' Google Ads API v18 is sunset — set GOOGLE_ADS_API_VERSION=v20 (or newer) in .env and rebuild the API.'
          : '';
      throw new Error(`Failed to list Google Ads customers: ${error.slice(0, 500)}${hint}`);
    }

    const data = (await response.json()) as { resourceNames?: string[] };
    const customers: GoogleAdsCustomerSummary[] = [];

    for (const resource of data.resourceNames ?? []) {
      const match = resource.match(/customers\/(\d+)/);
      if (!match) continue;
      const customerId = match[1];
      customers.push({
        customerId,
        resourceName: resource,
        displayName: `Customer ${customerId}`,
      });
    }

    return customers;
  }

  async setGoogleAdsCustomer(organizationId: string, customerId: string): Promise<void> {
    const normalized = customerId.replace(/[^\d]/g, '');
    if (!normalized) {
      throw new Error('Invalid Google Ads customer ID');
    }

    const result = await query(
      `UPDATE mcp_connections
       SET config = COALESCE(config, '{}'::jsonb) || $1::jsonb, last_sync_at = NOW()
       WHERE organization_id = $2 AND platform = 'google_ads' AND status = 'connected'`,
      [JSON.stringify({ customerId: normalized }), organizationId]
    );

    if (result.rowCount === 0) {
      throw new Error('Google Ads is not connected');
    }
  }

  async getGoogleAdsContext(
    organizationId: string
  ): Promise<{ accessToken: string; customerId: string } | null> {
    const row = await this.getConnectionRow(organizationId, 'google_ads');
    if (!row?.config?.customerId) return null;

    const credentials = await this.ensureValidTokens(
      organizationId,
      'google_ads',
      row.credentials_encrypted
    );

    return {
      accessToken: credentials.access_token,
      customerId: row.config.customerId,
    };
  }

  private async getConnectionRow(
    organizationId: string,
    platform: MCPPlatform
  ): Promise<ConnectionRow | null> {
    const result = await query<ConnectionRow>(
      `SELECT id, platform, credentials_encrypted, property_id, config
       FROM mcp_connections
       WHERE organization_id = $1 AND platform = $2 AND status = 'connected'
       LIMIT 1`,
      [organizationId, platform]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      ...row,
      config: (row.config as MCPConnectionConfig) ?? {},
    };
  }

  private async ensureValidTokens(
    organizationId: string,
    platform: MCPPlatform,
    credentialsEncrypted: string
  ): Promise<OAuthTokens> {
    const credentials = JSON.parse(decrypt(credentialsEncrypted)) as OAuthTokens;

    if (!this.isExpired(credentials)) {
      return credentials;
    }

    if (platform === 'meta_ads') {
      const refreshed = await this.exchangeMetaLongLivedToken(credentials.access_token);
      await this.updateCredentials(organizationId, platform, refreshed);
      return refreshed;
    }

    if (platform === 'instagram') {
      const refreshed = await refreshInstagramBusinessToken(credentials.access_token);
      await this.updateCredentials(organizationId, platform, refreshed);
      return refreshed;
    }

    if (platform === 'canva') {
      if (!credentials.refresh_token) {
        throw new Error('Canva access token expired — reconnect Canva in Integrations');
      }
      const refreshed = await refreshCanvaToken(credentials.refresh_token);
      await this.updateCredentials(organizationId, platform, refreshed);
      return refreshed;
    }

    if (platform === 'shopify') {
      return credentials;
    }

    if (platform === 'mailchimp') {
      return credentials;
    }

    if (!credentials.refresh_token) {
      throw new Error(`${platform} access token expired and no refresh token is available`);
    }

    const refreshed = await this.refreshGoogleTokens(credentials.refresh_token);
    await this.updateCredentials(organizationId, platform, refreshed);
    return refreshed;
  }

  private metaRedirectUri(): string {
    const uri =
      process.env.META_OAUTH_REDIRECT_URI?.trim() ||
      process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
    if (!uri) {
      throw new Error('META_OAUTH_REDIRECT_URI or GOOGLE_OAUTH_REDIRECT_URI is required');
    }
    return uri;
  }

  private async exchangeMetaOAuthCode(code: string): Promise<OAuthTokens> {
    const clientId = process.env.META_APP_ID?.trim();
    const clientSecret = process.env.META_APP_SECRET?.trim();
    if (!clientId || !clientSecret) {
      throw new Error('Meta OAuth is not configured (META_APP_ID / META_APP_SECRET)');
    }

    const url = new URL(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`
    );
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('client_secret', clientSecret);
    url.searchParams.set('redirect_uri', this.metaRedirectUri());
    url.searchParams.set('code', code);

    const response = await fetch(url);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Meta OAuth token exchange failed: ${error}`);
    }

    return (await response.json()) as OAuthTokens;
  }

  private async exchangeMetaLongLivedToken(shortLivedToken: string): Promise<OAuthTokens> {
    const clientId = process.env.META_APP_ID?.trim();
    const clientSecret = process.env.META_APP_SECRET?.trim();
    if (!clientId || !clientSecret) {
      throw new Error('Meta OAuth is not configured');
    }

    const url = new URL(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`
    );
    url.searchParams.set('grant_type', 'fb_exchange_token');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('client_secret', clientSecret);
    url.searchParams.set('fb_exchange_token', shortLivedToken);

    const response = await fetch(url);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Meta long-lived token exchange failed: ${error}`);
    }

    const tokens = (await response.json()) as OAuthTokens;
    return this.withExpiry(tokens);
  }

  private isExpired(credentials: OAuthTokens): boolean {
    if (!credentials.expires_at) return false;
    return Date.now() >= credentials.expires_at - TOKEN_REFRESH_BUFFER_MS;
  }

  private withExpiry(tokens: OAuthTokens): OAuthTokens {
    if (!tokens.expires_in) return tokens;
    return {
      ...tokens,
      expires_at: Date.now() + tokens.expires_in * 1000,
    };
  }

  private async upsertConnection(
    organizationId: string,
    platform: MCPPlatform,
    tokens: OAuthTokens,
    resetConfig = false,
    initialConfig: MCPConnectionConfig = {}
  ): Promise<void> {
    const encrypted = encrypt(JSON.stringify(this.withExpiry(tokens)));
    const configJson = JSON.stringify(resetConfig ? initialConfig : {});

    await query(
      `INSERT INTO mcp_connections (organization_id, platform, credentials_encrypted, status, config)
       VALUES ($1, $2, $3, 'connected', $5::jsonb)
       ON CONFLICT (organization_id, platform)
       DO UPDATE SET
         credentials_encrypted = EXCLUDED.credentials_encrypted,
         status = 'connected',
         config = CASE
           WHEN $4 THEN $5::jsonb
           ELSE mcp_connections.config
         END,
         last_sync_at = NOW()`,
      [organizationId, platform, encrypted, resetConfig, configJson]
    );
  }

  private async exchangeShopifyOAuthCode(
    code: string,
    shopDomain: string
  ): Promise<{ tokens: OAuthTokens; grantedScopes: string }> {
    const clientId = process.env.SHOPIFY_CLIENT_ID?.trim();
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      throw new Error('Shopify OAuth is not configured');
    }

    const response = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Shopify OAuth token exchange failed: ${error}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      scope?: string;
    };

    const grantedScopes = data.scope?.trim() ?? '';
    if (!grantedScopes.includes('read_products') || !grantedScopes.includes('read_orders')) {
      console.warn(
        `[shopify-oauth] token missing required scopes for ${shopDomain}. granted="${grantedScopes}" expected="${shopifyScopes()}"`
      );
    }

    return {
      tokens: {
        access_token: data.access_token,
        token_type: 'Bearer',
      },
      grantedScopes,
    };
  }

  private async updateCredentials(
    organizationId: string,
    platform: MCPPlatform,
    tokens: OAuthTokens
  ): Promise<void> {
    const encrypted = encrypt(JSON.stringify(this.withExpiry(tokens)));

    await query(
      `UPDATE mcp_connections
       SET credentials_encrypted = $1, last_sync_at = NOW()
       WHERE organization_id = $2 AND platform = $3 AND status = 'connected'`,
      [encrypted, organizationId, platform]
    );
  }

  private async exchangeGoogleOAuthCode(code: string): Promise<OAuthTokens> {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error(
        'Google OAuth is not configured. Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_OAUTH_REDIRECT_URI.'
      );
    }

    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google OAuth token exchange failed: ${error}`);
    }

    return (await response.json()) as OAuthTokens;
  }

  private async refreshGoogleTokens(refreshToken: string): Promise<OAuthTokens> {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('Google OAuth is not configured');
    }

    const body = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    });

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google OAuth token refresh failed: ${error}`);
    }

    const tokens = (await response.json()) as OAuthTokens;
    return {
      ...tokens,
      refresh_token: tokens.refresh_token ?? refreshToken,
    };
  }
}
