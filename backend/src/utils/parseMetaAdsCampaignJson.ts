import { z } from 'zod';
import type { MetaAdsCampaignState } from '../types/execution.js';
import { sanitizeModelStrings } from './stripModelMarkup.js';
import { extractJsonFromModelText } from './parsePlanJson.js';

const targetingSchema = z.object({
  countries: z.array(z.string().min(2)).min(1).max(5),
  ageMin: z.preprocess((v) => Number(v), z.number().int().min(18).max(65)),
  ageMax: z.preprocess((v) => Number(v), z.number().int().min(18).max(65)),
  interestNotes: z.string().optional(),
});

const adSchema = z.object({
  name: z.string().min(1),
  primaryText: z.string().min(1),
  headline: z.string().min(1),
  description: z.string().optional(),
  cta: z.enum(['SHOP_NOW', 'LEARN_MORE', 'SIGN_UP', 'ORDER_NOW']).default('SHOP_NOW'),
  finalUrl: z.string().min(1),
});

const campaignSchema = z.object({
  campaignName: z.string().min(1),
  dailyBudget: z.preprocess(
    (v) => (typeof v === 'string' ? Number(v.replace(/[^0-9.]/g, '')) : v),
    z.number().positive().max(10_000)
  ),
  currencyCode: z.enum(['GBP', 'USD', 'EUR']).default('GBP'),
  objective: z.enum(['OUTCOME_TRAFFIC', 'OUTCOME_SALES']).default('OUTCOME_TRAFFIC'),
  durationDays: z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? undefined : Number(v)),
    z.number().int().positive().max(90).optional()
  ),
  targeting: targetingSchema,
  ads: z.array(adSchema).min(1).max(3),
  reasoning: z.string().min(1).optional(),
});

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/, '')}`;
}

export function parseMetaAdsCampaignJson(text: string): MetaAdsCampaignState {
  const raw = extractJsonFromModelText(text);
  const parsed = campaignSchema.parse(raw);
  const clean = sanitizeModelStrings(parsed) as z.infer<typeof campaignSchema>;

  return {
    kind: 'meta_ads_campaign',
    campaignName: clean.campaignName.trim(),
    dailyBudget: clean.dailyBudget,
    currencyCode: clean.currencyCode,
    objective: clean.objective,
    durationDays: clean.durationDays,
    targeting: {
      countries: clean.targeting.countries.map((c) => c.toUpperCase()),
      ageMin: Math.min(clean.targeting.ageMin, clean.targeting.ageMax),
      ageMax: Math.max(clean.targeting.ageMin, clean.targeting.ageMax),
      interestNotes: clean.targeting.interestNotes,
    },
    ads: clean.ads.map((ad) => ({
      name: ad.name.trim(),
      primaryText: ad.primaryText.trim(),
      headline: ad.headline.trim().slice(0, 40),
      description: ad.description?.trim(),
      cta: ad.cta,
      finalUrl: normalizeUrl(ad.finalUrl),
    })),
    reasoning: clean.reasoning,
    campaignId: null,
    adSetId: null,
    adAccountId: null,
    status: 'draft_proposal',
  };
}
