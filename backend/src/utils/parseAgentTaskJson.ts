import { z } from 'zod';
import { extractJsonFromModelText } from './parsePlanJson.js';

const executionBriefSchema = z.object({
  fullRequest: z.string().optional(),
  imageSource: z.enum(['unsplash', 'shopify', 'canva']).optional(),
  imageSearchQuery: z.string().optional(),
  slideCount: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v),
    z.number().int().min(1).max(10).optional()
  ),
  ctaText: z.string().optional(),
  mediaFormat: z.preprocess((v) => {
    if (typeof v !== 'string') return v;
    const s = v.toLowerCase().trim();
    if (s === 'stories' || s === 'ig story') return 'story';
    if (s === 'reels' || s === 'ig reel') return 'reel';
    if (s === 'carousels') return 'carousel';
    if (s === 'post' || s === 'feed post') return 'feed';
    return s;
  }, z.enum(['feed', 'carousel', 'story', 'reel']).optional()),
  videoUrl: z.preprocess((v) => {
    if (typeof v !== 'string') return v;
    const t = v.trim();
    if (!t || !/^https?:\/\//i.test(t)) return undefined;
    return t;
  }, z.string().url().optional()),
  videoSource: z.preprocess((v) => {
    if (typeof v !== 'string') return v;
    const s = v.toLowerCase().trim();
    if (s === 'runway' || s === 'ai' || s === 'generate') return 'runway';
    if (s === 'user' || s === 'url' || s === 'provided') return 'user';
    return s;
  }, z.enum(['runway', 'user']).optional()),
  recipeSlug: z.preprocess((v) => {
    if (typeof v !== 'string') return v;
    const t = v.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    return t || undefined;
  }, z.string().max(80).optional()),
  productImageUrl: z.preprocess((v) => {
    if (typeof v !== 'string') return v;
    const t = v.trim();
    if (!t || !/^https?:\/\//i.test(t)) return undefined;
    return t;
  }, z.string().url().optional()),
  characterImageUrl: z.preprocess((v) => {
    if (typeof v !== 'string') return v;
    const t = v.trim();
    if (!t || !/^https?:\/\//i.test(t)) return undefined;
    return t;
  }, z.string().url().optional()),
});

const softActionSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1),
  channel: z
    .enum(['instagram', 'email', 'seo', 'content', 'paid', 'local'])
    .or(z.string())
    .optional(),
  day: z.string().optional(),
  time: z.string().optional(),
  impact: z.union([z.enum(['high', 'med', 'low']), z.string()]).optional(),
  difficulty: z.string().optional(),
  why: z.string().optional(),
  outcome: z.string().optional(),
  kpi: z.string().optional(),
});

const agentTaskSchema = z.object({
  reply: z.string().min(1),
  supported: z.boolean(),
  unsupportedReason: z.string().optional(),
  action: softActionSchema.optional(),
  sentiment: z
    .enum(['positive', 'neutral', 'negative', 'frustrated', 'curious', 'urgent'])
    .or(z.string())
    .optional(),
  needsClarification: z.boolean().optional(),
  executionBrief: executionBriefSchema.optional(),
});

export type ParsedAgentTask = {
  reply: string;
  supported: boolean;
  unsupportedReason?: string;
  action?: {
    id: string;
    title: string;
    channel: 'instagram' | 'email' | 'seo' | 'content' | 'paid' | 'local';
    day: string;
    time: string;
    impact: 'high' | 'med' | 'low';
    difficulty: string;
    why: string;
    outcome: string;
    kpi: string;
  };
  sentiment?: 'positive' | 'neutral' | 'negative' | 'frustrated' | 'curious' | 'urgent';
  needsClarification?: boolean;
  executionBrief?: z.infer<typeof executionBriefSchema>;
};

const SENTIMENTS = new Set([
  'positive',
  'neutral',
  'negative',
  'frustrated',
  'curious',
  'urgent',
]);

const CHANNELS = new Set(['instagram', 'email', 'seo', 'content', 'paid', 'local']);

function normalizeImpact(raw: unknown): 'high' | 'med' | 'low' {
  const s = String(raw ?? 'med').toLowerCase();
  if (s === 'high' || s === 'h') return 'high';
  if (s === 'low' || s === 'l') return 'low';
  if (s === 'medium' || s === 'med' || s === 'm' || s === 'moderate') return 'med';
  return 'med';
}

function normalizeChannel(
  raw: unknown,
  title: string,
  brief?: z.infer<typeof executionBriefSchema>
): 'instagram' | 'email' | 'seo' | 'content' | 'paid' | 'local' {
  const s = String(raw ?? '').toLowerCase();
  if (CHANNELS.has(s)) {
    return s as 'instagram' | 'email' | 'seo' | 'content' | 'paid' | 'local';
  }
  const blob = `${title} ${brief?.fullRequest ?? ''}`.toLowerCase();
  if (/instagram|reel|story|stories|ig\b/.test(blob)) return 'instagram';
  if (/shopify|blog|landing page|seo|product/.test(blob)) {
    return /seo|product title|meta description/.test(blob) ? 'seo' : 'content';
  }
  if (/ads?|campaign|budget|meta|google/.test(blob)) return 'paid';
  return 'instagram';
}

function normalizeSentiment(
  raw: unknown
): ParsedAgentTask['sentiment'] {
  const s = String(raw ?? 'neutral').toLowerCase().trim();
  if (SENTIMENTS.has(s)) return s as ParsedAgentTask['sentiment'];
  if (/frustrat|annoy|angry/.test(s)) return 'frustrated';
  if (/curios|interest/.test(s)) return 'curious';
  if (/urgent|asap|now/.test(s)) return 'urgent';
  if (/negativ|unhappy|bad/.test(s)) return 'negative';
  if (/positiv|happy|great|good/.test(s)) return 'positive';
  return 'neutral';
}

/** Claude often returns null for omitted fields — coerce to undefined before Zod parse. */
function normalizeAgentTaskRaw(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null) continue;
    if (key === 'executionBrief' && typeof value === 'object' && !Array.isArray(value)) {
      const brief: Record<string, unknown> = {};
      for (const [bk, bv] of Object.entries(value as Record<string, unknown>)) {
        if (bv === null || bv === '') continue;
        brief[bk] = bv;
      }
      if (Object.keys(brief).length) out[key] = brief;
      continue;
    }
    out[key] = value;
  }
  return out;
}

function softActionToPlanAction(
  action: z.infer<typeof softActionSchema>,
  brief?: z.infer<typeof executionBriefSchema>
): NonNullable<ParsedAgentTask['action']> {
  const title = action.title.trim();
  return {
    id: action.id?.trim() || 'placeholder',
    title,
    channel: normalizeChannel(action.channel, title, brief),
    day: action.day?.trim() || 'NOW',
    time: action.time?.trim() || '5 min',
    impact: normalizeImpact(action.impact),
    difficulty: action.difficulty?.trim() || 'Easy',
    why: action.why?.trim() || title,
    outcome: action.outcome?.trim() || title,
    kpi: action.kpi?.trim() || 'engagement',
  };
}

export function parseAgentTaskJson(text: string): ParsedAgentTask {
  const raw = extractJsonFromModelText(text);
  const parsed = agentTaskSchema.parse(normalizeAgentTaskRaw(raw));
  const sentiment = normalizeSentiment(parsed.sentiment);

  if (parsed.action && parsed.supported) {
    return {
      reply: parsed.reply,
      supported: true,
      unsupportedReason: parsed.unsupportedReason,
      needsClarification: parsed.needsClarification,
      sentiment,
      executionBrief: parsed.executionBrief,
      action: softActionToPlanAction(parsed.action, parsed.executionBrief),
    };
  }

  return {
    reply: parsed.reply,
    supported: parsed.supported,
    unsupportedReason: parsed.unsupportedReason,
    needsClarification: parsed.needsClarification,
    sentiment,
    executionBrief: parsed.executionBrief,
  };
}
