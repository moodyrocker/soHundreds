import { apiFetch } from '@/lib/api';

export type ExecutionMode = 'automated_write' | 'assist';

export type ProductSeoState = {
  kind: 'product_seo';
  productId: string;
  productTitle: string;
  seoTitle: string;
  seoDescription: string;
  reasoning?: string;
};

export type AssistDeliverable = {
  kind: 'assist_deliverable';
  headline: string;
  primaryCopy: string;
  steps: string[];
  extras: Record<string, string>;
  pasteInstructions: string;
  reasoning?: string;
  shopifyMcpPrompt?: string;
  proposedImageUrl?: string;
  imageSource?: 'shopify' | 'unsplash' | 'canva' | 'runway' | 'library';
  imageAlt?: string;
  imageAttribution?: string;
  imageRationale?: string;
};

export type ShopifyPageState = {
  kind: 'shopify_page';
  pageId: string | null;
  title: string;
  handle: string;
  bodyHtml: string;
  seoTitle: string;
  seoDescription: string;
  isPublished: boolean;
  shopDomain?: string;
  shopifyMcpPrompt?: string;
  reasoning?: string;
};

export type ShopifyBlogArticleState = {
  kind: 'shopify_blog_article';
  articleId: string | null;
  blogId: string | null;
  blogHandle: string | null;
  title: string;
  handle: string;
  bodyHtml: string;
  seoTitle: string;
  seoDescription: string;
  summaryHtml?: string;
  tags?: string[];
  isPublished: boolean;
  shopDomain?: string;
  reasoning?: string;
};

export type InstagramPublishState = {
  kind: 'instagram_publish';
  mediaType?: 'photo' | 'carousel' | 'story' | 'reel';
  caption: string;
  imageUrl: string;
  imageUrls?: string[];
  slideCount?: number;
  imageSource: 'shopify' | 'unsplash' | 'canva' | 'runway' | 'library';
  imageAttribution?: string;
  imageRationale?: string;
  canvaDesignId?: string;
  canvaEditUrl?: string;
  runwayTaskId?: string;
  videoUrl?: string;
  mediaId?: string | null;
  permalink?: string | null;
  reasoning?: string;
};

export type GoogleAdsKeywordMatchType = 'BROAD' | 'PHRASE' | 'EXACT';

export type GoogleAdsAdGroupProposal = {
  name: string;
  keywords: Array<{ text: string; matchType: GoogleAdsKeywordMatchType }>;
  headlines: string[];
  descriptions: string[];
  finalUrl: string;
};

export type GoogleAdsCampaignState = {
  kind: 'google_ads_campaign';
  campaignName: string;
  dailyBudgetUsd: number;
  advertisingChannelType: 'SEARCH';
  adGroups: GoogleAdsAdGroupProposal[];
  reasoning?: string;
  campaignId?: string | null;
  campaignResourceName?: string | null;
  customerId?: string | null;
  status: 'draft_proposal' | 'created_paused';
};

export type MetaAdsCreativeProposal = {
  name: string;
  primaryText: string;
  headline: string;
  description?: string;
  cta: string;
  finalUrl: string;
  imageBrief?: string | null;
  imageUrl?: string | null;
  imageSource?: string | null;
  imageHash?: string | null;
};

export type MetaAdsCampaignState = {
  kind: 'meta_ads_campaign';
  campaignName: string;
  dailyBudget: number;
  currencyCode: 'GBP' | 'USD' | 'EUR';
  objective: string;
  durationDays?: number;
  targeting: {
    countries: string[];
    ageMin: number;
    ageMax: number;
    interestNotes?: string;
  };
  ads: MetaAdsCreativeProposal[];
  reasoning?: string;
  campaignId?: string | null;
  adSetId?: string | null;
  adAccountId?: string | null;
  status: 'draft_proposal' | 'created_paused';
};

export type MailchimpSequenceEmail = {
  dayOffset: number;
  subject: string;
  previewText?: string;
  bodyPlain: string;
  title?: string;
};

export type MailchimpSequenceState = {
  kind: 'mailchimp_sequence';
  sequenceName: string;
  audienceName?: string;
  fromName: string;
  replyTo: string;
  emails: MailchimpSequenceEmail[];
  reasoning?: string;
  listId?: string | null;
  listName?: string | null;
  createdCampaigns?: Array<{
    campaignId: string;
    webId: number;
    subject: string;
    dayOffset: number;
    archiveUrl?: string;
  }>;
  status: 'draft_proposal' | 'drafts_created';
};

export type ExecutionPayload =
  | ProductSeoState
  | ShopifyPageState
  | ShopifyBlogArticleState
  | InstagramPublishState
  | GoogleAdsCampaignState
  | MetaAdsCampaignState
  | MailchimpSequenceState
  | AssistDeliverable;

export type ExecutionStatus =
  | 'previewed'
  | 'executed'
  | 'skipped'
  | 'failed'
  | 'rolled_back';

export type ExecutionRecord = {
  id: string;
  organizationId: string;
  strategyId: string;
  actionId: string;
  platform: 'shopify' | 'google_ads' | 'meta_ads' | 'instagram' | 'mailchimp' | 'hundres';
  executionType:
    | 'update_product_seo'
    | 'create_shopify_page'
    | 'create_shopify_blog_article'
    | 'create_google_ads_campaign'
    | 'create_meta_ads_campaign'
    | 'create_mailchimp_drafts'
    | 'publish_instagram_photo'
    | 'publish_instagram_story'
    | 'publish_instagram_reel'
    | 'assist_deliverable';
  status: ExecutionStatus;
  riskLevel: 'low' | 'medium' | 'high';
  summary: string;
  targetLabel: string | null;
  beforeState: ExecutionPayload | null;
  proposedState: ExecutionPayload;
  afterState: ExecutionPayload | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  executedAt: string | null;
  rolledBackAt: string | null;
};

export type ExecutionPreviewResponse = {
  execution: ExecutionRecord;
  mode: ExecutionMode;
  canExecute: boolean;
  scopeWarning: string | null;
  reasoning?: string;
};

export type BatchExecutionResult = {
  actionId: string;
  ok: boolean;
  execution?: ExecutionRecord;
  error?: string;
};

export function isAssistDeliverable(p: ExecutionPayload): p is AssistDeliverable {
  return p.kind === 'assist_deliverable';
}

export function isShopifyPage(p: ExecutionPayload): p is ShopifyPageState {
  return p.kind === 'shopify_page';
}

export function isShopifyBlogArticle(p: ExecutionPayload): p is ShopifyBlogArticleState {
  return p.kind === 'shopify_blog_article';
}

export function isInstagramPublish(p: ExecutionPayload): p is InstagramPublishState {
  return p.kind === 'instagram_publish';
}

export function isProductSeo(p: ExecutionPayload): p is ProductSeoState {
  return p.kind === 'product_seo';
}

export function isGoogleAdsCampaign(p: ExecutionPayload): p is GoogleAdsCampaignState {
  return p.kind === 'google_ads_campaign';
}

export function isMetaAdsCampaign(p: ExecutionPayload): p is MetaAdsCampaignState {
  return p.kind === 'meta_ads_campaign';
}

export function isMailchimpSequence(p: ExecutionPayload): p is MailchimpSequenceState {
  return p.kind === 'mailchimp_sequence';
}

export function formatAdBudget(amount: number, currency: 'GBP' | 'USD' | 'EUR' | string): string {
  const symbol = currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : '$';
  return `${symbol}${amount}`;
}

export function extractExecutionReasoning(execution: ExecutionRecord | null): string | null {
  if (!execution) return null;
  const p = execution.proposedState;
  if ('reasoning' in p && typeof p.reasoning === 'string' && p.reasoning.trim()) {
    return p.reasoning.trim();
  }
  return null;
}

export type ActionReasoningLine = {
  actionId: string;
  title: string;
  intent: string;
  routing: string;
};

export function listExecutions(
  token: string,
  organizationId: string,
  strategyId: string
) {
  return apiFetch<{ executions: ExecutionRecord[] }>(
    `/api/execution/strategy/${strategyId}`,
    { token, organizationId }
  );
}

export function previewExecution(
  token: string,
  organizationId: string,
  strategyId: string,
  actionId: string
) {
  return apiFetch<ExecutionPreviewResponse>('/api/execution/preview', {
    method: 'POST',
    token,
    organizationId,
    body: JSON.stringify({ strategyId, actionId }),
    timeoutMs: 300_000,
  });
}

export type SnapshotPreflightLine = {
  platform: string;
  label: string;
  connected: boolean;
  loaded: boolean;
  text: string | null;
  excerpt: string | null;
  error: string | null;
};

export type BlockedActionPreflight = {
  actionId: string;
  title: string;
  reason: string;
  resolution: 'reconnect' | 'connect';
  mcpPrompt?: string;
};

export type AutopilotPreflight = {
  snapshots: SnapshotPreflightLine[];
  blockedActions: BlockedActionPreflight[];
  actionReasoning: ActionReasoningLine[];
  assistCount: number;
  automatedCount: number;
  blockedCount: number;
  summary: string;
  weekReasoning: string;
};

export type BatchRunResponse = {
  phase: 'preflight' | 'executed';
  preflight: AutopilotPreflight;
  results: BatchExecutionResult[];
};

export function runWeekExecutions(
  token: string,
  organizationId: string,
  strategyId: string,
  week: number,
  confirm = false
) {
  return apiFetch<BatchRunResponse>('/api/execution/batch', {
    method: 'POST',
    token,
    organizationId,
    body: JSON.stringify({ strategyId, week, confirm }),
    timeoutMs: 900_000,
  });
}

export function approveExecution(
  token: string,
  organizationId: string,
  executionId: string,
  edits?: { seoTitle?: string; seoDescription?: string }
) {
  return apiFetch<{ execution: ExecutionRecord }>(`/api/execution/${executionId}/approve`, {
    method: 'POST',
    token,
    organizationId,
    body: JSON.stringify(edits ?? {}),
  });
}

export function skipExecution(
  token: string,
  organizationId: string,
  executionId: string
) {
  return apiFetch<{ execution: ExecutionRecord }>(`/api/execution/${executionId}/skip`, {
    method: 'POST',
    token,
    organizationId,
    body: JSON.stringify({}),
  });
}

export function rollbackExecution(
  token: string,
  organizationId: string,
  executionId: string
) {
  return apiFetch<{ execution: ExecutionRecord }>(`/api/execution/${executionId}/rollback`, {
    method: 'POST',
    token,
    organizationId,
    body: JSON.stringify({}),
  });
}
