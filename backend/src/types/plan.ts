import { z } from 'zod';

const channelId = z.enum(['instagram', 'email', 'seo', 'content', 'paid', 'local']);
const impact = z.enum(['high', 'med', 'low']);

export const planActionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  channel: channelId,
  day: z.string().min(1),
  time: z.string().min(1),
  impact,
  difficulty: z.string().min(1),
  why: z.string().min(1),
  outcome: z.string().min(1),
  kpi: z.string().min(1),
});

export const planWeekSchema = z.object({
  week: z.number().int().min(1).max(52),
  title: z.string().min(1),
  dates: z.string().min(1),
  focus: z.string().min(1),
  actions: z.array(planActionSchema).min(1),
});

/** Claude often returns numeric targets; store as strings for display + parsing. */
const stringLike = z.union([z.string(), z.number()]).transform((v) => String(v));

export const goalTargetSchema = z.object({
  metric: z.string().min(1),
  baseline: stringLike.optional(),
  target: stringLike.pipe(z.string().min(1)),
  unit: z.string().optional(),
});

export const planSummarySchema = z.object({
  duration: z.string().min(1),
  durationUnit: z.string().min(1),
  time: z.string().min(1),
  timeUnit: z.string().min(1),
  budget: z.string().min(1),
  budgetUnit: z.string().min(1),
  lift: z.string().min(1),
  liftUnit: z.string().min(1),
  goalLine: z.string().min(1),
  confidence: z.enum(['high', 'medium', 'low']),
  weekCount: z.number().int().min(1).max(52),
  goalTarget: goalTargetSchema.optional(),
});

export const marketIntelBlockSchema = z.object({
  confidence: z.enum(['low', 'medium']),
  headline: z.string().min(1),
  competitors: z.array(z.string()).max(8),
  trends: z.array(z.string()).max(6),
  emulateNotes: z.array(z.string()).max(5),
  disclaimer: z.string().min(1),
});

export const planDocumentSchema = z.object({
  summary: planSummarySchema,
  weeks: z.array(planWeekSchema).min(1).max(52),
  marketIntel: marketIntelBlockSchema.optional(),
});

export type GoalTarget = z.infer<typeof goalTargetSchema>;
export type MarketIntelBlock = z.infer<typeof marketIntelBlockSchema>;
export type PlanDocument = z.infer<typeof planDocumentSchema>;
export type PlanSummary = z.infer<typeof planSummarySchema>;
export type PlanWeek = z.infer<typeof planWeekSchema>;
export type PlanAction = z.infer<typeof planActionSchema>;
