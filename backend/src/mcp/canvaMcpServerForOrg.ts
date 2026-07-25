import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MCPConnectionService } from '../services/mcpConnectionService.js';
import { createCanvaMcpServer } from './canvaMcpServer.js';

export async function createCanvaMcpServerForOrg(
  organizationId: string
): Promise<McpServer | null> {
  const mcp = new MCPConnectionService();
  const ctx = await mcp.getCanvaContext(organizationId);
  if (!ctx) return null;
  return createCanvaMcpServer(ctx);
}
