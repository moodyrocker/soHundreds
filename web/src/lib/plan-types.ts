import type { ChannelId, Impact } from '@/lib/channels';

export interface PlanAction {
  id: string;
  title: string;
  channel: ChannelId;
  day: string;
  time: string;
  impact: Impact;
  difficulty: string;
  why: string;
  outcome: string;
  kpi: string;
}

export interface PlanWeek {
  week: number;
  title: string;
  dates: string;
  focus: string;
  actions: PlanAction[];
}

export type GoalTarget = {
  metric: string;
  baseline?: string;
  target: string;
  unit?: string;
};

export interface PlanSummary {
  duration: string;
  durationUnit: string;
  time: string;
  timeUnit: string;
  budget: string;
  budgetUnit: string;
  lift: string;
  liftUnit: string;
  goalLine: string;
  confidence: 'high' | 'medium' | 'low';
  weekCount: number;
  goalTarget?: GoalTarget;
}

export interface MarketIntelBlock {
  confidence: 'low' | 'medium';
  headline: string;
  competitors: string[];
  trends: string[];
  emulateNotes: string[];
  disclaimer: string;
}

export interface PlanDocument {
  summary: PlanSummary;
  weeks: PlanWeek[];
  marketIntel?: MarketIntelBlock;
}

export type StrategyDataSource =
  | 'analytics'
  | 'google_ads'
  | 'meta_ads'
  | 'shopify'
  | 'multi'
  | 'generic';

export type StrategyStatus = 'generating' | 'active' | 'archived' | 'failed';
export type GoalStatus = 'active' | 'met' | 'paused';

export interface StrategyRecord {
  id: string;
  organizationId: string;
  goal: string;
  context: string | null;
  budget: string | null;
  status: StrategyStatus;
  dataSource: StrategyDataSource;
  plan: PlanDocument | null;
  actionCount: number;
  generationError: string | null;
  parentStrategyId: string | null;
  refinementNotes: string | null;
  currentWeek: number;
  goalStatus: GoalStatus;
  createdAt: string;
  updatedAt: string;
}

export function dataSourceLabel(source: StrategyDataSource): string {
  if (source === 'multi') return 'Multi-source informed';
  if (source === 'analytics') return 'GA-informed';
  if (source === 'google_ads') return 'Google Ads informed';
  if (source === 'meta_ads') return 'Meta Ads informed';
  if (source === 'shopify') return 'Shopify informed';
  return 'Research-based';
}
