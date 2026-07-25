/** User intent from Ask-the-agent chat — passed into execution so images/CTA match instructions. */
export type AgentExecutionBrief = {
  /** Full conversation context + latest message. */
  fullRequest: string;
  imageSource?: 'unsplash' | 'shopify' | 'canva';
  imageSearchQuery?: string;
  slideCount?: number;
  ctaText?: string;
  /** feed (default), carousel, story, or reel */
  mediaFormat?: 'feed' | 'carousel' | 'story' | 'reel';
  /** Public HTTPS video URL for story/reel when user supplies one */
  videoUrl?: string;
  /** Generate AI video via Runway before publish */
  videoSource?: 'runway' | 'user';
  /** Optional content-recipe slug from the org knowledge base */
  recipeSlug?: string;
  /** HTTPS product photo for Runway product_ad / product_ugc / campaign recipes */
  productImageUrl?: string;
  /** HTTPS character/creator photo for product_ugc */
  characterImageUrl?: string;
};

export function buildAgentFullRequest(
  message: string,
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
): string {
  const lines: string[] = [];
  for (const turn of history ?? []) {
    lines.push(`${turn.role === 'user' ? 'User' : 'Agent'}: ${turn.content}`);
  }
  lines.push(`User: ${message}`);
  return lines.join('\n');
}

export function inferAgentBriefFallback(
  message: string,
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
): AgentExecutionBrief {
  const fullRequest = buildAgentFullRequest(message, history);
  const blob = fullRequest.toLowerCase();

  let slideCount: number | undefined;
  const slideMatch = blob.match(/(\d+)\s*(?:-?\s*)?(?:image|slide|photo|card)/);
  if (slideMatch) slideCount = Math.min(10, Math.max(2, parseInt(slideMatch[1], 10)));
  else if (/carousel/.test(blob)) slideCount = 5;

  let imageSearchQuery: string | undefined;
  const unsplashMatch = fullRequest.match(
    /unsplash[^.]*?(?:of|with|showing|featuring)?\s+([a-z0-9\s-]{3,40})/i
  );
  if (unsplashMatch) imageSearchQuery = unsplashMatch[1].trim();
  else if (/pine\s*nut|pine\s*oil/.test(blob)) imageSearchQuery = 'pine nut';
  else if (/clean lifestyle|lifestyle moments/.test(blob)) imageSearchQuery = 'clean lifestyle';

  let ctaText: string | undefined;
  const ctaMatch = fullRequest.match(
    /(?:cta|call to action|link to|promote|shop)\s*(?:to|:)?\s*([A-Za-z][A-Za-z0-9\s'-]{2,48})/i
  );
  if (ctaMatch) ctaText = ctaMatch[1].trim();
  else if (/cream of dreams/i.test(blob)) ctaText = 'Cream of Dreams';

  let mediaFormat: AgentExecutionBrief['mediaFormat'];
  const wantsStill =
    /text.to.image|text_to_image|ai (image|photo|still)|runway.*(image|photo|still)|feed photo|instagram feed/.test(
      blob
    ) && !/\breels?\b|ai video|text.to.video/.test(blob);

  if (/\bstor(y|ies)\b/.test(blob) && !/\breels?\b/.test(blob) && !wantsStill) {
    mediaFormat = 'story';
  } else if (wantsStill || (/feed/.test(blob) && /photo|image|still/.test(blob))) {
    mediaFormat = 'feed';
  } else if (
    /\breels?\b/.test(blob) ||
    /\bugc\b|user.?generated/.test(blob) ||
    /ai video|text.to.video|image.to.video|(create|make|post|publish).*\bvideo\b|\bvideo\b.*(instagram|post|publish)/.test(
      blob
    )
  ) {
    mediaFormat = 'reel';
  } else if (slideCount != null && slideCount >= 2) {
    mediaFormat = 'carousel';
  }

  let videoUrl: string | undefined;
  const videoMatch = fullRequest.match(/https?:\/\/[^\s"'<>]+\.(mp4|mov|webm)/i);
  if (videoMatch) videoUrl = videoMatch[0];

  const recipeSlug = /\bugc\b|user.?generated/.test(blob)
    ? 'runway-product-ugc'
    : /text.to.image|text_to_image|ai (image|photo|still)|runway.*(image|photo|still)|feed photo/.test(
          blob
        )
      ? 'runway-text-to-image'
      : undefined;

  const videoSource: AgentExecutionBrief['videoSource'] | undefined = videoUrl
    ? 'user'
    : recipeSlug === 'runway-text-to-image' || mediaFormat === 'feed' || mediaFormat === 'carousel'
      ? undefined
      : mediaFormat === 'reel' ||
          /\bugc\b|user.?generated/.test(blob) ||
          /ai video|text.to.video|generate.*(reel|video)|realistic.*(reel|video)/.test(blob)
        ? 'runway'
        : undefined;

  return {
    fullRequest,
    imageSource: /canva/.test(blob)
      ? 'canva'
      : /unsplash|stock photo|stock image/.test(blob)
        ? 'unsplash'
        : undefined,
    imageSearchQuery,
    slideCount,
    ctaText,
    mediaFormat:
      recipeSlug === 'runway-text-to-image' && mediaFormat !== 'story'
        ? 'feed'
        : mediaFormat,
    videoUrl,
    videoSource,
    recipeSlug,
  };
}
