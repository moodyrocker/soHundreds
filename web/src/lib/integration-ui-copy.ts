/** Plain-language copy for marketers — no .env or console steps. */

export const INTEGRATION_UNAVAILABLE = {
  googleSignIn:
    'Google sign-in is not enabled for this app yet. Contact your Hundres administrator or support to turn it on.',
  googleAds:
    'Google Ads is not available on your workspace yet. Contact support if you need paid search data in your plans.',
  metaAds:
    'Meta (Facebook & Instagram) Ads is not available on your workspace yet. Contact support to enable it.',
  shopify:
    'Shopify is not available on your workspace yet. Contact support to enable store linking.',
  unsplash:
    'Unsplash is not enabled yet. Your administrator needs to add UNSPLASH_ACCESS_KEY on the server.',
  instagram:
    'Instagram publishing is not available yet. Your workspace needs Meta OAuth configured.',
  comingSoon: 'This integration is on our roadmap. You can still get strong plans using the sources above.',
} as const;

export const INTEGRATION_HELP = {
  googleAnalytics:
    'Sign in with the Google account that owns your website analytics, then choose your GA4 property.',
  googleAds:
    'Sign in with Google, then pick the Ads account you use for campaigns.',
  metaAds:
    'Sign in with Meta, then choose the ad account you run ads from. Use Reconnect to grant your Facebook Page and Instagram publishing permissions.',
  shopify:
    'Enter your Shopify store address (from your admin URL), then approve read-only access.',
  unsplash:
    'Enabled workspace-wide. Claude can search photos and embed them in Shopify blog posts with attribution.',
  instagram:
    'Connect with Instagram Business Login — sign in as @keylo.london. No Facebook Page picker needed.',
} as const;

export const INTEGRATION_QUICK_LINKS = {
  googleAnalytics: {
    label: 'Open Google Analytics',
    href: 'https://analytics.google.com/',
  },
  googleAds: {
    label: 'Open Google Ads',
    href: 'https://ads.google.com/',
  },
  metaAds: {
    label: 'Open Meta Ads Manager',
    href: 'https://adsmanager.facebook.com/',
  },
  shopify: {
    label: 'Open Shopify Admin',
    href: 'https://admin.shopify.com/',
  },
  unsplash: {
    label: 'Unsplash Developers',
    href: 'https://unsplash.com/developers',
  },
  instagram: {
    label: 'Meta Business Suite',
    href: 'https://business.facebook.com/latest/home',
  },
} as const;

export function googleAnalyticsConsoleUrl(propertyId?: string | null): string {
  if (!propertyId) return INTEGRATION_QUICK_LINKS.googleAnalytics.href;
  const id = propertyId.replace(/^properties\//, '');
  return `https://analytics.google.com/analytics/web/#/p${id}/reports/intelligenthome`;
}

export function googleAdsConsoleUrl(customerId?: string | null): string {
  if (!customerId) return INTEGRATION_QUICK_LINKS.googleAds.href;
  const id = customerId.replace(/\D/g, '');
  return `https://ads.google.com/aw/campaigns?ocid=${id}`;
}

export function metaAdsConsoleUrl(adAccountId?: string | null): string {
  if (!adAccountId) return INTEGRATION_QUICK_LINKS.metaAds.href;
  const id = adAccountId.replace(/^act_/, '');
  return `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${id}`;
}

export function shopifyAdminUrl(shopDomain?: string | null): string {
  if (!shopDomain) return INTEGRATION_QUICK_LINKS.shopify.href;
  const domain = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `https://${domain}/admin`;
}

/** Shown only when running a local/dev build — not for production end users. */
export const DEV_INTEGRATION_SETUP_HINT =
  'Developer: configure OAuth and API keys in the server environment (.env), then restart the API.';

export function showDevIntegrationHints(): boolean {
  return process.env.NODE_ENV === 'development';
}
