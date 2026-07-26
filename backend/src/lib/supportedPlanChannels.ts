import type { PlanAction } from '../types/plan.js';

/** Channels Hundres can route and execute (see plan.ts channel enum). */
export const SUPPORTED_PLAN_CHANNELS = [
  'instagram',
  'email',
  'seo',
  'content',
  'paid',
  'local',
] as const;

/**
 * Platforms with no integration or execution path — strip from generated plans.
 * Short-form video → use channel instagram (reels) instead of TikTok.
 */
const UNSUPPORTED_PLATFORM_PATTERNS: RegExp[] = [
  /\btik\s*tok\b/i,
  /\byoutube\b/i,
  /\blinkedin\b/i,
  /\bpinterest\b/i,
  /\bsnapchat\b/i,
  /\btwitter\b/i,
  /\bx\s*\(\s*formerly\s*twitter\s*\)/i,
  /\bthreads\b/i,
];

export function actionMentionsUnsupportedPlatform(action: PlanAction): boolean {
  const blob = `${action.title} ${action.outcome} ${action.kpi} ${action.why}`;
  return UNSUPPORTED_PLATFORM_PATTERNS.some((re) => re.test(blob));
}

export function supportedChannelsPlanNotes(): string {
  return `
- SUPPORTED CHANNELS ONLY: Each action "channel" must be exactly one of: instagram, email, seo, content, paid, local.
- NEVER schedule TikTok, YouTube, LinkedIn, Pinterest, Snapchat, Twitter/X, or Threads posting tasks — Hundres has no integration for them and cannot execute them.
- AGENTIC CONTENT (critical): Hundres creates and publishes content — the business owner does NOT film, shoot, or manually post. Never use titles like "Film + publish" or "Record video". Use "Create and publish Instagram feed post(s)" or "Generate Runway Reel and publish".
- For Instagram feed posts and carousels: channel instagram — always Runway text-to-image for the published creative; Visual library images are brand/product reference only (never posted as-is).
- For short-form AI video: channel instagram, title must say "Reel" or "Runway video" — Runway text-to-video (library stills as optional reference only) and publish.
- ONLY paid channel actions (Meta/Google ads) are gated for human review before spend — never gate organic Instagram/content on human filming.
- Competitor research may mention other platforms in marketIntel only — not as week actions.
- CHANNEL BALANCE (critical — do not silently drop channels): every channel the user is actively using (has a connected integration OR appeared in a completed prior week) must get at least one action this week, unless the user's refinement notes or goal explicitly say to stop or deprioritize that channel. "Double down on what worked" means bias the split toward the winning channel — it does NOT mean zeroing out the others. If HISTORICAL LEARNING or PRIOR WEEK OUTCOMES strongly favor one channel, still keep a small maintenance action on the others so they keep generating data, and say so explicitly in that action's "why" (e.g. "keeping a light SEO action running even though paid is outperforming, so we don't lose SEO signal").
- If the user asks to increase emphasis on one channel (e.g. "more SEO"), add/expand that channel's actions — do not remove or shrink other already-active channels to compensate unless the user says to.`;
}
