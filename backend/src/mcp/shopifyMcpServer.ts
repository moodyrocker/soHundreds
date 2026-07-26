import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ShopifyStoreContext } from './shopifyMcpTools.js';
import {
  mcpCreateBlogArticle,
  mcpCreatePage,
  mcpGetProduct,
  mcpGetStoreSummary,
  mcpListBlogs,
  mcpListProducts,
  mcpShopifyGraphqlReadOnly,
  mcpUpdateProductSeo,
} from './shopifyMcpTools.js';

export function createShopifyMcpServer(ctx: ShopifyStoreContext): McpServer {
  const server = new McpServer(
    { name: 'hundres-shopify-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    'get_store_summary',
    {
      description: 'Last 30 days orders, revenue, and top products for the connected Shopify store.',
      inputSchema: {},
    },
    async () => ({
      content: [{ type: 'text', text: await mcpGetStoreSummary(ctx) }],
    })
  );

  server.registerTool(
    'list_products',
    {
      description: 'List products in the store catalog with title, status, and price.',
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional().describe('Max products (default 25)'),
      },
    },
    async ({ limit }) => ({
      content: [{ type: 'text', text: await mcpListProducts(ctx, limit ?? 25) }],
    })
  );

  server.registerTool(
    'get_product',
    {
      description: 'Get a product by ID including SEO title and description.',
      inputSchema: {
        productId: z.string().describe('Product ID or gid://shopify/Product/...'),
      },
    },
    async ({ productId }) => ({
      content: [{ type: 'text', text: await mcpGetProduct(ctx, productId) }],
    })
  );

  server.registerTool(
    'update_product_seo',
    {
      description: 'Update SEO title and meta description for a product.',
      inputSchema: {
        productId: z.string(),
        seoTitle: z.string(),
        seoDescription: z.string(),
      },
    },
    async (input) => ({
      content: [{ type: 'text', text: await mcpUpdateProductSeo(ctx, input) }],
    })
  );

  server.registerTool(
    'list_blogs',
    {
      description: 'List blog containers (News, Journal, etc.) with IDs for create_blog_article.',
      inputSchema: {
        limit: z.number().int().min(1).max(25).optional().describe('Max blogs (default 10)'),
      },
    },
    async ({ limit }) => ({
      content: [{ type: 'text', text: await mcpListBlogs(ctx, limit ?? 10) }],
    })
  );

  server.registerTool(
    'create_blog_article',
    {
      description: 'Create a blog post in a Shopify blog (draft by default). Requires blogId from list_blogs.',
      inputSchema: {
        blogId: z.string().describe('Blog ID or gid://shopify/Blog/...'),
        title: z.string(),
        bodyHtml: z.string().describe('Article body HTML'),
        handle: z.string().optional(),
        summaryHtml: z.string().optional(),
        seoTitle: z.string().optional(),
        seoDescription: z.string().optional(),
        authorName: z.string().optional(),
        tags: z.array(z.string()).optional(),
        isPublished: z.boolean().optional(),
      },
    },
    async (input) => ({
      content: [{ type: 'text', text: await mcpCreateBlogArticle(ctx, input) }],
    })
  );

  server.registerTool(
    'create_page',
    {
      description: 'Create an Online Store page (draft by default).',
      inputSchema: {
        title: z.string(),
        handle: z.string(),
        bodyHtml: z.string(),
        seoTitle: z.string(),
        seoDescription: z.string(),
        isPublished: z.boolean().optional(),
      },
    },
    async (input) => ({
      content: [{ type: 'text', text: await mcpCreatePage(ctx, input) }],
    })
  );

  server.registerTool(
    'shopify_graphql',
    {
      description: 'Run a read-only Admin GraphQL query against the store.',
      inputSchema: {
        query: z.string(),
        variables: z.record(z.unknown()).optional(),
      },
    },
    async ({ query, variables }) => ({
      content: [{ type: 'text', text: await mcpShopifyGraphqlReadOnly(ctx, query, variables) }],
    })
  );

  return server;
}
