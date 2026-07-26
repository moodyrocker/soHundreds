import {
  isRunwayConfigured,
  runwayGenerateInstagramReelVideo,
  runwayRecipeProductAd,
  runwayRecipeProductCampaignImage,
  runwayRecipeProductUgc,
  runwayTextToImage,
  runwayWaitForOutputs,
  runwayWaitForVideoUrl,
  type TextToImageRatio,
} from '../lib/runwayClient.js';
import {
  getOfficialRecipeConfig,
  type RunwayOfficialRecipeConfig,
} from '../lib/runwayOfficialRecipes.js';
import type { AgentExecutionBrief } from '../types/agentTask.js';
import type { ContentRecipeRecord } from '../types/contentRecipe.js';
import type { PlanAction } from '../types/plan.js';
import type { BusinessProfile } from './businessProfileService.js';
import { getBusinessProfile } from './businessProfileService.js';
import { ContentRecipeKnowledgeService } from './contentRecipeKnowledgeService.js';
import { BrandVisualLibraryService } from './brandVisualLibraryService.js';

export function wantsRunwayVideo(
  action: PlanAction,
  brief?: AgentExecutionBrief | null
): boolean {
  // Explicit still/image intent always wins over generic "runway" wording
  if (wantsRunwayImage(action, brief)) return false;
  if (brief?.mediaFormat === 'feed' || brief?.mediaFormat === 'carousel') return false;
  if (brief?.videoSource === 'runway') return true;
  if (brief?.mediaFormat === 'reel') return true;
  if (brief?.videoUrl?.startsWith('https://')) return false;
  const blob = `${brief?.fullRequest ?? ''} ${action.title} ${action.outcome} ${action.why}`.toLowerCase();
  if (/text.to.image|text_to_image|feed photo|instagram (feed|post).*image|ai (image|photo|still)/.test(blob)) {
    return false;
  }
  return /ai video|lowest credit|text.to.video|image.to.video|generate.*(reel|video)|(create|make|post|publish).*\bvideo\b|\bvideo\b.*(instagram|reel|post|publish)|instagram.*\bvideo\b|\breels?\b|product.?ugc|product.?ad|runway.*(reel|video)/.test(
    blob
  );
}

/** Prefer Runway still generation for feed/carousel when recipe or phrasing asks for AI image. */
export function wantsRunwayImage(
  action: PlanAction,
  brief?: AgentExecutionBrief | null
): boolean {
  const slug = brief?.recipeSlug?.trim() ?? '';
  if (slug === 'runway-text-to-image' || slug === 'runway-product-campaign-image') return true;
  if (slug.includes('text-to-image') || slug.endsWith('-image') || slug.includes('campaign-image')) {
    return true;
  }
  if (brief?.mediaFormat === 'reel') return false;
  if (brief?.mediaFormat === 'feed' || brief?.mediaFormat === 'carousel') {
    const blobEarly = `${brief?.fullRequest ?? ''} ${action.title}`.toLowerCase();
    if (/runway|text.to.image|ai (image|photo)|campaign.?image/.test(blobEarly)) return true;
  }
  if (brief?.mediaFormat === 'story' && brief?.videoSource === 'runway') return false;
  const blob = `${brief?.fullRequest ?? ''} ${action.title} ${action.outcome} ${action.why}`.toLowerCase();
  return /text.to.image|text_to_image|ai (image|photo|still)|runway.*(image|photo|still)|(?:feed|instagram).*(?:photo|image)|(?:photo|image).*instagram|generate.*(image|photo)|campaign.?image|product[_ -]?campaign/.test(
    blob
  );
}

function preferDuration(
  brief?: AgentExecutionBrief | null,
  recipeDuration?: number | null,
  configDefault?: number
): number {
  const blob = `${brief?.fullRequest ?? ''}`.toLowerCase();
  if (/10\s*s|ten second|longer video/.test(blob)) return 10;
  if (/15\s*s|fifteen/.test(blob)) return 15;
  if (recipeDuration != null && recipeDuration >= 2 && recipeDuration <= 15) return recipeDuration;
  if (configDefault != null) return configDefault;
  return 5;
}

function promptVars(
  profile: BusinessProfile,
  brief?: AgentExecutionBrief | null
): {
  brand: string;
  product: string;
  vibe: string;
  brief: string;
  audience: string;
  offer: string;
} {
  return {
    brand: profile.oneLiner?.trim() || profile.offer?.trim() || 'the brand',
    product:
      brief?.ctaText?.trim() ||
      profile.offer?.trim()?.split(/[,;]/)[0]?.trim() ||
      'hero product',
    vibe:
      brief?.imageSearchQuery?.trim() ||
      (brief?.fullRequest?.match(/clean lifestyle|gym|skincare routine|minimal|cinematic|ugc|editorial/i)?.[0] ??
        'clean lifestyle'),
    brief: brief?.fullRequest?.trim() ?? '',
    audience: profile.audience?.trim() || '',
    offer: profile.offer?.trim() || '',
  };
}

function fallbackPrompt(
  profile: BusinessProfile,
  action: PlanAction,
  brief?: AgentExecutionBrief | null,
  medium: 'image' | 'video' = 'video'
): string {
  const v = promptVars(profile, brief);
  const actionHint = action.title ? `Action / topic: ${action.title}.` : '';
  const briefHint = brief?.fullRequest ? `Creative brief: ${brief.fullRequest.slice(0, 400)}` : '';

  if (medium === 'image') {
    return [
      'Photorealistic vertical 9:16 Instagram feed photograph — lifestyle first, not a catalog packshot.',
      `Brand: ${v.brand}.`,
      `Show @product (${v.product}) in natural use or context, not floating alone.`,
      `Setting / mood: ${v.vibe} — real environment (bathroom shelf, gym bag, hands applying, morning routine), soft natural light, shallow depth of field.`,
      'Vary angle and crop; premium but authentic; no logos, text overlays, or watermarks.',
      'Match @product packaging/identity only — generate a new original scene, do not copy the reference 1:1.',
      actionHint,
      briefHint,
    ]
      .filter(Boolean)
      .join(' ');
  }

  return [
    'Photorealistic vertical 9:16 lifestyle marketing video for Instagram Reels.',
    `Brand: ${v.brand}.`,
    `Feature @product (${v.product}) in natural use (not a static packshot montage).`,
    `Mood / setting: ${v.vibe} moments — real environments, soft natural light, shallow depth of field.`,
    'Smooth subtle camera motion; premium but authentic; no logos, text overlays, or watermarks.',
    'When a product still drives the shot, match packaging identity only — invent a new scene and motion.',
    actionHint,
    briefHint,
  ]
    .filter(Boolean)
    .join(' ');
}

function inferRecipeSlug(
  brief?: AgentExecutionBrief | null,
  action?: PlanAction
): string | null {
  if (brief?.recipeSlug?.trim()) return brief.recipeSlug.trim();
  const blob = `${brief?.fullRequest ?? ''} ${action?.title ?? ''}`.toLowerCase();
  if (/product[_ -]?ugc|\bugc\b|creator.?video|talking.?head/.test(blob)) {
    return 'runway-product-ugc';
  }
  if (/product[_ -]?ad|product.?ad|cinematic.?ad|paid.?placement/.test(blob)) {
    return 'runway-product-ad';
  }
  if (/campaign.?image|product[_ -]?campaign|fashion.?editorial.?image|campaign.?stills?/.test(blob)) {
    return 'runway-product-campaign-image';
  }
  if (/text.to.image|text_to_image|ai (image|photo|still)|runway.*(image|photo)/.test(blob)) {
    return 'runway-text-to-image';
  }
  if (/text.to.video|text_to_video|prompt.?only|no.?product.?photo|\breels?\b|ai video|instagram video/.test(blob)) {
    return 'runway-text-to-video';
  }
  return null;
}

async function resolveProductImageUri(input: {
  organizationId?: string;
  profile: BusinessProfile;
  action: PlanAction;
  brief?: AgentExecutionBrief | null;
}): Promise<string | null> {
  const direct = input.brief?.productImageUrl?.trim();
  if (direct?.startsWith('https://')) return direct;

  if (!input.organizationId) return null;

  try {
    const library = new BrandVisualLibraryService();
    const keywords = [
      input.brief?.imageSearchQuery,
      input.brief?.ctaText,
      input.brief?.fullRequest,
      input.action.title,
      input.profile.offer,
      input.profile.oneLiner,
    ]
      .filter(Boolean)
      .join(' ');

    // Instagram creatives: Visual library only as product/reference stills (no Shopify/stock).
    const assets = await library.pickProductImages(input.organizationId, keywords, {
      count: 1,
    });
    const fromLibrary = assets[0]?.imageUrl;
    if (fromLibrary?.startsWith('https://')) {
      void library.recordUsage(input.organizationId, assets[0].id).catch(() => undefined);
      return fromLibrary;
    }
  } catch {
    // fall through
  }

  return null;
}

/** Resolve a library product image + optional theme for recipe previews / generation. */
export async function resolveLibraryReferenceForRecipe(input: {
  organizationId: string;
  profile: BusinessProfile;
  keywords?: string;
  /** Pin a specific visual-library asset instead of auto-picking. */
  assetId?: string | null;
}): Promise<{ imageUrl: string; theme: string | null; title: string; useFor: string } | null> {
  const library = new BrandVisualLibraryService();

  if (input.assetId?.trim()) {
    const asset = await library.getById(input.organizationId, input.assetId.trim());
    if (asset?.imageUrl?.startsWith('https://') && asset.isActive) {
      void library.recordUsage(input.organizationId, asset.id).catch(() => undefined);
      return {
        imageUrl: asset.imageUrl,
        theme: asset.theme,
        title: asset.title,
        useFor: asset.useFor,
      };
    }
  }

  const keywords = [
    input.keywords,
    input.profile.offer,
    input.profile.oneLiner,
    input.profile.audience,
  ]
    .filter(Boolean)
    .join(' ');
  const assets = await library.pickProductImages(input.organizationId, keywords, { count: 1 });
  const asset = assets[0];
  if (!asset?.imageUrl?.startsWith('https://')) return null;
  void library.recordUsage(input.organizationId, asset.id).catch(() => undefined);
  return {
    imageUrl: asset.imageUrl,
    theme: asset.theme,
    title: asset.title,
    useFor: asset.useFor,
  };
}

/**
 * Runway only honors referenceImages when the prompt contains `@tag`.
 * Long prompts were appending `@product` at the end, then truncating to 1000 chars —
 * so the tag disappeared and Runway invented a random product.
 */
export function bindRunwayProductReference(
  promptText: string,
  options?: { theme?: string | null; title?: string | null; maxLength?: number }
): string {
  const maxLength = options?.maxLength ?? 1000;
  const identity = [
    'The hero product is @product — match its exact packaging, label, shape, and colors.',
    'Generate a NEW lifestyle scene; do not copy the reference photo background or camera angle.',
    options?.title?.trim() ? `Library product: ${options.title.trim()}.` : null,
    options?.theme?.trim() ? `Visual theme: ${options.theme.trim()}.` : null,
  ]
    .filter(Boolean)
    .join(' ');

  let body = promptText.replace(/\s{2,}/g, ' ').trim();
  // Prefer tagging the product over generic jar/bottle language that invents a SKU.
  body = body
    .replace(/\bProduct jar\/container\b/gi, '@product')
    .replace(/\bproduct jar\/container\b/gi, '@product')
    .replace(/\bthe product jar\b/gi, '@product')
    .replace(/\bthe product bottle\b/gi, '@product')
    .replace(/\bhero product\b/gi, '@product');

  if (!/^The hero product is @product/i.test(body)) {
    body = `${identity} ${body}`;
  }

  if (body.length <= maxLength) return body;

  // Keep the leading @product identity; trim scene details from the end.
  const trimmed = body.slice(0, maxLength).replace(/\s+\S*$/, '').trim();
  if (/@product\b/i.test(trimmed)) return trimmed;
  return `${identity} ${promptText}`.replace(/\s{2,}/g, ' ').trim().slice(0, maxLength);
}

/** When no library/reference photo is available, @product is meaningless — fall back to plain wording. */
export function stripRunwayProductTags(promptText: string, maxLength = 1000): string {
  return promptText
    .replace(/@product\b/gi, 'the product')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function inferTextToImageRatio(promptText: string): TextToImageRatio {
  const blob = promptText.toLowerCase();
  if (/\b1\s*:\s*1\b|\bsquare\b|\b1080\s*:\s*1080\b/.test(blob)) return '1080:1080';
  if (/\b16\s*:\s*9\b|\blandscape\b|\b1920\s*:\s*1080\b/.test(blob)) return '1920:1080';
  if (/\b4\s*:\s*5\b|\b1080\s*:\s*1350\b/.test(blob)) return '1080:1440';
  return '1080:1920';
}

function pickExecutableRecipe(input: {
  recipe: ContentRecipeRecord | null;
  productImageUri: string | null;
  characterImageUri: string | null;
  recipes: ContentRecipeKnowledgeService;
  organizationId: string;
  medium: 'video' | 'image';
}): Promise<ContentRecipeRecord | null> {
  // Implemented below as async IIFE caller uses await pick...
  return (async () => {
    const { recipe, productImageUri, characterImageUri, recipes, organizationId, medium } = input;
    const cfg = getOfficialRecipeConfig(recipe);
    // Honor explicit text-to-image / user custom with no required product photos
    if (recipe && cfg && canRunOfficial(cfg, productImageUri, characterImageUri)) {
      return recipe;
    }
    // Keep prompt-only still recipes even when a Shopify photo exists
    if (
      recipe &&
      (recipe.slug === 'runway-text-to-image' ||
        recipe.config?.runwayPath === '/text_to_image' ||
        recipe.config?.basedOnOfficial === 'text_to_image')
    ) {
      return recipe;
    }

    // Prefer official product recipes when we have imagery
    if (productImageUri && characterImageUri) {
      const ugc = await recipes.getBySlug(organizationId, 'runway-product-ugc');
      if (ugc) return ugc;
    }
    if (productImageUri && medium === 'video') {
      const ad = await recipes.getBySlug(organizationId, 'runway-product-ad');
      if (ad) return ad;
    }
    if (productImageUri && medium === 'image') {
      const campaign = await recipes.getBySlug(organizationId, 'runway-product-campaign-image');
      if (campaign) return campaign;
    }

    if (medium === 'image') {
      const style = await recipes.pickLeastUsedInstagramStillStyle(organizationId);
      if (style) return style;
      const t2i = await recipes.getBySlug(organizationId, 'runway-text-to-image');
      if (t2i) return t2i;
    }

    const t2v = await recipes.getBySlug(organizationId, 'runway-text-to-video');
    if (t2v) return t2v;
    return recipe;
  })();
}

function canRunOfficial(
  cfg: RunwayOfficialRecipeConfig,
  productImageUri: string | null,
  characterImageUri: string | null
): boolean {
  const required = cfg.requiredInputs ?? [];
  if (required.includes('characterImage') && !characterImageUri) return false;
  if (
    (required.includes('productImage') || required.includes('productImages')) &&
    !productImageUri
  ) {
    return false;
  }
  return true;
}

export type RunwayGenerationResult = {
  videoUrl?: string;
  imageUrls?: string[];
  taskId: string;
  promptText: string;
  recipeSlug?: string;
  recipeName?: string;
  endpoint?: string;
};

/** Generate via org recipes — prefers official Runway product_ugc / product_ad / text_to_video. */
export async function generateRunwayVideoForInstagram(input: {
  organizationId?: string;
  profile: BusinessProfile;
  action: PlanAction;
  brief?: AgentExecutionBrief | null;
}): Promise<RunwayGenerationResult> {
  if (!isRunwayConfigured()) {
    throw new Error(
      'Runway is not configured — add RUNWAY_API_KEY from https://dev.runwayml.com/ to generate AI video.'
    );
  }

  const recipes = new ContentRecipeKnowledgeService();
  const vars = promptVars(input.profile, input.brief);

  const productImageUri = await resolveProductImageUri(input);
  const characterImageUri = input.brief?.characterImageUrl?.trim()?.startsWith('https://')
    ? input.brief.characterImageUrl.trim()
    : null;

  const medium: 'video' | 'image' =
    input.brief?.mediaFormat === 'feed' || input.brief?.mediaFormat === 'carousel'
      ? 'image'
      : (() => {
          const slug = inferRecipeSlug(input.brief, input.action);
          if (slug === 'runway-product-campaign-image' || slug === 'runway-text-to-image') {
            return 'image';
          }
          return 'video';
        })();

  let promptText = fallbackPrompt(input.profile, input.action, input.brief, medium);
  let recipe: ContentRecipeRecord | null = null;
  if (input.organizationId) {
    await recipes.ensureDefaults(input.organizationId);
    const matched = await recipes.matchFromBrief(
      input.organizationId,
      `${input.brief?.recipeSlug ?? ''} ${input.brief?.fullRequest ?? ''} ${input.action.title}`
    );
    const briefSlug = input.brief?.recipeSlug?.trim() || null;
    const inferred = inferRecipeSlug(input.brief, input.action);
    let preferredSlug =
      matched?.slug ??
      inferred ??
      briefSlug ??
      (medium === 'image' ? 'runway-text-to-image' : 'runway-text-to-video');

    // Feed/carousel with no specific recipe → rotate among 10 lifestyle still examples
    const wantsGenericStill =
      medium === 'image' &&
      !matched &&
      (!briefSlug || briefSlug === 'runway-text-to-image') &&
      (!inferred || inferred === 'runway-text-to-image');
    if (wantsGenericStill) {
      const style = await recipes.pickLeastUsedInstagramStillStyle(input.organizationId);
      if (style) preferredSlug = style.slug;
    }

    recipe = await recipes.resolveForGeneration(input.organizationId, {
      medium,
      provider: 'runway',
      channel: 'instagram',
      slug: preferredSlug,
      tags: preferredSlug
        ? preferredSlug.replace('runway-', '').split('-')
        : medium === 'image'
          ? ['text_to_image', 'feed', 'style_example']
          : ['text_to_video', 'reel'],
    });
    recipe = await pickExecutableRecipe({
      recipe,
      productImageUri,
      characterImageUri,
      recipes,
      organizationId: input.organizationId,
      medium,
    });
  }

  if (recipe) {
    promptText = recipes.renderPrompt(recipe, vars);
  }

  const cfg = getOfficialRecipeConfig(recipe);
  const duration = preferDuration(
    input.brief,
    recipe?.durationSeconds,
    cfg?.defaultDuration
  );
  const version = cfg?.workflowVersion ?? '2026-06';

  if (cfg?.runwayPath === '/recipes/product_ugc' && productImageUri && characterImageUri) {
    const task = await runwayRecipeProductUgc({
      characterImageUri,
      productImageUri,
      productInfo: [vars.product, vars.offer, vars.brand].filter(Boolean).join(' — '),
      userConcept: promptText,
      duration: Math.max(4, duration),
      ratio: '720:1280',
      version,
    });
    const videoUrl = await runwayWaitForVideoUrl(task.id, { maxAttempts: 240 });
    if (input.organizationId && recipe) {
      await recipes.recordUsage(input.organizationId, recipe.id);
    }
    return {
      videoUrl,
      taskId: task.id,
      promptText,
      recipeSlug: recipe?.slug,
      recipeName: recipe?.name,
      endpoint: cfg.runwayPath,
    };
  }

  if (cfg?.runwayPath === '/recipes/product_ad' && productImageUri) {
    const task = await runwayRecipeProductAd({
      productImageUris: [productImageUri],
      productInfo: [vars.product, vars.offer, vars.brand].filter(Boolean).join(' — '),
      userConcept: promptText,
      duration: Math.max(4, duration),
      ratio: '720:1280',
      version,
    });
    const videoUrl = await runwayWaitForVideoUrl(task.id, { maxAttempts: 240 });
    if (input.organizationId && recipe) {
      await recipes.recordUsage(input.organizationId, recipe.id);
    }
    return {
      videoUrl,
      taskId: task.id,
      promptText,
      recipeSlug: recipe?.slug,
      recipeName: recipe?.name,
      endpoint: cfg.runwayPath,
    };
  }

  if (cfg?.runwayPath === '/recipes/product_campaign_image' && productImageUri) {
    const task = await runwayRecipeProductCampaignImage({
      productImageUri,
      prompt: promptText,
      version,
    });
    const { outputs } = await runwayWaitForOutputs(task.id, { minCount: 1, maxAttempts: 240 });
    if (input.organizationId && recipe) {
      await recipes.recordUsage(input.organizationId, recipe.id);
    }
    return {
      imageUrls: outputs,
      // Carousel/feed callers may use images; reel path can fall back later
      videoUrl: undefined,
      taskId: task.id,
      promptText,
      recipeSlug: recipe?.slug,
      recipeName: recipe?.name,
      endpoint: cfg.runwayPath,
    };
  }

  if (cfg?.runwayPath === '/text_to_image' || medium === 'image') {
    const libraryRef = input.organizationId
      ? await resolveLibraryReferenceForRecipe({
          organizationId: input.organizationId,
          profile: input.profile,
          keywords: `${input.brief?.fullRequest ?? ''} ${input.action.title}`,
        }).catch(() => null)
      : null;
    const refUri = productImageUri ?? libraryRef?.imageUrl ?? null;
    const promptWithRef = refUri
      ? bindRunwayProductReference(promptText, {
          theme: libraryRef?.theme,
          title: libraryRef?.title,
        })
      : stripRunwayProductTags(promptText);
    const task = await runwayTextToImage({
      promptText: promptWithRef,
      model: recipe?.model ?? 'gen4_image',
      ratio: inferTextToImageRatio(promptText),
      ...(refUri ? { referenceImages: [{ uri: refUri, tag: 'product' }] } : {}),
    });
    const { outputs } = await runwayWaitForOutputs(task.id, { minCount: 1, maxAttempts: 120 });
    if (input.organizationId && recipe) {
      await recipes.recordUsage(input.organizationId, recipe.id);
    }
    return {
      imageUrls: outputs,
      videoUrl: undefined,
      taskId: task.id,
      promptText: promptWithRef,
      recipeSlug: recipe?.slug ?? 'runway-text-to-image',
      recipeName: recipe?.name ?? 'Text to image (Gen-4 Image)',
      endpoint: '/text_to_image',
    };
  }

  // Default: official text_to_video (or gen4.5).
  // Prefer visual library as the image-to-video reference so Reels stay on-brand.
  const asFiveOrTen = (duration <= 5 ? 5 : 10) as 5 | 10;
  const libraryRef = input.organizationId
    ? await resolveLibraryReferenceForRecipe({
        organizationId: input.organizationId,
        profile: input.profile,
        keywords: `${input.brief?.fullRequest ?? ''} ${input.action.title}`,
      }).catch(() => null)
    : null;
  const promptImage = libraryRef?.imageUrl ?? productImageUri ?? undefined;
  const promptWithLibraryTheme =
    libraryRef?.theme?.trim() && !/theme:|look & feel/i.test(promptText)
      ? `${promptText} Visual theme from library (“${libraryRef.title}”): ${libraryRef.theme.trim()}.`
      : promptText;

  const { taskId, videoUrl } = await runwayGenerateInstagramReelVideo({
    promptText: promptWithLibraryTheme,
    promptImage,
    duration: asFiveOrTen,
  });
  if (input.organizationId && recipe) {
    await recipes.recordUsage(input.organizationId, recipe.id);
  }
  return {
    videoUrl,
    taskId,
    promptText: promptWithLibraryTheme,
    recipeSlug: recipe?.slug ?? 'runway-text-to-video',
    recipeName: recipe?.name ?? 'Text to video (Gen-4.5)',
    endpoint: promptImage ? '/image_to_video' : '/text_to_video',
  };
}

/**
 * Cheap still preview of a recipe prompt via Runway text_to_image.
 * Uses business profile placeholders + visual library as an optional reference.
 */
export async function previewRecipePromptWithRunway(input: {
  organizationId: string;
  promptTemplate: string;
  styleNotes?: string | null;
  negativePrompt?: string | null;
  recipeName?: string | null;
  useLibraryReference?: boolean;
  /** Require a library product photo when useLibraryReference is true (lab default). */
  requireLibraryReference?: boolean;
  /** Pin a specific visual-library asset. */
  libraryAssetId?: string | null;
}): Promise<{
  imageUrl: string;
  taskId: string;
  promptText: string;
  libraryImageUrl: string | null;
  libraryTitle: string | null;
}> {
  if (!isRunwayConfigured()) {
    throw new Error(
      'Runway is not configured — add RUNWAY_API_KEY to preview recipe prompts.'
    );
  }
  if (!input.promptTemplate.trim()) {
    throw new Error('Prompt is required to generate a preview');
  }

  const profile = await getBusinessProfile(input.organizationId);
  const recipes = new ContentRecipeKnowledgeService();
  const vars = promptVars(profile, {
    fullRequest: input.recipeName?.trim() || 'Recipe prompt preview',
  });
  let promptText = recipes.renderPrompt(
    {
      id: 'preview',
      organizationId: input.organizationId,
      slug: 'preview',
      name: input.recipeName?.trim() || 'Preview',
      description: null,
      medium: 'image',
      provider: 'runway',
      channel: 'instagram',
      promptTemplate: input.promptTemplate.trim(),
      styleNotes: input.styleNotes ?? null,
      negativePrompt: input.negativePrompt ?? null,
      model: 'gen4_image',
      aspectRatio: '1080:1920',
      durationSeconds: null,
      tags: [],
      isDefault: false,
      isActive: true,
      config: {},
      usageCount: 0,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    vars
  );

  let libraryImageUrl: string | null = null;
  let libraryTitle: string | null = null;
  if (input.useLibraryReference !== false) {
    const ref = await resolveLibraryReferenceForRecipe({
      organizationId: input.organizationId,
      profile,
      keywords: `${input.recipeName ?? ''} ${input.promptTemplate}`,
      assetId: input.libraryAssetId,
    }).catch(() => null);
    if (ref) {
      libraryImageUrl = ref.imageUrl;
      libraryTitle = ref.title;
      promptText = bindRunwayProductReference(promptText, {
        theme: ref.theme,
        title: ref.title,
      });
    } else if (input.requireLibraryReference || input.libraryAssetId) {
      throw new Error(
        'No product image in the visual library. Add a product photo under Visual library, or pick one before generating.'
      );
    } else {
      promptText = stripRunwayProductTags(promptText);
    }
  } else {
    promptText = stripRunwayProductTags(promptText);
  }

  const task = await runwayTextToImage({
    promptText: promptText.slice(0, 1000),
    model: 'gen4_image',
    ratio: inferTextToImageRatio(input.promptTemplate),
    ...(libraryImageUrl
      ? { referenceImages: [{ uri: libraryImageUrl, tag: 'product' }] }
      : {}),
  });
  const { outputs } = await runwayWaitForOutputs(task.id, {
    minCount: 1,
    maxAttempts: 120,
  });
  const imageUrl = outputs[0];
  if (!imageUrl?.startsWith('https://')) {
    throw new Error('Runway preview did not return an image URL');
  }
  return {
    imageUrl,
    taskId: task.id,
    promptText: promptText.slice(0, 1000),
    libraryImageUrl,
    libraryTitle,
  };
}

/**
 * Agent can invent org recipes over time from successful generation briefs.
 * Idempotent upsert by slug — no human form required for growth of the knowledge base.
 */
export async function upsertAgentLearnedRecipe(input: {
  organizationId: string;
  slug: string;
  name: string;
  promptTemplate: string;
  medium?: 'video' | 'image';
  styleNotes?: string;
  basedOnOfficial?: string;
}): Promise<ContentRecipeRecord> {
  const recipes = new ContentRecipeKnowledgeService();
  await recipes.ensureDefaults(input.organizationId);
  const slug = input.slug.trim().toLowerCase();
  const existing = await recipes.getBySlug(input.organizationId, slug);
  const body = {
    slug,
    name: input.name,
    promptTemplate: input.promptTemplate,
    medium: input.medium ?? 'video',
    provider: 'runway' as const,
    channel: 'instagram',
    styleNotes: input.styleNotes ?? null,
    tags: ['agent-learned', input.basedOnOfficial ?? 'custom'].filter(Boolean),
    isDefault: false,
    isActive: true,
    config: {
      catalogSource: 'agent_learned',
      basedOnOfficial: input.basedOnOfficial ?? null,
      runwayPath: '/text_to_video',
    },
  };
  if (existing) {
    return recipes.update(input.organizationId, existing.id, body);
  }
  return recipes.create(input.organizationId, body);
}
