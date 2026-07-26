import type { WorkerContext, WorkerReport } from '../types/workers.js';

/**
 * Research worker — market/category context from business profile and goal.
 * Phase 3 V1: structured report without a separate Claude call (web search runs in plan step).
 */
export async function runResearchWorker(ctx: WorkerContext): Promise<WorkerReport> {
  const { businessProfile, request } = ctx;
  const findings: WorkerReport['findings'] = [];

  if (businessProfile.website?.trim()) {
    findings.push({
      label: 'Website',
      detail: businessProfile.website.trim(),
      confidence: 'high',
    });
  }
  if (businessProfile.oneLiner?.trim()) {
    findings.push({
      label: 'Positioning',
      detail: businessProfile.oneLiner.trim(),
      confidence: 'high',
    });
  }
  if (businessProfile.audience?.trim()) {
    findings.push({
      label: 'Audience',
      detail: businessProfile.audience.trim(),
      confidence: 'medium',
    });
  }
  if (businessProfile.emulate?.trim()) {
    findings.push({
      label: 'Emulate',
      detail: businessProfile.emulate.trim(),
      confidence: 'medium',
    });
  }

  const hasSeed = findings.length > 0;
  const refinement = request.refinementNotes?.trim();

  return {
    workerId: 'research',
    confidence: hasSeed ? 'medium' : 'low',
    summary: hasSeed
      ? 'Business profile and emulate list seed market research for this plan.'
      : 'Limited business context — plan will lean on first-party data and generic benchmarks.',
    findings,
    recommendations: refinement
      ? [
          {
            title: 'Apply user refinement in market block',
            rationale: refinement.slice(0, 500),
            priority: 1,
            confidence: 'medium',
          },
        ]
      : businessProfile.emulate?.trim()
        ? [
            {
              title: 'Benchmark against emulate list',
              rationale: `Compare channel mix and messaging to: ${businessProfile.emulate.trim().slice(0, 200)}`,
              priority: 1,
              confidence: 'medium',
            },
          ]
        : [],
  };
}
