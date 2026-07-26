import type { WorkerContext, WorkerReport } from '../types/workers.js';

/**
 * Optimization worker — ranked channel opportunities (Phase 3 stub).
 * Full EV / portfolio optimization comes in a later iteration.
 */
export async function runOptimizationWorker(ctx: WorkerContext): Promise<WorkerReport> {
  const { planContext, request } = ctx;
  const recommendations: WorkerReport['recommendations'] = [];
  let priority = 1;

  if (planContext.metaAdsSnapshotText && planContext.shopifySnapshotText) {
    recommendations.push({
      title: 'Align Meta spend with Shopify bestsellers',
      rationale: 'Cross-reference ad campaigns with top revenue SKUs before scaling budget.',
      priority: priority++,
      confidence: 'high',
    });
  }

  if (planContext.analyticsSnapshotText && planContext.shopifySnapshotText) {
    recommendations.push({
      title: 'Fix high-traffic product pages with weak conversion',
      rationale: 'GA entry pages that underperform vs Shopify order rate are quick wins.',
      priority: priority++,
      confidence: 'high',
    });
  }

  if (planContext.metaAdsSnapshotText && !planContext.analyticsSnapshotText) {
    recommendations.push({
      title: 'Connect GA4 for landing-page attribution',
      rationale: 'Meta data alone cannot show on-site behavior after the click.',
      priority: priority++,
      confidence: 'medium',
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      title: 'Establish measurement baseline',
      rationale: `Connect analytics and store data to optimize toward: ${request.goal.slice(0, 120)}`,
      priority: 1,
      confidence: 'low',
    });
  }

  return {
    workerId: 'optimization',
    confidence: recommendations.some((r) => r.confidence === 'high')
      ? 'high'
      : recommendations.some((r) => r.confidence === 'medium')
        ? 'medium'
        : 'low',
    summary: `${recommendations.length} optimization candidate(s) ranked for the orchestrator.`,
    findings: [],
    recommendations,
  };
}
