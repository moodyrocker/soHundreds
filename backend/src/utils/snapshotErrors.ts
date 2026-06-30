export function gaSnapshotUserMessage(status: number, body: string): string {
  if (status === 401 || status === 403) {
    if (body.includes('Analytics Data API has not been used') || body.includes('accessNotConfigured')) {
      return 'Enable the Google Analytics Data API on the same GCP project as your OAuth client, then refresh Integrations.';
    }
    return 'Google Analytics authorization failed or was revoked. Disconnect and reconnect on Integrations.';
  }
  if (status === 404) {
    return 'GA4 property not found. Pick a different property on Integrations.';
  }
  return 'GA4 metrics could not be loaded. Check property access and API enablement.';
}

export function metaSnapshotUserMessage(status: number, body: string): string {
  if (status === 401 || status === 190) {
    return 'Meta authorization expired or was revoked. Disconnect and reconnect on Integrations.';
  }
  if (status === 403 || body.includes('permission')) {
    return 'Your Meta user lacks ads_read access to this ad account. Check Business Manager permissions.';
  }
  return 'Meta campaign insights could not be loaded. Try reconnecting on Integrations.';
}

export function shopifySnapshotUserMessage(status: number, body = ''): string {
  if (body.includes('merchant approval for')) {
    return 'Shopify connected without API permissions. In Partners → your app → Configuration (app version), enable read_products and read_orders, save/release, then disconnect & reconnect and approve all permissions.';
  }

  const orderAccessDenied =
    body.includes('not approved to access the Order') ||
    body.includes('protected customer data') ||
    body.includes('Access denied');

  if (status === 403 && orderAccessDenied) {
    return 'Shopify connected, but order access is blocked. In Partners → your app → API access, request Protected customer data (Orders), then disconnect and reconnect here.';
  }
  if (status === 401 || status === 403) {
    return 'Shopify authorization failed or was revoked. Disconnect and reconnect on Integrations.';
  }
  return 'Shopify store data could not be loaded. Check store access and app scopes.';
}
