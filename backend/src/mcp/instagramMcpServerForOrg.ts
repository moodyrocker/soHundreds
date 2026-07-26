import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MCPConnectionService } from '../services/mcpConnectionService.js';
import { createInstagramMcpServer } from './instagramMcpServer.js';

export async function createInstagramMcpServerForOrg(
  organizationId: string
): Promise<McpServer | null> {
  const mcp = new MCPConnectionService();
  const ctx = await mcp.getInstagramContext(organizationId);
  if (!ctx) return null;
  return createInstagramMcpServer(ctx);
}
