import type { ContentRecipeInput } from '../types/contentRecipe.js';

/**
 * Official Runway Developer recipes / endpoints we seed into every org.
 * Docs:
 * - https://dev.runwayml.com/recipes/product_ugc
 * - https://dev.runwayml.com/recipes/product_ad
 * - https://dev.runwayml.com/recipes/product_campaign_image
 * - https://dev.runwayml.com/endpoints/text_to_video
 * - https://dev.runwayml.com/endpoints/text_to_image
 */
export const RUNWAY_WORKFLOW_VERSION = '2026-06' as const;

export type RunwayOfficialRecipeConfig = {
  catalogSource: 'runway_official' | 'user_custom';
  runwayPath: string;
  docsUrl: string;
  workflowVersion?: string | null;
  /** Inputs the agent must gather before calling the recipe API */
  requiredInputs?: Array<'productImage' | 'productImages' | 'characterImage'>;
  defaultDuration?: number;
  outputKind?: 'video' | 'images';
  basedOnOfficial?: string;
};

export function getOfficialRecipeConfig(
  recipe: { config?: Record<string, unknown> } | null | undefined
): RunwayOfficialRecipeConfig | null {
  const cfg = recipe?.config;
  if (!cfg || typeof cfg.runwayPath !== 'string') return null;
  // Official seeds and user recipes that pick a Runway engine both carry runwayPath
  if (
    cfg.catalogSource !== 'runway_official' &&
    cfg.catalogSource !== 'user_custom' &&
    !cfg.basedOnOfficial
  ) {
    return null;
  }
  return cfg as unknown as RunwayOfficialRecipeConfig;
}

/** Engines users can base a saved custom recipe on */
export const RUNWAY_CUSTOM_ENGINES = [
  {
    id: 'text_to_image',
    label: 'Text to image (lowest credit)',
    medium: 'image' as const,
    model: 'gen4_image',
    runwayPath: '/text_to_image',
    docsUrl: 'https://dev.runwayml.com/endpoints/text_to_image',
    requiredInputs: [] as Array<'productImage' | 'productImages' | 'characterImage'>,
    defaultDuration: undefined as number | undefined,
  },
  {
    id: 'text_to_video',
    label: 'Text to video (Gen-4.5)',
    medium: 'video' as const,
    model: 'gen4.5',
    runwayPath: '/text_to_video',
    docsUrl: 'https://dev.runwayml.com/endpoints/text_to_video',
    requiredInputs: [] as Array<'productImage' | 'productImages' | 'characterImage'>,
    defaultDuration: 5,
  },
  {
    id: 'product_ad',
    label: 'Product Ad (needs product photo)',
    medium: 'video' as const,
    model: null,
    runwayPath: '/recipes/product_ad',
    docsUrl: 'https://dev.runwayml.com/recipes/product_ad',
    requiredInputs: ['productImages'] as Array<'productImage' | 'productImages' | 'characterImage'>,
    defaultDuration: 4,
  },
  {
    id: 'product_ugc',
    label: 'Product UGC (needs character + product)',
    medium: 'video' as const,
    model: null,
    runwayPath: '/recipes/product_ugc',
    docsUrl: 'https://dev.runwayml.com/recipes/product_ugc',
    requiredInputs: ['characterImage', 'productImage'] as Array<
      'productImage' | 'productImages' | 'characterImage'
    >,
    defaultDuration: 4,
  },
  {
    id: 'product_campaign_image',
    label: 'Campaign image (needs product photo)',
    medium: 'image' as const,
    model: null,
    runwayPath: '/recipes/product_campaign_image',
    docsUrl: 'https://dev.runwayml.com/recipes/product_campaign_image',
    requiredInputs: ['productImage'] as Array<'productImage' | 'productImages' | 'characterImage'>,
    defaultDuration: undefined as number | undefined,
  },
] as const;

export type RunwayCustomEngineId = (typeof RUNWAY_CUSTOM_ENGINES)[number]['id'];

export function buildUserRecipeConfig(engineId: RunwayCustomEngineId): Record<string, unknown> {
  const engine = RUNWAY_CUSTOM_ENGINES.find((e) => e.id === engineId) ?? RUNWAY_CUSTOM_ENGINES[0];
  return {
    catalogSource: 'user_custom',
    basedOnOfficial: engine.id,
    runwayPath: engine.runwayPath,
    docsUrl: engine.docsUrl,
    workflowVersion: engine.runwayPath.startsWith('/recipes/') ? RUNWAY_WORKFLOW_VERSION : null,
    requiredInputs: [...engine.requiredInputs],
    defaultDuration: engine.defaultDuration ?? null,
    outputKind: engine.medium === 'image' ? 'images' : 'video',
  };
}

export const RUNWAY_CORE_OFFICIAL_RECIPES: ContentRecipeInput[] = [
  {
    slug: 'runway-text-to-video',
    name: 'Text to video (Gen-4.5)',
    description:
      'Official Runway text-to-video. Lifestyle motion for Reels — library stills as product reference only.',
    medium: 'video',
    provider: 'runway',
    channel: 'instagram',
    promptTemplate: [
      'Photorealistic vertical 9:16 lifestyle marketing video for Instagram Reels.',
      'Brand: {{brand}}.',
      'Feature @product ({{product}}) in natural use — not a static packshot montage.',
      'Setting / mood: {{vibe}} moments in a real environment (bathroom, gym, commute, morning routine).',
      'Soft natural light, shallow depth of field, subtle camera motion, premium but authentic.',
      'When a product still drives the shot, match packaging identity only — invent new scene and motion; do not copy the reference 1:1.',
      '{{brief}}',
    ].join(' '),
    styleNotes:
      'Lifestyle-first Reel; product in context; soft natural light; authentic premium social video',
    negativePrompt:
      'static packshot, floating bottle on plain background, logos, text overlays, watermarks, cartoons, blurry, warped labels, stock-photo stiffness, identical repeated frames, wrong product, generic stock jar',
    model: 'gen4.5',
    aspectRatio: '720:1280',
    durationSeconds: 5,
    tags: ['runway', 'official', 'text_to_video', 'reel', 'instagram', 'default'],
    isDefault: true,
    isActive: true,
    config: {
      catalogSource: 'runway_official',
      runwayPath: '/text_to_video',
      docsUrl: 'https://dev.runwayml.com/endpoints/text_to_video',
      workflowVersion: null,
      requiredInputs: [],
      defaultDuration: 5,
      outputKind: 'video',
    } satisfies RunwayOfficialRecipeConfig,
  },
  {
    slug: 'runway-product-ugc',
    name: 'Product UGC',
    description:
      'Vertical UGC-style ad from a character photo + product photo + brief (Runway recipe product_ugc).',
    medium: 'video',
    provider: 'runway',
    channel: 'instagram',
    promptTemplate:
      'UGC creator video featuring the provided product photo of {{product}}. Brand: {{brand}}. Audience: {{audience}}. Direction: {{vibe}}. Keep packaging identity from the product photo. {{brief}}',
    styleNotes: 'Native UGC, talking-to-camera feel, authentic product demo',
    negativePrompt: 'heavy text overlays, watermarks, stock-photo stiffness, wrong product, warped labels',
    model: null,
    aspectRatio: '720:1280',
    durationSeconds: 5,
    tags: ['runway', 'official', 'product_ugc', 'ugc', 'reel', 'instagram', 'paid'],
    isDefault: false,
    isActive: true,
    config: {
      catalogSource: 'runway_official',
      runwayPath: '/recipes/product_ugc',
      docsUrl: 'https://dev.runwayml.com/recipes/product_ugc',
      workflowVersion: RUNWAY_WORKFLOW_VERSION,
      requiredInputs: ['characterImage', 'productImage'],
      defaultDuration: 5,
      outputKind: 'video',
    } satisfies RunwayOfficialRecipeConfig,
  },
  {
    slug: 'runway-product-ad',
    name: 'Product Ad',
    description:
      'Cinematic product ad video from product photo(s) — social, ecommerce, or paid (Runway recipe product_ad).',
    medium: 'video',
    provider: 'runway',
    channel: 'instagram',
    promptTemplate:
      'Product ad for the provided product photo of {{product}}. Brand: {{brand}}. Concept: {{vibe}}. Offer: {{offer}}. Preserve exact packaging from the product photo. {{brief}}',
    styleNotes: 'High motion, fashion-editorial product hero, ready for social/paid',
    negativePrompt: 'blurry product, unreadable labels, cluttered backgrounds, wrong product, generic stock jar',
    model: null,
    aspectRatio: '720:1280',
    durationSeconds: 5,
    tags: ['runway', 'official', 'product_ad', 'ad', 'reel', 'instagram', 'paid'],
    isDefault: false,
    isActive: true,
    config: {
      catalogSource: 'runway_official',
      runwayPath: '/recipes/product_ad',
      docsUrl: 'https://dev.runwayml.com/recipes/product_ad',
      workflowVersion: RUNWAY_WORKFLOW_VERSION,
      requiredInputs: ['productImages'],
      defaultDuration: 5,
      outputKind: 'video',
    } satisfies RunwayOfficialRecipeConfig,
  },
  {
    slug: 'runway-product-campaign-image',
    name: 'Product Campaign Image',
    description:
      'Four fashion campaign stills from a product photo + style brief (Runway recipe product_campaign_image).',
    medium: 'image',
    provider: 'runway',
    channel: 'instagram',
    promptTemplate:
      'High-key fashion campaign for the provided product photo of {{product}}. Brand: {{brand}}. Style: {{vibe}}. Preserve exact packaging from the product photo. {{brief}}',
    styleNotes: 'Fashion editorial campaign stills, product preserved',
    negativePrompt: 'warped packaging, unreadable logo, extra limbs, wrong product, generic stock jar',
    model: null,
    aspectRatio: '1080:1920',
    durationSeconds: null,
    tags: ['runway', 'official', 'product_campaign_image', 'campaign', 'image', 'instagram', 'carousel'],
    isDefault: false,
    isActive: true,
    config: {
      catalogSource: 'runway_official',
      runwayPath: '/recipes/product_campaign_image',
      docsUrl: 'https://dev.runwayml.com/recipes/product_campaign_image',
      workflowVersion: RUNWAY_WORKFLOW_VERSION,
      requiredInputs: ['productImage'],
      outputKind: 'images',
    } satisfies RunwayOfficialRecipeConfig,
  },
  {
    slug: 'runway-text-to-image',
    name: 'Text to image (Gen-4 Image)',
    description:
      'Official Runway text-to-image for Instagram feed. Lifestyle stills; Visual library is brand/product reference only.',
    medium: 'image',
    provider: 'runway',
    channel: 'instagram',
    promptTemplate: [
      'Photorealistic vertical 9:16 Instagram feed photograph — lifestyle first, not a catalog packshot.',
      'Brand: {{brand}}.',
      'Show @product ({{product}}) in natural use or context (hands applying, shelf in a real bathroom, gym bag, morning light) — not floating alone on a plain studio backdrop.',
      'Setting / mood: {{vibe}}; soft natural light; shallow depth of field; premium but real.',
      'Vary composition and crop; no logos, text overlays, or watermarks.',
      'Match @product packaging/identity only — generate a new original scene; do not reproduce the reference photo.',
      '{{brief}}',
    ].join(' '),
    styleNotes:
      'Lifestyle Instagram still; in-context product use; soft natural light; authentic premium social photo',
    negativePrompt:
      'dead-on packshot, floating product on plain white or marble void, identical hero angle every time, logos, text overlays, watermarks, cartoons, blurry, warped labels, extra limbs, generic stock skincare bottle cliché, wrong product, random jar',
    model: 'gen4_image',
    aspectRatio: '1080:1920',
    durationSeconds: null,
    tags: ['runway', 'official', 'text_to_image', 'image', 'feed', 'instagram', 'lowest-credit'],
    isDefault: true,
    isActive: true,
    config: {
      catalogSource: 'runway_official',
      runwayPath: '/text_to_image',
      docsUrl: 'https://dev.runwayml.com/endpoints/text_to_image',
      workflowVersion: null,
      requiredInputs: [],
      outputKind: 'images',
    } satisfies RunwayOfficialRecipeConfig,
  },
];

/**
 * Ten Instagram still prompt examples — seeded into Recipes and auto-rotated
 * so feed posts vary (lifestyle scenes, not the same packshot).
 * Placeholders: {{brand}} {{product}} {{vibe}} {{audience}} {{offer}} {{brief}}
 * Product photo: @product (Visual library reference via Runway referenceImages)
 */
const STILL_T2I_CONFIG = {
  catalogSource: 'runway_official' as const,
  runwayPath: '/text_to_image',
  docsUrl: 'https://dev.runwayml.com/endpoints/text_to_image',
  workflowVersion: null,
  requiredInputs: [] as string[],
  outputKind: 'images' as const,
  styleExample: true,
};

const STILL_NEGATIVE =
  'dead-on packshot, floating product on plain white/marble void, logos, text overlays, watermarks, cartoons, blurry, warped labels, extra limbs, identical repeated angle, wrong product, generic stock jar';

function stillStyleRecipe(
  slug: string,
  name: string,
  description: string,
  promptParts: string[],
  styleNotes: string
): ContentRecipeInput {
  return {
    slug,
    name,
    description,
    medium: 'image',
    provider: 'runway',
    channel: 'instagram',
    promptTemplate: [
      'Photorealistic vertical 9:16 Instagram feed photograph.',
      'Brand: {{brand}}. Hero product is @product ({{product}}). Audience: {{audience}}.',
      ...promptParts,
      'Soft natural light, shallow depth of field, premium but real. No logos, text overlays, or watermarks.',
      'Match @product packaging/identity only — generate a NEW scene; do not copy the reference 1:1.',
      '{{brief}}',
    ].join(' '),
    styleNotes,
    negativePrompt: STILL_NEGATIVE,
    model: 'gen4_image',
    aspectRatio: '1080:1920',
    durationSeconds: null,
    tags: ['runway', 'official', 'text_to_image', 'feed', 'instagram', 'style_example'],
    isDefault: false,
    isActive: true,
    config: { ...STILL_T2I_CONFIG },
  };
}

export const INSTAGRAM_STILL_STYLE_EXAMPLES: ContentRecipeInput[] = [
  stillStyleRecipe(
    'runway-ig-still-morning-routine',
    'IG still · Morning bathroom routine',
    'Example: soft morning light, product in a real bathroom routine.',
    [
      'Scene: early morning bathroom — @product on a lived-in vanity or in hands mid-routine.',
      'Mood: {{vibe}}, calm, fresh, everyday premium.',
    ],
    'Morning bathroom lifestyle; hands or shelf context; window light'
  ),
  stillStyleRecipe(
    'runway-ig-still-post-gym',
    'IG still · Post-gym recovery',
    'Example: after training — gym bag, locker, or home recovery moment.',
    [
      'Scene: post-workout — gym bag, locker bench, or kitchen counter; @product as part of recovery.',
      'Mood: {{vibe}}, energetic but grounded, real sweat-to-clean transition.',
    ],
    'Post-gym lifestyle; active recovery context; candid premium'
  ),
  stillStyleRecipe(
    'runway-ig-still-hands-macro',
    'IG still · Hands applying (macro)',
    'Example: close-up of product being applied — texture and ritual.',
    [
      'Scene: tight crop of hands applying or dispensing @product; show texture and ritual.',
      'Mood: {{vibe}}, intimate, clean, editorial but human.',
    ],
    'Macro application; texture focus; intimate crop'
  ),
  stillStyleRecipe(
    'runway-ig-still-flat-lay',
    'IG still · Flat lay ingredients',
    'Example: top-down flat lay with product + supporting props (not a sterile packshot).',
    [
      'Scene: top-down flat lay — @product with a few supporting props (towel, water glass, plant); lived-in surface.',
      'Mood: {{vibe}}, organized but natural, Instagram flat-lay language.',
    ],
    'Flat lay with props; top-down; lifestyle surface'
  ),
  stillStyleRecipe(
    'runway-ig-still-bag-commute',
    'IG still · Bag / commute detail',
    'Example: product tucked in a bag or pocket — on-the-go life.',
    [
      'Scene: @product peeking from a bag, jacket pocket, or desk on the go.',
      'Mood: {{vibe}}, urban, practical, candid.',
    ],
    'On-the-go / commute; bag or pocket detail'
  ),
  stillStyleRecipe(
    'runway-ig-still-window-light',
    'IG still · Soft window light',
    'Example: product near a bright window — airy, premium daylight.',
    [
      'Scene: @product near a bright window with soft shadows; real room depth behind it.',
      'Mood: {{vibe}}, airy, quiet luxury, daylight.',
    ],
    'Window daylight; airy room depth; quiet luxury'
  ),
  stillStyleRecipe(
    'runway-ig-still-steam-fresh',
    'IG still · Shower steam / fresh',
    'Example: steamy mirror or post-shower freshness without cliché marble voids.',
    [
      'Scene: post-shower freshness — slight steam, towel, @product in use or just used.',
      'Mood: {{vibe}}, clean, refreshing, sensory.',
    ],
    'Post-shower steam; sensory freshness'
  ),
  stillStyleRecipe(
    'runway-ig-still-shelf-candid',
    'IG still · Shelf / vanity candid',
    'Example: product among real bathroom clutter — authentic shelf story.',
    [
      'Scene: bathroom shelf or vanity with @product among a few real items (not empty marble void).',
      'Mood: {{vibe}}, candid, lived-in, trustworthy.',
    ],
    'Lived-in shelf/vanity; candid authenticity'
  ),
  stillStyleRecipe(
    'runway-ig-still-outdoor-day',
    'IG still · Outdoor daylight',
    'Example: outdoor or balcony daylight — travel / fresh air feel.',
    [
      'Scene: outdoor or balcony daylight — @product in a natural outdoor moment (travel, walk, fresh air).',
      'Mood: {{vibe}}, open, bright, real world.',
    ],
    'Outdoor daylight; travel/fresh-air lifestyle'
  ),
  stillStyleRecipe(
    'runway-ig-still-texture-editorial',
    'IG still · Texture editorial',
    'Example: editorial texture close-up — formula, fabric, skin-adjacent detail.',
    [
      'Scene: editorial texture study — formula, fabric, water droplets, or skin-adjacent detail featuring @product.',
      'Mood: {{vibe}}, high-end social editorial, tactile.',
    ],
    'Editorial texture; tactile detail; premium social'
  ),
];

/** All official seeds: core Runway engines + Instagram still style examples. */
export const RUNWAY_OFFICIAL_RECIPES: ContentRecipeInput[] = [
  ...RUNWAY_CORE_OFFICIAL_RECIPES,
  ...INSTAGRAM_STILL_STYLE_EXAMPLES,
];
