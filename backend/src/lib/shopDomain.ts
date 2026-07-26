/** Normalize user input to a *.myshopify.com hostname. */
export function normalizeShopDomain(input: string): string {
  let shop = input.trim().toLowerCase();
  shop = shop.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!shop) {
    throw new Error('Shop domain is required');
  }
  if (!shop.includes('.')) {
    shop = `${shop}.myshopify.com`;
  }
  if (!shop.endsWith('.myshopify.com')) {
    throw new Error('Enter your Shopify store as name.myshopify.com');
  }
  return shop;
}
