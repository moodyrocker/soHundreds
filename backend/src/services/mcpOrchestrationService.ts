import type Anthropic from '@anthropic-ai/sdk';
import type { MCPPlatform } from '../types/index.js';
import { createMcpBridgeToken } from '../lib/mcpBridgeToken.js';
import {
  ANALYTICAL_CORE_PLATFORMS,
  getMcpDefinition,
  mcpPlatformsByPriority,
} from '../lib/mcpRegistry.js';
import { isUnsplashConfigured } from '../lib/unsplashClient.js';
import { isRunwayConfigured } from '../lib/runwayClient.js';
import { isGoogleAdsEnabled } from '../lib/googleFeatureFlags.js';
import { MCPConnectionService, isConnectionReady } from './mcpConnectionService.js';

const MCP_BETA = 'mcp-client-2025-11-20';

export type McpClaudeConfig = {
  mcp_servers: Array<{
    type: 'url';
    url: string;
    name: string;
    authorization_token: string;
  }>;
  tools: Array<{ type: 'mcp_toolset'; mcp_server_name: string }>;
  betas: string[];
};

/**
 * Builds Claude MCP connector config for a workspace.
 * Analytical core platforms (GA, Google Ads, Meta) are always listed first.
 */
export class McpOrchestrationService {
  private mcp = new MCPConnectionService();

  async getReadyPlatforms(organizationId: string): Promise<MCPPlatform[]> {
    const rows = await this.mcp.getConnectionRows(organizationId);
    const ready: MCPPlatform[] = [];
    for (const row of rows) {
      const def = getMcpDefinition(row.platform);
      if (!def) continue;
      if (row.platform === 'google_ads' && !isGoogleAdsEnabled()) continue;
      if (isConnectionReady(row.platform, row)) {
        ready.push(row.platform);
      }
    }
    if (isUnsplashConfigured()) {
      ready.push('unsplash');
    }
    if (isRunwayConfigured()) {
      ready.push('runway');
    }
    if (await this.mcp.isCanvaReady(organizationId)) {
      ready.push('canva');
    }
    if (await this.mcp.isInstagramReady(organizationId)) {
      ready.push('instagram');
    }
    return mcpPlatformsByPriority(ready);
  }

  async getAnalyticalCorePlatforms(organizationId: string): Promise<MCPPlatform[]> {
    const ready = await this.getReadyPlatforms(organizationId);
    return ready.filter((p) => ANALYTICAL_CORE_PLATFORMS.includes(p));
  }

  async buildClaudeMcpConfig(organizationId: string): Promise<McpClaudeConfig | null> {
    const platforms = await this.getReadyPlatforms(organizationId);
    if (platforms.length === 0) return null;

    const mcp_servers = platforms.map((platform) => {
      const def = getMcpDefinition(platform)!;
      return {
        type: 'url' as const,
        url: def.resolvePublicUrl(),
        name: def.serverName,
        authorization_token: createMcpBridgeToken(organizationId, platform),
      };
    });

    const tools = platforms.map((platform) => ({
      type: 'mcp_toolset' as const,
      mcp_server_name: getMcpDefinition(platform)!.serverName,
    }));

    return { mcp_servers, tools, betas: [MCP_BETA] };
  }

  /** Analytical-only MCP config for plan refinement / metric checks. */
  async buildAnalyticalMcpConfig(organizationId: string): Promise<McpClaudeConfig | null> {
    const platforms = await this.getAnalyticalCorePlatforms(organizationId);
    if (platforms.length === 0) return null;

    const mcp_servers = platforms.map((platform) => {
      const def = getMcpDefinition(platform)!;
      return {
        type: 'url' as const,
        url: def.resolvePublicUrl(),
        name: def.serverName,
        authorization_token: createMcpBridgeToken(organizationId, platform),
      };
    });

    const tools = platforms.map((platform) => ({
      type: 'mcp_toolset' as const,
      mcp_server_name: getMcpDefinition(platform)!.serverName,
    }));

    return { mcp_servers, tools, betas: [MCP_BETA] };
  }

  static applyToMessageParams(
    config: McpClaudeConfig | null
  ): Pick<Anthropic.Beta.Messages.MessageCreateParams, 'mcp_servers' | 'tools' | 'betas'> {
    if (!config) return {};
    return {
      mcp_servers: config.mcp_servers,
      tools: config.tools,
      betas: config.betas,
    };
  }
}
