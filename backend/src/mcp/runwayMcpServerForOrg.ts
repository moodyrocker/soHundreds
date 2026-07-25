import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { isRunwayConfigured } from '../lib/runwayClient.js';
import { createRunwayMcpServer } from './runwayMcpServer.js';

/** Runway uses a workspace-level API key; organizationId is only for bridge auth. */
export async function createRunwayMcpServerForOrg(
  _organizationId: string
): Promise<McpServer | null> {
  if (!isRunwayConfigured()) return null;
  return createRunwayMcpServer();
}
