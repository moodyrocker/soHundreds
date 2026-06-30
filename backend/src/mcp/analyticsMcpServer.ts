import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GoogleAnalyticsSnapshotService } from '../services/googleAnalyticsSnapshotService.js';
import { MCPConnectionService } from '../services/mcpConnectionService.js';

export async function createAnalyticsMcpServer(organizationId: string): Promise<McpServer | null> {
  const mcp = new MCPConnectionService();
  const connections = await mcp.getActiveConnections(organizationId);
  const ga = connections.find((c) => c.platform === 'google_analytics' && c.propertyId);
  if (!ga?.propertyId) return null;

  const snapshot = new GoogleAnalyticsSnapshotService();
  const server = new McpServer(
    { name: 'hundres-analytics-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    'get_analytics_summary',
    {
      description:
        'GA4 site overview and channel breakdown for the last 28 days. Primary analytical ground truth for this workspace.',
      inputSchema: {},
    },
    async () => {
      const result = await snapshot.fetchSnapshotResult(organizationId);
      if (!result.ok) {
        return {
          content: [{ type: 'text', text: `Analytics unavailable: ${result.error}` }],
          isError: true,
        };
      }
      return { content: [{ type: 'text', text: result.data.text }] };
    }
  );

  server.registerTool(
    'get_traffic_metrics',
    {
      description: 'Alias for get_analytics_summary — active users, sessions, engagement, channels.',
      inputSchema: {},
    },
    async () => {
      const data = await snapshot.fetchSnapshot(organizationId);
      if (!data) {
        return {
          content: [{ type: 'text', text: 'Analytics not connected or no data.' }],
          isError: true,
        };
      }
      return { content: [{ type: 'text', text: data.text }] };
    }
  );

  return server;
}
