import type { PlanAction } from './plan.js';

export type ExecutionPlatform =
  | 'shopify'
  | 'google_ads'
  | 'meta_ads'
  | 'instagram'
  | 'mailchimp'
  | 'hundres';

export type ExecutionMode = 'automated_write' | 'assist';

export type ExecutionType =
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

/**
 * Lifecycle of an execution.
 *
 * `executing` is the claim state: exactly one caller can transition
 * previewed -> executing (see ExecutionService.claimExecutionForWrite), and only
 * that caller performs the external write. It exists so a double-click on
 * Approve, or the autopilot worker racing an operator, cannot create the same
 * Shopify page or ad campaign twice.
 *
 *   previewed -> executing -> executed      (success)
 *             -> executing -> previewed     (pre-flight refusal, retryable)
 *             -> executing -> failed        (external API error)
 *             -> skipped
 *   executed  -> rolled_back
 */
export type ExecutionStatus =
  | 'previewed'
  | 'executing'
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
  imageSource?: 'shopify' | 'unsplash' | 'canva' | 'runway' | 'library';
  imageAlt?: string;
  imageAttribution?: string;
  imageRationale?: string;
}

export interface InstagramPublishState {
  kind: 'instagram_publish';
  mediaType?: 'photo' | 'carousel' | 'story' | 'reel';
  caption: string;
  imageUrl: string;
  imageUrls?: string[];
  slideCount?: number;
  imageSource: 'shopify' | 'unsplash' | 'canva' | 'runway' | 'library';
  imageAttribution?: string;
  /** Why this image was chosen — includes Canva design notes when applicable */
  imageRationale?: string;
  canvaDesignId?: string;
  canvaEditUrl?: string;
  runwayTaskId?: string;
  videoUrl?: string;
  mediaId?: string | null;
  permalink?: string | null;
  reasoning?: string;
}

export interface ShopifyBlogArticleState {
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
  shopDomain?: string;
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
  /** Agent visual direction for auto image generation */
  imageBrief?: string | null;
  /** HTTPS creative image — uploaded to Meta as image_hash when present */
  imageUrl?: string | null;
  imageSource?: string | null;
  imageHash?: string | null;
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

export interface MailchimpSequenceEmail {
  dayOffset: number;
  subject: string;
  previewText?: string;
  bodyPlain: string;
  title?: string;
}

export interface MailchimpSequenceState {
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
  /** Drafts only — never auto-sent */
  status: 'draft_proposal' | 'drafts_created';
}

export type ExecutionPayload =
  | ProductSeoState
  | ShopifyPageState
  | ShopifyBlogArticleState
  | GoogleAdsCampaignState
  | MetaAdsCampaignState
  | MailchimpSequenceState
  | InstagramPublishState
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
