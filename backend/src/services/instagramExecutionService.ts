import type { AgentExecutionBrief } from '../types/agentTask.js';
import type { PlanAction } from '../types/plan.js';
import type { InstagramPublishState } from '../types/execution.js';
import type { BusinessProfile } from './businessProfileService.js';
import {
  igGetMedia,
  igGetPublishLimit,
  igPublishCarousel,
  igPublishPhoto,
  igPublishReel,
  igPublishStory,
} from '../lib/instagramGraphClient.js';
import type { InstagramContext } from '../lib/instagramGraphClient.js';
import { MCPConnectionService } from './mcpConnectionService.js';
import { ClaudeService } from './claudeService.js';
import { isInstagramReelOrVideo, isInstagramStoryAction } from '../executors/actionRouter.js';
import {
  isCarouselInstagramAction,
  resolveInstagramSlideCount,
  type BrandImagePick,
} from './instagramAssistImageService.js';
import {
  generateRunwayVideoForInstagram,
  wantsRunwayImage,
  wantsRunwayVideo,
} from './runwayAssistVideoService.js';
import { isRunwayConfigured } from '../lib/runwayClient.js';

export class InstagramExecutionService {
  private mcp = new MCPConnectionService();
  private claude = new ClaudeService();

  async publishPhotoForAction(input: {
    organizationId: string;
    action: PlanAction;
    goal: string;
    businessContext?: string | null;
    profile: BusinessProfile;
    brief?: AgentExecutionBrief | null;
  }): Promise<InstagramPublishState> {
    return this.publishForAction(input);
  }

  async publishForAction(input: {
    organizationId: string;
    action: PlanAction;
    goal: string;
    businessContext?: string | null;
    profile: BusinessProfile;
    brief?: AgentExecutionBrief | null;
  }): Promise<InstagramPublishState> {
    const ctx = await this.mcp.getInstagramContext(input.organizationId);
    if (!ctx) {
      throw new Error('Connect Instagram Business in Integrations before publishing.');
    }

    await this.assertPublishQuota(ctx);

    const isStory =
      input.brief?.mediaFormat === 'story' || isInstagramStoryAction(input.action);

    const wantsStill =
      input.brief?.mediaFormat === 'feed' ||
      input.brief?.mediaFormat === 'carousel' ||
      wantsRunwayImage(input.action, input.brief);

    const wantsVideo =
      !wantsStill &&
      (input.brief?.mediaFormat === 'reel' ||
        wantsRunwayVideo(input.action, input.brief) ||
        Boolean(input.brief?.videoUrl?.startsWith('https://')) ||
        (isInstagramReelOrVideo(input.action) && !isStory));

    if (isStory) {
      return this.publishStory(input, ctx);
    }

    if (wantsVideo) {
      return this.publishReel(input, ctx);
    }

    return this.publishPhoto(input, ctx);
  }

  private async publishPhoto(
    input: {
      organizationId: string;
      action: PlanAction;
      goal: string;
      businessContext?: string | null;
      profile: BusinessProfile;
      brief?: AgentExecutionBrief | null;
    },
    ctx: InstagramContext
  ): Promise<InstagramPublishState> {
    if (!isRunwayConfigured()) {
      throw new Error(
        'Instagram feed creatives require Runway text-to-image — set RUNWAY_API_KEY. Visual library images are used as brand reference only.'
      );
    }

    const slideCount = resolveInstagramSlideCount(input.action, input.brief);
    const validPicks = await this.generateRunwayStillPicks(input, slideCount);
    const runwayTaskId = validPicks[0]?.runwayTaskId;
    const runwayRationale = validPicks[0]?.imageRationale;

    if (!validPicks.length) {
      throw new Error(
        'Runway text-to-image returned no images — check RUNWAY_API_KEY and Visual library references.'
      );
    }

    const carousel =
      (isCarouselInstagramAction(input.action, input.brief) || validPicks.length >= 2) &&
      validPicks.length >= 2;

    const deliverable = await this.claude.generateInstagramAssist({
      action: input.action,
      goal: input.goal,
      businessContext: input.businessContext,
      images: validPicks.map(toAssistImage),
      userInstructions: input.brief?.fullRequest ?? null,
      ctaText: input.brief?.ctaText ?? null,
    });

    let caption = [deliverable.primaryCopy, deliverable.extras?.hashtags]
      .filter(Boolean)
      .join('\n\n');

    if (input.brief?.ctaText && !caption.toLowerCase().includes(input.brief.ctaText.toLowerCase())) {
      caption = `${caption}\n\nShop ${input.brief.ctaText} — link in bio.`;
    }

    let mediaId: string | null = null;
    let permalink: string | null = null;

    if (carousel) {
      const published = await igPublishCarousel(ctx, {
        imageUrls: validPicks.map((p) => p.proposedImageUrl),
        caption,
      });
      mediaId = published.mediaId;
    } else {
      const published = await igPublishPhoto(ctx, {
        imageUrl: validPicks[0].proposedImageUrl,
        caption,
      });
      mediaId = published.mediaId;
    }

    try {
      if (mediaId) {
        const media = await igGetMedia(ctx, mediaId);
        permalink = media.permalink ?? null;
      }
    } catch {
      permalink = null;
    }

    const primary = validPicks[0];

    return {
      kind: 'instagram_publish',
      mediaType: carousel ? 'carousel' : 'photo',
      caption,
      imageUrl: primary.proposedImageUrl,
      imageUrls: validPicks.map((p) => p.proposedImageUrl),
      imageSource: 'runway',
      imageAttribution: primary.imageAttribution,
      imageRationale: runwayRationale ?? primary.imageRationale,
      canvaDesignId: primary.canvaDesignId,
      canvaEditUrl: primary.canvaEditUrl,
      runwayTaskId,
      mediaId,
      permalink,
      reasoning: deliverable.reasoning,
      slideCount: validPicks.length,
    };
  }

  /** Always Runway text-to-image; Visual library is reference-only via generateRunwayVideoForInstagram. */
  private async generateRunwayStillPicks(
    input: {
      organizationId: string;
      action: PlanAction;
      profile: BusinessProfile;
      brief?: AgentExecutionBrief | null;
    },
    count: number
  ): Promise<Array<BrandImagePick & { runwayTaskId?: string }>> {
    const picks: Array<BrandImagePick & { runwayTaskId?: string }> = [];
    const target = Math.min(10, Math.max(1, count));

    for (let i = 0; i < target; i++) {
      const slideNote =
        target > 1 ? ` Slide ${i + 1} of ${target} — vary composition and crop; keep brand consistent.` : '';
      const generated = await generateRunwayVideoForInstagram({
        organizationId: input.organizationId,
        profile: input.profile,
        action: input.action,
        brief: {
          ...(input.brief ?? { fullRequest: input.action.title }),
          mediaFormat: 'feed',
          recipeSlug: input.brief?.recipeSlug?.includes('image')
            ? input.brief.recipeSlug
            : 'runway-text-to-image',
          fullRequest: `${input.brief?.fullRequest ?? input.action.title}${slideNote}`,
        },
      });
      const urls = (generated.imageUrls ?? []).filter((u) => u.startsWith('https://'));
      if (!urls.length) {
        if (i === 0) {
          throw new Error(
            generated.videoUrl
              ? 'Runway returned a video — use an Instagram Reel for text-to-video, or feed/carousel for text-to-image.'
              : 'Runway text-to-image did not return image URLs.'
          );
        }
        break;
      }
      const rationale = `Runway text-to-image (${generated.taskId}${generated.recipeSlug ? `, ${generated.recipeSlug}` : ''}). Visual library used as brand/product reference only — not posted as-is. Prompt: ${generated.promptText.slice(0, 140)}`;
      for (const url of urls) {
        picks.push({
          proposedImageUrl: url,
          imageSource: 'runway',
          imageAlt: `Runway AI image ${picks.length + 1}`,
          imageRationale: rationale,
          runwayTaskId: generated.taskId,
        });
        if (picks.length >= target) break;
      }
      if (picks.length >= target) break;
    }

    return picks.slice(0, target);
  }

  private async publishReel(
    input: {
      organizationId: string;
      action: PlanAction;
      goal: string;
      businessContext?: string | null;
      profile: BusinessProfile;
      brief?: AgentExecutionBrief | null;
    },
    ctx: InstagramContext
  ): Promise<InstagramPublishState> {
    let videoUrl = input.brief?.videoUrl?.trim();
    let runwayTaskId: string | undefined;
    let imageRationale: string | undefined;

    if (!videoUrl?.startsWith('https://')) {
      const generated = await generateRunwayVideoForInstagram({
        organizationId: input.organizationId,
        profile: input.profile,
        action: input.action,
        brief: {
          ...(input.brief ?? { fullRequest: input.action.title }),
          mediaFormat: 'reel',
          videoSource: 'runway',
          recipeSlug:
            input.brief?.recipeSlug?.includes('video') ||
            input.brief?.recipeSlug?.includes('ugc') ||
            input.brief?.recipeSlug?.includes('product-ad')
              ? input.brief.recipeSlug
              : 'runway-text-to-video',
        },
      });
      videoUrl = generated.videoUrl;
      runwayTaskId = generated.taskId;
      imageRationale = `Runway text-to-video (${generated.taskId}${generated.recipeSlug ? `, ${generated.recipeSlug}` : ''}${generated.endpoint ? ` via ${generated.endpoint}` : ''}). Prompt: ${generated.promptText.slice(0, 160)}`;
      if (!generated.videoUrl?.startsWith('https://')) {
        throw new Error(
          generated.imageUrls?.length
            ? 'Runway returned still images, but this step expected a Reel video. Ask again as an Instagram feed photo (text-to-image), or request a Reel with text-to-video.'
            : 'Runway text-to-video did not return a video URL for this Reel.'
        );
      }
    }

    const deliverable = await this.claude.generateInstagramAssist({
      action: input.action,
      goal: input.goal,
      businessContext: input.businessContext,
      images: [],
      userInstructions: input.brief?.fullRequest ?? null,
      ctaText: input.brief?.ctaText ?? null,
    });

    let caption = [deliverable.primaryCopy, deliverable.extras?.hashtags]
      .filter(Boolean)
      .join('\n\n');

    if (input.brief?.ctaText && !caption.toLowerCase().includes(input.brief.ctaText.toLowerCase())) {
      caption = `${caption}\n\nShop ${input.brief.ctaText} — link in bio.`;
    }

    const published = await igPublishReel(ctx, {
      videoUrl: videoUrl!,
      caption,
      shareToFeed: true,
    });

    let permalink: string | null = null;
    try {
      const media = await igGetMedia(ctx, published.mediaId);
      permalink = media.permalink ?? null;
    } catch {
      permalink = null;
    }

    return {
      kind: 'instagram_publish',
      mediaType: 'reel',
      caption,
      imageUrl: videoUrl!,
      videoUrl: videoUrl!,
      imageSource: 'runway',
      imageRationale,
      runwayTaskId,
      mediaId: published.mediaId,
      permalink,
      reasoning: deliverable.reasoning,
      slideCount: 1,
    };
  }

  private async publishStory(
    input: {
      organizationId: string;
      action: PlanAction;
      goal: string;
      businessContext?: string | null;
      profile: BusinessProfile;
      brief?: AgentExecutionBrief | null;
    },
    ctx: InstagramContext
  ): Promise<InstagramPublishState> {
    let videoUrl = input.brief?.videoUrl?.trim();
    let runwayTaskId: string | undefined;

    if ((!videoUrl || !videoUrl.startsWith('https://')) && wantsRunwayVideo(input.action, input.brief)) {
      const generated = await generateRunwayVideoForInstagram({
        organizationId: input.organizationId,
        profile: input.profile,
        action: input.action,
        brief: {
          ...(input.brief ?? { fullRequest: input.action.title }),
          mediaFormat: 'story',
          videoSource: 'runway',
          recipeSlug: input.brief?.recipeSlug ?? 'runway-text-to-video',
        },
      });
      videoUrl = generated.videoUrl;
      runwayTaskId = generated.taskId;
    }

    const useVideo = Boolean(videoUrl?.startsWith('https://'));

    let imageUrl: string | undefined;
    let imageSource: 'shopify' | 'unsplash' | 'canva' | 'runway' | 'library' = 'library';
    let imageAttribution: string | undefined;
    let imageRationale: string | undefined;
    let canvaDesignId: string | undefined;
    let canvaEditUrl: string | undefined;

    if (!useVideo) {
      if (!isRunwayConfigured()) {
        throw new Error(
          'Instagram story stills require Runway text-to-image — set RUNWAY_API_KEY. Visual library is reference only.'
        );
      }
      const storyBrief: AgentExecutionBrief = input.brief
        ? { ...input.brief, slideCount: 1, mediaFormat: 'story' }
        : { fullRequest: input.action.title, slideCount: 1, mediaFormat: 'story' };
      const imagePicks = await this.generateRunwayStillPicks(
        { ...input, brief: storyBrief },
        1
      );
      const pick = imagePicks[0];
      if (!pick?.proposedImageUrl?.startsWith('https://')) {
        throw new Error('Runway text-to-image did not return a story image.');
      }
      if (pick.runwayTaskId) runwayTaskId = pick.runwayTaskId;
      imageUrl = pick.proposedImageUrl;
      imageSource = 'runway';
      imageAttribution = pick.imageAttribution;
      imageRationale = pick.imageRationale;
      canvaDesignId = pick.canvaDesignId;
      canvaEditUrl = pick.canvaEditUrl;
    }

    const published = await igPublishStory(
      ctx,
      useVideo ? { videoUrl: videoUrl! } : { imageUrl: imageUrl! }
    );

    let permalink: string | null = null;
    try {
      const media = await igGetMedia(ctx, published.mediaId);
      permalink = media.permalink ?? null;
    } catch {
      permalink = null;
    }

    const storyNote = useVideo
      ? runwayTaskId
        ? `AI video story published via Runway (task ${runwayTaskId}) — disappears after 24 hours.`
        : 'Video story published (disappears after 24 hours).'
      : 'Image story published (disappears after 24 hours). Instagram Stories do not support captions via the API — add text stickers in the Instagram app if needed.';

    return {
      kind: 'instagram_publish',
      mediaType: 'story',
      caption: storyNote,
      imageUrl: imageUrl ?? videoUrl ?? '',
      imageUrls: imageUrl ? [imageUrl] : undefined,
      imageSource: useVideo ? 'runway' : imageSource,
      imageAttribution,
      imageRationale: useVideo ? undefined : imageRationale,
      canvaDesignId: useVideo ? undefined : canvaDesignId,
      canvaEditUrl: useVideo ? undefined : canvaEditUrl,
      mediaId: published.mediaId,
      permalink,
      reasoning: input.brief?.fullRequest
        ? `Story created from your instructions: ${input.brief.fullRequest.slice(0, 200)}`
        : `Story for: ${input.action.title}`,
      slideCount: 1,
    };
  }

  private async assertPublishQuota(ctx: InstagramContext): Promise<void> {
    const limit = await igGetPublishLimit(ctx);
    const bucket = (
      limit as {
        data?: Array<{ quota_usage?: number; config?: { quota_total?: number } }>;
      }
    ).data?.[0];

    if (
      bucket?.config?.quota_total != null &&
      bucket.quota_usage != null &&
      bucket.quota_usage >= bucket.config.quota_total
    ) {
      throw new Error(
        'Instagram publishing limit reached for the last 24 hours — try again tomorrow.'
      );
    }
  }
}

function toAssistImage(pick: BrandImagePick) {
  return {
    url: pick.proposedImageUrl,
    alt: pick.imageAlt,
    source: pick.imageSource,
    attribution: pick.imageAttribution,
    rationale: pick.imageRationale,
  };
}
