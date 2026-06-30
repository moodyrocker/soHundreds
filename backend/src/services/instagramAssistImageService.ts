import type { BusinessProfile } from './businessProfileService.js';
import type { PlanAction } from '../types/plan.js';
import { isUnsplashConfigured, unsplashSearchPhotos } from '../lib/unsplashClient.js';
import { MCPConnectionService } from './mcpConnectionService.js';

const API_VERSION = process.env.SHOPIFY_API_VERSION ?? '2024-10';

export type BrandImagePick = {
  proposedImageUrl: string;
  imageSource: 'shopify' | 'unsplash';
  imageAlt: string;
  imageAttribution?: string;
  imageRationale: string;
};

type ShopifyProductImage = {
  title?: string;
  status?: string;
  image?: { src?: string; alt?: string | null };
  images?: Array<{ src?: string; alt?: string | null }>;
};

function buildSearchKeywords(profile: BusinessProfile, action: PlanAction): string {
  const parts = [
    profile.offer,
    profile.oneLiner,
    profile.audience,
    action.title,
    action.outcome,
  ]
    .filter(Boolean)
    .map((s) => s!.trim())
    .filter((s) => s.length > 0);

  const combined = parts.join(' ').slice(0, 120);
  return combined || 'product lifestyle brand';
}

function scoreProductMatch(title: string | undefined, keywords: string): number {
  if (!title?.trim()) return 0;
  const words = keywords.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const lower = title.toLowerCase();
  return words.reduce((score, word) => (lower.includes(word) ? score + 1 : score), 0);
}

async function pickShopifyProductImage(
  organizationId: string,
  keywords: string
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

  for (const product of ranked) {
    const src = product.image?.src ?? product.images?.[0]?.src;
    if (!src?.startsWith('https://')) continue;

    const alt =
      product.image?.alt?.trim() ||
      product.images?.[0]?.alt?.trim() ||
      product.title?.trim() ||
      'Product photo';

    return {
      proposedImageUrl: src,
      imageSource: 'shopify',
      imageAlt: alt,
      imageRationale: `Using your Shopify product photo${product.title ? ` for "${product.title}"` : ''} — on-brand because it is your real catalog imagery.`,
    };
  }

  return null;
}

async function pickUnsplashImage(keywords: string): Promise<BrandImagePick | null> {
  if (!isUnsplashConfigured()) return null;

  try {
    const { results } = await unsplashSearchPhotos({
      query: keywords,
      perPage: 5,
      orientation: 'squarish',
    });

    const photo = results.find((p) => p.urls.regular?.startsWith('https://'));
    if (!photo) return null;

    const attribution = `Photo by ${photo.user.name} on Unsplash`;

    return {
      proposedImageUrl: photo.urls.regular,
      imageSource: 'unsplash',
      imageAlt: photo.alt_description ?? photo.description ?? keywords,
      imageAttribution: attribution,
      imageRationale: `Stock photo from Unsplash matching "${keywords}" — review before posting; prefer your own product shot if available.`,
    };
  } catch {
    return null;
  }
}

export async function pickBrandImageForInstagramAssist(input: {
  organizationId: string;
  profile: BusinessProfile;
  action: PlanAction;
}): Promise<BrandImagePick | null> {
  const keywords = buildSearchKeywords(input.profile, input.action);

  const shopify = await pickShopifyProductImage(input.organizationId, keywords);
  if (shopify) return shopify;

  return pickUnsplashImage(keywords);
}
