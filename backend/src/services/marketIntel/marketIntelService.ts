import type { BusinessProfile } from '../businessProfileService.js';
import type {
  MarketIntelConnector,
  MarketIntelPromptSection,
  MarketIntelSeed,
} from '../../types/marketIntel.js';
import { buildMarketIntelSeed } from '../../types/marketIntel.js';
import { WebSearchMarketIntelConnector } from './webSearchMarketIntel.js';

export class MarketIntelService {
  private connectors: MarketIntelConnector[] = [new WebSearchMarketIntelConnector()];

  seedFromProfile(profile: BusinessProfile): MarketIntelSeed {
    return buildMarketIntelSeed(profile);
  }

  buildPromptSection(profile: BusinessProfile): MarketIntelPromptSection | null {
    const seed = this.seedFromProfile(profile);
    for (const connector of this.connectors) {
      const section = connector.buildPromptSection(seed);
      if (section) return section;
    }
    return null;
  }
}
