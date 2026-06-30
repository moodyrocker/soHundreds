import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { isUnsplashConfigured } from '../lib/unsplashClient.js';
import { createUnsplashMcpServer } from './unsplashMcpServer.js';

/** Unsplash uses a workspace-level API key; organizationId is only for bridge auth. */
export async function createUnsplashMcpServerForOrg(
  _organizationId: string
): Promise<McpServer | null> {
  if (!isUnsplashConfigured()) return null;
  return createUnsplashMcpServer();
}
