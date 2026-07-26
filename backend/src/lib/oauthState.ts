import type { MCPPlatform } from '../types/index.js';

const PLATFORMS: MCPPlatform[] = [
  'google_analytics',
  'google_ads',
  'meta_ads',
  'shopify',
  'canva',
  'instagram',
];

export function formatOAuthState(
  organizationId: string,
  platform: MCPPlatform,
  extra?: { codeVerifier?: string }
): string {
  if (platform === 'canva' && extra?.codeVerifier) {
    return `${organizationId}:canva:${extra.codeVerifier}`;
  }
  return `${organizationId}:${platform}`;
}

export function parseOAuthState(state: string): {
  organizationId: string;
  platform: MCPPlatform;
  codeVerifier?: string;
} {
  const trimmed = state.trim();
  const parts = trimmed.split(':');
  if (parts.length >= 2) {
    const organizationId = parts[0];
    const platform = parts[1] as MCPPlatform;
    if (PLATFORMS.includes(platform)) {
      if (platform === 'canva' && parts.length >= 3) {
        return { organizationId, platform, codeVerifier: parts.slice(2).join(':') };
      }
      return { organizationId, platform };
    }
  }
  return { organizationId: trimmed, platform: 'google_analytics' };
}
