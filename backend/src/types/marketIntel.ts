import type { BusinessProfile } from '../services/businessProfileService.js';

/** Directional market context — never presented as ground truth. */
export type MarketIntelConfidence = 'low' | 'medium';

export type MarketIntelBlock = {
  confidence: MarketIntelConfidence;
  headline: string;
  competitors: string[];
  trends: string[];
  emulateNotes: string[];
  disclaimer: string;
};

/** Inputs seeded from Business profile for web research. */
export type MarketIntelSeed = {
  enabled: boolean;
  website: string | null;
  oneLiner: string | null;
  audience: string | null;
  offer: string | null;
  emulate: string | null;
};

export type MarketIntelPromptSection = {
  seed: MarketIntelSeed;
  instructions: string;
};

/** Pluggable source (SpyFu, Trends, etc.). V1 uses Claude web_search only. */
export interface MarketIntelConnector {
  readonly id: string;
  buildPromptSection(seed: MarketIntelSeed): MarketIntelPromptSection | null;
}

export function buildMarketIntelSeed(profile: BusinessProfile): MarketIntelSeed {
  const website = profile.website?.trim() || null;
  const oneLiner = profile.oneLiner?.trim() || null;
  const audience = profile.audience?.trim() || null;
  const offer = profile.offer?.trim() || null;
  const emulate = profile.emulate?.trim() || null;
  const enabled = Boolean(website || offer || emulate);

  return { enabled, website, oneLiner, audience, offer, emulate };
}
