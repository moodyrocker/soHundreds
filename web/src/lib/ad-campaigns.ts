import { apiFetch } from '@/lib/api';

export type AdCampaignChannel = 'meta' | 'instagram' | 'both';
export type AdCampaignStatus = 'draft' | 'ready' | 'pushed' | 'archived';
export type AdCampaignObjective = 'OUTCOME_TRAFFIC' | 'OUTCOME_SALES';
export type AdCampaignCurrency = 'GBP' | 'USD' | 'EUR';
export type AdCreativeImageSource =
  | 'library'
  | 'canva'
  | 'runway'
  | 'shopify'
  | 'unsplash'
  | 'manual'
  | 'none';

export type AdCampaignCreative = {
  name: string;
  primaryText: string;
  headline: string;
  description?: string;
  cta: 'SHOP_NOW' | 'LEARN_MORE' | 'SIGN_UP' | 'ORDER_NOW';
  finalUrl: string;
  imageUrl?: string | null;
  imageSource?: AdCreativeImageSource | null;
  imageHash?: string | null;
  metaAdId?: string | null;
  metaCreativeId?: string | null;
};

export type AdCampaignTargeting = {
  countries: string[];
  ageMin: number;
  ageMax: number;
  interestNotes?: string;
};

export type AdCampaign = {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  description: string | null;
  channel: AdCampaignChannel;
  status: AdCampaignStatus;
  objective: AdCampaignObjective;
  dailyBudget: number;
  currencyCode: AdCampaignCurrency;
  durationDays: number | null;
  targeting: AdCampaignTargeting;
  ads: AdCampaignCreative[];
  reasoning: string | null;
  recipeSlug: string | null;
  sourceExecutionId: string | null;
  metaCampaignId: string | null;
  metaAdSetId: string | null;
  metaAdAccountId: string | null;
  metaPushedAt: string | null;
  isActive: boolean;
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdCampaignInput = {
  slug?: string;
  name: string;
  description?: string | null;
  channel?: AdCampaignChannel;
  status?: AdCampaignStatus;
  objective?: AdCampaignObjective;
  dailyBudget?: number;
  currencyCode?: AdCampaignCurrency;
  durationDays?: number | null;
  targeting?: Partial<AdCampaignTargeting>;
  ads?: AdCampaignCreative[];
  reasoning?: string | null;
  recipeSlug?: string | null;
  isActive?: boolean;
};

export function listAdCampaigns(
  token: string,
  organizationId: string,
  opts?: { activeOnly?: boolean; channel?: AdCampaignChannel }
) {
  const params = new URLSearchParams();
  if (opts?.activeOnly === false) params.set('activeOnly', 'false');
  if (opts?.channel) params.set('channel', opts.channel);
  const qs = params.toString();
  return apiFetch<{ campaigns: AdCampaign[] }>(
    `/api/ad-campaigns${qs ? `?${qs}` : ''}`,
    { token, organizationId, timeoutMs: 20_000 }
  );
}

export function createAdCampaign(
  token: string,
  organizationId: string,
  body: AdCampaignInput
) {
  return apiFetch<{ campaign: AdCampaign }>('/api/ad-campaigns', {
    token,
    organizationId,
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs: 20_000,
  });
}

export function updateAdCampaign(
  token: string,
  organizationId: string,
  campaignId: string,
  body: Partial<AdCampaignInput>
) {
  return apiFetch<{ campaign: AdCampaign }>(`/api/ad-campaigns/${campaignId}`, {
    token,
    organizationId,
    method: 'PATCH',
    body: JSON.stringify(body),
    timeoutMs: 20_000,
  });
}

export function deleteAdCampaign(
  token: string,
  organizationId: string,
  campaignId: string
) {
  return apiFetch<void>(`/api/ad-campaigns/${campaignId}`, {
    token,
    organizationId,
    method: 'DELETE',
    timeoutMs: 20_000,
  });
}

export function generateAdCreatives(
  token: string,
  organizationId: string,
  campaignId: string,
  opts?: { prefer?: 'library' | 'canva' | 'runway' | 'auto'; force?: boolean }
) {
  return apiFetch<{ campaign: AdCampaign }>(
    `/api/ad-campaigns/${campaignId}/generate-creatives`,
    {
      token,
      organizationId,
      method: 'POST',
      body: JSON.stringify(opts ?? {}),
      timeoutMs: 120_000,
    }
  );
}

export function pushAdCampaignToMeta(
  token: string,
  organizationId: string,
  campaignId: string
) {
  return apiFetch<{ campaign: AdCampaign }>(
    `/api/ad-campaigns/${campaignId}/push-to-meta`,
    {
      token,
      organizationId,
      method: 'POST',
      body: JSON.stringify({}),
      timeoutMs: 120_000,
    }
  );
}

export function currencySymbol(code: AdCampaignCurrency): string {
  return code === 'GBP' ? '£' : code === 'EUR' ? '€' : '$';
}
