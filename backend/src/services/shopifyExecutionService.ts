import { shopifyGraphql } from '../lib/shopifyAdmin.js';
import type { PlanAction } from '../types/plan.js';
import type { ProductSeoState, ShopifyPageState } from '../types/execution.js';

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
  seo?: { title?: string; description?: string }
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
    reasoning: `Using "${current.productTitle}" (first active product in your store) because this action targets product SEO. Title and description are derived from the plan action outcome and rationale to improve discoverability for "${action.outcome}".`,
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

    return toPageState(page, {
      title: state.seoTitle,
      description: state.seoDescription,
    });
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
}
