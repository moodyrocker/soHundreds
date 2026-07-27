import type { AgentExecutionBrief } from '../types/agentTask.js';
import type { BusinessProfile } from './businessProfileService.js';
import type { PlanAction } from '../types/plan.js';
import { isUnsplashConfigured, unsplashSearchPhotos } from '../lib/unsplashClient.js';
import { MCPConnectionService } from './mcpConnectionService.js';
import { pickCanvaImageForInstagram } from './canvaAssistImageService.js';
import { BrandVisualLibraryService } from './brandVisualLibraryService.js';
import type { BrandVisualUseFor } from '../types/brandVisual.js';

const API_VERSION = process.env.SHOPIFY_API_VERSION ?? '2024-10';

export type BrandImagePick = {
  proposedImageUrl: string;
  imageSource: 'shopify' | 'unsplash' | 'canva' | 'runway' | 'library';
  imageAlt: string;
  imageAttribution?: string;
  imageRationale: string;
  canvaDesignId?: string;
  canvaEditUrl?: string;
  libraryAssetId?: string;
};

type ShopifyProductImage = {
  title?: string;
  status?: string;
  image?: { src?: string; alt?: string | null };
  images?: Array<{ src?: string; alt?: string | null }>;
};

function actionBlob(action: PlanAction): string {
  return `${action.title} ${action.outcome} ${action.kpi} ${action.why}`.toLowerCase();
}

export function isCarouselInstagramAction(
  action: PlanAction,
  brief?: AgentExecutionBrief | null
): boolean {
  if (brief?.mediaFormat === 'story') return false;
  if (brief?.mediaFormat === 'carousel') return true;
  if (brief?.slideCount != null && brief.slideCount >= 2) return true;
  const blob = actionBlob(action);
  if (/\bstor(y|ies)\b/.test(blob)) return false;
  return /carousel|\b[2-9]\s*(image|slide|photo)|\b10\s*(image|slide|photo)/.test(blob);
}

export function resolveInstagramSlideCount(
  action: PlanAction,
  brief?: AgentExecutionBrief | null
): number {
  if (brief?.mediaFormat === 'story') return 1;
  if (brief?.slideCount != null) {
    return Math.min(10, Math.max(1, brief.slideCount));
  }
  const blob = actionBlob(action);
  const match = blob.match(/(\d+)\s*(?:-?\s*)?(?:image|slide|photo|card)/);
  if (match) return Math.min(10, Math.max(2, parseInt(match[1], 10)));
  if (/carousel/.test(blob)) return 5;
  return 1;
}

function buildSearchKeywords(
  profile: BusinessProfile,
  action: PlanAction,
  brief?: AgentExecutionBrief | null
): string {
  if (brief?.imageSearchQuery?.trim()) {
    return brief.imageSearchQuery.trim().slice(0, 120);
  }

  const parts = [
    profile.offer,
    profile.oneLiner,
    profile.audience,
    action.title,
    action.outcome,
    brief?.fullRequest,
  ]
    .filter(Boolean)
    .map((s) => s!.trim())
    .filter((s) => s.length > 0);

  const combined = parts.join(' ').slice(0, 120);
  return combined || 'product lifestyle brand';
}

function prefersUnsplash(brief?: AgentExecutionBrief | null, fullBlob?: string): boolean {
  if (brief?.imageSource === 'unsplash') return true;
  if (brief?.imageSource === 'shopify' || brief?.imageSource === 'canva' || brief?.imageSource === 'library') {
    return false;
  }
  const blob = (brief?.fullRequest ?? fullBlob ?? '').toLowerCase();
  return /unsplash|stock photo|stock image/.test(blob);
}

function prefersCanva(brief?: AgentExecutionBrief | null, fullBlob?: string): boolean {
  if (brief?.imageSource === 'canva') return true;
  const blob = (brief?.fullRequest ?? fullBlob ?? '').toLowerCase();
  return /canva|design in canva|create in canva/.test(blob);
}

function prefersShopify(brief?: AgentExecutionBrief | null, fullBlob?: string): boolean {
  if (brief?.imageSource === 'shopify') return true;
  const blob = (brief?.fullRequest ?? fullBlob ?? '').toLowerCase();
  return /\bshopify (product |catalog )?photo|use (the )?product (image|photo)|catalog image/.test(
    blob
  );
}

function scoreProductMatch(title: string | undefined, keywords: string): number {
  if (!title?.trim()) return 0;
  const words = keywords.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const lower = title.toLowerCase();
  return words.reduce((score, word) => (lower.includes(word) ? score + 1 : score), 0);
}

async function pickShopifyProductImage(
  organizationId: string,
  keywords: string,
  opts?: { excludeUrls?: Set<string> }
): Promise<BrandImagePick | null> {
  const mcp = new MCPConnectionService();
  const ctx = await mcp.getShopifyContext(organizationId);
  if (!ctx) return null;

  const url = new URL(`https://${ctx.shopDomain}/admin/api/${API_VERSION}/products.json`);
  url.searchParams.set('limit', '25');
  url.searchParams.set('fields', 'title,status,image,images');
  url.searchParams.set('status', 'active');

  const response = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': ctx.accessToken,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) return null;

  const data = (await response.json()) as { products?: ShopifyProductImage[] };
  const products = (data.products ?? []).filter((p) => p.status === 'active');

  if (!products.length) return null;

  const ranked = [...products].sort(
    (a, b) => scoreProductMatch(b.title, keywords) - scoreProductMatch(a.title, keywords)
  );

  type Candidate = { title?: string; src: string; alt: string };
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const product of ranked) {
    const frames = [product.image, ...(product.images ?? [])].filter(Boolean) as Array<{
      src?: string;
      alt?: string | null;
    }>;
    for (const frame of frames) {
      const src = frame.src;
      if (!src?.startsWith('https://') || seen.has(src)) continue;
      if (opts?.excludeUrls?.has(src)) continue;
      seen.add(src);
      candidates.push({
        title: product.title,
        src,
        alt: frame.alt?.trim() || product.title?.trim() || 'Product photo',
      });
    }
  }

  if (!candidates.length) return null;

  const topScore = scoreProductMatch(candidates[0]?.title, keywords);
  const topBand = candidates.filter(
    (c) => scoreProductMatch(c.title, keywords) >= Math.max(0, topScore - 1)
  );
  const pool = topBand.length ? topBand : candidates;
  const daySeed = Math.floor(Date.now() / 86_400_000);
  const pick = pool[(daySeed + pool.length) % pool.length] ?? pool[0]!;

  return {
    proposedImageUrl: pick.src,
    imageSource: 'shopify',
    imageAlt: pick.alt,
    imageRationale: `Using your Shopify product photo${pick.title ? ` for "${pick.title}"` : ''} — rotated across catalog imagery so posts stay varied.`,
  };
}

function mapUnsplashPhoto(
  photo: Awaited<ReturnType<typeof unsplashSearchPhotos>>['results'][number],
  keywords: string
): BrandImagePick {
  const attribution = `Photo by ${photo.user.name} on Unsplash`;
  return {
    proposedImageUrl: photo.urls.regular,
    imageSource: 'unsplash',
    imageAlt: photo.alt_description ?? photo.description ?? keywords,
    imageAttribution: attribution,
    imageRationale: `Stock photo from Unsplash matching "${keywords}" — selected per your instructions.`,
  };
}

async function pickUnsplashImages(
  keywords: string,
  count: number
): Promise<BrandImagePick[]> {
  if (!isUnsplashConfigured() || count < 1) return [];

  try {
    const { results } = await unsplashSearchPhotos({
      query: keywords,
      perPage: Math.min(10, Math.max(count, 3)),
      orientation: 'squarish',
    });

    const picks: BrandImagePick[] = [];
    const seen = new Set<string>();
    for (const photo of results) {
      const url = photo.urls.regular;
      if (!url?.startsWith('https://') || seen.has(url)) continue;
      seen.add(url);
      picks.push(mapUnsplashPhoto(photo, keywords));
      if (picks.length >= count) break;
    }
    return picks;
  } catch {
    return [];
  }
}

function useForFromBrief(
  brief?: AgentExecutionBrief | null
): BrandVisualUseFor | undefined {
  if (brief?.mediaFormat === 'story') return 'story';
  if (brief?.mediaFormat === 'reel') return 'reel';
  if (brief?.mediaFormat === 'feed' || brief?.mediaFormat === 'carousel') return 'feed';
  return undefined;
}

export async function pickLibraryImages(
  organizationId: string,
  keywords: string,
  count: number,
  useFor?: BrandVisualUseFor
): Promise<BrandImagePick[]> {
  const library = new BrandVisualLibraryService();
  try {
    const assets =
      useFor === 'story' || useFor === 'reel'
        ? await library.pickForBrief(organizationId, keywords, { count, useFor })
        : await library.pickProductImages(organizationId, keywords, { count });
    const picks: BrandImagePick[] = [];
    for (const asset of assets) {
      if (!asset.imageUrl.startsWith('https://')) continue;
      picks.push({
        proposedImageUrl: asset.imageUrl,
        imageSource: 'library',
        imageAlt: asset.title,
        imageRationale: [
          `Brand visual library (${asset.useFor}): ${asset.title}`,
          asset.theme?.trim() ? `Theme: ${asset.theme.trim()}` : null,
        ]
          .filter(Boolean)
          .join(' — '),
        libraryAssetId: asset.id,
      });
      void library.recordUsage(organizationId, asset.id).catch(() => undefined);
    }
    return picks;
  } catch {
    return [];
  }
}


/**
 * Instagram stills: Visual library first.
 * Explicit Canva / Unsplash / Shopify only when the brief asks for them.
 * Callers should fall back to Runway text-to-image when this returns short.
 */
export async function pickInstagramImagesForAssist(input: {
  organizationId: string;
  profile: BusinessProfile;
  action: PlanAction;
  brief?: AgentExecutionBrief | null;
}): Promise<BrandImagePick[]> {
  const slideCount = resolveInstagramSlideCount(input.action, input.brief);
  const keywords = buildSearchKeywords(input.profile, input.action, input.brief);
  const blob = actionBlob(input.action);
  const useCanva = prefersCanva(input.brief, blob);
  const useUnsplash = prefersUnsplash(input.brief, blob);
  const useShopify = prefersShopify(input.brief, blob);
  const useFor = useForFromBrief(input.brief);

  // Default path: brand visual library only.
  if (!useCanva && !useUnsplash && !useShopify) {
    const library = await pickLibraryImages(
      input.organizationId,
      keywords,
      slideCount,
      useFor
    );
    if (library.length) return library.slice(0, slideCount);
    return [];
  }

  if (useCanva && slideCount === 1) {
    const canva = await pickCanvaImageForInstagram(input);
    if (canva) return [canva];
    throw new Error(
      'Connect Canva in Integrations before using Canva creatives for Instagram.'
    );
  }

  if (useUnsplash) {
    const unsplash = await pickUnsplashImages(keywords, slideCount);
    if (unsplash.length) return unsplash.slice(0, slideCount);
  }

  if (useShopify) {
    const shopify = await pickShopifyProductImage(input.organizationId, keywords);
    if (shopify) return [shopify];
  }

  // Explicit source failed — still try library before empty.
  return pickLibraryImages(input.organizationId, keywords, slideCount, useFor);
}
