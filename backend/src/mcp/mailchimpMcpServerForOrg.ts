import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MCPConnectionService } from '../services/mcpConnectionService.js';
import { createMailchimpMcpServer } from './mailchimpMcpServer.js';

export async function createMailchimpMcpServerForOrg(
  organizationId: string
): Promise<McpServer | null> {
  const mcp = new MCPConnectionService();
  const ctx = await mcp.getMailchimpContext(organizationId);
  if (!ctx) return null;
  return createMailchimpMcpServer(ctx);
}
