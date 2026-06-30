import type { MCPPlatform } from '../types/index.js';

const PLATFORMS: MCPPlatform[] = [
  'google_analytics',
  'google_ads',
  'meta_ads',
  'shopify',
  'instagram',
];

export function formatOAuthState(organizationId: string, platform: MCPPlatform): string {
  return `${organizationId}:${platform}`;
}

export function parseOAuthState(state: string): { organizationId: string; platform: MCPPlatform } {
  const trimmed = state.trim();
  const colon = trimmed.indexOf(':');
  if (colon > 0) {
    const organizationId = trimmed.slice(0, colon);
    const platform = trimmed.slice(colon + 1) as MCPPlatform;
    if (PLATFORMS.includes(platform)) {
      return { organizationId, platform };
    }
  }
  return { organizationId: trimmed, platform: 'google_analytics' };
}
