import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages/messages.js';
import type { CheckupDocument } from '../types/checkup.js';
import type { PlanDocument, PlanWeek } from '../types/plan.js';
import type { MarketIntelPromptSection } from '../types/marketIntel.js';
import type { StrategyRequest } from '../types/index.js';
import type { WorkerReport } from '../types/workers.js';
import type { PlanAction } from '../types/plan.js';
import type { AssistDeliverable, ShopifyBlogArticleState, ShopifyPageState, GoogleAdsCampaignState, MetaAdsCampaignState, MailchimpSequenceState } from '../types/execution.js';
import { parseCheckupJson } from '../utils/parseCheckupJson.js';
import { parseAssistJson } from '../utils/parseAssistJson.js';
import { parseShopifyPageJson } from '../utils/parseShopifyPageJson.js';
import { parseShopifyBlogJson } from '../utils/parseShopifyBlogJson.js';
import {
  isInstagramAutoPublishEnabled,
  isShopifyAutoPublishLiveEnabled,
} from '../lib/contentPublishFeatureFlags.js';
import { pacePlanPromptNotes, type AutopilotPace } from '../lib/autopilotPaceConfig.js';
import { supportedChannelsPlanNotes } from '../lib/supportedPlanChannels.js';
import { parseGoogleAdsCampaignJson } from '../utils/parseGoogleAdsCampaignJson.js';
import { parseMetaAdsCampaignJson } from '../utils/parseMetaAdsCampaignJson.js';
import { parseMailchimpSequenceJson } from '../utils/parseMailchimpSequenceJson.js';
import { extractJsonFromModelText, extractJsonObjectString, normalizePlanDocument } from '../utils/parsePlanJson.js';
import { parseAgentTaskJson, type ParsedAgentTask } from '../utils/parseAgentTaskJson.js';
import { randomUUID } from 'node:crypto';
import { sanitizeModelStrings } from '../utils/stripModelMarkup.js';
import { fetchWebsiteText } from '../lib/fetchWebsiteText.js';

const DEFAULT_MODEL =
  process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514';

const MAX_TURNS = 8;
const MAX_TOKENS = 16_384;

const WEB_SEARCH_TOOL = {
  type: 'web_search_20250305' as const,
  name: 'web_search' as const,
  max_uses: 3,
};

export interface PlanGenerationContext {
  hasAnalytics: boolean;
  propertyId?: string;
  analyticsSnapshotText?: string;
  hasGoogleAds?: boolean;
  googleAdsSnapshotText?: string;
  hasMetaAds?: boolean;
  metaAdsSnapshotText?: string;
  hasShopify?: boolean;
  shopifySnapshotText?: string;
}

export interface CheckupPromptInput {
  businessContext: string | null;
  generationContext: PlanGenerationContext;
  dataCoverage: CheckupDocument['dataCoverage'];
  marketIntel?: MarketIntelPromptSection | null;
}

export interface NextWeekResult {
  goalMet: boolean;
  progressNote?: string;
  week: PlanWeek | null;
}

export class ClaudeService {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  async generatePlanDocument(
    request: StrategyRequest,
    ctx: PlanGenerationContext,
    marketIntel?: MarketIntelPromptSection | null,
    refinementNotes?: string,
    workerReports?: WorkerReport[],
    learningPromptSection?: string,
    pace: AutopilotPace = 'normal'
  ): Promise<PlanDocument> {
    const prompt = this.buildPlanJsonPrompt(
      request,
      ctx,
      marketIntel,
      refinementNotes,
      workerReports,
      learningPromptSection,
      pace
    );
    const useWebSearch = this.shouldUseWebSearch(ctx, marketIntel, refinementNotes);

    try {
      return await this.requestPlanJson(prompt, useWebSearch);
    } catch (firstErr) {
      console.warn(
        '[claude] plan generation failed, retrying without web search:',
        firstErr instanceof Error ? firstErr.message : firstErr
      );
      return await this.requestPlanJson(
        `${prompt}\n\nCRITICAL: Output ONLY one valid JSON object. No markdown fences, no commentary before or after.`,
        false
      );
    }
  }

  async generateNextPlanWeek(
    request: StrategyRequest,
    plan: PlanDocument,
    nextWeekNumber: number,
    ctx: PlanGenerationContext,
    priorOutcomeSummary?: string,
    learningPromptSection?: string,
    pace: AutopilotPace = 'normal'
  ): Promise<NextWeekResult> {
    const priorWeeks = plan.weeks
      .map(
        (w) =>
          `Week ${w.week} — ${w.title}: ${w.focus}\nActions: ${w.actions.map((a) => a.title).join('; ')}`
      )
      .join('\n');

    const goalTarget = plan.summary.goalTarget;
    const targetLine = goalTarget
      ? `Target: ${goalTarget.metric} → ${goalTarget.target}${goalTarget.unit ? ` ${goalTarget.unit}` : ''}`
      : plan.summary.goalLine;

    let prompt = `You are a marketing operator running a CONTINUOUS goal pursuit — not a fixed calendar plan.

USER'S GOAL: ${request.goal}
${targetLine}
BUSINESS CONTEXT: ${request.context || 'Not provided'}

COMPLETED WEEKS SO FAR:
${priorWeeks}

Generate ONLY week ${nextWeekNumber} — the next highest-leverage actions toward the goal.
If connected data shows the goal is already met, set goalMet true and omit week.

`;
    if (priorOutcomeSummary?.trim()) {
      prompt += `PRIOR WEEK OUTCOMES (metrics + actions completed):
${priorOutcomeSummary}

Use these outcomes to decide what to do next — double down on what moves the target metric.

`;
    }
    if (learningPromptSection?.trim()) {
      prompt += learningPromptSection;
    }
    if (ctx.analyticsSnapshotText) {
      prompt += `--- LATEST ANALYTICS ---\n${ctx.analyticsSnapshotText}\n---\n`;
    }
    if (ctx.shopifySnapshotText) {
      prompt += `--- LATEST SHOPIFY ---\n${ctx.shopifySnapshotText}\n---\n`;
    }

    prompt += `
OUTPUT: ONLY valid JSON:
{
  "goalMet": false,
  "progressNote": "one sentence on progress toward goal",
  "week": {
    "week": ${nextWeekNumber},
    "title": "theme",
    "dates": "Week ${nextWeekNumber}",
    "focus": "one sentence",
    "actions": [
      {
        "id": "w${nextWeekNumber}-a1",
        "title": "...",
        "channel": "instagram" | "email" | "seo" | "content" | "paid" | "local",
        "day": "MON",
        "time": "20 min",
        "impact": "high" | "med" | "low",
        "difficulty": "Easy",
        "why": "2-4 sentences",
        "outcome": "...",
        "kpi": "..."
      }
    ]
  }
}

Rules:
- If goalMet is true, set week to null.
- Otherwise schedule actions for week ${nextWeekNumber} per PACE MODE below; unique ids w${nextWeekNumber}-a{M}.
- Build on prior weeks — do not repeat completed work.
- INTEGRATION AVAILABILITY: Only include actions executable with connected services (Meta Ads / Google Ads / Shopify / Mailchimp as indicated in snapshot context). Email "sent" outcomes require Mailchimp. Omit disconnected-service tasks; add connect hints to progressNote when relevant.
${pacePlanPromptNotes(pace)}
${supportedChannelsPlanNotes()}
${this.contentPublishPlanNotes()}
- Include explicit reasoning in each action "why" field — reference metrics from PRIOR WEEK OUTCOMES and CHECKPOINT ANALYTICS when provided.
- Plain English. No markdown fences.
`;

    const text = await this.requestJsonText(prompt, false);
    const raw = extractJsonFromModelText(text) as {
      goalMet?: boolean;
      progressNote?: string;
      week?: PlanWeek;
    };

    return {
      goalMet: Boolean(raw.goalMet),
      progressNote: raw.progressNote,
      week: raw.week ?? null,
    };
  }

  async generateCheckupReport(input: CheckupPromptInput): Promise<CheckupDocument> {
    const prompt = this.buildCheckupPrompt(input);
    const useWebSearch = Boolean(input.marketIntel?.seed.enabled);
    try {
      return await this.requestCheckupJson(prompt, useWebSearch);
    } catch (firstErr) {
      console.warn(
        '[claude] check-up failed, retrying without web search:',
        firstErr instanceof Error ? firstErr.message : firstErr
      );
      return await this.requestCheckupJson(
        `${prompt}\n\nCRITICAL: Reply with ONLY one valid JSON object. Escape double quotes inside strings as \\". No trailing commas. No markdown fences.`,
        false
      );
    }
  }

  private async requestCheckupJson(
    prompt: string,
    useWebSearch: boolean
  ): Promise<CheckupDocument> {
    const messages: MessageParam[] = [{ role: 'user', content: prompt }];
    let lastText = '';

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const message = await this.client.messages.create({
        model: DEFAULT_MODEL,
        max_tokens: 4096,
        messages,
        tools: useWebSearch ? [WEB_SEARCH_TOOL] : undefined,
      });

      if (message.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: message.content });
        continue;
      }

      lastText = this.extractTextContent(message);

      try {
        return parseCheckupJson(lastText);
      } catch (parseErr) {
        if (turn < MAX_TURNS - 1) {
          messages.push(
            { role: 'assistant', content: message.content },
            {
              role: 'user',
              content:
                'That was not valid JSON. Reply with ONLY valid JSON for the check-up report. Escape quotes inside strings. No markdown fences, no commentary.',
            }
          );
          continue;
        }
        throw parseErr;
      }
    }

    throw new Error(
      lastText.trim() ? 'Check-up response did not contain JSON' : 'Model response did not contain JSON'
    );
  }

  private shouldUseWebSearch(
    ctx: PlanGenerationContext,
    marketIntel?: MarketIntelPromptSection | null,
    refinementNotes?: string
  ): boolean {
    if (marketIntel?.seed.enabled) return true;
    if (refinementNotes?.trim()) return true;
    return !(
      ctx.analyticsSnapshotText ||
      ctx.googleAdsSnapshotText ||
      ctx.metaAdsSnapshotText ||
      ctx.shopifySnapshotText
    );
  }

  private async requestJsonText(prompt: string, useWebSearch: boolean): Promise<string> {
    const messages: MessageParam[] = [{ role: 'user', content: prompt }];
    const tools = useWebSearch ? [WEB_SEARCH_TOOL] : undefined;
    let lastText = '';

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const message = await this.client.messages.create({
        model: DEFAULT_MODEL,
        max_tokens: MAX_TOKENS,
        messages,
        tools,
      });

      if (message.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: message.content });
        continue;
      }

      lastText = this.extractTextContent(message);
      if (extractJsonObjectString(lastText)) {
        return lastText;
      }

      if (turn < MAX_TURNS - 1) {
        messages.push(
          { role: 'assistant', content: message.content },
          {
            role: 'user',
            content: 'Reply with ONLY valid JSON. No markdown fences.',
          }
        );
      }
    }

    throw new Error(lastText.trim() ? 'Model response did not contain JSON' : 'Empty model response');
  }

  private async requestPlanJson(
    prompt: string,
    useWebSearch: boolean
  ): Promise<PlanDocument> {
    const messages: MessageParam[] = [{ role: 'user', content: prompt }];
    const tools = useWebSearch ? [WEB_SEARCH_TOOL] : undefined;
    let lastText = '';
    let lastStopReason: string | null = null;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const message = await this.client.messages.create({
        model: DEFAULT_MODEL,
        max_tokens: MAX_TOKENS,
        messages,
        tools,
      });

      lastStopReason = message.stop_reason;

      if (message.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: message.content });
        continue;
      }

      lastText = this.extractTextContent(message);

      try {
        const raw = extractJsonFromModelText(lastText);
        return normalizePlanDocument(raw);
      } catch (parseErr) {
        if (message.stop_reason === 'max_tokens') {
          messages.push(
            { role: 'assistant', content: message.content },
            {
              role: 'user',
              content:
                'Your JSON was cut off. Reply again with ONLY valid JSON. Keep "why" fields to 2 sentences max to fit.',
            }
          );
          continue;
        }

        if (turn < MAX_TURNS - 1) {
          messages.push(
            { role: 'assistant', content: message.content },
            {
              role: 'user',
              content:
                'That response was not valid plan JSON. Reply with ONLY a single JSON object matching the schema. No markdown, no explanation.',
            }
          );
          continue;
        }

        throw parseErr;
      }
    }

    const hint =
      lastStopReason === 'pause_turn'
        ? 'Plan generation timed out during web research. Try again.'
        : 'Model response did not contain JSON';
    throw new Error(
      lastText.trim()
        ? `${hint} (stop_reason=${lastStopReason ?? 'unknown'})`
        : hint
    );
  }

  private buildPlanJsonPrompt(
    request: StrategyRequest,
    ctx: PlanGenerationContext,
    marketIntel?: MarketIntelPromptSection | null,
    refinementNotes?: string,
    workerReports?: WorkerReport[],
    learningPromptSection?: string,
    pace: AutopilotPace = 'normal'
  ): string {
    let prompt = `You are a marketing operator. The user has an open-ended business goal — NOT a fixed 8-week project. Your job is to define how success is measured and plan the FIRST WEEK of work toward that goal. Hundres will run new weeks automatically until the goal is met.

USER'S GOAL: ${request.goal}
BUSINESS CONTEXT: ${request.context || 'Not provided — ask the user to fill in their Business profile (website, offer, audience).'}
BUDGET: ${request.budget || 'Not specified'}
`;

    const refine = (refinementNotes ?? request.refinementNotes)?.trim();
    if (refine) {
      prompt += `
PLAN REFINEMENT (user saw a first draft and wants these adjustments — prioritize heavily in marketIntel.emulateNotes and action "why" fields):
${refine}

Use web_search if needed to analyse named brands or competitors from the refinement. Keep the same core goal unless the refinement clearly changes it.
`;
    }

    if (marketIntel) {
      prompt += `
${marketIntel.instructions}
`;
    } else if (request.context?.includes('Website:')) {
      prompt += `
Use the business website above when you need category, positioning, or competitor context.
Prefer web_search on that domain and comparable businesses in the same niche (not generic enterprise advice).
`;
    }

    if (ctx.analyticsSnapshotText) {
      prompt += `
The user's real Google Analytics data (last 28 days) is below. Use these numbers in your reasoning and cite them in action "why" fields where relevant.

--- GOOGLE ANALYTICS DATA ---
${ctx.analyticsSnapshotText}
--- END ANALYTICS DATA ---
`;
    } else if (ctx.hasAnalytics && ctx.propertyId) {
      prompt += `
Google Analytics is connected (property ${ctx.propertyId}) but live metrics could not be loaded for this run.
Use web_search for benchmarks. Set confidence to "medium" at most.
`;
    } else {
      prompt += `
Google Analytics is not connected. Use web_search for relevant benchmarks and best practices.
Keep recommendations realistic for a small business. Mention connecting GA4 for sharper personalization later.
`;
    }

    if (ctx.googleAdsSnapshotText) {
      prompt += `
The user's real Google Ads data (last 30 days) is below. Use for paid search recommendations and budget context.

--- GOOGLE ADS DATA ---
${ctx.googleAdsSnapshotText}
--- END GOOGLE ADS DATA ---
`;
    } else if (ctx.hasGoogleAds) {
      prompt += `
Google Ads is connected but campaign metrics could not be loaded. Use web_search for paid media benchmarks.
`;
    }

    if (ctx.metaAdsSnapshotText) {
      prompt += `
The user's real Meta (Facebook/Instagram) Ads data (last 30 days) is below. Use for paid social recommendations.

--- META ADS DATA ---
${ctx.metaAdsSnapshotText}
--- END META ADS DATA ---
`;
    } else if (ctx.hasMetaAds) {
      prompt += `
Meta Ads is connected but campaign metrics could not be loaded. Use web_search for paid social benchmarks.
`;
    }

    if (ctx.shopifySnapshotText) {
      prompt += `
The user's real Shopify store data (last 30 days) is below. Use for e-commerce recommendations, merchandising, and revenue context.

When Shopify is connected, include content/SEO actions titled like "Create landing page for …" or "Write store page for …" where a page on their store helps the goal — Hundres can draft and create these pages automatically.

--- SHOPIFY DATA ---
${ctx.shopifySnapshotText}
--- END SHOPIFY DATA ---
`;
    } else if (ctx.hasShopify) {
      prompt += `
Shopify is connected but order metrics could not be loaded. Use web_search for e-commerce benchmarks.
Prefer content actions like "Create landing page for …" — Hundres can write store pages when Shopify is connected.
`;
    }

    if (workerReports?.length) {
      prompt += `
WORKER ANALYSIS (structured pre-pass from Research, Analysis, and Optimization workers — use to inform summary.confidence and week-1 action priorities):
`;
      for (const report of workerReports) {
        prompt += `
[${report.workerId.toUpperCase()}] confidence=${report.confidence}
${report.summary}
`;
        for (const finding of report.findings) {
          prompt += `- ${finding.label}: ${finding.detail}\n`;
        }
        for (const rec of report.recommendations) {
          prompt += `→ P${rec.priority} ${rec.title}: ${rec.rationale}\n`;
        }
      }
    }

    if (learningPromptSection?.trim()) {
      prompt += `\n${learningPromptSection}`;
    }

    prompt += `
OUTPUT: Respond with ONLY valid JSON (no markdown, no commentary). Schema:

{
  "marketIntel": {
    "confidence": "low" | "medium",
    "headline": "one sentence market snapshot",
    "competitors": ["directional competitor or comparable — max 4"],
    "trends": ["category trend or customer expectation — max 3"],
    "emulateNotes": ["what to borrow from emulate list — max 3"],
    "disclaimer": "Directional research from public web sources — verify before acting."
  },
  "summary": {
    "duration": "ongoing",
    "durationUnit": "until goal is met",
    "time": "~45",
    "timeUnit": "min / weekday",
    "budget": "$80",
    "budgetUnit": "total ads",
    "lift": "+25%",
    "liftUnit": "describe the primary metric",
    "goalLine": "one sentence restating their goal",
    "confidence": "high" | "medium" | "low",
    "weekCount": 1,
    "goalTarget": {
      "metric": "primary KPI e.g. online revenue",
      "baseline": "current estimate from data or reasonable guess",
      "target": "numeric target as a string e.g. \"5000\" or \"+30%\"",
      "unit": "% or £ or orders etc"
    },
    "connectionSuggestions": ["Connect Meta Ads in Integrations to run paid campaigns automatically"]
  },
  "weeks": [
    {
      "week": 1,
      "title": "week theme",
      "dates": "relative range e.g. Week 1",
      "focus": "one sentence focus",
      "actions": [
        {
          "id": "w1-a1",
          "title": "action title",
          "channel": "instagram" | "email" | "seo" | "content" | "paid" | "local",
          "day": "MON",
          "time": "20 min",
          "impact": "high" | "med" | "low",
          "difficulty": "Easy",
          "why": "2-4 sentences plain English",
          "outcome": "measurable outcome",
          "kpi": "metric to track"
        }
      ]
    }
  ]
}

Rules:
- Include marketIntel when market intel instructions were provided above; omit marketIntel key entirely if no web research was requested.
- marketIntel.confidence is always "low" or "medium" — separate from summary.confidence (first-party data).
- Output ONLY week 1 in the weeks array — future weeks are generated later based on progress toward goalTarget.
- goalTarget is required — define the measurable success condition.
- summary.weekCount must be 1 for the initial plan.
- Schedule week 1 actions per PACE MODE below; unique ids (w1-a{M}).
- Plain English, no jargon.
- All JSON string values must be plain text only — no HTML, markdown, or web-search citation tags (never use cite/index markup).
- Tailor everything to the user's goal and context.
- INTEGRATION AVAILABILITY (critical): Only schedule actions Hundres can execute with currently connected services.
  * Meta Ads campaign actions ONLY if Meta Ads is connected above.
  * Google Ads campaign actions ONLY if Google Ads is connected above.
  * Shopify page/blog/SEO write actions ONLY if Shopify is connected above.
  * Email send / mailing-list / win-back sequence actions that claim "sent" or "published" ONLY if Mailchimp is connected above. Without Mailchimp, email actions are copy-only assist deliverables — never claim emails were sent or published.
  * If a high-value action needs a disconnected integration, do NOT include it as a task — omit it and mention "Connect [service] in Integrations" in summary.connectionSuggestions array (string messages).
  * Content, SEO guides, and local outreach are always allowed as assist deliverables without integrations. Email copy-only is allowed without Mailchimp; do not phrase outcomes as "Email sequence created and sent".
${pacePlanPromptNotes(pace)}
${supportedChannelsPlanNotes()}
${this.contentPublishPlanNotes()}
- summary.confidence: "high" only if you used real analytics and/or ads numbers above; "medium" if partial; "low" for generic-only plans.
- Do not use markdown code fences. Start your reply with { and end with }.
`;

    return prompt;
  }

  private buildCheckupPrompt(input: CheckupPromptInput): string {
    const ctx = input.generationContext;
    let prompt = `You are a marketing advisor. Produce a concise MARKETING CHECK-UP report (not an 8-week plan).

BUSINESS CONTEXT: ${input.businessContext || 'Not provided — note that filling Business profile would improve this report.'}

DATA COVERAGE (integration status for this workspace):
${JSON.stringify(input.dataCoverage, null, 2)}
`;

    if (input.marketIntel) {
      prompt += `
${input.marketIntel.instructions}
Include 1–2 bullets in whatsMissing or topPriorities when market context would help, labeled as directional research.
`;
    }

    if (ctx.analyticsSnapshotText) {
      prompt += `
--- GOOGLE ANALYTICS (last 28 days) ---
${ctx.analyticsSnapshotText}
--- END ---
`;
    }
    if (ctx.googleAdsSnapshotText) {
      prompt += `
--- GOOGLE ADS (last 30 days) ---
${ctx.googleAdsSnapshotText}
--- END ---
`;
    }
    if (ctx.metaAdsSnapshotText) {
      prompt += `
--- META ADS (last 30 days) ---
${ctx.metaAdsSnapshotText}
--- END ---
`;
    }
    if (ctx.shopifySnapshotText) {
      prompt += `
--- SHOPIFY (last 30 days) ---
${ctx.shopifySnapshotText}
--- END ---
`;
    }

    prompt += `
TASK: Summarize what's working, what's weak, and what's missing — even if numbers are low or zero. Recommend the top 3 priorities before any big campaigns.

OUTPUT: Respond with ONLY valid JSON (no markdown). Schema:

{
  "headline": "one compelling sentence",
  "overallHealth": "good" | "fair" | "weak" | "unknown",
  "confidence": "high" | "medium" | "low",
  "liveMetrics": [
    { "source": "google_analytics" | "google_ads" | "meta_ads" | "shopify" | "general", "label": "metric name", "value": "formatted value" }
  ],
  "dataCoverage": [
    { "source": "google_analytics" | "google_ads" | "meta_ads" | "shopify", "connected": true, "loaded": true, "note": null }
  ],
  "whatsWorking": ["bullet", "..."],
  "whatsWeak": ["bullet", "..."],
  "whatsMissing": ["bullet", "..."],
  "topPriorities": [
    { "title": "priority title", "why": "1-3 sentences with real numbers when available", "impact": "high" | "med" | "low" }
  ],
  "summary": "2-4 sentence executive summary"
}

Rules:
- Include 3–8 liveMetrics from actual snapshot numbers when data loaded; use "0" or "n/a" honestly when zero.
- liveMetrics "value" fields must be plain strings (e.g. "1,234 sessions") — never bare numbers with commas.
- Copy dataCoverage from the integration status above (connected/loaded/note).
- Exactly 3 topPriorities unless fewer make sense.
- Plain English for a non-marketer.
- confidence "high" only if first-party metrics were used; "low" if no live data.
- All JSON string values: plain text only, escape internal double quotes as \\", no HTML or cite tags.
- No trailing commas. Start with { and end with }.
`;

    return prompt;
  }

  private extractTextContent(message: Anthropic.Message): string {
    const parts: string[] = [];

    for (const block of message.content) {
      if (block.type === 'text') {
        parts.push(block.text);
      }
    }

    if (parts.length === 0) {
      throw new Error('Claude returned no text content');
    }

    return sanitizeModelStrings(parts.join('\n\n'));
  }

  async generateActionAssist(input: {
    action: PlanAction;
    goal: string;
    businessContext?: string | null;
  }): Promise<AssistDeliverable> {
    const a = input.action;

    const channelGuide: Record<string, string> = {
      instagram: 'Write an Instagram caption with hook, body, CTA, and 5-10 hashtags in extras.hashtags.',
      email: 'Write subject line in extras.subject and email body in primaryCopy.',
      seo: 'Write SEO title in extras.seoTitle, meta description in extras.seoDescription, and target keyword in extras.keyword.',
      content: 'Write publish-ready content (blog intro, outline, or page copy) in primaryCopy.',
      paid: 'Write ad primary text, headline in extras.headline, and CTA in extras.cta. Do NOT change budgets or publish ads.',
      local: 'Write Google Business Profile post or local outreach copy in primaryCopy.',
    };

    const blob = `${a.title} ${a.outcome} ${a.kpi} ${a.why}`.toLowerCase();
    const analyticsSetup =
      /google analytics|ga4|event tracking|tag manager|gtm|conversion tracking|pixel/.test(blob);
    const metaCampaign =
      /meta\b|facebook ads|instagram ads|instagram \+ facebook|paid social/.test(blob) &&
      /campaign|budget|targeting|ad set|spend/.test(blob);
    const channelHint = analyticsSetup
      ? 'This is an analytics/tag setup task — write a step-by-step GA4/GTM setup guide in primaryCopy with events to create, and pasteInstructions pointing to analytics.google.com or tagmanager.google.com. Do NOT write Shopify page copy.'
      : metaCampaign
        ? 'This is a Meta (Facebook/Instagram) Ads campaign setup — NOT a Shopify page. In primaryCopy write: campaign objective, daily budget, 7-day total, audience (geo, age, interests), 2-3 ad primary texts, headlines, and CTA. In extras put budget, targeting, and landingUrl (use homepage URL — do NOT write full page HTML). In steps list how to create the campaign in Meta Ads Manager. pasteInstructions must say Meta Ads Manager → Create campaign. Do NOT write a store page or blog post.'
        : (channelGuide[a.channel] ?? 'Write the most useful ready-to-paste deliverable.');

    const prompt = `You prepare marketing deliverables for a non-expert founder. Output ONLY valid JSON.

GOAL: ${input.goal}
BUSINESS: ${input.businessContext || 'Not provided'}

PLAN ACTION:
- Title: ${a.title}
- Channel: ${a.channel}
- Why: ${a.why}
- Outcome: ${a.outcome}
- KPI: ${a.kpi}

Channel guidance: ${channelHint}

Schema:
{
  "headline": "one line summary of what you prepared",
  "primaryCopy": "main text they copy-paste",
  "steps": ["numbered micro-steps to finish manually in the platform, max 5"],
  "extras": { "optional keyed strings e.g. subject, hashtags, seoTitle" },
  "pasteInstructions": "where to paste this (e.g. Shopify Admin → Products → SEO)",
  "reasoning": "2-3 sentences: why this approach fits the goal, action outcome, and channel — cite the plan's why if relevant"
}

Rules: Plain text only. Be specific to the action. All extras values must be plain strings (never numbers or arrays). No markdown fences. Start with {`;

    const message = await this.client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = this.extractTextContent(message);
    return parseAssistJson(text);
  }

  async generateInstagramAssist(input: {
    action: PlanAction;
    goal: string;
    businessContext?: string | null;
    image?: {
      url: string;
      alt: string;
      source: 'shopify' | 'unsplash' | 'canva' | 'runway' | 'library';
      attribution?: string;
      rationale: string;
    } | null;
    images?: Array<{
      url: string;
      alt: string;
      source: 'shopify' | 'unsplash' | 'canva' | 'runway' | 'library';
      attribution?: string;
      rationale: string;
    }>;
    userInstructions?: string | null;
    ctaText?: string | null;
    mediaKind?: 'feed' | 'carousel' | 'story';
  }): Promise<AssistDeliverable> {
    const a = input.action;
    const imageList = input.images?.length
      ? input.images
      : input.image
        ? [input.image]
        : [];

    const imageBlock =
      imageList.length > 0
        ? `
IMAGES FOR THIS POST (${imageList.length > 1 ? 'carousel — caption covers all slides' : 'single photo'}):
${imageList
  .map(
    (img, i) =>
      `- Slide ${i + 1}: ${img.alt} (${img.source})${img.attribution ? ` · ${img.attribution}` : ''}`
  )
  .join('\n')}

Write a caption whose hook and body match these images and the user's topic. Do not mention unrelated products.`
        : `
No image was auto-selected — write a caption and note in steps that the user should attach their own product photo.`;

    const instructionsBlock = input.userInstructions?.trim()
      ? `
USER'S EXACT INSTRUCTIONS (follow precisely — do not ignore):
${input.userInstructions.trim()}`
      : '';

    const ctaBlock = input.ctaText?.trim()
      ? `
REQUIRED CTA: The caption MUST end with a clear call-to-action mentioning "${input.ctaText.trim()}" (product name, shop link prompt, or "shop Cream of Dreams" style line). Put the CTA in primaryCopy, not only in extras.`
      : '';

    const storyBlock =
      input.mediaKind === 'story'
        ? `
This is an Instagram STORY (not a feed post). Stories disappear after 24 hours and cannot have feed captions via API.
In primaryCopy write a short on-image text suggestion (1–2 lines) the user can add as a sticker in Instagram.
In pasteInstructions explain: Instagram → Create story → use the proposed image → add text sticker with the suggested copy.`
        : '';

    const prompt = `You prepare Instagram post deliverables for a non-expert founder. Output ONLY valid JSON.

GOAL: ${input.goal}
BUSINESS: ${input.businessContext || 'Not provided'}

PLAN ACTION:
- Title: ${a.title}
- Channel: instagram
- Why: ${a.why}
- Outcome: ${a.outcome}
- KPI: ${a.kpi}
${instructionsBlock}
${ctaBlock}
${storyBlock}
${imageBlock}

Channel guidance: Write an Instagram caption with hook, body, strong CTA line, and 5-10 hashtags in extras.hashtags. Be specific to the business offer and audience — never generic filler.

Schema:
{
  "headline": "one line summary of what you prepared",
  "primaryCopy": "Instagram caption they copy-paste — MUST include required CTA if specified",
  "steps": ["numbered micro-steps to finish manually in Instagram, max 5"],
  "extras": { "hashtags": "space-separated hashtags", "cta": "the CTA line used" },
  "pasteInstructions": "Instagram or Meta Business Suite → Create post → attach the proposed image(s) → paste caption",
  "reasoning": "2-3 sentences: why this caption and image approach fits the brand and action"
}

Rules: Plain text only. All extras values must be plain strings. No markdown fences. Do NOT include image URL fields in JSON — those are added separately. Start with {`;

    const message = await this.client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = this.extractTextContent(message);
    const deliverable = parseAssistJson(text);

    if (input.image) {
      return {
        ...deliverable,
        proposedImageUrl: input.image.url,
        imageSource: input.image.source,
        imageAlt: input.image.alt,
        imageAttribution: input.image.attribution,
        imageRationale: input.image.rationale,
      };
    }

    if (imageList.length > 0) {
      const first = imageList[0];
      return {
        ...deliverable,
        proposedImageUrl: first.url,
        imageSource: first.source,
        imageAlt: first.alt,
        imageAttribution: first.attribution,
        imageRationale: first.rationale,
      };
    }

    return deliverable;
  }

  async generateAdvertPlanAssist(input: {
    action: PlanAction;
    goal: string;
    businessContext?: string | null;
    websiteUrl?: string | null;
  }): Promise<AssistDeliverable> {
    const a = input.action;
    const blob = `${a.title} ${a.outcome} ${a.kpi} ${a.why}`.toLowerCase();
    const isMeta =
      /meta\b|facebook ads|instagram ads|instagram \+ facebook|paid social/.test(blob);
    const platform = isMeta ? 'Meta (Facebook + Instagram)' : 'Google Ads or Meta — see platform extra';

    const prompt = `You build a complete paid advertising plan for a non-expert founder. Output ONLY valid JSON.

GOAL: ${input.goal}
BUSINESS: ${input.businessContext || 'Not provided'}
WEBSITE: ${input.websiteUrl || 'Use business website if known'}

PLAN ACTION:
- Title: ${a.title}
- Channel: ${a.channel}
- Why: ${a.why}
- Outcome: ${a.outcome}
- KPI: ${a.kpi}

This is an ADVERT PLAN — a structured campaign brief they follow in Ads Manager. NOT a Shopify page, blog post, or generic copy block.

Schema:
{
  "headline": "Advert plan title e.g. Meta test campaign — £35 / 7 days",
  "primaryCopy": "2-3 short paragraphs: campaign objective, messaging angle, and what success looks like for this action",
  "steps": ["Launch step 1 in Ads Manager", "step 2", "step 3", "step 4", "step 5"],
  "extras": {
    "platform": "${platform}",
    "objective": "e.g. Traffic or Sales",
    "dailyBudget": "exact amount from action e.g. £4.30–5.70",
    "totalBudget": "exact total e.g. £30–40",
    "duration": "e.g. 7 days",
    "audience": "geo, age, interests — match the action outcome exactly",
    "placements": "e.g. Facebook Feed, Instagram Feed, Stories",
    "adPrimaryText1": "full primary text for ad variant 1",
    "adPrimaryText2": "full primary text for ad variant 2",
    "headline": "ad headline",
    "cta": "e.g. Shop Now",
    "landingUrl": "${input.websiteUrl || 'homepage URL'}"
  },
  "pasteInstructions": "Open Meta Ads Manager (adsmanager.facebook.com) or Google Ads — create campaign using this plan",
  "reasoning": "2-3 sentences: why this budget, audience, and messaging fit the plan action"
}

Rules:
- Use exact budget and targeting numbers from the action outcome where provided.
- extras values must ALL be plain strings (never numbers or arrays).
- adPrimaryText1 and adPrimaryText2 must be ready to paste into Ads Manager.
- steps are ordered launch checklist (max 6).
- No Shopify page HTML. No markdown fences. Start with {`;

    const message = await this.client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = this.extractTextContent(message);
    return parseAssistJson(text);
  }

  async generateShopifyBlogAssist(input: {
    action: PlanAction;
    goal: string;
    businessContext?: string | null;
  }): Promise<AssistDeliverable> {
    const a = input.action;
    const blob = `${a.title} ${a.outcome} ${a.kpi}`.toLowerCase();
    const singlePost =
      /one blog|single blog|one published blog|one article|publish one blog|1 blog post|one high-intent blog/.test(
        blob
      );

    const prompt = singlePost
      ? `You write a complete Shopify blog article for a DTC brand. Output ONLY valid JSON.

GOAL: ${input.goal}
BUSINESS: ${input.businessContext || 'Not provided'}

PLAN ACTION:
- Title: ${a.title}
- Channel: ${a.channel}
- Why: ${a.why}
- Outcome: ${a.outcome}
- KPI: ${a.kpi}

Write the FULL blog post (600–1,000 words) in primaryCopy — intro, H2 sections, conclusion, internal link suggestions to homepage and product pages.

Schema:
{
  "headline": "working title for the blog post",
  "primaryCopy": "full article text ready to paste into Shopify blog editor",
  "steps": ["how to publish in Shopify Admin → Online Store → Blog posts", "max 5 steps"],
  "extras": { "seoTitle": "...", "seoDescription": "...", "targetKeyword": "...", "suggestedUrlSlug": "..." },
  "pasteInstructions": "Shopify Admin → Online Store → Blog posts → Add blog post",
  "reasoning": "2-3 sentences on why this article angle fits the goal"
}

Rules: Plain text in primaryCopy. All extras values must be plain strings (never numbers or arrays). Start with {`
      : `You prepare Shopify blog content calendars for a DTC brand. Output ONLY valid JSON.

GOAL: ${input.goal}
BUSINESS: ${input.businessContext || 'Not provided'}

PLAN ACTION:
- Title: ${a.title}
- Channel: ${a.channel}
- Why: ${a.why}
- Outcome: ${a.outcome}
- KPI: ${a.kpi}

Write the FULL content calendar in primaryCopy — include every week/post with:
- Week number and publish day (e.g. Monday)
- Working title
- Target keyword
- 2-3 bullet outline (H2 topics)
- Brief angle (1 sentence)

If the action already specifies weeks/topics/keywords, preserve them exactly. Otherwise infer a sensible series from the action.

Schema:
{
  "headline": "one line summary",
  "primaryCopy": "full calendar text — all weeks, keywords, publish schedule, word count targets (1200-1500), internal link notes, FAQ requirement",
  "steps": ["how to publish in Shopify Admin or via Claude.ai + Shopify MCP", "max 5 steps"],
  "extras": { "week1Title": "...", "week1Keyword": "...", "blogName": "News or Journal" },
  "pasteInstructions": "Use the Claude.ai + Shopify MCP prompt (shown below in Hundres) to create each post as a draft",
  "reasoning": "2-3 sentences on why this calendar structure fits the goal and audience"
}

Rules: Plain text in primaryCopy (no markdown fences). All extras values must be plain strings (never numbers or arrays). Be specific to the brand. Start with {`;

    const message = await this.client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: singlePost ? 8192 : 8192,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = this.extractTextContent(message);
    return parseAssistJson(text);
  }

  async generateShopifyPage(input: {
    action: PlanAction;
    goal: string;
    businessContext?: string | null;
  }): Promise<ShopifyPageState> {
    const a = input.action;

    const prompt = `You write Shopify Online Store pages for a small business owner. Output ONLY valid JSON.

GOAL: ${input.goal}
BUSINESS: ${input.businessContext || 'Not provided'}

PLAN ACTION:
- Title: ${a.title}
- Channel: ${a.channel}
- Why: ${a.why}
- Outcome: ${a.outcome}
- KPI: ${a.kpi}

Write a complete store page that helps achieve the outcome. Plain text only inside JSON — no raw HTML in strings.

Schema:
{
  "title": "page title shown in Shopify admin and theme",
  "handle": "url-slug-lowercase-hyphens",
  "sections": [
    { "heading": "optional section heading", "paragraphs": ["paragraph one", "paragraph two"] }
  ],
  "seoTitle": "SEO title max 70 chars",
  "seoDescription": "meta description max 160 chars",
  "reasoning": "2-3 sentences: why this page structure and angle support the action outcome and business goal"
}

Rules:
- 3-6 sections, 400-900 words total across paragraphs.
- Specific to this business and action. handle must be URL-safe (a-z, 0-9, hyphens).
- Escape double quotes inside strings as \\". No trailing commas. No markdown fences. Start with {`;

    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      const message = await this.client.messages.create({
        model: DEFAULT_MODEL,
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content:
              attempt === 0
                ? prompt
                : `${prompt}\n\nCRITICAL: Your last reply was not valid JSON. Reply with ONLY one JSON object using the sections schema above. Plain text in paragraphs — no HTML tags.`,
          },
        ],
      });

      const text = this.extractTextContent(message);
      try {
        return parseShopifyPageJson(text);
      } catch (err) {
        lastErr = err;
        console.warn(
          '[claude] shopify page JSON parse failed:',
          err instanceof Error ? err.message : err
        );
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error('Failed to generate Shopify page JSON');
  }

  async generateShopifyBlogArticle(input: {
    action: PlanAction;
    goal: string;
    businessContext?: string | null;
  }): Promise<ShopifyBlogArticleState> {
    const a = input.action;

    const prompt = `You write a complete Shopify blog article for a DTC brand. Output ONLY valid JSON.

GOAL: ${input.goal}
BUSINESS: ${input.businessContext || 'Not provided'}

PLAN ACTION:
- Title: ${a.title}
- Channel: ${a.channel}
- Why: ${a.why}
- Outcome: ${a.outcome}
- KPI: ${a.kpi}

Write a complete article (600–900 words) as section paragraphs. Plain text only inside JSON — no raw HTML in strings.

Schema:
{
  "title": "article title",
  "handle": "url-slug-lowercase-hyphens",
  "sections": [
    { "heading": "optional H2", "paragraphs": ["paragraph one", "paragraph two"] }
  ],
  "seoTitle": "SEO title max 70 chars",
  "seoDescription": "meta description max 160 chars",
  "summaryHtml": "one sentence excerpt for blog listing",
  "tags": ["tag-one", "tag-two"],
  "reasoning": "2-3 sentences: why this article angle fits the goal and action"
}

Rules:
- 4–8 sections, 600–900 words total across paragraphs.
- Specific to this business and action. handle must be URL-safe (a-z, 0-9, hyphens).
- tags: 2–5 relevant strings.
- Escape double quotes inside strings as \\". No trailing commas. No markdown fences. Start with {`;

    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      const message = await this.client.messages.create({
        model: DEFAULT_MODEL,
        max_tokens: 8192,
        messages: [
          {
            role: 'user',
            content:
              attempt === 0
                ? prompt
                : `${prompt}\n\nYour previous reply was invalid JSON. Output ONLY valid JSON.`,
          },
        ],
      });

      const text = this.extractTextContent(message);
      try {
        return parseShopifyBlogJson(text);
      } catch (err) {
        lastErr = err;
        console.warn(
          '[claude] shopify blog JSON parse failed:',
          err instanceof Error ? err.message : err
        );
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error('Failed to generate Shopify blog JSON');
  }

  async parseAgentTask(input: {
    message: string;
    goal: string;
    brandProfile?: string | null;
    businessContext?: string | null;
    connectedPlatforms: string[];
    mcpCapabilities?: string;
    learningKnowledge?: string;
    contentRecipes?: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  }): Promise<ParsedAgentTask & { actionId: string }> {
    const connected =
      input.connectedPlatforms.length > 0
        ? input.connectedPlatforms.join(', ')
        : 'none connected yet';

    const historyBlock =
      input.history && input.history.length > 0
        ? `\nCONVERSATION SO FAR (oldest first):\n${input.history
            .map((m) => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.content}`)
            .join('\n')}\n`
        : '';

    const brandBlock = (input.brandProfile || input.businessContext || 'Not provided').trim();
    const mcpBlock = (input.mcpCapabilities || 'No MCP capability notes.').trim();
    const knowledgeBlock = input.learningKnowledge?.trim()
      ? `\nWORKSPACE LEARNING (past outcomes — prefer what worked):\n${input.learningKnowledge.trim()}\n`
      : '';
    const recipesBlock = input.contentRecipes?.trim()
      ? `\nSAVED CONTENT RECIPES (reference by recipeSlug — user can say "use recipe <slug>" or the recipe name):\n${input.contentRecipes.trim()}\n`
      : '';

    const prompt = `You are Hundres, a brand-aware marketing agent for this workspace. Output ONLY valid JSON.

GOAL: ${input.goal}

BRAND PROFILE (use product names, audience, and tone from here — do not ask which product if it is already clear from brand + conversation):
${brandBlock}

CONNECTED INTEGRATIONS: ${connected}

MCP CAPABILITIES (what you can actually automate now):
${mcpBlock}
${knowledgeBlock}${recipesBlock}${historyBlock}
LATEST USER MESSAGE:
"${input.message}"

## Continuity (critical)
- Short follow-ups like "Cream of Dreams — clean lifestyle" CONTINUE the prior request in CONVERSATION SO FAR.
- Merge history + latest message into one full creative brief. Do NOT ask again for platform/format already stated (e.g. Instagram story, Runway video).
- If the prior turn asked a clarifying question and the user answered, set supported:true and EXECUTE — do not re-clarify unless a critical detail is still missing.
- Prefer brand products from BRAND PROFILE / offer when the user names a product (e.g. Cream of Dreams).

## Sentiment (knowledge)
Analyze sentiment: positive | neutral | negative | frustrated | curious | urgent.
- positive/curious: warm, concise confirm + run.
- frustrated/urgent: apologize briefly, skip optional questions, execute ASAP with best defaults.
- negative: acknowledge concern, offer the smallest next step.
Always include "sentiment" in the JSON.

## When to clarify vs execute
- Clear enough with history → supported:true, needsClarification:false, include action + executionBrief, then backend runs immediately.
- NEVER reply "Got it, I'll create…" without supported:true and a full action block — if you confirm, you must execute.
- Truly missing critical info (and not in brand/history) → supported:false, needsClarification:true, ask 1 specific question max — do not promise execution in the reply.
- Off-topic (TikTok, email send, draft a full plan) → supported:false, needsClarification:false, unsupportedReason.

## Supported tasks (when integrations allow)
- Instagram feed photo/carousel — channel "instagram"
- Instagram feed AI image via Runway text-to-image (lowest credit ~5) — mediaFormat "feed", recipeSlug "runway-text-to-image" (or omit slug to auto-rotate lifestyle still examples: morning-routine, post-gym, hands-macro, flat-lay, bag-commute, window-light, steam-fresh, shelf-candid, outdoor-day, texture-editorial — slugs runway-ig-still-*)
- Instagram REEL / UGC / any AI or Runway video to Instagram — title MUST mention "reel", "video", or "UGC"; mediaFormat "reel", videoSource "runway", recipeSlug "runway-product-ugc" for UGC
  - UGC Instagram requests: ALWAYS supported:true, needsClarification:false — execute immediately using brand profile + Shopify product photo; missing creator photo falls back to Runway product_ad (do NOT ask the user to film)
- Instagram STORY (image OR AI/video) — title MUST mention "story" or "stories"; mediaFormat "story"
- AI video via Runway for Reel (default when user says video + Instagram): mediaFormat "reel", videoSource "runway", duration preference lowest credit (5s)
- AI still via Runway when user asks for text-to-image / AI photo / AI image (not video): mediaFormat "feed", recipeSlug "runway-text-to-image"
- AI video via Runway for Story only when user says story: mediaFormat "story", videoSource "runway"
- Saved custom recipes from Business → Content recipes — when user names a recipe or says "use recipe <slug>", set recipeSlug to that exact slug
- Canva creatives → Instagram stills when Canva connected
- Shopify blog / page / product SEO
- Meta or Google paid campaigns only if user explicitly asks for ads/budget

When supported:true, ALWAYS include executionBrief:
- fullRequest: one paragraph merging conversation + brand (product, vibe, platform, format)
- ctaText: product name (e.g. "Cream of Dreams")
- imageSearchQuery: vibe keywords (e.g. "clean lifestyle")
- mediaFormat: "story" | "reel" | "feed" | "carousel"
- videoSource: "runway" when generating AI video; omit if still image only
- recipeSlug: preferred — official (runway-product-ugc | runway-product-ad | runway-product-campaign-image | runway-text-to-video | runway-text-to-image) OR any saved custom slug from SAVED CONTENT RECIPES
- productImageUrl / characterImageUrl: HTTPS image URLs when user supplies them (UGC needs both). Prefer BRAND VISUAL LIBRARY URLs when available.
- imageSource: canva | unsplash | shopify | library when relevant for stills
- When BRAND VISUAL LIBRARY has matching themes, set productImageUrl to that library HTTPS URL and mirror the theme in imageSearchQuery / fullRequest.

Schema:
{
  "reply": "short friendly confirmation that uses the brand/product name",
  "supported": true,
  "needsClarification": false,
  "sentiment": "positive",
  "executionBrief": {
    "fullRequest": "Generate realistic 9:16 lifestyle video of Cream of Dreams, clean lifestyle moments, publish to Instagram Story via Runway",
    "ctaText": "Cream of Dreams",
    "imageSearchQuery": "clean lifestyle",
    "mediaFormat": "story",
    "videoSource": "runway"
  },
  "action": {
    "id": "placeholder",
    "title": "Instagram story: Cream of Dreams lifestyle AI video",
    "channel": "instagram",
    "day": "NOW",
    "time": "5 min",
    "impact": "high",
    "difficulty": "Easy",
    "why": "Show Cream of Dreams in clean lifestyle moments on Stories",
    "outcome": "AI video story published featuring Cream of Dreams",
    "kpi": "story views and replies"
  }
}

Rules:
- impact must be exactly "high", "med", or "low" (not "medium").
- Use brand language; never invent a different brand.
- If Runway + Instagram are connected and user wants AI video (or "lowest credit" Runway) on Instagram, EXECUTE with videoSource "runway" and mediaFormat "reel" (unless they explicitly said Story).
- If user asks for a saved recipe that is image medium, use mediaFormat "feed" (or carousel) and omit videoSource.
- Never map a Runway/video request to a static feed photo unless the recipe is explicitly image/still.
- Escape double quotes. No markdown fences. Start with {`;

    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      const message = await this.client.messages.create({
        model: DEFAULT_MODEL,
        max_tokens: 2048,
        messages: [
          {
            role: 'user',
            content:
              attempt === 0
                ? prompt
                : `${prompt}\n\nYour previous reply was invalid JSON. Output ONLY valid JSON matching the schema. impact must be high|med|low.`,
          },
        ],
      });

      const text = this.extractTextContent(message);
      try {
        const parsed = parseAgentTaskJson(text);
        const actionId = `adhoc-${randomUUID()}`;
        if (parsed.supported && parsed.action) {
          return {
            ...parsed,
            action: { ...parsed.action, id: actionId },
            actionId,
          };
        }
        return { ...parsed, actionId };
      } catch (err) {
        lastErr = err;
        console.warn(
          '[claude] agent task JSON parse failed:',
          err instanceof Error ? err.message : err
        );
      }
    }

    // Soft fallback — never surface cryptic Zod errors to the chat UI
    console.error('[claude] agent task exhausted retries:', lastErr);
    return {
      reply:
        'I understood you, but had trouble structuring the task. Reply with one line like: “Instagram story, Cream of Dreams, clean lifestyle, Runway video” and I’ll run it.',
      supported: false,
      needsClarification: true,
      sentiment: 'neutral',
      actionId: `adhoc-${randomUUID()}`,
    };
  }

  private contentPublishPlanNotes(): string {
    const lines: string[] = [
      '  * AGENTIC EXECUTION: The agent creates all visuals and copy — never assign manual filming, shooting, or "post yourself" steps except paused paid ads awaiting approval.',
      '  * Action titles: use "Create and publish" (feed/carousel) or "Generate Runway Reel and publish" (video) — never "Film + publish".',
      '  * ONLY channel "paid" (Meta/Google ads) requires human approval before spend goes live — phrase as "Create paused campaign for review".',
      '  * CRITICAL: Multiple Meta campaigns are fine AFTER prior ones have spend/performance data. Do NOT schedule new Meta campaigns while existing ones show $0 spend — feed performance into the next decision instead. Prefer organic / content until spend is enabled on an existing campaign.',
    ];
    if (isInstagramAutoPublishEnabled()) {
      lines.push(
        '  * Instagram feed posts, carousels, and image stories are AUTO-PUBLISHED — agent picks/creates images (Canva, Shopify, Runway campaign stills) and publishes.'
      );
      lines.push(
        '  * When Canva and Instagram are both connected, plans may chain Canva design export → Instagram publish for on-brand creatives.'
      );
      lines.push(
        '  * When Runway and Instagram are both connected, the agent generates AI Reels (Runway recipes: product_ad, product_ugc, text_to_video) and publishes automatically.'
      );
    }
    if (isShopifyAutoPublishLiveEnabled()) {
      lines.push(
        '  * Shopify pages and single blog articles are AUTO-PUBLISHED live when Shopify is connected — phrase outcomes as "live page" or "published article", not "draft for review".'
      );
    }
    return lines.length ? `\n- AUTO-PUBLISH (active):\n${lines.join('\n')}` : '';
  }

  async generateGoogleAdsCampaign(input: {
    action: PlanAction;
    goal: string;
    businessContext?: string | null;
    websiteUrl?: string | null;
    adsSnapshotText?: string | null;
  }): Promise<GoogleAdsCampaignState> {
    const a = input.action;
    const defaultUrl = input.websiteUrl?.trim() || 'https://example.com';

    const prompt = `You design Google Search campaigns for a small business owner. Output ONLY valid JSON.

GOAL: ${input.goal}
BUSINESS: ${input.businessContext || 'Not provided'}
DEFAULT LANDING URL: ${defaultUrl}

PLAN ACTION:
- Title: ${a.title}
- Channel: ${a.channel}
- Why: ${a.why}
- Outcome: ${a.outcome}
- KPI: ${a.kpi}

${input.adsSnapshotText ? `EXISTING GOOGLE ADS DATA (last 30 days):\n${input.adsSnapshotText}\n` : ''}

Design one Search campaign with 1-2 ad groups. Conservative daily budget ($5-$50 USD) unless action clearly implies higher spend.

Schema:
{
  "campaignName": "clear campaign name",
  "dailyBudgetUsd": 15,
  "adGroups": [
    {
      "name": "ad group name",
      "keywords": [{ "text": "keyword phrase", "matchType": "PHRASE" }],
      "headlines": ["headline 1", "headline 2", "headline 3"],
      "descriptions": ["description 1", "description 2"],
      "finalUrl": "${defaultUrl}"
    }
  ],
  "reasoning": "2-3 sentences: why this structure, budget, and keywords fit the action outcome"
}

Rules:
- 5-12 keywords per ad group; mix PHRASE and EXACT; at least 3 headlines (max 30 chars each), 2 descriptions (max 90 chars).
- finalUrl must be a valid https URL (use DEFAULT LANDING URL unless action specifies another page).
- dailyBudgetUsd must be a number, not a string. No trailing commas. Start with {`;

    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      const message = await this.client.messages.create({
        model: DEFAULT_MODEL,
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content:
              attempt === 0
                ? prompt
                : `${prompt}\n\nCRITICAL: Your last reply was not valid JSON. Reply with ONLY one JSON object matching the schema above.`,
          },
        ],
      });

      const text = this.extractTextContent(message);
      try {
        return parseGoogleAdsCampaignJson(text);
      } catch (err) {
        lastErr = err;
        console.warn(
          '[claude] google ads campaign JSON parse failed:',
          err instanceof Error ? err.message : err
        );
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error('Failed to generate Google Ads campaign JSON');
  }

  async generateMetaAdsCampaign(input: {
    action: PlanAction;
    goal: string;
    businessContext?: string | null;
    websiteUrl?: string | null;
    metaSnapshotText?: string | null;
    /** Prior campaign performance + library — agent must learn from this */
    performanceContext?: string | null;
  }): Promise<MetaAdsCampaignState> {
    const a = input.action;
    const defaultUrl = input.websiteUrl?.trim() || 'https://example.com';

    const prompt = `You design Meta (Facebook/Instagram) ad campaigns for a small business owner. Output ONLY valid JSON.

GOAL: ${input.goal}
BUSINESS: ${input.businessContext || 'Not provided'}
DEFAULT LANDING URL: ${defaultUrl}

PLAN ACTION:
- Title: ${a.title}
- Channel: ${a.channel}
- Why: ${a.why}
- Outcome: ${a.outcome}
- KPI: ${a.kpi}

${input.metaSnapshotText ? `EXISTING META ADS DATA (last 30 days):\n${input.metaSnapshotText}\n` : ''}
${input.performanceContext ? `${input.performanceContext}\n` : ''}

Design one paused Meta campaign with 1-2 ad variants. Use exact budget and targeting from the action outcome (e.g. £4.30/day, UK 25-45).

If prior campaigns have spend/clicks/purchases above, LEARN from them:
- Reuse or refine angles that worked (WORKING / TRAFFIC).
- Do not blindly clone weak spend campaigns.
- Call out in "reasoning" which prior result informed this draft.
If prior campaigns show $0 spend, you should not be inventing a stack of new tests — focus on one clear offer.

Hundres will AUTOMATICALLY generate creative images for each ad (brand visual library, Canva, or Runway) — you write copy only. Do not invent image URLs.

Schema:
{
  "campaignName": "clear campaign name",
  "dailyBudget": 4.5,
  "currencyCode": "GBP",
  "objective": "OUTCOME_TRAFFIC",
  "durationDays": 7,
  "targeting": {
    "countries": ["GB"],
    "ageMin": 25,
    "ageMax": 45,
    "interestNotes": "fitness, wellness, healthy lifestyle"
  },
  "ads": [
    {
      "name": "Ad variant 1",
      "primaryText": "full primary text for Meta ad",
      "headline": "headline max 40 chars",
      "description": "optional link description",
      "cta": "SHOP_NOW",
      "finalUrl": "${defaultUrl}",
      "imageBrief": "short visual direction for the AI image generator (product, setting, mood)"
    }
  ],
  "reasoning": "2-3 sentences: why this budget, audience, and copy fit the action — cite prior Meta performance when available"
}

Rules:
- dailyBudget is a number in major currency units (e.g. 4.5 for £4.50).
- Use GBP if action mentions £, USD for $.
- cta must be SHOP_NOW, LEARN_MORE, SIGN_UP, or ORDER_NOW.
- 1-2 ads in ads array with distinct copy angles.
- imageBrief should describe what to SHOW (no text overlays in the image).
- No trailing commas. Start with {`;

    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      const message = await this.client.messages.create({
        model: DEFAULT_MODEL,
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content:
              attempt === 0
                ? prompt
                : `${prompt}\n\nCRITICAL: Your last reply was not valid JSON. Reply with ONLY one JSON object matching the schema above.`,
          },
        ],
      });

      const text = this.extractTextContent(message);
      try {
        return parseMetaAdsCampaignJson(text);
      } catch (err) {
        lastErr = err;
        console.warn(
          '[claude] meta ads campaign JSON parse failed:',
          err instanceof Error ? err.message : err
        );
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error('Failed to generate Meta Ads campaign JSON');
  }

  async generateMailchimpSequence(input: {
    action: PlanAction;
    goal: string;
    businessContext?: string | null;
    fromName?: string | null;
    replyTo?: string | null;
    defaultAudienceName?: string | null;
  }): Promise<MailchimpSequenceState> {
    const a = input.action;
    const fromName = input.fromName?.trim() || 'Team';
    const replyTo = input.replyTo?.trim() || 'hello@example.com';
    const audienceHint = input.defaultAudienceName?.trim() || 'Main audience';

    const prompt = `You write email marketing sequences for a small business. Output ONLY valid JSON.

GOAL: ${input.goal}
BUSINESS: ${input.businessContext || 'Not provided'}
FROM NAME: ${fromName}
REPLY-TO EMAIL: ${replyTo}
DEFAULT AUDIENCE NAME: ${audienceHint}

PLAN ACTION:
- Title: ${a.title}
- Channel: ${a.channel}
- Why: ${a.why}
- Outcome: ${a.outcome}
- KPI: ${a.kpi}

Design 1–3 emails for a sequence (win-back, welcome, nurture, or list-building as implied by the action).
Hundres creates these as DRAFTS in Mailchimp — never claim they were sent.

Schema:
{
  "sequenceName": "short sequence name",
  "audienceName": "${audienceHint}",
  "fromName": "${fromName}",
  "replyTo": "${replyTo}",
  "emails": [
    {
      "dayOffset": 0,
      "subject": "subject line",
      "previewText": "optional inbox preview",
      "bodyPlain": "full email body as plain text with line breaks",
      "title": "internal campaign title"
    }
  ],
  "reasoning": "2-3 sentences why this sequence fits the goal"
}

Rules:
- 1–3 emails. Use dayOffset 0, 3, 7 (or similar) for spacing.
- bodyPlain is plain text only (no HTML).
- replyTo must be a valid email (use ${replyTo}).
- Match tone to the brand. Be specific to the action outcome.
- No trailing commas. Start with {`;

    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const message = await this.client.messages.create({
        model: DEFAULT_MODEL,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = this.extractTextContent(message);
      try {
        return parseMailchimpSequenceJson(text);
      } catch (err) {
        lastErr = err;
        console.warn(
          '[claude] mailchimp sequence JSON parse failed:',
          err instanceof Error ? err.message : err
        );
      }
    }

    throw lastErr instanceof Error
      ? lastErr
      : new Error('Failed to generate Mailchimp sequence JSON');
  }

  /**
   * Draft Business profile fields from a website (+ optional hints).
   * Fetches the site HTML ourselves (Shopify-safe) — web_search alone often
   * falsely reports live stores as "not accessible".
   */
  async draftBusinessProfile(input: {
    website?: string | null;
    notes?: string | null;
    current?: {
      oneLiner?: string | null;
      audience?: string | null;
      offer?: string | null;
      emulate?: string | null;
      budget?: string | null;
    };
  }): Promise<{
    oneLiner: string;
    audience: string;
    offer: string;
    emulate: string;
    budget: string;
  }> {
    const websiteRaw = input.website?.trim() || '';
    if (!websiteRaw && !input.notes?.trim() && !input.current?.oneLiner?.trim()) {
      throw new Error('Add a website URL (or a short note) so AI can draft the profile.');
    }

    const page = websiteRaw ? await fetchWebsiteText(websiteRaw) : null;
    const website = page?.finalUrl || websiteRaw;

    if (websiteRaw && !page) {
      console.warn('[claude] website fetch returned no text for', websiteRaw);
    }

    const siteBlock = page
      ? `Fetched site (live — use this as primary source; ignore any claim the domain is down):
Final URL: ${page.finalUrl}
Title: ${page.title || '(none)'}
Page text:
"""
${page.text}
"""`
      : websiteRaw
        ? `Website URL provided but HTML could not be fetched from this server. Draft from the URL, user notes, and existing fields. Do NOT say the domain is inaccessible — the user confirmed it is live.`
        : 'No website — draft only from user notes / existing fields.';

    const prompt = `You write crisp business profile copy for a marketing autopilot product (Hundres).
Output ONLY valid JSON (no markdown fences).

Website entered: ${websiteRaw || '(not provided)'}
User notes: ${input.notes?.trim() || '(none)'}
Existing draft fields (prefer facts from the site; improve clarity; do not invent a different brand):
- oneLiner: ${input.current?.oneLiner?.trim() || '(empty)'}
- audience: ${input.current?.audience?.trim() || '(empty)'}
- offer: ${input.current?.offer?.trim() || '(empty)'}
- emulate: ${input.current?.emulate?.trim() || '(empty)'}
- budget: ${input.current?.budget?.trim() || '(empty)'}

${siteBlock}

${
  page
    ? 'Optional: you may use web_search only for comparable competitor brand names (emulate). Do not re-check whether the domain is live.'
    : websiteRaw
      ? 'You may use web_search for the brand and niche. Prefer the apex domain (without www) if www fails.'
      : ''
}

Return this exact shape:
{
  "oneLiner": "one sentence describing what the business is",
  "audience": "who they sell to (2–4 sentences max)",
  "offer": "what they sell / services / positioning (2–5 sentences max)",
  "emulate": "2–5 comparable brands or competitors to study (comma-separated names or URLs), or empty string if unknown",
  "budget": "keep existing budget text if provided; otherwise empty string — never invent a spend number"
}

Rules:
- Specific and concrete — product names, niche, geography when known.
- No hype fluff, no markdown, no invented metrics or fake awards.
- Never claim the website is down, inaccessible, or inactive when page text was provided above.
- If the site is thin, say what's clear and keep fields shorter rather than guessing.
- Escape double quotes in strings. Start with {`;

    // When we fetched the page ourselves, skip web_search — Anthropic search often
    // falsely reports live Shopify stores (esp. www→apex) as inaccessible.
    const useWebSearch = Boolean(websiteRaw) && !page;
    let lastErr: unknown;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const text = await this.requestJsonText(
          attempt === 0
            ? prompt
            : `${prompt}\n\nPrevious reply was invalid JSON. Output ONLY valid JSON matching the schema. Do not mention domain accessibility.`,
          useWebSearch
        );
        const raw = extractJsonFromModelText(text) as Record<string, unknown>;
        const str = (key: string, max: number) => {
          const v = raw[key];
          if (typeof v !== 'string') return '';
          return v.trim().slice(0, max);
        };
        const oneLiner = str('oneLiner', 300);
        const audience = str('audience', 2000);
        const offer = str('offer', 2000);
        const blob = `${oneLiner} ${audience} ${offer}`.toLowerCase();
        if (/not currently accessible|not accessible or active|domain .+ is down/.test(blob)) {
          throw new Error('AI draft ignored live site content — retrying');
        }
        if (!oneLiner && !audience && !offer) {
          throw new Error('AI returned an empty profile draft');
        }
        return {
          oneLiner,
          audience,
          offer,
          emulate: str('emulate', 2000),
          budget: str('budget', 200) || (input.current?.budget?.trim() ?? ''),
        };
      } catch (err) {
        lastErr = err;
        console.warn(
          '[claude] business profile draft failed:',
          err instanceof Error ? err.message : err
        );
      }
    }

    throw lastErr instanceof Error
      ? lastErr
      : new Error('Failed to draft business profile');
  }

  /**
   * Draft a Runway text_to_image / text_to_video recipe prompt from the business profile.
   * Keeps {{brand}}, {{product}}, {{vibe}}, {{brief}}, {{audience}}, {{offer}} placeholders.
   */
  async draftRunwayPrompt(input: {
    engine: 'text_to_image' | 'text_to_video';
    profile: {
      website?: string | null;
      oneLiner?: string | null;
      audience?: string | null;
      offer?: string | null;
      emulate?: string | null;
    };
    recipeName?: string | null;
    concept?: string | null;
    currentPrompt?: string | null;
  }): Promise<{
    promptTemplate: string;
    styleNotes: string;
    negativePrompt: string;
    name: string;
    description: string;
  }> {
    const isVideo = input.engine === 'text_to_video';
    const mediumLabel = isVideo ? 'vertical 9:16 Instagram Reel / marketing video' : 'vertical 9:16 Instagram feed photograph';

    const prompt = `You write reusable Runway ${isVideo ? 'text-to-video' : 'text-to-image'} prompt templates for Hundres.
Output ONLY valid JSON (no markdown fences).

Business profile:
- Website: ${input.profile.website?.trim() || '(none)'}
- One-liner: ${input.profile.oneLiner?.trim() || '(none)'}
- Audience: ${input.profile.audience?.trim() || '(none)'}
- Offer: ${input.profile.offer?.trim() || '(none)'}
- Brands to emulate (inspiration only): ${input.profile.emulate?.trim() || '(none)'}

Recipe name hint: ${input.recipeName?.trim() || '(none)'}
Concept / notes: ${input.concept?.trim() || '(none)'}
Current prompt (improve; do not invent a different brand): ${input.currentPrompt?.trim() || '(empty)'}

Return:
{
  "name": "short recipe name the user will recognize",
  "description": "one line when to use this recipe",
  "promptTemplate": "full reusable prompt for a ${mediumLabel}. MUST include these placeholders where relevant: {{brand}}, {{product}}, {{vibe}}, {{brief}}, {{audience}}, {{offer}}. Be specific about lighting, camera, setting, product hero, and brand mood from the profile. No logos or on-image text.",
  "styleNotes": "compact look-and-feel extras (lighting, grade, lens)",
  "negativePrompt": "comma-separated things to avoid (logos, text overlays, watermarks, plus anything off-brand)"
}

Rules:
- promptTemplate must stay under 900 characters.
- Keep placeholders as literal {{brand}} etc. — do not fill them with real values.
- Photorealistic, premium, on-brand for this business — not generic stock.
- Escape double quotes. Start with {`;

    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const text = await this.requestJsonText(
          attempt === 0
            ? prompt
            : `${prompt}\n\nPrevious reply was invalid JSON. Output ONLY valid JSON. Keep {{placeholders}} literal.`,
          false
        );
        const raw = extractJsonFromModelText(text) as Record<string, unknown>;
        const str = (key: string, max: number) => {
          const v = raw[key];
          if (typeof v !== 'string') return '';
          return v.trim().slice(0, max);
        };
        let promptTemplate = str('promptTemplate', 2000);
        if (!promptTemplate) throw new Error('AI returned an empty prompt');
        // Ensure core placeholders exist so runtime fill works
        if (!/\{\{\s*brand\s*\}\}/i.test(promptTemplate)) {
          promptTemplate = `Brand: {{brand}}. ${promptTemplate}`;
        }
        if (!/\{\{\s*brief\s*\}\}/i.test(promptTemplate)) {
          promptTemplate = `${promptTemplate} {{brief}}`;
        }
        return {
          name: str('name', 200) || (isVideo ? 'Brand text-to-video' : 'Brand text-to-image'),
          description: str('description', 500),
          promptTemplate: promptTemplate.replace(/\s{2,}/g, ' ').trim().slice(0, 2000),
          styleNotes: str('styleNotes', 500),
          negativePrompt: str('negativePrompt', 500) || 'logos, text overlays, watermarks',
        };
      } catch (err) {
        lastErr = err;
        console.warn(
          '[claude] runway prompt draft failed:',
          err instanceof Error ? err.message : err
        );
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error('Failed to draft Runway prompt');
  }
}
