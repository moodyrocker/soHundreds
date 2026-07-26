import { jsonrepair } from 'jsonrepair';
import { planDocumentSchema, type PlanDocument } from '../types/plan.js';
import { sanitizeModelStrings, stripWebSearchCitations } from './stripModelMarkup.js';
import { logger } from '../lib/logger.js';

const log = logger('parse-plan-json');

/** Normalize common model output that breaks JSON.parse before repair. */
function prepareModelJsonString(jsonStr: string): string {
  return stripWebSearchCitations(jsonStr)
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u2018|\u2019/g, "'")
    .replace(/^\uFEFF/, '');
}

function parseJsonLenient(jsonStr: string): unknown {
  const prepared = prepareModelJsonString(jsonStr);
  try {
    return JSON.parse(prepared);
  } catch (firstErr) {
    try {
      const repaired = jsonrepair(prepared);
      const parsed = JSON.parse(repaired);
      log.warn('[parsePlanJson] repaired malformed model JSON');
      return parsed;
    } catch {
      const msg = firstErr instanceof Error ? firstErr.message : 'invalid JSON';
      throw new Error(`Model returned invalid JSON: ${msg}`);
    }
  }
}

/** Extract the first complete top-level JSON object using brace matching. */
export function extractJsonObjectString(text: string): string | null {
  const trimmed = text.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  const start = candidate.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];

    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }

  return null;
}

export function extractJsonFromModelText(text: string): unknown {
  const cleaned = stripWebSearchCitations(text.trim());
  const jsonStr = extractJsonObjectString(cleaned);
  if (!jsonStr) {
    const preview = cleaned.slice(0, 200).replace(/\s+/g, ' ');
    throw new Error(
      preview.length
        ? `Model response did not contain JSON (preview: ${preview}…)`
        : 'Model response did not contain JSON'
    );
  }

  return parseJsonLenient(jsonStr);
}

export function normalizePlanDocument(raw: unknown): PlanDocument {
  const parsed = planDocumentSchema.parse(raw);

  const weeks = parsed.weeks.map((week) => ({
    ...week,
    actions: week.actions.map((action, index) => ({
      ...action,
      id: action.id?.trim() || `w${week.week}-a${index + 1}`,
      channel: action.channel ?? 'content',
    })),
  }));

  return sanitizeModelStrings({
    summary: {
      ...parsed.summary,
      weekCount: parsed.summary.weekCount ?? weeks.length,
    },
    weeks,
    ...(parsed.marketIntel ? { marketIntel: parsed.marketIntel } : {}),
  });
}

export function countPlanActions(plan: PlanDocument): number {
  return plan.weeks.reduce((sum, w) => sum + w.actions.length, 0);
}
