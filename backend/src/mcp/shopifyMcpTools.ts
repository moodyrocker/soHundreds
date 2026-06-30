import { shopifyGraphql } from '../lib/shopifyAdmin.js';

const API_VERSION = process.env.SHOPIFY_API_VERSION ?? '2024-10';

export type ShopifyStoreContext = {
  shopDomain: string;
  accessToken: string;
};

type ShopifyOrder = {
  id?: number;
  total_price?: string;
  created_at?: string;
  line_items?: Array<{ title?: string; quantity?: number }>;
};

type ShopifyProduct = {
  title?: string;
  status?: string;
  variants?: Array<{ price?: string }>;
};

async function shopifyGet(
  ctx: ShopifyStoreContext,
  path: string,
  searchParams?: Record<string, string>
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; body: string }> {
  const url = new URL(`https://${ctx.shopDomain}/admin/api/${API_VERSION}/${path}`);
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': ctx.accessToken,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    return { ok: false, status: response.status, body: await response.text() };
  }
  return { ok: true, data: await response.json() };
}

export async function mcpGetStoreSummary(ctx: ShopifyStoreContext): Promise<string> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const ordersResult = await shopifyGet(ctx, 'orders.json', {
    status: 'any',
    created_at_min: since,
    limit: '250',
    fields: 'id,total_price,created_at,line_items',
  });

  if (ordersResult.ok) {
    const orders = ((ordersResult.data as { orders?: ShopifyOrder[] }).orders ?? []) as ShopifyOrder[];
    let revenue = 0;
    const productQty = new Map<string, number>();
    for (const order of orders) {
      revenue += Number(order.total_price ?? 0);
      for (const item of order.line_items ?? []) {
        const title = item.title ?? 'Product';
        productQty.set(title, (productQty.get(title) ?? 0) + (item.quantity ?? 1));
      }
    }
    const top = [...productQty.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    const lines = [
      `Shopify store: ${ctx.shopDomain}`,
      'Date range: last 30 days',
      '',
      `Orders: ${orders.length}`,
      `Revenue (order totals): $${revenue.toFixed(2)}`,
      '',
      'Top products by units sold:',
      ...(top.length
        ? top.map(([name, qty]) => `  - ${name}: ${qty} units`)
        : ['  (no line items in this period)']),
    ];
    return lines.join('\n');
  }

  const productsResult = await shopifyGet(ctx, 'products.json', {
    limit: '50',
    fields: 'title,status,variants',
  });
  if (!productsResult.ok) {
    throw new Error(`Shopify API error ${productsResult.status}: ${productsResult.body.slice(0, 300)}`);
  }

  const products = ((productsResult.data as { products?: ShopifyProduct[] }).products ??
    []) as ShopifyProduct[];
  const active = products.filter((p) => p.status === 'active');
  const lines = [
    `Shopify store: ${ctx.shopDomain}`,
    'Catalog snapshot (orders unavailable — enable Protected customer data in Partners)',
    '',
    `Products: ${products.length} (${active.length} active)`,
    '',
    'Active products:',
    ...(active.length
      ? active.slice(0, 12).map((p) => {
          const price = p.variants?.[0]?.price ? `$${p.variants[0].price}` : 'n/a';
          return `  - ${p.title ?? 'Product'}: ${price}`;
        })
      : ['  (none)']),
  ];
  return lines.join('\n');
}

export async function mcpListProducts(ctx: ShopifyStoreContext, limit = 25): Promise<string> {
  const result = await shopifyGet(ctx, 'products.json', {
    limit: String(Math.min(limit, 50)),
    fields: 'title,status,variants',
  });
  if (!result.ok) {
    throw new Error(`list_products failed: ${result.status} ${result.body.slice(0, 200)}`);
  }
  const products = ((result.data as { products?: ShopifyProduct[] }).products ?? []) as ShopifyProduct[];
  return JSON.stringify(
    products.map((p) => ({
      title: p.title,
      status: p.status,
      price: p.variants?.[0]?.price ?? null,
    })),
    null,
    2
  );
}

export async function mcpGetProduct(ctx: ShopifyStoreContext, productId: string): Promise<string> {
  const query = `
    query ProductSeo($id: ID!) {
      product(id: $id) {
        id
        title
        seo { title description }
      }
    }
  `;
  const gid = productId.startsWith('gid://') ? productId : `gid://shopify/Product/${productId}`;
  const result = await shopifyGraphql<{ product: { id: string; title: string; seo: { title: string | null; description: string | null } } | null }>(
    ctx.shopDomain,
    ctx.accessToken,
    query,
    { id: gid }
  );
  if (!result.ok) throw new Error(result.error);
  if (!result.data.product) throw new Error('Product not found');
  return JSON.stringify(result.data.product, null, 2);
}

export async function mcpUpdateProductSeo(
  ctx: ShopifyStoreContext,
  input: { productId: string; seoTitle: string; seoDescription: string }
): Promise<string> {
  const mutation = `
    mutation UpdateProductSeo($input: ProductInput!) {
      productUpdate(input: $input) {
        product { id title seo { title description } }
        userErrors { field message }
      }
    }
  `;
  const gid = input.productId.startsWith('gid://')
    ? input.productId
    : `gid://shopify/Product/${input.productId}`;
  const result = await shopifyGraphql<{
    productUpdate: {
      product: { id: string; title: string; seo: { title: string | null; description: string | null } } | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(ctx.shopDomain, ctx.accessToken, mutation, {
    input: {
      id: gid,
      seo: { title: input.seoTitle, description: input.seoDescription },
    },
  });
  if (!result.ok) throw new Error(result.error);
  const errors = result.data.productUpdate.userErrors;
  if (errors.length) throw new Error(errors.map((e: { message: string }) => e.message).join('; '));
  return JSON.stringify(result.data.productUpdate.product, null, 2);
}

export async function mcpListBlogs(ctx: ShopifyStoreContext, limit = 10): Promise<string> {
  const query = `
    query ListBlogs($first: Int!) {
      blogs(first: $first) {
        edges {
          node {
            id
            title
            handle
          }
        }
      }
    }
  `;
  const result = await shopifyGraphql<{
    blogs: { edges: Array<{ node: { id: string; title: string; handle: string } }> };
  }>(ctx.shopDomain, ctx.accessToken, query, { first: Math.min(limit, 25) });
  if (!result.ok) throw new Error(result.error);
  const blogs = result.data.blogs.edges.map((e) => e.node);
  return JSON.stringify(blogs, null, 2);
}

export async function mcpCreateBlogArticle(
  ctx: ShopifyStoreContext,
  input: {
    blogId: string;
    title: string;
    bodyHtml: string;
    handle?: string;
    summaryHtml?: string;
    seoTitle?: string;
    seoDescription?: string;
    authorName?: string;
    tags?: string[];
    isPublished?: boolean;
  }
): Promise<string> {
  const mutation = `
    mutation ArticleCreate($article: ArticleCreateInput!) {
      articleCreate(article: $article) {
        article {
          id
          title
          handle
          isPublished
          summary
          blog { id title handle }
        }
        userErrors { field message }
      }
    }
  `;
  const gid = input.blogId.startsWith('gid://') ? input.blogId : `gid://shopify/Blog/${input.blogId}`;
  const article: Record<string, unknown> = {
    blogId: gid,
    title: input.title,
    body: input.bodyHtml,
    author: { name: input.authorName ?? 'Keylo Team' },
    isPublished: input.isPublished ?? false,
  };
  if (input.handle) article.handle = input.handle;
  if (input.summaryHtml) article.summary = input.summaryHtml;
  if (input.tags?.length) article.tags = input.tags;

  const metafields: Array<{ namespace: string; key: string; type: string; value: string }> = [];
  if (input.seoTitle) {
    metafields.push({
      namespace: 'global',
      key: 'title_tag',
      type: 'single_line_text_field',
      value: input.seoTitle,
    });
  }
  if (input.seoDescription) {
    metafields.push({
      namespace: 'global',
      key: 'description_tag',
      type: 'single_line_text_field',
      value: input.seoDescription,
    });
  }
  if (metafields.length) article.metafields = metafields;

  const result = await shopifyGraphql<{
    articleCreate: {
      article: {
        id: string;
        title: string;
        handle: string;
        isPublished: boolean;
        summary: string | null;
        blog: { id: string; title: string; handle: string };
      } | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(ctx.shopDomain, ctx.accessToken, mutation, { article });
  if (!result.ok) throw new Error(result.error);
  const errors = result.data.articleCreate.userErrors;
  if (errors.length) throw new Error(errors.map((e: { message: string }) => e.message).join('; '));
  return JSON.stringify(result.data.articleCreate.article, null, 2);
}

export async function mcpCreatePage(
  ctx: ShopifyStoreContext,
  input: {
    title: string;
    handle: string;
    bodyHtml: string;
    seoTitle: string;
    seoDescription: string;
    isPublished?: boolean;
  }
): Promise<string> {
  const mutation = `
    mutation PageCreate($page: PageCreateInput!) {
      pageCreate(page: $page) {
        page {
          id title handle body isPublished
        }
        userErrors { field message }
      }
    }
  `;
  const metafields = [
    {
      namespace: 'global',
      key: 'title_tag',
      type: 'single_line_text_field',
      value: input.seoTitle,
    },
    {
      namespace: 'global',
      key: 'description_tag',
      type: 'single_line_text_field',
      value: input.seoDescription,
    },
  ];
  const result = await shopifyGraphql<{
    pageCreate: {
      page: {
        id: string;
        title: string;
        handle: string;
        body: string;
        isPublished: boolean;
      } | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(ctx.shopDomain, ctx.accessToken, mutation, {
    page: {
      title: input.title,
      handle: input.handle,
      body: input.bodyHtml,
      isPublished: input.isPublished ?? false,
      metafields,
    },
  });
  if (!result.ok) throw new Error(result.error);
  const errors = result.data.pageCreate.userErrors;
  if (errors.length) throw new Error(errors.map((e: { message: string }) => e.message).join('; '));
  return JSON.stringify(result.data.pageCreate.page, null, 2);
}

export async function mcpShopifyGraphqlReadOnly(
  ctx: ShopifyStoreContext,
  query: string,
  variables?: Record<string, unknown>
): Promise<string> {
  const trimmed = query.trim();
  if (/^\s*mutation\b/i.test(trimmed)) {
    throw new Error(
      'shopify_graphql is read-only; use update_product_seo, create_page, or create_blog_article for writes'
    );
  }
  const result = await shopifyGraphql<unknown>(ctx.shopDomain, ctx.accessToken, query, variables);
  if (!result.ok) throw new Error(result.error);
  return JSON.stringify(result.data, null, 2);
}

/** Direct tool dispatch for snapshots (no Claude). */
export async function invokeShopifyMcpTool(
  ctx: ShopifyStoreContext,
  toolName: string,
  args: Record<string, unknown> = {}
): Promise<string> {
  switch (toolName) {
    case 'get_store_summary':
      return mcpGetStoreSummary(ctx);
    case 'list_products':
      return mcpListProducts(ctx, Number(args.limit ?? 25));
    case 'get_product':
      return mcpGetProduct(ctx, String(args.productId ?? ''));
    case 'update_product_seo':
      return mcpUpdateProductSeo(ctx, {
        productId: String(args.productId ?? ''),
        seoTitle: String(args.seoTitle ?? ''),
        seoDescription: String(args.seoDescription ?? ''),
      });
    case 'list_blogs':
      return mcpListBlogs(ctx, Number(args.limit ?? 10));
    case 'create_page':
      return mcpCreatePage(ctx, {
        title: String(args.title ?? ''),
        handle: String(args.handle ?? ''),
        bodyHtml: String(args.bodyHtml ?? ''),
        seoTitle: String(args.seoTitle ?? ''),
        seoDescription: String(args.seoDescription ?? ''),
        isPublished: args.isPublished === true,
      });
    case 'create_blog_article':
      return mcpCreateBlogArticle(ctx, {
        blogId: String(args.blogId ?? ''),
        title: String(args.title ?? ''),
        bodyHtml: String(args.bodyHtml ?? ''),
        handle: args.handle ? String(args.handle) : undefined,
        summaryHtml: args.summaryHtml ? String(args.summaryHtml) : undefined,
        seoTitle: args.seoTitle ? String(args.seoTitle) : undefined,
        seoDescription: args.seoDescription ? String(args.seoDescription) : undefined,
        authorName: args.authorName ? String(args.authorName) : undefined,
        tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
        isPublished: args.isPublished === true,
      });
    case 'shopify_graphql':
      return mcpShopifyGraphqlReadOnly(
        ctx,
        String(args.query ?? ''),
        (args.variables as Record<string, unknown>) ?? undefined
      );
    default:
      throw new Error(`Unknown Shopify MCP tool: ${toolName}`);
  }
}
