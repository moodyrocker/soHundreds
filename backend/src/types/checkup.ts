import { z } from 'zod';

export const checkupMetricSchema = z.object({
  source: z.enum(['google_analytics', 'google_ads', 'meta_ads', 'shopify', 'general']),
  label: z.string().min(1),
  value: z.string().min(1),
});

export const checkupCoverageSchema = z.object({
  source: z.enum(['google_analytics', 'google_ads', 'meta_ads', 'shopify']),
  connected: z.boolean(),
  loaded: z.boolean(),
  note: z.string().nullable().optional(),
});

export const checkupPrioritySchema = z.object({
  title: z.string().min(1),
  why: z.string().min(1),
  impact: z.enum(['high', 'med', 'low']),
});

export const checkupDocumentSchema = z.object({
  headline: z.string().min(1),
  overallHealth: z.enum(['good', 'fair', 'weak', 'unknown']),
  confidence: z.enum(['high', 'medium', 'low']),
  liveMetrics: z.array(checkupMetricSchema),
  dataCoverage: z.array(checkupCoverageSchema),
  whatsWorking: z.array(z.string().min(1)),
  whatsWeak: z.array(z.string().min(1)),
  whatsMissing: z.array(z.string().min(1)),
  topPriorities: z.array(checkupPrioritySchema).min(1).max(5),
  summary: z.string().min(1),
});

export type CheckupDocument = z.infer<typeof checkupDocumentSchema>;
