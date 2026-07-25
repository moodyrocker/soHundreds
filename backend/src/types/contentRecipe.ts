/** Org-scoped reusable generation recipes (Runway video/image knowledge base). */

export type ContentRecipeMedium = 'video' | 'image';
export type ContentRecipeProvider = 'runway' | 'canva' | 'generic';

export type ContentRecipeRecord = {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  description: string | null;
  medium: ContentRecipeMedium;
  provider: ContentRecipeProvider;
  channel: string | null;
  /** Template with {{brand}}, {{product}}, {{vibe}}, {{brief}}, {{audience}}, {{offer}} */
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

export type ContentRecipeResolveQuery = {
  medium: ContentRecipeMedium;
  provider?: ContentRecipeProvider;
  channel?: string | null;
  /** Explicit recipe key from chat/agent brief */
  slug?: string | null;
  tags?: string[];
};

export type ContentRecipePromptVars = {
  brand?: string | null;
  product?: string | null;
  vibe?: string | null;
  brief?: string | null;
  audience?: string | null;
  offer?: string | null;
  [key: string]: string | null | undefined;
};
