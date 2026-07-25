import type { BrandVisualUseFor } from './brandVisual.js';

export type RunwayPromptTestGenerationStatus = 'succeeded' | 'failed';
export type RunwayPromptTestReviewStatus = 'pending' | 'approved' | 'rejected';

export type RunwayPromptTestRecord = {
  id: string;
  organizationId: string;
  title: string;
  promptText: string;
  renderedPrompt: string | null;
  styleNotes: string | null;
  negativePrompt: string | null;
  useLibraryReference: boolean;
  libraryImageUrl: string | null;
  libraryTitle: string | null;
  taskId: string | null;
  imageUrl: string | null;
  generationStatus: RunwayPromptTestGenerationStatus;
  generationError: string | null;
  reviewStatus: RunwayPromptTestReviewStatus;
  reviewNotes: string | null;
  brandVisualId: string | null;
  recipeId: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RunwayPromptTestCreateInput = {
  title?: string | null;
  promptText: string;
  styleNotes?: string | null;
  negativePrompt?: string | null;
  useLibraryReference?: boolean;
  /** Pin a specific visual-library asset as the @product reference. */
  libraryAssetId?: string | null;
};

export type RunwayPromptTestApproveInput = {
  title?: string | null;
  theme?: string | null;
  notes?: string | null;
  tags?: string[];
  useFor?: BrandVisualUseFor;
  /** Also save the prompt as a custom content recipe */
  saveAsRecipe?: boolean;
  recipeName?: string | null;
};
