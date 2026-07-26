import { apiFetch } from '@/lib/api';

export type ContentRecipeMedium = 'video' | 'image';
export type ContentRecipeProvider = 'runway' | 'canva' | 'generic';

export type ContentRecipe = {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  description: string | null;
  medium: ContentRecipeMedium;
  provider: ContentRecipeProvider;
  channel: string | null;
  promptTemplate: string;
  styleNotes: string | null;
  negativePrompt: string | null;
  model: string | null;
  aspectRatio: string | null;
  durationSeconds: number | null;
  tags: string[];
  isDefault: boolean;
  isActive: boolean;
  config: Record<string, unknown>;
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ContentRecipeInput = {
  slug: string;
  name: string;
  description?: string | null;
  medium?: ContentRecipeMedium;
  provider?: ContentRecipeProvider;
  channel?: string | null;
  promptTemplate: string;
  styleNotes?: string | null;
  negativePrompt?: string | null;
  model?: string | null;
  aspectRatio?: string | null;
  durationSeconds?: number | null;
  tags?: string[];
  isDefault?: boolean;
  isActive?: boolean;
  config?: Record<string, unknown>;
};

/** Runway engines a saved custom recipe can be based on */
export const RUNWAY_CUSTOM_ENGINES = [
  {
    id: 'text_to_image',
    label: 'Text to image (lowest credit)',
    medium: 'image' as const,
    model: 'gen4_image',
    runwayPath: '/text_to_image',
    docsUrl: 'https://dev.runwayml.com/endpoints/text_to_image',
    defaultDuration: null as number | null,
    defaultPrompt: [
      'Photorealistic vertical 9:16 Instagram feed photograph.',
      'Brand: {{brand}}.',
      'Show @product ({{product}}) in natural use — not floating alone.',
      'Mood / setting: {{vibe}}.',
      'Natural lighting, shallow depth of field, premium aesthetic, no logos or text overlays.',
      'Match @product packaging only; invent a new scene.',
      '{{brief}}',
    ].join(' '),
  },
  {
    id: 'text_to_video',
    label: 'Text to video (Gen-4.5)',
    medium: 'video' as const,
    model: 'gen4.5',
    runwayPath: '/text_to_video',
    docsUrl: 'https://dev.runwayml.com/endpoints/text_to_video',
    defaultDuration: 5,
    defaultPrompt: [
      'Photorealistic vertical 9:16 lifestyle marketing video for Instagram.',
      'Brand: {{brand}}.',
      'Feature @product ({{product}}) in natural use.',
      'Mood / setting: {{vibe}} moments.',
      'Natural lighting, shallow depth of field, premium aesthetic.',
      'When a product still drives the shot, match packaging identity only.',
      '{{brief}}',
    ].join(' '),
  },
  {
    id: 'product_ad',
    label: 'Product Ad (needs product photo)',
    medium: 'video' as const,
    model: null as string | null,
    runwayPath: '/recipes/product_ad',
    docsUrl: 'https://dev.runwayml.com/recipes/product_ad',
    defaultDuration: 4,
    defaultPrompt:
      'Product ad for the provided product photo of {{product}}. Brand: {{brand}}. Concept: {{vibe}}. Offer: {{offer}}. Preserve exact packaging from the product photo. {{brief}}',
  },
  {
    id: 'product_ugc',
    label: 'Product UGC (needs character + product)',
    medium: 'video' as const,
    model: null as string | null,
    runwayPath: '/recipes/product_ugc',
    docsUrl: 'https://dev.runwayml.com/recipes/product_ugc',
    defaultDuration: 4,
    defaultPrompt:
      'UGC creator video featuring the provided product photo of {{product}}. Brand: {{brand}}. Audience: {{audience}}. Direction: {{vibe}}. Keep packaging identity from the product photo. {{brief}}',
  },
  {
    id: 'product_campaign_image',
    label: 'Campaign image (needs product photo)',
    medium: 'image' as const,
    model: null as string | null,
    runwayPath: '/recipes/product_campaign_image',
    docsUrl: 'https://dev.runwayml.com/recipes/product_campaign_image',
    defaultDuration: null as number | null,
    defaultPrompt:
      'High-key fashion campaign for the provided product photo of {{product}}. Brand: {{brand}}. Style: {{vibe}}. Preserve exact packaging from the product photo. {{brief}}',
  },
] as const;

export type RunwayCustomEngineId = (typeof RUNWAY_CUSTOM_ENGINES)[number]['id'];

export function isOfficialRunwayRecipe(recipe: ContentRecipe): boolean {
  return recipe.config?.catalogSource === 'runway_official';
}

export function engineIdFromRecipe(recipe: ContentRecipe): RunwayCustomEngineId {
  const basedOn = recipe.config?.basedOnOfficial;
  if (typeof basedOn === 'string' && RUNWAY_CUSTOM_ENGINES.some((e) => e.id === basedOn)) {
    return basedOn as RunwayCustomEngineId;
  }
  const path = typeof recipe.config?.runwayPath === 'string' ? recipe.config.runwayPath : '';
  const hit = RUNWAY_CUSTOM_ENGINES.find((e) => e.runwayPath === path);
  if (hit) return hit.id;
  return recipe.medium === 'image' ? 'text_to_image' : 'text_to_video';
}

export function buildUserRecipeConfig(engineId: RunwayCustomEngineId) {
  const engine = RUNWAY_CUSTOM_ENGINES.find((e) => e.id === engineId) ?? RUNWAY_CUSTOM_ENGINES[0];
  return {
    catalogSource: 'user_custom' as const,
    basedOnOfficial: engine.id,
    runwayPath: engine.runwayPath,
    docsUrl: engine.docsUrl,
    workflowVersion: engine.runwayPath.startsWith('/recipes/') ? '2026-06' : null,
    outputKind: engine.medium === 'image' ? 'images' : 'video',
  };
}

export function askPhraseForRecipe(recipe: Pick<ContentRecipe, 'slug' | 'medium'>): string {
  if (recipe.medium === 'image') {
    return `Use recipe ${recipe.slug} — Instagram feed photo`;
  }
  return `Use recipe ${recipe.slug} — Instagram Reel`;
}

export type PromptQuality = {
  score: number;
  label: 'Thin' | 'OK' | 'Strong' | 'Sharp';
  /** CSS tone class for coloured confidence badge */
  tone: 'thin' | 'ok' | 'strong' | 'sharp';
  variant: 'warn' | 'default' | 'accent' | 'success';
};

/** Glanceable heuristic — not a model critique. */
export function scoreRecipePrompt(
  recipe: Pick<ContentRecipe, 'promptTemplate' | 'styleNotes' | 'negativePrompt'>
): PromptQuality {
  const prompt = recipe.promptTemplate?.trim() ?? '';
  let score = 0;

  if (prompt.length >= 20) score += 15;
  if (prompt.length >= 120 && prompt.length <= 900) score += 15;
  else if (prompt.length > 900) score += 8;
  if (prompt.length < 40) score -= 10;

  const placeholders = ['brand', 'product', 'vibe', 'brief', 'audience', 'offer'] as const;
  for (const key of placeholders) {
    if (new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'i').test(prompt)) score += 10;
  }
  if (/@product\b/i.test(prompt)) score += 12;

  if (recipe.styleNotes?.trim()) score += 10;
  if (recipe.negativePrompt?.trim()) score += 10;
  if (/light|lighting|camera|depth|lifestyle|premium|cinematic|natural/i.test(prompt)) {
    score += 8;
  }
  if (/logo|watermark|text overlay/i.test(recipe.negativePrompt ?? '') || /no logos/i.test(prompt)) {
    score += 5;
  }
  if (/wrong product|generic stock/i.test(recipe.negativePrompt ?? '')) {
    score += 3;
  }

  score = Math.max(0, Math.min(100, score));

  if (score >= 80) {
    return { score, label: 'Sharp', tone: 'sharp', variant: 'success' };
  }
  if (score >= 60) {
    return { score, label: 'Strong', tone: 'strong', variant: 'accent' };
  }
  if (score >= 40) {
    return { score, label: 'OK', tone: 'ok', variant: 'default' };
  }
  return { score, label: 'Thin', tone: 'thin', variant: 'warn' };
}

export function listContentRecipes(
  token: string,
  organizationId: string,
  filters?: {
    medium?: ContentRecipeMedium;
    provider?: ContentRecipeProvider;
    channel?: string;
    activeOnly?: boolean;
  }
) {
  const params = new URLSearchParams();
  if (filters?.medium) params.set('medium', filters.medium);
  if (filters?.provider) params.set('provider', filters.provider);
  if (filters?.channel) params.set('channel', filters.channel);
  if (filters?.activeOnly === false) params.set('activeOnly', 'false');
  const qs = params.toString();
  return apiFetch<{ recipes: ContentRecipe[] }>(
    `/api/content-recipes${qs ? `?${qs}` : ''}`,
    { token, organizationId, timeoutMs: 20_000 }
  );
}

export function createContentRecipe(
  token: string,
  organizationId: string,
  body: ContentRecipeInput
) {
  return apiFetch<{ recipe: ContentRecipe }>('/api/content-recipes', {
    token,
    organizationId,
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs: 20_000,
  });
}

export function updateContentRecipe(
  token: string,
  organizationId: string,
  recipeId: string,
  body: Partial<ContentRecipeInput>
) {
  return apiFetch<{ recipe: ContentRecipe }>(`/api/content-recipes/${recipeId}`, {
    token,
    organizationId,
    method: 'PATCH',
    body: JSON.stringify(body),
    timeoutMs: 20_000,
  });
}

export function deleteContentRecipe(
  token: string,
  organizationId: string,
  recipeId: string
) {
  return apiFetch<void>(`/api/content-recipes/${recipeId}`, {
    token,
    organizationId,
    method: 'DELETE',
    timeoutMs: 20_000,
  });
}

export type RecipePromptDraft = {
  name: string;
  description: string;
  promptTemplate: string;
  styleNotes: string;
  negativePrompt: string;
};

export function draftRecipePrompt(
  token: string,
  organizationId: string,
  body: {
    engine: 'text_to_image' | 'text_to_video';
    recipeName?: string | null;
    concept?: string | null;
    currentPrompt?: string | null;
  }
) {
  return apiFetch<{ draft: RecipePromptDraft }>('/api/content-recipes/draft-prompt', {
    token,
    organizationId,
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs: 90_000,
  });
}

export type RecipePromptPreview = {
  imageUrl: string;
  taskId: string;
  promptText: string;
  libraryImageUrl: string | null;
  libraryTitle: string | null;
};

export function previewRecipePrompt(
  token: string,
  organizationId: string,
  body: {
    promptTemplate: string;
    styleNotes?: string | null;
    negativePrompt?: string | null;
    recipeName?: string | null;
    useLibraryReference?: boolean;
  }
) {
  return apiFetch<{ preview: RecipePromptPreview }>('/api/content-recipes/preview', {
    token,
    organizationId,
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs: 180_000,
  });
}
