import { apiFetch } from '@/lib/api';
import type { BrandVisualUseFor } from '@/lib/brand-visuals';

export type RunwayPromptTestGenerationStatus = 'succeeded' | 'failed';
export type RunwayPromptTestReviewStatus = 'pending' | 'approved' | 'rejected';

export type RunwayPromptTest = {
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
  libraryAssetId?: string | null;
};

export type RunwayPromptTestApproveInput = {
  title?: string | null;
  theme?: string | null;
  notes?: string | null;
  tags?: string[];
  useFor?: BrandVisualUseFor;
  saveAsRecipe?: boolean;
  recipeName?: string | null;
};

export function listRunwayPromptTests(
  token: string,
  organizationId: string,
  filters?: { reviewStatus?: RunwayPromptTestReviewStatus | 'all' }
) {
  const params = new URLSearchParams();
  if (filters?.reviewStatus && filters.reviewStatus !== 'all') {
    params.set('reviewStatus', filters.reviewStatus);
  }
  const qs = params.toString();
  return apiFetch<{ tests: RunwayPromptTest[] }>(`/api/runway-tests${qs ? `?${qs}` : ''}`, {
    token,
    organizationId,
    timeoutMs: 20_000,
  });
}

export function createRunwayPromptTest(
  token: string,
  organizationId: string,
  body: RunwayPromptTestCreateInput
) {
  return apiFetch<{ test: RunwayPromptTest }>('/api/runway-tests', {
    token,
    organizationId,
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs: 180_000,
  });
}

export function approveRunwayPromptTest(
  token: string,
  organizationId: string,
  testId: string,
  body: RunwayPromptTestApproveInput = {}
) {
  return apiFetch<{ test: RunwayPromptTest }>(`/api/runway-tests/${testId}/approve`, {
    token,
    organizationId,
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs: 30_000,
  });
}

export function rejectRunwayPromptTest(
  token: string,
  organizationId: string,
  testId: string,
  notes?: string | null
) {
  return apiFetch<{ test: RunwayPromptTest }>(`/api/runway-tests/${testId}/reject`, {
    token,
    organizationId,
    method: 'POST',
    body: JSON.stringify({ notes: notes ?? null }),
    timeoutMs: 20_000,
  });
}

export function deleteRunwayPromptTest(token: string, organizationId: string, testId: string) {
  return apiFetch<void>(`/api/runway-tests/${testId}`, {
    token,
    organizationId,
    method: 'DELETE',
    timeoutMs: 20_000,
  });
}
