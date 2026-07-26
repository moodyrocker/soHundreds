import type { WorkerContext, WorkerReport } from '../types/workers.js';

/** Analysis worker — synthesize first-party snapshot signals into structured findings. */
export async function runAnalysisWorker(ctx: WorkerContext): Promise<WorkerReport> {
  const { planContext } = ctx;
  const findings: WorkerReport['findings'] = [];
  const recommendations: WorkerReport['recommendations'] = [];

  if (planContext.analyticsSnapshotText) {
    findings.push({
      label: 'GA4',
      detail: 'Traffic and channel snapshot loaded for the last 28 days.',
      confidence: 'high',
    });
    recommendations.push({
      title: 'Prioritize high-traffic, low-conversion pages',
      rationale: 'Use GA landing-page and channel data when ranking week-1 actions.',
      priority: 2,
      confidence: 'high',
    });
  }

  if (planContext.metaAdsSnapshotText) {
    findings.push({
      label: 'Meta Ads',
      detail: 'Paid social spend and campaign snapshot loaded.',
      confidence: 'high',
    });
    recommendations.push({
      title: 'Audit paid social efficiency',
      rationale: 'Compare Meta spend and conversions against organic/traffic channels.',
      priority: 1,
      confidence: 'high',
    });
  }

  if (planContext.shopifySnapshotText) {
    findings.push({
      label: 'Shopify',
      detail: 'Store orders and/or catalog snapshot loaded.',
      confidence: 'high',
    });
    recommendations.push({
      title: 'Double down on top SKUs',
      rationale: 'Merchandising actions should cite best-selling products from Shopify data.',
      priority: 2,
      confidence: 'high',
    });
  }

  if (planContext.googleAdsSnapshotText) {
    findings.push({
      label: 'Google Ads',
      detail: 'Paid search campaign snapshot loaded.',
      confidence: 'high',
    });
  } else if (planContext.hasGoogleAds) {
    findings.push({
      label: 'Google Ads',
      detail: 'Connected but snapshot unavailable (e.g. developer token pending).',
      confidence: 'low',
    });
  }

  const loadedCount = findings.length;
  return {
    workerId: 'analysis',
    confidence: loadedCount >= 2 ? 'high' : loadedCount === 1 ? 'medium' : 'low',
    summary:
      loadedCount > 0
        ? `${loadedCount} first-party source(s) analyzed for this plan.`
        : 'No live snapshots — analysis limited to research and benchmarks.',
    findings,
    recommendations,
  };
}
