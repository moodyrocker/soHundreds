import { MCPConnectionService } from './mcpConnectionService.js';
import { ShopifyMcpService } from './shopifyMcpService.js';
import type { SnapshotFetchResult, SnapshotProbeResult } from '../types/snapshot.js';
import { idleProbe, probeFromFetch } from '../types/snapshot.js';
import { shopifySnapshotUserMessage } from '../utils/snapshotErrors.js';

export interface ShopifySnapshot {
  shopDomain: string;
  text: string;
}

/**
 * Store metrics via Shopify MCP tools (same layer as Claude Desktop MCP).
 */
export class ShopifySnapshotService {
  private mcp = new MCPConnectionService();
  private shopifyMcp = new ShopifyMcpService();

  async fetchSnapshot(organizationId: string): Promise<ShopifySnapshot | null> {
    const result = await this.fetchSnapshotResult(organizationId);
    return result.ok ? result.data : null;
  }

  async probeSnapshot(organizationId: string): Promise<SnapshotProbeResult> {
    const ctx = await this.mcp.getShopifyContext(organizationId);
    if (!ctx) return idleProbe('shopify');
    return probeFromFetch('shopify', true, await this.fetchSnapshotResult(organizationId));
  }

  async fetchSnapshotResult(
    organizationId: string
  ): Promise<SnapshotFetchResult<ShopifySnapshot>> {
    const ctx = await this.mcp.getShopifyContext(organizationId);
    if (!ctx) {
      return {
        ok: false,
        error: 'Shopify store not configured',
        errorCode: null,
        userMessage: null,
      };
    }

    try {
      const text = await this.shopifyMcp.fetchStoreSummaryText(organizationId);
      if (!text) {
        return {
          ok: false,
          error: 'Shopify store not configured',
          errorCode: null,
          userMessage: null,
        };
      }
      return { ok: true, data: { shopDomain: ctx.shopDomain, text } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const statusMatch = message.match(/error (\d{3})/i);
      const status = statusMatch ? Number(statusMatch[1]) : 502;
      return {
        ok: false,
        error: message.slice(0, 400),
        errorCode: `HTTP_${status}`,
        userMessage: shopifySnapshotUserMessage(status, message),
      };
    }
  }
}
