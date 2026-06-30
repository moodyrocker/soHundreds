import type { PlanAction } from './plan.js';

export type ExecutionPlatform = 'shopify' | 'google_ads' | 'meta_ads' | 'hundres';

export type ExecutionMode = 'automated_write' | 'assist';

export type ExecutionType =
  | 'update_product_seo'
  | 'create_shopify_page'
  | 'create_google_ads_campaign'
  | 'create_meta_ads_campaign'
  | 'assist_deliverable';

export type ExecutionStatus =
  | 'previewed'
  | 'executed'
  | 'skipped'
  | 'failed'
  | 'rolled_back';

export type ExecutionRisk = 'low' | 'medium' | 'high';

export interface ProductSeoState {
  kind: 'product_seo';
  productId: string;
  productTitle: string;
  seoTitle: string;
  seoDescription: string;
  /** Why this product and SEO angle were chosen. */
  reasoning?: string;
}

export interface AssistDeliverable {
  kind: 'assist_deliverable';
  headline: string;
  primaryCopy: string;
  steps: string[];
  extras: Record<string, string>;
  pasteInstructions: string;
  /** Why the AI chose this approach (shown in autopilot UI). */
  reasoning?: string;
  /** Claude.ai + Shopify MCP prompt for blog/content when write_content unavailable. */
  shopifyMcpPrompt?: string;
  /** Instagram assist preview — optional proposed image (manual post only). */
  proposedImageUrl?: string;
  imageSource?: 'shopify' | 'unsplash';
  imageAlt?: string;
  imageAttribution?: string;
  imageRationale?: string;
}

export interface ShopifyPageState {
  kind: 'shopify_page';
  pageId: string | null;
  title: string;
  handle: string;
  bodyHtml: string;
  seoTitle: string;
  seoDescription: string;
  isPublished: boolean;
  /** Copy-paste prompt for Claude.ai + Shopify MCP when write_content is unavailable. */
  shopifyMcpPrompt?: string;
  /** Why the AI structured the page this way. */
  reasoning?: string;
}

export type GoogleAdsKeywordMatchType = 'BROAD' | 'PHRASE' | 'EXACT';

export interface GoogleAdsAdGroupProposal {
  name: string;
  keywords: Array<{ text: string; matchType: GoogleAdsKeywordMatchType }>;
  headlines: string[];
  descriptions: string[];
  finalUrl: string;
  adGroupId?: string | null;
  adGroupResourceName?: string | null;
}

export interface GoogleAdsCampaignState {
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
}

export interface MetaAdsCreativeProposal {
  name: string;
  primaryText: string;
  headline: string;
  description?: string;
  cta: 'SHOP_NOW' | 'LEARN_MORE' | 'SIGN_UP' | 'ORDER_NOW';
  finalUrl: string;
  adId?: string | null;
  creativeId?: string | null;
}

export interface MetaAdsCampaignState {
  kind: 'meta_ads_campaign';
  campaignName: string;
  dailyBudget: number;
  currencyCode: 'GBP' | 'USD' | 'EUR';
  objective: 'OUTCOME_TRAFFIC' | 'OUTCOME_SALES';
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
}

export type ExecutionPayload =
  | ProductSeoState
  | ShopifyPageState
  | GoogleAdsCampaignState
  | MetaAdsCampaignState
  | AssistDeliverable;

export interface ExecutionRoute {
  mode: ExecutionMode;
  executionType: ExecutionType;
  platform: ExecutionPlatform;
  riskLevel: ExecutionRisk;
  summary: string;
}

export interface ExecutionRecord {
  id: string;
  organizationId: string;
  strategyId: string;
  actionId: string;
  platform: ExecutionPlatform;
  executionType: ExecutionType;
  status: ExecutionStatus;
  riskLevel: ExecutionRisk;
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
}

export interface ExecutionPreviewResponse {
  execution: ExecutionRecord;
  mode: ExecutionMode;
  canExecute: boolean;
  scopeWarning: string | null;
  reasoning?: string;
}

export interface BatchExecutionResult {
  actionId: string;
  ok: boolean;
  execution?: ExecutionRecord;
  error?: string;
}

export type { AutopilotPreflight, BlockedActionPreflight, SnapshotPreflightLine } from '../services/autopilotPreflightService.js';

export interface BatchRunResponse {
  phase: 'preflight' | 'executed';
  preflight: import('../services/autopilotPreflightService.js').AutopilotPreflight;
  results: BatchExecutionResult[];
}
