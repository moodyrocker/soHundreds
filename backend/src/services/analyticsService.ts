import type { PlanDocument } from '../types/plan.js';
import type { GoalProgressResult } from './goalProgressService.js';
import { GoalProgressService } from './goalProgressService.js';
import { GoogleAnalyticsSnapshotService } from './googleAnalyticsSnapshotService.js';
import { MetaAdsSnapshotService } from './metaAdsSnapshotService.js';
import { ShopifySnapshotService } from './shopifySnapshotService.js';
import {
  parseGaSnapshotText,
  parseShopifySnapshotText,
  type MetricKey,
} from '../utils/metricParsing.js';

export type MetricDelta = {
  key: MetricKey;
  label: string;
  current: number | null;
  previous: number | null;
  delta: number | null;
  deltaPct: number | null;
  source: string | null;
};

export type AnalyticsSnapshot = {
  goalProgress: GoalProgressResult;
  metricDeltas: MetricDelta[];
  integrationSummary: string;
  reasoningLines: string[];
};

/**
 * Structured analytics for checkpoint re-analysis (#9, #11).
 * Reuses live snapshots + goal progress — not templated copy.
 */
export class AnalyticsService {
  private goalProgress = new GoalProgressService();
  private ga = new GoogleAnalyticsSnapshotService();
  private meta = new MetaAdsSnapshotService();
  private shopify = new ShopifySnapshotService();

  async analyzeForCheckpoint(
    organizationId: string,
    plan: PlanDocument,
    goalLine: string,
    priorBaseline?: number | null
  ): Promise<AnalyticsSnapshot> {
    const goalProgress = await this.goalProgress.checkProgress(
      organizationId,
      plan,
      goalLine,
      priorBaseline ?? null
    );

    const [gaSnap, metaSnap, shopSnap] = await Promise.all([
      this.ga.fetchSnapshot(organizationId),
      this.meta.fetchSnapshot(organizationId),
      this.shopify.fetchSnapshot(organizationId),
    ]);

    const gaMetrics = gaSnap?.text ? parseGaSnapshotText(gaSnap.text) : {};
    const shopMetrics = shopSnap?.text ? parseShopifySnapshotText(shopSnap.text) : {};

    const metricDeltas: MetricDelta[] = [];
    const key = goalProgress.metricKey;
    const label = plan.summary.goalTarget?.metric ?? key;

    if (goalProgress.currentValue != null && goalProgress.baselineValue != null) {
      const delta = goalProgress.currentValue - goalProgress.baselineValue;
      const deltaPct =
        goalProgress.baselineValue !== 0
          ? Math.round((delta / goalProgress.baselineValue) * 1000) / 10
          : null;
      metricDeltas.push({
        key,
        label,
        current: goalProgress.currentValue,
        previous: goalProgress.baselineValue,
        delta,
        deltaPct,
        source: goalProgress.dataSources[0] ?? null,
      });
    }

    const integrationParts: string[] = [];
    if (gaSnap?.text) integrationParts.push('GA4 loaded');
    if (metaSnap?.text) integrationParts.push('Meta Ads loaded');
    if (shopSnap?.text) integrationParts.push('Shopify loaded');
    if (gaMetrics.sessions != null) {
      metricDeltas.push({
        key: 'sessions',
        label: 'Sessions (28d)',
        current: gaMetrics.sessions,
        previous: null,
        delta: null,
        deltaPct: null,
        source: 'google_analytics',
      });
    }
    if (shopMetrics.orders != null) {
      metricDeltas.push({
        key: 'orders',
        label: 'Orders (30d)',
        current: shopMetrics.orders,
        previous: null,
        delta: null,
        deltaPct: null,
        source: 'shopify',
      });
    }

    const reasoningLines: string[] = [];
    if (goalProgress.goalMet) {
      reasoningLines.push(`Goal metric met: ${goalProgress.summary}`);
    } else if (goalProgress.progressPct != null) {
      reasoningLines.push(
        `Progress: ${goalProgress.progressPct}% toward target (${goalProgress.summary}).`
      );
    } else {
      reasoningLines.push(goalProgress.summary);
    }

    for (const d of metricDeltas) {
      if (d.delta != null && d.deltaPct != null) {
        reasoningLines.push(
          `${d.label} moved ${d.delta >= 0 ? '+' : ''}${d.delta} (${d.deltaPct >= 0 ? '+' : ''}${d.deltaPct}% vs baseline).`
        );
      } else if (d.current != null) {
        reasoningLines.push(`${d.label} currently ${d.current} (live ${d.source ?? 'data'}).`);
      }
    }

    if (!integrationParts.length) {
      reasoningLines.push(
        'No live integration snapshots loaded — next block will rely on plan context until data connects.'
      );
    }

    return {
      goalProgress,
      metricDeltas,
      integrationSummary: integrationParts.join(' · ') || 'No live data',
      reasoningLines,
    };
  }
}
