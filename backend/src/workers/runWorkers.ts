import type { WorkerContext, WorkerReport } from '../types/workers.js';
import { runAnalysisWorker } from './analysisWorker.js';
import { runOptimizationWorker } from './optimizationWorker.js';
import { runResearchWorker } from './researchWorker.js';

export async function runPlanWorkers(ctx: WorkerContext): Promise<WorkerReport[]> {
  const [research, analysis, optimization] = await Promise.all([
    runResearchWorker(ctx),
    runAnalysisWorker(ctx),
    runOptimizationWorker(ctx),
  ]);

  return [research, analysis, optimization];
}

export function listLoadedSources(ctx: WorkerContext): string[] {
  const sources: string[] = [];
  const { planContext } = ctx;
  if (planContext.analyticsSnapshotText) sources.push('google_analytics');
  if (planContext.googleAdsSnapshotText) sources.push('google_ads');
  if (planContext.metaAdsSnapshotText) sources.push('meta_ads');
  if (planContext.shopifySnapshotText) sources.push('shopify');
  return sources;
}
