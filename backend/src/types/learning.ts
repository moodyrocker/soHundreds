export type EffectivenessRating = 'success' | 'neutral' | 'failure' | 'unknown';

export type ActionOutcomeRecord = {
  id: string;
  organizationId: string;
  strategyId: string;
  weekNumber: number;
  actionId: string;
  executionType: string;
  actionChannel: string | null;
  actionTitle: string;
  hypothesis: string | null;
  targetMetricKey: string | null;
  blockMetricBefore: number | null;
  blockMetricAfter: number | null;
  metricDelta: number | null;
  metricDeltaPct: number | null;
  effectivenessScore: number;
  rating: EffectivenessRating;
  goalContext: string | null;
  createdAt: string;
};

export type LearningPatternRecord = {
  id: string;
  organizationId: string;
  patternKey: string;
  patternText: string;
  executionType: string | null;
  actionChannel: string | null;
  confidence: number;
  sampleSize: number;
  successRate: number | null;
  avgScore: number | null;
  goalContextHint: string | null;
  lastReinforcedAt: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Attached to a generated plan week for UI transparency (#5). */
export type LearningPatternApplied = {
  pattern: string;
  confidence: number;
  sampleSize: number;
  patternKey: string;
};

export type LearningPromptContext = {
  patterns: LearningPatternRecord[];
  promptSection: string;
  applied: LearningPatternApplied[];
};
