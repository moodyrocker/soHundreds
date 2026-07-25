export type BrandVisualUseFor = 'any' | 'feed' | 'story' | 'reel' | 'product' | 'lifestyle';

export type BrandVisualAssetRecord = {
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
