import type { MCPPlatform } from '../types/index.js';
import { mcpBridgePublicUrl } from './mcpBridgeToken.js';

export type McpTier = 'analytical_core' | 'commerce' | 'actuation';

export type McpDeployMode = 'hosted_official' | 'hundres_bridge' | 'external';

export type McpPlatformDefinition = {
  platform: MCPPlatform;
  /** MCP server name passed to Claude API */
  serverName: string;
  tier: McpTier;
  deployMode: McpDeployMode;
  /** Human label for UI and docs */
  label: string;
  /** Whether snapshots feed plan generation (ground truth) */
  feedsPlans: boolean;
  /** Whether this platform supports gated writes via MCP */
  supportsWrites: boolean;
  resolvePublicUrl: () => string;
};

const GA_OFFICIAL_URL = 'https://analytics-mcp.googleapis.com/mcp/v1';

/**
 * Single registry for all MCP integrations.
 * Analytical core platforms are listed first — they drive plans, workers, and goal loop.
 */
export const MCP_PLATFORM_REGISTRY: McpPlatformDefinition[] = [
  {
    platform: 'google_analytics',
    serverName: 'analytics-mcp',
    tier: 'analytical_core',
    deployMode: 'hundres_bridge',
    label: 'Google Analytics',
    feedsPlans: true,
    supportsWrites: false,
    resolvePublicUrl: () => {
      const official = process.env.ANALYTICS_MCP_OFFICIAL_URL?.trim();
      if (official) return official.replace(/\/$/, '');
      return mcpBridgePublicUrl('google_analytics');
    },
  },
  {
    platform: 'google_ads',
    serverName: 'google-ads-mcp',
    tier: 'analytical_core',
    deployMode: 'hundres_bridge',
    label: 'Google Ads',
    feedsPlans: true,
    supportsWrites: false,
    resolvePublicUrl: () => mcpBridgePublicUrl('google_ads'),
  },
  {
    platform: 'meta_ads',
    serverName: 'meta-ads-mcp',
    tier: 'analytical_core',
    deployMode: 'hundres_bridge',
    label: 'Meta Ads',
    feedsPlans: true,
    supportsWrites: false,
    resolvePublicUrl: () => mcpBridgePublicUrl('meta_ads'),
  },
  {
    platform: 'shopify',
    serverName: 'shopify',
    tier: 'commerce',
    deployMode: 'hundres_bridge',
    label: 'Shopify',
    feedsPlans: true,
    supportsWrites: true,
    resolvePublicUrl: () => mcpBridgePublicUrl('shopify'),
  },
  {
    platform: 'unsplash',
    serverName: 'unsplash',
    tier: 'actuation',
    deployMode: 'hundres_bridge',
    label: 'Unsplash',
    feedsPlans: false,
    supportsWrites: false,
    resolvePublicUrl: () => mcpBridgePublicUrl('unsplash'),
  },
  {
    platform: 'instagram',
    serverName: 'instagram',
    tier: 'actuation',
    deployMode: 'hundres_bridge',
    label: 'Instagram',
    feedsPlans: false,
    supportsWrites: true,
    resolvePublicUrl: () => mcpBridgePublicUrl('instagram'),
  },
];

export const ANALYTICAL_CORE_PLATFORMS = MCP_PLATFORM_REGISTRY.filter(
  (p) => p.tier === 'analytical_core'
).map((p) => p.platform);

export function getMcpDefinition(platform: MCPPlatform): McpPlatformDefinition | undefined {
  return MCP_PLATFORM_REGISTRY.find((p) => p.platform === platform);
}

export function getGaOfficialMcpUrl(): string {
  return process.env.ANALYTICS_MCP_OFFICIAL_URL?.trim()?.replace(/\/$/, '') || GA_OFFICIAL_URL;
}

/** Platforms ordered for Claude mcp_servers — analytical core first. */
export function mcpPlatformsByPriority(platforms: MCPPlatform[]): MCPPlatform[] {
  const order = MCP_PLATFORM_REGISTRY.map((p) => p.platform);
  return [...platforms].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}
