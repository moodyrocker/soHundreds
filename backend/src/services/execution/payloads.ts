import type {
  ExecutionPayload,
  GoogleAdsCampaignState,
  InstagramPublishState,
  MailchimpSequenceState,
  MetaAdsCampaignState,
  ProductSeoState,
  ShopifyBlogArticleState,
  ShopifyPageState,
} from '../../types/execution.js';

/**
 * Narrowing guards for `action_executions.proposed_state`.
 *
 * The column is JSONB, so what comes back is only as trustworthy as whatever
 * wrote it — and a payload written for one platform must never be handed to
 * another. These throw rather than coerce: a shopify_page payload reaching the
 * Meta executor is a routing bug, and it should stop there rather than produce a
 * campaign built from page copy.
 *
 * Moved out of executionService.ts unchanged, so the same guard runs whether the
 * caller is the service or an executor.
 */

export function asProductSeo(payload: ExecutionPayload): ProductSeoState {
  if (payload.kind !== 'product_seo') {
    throw new Error('Expected Shopify SEO payload');
  }
  return payload;
}

export function asShopifyBlogArticle(payload: ExecutionPayload): ShopifyBlogArticleState {
  if (payload.kind !== 'shopify_blog_article') {
    throw new Error('Expected Shopify blog article payload');
  }
  return payload;
}

export function asInstagramPublish(payload: ExecutionPayload): InstagramPublishState {
  if (payload.kind !== 'instagram_publish') {
    throw new Error('Expected Instagram publish payload');
  }
  return payload;
}

export function asShopifyPage(payload: ExecutionPayload): ShopifyPageState {
  if (payload.kind !== 'shopify_page') {
    throw new Error('Expected Shopify page payload');
  }
  return payload;
}

export function asGoogleAdsCampaign(payload: ExecutionPayload): GoogleAdsCampaignState {
  if (payload.kind !== 'google_ads_campaign') {
    throw new Error('Expected Google Ads campaign payload');
  }
  return payload;
}

export function asMetaAdsCampaign(payload: ExecutionPayload): MetaAdsCampaignState {
  if (payload.kind !== 'meta_ads_campaign') {
    throw new Error('Expected Meta Ads campaign payload');
  }
  return payload;
}

export function asMailchimpSequence(payload: ExecutionPayload): MailchimpSequenceState {
  if (payload.kind !== 'mailchimp_sequence') {
    throw new Error('Expected Mailchimp sequence payload');
  }
  return payload;
}
