import {
  igDeleteComment,
  igGetContainerStatus,
  igGetMediaInsights,
  igGetProfile,
  igGetPublishLimit,
  igHideComment,
  igLikeComment,
  igLikeMedia,
  igListComments,
  igListMedia,
  igPostComment,
  igPublishCarousel,
  igPublishContainer,
  igPublishPhoto,
  igPublishReel,
  igPublishStory,
  igReplyToComment,
  igUnlikeComment,
  igUnlikeMedia,
  type InstagramContext,
} from '../lib/instagramGraphClient.js';

export type { InstagramContext };

export async function mcpInstagramGetProfile(ctx: InstagramContext): Promise<string> {
  const profile = (await igGetProfile(ctx)) as Record<string, unknown>;
  return JSON.stringify({ ...profile, igUserId: ctx.igUserId, pageId: ctx.pageId }, null, 2);
}

export async function mcpInstagramListMedia(
  ctx: InstagramContext,
  limit = 12
): Promise<string> {
  const media = await igListMedia(ctx, limit);
  return JSON.stringify(media, null, 2);
}

export async function mcpInstagramGetPublishLimit(ctx: InstagramContext): Promise<string> {
  const limit = await igGetPublishLimit(ctx);
  return JSON.stringify(limit, null, 2);
}

export async function mcpInstagramGetContainerStatus(
  ctx: InstagramContext,
  containerId: string
): Promise<string> {
  const status = await igGetContainerStatus(ctx, containerId);
  return JSON.stringify(status, null, 2);
}

export async function mcpInstagramPublishPhoto(
  ctx: InstagramContext,
  input: { imageUrl: string; caption?: string }
): Promise<string> {
  const result = await igPublishPhoto(ctx, input);
  return JSON.stringify(
    {
      ...result,
      note: 'Photo published. Media URLs must be public HTTPS (e.g. Unsplash or Shopify CDN).',
    },
    null,
    2
  );
}

export async function mcpInstagramPublishStory(
  ctx: InstagramContext,
  input: { imageUrl?: string; videoUrl?: string }
): Promise<string> {
  const result = await igPublishStory(ctx, input);
  return JSON.stringify(result, null, 2);
}

export async function mcpInstagramPublishReel(
  ctx: InstagramContext,
  input: { videoUrl: string; caption?: string; shareToFeed?: boolean }
): Promise<string> {
  const result = await igPublishReel(ctx, input);
  return JSON.stringify(result, null, 2);
}

export async function mcpInstagramPublishCarousel(
  ctx: InstagramContext,
  input: { imageUrls: string[]; caption?: string }
): Promise<string> {
  const result = await igPublishCarousel(ctx, input);
  return JSON.stringify(result, null, 2);
}

export async function mcpInstagramPublishContainer(
  ctx: InstagramContext,
  creationId: string
): Promise<string> {
  const result = await igPublishContainer(ctx, creationId);
  return JSON.stringify(result, null, 2);
}

export async function mcpInstagramListComments(
  ctx: InstagramContext,
  mediaId: string,
  limit = 25
): Promise<string> {
  const comments = await igListComments(ctx, mediaId, limit);
  return JSON.stringify(comments, null, 2);
}

export async function mcpInstagramPostComment(
  ctx: InstagramContext,
  mediaId: string,
  message: string
): Promise<string> {
  const comment = await igPostComment(ctx, mediaId, message);
  return JSON.stringify(comment, null, 2);
}

export async function mcpInstagramReplyToComment(
  ctx: InstagramContext,
  commentId: string,
  message: string
): Promise<string> {
  const reply = await igReplyToComment(ctx, commentId, message);
  return JSON.stringify(reply, null, 2);
}

export async function mcpInstagramHideComment(
  ctx: InstagramContext,
  commentId: string,
  hide = true
): Promise<string> {
  const result = await igHideComment(ctx, commentId, hide);
  return JSON.stringify({ commentId, hidden: hide, ...result }, null, 2);
}

export async function mcpInstagramDeleteComment(
  ctx: InstagramContext,
  commentId: string
): Promise<string> {
  const result = await igDeleteComment(ctx, commentId);
  return JSON.stringify({ commentId, ...result }, null, 2);
}

export async function mcpInstagramLikeMedia(
  ctx: InstagramContext,
  mediaId: string
): Promise<string> {
  const result = await igLikeMedia(ctx, mediaId);
  return JSON.stringify({ mediaId, ...result }, null, 2);
}

export async function mcpInstagramLikeComment(
  ctx: InstagramContext,
  commentId: string
): Promise<string> {
  const result = await igLikeComment(ctx, commentId);
  return JSON.stringify({ commentId, ...result }, null, 2);
}

export async function mcpInstagramUnlikeMedia(
  ctx: InstagramContext,
  mediaId: string
): Promise<string> {
  const result = await igUnlikeMedia(ctx, mediaId);
  return JSON.stringify({ mediaId, ...result }, null, 2);
}

export async function mcpInstagramUnlikeComment(
  ctx: InstagramContext,
  commentId: string
): Promise<string> {
  const result = await igUnlikeComment(ctx, commentId);
  return JSON.stringify({ commentId, ...result }, null, 2);
}

export async function mcpInstagramGetMediaInsights(
  ctx: InstagramContext,
  mediaId: string,
  metrics?: string
): Promise<string> {
  const insights = await igGetMediaInsights(ctx, mediaId, metrics);
  return JSON.stringify(insights, null, 2);
}

export async function mcpInstagramHealthProbe(ctx: InstagramContext): Promise<string> {
  const profile = (await igGetProfile(ctx)) as {
    username?: string;
    followers_count?: number;
    media_count?: number;
  };
  const limit = await igGetPublishLimit(ctx);
  return JSON.stringify(
    {
      ok: true,
      username: profile.username ?? ctx.username,
      igUserId: ctx.igUserId,
      followersCount: profile.followers_count,
      mediaCount: profile.media_count,
      publishLimit: limit,
    },
    null,
    2
  );
}

export async function invokeInstagramMcpTool(
  ctx: InstagramContext,
  tool: string,
  args: Record<string, unknown> = {}
): Promise<string> {
  switch (tool) {
    case 'get_profile':
      return mcpInstagramGetProfile(ctx);
    case 'list_media':
      return mcpInstagramListMedia(ctx, Number(args.limit) || 12);
    case 'get_publish_limit':
      return mcpInstagramGetPublishLimit(ctx);
    case 'get_container_status':
      return mcpInstagramGetContainerStatus(ctx, String(args.containerId));
    case 'publish_photo':
      return mcpInstagramPublishPhoto(ctx, {
        imageUrl: String(args.imageUrl),
        caption: args.caption ? String(args.caption) : undefined,
      });
    case 'publish_story':
      return mcpInstagramPublishStory(ctx, {
        imageUrl: args.imageUrl ? String(args.imageUrl) : undefined,
        videoUrl: args.videoUrl ? String(args.videoUrl) : undefined,
      });
    case 'publish_reel':
      return mcpInstagramPublishReel(ctx, {
        videoUrl: String(args.videoUrl),
        caption: args.caption ? String(args.caption) : undefined,
        shareToFeed: args.shareToFeed !== false,
      });
    case 'publish_carousel':
      return mcpInstagramPublishCarousel(ctx, {
        imageUrls: (args.imageUrls as string[]) ?? [],
        caption: args.caption ? String(args.caption) : undefined,
      });
    case 'publish_container':
      return mcpInstagramPublishContainer(ctx, String(args.creationId));
    case 'list_comments':
      return mcpInstagramListComments(ctx, String(args.mediaId), Number(args.limit) || 25);
    case 'post_comment':
      return mcpInstagramPostComment(ctx, String(args.mediaId), String(args.message));
    case 'reply_to_comment':
      return mcpInstagramReplyToComment(ctx, String(args.commentId), String(args.message));
    case 'hide_comment':
      return mcpInstagramHideComment(ctx, String(args.commentId), args.hide !== false);
    case 'delete_comment':
      return mcpInstagramDeleteComment(ctx, String(args.commentId));
    case 'like_media':
      return mcpInstagramLikeMedia(ctx, String(args.mediaId));
    case 'like_comment':
      return mcpInstagramLikeComment(ctx, String(args.commentId));
    case 'unlike_media':
      return mcpInstagramUnlikeMedia(ctx, String(args.mediaId));
    case 'unlike_comment':
      return mcpInstagramUnlikeComment(ctx, String(args.commentId));
    case 'get_media_insights':
      return mcpInstagramGetMediaInsights(
        ctx,
        String(args.mediaId),
        args.metrics ? String(args.metrics) : undefined
      );
    default:
      throw new Error(`Unknown Instagram MCP tool: ${tool}`);
  }
}
