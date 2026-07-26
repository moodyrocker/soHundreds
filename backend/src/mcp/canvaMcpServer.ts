import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CanvaMcpContext } from './canvaMcpTools.js';
import {
  mcpCanvaCreateInstagramDesign,
  mcpCanvaExportDesign,
  mcpCanvaListDesigns,
} from './canvaMcpTools.js';

export function createCanvaMcpServer(ctx: CanvaMcpContext): McpServer {
  const server = new McpServer(
    { name: 'canva', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    'list_designs',
    {
      description:
        'List Canva designs for the connected user. Use before export when reusing an existing creative.',
      inputSchema: {
        query: z.string().optional().describe('Search term to filter designs'),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async (input) => ({
      content: [{ type: 'text', text: await mcpCanvaListDesigns(ctx, input) }],
    })
  );

  server.registerTool(
    'create_instagram_design',
    {
      description:
        'Create a blank 1080x1080 Canva design for Instagram feed. Returns edit URL — user or agent can refine in Canva before export.',
      inputSchema: {
        title: z.string().describe('Design title, e.g. "Summer sale Instagram post"'),
      },
    },
    async ({ title }) => ({
      content: [{ type: 'text', text: await mcpCanvaCreateInstagramDesign(ctx, { title }) }],
    })
  );

  server.registerTool(
    'export_design',
    {
      description:
        'Export a Canva design to PNG/JPG/MP4 and return a temporary HTTPS download URL for Instagram publishing.',
      inputSchema: {
        designId: z.string(),
        format: z.enum(['png', 'jpg', 'mp4']).optional().describe('Default png for feed/story images'),
      },
    },
    async (input) => ({
      content: [{ type: 'text', text: await mcpCanvaExportDesign(ctx, input) }],
    })
  );

  return server;
}
