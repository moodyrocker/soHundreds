import { z } from 'zod';
import type { ShopifyPageState } from '../types/execution.js';
import { sanitizeModelStrings } from './stripModelMarkup.js';
import { extractJsonFromModelText } from './parsePlanJson.js';

const sectionSchema = z.object({
  heading: z.string().min(1).optional(),
  paragraphs: z.array(z.string().min(1)).min(1),
});

const pageSchema = z
  .object({
    title: z.string().min(1),
    handle: z.string().min(1),
    bodyHtml: z.string().min(1).optional(),
    sections: z.array(sectionSchema).min(1).optional(),
    seoTitle: z.string().min(1),
    seoDescription: z.string().min(1),
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

export function parseShopifyPageJson(text: string): ShopifyPageState {
  const raw = extractJsonFromModelText(text);
  const parsed = pageSchema.parse(raw);
  const clean = sanitizeModelStrings(parsed) as z.infer<typeof pageSchema>;
  const bodyHtml = clean.bodyHtml?.trim() || sectionsToBodyHtml(clean.sections ?? []);

  return {
    kind: 'shopify_page',
    pageId: null,
    title: clean.title,
    handle: clean.handle.replace(/^\/+|\/+$/g, '').toLowerCase(),
    bodyHtml,
    seoTitle: clean.seoTitle,
    seoDescription: clean.seoDescription,
    isPublished: false,
    reasoning: clean.reasoning,
  };
}
