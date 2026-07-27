import { shopifyHasWriteContentScope, shopifyHasWriteProductsScope } from '../../lib/shopifyAdmin.js';
import { shopStorefrontUrl } from '../../lib/shopStorefrontUrl.js';
import { evaluateChannelCaps, getSeoCooldownTargets } from '../../lib/seoCooldown.js';
import { getAutopilotPace } from '../autopilotService.js';
import type { ProductSeoState, ShopifyBlogArticleState } from '../../types/execution.js';
import { asProductSeo, asShopifyBlogArticle, asShopifyPage } from './payloads.js';
import { PreflightRefusal } from './types.js';
import type { ApplyContext, ApplyResult, PlatformExecutor } from './types.js';

/**
 * The three Shopify write paths.
 *
 * Grouped in one module because they share the same pre-flight shape — connected
 * check, then a scope check — and because splitting them across three files would
 * duplicate that without making anything clearer.
 *
 * Ordering inside `apply` is load-bearing: every guard runs before the external
 * call. ExecutionService distinguishes "refused before touching Shopify" (return
 * to `previewed`, still retryable) from "Shopify was contacted and failed" (mark
 * `failed`, because the upstream outcome is now unknown). Moving a guard after the
 * write would spend first and refuse second.
 */

async function requireShopify(ctx: ApplyContext) {
  const shop = await ctx.deps.mcp.getShopifyContext(ctx.organizationId);
  if (!shop) {
    // Wording matched by SAFE_MESSAGE_PATTERNS in lib/errorHandler.ts.
    throw new PreflightRefusal('Shopify is not connected');
  }
  return shop;
}

async function requireScope(ctx: ApplyContext, scope: 'write_products' | 'write_content') {
  const config = await ctx.deps.mcp.getPlatformConfig(ctx.organizationId, 'shopify');
  const granted =
    scope === 'write_products'
      ? shopifyHasWriteProductsScope(config?.grantedScopes)
      : shopifyHasWriteContentScope(config?.grantedScopes);

  if (!granted) {
    throw new PreflightRefusal(
      `Missing ${scope} scope. Disconnect and reconnect Shopify, then approve all requested permissions.`
    );
  }
}

/**
 * Updates the SEO title and description on a product.
 *
 * The only executor that preserves `before_state`: the pre-change values are what
 * `rollbackProductSeo` restores, so nulling them would make the change
 * unrecoverable — silently, and only discovered when someone tried to undo it.
 */
export const productSeoExecutor: PlatformExecutor = {
  executionType: 'update_product_seo',
  label: 'Shopify product SEO',

  async apply(ctx: ApplyContext): Promise<ApplyResult> {
    const { organizationId, row, edits, deps } = ctx;
    const shop = await requireShopify(ctx);
    await requireScope(ctx, 'write_products');

    const proposed = asProductSeo(row.proposed_state);

    // Volume and cooldown guards. SEO changes need time to settle before the
    // effect is measurable, so re-editing the same product churns rankings
    // without producing signal.
    const pace = await getAutopilotPace(organizationId);
    const caps = await evaluateChannelCaps(organizationId, pace, 'update_product_seo');
    if (!caps.allow) {
      throw new PreflightRefusal(caps.reason ?? 'Product SEO daily cap reached');
    }
    const cooldown = await getSeoCooldownTargets(organizationId, pace);
    if (cooldown.productIds.has(proposed.productId)) {
      throw new PreflightRefusal(
        `This product was SEO-updated within the last ${cooldown.cooldownDays} days. Waiting for rankings to settle.`
      );
    }

    // Caller edits win, but only when they carry content — a whitespace-only edit
    // must not blank a field.
    const toApply: ProductSeoState = {
      ...proposed,
      seoTitle: edits?.seoTitle?.trim() || proposed.seoTitle,
      seoDescription: edits?.seoDescription?.trim() || proposed.seoDescription,
    };

    const after = await deps.shopify.applyProductSeo(shop.shopDomain, shop.accessToken, toApply);

    return {
      after,
      // What was actually applied, not the original proposal.
      proposed: toApply,
      preserveBeforeState: true,
    };
  },
};

/** Creates a Shopify page, published or draft per the auto-publish flag. */
export const shopifyPageExecutor: PlatformExecutor = {
  executionType: 'create_shopify_page',
  label: 'Shopify page',

  async apply(ctx: ApplyContext): Promise<ApplyResult> {
    const shop = await requireShopify(ctx);
    await requireScope(ctx, 'write_content');

    const proposed = asShopifyPage(ctx.row.proposed_state);
    const after = await ctx.deps.shopify.createPage(shop.shopDomain, shop.accessToken, proposed);

    const pageUrl = shopStorefrontUrl(after.shopDomain ?? shop.shopDomain, `/pages/${after.handle}`);

    return {
      after,
      // The summary carries the live URL, which is what the user needs to check
      // the result — the generated one is not guessable from the action title.
      summary: after.isPublished
        ? `Published Shopify page "${after.title}" — ${pageUrl}`
        : `Created Shopify page draft "${after.title}" — ${pageUrl}`,
    };
  },
};

/** Creates a blog article, resolving the target blog first. */
export const shopifyBlogExecutor: PlatformExecutor = {
  executionType: 'create_shopify_blog_article',
  label: 'Shopify blog article',

  async apply(ctx: ApplyContext): Promise<ApplyResult> {
    const shop = await requireShopify(ctx);
    await requireScope(ctx, 'write_content');

    const proposed = asShopifyBlogArticle(ctx.row.proposed_state);

    // The store's blog is resolved at write time rather than at preview time: a
    // blog can be created or renamed in between, and a stale id would fail the
    // create with an opaque Shopify error.
    const blogs = await ctx.deps.shopify.listBlogs(shop.shopDomain, shop.accessToken);
    const blog = ctx.deps.shopify.pickDefaultBlog(blogs);

    const toApply: ShopifyBlogArticleState = {
      ...proposed,
      blogId: blog.id,
      blogHandle: blog.handle,
      shopDomain: shop.shopDomain,
    };

    const after = await ctx.deps.shopify.createBlogArticle(
      shop.shopDomain,
      shop.accessToken,
      toApply
    );

    const articleUrl = shopStorefrontUrl(
      after.shopDomain ?? shop.shopDomain,
      `/blogs/${after.blogHandle}/${after.handle}`
    );

    return {
      after,
      summary: after.isPublished
        ? `Published blog article "${after.title}" — ${articleUrl}`
        : `Created blog draft "${after.title}" — ${articleUrl}`,
    };
  },
};
