import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MCPConnectionService } from '../services/mcpConnectionService.js';
import { createShopifyMcpServer } from './shopifyMcpServer.js';

export async function createShopifyMcpServerForOrg(
  organizationId: string
): Promise<McpServer | null> {
  const mcp = new MCPConnectionService();
  const ctx = await mcp.getShopifyContext(organizationId);
  if (!ctx) return null;
  return createShopifyMcpServer(ctx);
}
