import type { MCPPlatform } from '../types/index.js';
import { createMcpBridgeToken } from '../lib/mcpBridgeToken.js';
import {
  ANALYTICAL_CORE_PLATFORMS,
  getMcpDefinition,
  MCP_PLATFORM_REGISTRY,
  type McpTier,
} from '../lib/mcpRegistry.js';
import { isConnectionReady, MCPConnectionService } from './mcpConnectionService.js';
import { GoogleAnalyticsSnapshotService } from './googleAnalyticsSnapshotService.js';
import { GoogleAdsSnapshotService } from './googleAdsSnapshotService.js';
import { MetaAdsSnapshotService } from './metaAdsSnapshotService.js';
import { ShopifyMcpService } from './shopifyMcpService.js';
import { invokeShopifyMcpTool } from '../mcp/shopifyMcpTools.js';
import { mcpUnsplashHealthProbe } from '../mcp/unsplashMcpTools.js';
import { isUnsplashConfigured } from '../lib/unsplashClient.js';
import { mcpInstagramHealthProbe } from '../mcp/instagramMcpTools.js';

export type McpServerToolInfo = {
  name: string;
  description: string;
};

export type McpServerStatus = {
  platform: MCPPlatform;
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
};

const TOOLS_BY_PLATFORM: Record<MCPPlatform, McpServerToolInfo[]> = {
  google_analytics: [
    { name: 'get_analytics_summary', description: 'GA4 overview + channels (28 days)' },
    { name: 'get_traffic_metrics', description: 'Alias for analytics summary' },
  ],
  google_ads: [{ name: 'get_ads_performance', description: 'Campaign spend and conversions (30 days)' }],
  meta_ads: [{ name: 'get_meta_ads_performance', description: 'Campaign insights (30 days)' }],
  shopify: [
    { name: 'get_store_summary', description: 'Orders, revenue, top products (30 days)' },
    { name: 'list_products', description: 'Product catalog' },
    { name: 'list_blogs', description: 'Blog containers with IDs' },
    { name: 'update_product_seo', description: 'Product SEO (write — gated)' },
    { name: 'create_page', description: 'Online Store page (write — gated)' },
    { name: 'create_blog_article', description: 'Blog post (write — gated)' },
  ],
  unsplash: [
    { name: 'search_photos', description: 'Search stock photos by keyword' },
    { name: 'get_random_photo', description: 'Random photo(s) for hero images' },
    { name: 'get_photo', description: 'Photo by ID with attribution' },
    { name: 'track_download', description: 'Required download tracking' },
  ],
  instagram: [
    { name: 'get_profile', description: 'Business profile (username, followers)' },
    { name: 'list_media', description: 'Recent posts and reels' },
    { name: 'publish_photo', description: 'Publish feed photo (write — gated)' },
    { name: 'publish_story', description: 'Publish story (write — gated)' },
    { name: 'publish_reel', description: 'Publish Reel (write — gated)' },
    { name: 'publish_carousel', description: 'Publish carousel (write — gated)' },
    { name: 'list_comments', description: 'Comments on a post' },
    { name: 'reply_to_comment', description: 'Reply to comment (write — gated)' },
    { name: 'like_media', description: 'Like a post (write — gated)' },
    { name: 'get_media_insights', description: 'Post engagement metrics' },
  ],
};

function bridgePath(platform: MCPPlatform): string {
  const paths: Record<MCPPlatform, string> = {
    google_analytics: '/mcp/analytics',
    google_ads: '/mcp/google-ads',
    meta_ads: '/mcp/meta-ads',
    shopify: '/mcp/shopify',
    unsplash: '/mcp/unsplash',
    instagram: '/mcp/instagram',
  };
  return paths[platform];
}

async function probeBridge(platform: MCPPlatform, organizationId: string): Promise<boolean> {
  const port = process.env.PORT ?? 3001;
  const token = createMcpBridgeToken(organizationId, platform);
  try {
    const res = await fetch(`http://127.0.0.1:${port}${bridgePath(platform)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'hundres-health', version: '1' },
        },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function fetchSnapshotExcerpt(
  platform: MCPPlatform,
  organizationId: string
): Promise<{ ok: boolean; excerpt: string | null; error: string | null }> {
  try {
    if (platform === 'google_analytics') {
      const r = await new GoogleAnalyticsSnapshotService().fetchSnapshotResult(organizationId);
      return {
        ok: r.ok,
        excerpt: r.ok ? r.data.text.split('\n').slice(0, 6).join('\n') : null,
        error: r.ok ? null : r.userMessage ?? r.error,
      };
    }
    if (platform === 'google_ads') {
      const r = await new GoogleAdsSnapshotService().fetchSnapshotResult(organizationId);
      return {
        ok: r.ok,
        excerpt: r.ok ? r.data.text.split('\n').slice(0, 6).join('\n') : null,
        error: r.ok ? null : r.userMessage ?? r.error,
      };
    }
    if (platform === 'meta_ads') {
      const r = await new MetaAdsSnapshotService().fetchSnapshotResult(organizationId);
      return {
        ok: r.ok,
        excerpt: r.ok ? r.data.text.split('\n').slice(0, 6).join('\n') : null,
        error: r.ok ? null : r.userMessage ?? r.error,
      };
    }
    if (platform === 'shopify') {
      const mcp = new ShopifyMcpService();
      const ctx = await mcp.getStoreContext(organizationId);
      if (!ctx) return { ok: false, excerpt: null, error: 'Shopify not connected' };
      const text = await invokeShopifyMcpTool(ctx, 'get_store_summary');
      return { ok: true, excerpt: text.split('\n').slice(0, 6).join('\n'), error: null };
    }
    if (platform === 'unsplash') {
      if (!isUnsplashConfigured()) {
        return { ok: false, excerpt: null, error: 'UNSPLASH_ACCESS_KEY not configured' };
      }
      const text = await mcpUnsplashHealthProbe();
      const parsed = JSON.parse(text) as { ok: boolean; totalResultsForSkincare: number; samplePhoto: string | null };
      return {
        ok: parsed.ok,
        excerpt: `Unsplash API ok · ${parsed.totalResultsForSkincare} skincare results · sample ${parsed.samplePhoto ?? 'n/a'}`,
        error: null,
      };
    }
    if (platform === 'instagram') {
      const ctx = await new MCPConnectionService().getInstagramContext(organizationId);
      if (!ctx) {
        return {
          ok: false,
          excerpt: null,
          error: 'Meta connected but no Instagram Business account linked to your Facebook Page',
        };
      }
      const text = await mcpInstagramHealthProbe(ctx);
      const parsed = JSON.parse(text) as {
        ok: boolean;
        username?: string;
        followersCount?: number;
        mediaCount?: number;
      };
      return {
        ok: parsed.ok,
        excerpt: `@${parsed.username ?? ctx.username ?? 'unknown'} · ${parsed.followersCount ?? '?'} followers · ${parsed.mediaCount ?? '?'} posts`,
        error: null,
      };
    }
    return { ok: false, excerpt: null, error: 'Unknown platform' };
  } catch (err) {
    return {
      ok: false,
      excerpt: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export class McpServerHealthService {
  private mcp = new MCPConnectionService();

  async getServerStatus(organizationId: string): Promise<{
    analyticalCore: MCPPlatform[];
    servers: McpServerStatus[];
  }> {
    const rows = await this.mcp.getConnectionRows(organizationId);
    const servers: McpServerStatus[] = [];

    for (const def of MCP_PLATFORM_REGISTRY) {
      const row = rows.find((r) => r.platform === def.platform);
      let connectionReady = false;
      if (def.platform === 'unsplash') {
        connectionReady = isUnsplashConfigured();
      } else if (def.platform === 'instagram') {
        connectionReady = await this.mcp.isInstagramReady(organizationId);
      } else {
        connectionReady = row ? isConnectionReady(def.platform, row) : false;
      }
      const tools = TOOLS_BY_PLATFORM[def.platform];

      let snapshotOk = false;
      let bridgeOk = false;
      let excerpt: string | null = null;
      let error: string | null = null;

      if (connectionReady) {
        const [snap, bridge] = await Promise.all([
          fetchSnapshotExcerpt(def.platform, organizationId),
          probeBridge(def.platform, organizationId),
        ]);
        snapshotOk = snap.ok;
        bridgeOk = bridge;
        excerpt = snap.excerpt;
        error = snap.error;
      }

      servers.push({
        platform: def.platform,
        tier: def.tier,
        serverName: def.serverName,
        label: def.label,
        bridgePath: bridgePath(def.platform),
        publicUrl: def.resolvePublicUrl(),
        connectionReady,
        tools,
        snapshotOk,
        bridgeOk,
        excerpt,
        error,
      });
    }

    return {
      analyticalCore: ANALYTICAL_CORE_PLATFORMS,
      servers,
    };
  }
}
