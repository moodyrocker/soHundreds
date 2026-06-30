import type { BusinessProfile } from '../services/businessProfileService.js';
import type { PlanGenerationContext } from '../services/claudeService.js';
import type { StrategyRequest } from './index.js';

export type WorkerId = 'research' | 'analysis' | 'optimization';

export type WorkerConfidence = 'high' | 'medium' | 'low';

export interface WorkerFinding {
  label: string;
  detail: string;
  confidence: WorkerConfidence;
}

export interface WorkerRecommendation {
  title: string;
  rationale: string;
  priority: number;
  confidence: WorkerConfidence;
}

export interface WorkerReport {
  workerId: WorkerId;
  summary: string;
  confidence: WorkerConfidence;
  findings: WorkerFinding[];
  recommendations: WorkerRecommendation[];
}

export interface WorkerContext {
  organizationId: string;
  request: StrategyRequest;
  businessProfile: BusinessProfile;
  planContext: PlanGenerationContext;
  dataSource: string;
}
