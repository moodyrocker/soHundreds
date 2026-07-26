/** When true, Instagram feed posts publish via Graph API instead of assist-only. */
export function isInstagramAutoPublishEnabled(): boolean {
  const raw = process.env.INSTAGRAM_AUTO_PUBLISH?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

/** When true, Shopify pages and blog articles are created live (not draft). */
export function isShopifyAutoPublishLiveEnabled(): boolean {
  const raw = process.env.SHOPIFY_AUTO_PUBLISH_LIVE?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}
