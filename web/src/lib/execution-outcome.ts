import {
  isGoogleAdsCampaign,
  isInstagramPublish,
  isMetaAdsCampaign,
  isShopifyBlogArticle,
  isShopifyPage,
  type ExecutionRecord,
} from '@/lib/execution';
import { googleAdsConsoleUrl, metaAdsConsoleUrl } from '@/lib/integration-ui-copy';

export type ExecutionOutcomeLink = {
  label: string;
  href: string;
};

function cleanShopDomain(domain: string | undefined | null): string | null {
  if (!domain?.trim()) return null;
  return domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export function getExecutionOutcomeLink(
  execution: ExecutionRecord | null | undefined
): ExecutionOutcomeLink | null {
  if (!execution || execution.status !== 'executed') return null;
  const p = execution.proposedState;

  if (isInstagramPublish(p) && p.permalink) {
    const label =
      p.mediaType === 'story'
        ? 'View story on Instagram'
        : p.mediaType === 'reel'
          ? 'View Reel on Instagram'
          : p.mediaType === 'carousel'
            ? 'View carousel on Instagram'
            : 'View post on Instagram';
    return { label, href: p.permalink };
  }

  if (isShopifyBlogArticle(p)) {
    const domain = cleanShopDomain(p.shopDomain);
    if (domain && p.blogHandle && p.handle) {
      return {
        label: p.isPublished ? 'View article on Shopify' : 'View draft article on Shopify',
        href: `https://${domain}/blogs/${p.blogHandle}/${p.handle}`,
      };
    }
  }

  if (isShopifyPage(p) && p.handle) {
    const domain = cleanShopDomain(p.shopDomain);
    if (domain) {
      return {
        label: p.isPublished ? 'View page on Shopify' : 'View page on Shopify (may be draft)',
        href: `https://${domain}/pages/${p.handle}`,
      };
    }
  }

  if (isMetaAdsCampaign(p) && p.campaignId) {
    return {
      label: 'Open in Ads Manager',
      href: metaAdsConsoleUrl(p.adAccountId, p.campaignId),
    };
  }

  if (isGoogleAdsCampaign(p) && p.customerId) {
    return {
      label: 'Open in Google Ads',
      href: googleAdsConsoleUrl(p.customerId),
    };
  }

  return null;
}
