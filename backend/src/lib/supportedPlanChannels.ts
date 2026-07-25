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
- Competitor research may mention other platforms in marketIntel only — not as week actions.`;
}
