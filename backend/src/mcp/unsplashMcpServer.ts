import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  mcpGetPhoto,
  mcpGetRandomPhoto,
  mcpSearchPhotos,
  mcpTrackDownload,
} from './unsplashMcpTools.js';

export function createUnsplashMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'unsplash', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    'search_photos',
    {
      description:
        'Search Unsplash for stock photos by keyword. Returns image URLs and required photographer attribution.',
      inputSchema: {
        query: z.string().describe('Search keywords, e.g. "skincare routine"'),
        page: z.number().int().min(1).optional(),
        perPage: z.number().int().min(1).max(30).optional(),
        orientation: z.enum(['landscape', 'portrait', 'squarish']).optional(),
        color: z
          .enum([
            'black_and_white',
            'black',
            'white',
            'yellow',
            'orange',
            'red',
            'purple',
            'magenta',
            'green',
            'teal',
            'blue',
          ])
          .optional(),
        width: z.number().int().min(200).max(2400).optional().describe('Resize regular URL width'),
      },
    },
    async (input) => ({
      content: [{ type: 'text', text: await mcpSearchPhotos(input) }],
    })
  );

  server.registerTool(
    'get_random_photo',
    {
      description: 'Get random Unsplash photo(s), optionally filtered by topic or orientation.',
      inputSchema: {
        query: z.string().optional(),
        count: z.number().int().min(1).max(30).optional(),
        orientation: z.enum(['landscape', 'portrait', 'squarish']).optional(),
        width: z.number().int().min(200).max(2400).optional(),
      },
    },
    async (input) => ({
      content: [{ type: 'text', text: await mcpGetRandomPhoto(input) }],
    })
  );

  server.registerTool(
    'get_photo',
    {
      description: 'Fetch a single Unsplash photo by ID with URLs and attribution.',
      inputSchema: {
        photoId: z.string(),
        width: z.number().int().min(200).max(2400).optional(),
      },
    },
    async (input) => ({
      content: [{ type: 'text', text: await mcpGetPhoto(input) }],
    })
  );

  server.registerTool(
    'track_download',
    {
      description:
        'Track an Unsplash download (required by Unsplash API guidelines before saving/hosting). Returns final download URL.',
      inputSchema: {
        photoId: z.string().optional(),
        downloadLocation: z.string().optional().describe('From search/get results downloadLocation field'),
      },
    },
    async (input) => ({
      content: [{ type: 'text', text: await mcpTrackDownload(input) }],
    })
  );

  return server;
}
