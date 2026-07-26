/** Build an absolute storefront URL from a shop domain + path. */
export function shopStorefrontUrl(
  shopDomain: string | null | undefined,
  path: string
): string {
  const domain = (shopDomain ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '');
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (!domain) return normalized;
  return `https://${domain}${normalized}`;
}
