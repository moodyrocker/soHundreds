import type {
  MarketIntelConnector,
  MarketIntelPromptSection,
  MarketIntelSeed,
} from '../../types/marketIntel.js';

/**
 * Phase 2 V1: Claude web_search for competitor/trend context.
 * Future: SpyFu, Google Trends, Meta Ad Library connectors implement the same interface.
 */
export class WebSearchMarketIntelConnector implements MarketIntelConnector {
  readonly id = 'web_search';

  buildPromptSection(seed: MarketIntelSeed): MarketIntelPromptSection | null {
    if (!seed.enabled) return null;

    const lines: string[] = [
      'MARKET INTEL (Phase 2 — directional research, NOT your first-party data):',
    ];

    if (seed.website) lines.push(`- Business website: ${seed.website}`);
    if (seed.oneLiner) lines.push(`- One-liner: ${seed.oneLiner}`);
    if (seed.audience) lines.push(`- Audience: ${seed.audience}`);
    if (seed.offer) lines.push(`- Offer: ${seed.offer}`);
    if (seed.emulate) lines.push(`- Businesses to emulate: ${seed.emulate}`);

    const instructions = `${lines.join('\n')}

Use web_search (max 3 queries) to gather DIRECTIONAL market context:
1. Comparable businesses in the same niche (not Fortune 500 unless relevant).
2. Obvious positioning / channel patterns (social, local, paid, SEO).
3. 1–2 trends or customer expectations for this category.

RULES:
- Label all findings as estimates or public signals — never present competitor revenue/spend as fact.
- marketIntel.confidence must be "low" or "medium" only (never "high").
- If web_search finds little, say so honestly in marketIntel.headline and keep arrays short.
- Do NOT lower summary.confidence below what first-party data supports — market intel is additive.
- Include marketIntel.disclaimer: "Directional research from public web sources — verify before acting."
`;

    return { seed, instructions };
  }
}
