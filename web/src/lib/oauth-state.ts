export type OAuthPlatform =
  | 'google_analytics'
  | 'google_ads'
  | 'meta_ads'
  | 'shopify'
  | 'canva'
  | 'instagram';

export function parseOAuthState(state: string): {
  organizationId: string;
  platform: OAuthPlatform;
  codeVerifier?: string;
} {
  const trimmed = state.trim();
  const parts = trimmed.split(':');
  if (parts.length >= 2) {
    const organizationId = parts[0];
    const platform = parts[1];
    if (
      platform === 'google_ads' ||
      platform === 'google_analytics' ||
      platform === 'meta_ads' ||
      platform === 'shopify' ||
      platform === 'canva' ||
      platform === 'instagram'
    ) {
      if (platform === 'canva' && parts.length >= 3) {
        return { organizationId, platform, codeVerifier: parts.slice(2).join(':') };
      }
      return { organizationId, platform };
    }
  }
  return { organizationId: trimmed, platform: 'google_analytics' };
}

export function oauthSuccessQuery(platform: OAuthPlatform): string {
  if (platform === 'google_ads') return 'connected_ads=1';
  if (platform === 'meta_ads') return 'connected_meta=1';
  if (platform === 'instagram') return 'connected_instagram=1';
  if (platform === 'canva') return 'connected_canva=1';
  if (platform === 'shopify') return 'connected_shopify=1';
  return 'connected=1';
}
