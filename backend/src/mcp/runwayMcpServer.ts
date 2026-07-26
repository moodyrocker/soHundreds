import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  mcpRunwayGenerateReel,
  mcpRunwayGetTask,
  mcpRunwayImageToVideo,
  mcpRunwayTextToImage,
  mcpRunwayTextToVideo,
} from './runwayMcpTools.js';

export function createRunwayMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'runway', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    'text_to_video',
    {
      description:
        'Generate a realistic AI video from a text prompt (9:16 Instagram Reel by default). Returns a public HTTPS videoUrl when wait is true.',
      inputSchema: {
        promptText: z.string().describe('Detailed scene description for the video'),
        duration: z.union([z.literal(5), z.literal(10)]).optional(),
        wait: z
          .boolean()
          .optional()
          .describe('If true (default), poll until video URL is ready. If false, return taskId only.'),
      },
    },
    async (input) => ({
      content: [{ type: 'text', text: await mcpRunwayTextToVideo(input) }],
    })
  );

  server.registerTool(
    'text_to_image',
    {
      description:
        'Generate a photorealistic still image from a text prompt (9:16 Instagram feed by default). Lowest-credit Runway option (~5 credits). Returns imageUrl when wait is true.',
      inputSchema: {
        promptText: z.string().describe('Detailed scene description for the image'),
        model: z
          .enum(['gen4_image', 'gen4_image_turbo', 'gemini_2.5_flash'])
          .optional()
          .describe('Default gen4_image (~5 credits). turbo is cheapest (~2).'),
        wait: z.boolean().optional(),
      },
    },
    async (input) => ({
      content: [{ type: 'text', text: await mcpRunwayTextToImage(input) }],
    })
  );

  server.registerTool(
    'image_to_video',
    {
      description:
        'Animate a product/lifestyle image into a 9:16 video for Instagram Reels. promptImage must be a public HTTPS URL.',
      inputSchema: {
        promptImage: z.string().url(),
        promptText: z.string().optional().describe('Motion / camera guidance'),
        duration: z.union([z.literal(5), z.literal(10)]).optional(),
        wait: z.boolean().optional(),
      },
    },
    async (input) => ({
      content: [{ type: 'text', text: await mcpRunwayImageToVideo(input) }],
    })
  );

  server.registerTool(
    'get_task',
    {
      description: 'Check Runway generation task status and output URLs.',
      inputSchema: {
        taskId: z.string(),
      },
    },
    async ({ taskId }) => ({
      content: [{ type: 'text', text: await mcpRunwayGetTask({ taskId }) }],
    })
  );

  server.registerTool(
    'generate_instagram_reel',
    {
      description:
        'One-shot: generate a 9:16 Instagram Reel video with Runway and return videoUrl ready for Instagram publish_reel.',
      inputSchema: {
        promptText: z.string(),
        promptImage: z.string().url().optional().describe('Optional reference image to animate'),
        duration: z.union([z.literal(5), z.literal(10)]).optional(),
      },
    },
    async (input) => ({
      content: [{ type: 'text', text: await mcpRunwayGenerateReel(input) }],
    })
  );

  return server;
}
