export type OAuthPlatform = 'google_analytics' | 'google_ads' | 'meta_ads' | 'shopify' | 'instagram';

export function parseOAuthState(state: string): {
  organizationId: string;
  platform: OAuthPlatform;
} {
  const trimmed = state.trim();
  const colon = trimmed.indexOf(':');
  if (colon > 0) {
    const organizationId = trimmed.slice(0, colon);
    const platform = trimmed.slice(colon + 1);
    if (
      platform === 'google_ads' ||
      platform === 'google_analytics' ||
      platform === 'meta_ads' ||
      platform === 'shopify' ||
      platform === 'instagram'
    ) {
      return { organizationId, platform };
    }
  }
  return { organizationId: trimmed, platform: 'google_analytics' };
}

export function oauthSuccessQuery(platform: OAuthPlatform): string {
  if (platform === 'google_ads') return 'connected_ads=1';
  if (platform === 'meta_ads') return 'connected_meta=1';
  if (platform === 'instagram') return 'connected_instagram=1';
  if (platform === 'shopify') return 'connected_shopify=1';
  return 'connected=1';
}
