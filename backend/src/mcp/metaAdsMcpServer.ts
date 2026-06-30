import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MetaAdsSnapshotService } from '../services/metaAdsSnapshotService.js';
import { MCPConnectionService } from '../services/mcpConnectionService.js';

export async function createMetaAdsMcpServer(organizationId: string): Promise<McpServer | null> {
  const mcp = new MCPConnectionService();
  const ctx = await mcp.getMetaAdsContext(organizationId);
  if (!ctx) return null;

  const snapshot = new MetaAdsSnapshotService();
  const server = new McpServer(
    { name: 'hundres-meta-ads-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    'get_meta_ads_performance',
    {
      description:
        'Meta (Facebook/Instagram) campaign spend, impressions, clicks, and conversions for the last 30 days.',
      inputSchema: {},
    },
    async () => {
      const result = await snapshot.fetchSnapshotResult(organizationId);
      if (!result.ok) {
        return {
          content: [{ type: 'text', text: `Meta Ads unavailable: ${result.error}` }],
          isError: true,
        };
      }
      return { content: [{ type: 'text', text: result.data.text }] };
    }
  );

  return server;
}
