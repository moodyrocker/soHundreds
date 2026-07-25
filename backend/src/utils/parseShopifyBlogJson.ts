import { z } from 'zod';
import type { ShopifyBlogArticleState } from '../types/execution.js';
import { isShopifyAutoPublishLiveEnabled } from '../lib/contentPublishFeatureFlags.js';
import { sanitizeModelStrings } from './stripModelMarkup.js';
import { extractJsonFromModelText } from './parsePlanJson.js';

const sectionSchema = z.object({
  heading: z.string().min(1).optional(),
  paragraphs: z.array(z.string().min(1)).min(1),
});

const blogSchema = z
  .object({
    title: z.string().min(1),
    handle: z.string().min(1),
    bodyHtml: z.string().min(1).optional(),
    sections: z.array(sectionSchema).min(1).optional(),
    seoTitle: z.string().min(1),
    seoDescription: z.string().min(1),
    summaryHtml: z.string().optional(),
    tags: z.array(z.string()).optional(),
    reasoning: z.string().min(1).optional(),
  })
  .refine((data) => Boolean(data.bodyHtml?.trim()) || Boolean(data.sections?.length), {
    message: 'Provide bodyHtml or sections',
  });

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sectionsToBodyHtml(sections: z.infer<typeof sectionSchema>[]): string {
  return sections
    .map((section) => {
      const heading = section.heading ? `<h2>${escapeHtml(section.heading)}</h2>` : '';
      const paragraphs = section.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('');
      return `${heading}${paragraphs}`;
    })
    .join('\n');
}

export function parseShopifyBlogJson(text: string): ShopifyBlogArticleState {
  const raw = extractJsonFromModelText(text);
  const parsed = blogSchema.parse(raw);
  const clean = sanitizeModelStrings(parsed) as z.infer<typeof blogSchema>;
  const bodyHtml = clean.bodyHtml?.trim() || sectionsToBodyHtml(clean.sections ?? []);

  return {
    kind: 'shopify_blog_article',
    articleId: null,
    blogId: null,
    blogHandle: null,
    title: clean.title,
    handle: clean.handle.replace(/^\/+|\/+$/g, '').toLowerCase(),
    bodyHtml,
    seoTitle: clean.seoTitle,
    seoDescription: clean.seoDescription,
    summaryHtml: clean.summaryHtml,
    tags: clean.tags,
    isPublished: isShopifyAutoPublishLiveEnabled(),
    reasoning: clean.reasoning,
  };
}
