import { z } from 'zod';
import type { AssistDeliverable } from '../types/execution.js';
import { sanitizeModelStrings } from './stripModelMarkup.js';
import { extractJsonFromModelText } from './parsePlanJson.js';

function normalizeExtrasValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        typeof item === 'string' ? item : typeof item === 'object' && item ? JSON.stringify(item) : String(item)
      )
      .join(', ');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function normalizeAssistRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  const extras = obj.extras;
  if (!extras || typeof extras !== 'object' || Array.isArray(extras)) {
    return raw;
  }
  const normalizedExtras: Record<string, string> = {};
  for (const [key, value] of Object.entries(extras as Record<string, unknown>)) {
    const text = normalizeExtrasValue(value).trim();
    if (text) normalizedExtras[key] = text;
  }
  return { ...obj, extras: normalizedExtras };
}

const stringExtras = z.preprocess((val) => {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(val as Record<string, unknown>)) {
    const text = normalizeExtrasValue(value).trim();
    if (text) out[key] = text;
  }
  return out;
}, z.record(z.string(), z.string()));

const assistSchema = z.object({
  headline: z.string().min(1),
  primaryCopy: z.string().min(1),
  steps: z.array(z.string()).min(1).max(8),
  extras: stringExtras.default({}),
  pasteInstructions: z.string().min(1),
  reasoning: z.string().min(1).optional(),
  shopifyMcpPrompt: z.string().min(1).optional(),
  proposedImageUrl: z.string().url().optional(),
  imageSource: z.enum(['shopify', 'unsplash']).optional(),
  imageAlt: z.string().min(1).optional(),
  imageAttribution: z.string().min(1).optional(),
  imageRationale: z.string().min(1).optional(),
});

export function parseAssistDeliverable(raw: unknown): AssistDeliverable {
  const normalized = normalizeAssistRaw(raw);
  const parsed = assistSchema.parse(normalized);
  return sanitizeModelStrings({
    kind: 'assist_deliverable',
    ...parsed,
  }) as AssistDeliverable;
}

export function parseAssistJson(text: string): AssistDeliverable {
  const raw = extractJsonFromModelText(text);
  return parseAssistDeliverable(raw);
}
