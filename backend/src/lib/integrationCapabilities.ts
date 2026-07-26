import type { MCPPlatform } from '../types/index.js';
import { getMcpDefinition, type McpTier } from './mcpRegistry.js';
import {
  isGoogleAdsConfigured,
  isGoogleOAuthConfigured,
  isCanvaConnectConfigured,
  isInstagramBusinessLoginConfigured,
  isMetaOAuthConfigured,
  isShopifyConfigured,
  isUnsplashMcpConfigured,
  isRunwayMcpConfigured,
} from '../services/mcpConnectionService.js';
import { isGoogleAdsEnabled } from './googleFeatureFlags.js';

export type IntegrationCapability = {
  id: string;
  platform: MCPPlatform | null;
  name: string;
  implemented: boolean;
  oauthConfigured: boolean;
  uiStatus: 'available' | 'coming_soon' | 'planned';
  /** MCP tier — analytical_core platforms drive plans and goal loop */
  mcpTier?: McpTier;
  feedsPlans?: boolean;
  /** Short message for end users when Connect is not offered. */
  userMessage?: string;
};

function withMcpMeta(platform: MCPPlatform, base: IntegrationCapability): IntegrationCapability {
  const def = getMcpDefinition(platform);
  if (!def) return base;
  return {
    ...base,
    mcpTier: def.tier,
    feedsPlans: def.feedsPlans,
  };
}

/**
 * Single source of truth for what the backend can actually connect.
 * UI must not show Connect for integrations where implemented === false.
 */
export function getIntegrationCapabilities(): IntegrationCapability[] {
  const googleOAuth = isGoogleOAuthConfigured();

  return [
    withMcpMeta('google_analytics', {
      id: 'google_analytics',
      platform: 'google_analytics',
      name: 'Google Analytics',
      implemented: true,
      oauthConfigured: googleOAuth,
      uiStatus: 'available',
      userMessage: googleOAuth
        ? undefined
        : 'Google sign-in is not enabled for this app yet. Contact your administrator or support.',
    }),
    withMcpMeta('google_ads', {
      id: 'google_ads',
      platform: 'google_ads',
      name: 'Google Ads',
      implemented: isGoogleAdsEnabled() && isGoogleAdsConfigured(),
      oauthConfigured: googleOAuth,
      uiStatus: isGoogleAdsEnabled() && isGoogleAdsConfigured() ? 'available' : 'coming_soon',
      userMessage: !isGoogleAdsEnabled()
        ? 'Google Ads is not enabled yet — use Meta Ads for paid campaigns. Set GOOGLE_ADS_ENABLED=true when ready.'
        : isGoogleAdsConfigured()
          ? undefined
          : 'Google Ads is not available on your workspace yet. Contact support to enable it.',
    }),
    withMcpMeta('meta_ads', {
      id: 'meta_ads',
      platform: 'meta_ads',
      name: 'Meta Ads',
      implemented: isMetaOAuthConfigured(),
      oauthConfigured: isMetaOAuthConfigured(),
      uiStatus: isMetaOAuthConfigured() ? 'available' : 'coming_soon',
      userMessage: isMetaOAuthConfigured()
        ? undefined
        : 'Meta Ads is not available on your workspace yet. Contact support to enable it.',
    }),
    withMcpMeta('shopify', {
      id: 'shopify',
      platform: 'shopify',
      name: 'Shopify',
      implemented: isShopifyConfigured(),
      oauthConfigured: isShopifyConfigured(),
      uiStatus: isShopifyConfigured() ? 'available' : 'coming_soon',
      userMessage: isShopifyConfigured()
        ? undefined
        : 'Shopify is not available on your workspace yet. Contact support to enable it.',
    }),
    withMcpMeta('unsplash', {
      id: 'unsplash',
      platform: 'unsplash',
      name: 'Unsplash',
      implemented: isUnsplashMcpConfigured(),
      oauthConfigured: false,
      uiStatus: isUnsplashMcpConfigured() ? 'available' : 'coming_soon',
      userMessage: isUnsplashMcpConfigured()
        ? undefined
        : 'Unsplash MCP requires UNSPLASH_ACCESS_KEY on the server. Get a free key at unsplash.com/developers.',
    }),
    withMcpMeta('canva', {
      id: 'canva',
      platform: 'canva',
      name: 'Canva',
      implemented: isCanvaConnectConfigured(),
      oauthConfigured: isCanvaConnectConfigured(),
      uiStatus: isCanvaConnectConfigured() ? 'available' : 'coming_soon',
      userMessage: isCanvaConnectConfigured()
        ? undefined
        : 'Canva requires CANVA_CLIENT_ID and CANVA_CLIENT_SECRET from canva.dev — create a Connect integration and add redirect URI.',
    }),
    withMcpMeta('runway', {
      id: 'runway',
      platform: 'runway',
      name: 'Runway',
      implemented: isRunwayMcpConfigured(),
      oauthConfigured: false,
      uiStatus: isRunwayMcpConfigured() ? 'available' : 'coming_soon',
      userMessage: isRunwayMcpConfigured()
        ? undefined
        : 'Runway MCP requires RUNWAY_API_KEY on the server. Get a key at https://dev.runwayml.com/ (API credits are separate from the Runway app).',
    }),
    withMcpMeta('instagram', {
      id: 'instagram',
      platform: 'instagram',
      name: 'Instagram',
      implemented: isInstagramBusinessLoginConfigured(),
      oauthConfigured: isInstagramBusinessLoginConfigured(),
      uiStatus: isInstagramBusinessLoginConfigured() ? 'available' : 'coming_soon',
      userMessage: isInstagramBusinessLoginConfigured()
        ? undefined
        : 'Instagram Business Login requires INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET (from Instagram → API setup with Instagram login) plus redirect URI on the server.',
    }),
    withMcpMeta('mailchimp', {
      id: 'mailchimp',
      platform: 'mailchimp',
      name: 'Mailchimp',
      implemented: true,
      oauthConfigured: false,
      uiStatus: 'available',
      userMessage: undefined,
    }),
    {
      id: 'meta_ad_library',
      platform: null,
      name: 'Meta Ad Library',
      implemented: false,
      oauthConfigured: false,
      uiStatus: 'planned',
      userMessage: 'Coming soon — competitor ad creative for inspiration (estimates only).',
    },
    {
      id: 'google_ads_transparency',
      platform: null,
      name: 'Google Ads Transparency Center',
      implemented: false,
      oauthConfigured: false,
      uiStatus: 'planned',
      userMessage: 'Coming soon — see competitor Search, Display, and YouTube ads.',
    },
    {
      id: 'spyfu',
      platform: null,
      name: 'SpyFu / keyword intel',
      implemented: false,
      oauthConfigured: false,
      uiStatus: 'planned',
      userMessage: 'Coming soon — keyword and PPC research (directional estimates).',
    },
    {
      id: 'google_trends',
      platform: null,
      name: 'Google Trends & search demand',
      implemented: false,
      oauthConfigured: false,
      uiStatus: 'planned',
      userMessage: 'Coming soon — seasonality and demand trends.',
    },
    {
      id: 'similarweb',
      platform: null,
      name: 'SimilarWeb',
      implemented: false,
      oauthConfigured: false,
      uiStatus: 'planned',
      userMessage: 'Coming soon — estimated channel mix for competitors.',
    },
    {
      id: 'reviews',
      platform: null,
      name: 'Review platforms',
      implemented: false,
      oauthConfigured: false,
      uiStatus: 'planned',
      userMessage: 'Coming soon — themes from customer reviews.',
    },
  ];
}
