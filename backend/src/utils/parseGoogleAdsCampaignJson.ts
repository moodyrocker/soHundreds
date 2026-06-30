import { z } from 'zod';
import type { GoogleAdsCampaignState } from '../types/execution.js';
import { sanitizeModelStrings } from './stripModelMarkup.js';
import { extractJsonFromModelText } from './parsePlanJson.js';

const matchTypeSchema = z.enum(['BROAD', 'PHRASE', 'EXACT']);

const keywordSchema = z.object({
  text: z.string().min(1),
  matchType: matchTypeSchema.default('PHRASE'),
});

const adGroupSchema = z.object({
  name: z.string().min(1),
  keywords: z.array(keywordSchema).min(1).max(20),
  headlines: z.array(z.string().min(1)).min(3).max(15),
  descriptions: z.array(z.string().min(1)).min(2).max(4),
  finalUrl: z.string().min(1),
});

const campaignSchema = z.object({
  campaignName: z.string().min(1),
  dailyBudgetUsd: z.preprocess(
    (v) => (typeof v === 'string' ? Number(v.replace(/[^0-9.]/g, '')) : v),
    z.number().positive().max(10_000)
  ),
  adGroups: z.array(adGroupSchema).min(1).max(3),
  reasoning: z.string().min(1).optional(),
});

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/, '')}`;
}

function trimAdText(text: string, max: number): string {
  const clean = text.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

export function parseGoogleAdsCampaignJson(text: string): GoogleAdsCampaignState {
  const raw = extractJsonFromModelText(text);
  const parsed = campaignSchema.parse(raw);
  const clean = sanitizeModelStrings(parsed) as z.infer<typeof campaignSchema>;

  return {
    kind: 'google_ads_campaign',
    campaignName: clean.campaignName.trim(),
    dailyBudgetUsd: clean.dailyBudgetUsd,
    advertisingChannelType: 'SEARCH',
    adGroups: clean.adGroups.map((group) => ({
      name: group.name.trim(),
      keywords: group.keywords.map((kw) => ({
        text: kw.text.trim(),
        matchType: kw.matchType,
      })),
      headlines: group.headlines.map((h) => trimAdText(h, 30)),
      descriptions: group.descriptions.map((d) => trimAdText(d, 90)),
      finalUrl: normalizeUrl(group.finalUrl),
    })),
    reasoning: clean.reasoning,
    campaignId: null,
    campaignResourceName: null,
    customerId: null,
    status: 'draft_proposal',
  };
}
