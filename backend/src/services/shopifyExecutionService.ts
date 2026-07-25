import { shopifyGraphql } from '../lib/shopifyAdmin.js';
import type { PlanAction } from '../types/plan.js';
import type { ProductSeoState, ShopifyBlogArticleState, ShopifyPageState } from '../types/execution.js';

type ProductNode = {
  id: string;
  title: string;
  seo: { title: string | null; description: string | null };
};

const FIRST_PRODUCT_QUERY = `
  query FirstActiveProduct {
    products(first: 1, query: "status:active") {
      edges {
        node {
          id
          title
          seo {
            title
            description
          }
        }
      }
    }
  }
`;

const ACTIVE_PRODUCTS_QUERY = `
  query ActiveProducts($first: Int!) {
    products(first: $first, query: "status:active") {
      edges {
        node {
          id
          title
          seo {
            title
            description
          }
        }
      }
    }
  }
`;

const PAGE_CREATE = `
  mutation PageCreate($page: PageCreateInput!) {
    pageCreate(page: $page) {
      page {
        id
        title
        handle
        body
        isPublished
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PAGE_DELETE = `
  mutation PageDelete($id: ID!) {
    pageDelete(id: $id) {
      deletedPageId
      userErrors {
        field
        message
      }
    }
  }
`;

type PageNode = {
  id: string;
  title: string;
  handle: string;
  body: string;
  isPublished: boolean;
};

function toPageState(
  node: PageNode,
  seo?: { title?: string; description?: string },
  shopDomain?: string
): ShopifyPageState {
  return {
    kind: 'shopify_page',
    pageId: node.id,
    title: node.title,
    handle: node.handle,
    bodyHtml: node.body,
    seoTitle: seo?.title ?? node.title,
    seoDescription: seo?.description ?? '',
    isPublished: node.isPublished,
    shopDomain: shopDomain?.replace(/^https?:\/\//, '').replace(/\/$/, '') || undefined,
  };
}

const UPDATE_PRODUCT_SEO = `
  mutation UpdateProductSeo($input: ProductInput!) {
    productUpdate(input: $input) {
      product {
        id
        title
        seo {
          title
          description
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

function toSeoState(node: ProductNode): ProductSeoState {
  return {
    kind: 'product_seo',
    productId: node.id,
    productTitle: node.title,
    seoTitle: node.seo.title ?? node.title,
    seoDescription: node.seo.description ?? '',
  };
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function buildProposedSeo(action: PlanAction, current: ProductSeoState): ProductSeoState {
  const seoTitle = truncate(action.title, 70);
  const seoDescription = truncate(
    `${action.outcome} — ${action.why}`.replace(/\s+/g, ' '),
    160
  );

  return {
    kind: 'product_seo',
    productId: current.productId,
    productTitle: current.productTitle,
    seoTitle: seoTitle || current.seoTitle,
    seoDescription: seoDescription || current.seoDescription,
    reasoning: `Using "${current.productTitle}" because this action targets product SEO and this product is outside the ${14}-day SEO settle window. Title and description are derived from the plan action outcome for "${action.outcome}".`,
  };
}

export type ShopifySeoProposal = {
  targetLabel: string;
  summary: string;
  before: ProductSeoState;
  proposed: ProductSeoState;
};

export class ShopifyExecutionService {
  async fetchFirstActiveProduct(
    shopDomain: string,
    accessToken: string
  ): Promise<ProductSeoState | null> {
    const result = await shopifyGraphql<{
      products: { edges: Array<{ node: ProductNode }> };
    }>(shopDomain, accessToken, FIRST_PRODUCT_QUERY);

    if (!result.ok) {
      throw new Error(result.error);
    }

    const node = result.data.products.edges[0]?.node;
    return node ? toSeoState(node) : null;
  }

  /**
   * Prefer a product that is NOT in the SEO cooldown set (recently optimized).
   * Falls back to null when every active product is cooling down.
   */
  async fetchActiveProductForSeo(
    shopDomain: string,
    accessToken: string,
    excludeProductIds: Set<string>
  ): Promise<ProductSeoState | null> {
    const result = await shopifyGraphql<{
      products: { edges: Array<{ node: ProductNode }> };
    }>(shopDomain, accessToken, ACTIVE_PRODUCTS_QUERY, { first: 50 });

    if (!result.ok) {
      throw new Error(result.error);
    }

    const nodes = result.data.products.edges.map((e) => e.node);
    const eligible = nodes.find((n) => !excludeProductIds.has(n.id));
    if (eligible) return toSeoState(eligible);
    return null;
  }

  buildProductSeoProposal(action: PlanAction, current: ProductSeoState): ShopifySeoProposal {
    const proposed = buildProposedSeo(action, current);
    const changed =
      proposed.seoTitle !== current.seoTitle ||
      proposed.seoDescription !== current.seoDescription;

    return {
      summary: changed
        ? `Update SEO meta for "${current.productTitle}" based on this plan action.`
        : `SEO fields for "${current.productTitle}" already match the proposal — no change needed.`,
      targetLabel: current.productTitle,
      before: current,
      proposed,
    };
  }

  async applyProductSeo(
    shopDomain: string,
    accessToken: string,
    state: ProductSeoState
  ): Promise<ProductSeoState> {
    const result = await shopifyGraphql<{
      productUpdate: {
        product: ProductNode | null;
        userErrors: Array<{ field: string[]; message: string }>;
      };
    }>(shopDomain, accessToken, UPDATE_PRODUCT_SEO, {
      input: {
        id: state.productId,
        seo: {
          title: state.seoTitle,
          description: state.seoDescription,
        },
      },
    });

    if (!result.ok) {
      throw new Error(result.error);
    }

    const errors = result.data.productUpdate.userErrors;
    if (errors.length > 0) {
      throw new Error(errors.map((e) => e.message).join('; '));
    }

    const product = result.data.productUpdate.product;
    if (!product) {
      throw new Error('Shopify did not return the updated product');
    }

    return toSeoState(product);
  }

  async createPage(
    shopDomain: string,
    accessToken: string,
    state: ShopifyPageState
  ): Promise<ShopifyPageState> {
    const result = await shopifyGraphql<{
      pageCreate: {
        page: PageNode | null;
        userErrors: Array<{ field: string[]; message: string }>;
      };
    }>(shopDomain, accessToken, PAGE_CREATE, {
      page: {
        title: state.title,
        handle: state.handle,
        body: state.bodyHtml,
        isPublished: state.isPublished,
        metafields: [
          {
            namespace: 'global',
            key: 'title_tag',
            type: 'single_line_text_field',
            value: state.seoTitle,
          },
          {
            namespace: 'global',
            key: 'description_tag',
            type: 'single_line_text_field',
            value: state.seoDescription,
          },
        ],
      },
    });

    if (!result.ok) {
      throw new Error(result.error);
    }

    const errors = result.data.pageCreate.userErrors;
    if (errors.length > 0) {
      throw new Error(errors.map((e) => e.message).join('; '));
    }

    const page = result.data.pageCreate.page;
    if (!page) {
      throw new Error('Shopify did not return the created page');
    }

    return toPageState(
      page,
      {
        title: state.seoTitle,
        description: state.seoDescription,
      },
      shopDomain
    );
  }

  async deletePage(shopDomain: string, accessToken: string, pageId: string): Promise<void> {
    const result = await shopifyGraphql<{
      pageDelete: {
        deletedPageId: string | null;
        userErrors: Array<{ field: string[]; message: string }>;
      };
    }>(shopDomain, accessToken, PAGE_DELETE, { id: pageId });

    if (!result.ok) {
      throw new Error(result.error);
    }

    const errors = result.data.pageDelete.userErrors;
    if (errors.length > 0) {
      throw new Error(errors.map((e) => e.message).join('; '));
    }
  }

  async listBlogs(
    shopDomain: string,
    accessToken: string,
    limit = 10
  ): Promise<Array<{ id: string; title: string; handle: string }>> {
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
    }>(shopDomain, accessToken, query, { first: Math.min(limit, 25) });

    if (!result.ok) {
      throw new Error(result.error);
    }

    return result.data.blogs.edges.map((e) => e.node);
  }

  pickDefaultBlog(
    blogs: Array<{ id: string; title: string; handle: string }>,
    preferredName?: string | null
  ): { id: string; title: string; handle: string } {
    if (!blogs.length) {
      throw new Error('No blogs found in Shopify — create a blog in Online Store → Blog posts first.');
    }
    if (preferredName?.trim()) {
      const needle = preferredName.trim().toLowerCase();
      const match = blogs.find(
        (b) => b.title.toLowerCase().includes(needle) || b.handle.toLowerCase().includes(needle)
      );
      if (match) return match;
    }
    const news = blogs.find((b) => /news|journal|blog/i.test(b.title) || b.handle === 'news');
    return news ?? blogs[0]!;
  }

  async createBlogArticle(
    shopDomain: string,
    accessToken: string,
    state: ShopifyBlogArticleState
  ): Promise<ShopifyBlogArticleState> {
    if (!state.blogId) {
      throw new Error('blogId is required to create a blog article');
    }

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

    const gid = state.blogId.startsWith('gid://')
      ? state.blogId
      : `gid://shopify/Blog/${state.blogId}`;

    const article: Record<string, unknown> = {
      blogId: gid,
      title: state.title,
      body: state.bodyHtml,
      author: { name: 'Keylo Team' },
      isPublished: state.isPublished,
      handle: state.handle,
    };

    if (state.summaryHtml) article.summary = state.summaryHtml;
    if (state.tags?.length) article.tags = state.tags;

    const metafields: Array<{ namespace: string; key: string; type: string; value: string }> = [];
    if (state.seoTitle) {
      metafields.push({
        namespace: 'global',
        key: 'title_tag',
        type: 'single_line_text_field',
        value: state.seoTitle,
      });
    }
    if (state.seoDescription) {
      metafields.push({
        namespace: 'global',
        key: 'description_tag',
        type: 'single_line_text_field',
        value: state.seoDescription,
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
    }>(shopDomain, accessToken, mutation, { article });

    if (!result.ok) {
      throw new Error(result.error);
    }

    const errors = result.data.articleCreate.userErrors;
    if (errors.length > 0) {
      throw new Error(errors.map((e) => e.message).join('; '));
    }

    const created = result.data.articleCreate.article;
    if (!created) {
      throw new Error('Shopify did not return the created article');
    }

    return {
      kind: 'shopify_blog_article',
      articleId: created.id,
      blogId: created.blog.id,
      blogHandle: created.blog.handle,
      title: created.title,
      handle: created.handle,
      bodyHtml: state.bodyHtml,
      seoTitle: state.seoTitle,
      seoDescription: state.seoDescription,
      summaryHtml: created.summary ?? state.summaryHtml,
      tags: state.tags,
      isPublished: created.isPublished,
      shopDomain,
      reasoning: state.reasoning,
    };
  }

  async deleteArticle(shopDomain: string, accessToken: string, articleId: string): Promise<void> {
    const mutation = `
      mutation ArticleDelete($id: ID!) {
        articleDelete(id: $id) {
          deletedArticleId
          userErrors { field message }
        }
      }
    `;

    const result = await shopifyGraphql<{
      articleDelete: {
        deletedArticleId: string | null;
        userErrors: Array<{ field: string[]; message: string }>;
      };
    }>(shopDomain, accessToken, mutation, { id: articleId });

    if (!result.ok) {
      throw new Error(result.error);
    }

    const errors = result.data.articleDelete.userErrors;
    if (errors.length > 0) {
      throw new Error(errors.map((e) => e.message).join('; '));
    }
  }
}
