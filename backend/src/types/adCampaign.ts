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
  /** Visual direction from the agent for image generation */
  imageBrief?: string | null;
  /** HTTPS image for Meta upload / Instagram preview */
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

export type AdCampaignRecord = {
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
  sourceExecutionId?: string | null;
  isActive?: boolean;
};
