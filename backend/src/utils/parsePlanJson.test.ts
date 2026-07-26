import { describe, expect, it } from 'vitest';
import {
  countPlanActions,
  extractJsonFromModelText,
  extractJsonObjectString,
  normalizePlanDocument,
} from './parsePlanJson.js';

/**
 * These are the highest-leverage tests in the codebase.
 *
 * Every plan, check-up, ad campaign and content deliverable arrives as text from
 * a language model and is coerced into a typed domain object here. Downstream,
 * that object drives irreversible external writes — published Shopify pages,
 * Instagram posts, funded ad campaigns. If extraction silently mangles a value,
 * the failure surfaces as wrong content on a customer's storefront, not as an
 * exception.
 *
 * The inputs below are the shapes models actually produce: fenced code blocks,
 * prose preambles, smart quotes from copy-paste, trailing commas, and
 * `<cite>` markup leaked by Anthropic's web_search tool.
 */

describe('extractJsonObjectString', () => {
  it('extracts a bare object', () => {
    expect(extractJsonObjectString('{"a":1}')).toBe('{"a":1}');
  });

  it('extracts from a ```json fenced block', () => {
    const input = 'Here is the plan:\n```json\n{"a":1}\n```\nHope that helps!';
    expect(extractJsonObjectString(input)).toBe('{"a":1}');
  });

  it('extracts from an unlabelled fenced block', () => {
    expect(extractJsonObjectString('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('ignores a prose preamble before the object', () => {
    const input = 'I have analysed your store and here is my plan. {"goal":"x"}';
    expect(extractJsonObjectString(input)).toBe('{"goal":"x"}');
  });

  it('ignores prose after the object', () => {
    expect(extractJsonObjectString('{"a":1} Let me know if you want changes.')).toBe('{"a":1}');
  });

  it('matches braces through nesting rather than stopping at the first }', () => {
    const nested = '{"a":{"b":{"c":[1,2,{"d":3}]}}}';
    expect(extractJsonObjectString(`prose ${nested} more prose`)).toBe(nested);
  });

  it('does not treat a brace inside a string as structural', () => {
    // A model writing about JSON, or copy containing a literal brace, previously
    // risked truncating the object here.
    const input = '{"note":"use {curly} braces","n":1}';
    expect(extractJsonObjectString(input)).toBe(input);
  });

  it('handles escaped quotes inside strings', () => {
    const input = '{"quote":"she said \\"hello\\" loudly","n":2}';
    expect(extractJsonObjectString(input)).toBe(input);
  });

  it('handles an escaped backslash immediately before a closing quote', () => {
    const input = '{"path":"C:\\\\temp\\\\","n":3}';
    expect(extractJsonObjectString(input)).toBe(input);
  });

  it('returns null when there is no object at all', () => {
    expect(extractJsonObjectString('I cannot help with that request.')).toBeNull();
    expect(extractJsonObjectString('')).toBeNull();
  });

  it('returns null for an unterminated object rather than a partial string', () => {
    // Truncation from a token limit is the realistic cause. Returning a partial
    // object would be far worse than failing.
    expect(extractJsonObjectString('{"a":1,"b":{"c":')).toBeNull();
  });

  it('takes the first complete object when the model emits several', () => {
    expect(extractJsonObjectString('{"first":1} {"second":2}')).toBe('{"first":1}');
  });
});

describe('extractJsonFromModelText', () => {
  it('parses well-formed JSON', () => {
    expect(extractJsonFromModelText('{"a":1,"b":[2,3]}')).toEqual({ a: 1, b: [2, 3] });
  });

  it('repairs trailing commas', () => {
    expect(extractJsonFromModelText('{"a":1,"b":2,}')).toEqual({ a: 1, b: 2 });
  });

  it('repairs single-quoted keys and values', () => {
    expect(extractJsonFromModelText("{'a':'one'}")).toEqual({ a: 'one' });
  });

  it('normalises smart quotes, which arrive via copy-paste and some models', () => {
    // Curly quotes are not valid JSON delimiters; prepareModelJsonString maps
    // them back before parsing.
    expect(extractJsonFromModelText('{\u201Ca\u201D:\u201Cone\u201D}')).toEqual({ a: 'one' });
  });

  it('strips a UTF-8 BOM', () => {
    expect(extractJsonFromModelText('\uFEFF{"a":1}')).toEqual({ a: 1 });
  });

  it('strips <cite> markup leaked by web_search', () => {
    const out = extractJsonFromModelText(
      '{"why":"<cite index=\\"1-1\\">competitors rank for this</cite>"}'
    ) as { why: string };
    expect(out.why).toBe('competitors rank for this');
    expect(out.why).not.toContain('cite');
  });

  it('strips self-closing cite tags', () => {
    const out = extractJsonFromModelText('{"why":"ranked well <cite index=\\"2\\"/>"}') as {
      why: string;
    };
    expect(out.why).not.toContain('cite');
  });

  it('throws with a preview when the response contains no JSON', () => {
    expect(() => extractJsonFromModelText('I am unable to produce a plan right now.')).toThrow(
      /did not contain JSON \(preview: I am unable/
    );
  });

  it('throws without a preview for empty input', () => {
    expect(() => extractJsonFromModelText('   ')).toThrow(/did not contain JSON$/);
  });

  it('throws a clear error for JSON too broken to repair', () => {
    expect(() => extractJsonFromModelText('{"a":')).toThrow(/did not contain JSON|invalid JSON/);
  });
});

/**
 * A plan `planDocumentSchema` accepts.
 *
 * Note how much is mandatory: every action needs id, channel, day, time, impact
 * and difficulty, and every summary needs eight unit/value pairs plus confidence
 * and weekCount. See the `schema strictness` block at the end of this file — that
 * strictness has a consequence worth knowing about.
 */
function action(overrides: Record<string, unknown> = {}) {
  return {
    id: 'w1-a1',
    title: 'Rewrite SEO for top 5 products',
    channel: 'seo',
    day: 'Mon',
    time: '30m',
    impact: 'high',
    difficulty: 'easy',
    why: 'Titles are truncated in search',
    outcome: 'Higher organic impressions',
    kpi: 'impressions',
    ...overrides,
  };
}

function week(overrides: Record<string, unknown> = {}) {
  return {
    week: 1,
    title: 'Foundations',
    dates: '1–7 Aug',
    focus: 'Fix product SEO',
    actions: [action()],
    ...overrides,
  };
}

function summary(overrides: Record<string, unknown> = {}) {
  return {
    duration: '8',
    durationUnit: 'weeks',
    time: '3',
    timeUnit: 'hours/week',
    budget: '200',
    budgetUnit: 'GBP/month',
    lift: '25',
    liftUnit: '%',
    goalLine: 'Grow monthly orders to 100',
    confidence: 'medium',
    weekCount: 1,
    goalTarget: { metric: 'orders', target: 100, unit: 'per month' },
    ...overrides,
  };
}

function validPlan(overrides: Record<string, unknown> = {}) {
  return { summary: summary(), weeks: [week()], ...overrides };
}

describe('normalizePlanDocument', () => {
  it('accepts a valid plan', () => {
    const plan = normalizePlanDocument(validPlan());
    expect(plan.weeks).toHaveLength(1);
    expect(plan.summary.goalLine).toBe('Grow monthly orders to 100');
  });

  it('coerces a numeric goal target to a string', () => {
    // Models return `"target": 100` as often as `"100"`; goalTargetSchema uses a
    // union + transform so both land as strings for display and later parsing.
    const plan = normalizePlanDocument(validPlan());
    expect(plan.summary.goalTarget?.target).toBe('100');
    expect(typeof plan.summary.goalTarget?.target).toBe('string');
  });

  it('preserves the id the model supplied', () => {
    // Action ids key action_executions, plan_action_completions and
    // action_run_states, so they must round-trip exactly.
    const raw = validPlan({ weeks: [week({ actions: [action({ id: 'model-chosen' })] })] });
    expect(normalizePlanDocument(raw).weeks[0]!.actions[0]!.id).toBe('model-chosen');
  });

  it('preserves the channel, which decides whether an action can spend money', () => {
    const raw = validPlan({ weeks: [week({ actions: [action({ channel: 'paid' })] })] });
    expect(normalizePlanDocument(raw).weeks[0]!.actions[0]!.channel).toBe('paid');
  });

  it('sanitises cite markup throughout nested strings', () => {
    const raw = validPlan({
      weeks: [week({ actions: [action({ why: '<cite index="1-2">because competitors do</cite>' })] })],
    });
    expect(normalizePlanDocument(raw).weeks[0]!.actions[0]!.why).toBe('because competitors do');
  });

  it('sanitises cite markup in the summary too', () => {
    const raw = validPlan({
      summary: summary({ goalLine: 'Grow to <cite index="3">100 orders</cite>' }),
    });
    expect(normalizePlanDocument(raw).summary.goalLine).toBe('Grow to 100 orders');
  });

  it('keeps an optional marketIntel block when present', () => {
    const raw = validPlan({
      marketIntel: {
        confidence: 'low',
        headline: 'Competitors lean on bundles',
        competitors: ['a', 'b'],
        trends: ['bundling'],
        emulateNotes: ['try a starter bundle'],
        disclaimer: 'Based on public sources.',
      },
    });
    expect(normalizePlanDocument(raw).marketIntel?.headline).toBe('Competitors lean on bundles');
  });

  it('omits marketIntel entirely when absent, rather than setting undefined', () => {
    expect('marketIntel' in normalizePlanDocument(validPlan())).toBe(false);
  });

  it('rejects a plan with no weeks', () => {
    expect(() => normalizePlanDocument({ summary: summary(), weeks: [] })).toThrow();
  });

  it('rejects a week with no actions', () => {
    expect(() => normalizePlanDocument(validPlan({ weeks: [week({ actions: [] })] }))).toThrow();
  });

  it('rejects a plan missing its summary', () => {
    expect(() => normalizePlanDocument({ weeks: [week()] })).toThrow();
  });

  it('rejects an out-of-range week number', () => {
    expect(() => normalizePlanDocument(validPlan({ weeks: [week({ week: 0 })] }))).toThrow();
    expect(() => normalizePlanDocument(validPlan({ weeks: [week({ week: 53 })] }))).toThrow();
  });

  it('rejects an unknown channel', () => {
    // Guards against a model inventing e.g. "tiktok" and it flowing into
    // actionRouter, which switches on this value.
    expect(() =>
      normalizePlanDocument(validPlan({ weeks: [week({ actions: [action({ channel: 'tiktok' })] })] }))
    ).toThrow();
  });

  it('rejects an unknown impact level', () => {
    expect(() =>
      normalizePlanDocument(validPlan({ weeks: [week({ actions: [action({ impact: 'huge' })] })] }))
    ).toThrow();
  });

  it('rejects non-object input', () => {
    expect(() => normalizePlanDocument('not a plan')).toThrow();
    expect(() => normalizePlanDocument(null)).toThrow();
    expect(() => normalizePlanDocument([])).toThrow();
  });
});

/**
 * Schema strictness — documenting current behaviour, and a gap it reveals.
 *
 * normalizePlanDocument contains three fallbacks that read as tolerance for model
 * drift:
 *
 *     id: action.id?.trim() || `w${week.week}-a${index + 1}`
 *     channel: action.channel ?? 'content'
 *     weekCount: parsed.summary.weekCount ?? weeks.length
 *
 * None of them can ever fire. `planDocumentSchema.parse()` runs first, and the
 * schema marks id, channel and weekCount as required — so any input that would
 * have triggered a fallback is rejected before reaching it.
 *
 * The practical effect is the opposite of what the fallbacks suggest: a model
 * that omits one `difficulty` string loses the entire plan, discarding a Claude
 * call of up to 8 turns at 16k tokens. claudeService retries once without web
 * search, but a systematically missing field fails twice.
 *
 * These tests pin the behaviour as it is today so the executionService refactor
 * cannot change it by accident. Whether to relax the schema so the fallbacks
 * become live is a product decision — it would make generation materially more
 * robust, and is worth taking deliberately rather than by accident.
 */
describe('schema strictness (documents current behaviour, not desired behaviour)', () => {
  it('rejects an action with no id — the id fallback is unreachable', () => {
    const { id: _omitted, ...noId } = action();
    expect(() => normalizePlanDocument(validPlan({ weeks: [week({ actions: [noId] })] }))).toThrow();
  });

  it('rejects an action with no channel — the channel default is unreachable', () => {
    const { channel: _omitted, ...noChannel } = action();
    expect(() =>
      normalizePlanDocument(validPlan({ weeks: [week({ actions: [noChannel] })] }))
    ).toThrow();
  });

  it('rejects a summary with no weekCount — the weekCount fallback is unreachable', () => {
    const { weekCount: _omitted, ...noWeekCount } = summary();
    expect(() => normalizePlanDocument({ summary: noWeekCount, weeks: [week()] })).toThrow();
  });

  it('rejects an action missing only difficulty, losing the whole plan', () => {
    const { difficulty: _omitted, ...noDifficulty } = action();
    expect(() =>
      normalizePlanDocument(validPlan({ weeks: [week({ actions: [noDifficulty] })] }))
    ).toThrow();
  });

  it('rejects a week missing only dates', () => {
    const { dates: _omitted, ...noDates } = week();
    expect(() => normalizePlanDocument(validPlan({ weeks: [noDates] }))).toThrow();
  });
});

describe('countPlanActions', () => {
  it('sums actions across weeks', () => {
    const plan = normalizePlanDocument(
      validPlan({
        summary: summary({ weekCount: 2 }),
        weeks: [
          week({ actions: [action({ id: 'a' }), action({ id: 'b' })] }),
          week({ week: 2, actions: [action({ id: 'c' })] }),
        ],
      })
    );
    expect(countPlanActions(plan)).toBe(3);
  });

  it('counts a single-action plan as 1', () => {
    // A week with zero actions is rejected by planWeekSchema (min(1)), so the
    // floor here is 1 rather than 0.
    expect(countPlanActions(normalizePlanDocument(validPlan()))).toBe(1);
  });
});

describe('end-to-end: raw model text to a typed plan', () => {
  it('survives the full gauntlet at once', () => {
    // Fenced block, prose either side, smart quotes, trailing comma, cite markup,
    // and a missing action id — all in one response, which is realistic.
    const modelOutput = `I have reviewed your analytics. Here is week one:

\`\`\`json
{
  "summary": {
    "duration": "8", "durationUnit": "weeks",
    "time": "3", "timeUnit": "hours/week",
    "budget": "200", "budgetUnit": "GBP/month",
    "lift": "25", "liftUnit": "%",
    "goalLine": "Grow to <cite index=\\"2\\">100 orders</cite> a month",
    "confidence": "medium",
    "weekCount": 1,
    "goalTarget": { "metric": "orders", "target": 100, "unit": "per month" },
  },
  "weeks": [
    {
      "week": 1,
      "title": "Foundations",
      "dates": "1–7 Aug",
      "focus": "Product SEO",
      "actions": [
        {
          "id": "w1-a1",
          "title": "Rewrite SEO for top products",
          "channel": "seo",
          "day": "Mon",
          "time": "30m",
          "impact": "high",
          "difficulty": "easy",
          "outcome": "More organic impressions",
          "kpi": "impressions",
          "why": "<cite index=\\"1-1\\">Titles are truncated in search</cite>",
        }
      ]
    }
  ]
}
\`\`\`

Let me know if you'd like a different emphasis.`;

    const plan = normalizePlanDocument(extractJsonFromModelText(modelOutput));

    expect(plan.weeks).toHaveLength(1);
    const parsed = plan.weeks[0]!.actions[0]!;
    // Fenced block unwrapped, prose on both sides discarded, two trailing commas
    // repaired, cite markup stripped from two different nesting depths, and the
    // numeric goal target coerced to a string.
    expect(parsed.id).toBe('w1-a1');
    expect(parsed.channel).toBe('seo');
    expect(parsed.why).toBe('Titles are truncated in search');
    expect(plan.summary.goalLine).toBe('Grow to 100 orders a month');
    expect(plan.summary.goalTarget?.target).toBe('100');
    expect(countPlanActions(plan)).toBe(1);
  });
});
