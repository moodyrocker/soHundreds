const API_VERSION = process.env.SHOPIFY_API_VERSION ?? '2024-10';

export type ShopifyGraphqlResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

export async function shopifyGraphql<T>(
  shopDomain: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<ShopifyGraphqlResult<T>> {
  const response = await fetch(
    `https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    return { ok: false, error: body.slice(0, 500), status: response.status };
  }

  const payload = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };

  if (payload.errors?.length) {
    return { ok: false, error: payload.errors.map((e) => e.message).join('; ') };
  }

  if (!payload.data) {
    return { ok: false, error: 'Empty GraphQL response' };
  }

  return { ok: true, data: payload.data };
}

export function shopifyHasWriteProductsScope(grantedScopes: string | undefined): boolean {
  if (!grantedScopes?.trim()) return false;
  return grantedScopes
    .split(',')
    .map((s) => s.trim())
    .includes('write_products');
}

export function shopifyHasWriteContentScope(grantedScopes: string | undefined): boolean {
  if (!grantedScopes?.trim()) return false;
  return grantedScopes
    .split(',')
    .map((s) => s.trim())
    .includes('write_content');
}
