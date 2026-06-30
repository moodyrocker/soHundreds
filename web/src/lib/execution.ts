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
  imageSource?: 'shopify' | 'unsplash';
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
  shopifyMcpPrompt?: string;
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

export type ExecutionPayload =
  | ProductSeoState
  | ShopifyPageState
  | GoogleAdsCampaignState
  | MetaAdsCampaignState
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
  platform: 'shopify' | 'google_ads' | 'meta_ads' | 'hundres';
  executionType:
    | 'update_product_seo'
    | 'create_shopify_page'
    | 'create_google_ads_campaign'
    | 'create_meta_ads_campaign'
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

export function isProductSeo(p: ExecutionPayload): p is ProductSeoState {
  return p.kind === 'product_seo';
}

export function isGoogleAdsCampaign(p: ExecutionPayload): p is GoogleAdsCampaignState {
  return p.kind === 'google_ads_campaign';
}

export function isMetaAdsCampaign(p: ExecutionPayload): p is MetaAdsCampaignState {
  return p.kind === 'meta_ads_campaign';
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
