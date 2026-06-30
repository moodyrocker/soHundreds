import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { InstagramContext } from './instagramMcpTools.js';
import {
  mcpInstagramDeleteComment,
  mcpInstagramGetContainerStatus,
  mcpInstagramGetMediaInsights,
  mcpInstagramGetProfile,
  mcpInstagramGetPublishLimit,
  mcpInstagramHideComment,
  mcpInstagramLikeComment,
  mcpInstagramLikeMedia,
  mcpInstagramListComments,
  mcpInstagramListMedia,
  mcpInstagramPostComment,
  mcpInstagramPublishCarousel,
  mcpInstagramPublishContainer,
  mcpInstagramPublishPhoto,
  mcpInstagramPublishReel,
  mcpInstagramPublishStory,
  mcpInstagramReplyToComment,
  mcpInstagramUnlikeComment,
  mcpInstagramUnlikeMedia,
} from './instagramMcpTools.js';

export function createInstagramMcpServer(ctx: InstagramContext): McpServer {
  const server = new McpServer(
    { name: 'instagram', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    'get_profile',
    {
      description: 'Instagram Business profile for the connected account (username, followers, bio).',
      inputSchema: {},
    },
    async () => ({
      content: [{ type: 'text', text: await mcpInstagramGetProfile(ctx) }],
    })
  );

  server.registerTool(
    'list_media',
    {
      description: 'Recent Instagram posts/reels with captions and permalinks.',
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ limit }) => ({
      content: [{ type: 'text', text: await mcpInstagramListMedia(ctx, limit ?? 12) }],
    })
  );

  server.registerTool(
    'get_publish_limit',
    {
      description: 'Daily publishing quota for posts and stories (Instagram rate limits).',
      inputSchema: {},
    },
    async () => ({
      content: [{ type: 'text', text: await mcpInstagramGetPublishLimit(ctx) }],
    })
  );

  server.registerTool(
    'get_container_status',
    {
      description: 'Check media container processing status before publishing (IN_PROGRESS, FINISHED, ERROR).',
      inputSchema: {
        containerId: z.string(),
      },
    },
    async ({ containerId }) => ({
      content: [{ type: 'text', text: await mcpInstagramGetContainerStatus(ctx, containerId) }],
    })
  );

  server.registerTool(
    'publish_photo',
    {
      description:
        'Publish a feed photo. imageUrl must be a public HTTPS URL (Unsplash, Shopify CDN, etc.).',
      inputSchema: {
        imageUrl: z.string().url(),
        caption: z.string().optional(),
      },
    },
    async (input) => ({
      content: [{ type: 'text', text: await mcpInstagramPublishPhoto(ctx, input) }],
    })
  );

  server.registerTool(
    'publish_story',
    {
      description: 'Publish a story (image or video). Stories disappear after 24 hours.',
      inputSchema: {
        imageUrl: z.string().url().optional(),
        videoUrl: z.string().url().optional(),
      },
    },
    async (input) => ({
      content: [{ type: 'text', text: await mcpInstagramPublishStory(ctx, input) }],
    })
  );

  server.registerTool(
    'publish_reel',
    {
      description: 'Publish a Reel from a public HTTPS video URL.',
      inputSchema: {
        videoUrl: z.string().url(),
        caption: z.string().optional(),
        shareToFeed: z.boolean().optional().describe('Also show on main profile grid (default true)'),
      },
    },
    async (input) => ({
      content: [{ type: 'text', text: await mcpInstagramPublishReel(ctx, input) }],
    })
  );

  server.registerTool(
    'publish_carousel',
    {
      description: 'Publish a carousel with 2–10 images (public HTTPS URLs).',
      inputSchema: {
        imageUrls: z.array(z.string().url()).min(2).max(10),
        caption: z.string().optional(),
      },
    },
    async (input) => ({
      content: [{ type: 'text', text: await mcpInstagramPublishCarousel(ctx, input) }],
    })
  );

  server.registerTool(
    'publish_container',
    {
      description: 'Publish a previously created media container by creation_id.',
      inputSchema: {
        creationId: z.string(),
      },
    },
    async ({ creationId }) => ({
      content: [{ type: 'text', text: await mcpInstagramPublishContainer(ctx, creationId) }],
    })
  );

  server.registerTool(
    'list_comments',
    {
      description: 'List comments on an Instagram post.',
      inputSchema: {
        mediaId: z.string(),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ mediaId, limit }) => ({
      content: [{ type: 'text', text: await mcpInstagramListComments(ctx, mediaId, limit ?? 25) }],
    })
  );

  server.registerTool(
    'post_comment',
    {
      description: 'Post a top-level comment on your own media.',
      inputSchema: {
        mediaId: z.string(),
        message: z.string().min(1),
      },
    },
    async ({ mediaId, message }) => ({
      content: [{ type: 'text', text: await mcpInstagramPostComment(ctx, mediaId, message) }],
    })
  );

  server.registerTool(
    'reply_to_comment',
    {
      description: 'Reply to a comment on your media.',
      inputSchema: {
        commentId: z.string(),
        message: z.string().min(1),
      },
    },
    async ({ commentId, message }) => ({
      content: [{ type: 'text', text: await mcpInstagramReplyToComment(ctx, commentId, message) }],
    })
  );

  server.registerTool(
    'hide_comment',
    {
      description: 'Hide or unhide a comment on your media.',
      inputSchema: {
        commentId: z.string(),
        hide: z.boolean().optional().describe('true to hide, false to unhide (default true)'),
      },
    },
    async ({ commentId, hide }) => ({
      content: [{ type: 'text', text: await mcpInstagramHideComment(ctx, commentId, hide !== false) }],
    })
  );

  server.registerTool(
    'delete_comment',
    {
      description: 'Delete a comment on your media.',
      inputSchema: {
        commentId: z.string(),
      },
    },
    async ({ commentId }) => ({
      content: [{ type: 'text', text: await mcpInstagramDeleteComment(ctx, commentId) }],
    })
  );

  server.registerTool(
    'like_media',
    {
      description: 'Like a post as the connected Business account (requires instagram_manage_engagement).',
      inputSchema: {
        mediaId: z.string(),
      },
    },
    async ({ mediaId }) => ({
      content: [{ type: 'text', text: await mcpInstagramLikeMedia(ctx, mediaId) }],
    })
  );

  server.registerTool(
    'like_comment',
    {
      description: 'Like a comment as the connected Business account.',
      inputSchema: {
        commentId: z.string(),
      },
    },
    async ({ commentId }) => ({
      content: [{ type: 'text', text: await mcpInstagramLikeComment(ctx, commentId) }],
    })
  );

  server.registerTool(
    'unlike_media',
    {
      description: 'Remove your like from a post.',
      inputSchema: {
        mediaId: z.string(),
      },
    },
    async ({ mediaId }) => ({
      content: [{ type: 'text', text: await mcpInstagramUnlikeMedia(ctx, mediaId) }],
    })
  );

  server.registerTool(
    'unlike_comment',
    {
      description: 'Remove your like from a comment.',
      inputSchema: {
        commentId: z.string(),
      },
    },
    async ({ commentId }) => ({
      content: [{ type: 'text', text: await mcpInstagramUnlikeComment(ctx, commentId) }],
    })
  );

  server.registerTool(
    'get_media_insights',
    {
      description: 'Engagement metrics for a post (engagement, impressions, reach, saved).',
      inputSchema: {
        mediaId: z.string(),
        metrics: z.string().optional(),
      },
    },
    async ({ mediaId, metrics }) => ({
      content: [{ type: 'text', text: await mcpInstagramGetMediaInsights(ctx, mediaId, metrics) }],
    })
  );

  return server;
}
