import type { PlanAction } from '../types/plan.js';
import type { ShopifyPageState } from '../types/execution.js';

/** Task prompt for Claude.ai with Shopify MCP — use before page content exists. */
export function buildShopifyMcpPageTaskPrompt(input: {
  shopDomain: string;
  action: PlanAction;
  goal: string;
  businessContext?: string | null;
}): string {
  const a = input.action;
  return `Use the Shopify MCP integration connected to ${input.shopDomain}.

Create a new Online Store page (draft, not published) for this marketing goal.

Business goal: ${input.goal}
${input.businessContext ? `Business context: ${input.businessContext}\n` : ''}
Page task: ${a.title}
Why: ${a.why}
Desired outcome: ${a.outcome}
KPI: ${a.kpi}

Requirements:
1. Write 400–900 words of useful content with semantic HTML only (h2, h3, p, ul, li, strong, em).
2. Choose a URL-safe handle (lowercase, hyphens).
3. Set SEO title (≤70 chars) and meta description (≤160 chars).
4. Create the page in Shopify via MCP and confirm the admin URL when done.`;
}

/** Paste prompt after Hundres has drafted page content — exact fields for MCP to apply. */
export function buildShopifyMcpPageApplyPrompt(input: {
  shopDomain: string;
  page: ShopifyPageState;
  actionTitle: string;
}): string {
  const { page, shopDomain, actionTitle } = input;
  return `Use the Shopify MCP integration connected to ${shopDomain}.

Create this Online Store page as a draft (do not publish yet).

Task from marketing plan: ${actionTitle}

Page fields:
- Title: ${page.title}
- Handle (URL slug): ${page.handle}
- SEO title: ${page.seoTitle}
- SEO meta description: ${page.seoDescription}

Body HTML:
${page.bodyHtml}

Steps:
1. Create the page in Shopify with the fields above.
2. Confirm the page admin URL and storefront path (/pages/${page.handle}).`;
}

/** Claude.ai + Shopify MCP — publish blog posts from a content calendar (read-only Hundres). */
export function buildShopifyMcpBlogContentPrompt(input: {
  shopDomain: string;
  storeUrl?: string | null;
  action: PlanAction;
  goal: string;
  businessContext?: string | null;
  calendarDraft?: string | null;
}): string {
  const a = input.action;
  const storeFront = input.storeUrl ?? input.shopDomain.replace('.myshopify.com', '.com');

  return `Use the Shopify MCP integration connected to ${input.shopDomain} (${storeFront}).

Create Shopify **blog articles** (Online Store → Blog posts) as **drafts** — do not publish until I confirm.

Business goal: ${input.goal}
${input.businessContext ? `Business context: ${input.businessContext}\n` : ''}
Marketing action: ${a.title}
Why: ${a.why}
Outcome: ${a.outcome}

${input.calendarDraft ? `--- CONTENT CALENDAR (from Hundres) ---\n${input.calendarDraft}\n--- END CALENDAR ---\n` : ''}
Requirements for EACH blog article:
1. **1,200–1,500 words** with semantic HTML (h2, h3, p, ul, li, strong, em).
2. Target the **assigned keyword** in title, first paragraph, and naturally throughout.
3. Include **2–3 internal links** to relevant Keylo product pages (use MCP to list products and link correctly).
4. Add an **FAQ section** (3–5 questions) addressing common men's skincare concerns for that topic.
5. Set SEO title (≤70 chars) and meta description (≤160 chars).
6. URL handle: lowercase, hyphens, includes primary keyword where sensible.
7. Create as **draft** in Shopify; confirm admin URL and /blogs/… path for each post.

Workflow:
- Start with **Week 1** only. When I say "next", create the next week's post.
- If the calendar lists 8 weeks, work through them one at a time unless I ask for a batch.

Begin with Week 1 now. Show me the draft article title, handle, and admin link when done.`;
}

/** Single blog post MCP prompt when Hundres has drafted one article in detail. */
export function buildShopifyMcpBlogArticleApplyPrompt(input: {
  shopDomain: string;
  actionTitle: string;
  title: string;
  handle: string;
  targetKeyword: string;
  bodyHtml: string;
  seoTitle: string;
  seoDescription: string;
}): string {
  return `Use the Shopify MCP integration connected to ${input.shopDomain}.

Create this blog article as a **draft** (do not publish).

Plan action: ${input.actionTitle}

Article fields:
- Title: ${input.title}
- Handle: ${input.handle}
- Target keyword: ${input.targetKeyword}
- SEO title: ${input.seoTitle}
- SEO meta description: ${input.seoDescription}

Body HTML:
${input.bodyHtml}

Confirm the blog admin URL and storefront path when done.`;
}
