import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GoogleAdsSnapshotService } from '../services/googleAdsSnapshotService.js';
import { MCPConnectionService } from '../services/mcpConnectionService.js';

export async function createGoogleAdsMcpServer(organizationId: string): Promise<McpServer | null> {
  const mcp = new MCPConnectionService();
  const ctx = await mcp.getGoogleAdsContext(organizationId);
  if (!ctx) return null;

  const snapshot = new GoogleAdsSnapshotService();
  const server = new McpServer(
    { name: 'hundres-google-ads-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    'get_ads_performance',
    {
      description:
        'Google Ads campaign spend, conversions, clicks, and impressions for the last 30 days.',
      inputSchema: {},
    },
    async () => {
      const result = await snapshot.fetchSnapshotResult(organizationId);
      if (!result.ok) {
        return {
          content: [{ type: 'text', text: `Google Ads unavailable: ${result.error}` }],
          isError: true,
        };
      }
      return { content: [{ type: 'text', text: result.data.text }] };
    }
  );

  return server;
}
