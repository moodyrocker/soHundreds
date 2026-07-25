import { apiFetch } from '@/lib/api';

export type BrandVisualUseFor = 'any' | 'feed' | 'story' | 'reel' | 'product' | 'lifestyle';

export type BrandVisualAsset = {
  id: string;
  organizationId: string;
  title: string;
  imageUrl: string;
  theme: string | null;
  notes: string | null;
  tags: string[];
  useFor: BrandVisualUseFor;
  isActive: boolean;
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BrandVisualAssetInput = {
  title: string;
  imageUrl: string;
  theme?: string | null;
  notes?: string | null;
  tags?: string[];
  useFor?: BrandVisualUseFor;
  isActive?: boolean;
};

export function listBrandVisuals(
  token: string,
  organizationId: string,
  filters?: { activeOnly?: boolean; useFor?: BrandVisualUseFor }
) {
  const params = new URLSearchParams();
  if (filters?.activeOnly === false) params.set('activeOnly', 'false');
  if (filters?.useFor) params.set('useFor', filters.useFor);
  const qs = params.toString();
  return apiFetch<{ assets: BrandVisualAsset[] }>(
    `/api/brand-visuals${qs ? `?${qs}` : ''}`,
    { token, organizationId, timeoutMs: 20_000 }
  );
}

export function createBrandVisual(
  token: string,
  organizationId: string,
  body: BrandVisualAssetInput
) {
  return apiFetch<{ asset: BrandVisualAsset }>('/api/brand-visuals', {
    token,
    organizationId,
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs: 20_000,
  });
}

export function updateBrandVisual(
  token: string,
  organizationId: string,
  assetId: string,
  body: Partial<BrandVisualAssetInput>
) {
  return apiFetch<{ asset: BrandVisualAsset }>(`/api/brand-visuals/${assetId}`, {
    token,
    organizationId,
    method: 'PATCH',
    body: JSON.stringify(body),
    timeoutMs: 20_000,
  });
}

export function deleteBrandVisual(token: string, organizationId: string, assetId: string) {
  return apiFetch<void>(`/api/brand-visuals/${assetId}`, {
    token,
    organizationId,
    method: 'DELETE',
    timeoutMs: 20_000,
  });
}
