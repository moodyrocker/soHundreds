import Anthropic from '@anthropic-ai/sdk';
import { MCPConnectionService } from './mcpConnectionService.js';
import { McpOrchestrationService } from './mcpOrchestrationService.js';
import { invokeShopifyMcpTool } from '../mcp/shopifyMcpTools.js';

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514';

export class ShopifyMcpService {
  private client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  private mcp = new MCPConnectionService();
  private orchestration = new McpOrchestrationService();

  async getStoreContext(organizationId: string) {
    return this.mcp.getShopifyContext(organizationId);
  }

  /** Snapshots: call MCP tools directly (no Claude round-trip). */
  async fetchStoreSummaryText(organizationId: string): Promise<string | null> {
    const ctx = await this.getStoreContext(organizationId);
    if (!ctx) return null;
    return invokeShopifyMcpTool(ctx, 'get_store_summary');
  }

  /** Agentic store task via Claude + all connected MCP (analytics core + Shopify). */
  async runStoreTask(input: {
    organizationId: string;
    prompt: string;
    maxTokens?: number;
    analyticalOnly?: boolean;
  }): Promise<string> {
    const ctx = await this.getStoreContext(input.organizationId);
    if (!ctx) {
      throw new Error('Shopify store not connected');
    }

    const mcpConfig = input.analyticalOnly
      ? await this.orchestration.buildAnalyticalMcpConfig(input.organizationId)
      : await this.orchestration.buildClaudeMcpConfig(input.organizationId);

    if (!mcpConfig) {
      throw new Error('No MCP connections ready for this workspace');
    }

    const message = await this.client.beta.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: input.maxTokens ?? 8192,
      ...mcpConfig,
      messages: [{ role: 'user', content: input.prompt }],
    });

    const parts: string[] = [];
    for (const block of message.content) {
      if (block.type === 'text') parts.push(block.text);
    }
    return parts.join('\n').trim() || 'Task completed (no text response).';
  }

  async invokeTool(
    organizationId: string,
    toolName: string,
    args: Record<string, unknown> = {}
  ): Promise<string> {
    const ctx = await this.getStoreContext(organizationId);
    if (!ctx) throw new Error('Shopify store not connected');
    return invokeShopifyMcpTool(ctx, toolName, args);
  }
}

export { McpOrchestrationService };
