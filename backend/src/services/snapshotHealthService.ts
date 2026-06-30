import type { SnapshotProbeResult } from '../types/snapshot.js';
import { GoogleAdsSnapshotService } from './googleAdsSnapshotService.js';
import { GoogleAnalyticsSnapshotService } from './googleAnalyticsSnapshotService.js';
import { MetaAdsSnapshotService } from './metaAdsSnapshotService.js';
import { ShopifySnapshotService } from './shopifySnapshotService.js';

/**
 * Probes each connected integration to see whether snapshot data actually loads.
 * Used by Integrations UI and Thinking pipeline — same checks plan generation uses.
 */
export class SnapshotHealthService {
  private ga = new GoogleAnalyticsSnapshotService();
  private ads = new GoogleAdsSnapshotService();
  private meta = new MetaAdsSnapshotService();
  private shopify = new ShopifySnapshotService();

  async getHealth(organizationId: string): Promise<{ platforms: SnapshotProbeResult[] }> {
    const platforms = await Promise.all([
      this.ga.probeSnapshot(organizationId),
      this.ads.probeSnapshot(organizationId),
      this.meta.probeSnapshot(organizationId),
      this.shopify.probeSnapshot(organizationId),
    ]);
    return { platforms };
  }

  async probeGoogleAds(organizationId: string): Promise<SnapshotProbeResult> {
    return this.ads.probeSnapshot(organizationId);
  }
}
