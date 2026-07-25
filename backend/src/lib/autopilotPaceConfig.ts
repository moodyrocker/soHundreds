/**
 * Autopilot pace — Normal / High / Intense.
 * Controls plan density, cycle cadence, and channel caps.
 * SEO settle rule: never re-touch the same product/page within seoCooldownDays.
 */

export type AutopilotPace = 'normal' | 'high' | 'intense';

export type PaceProfile = {
  id: AutopilotPace;
  label: string;
  description: string;
  /** How often the worker may start a full cycle when no pending work. */
  cycleMinutes: number;
  /** Pause length when goal confidence is low / behind. */
  checkpointPauseHours: number;
  actionsPerWeekMin: number;
  actionsPerWeekMax: number;
  instagramFeedPerDay: number;
  instagramStoryPerDay: number;
  instagramReelPerWeek: number;
  productSeoPerDay: number;
  shopifyContentPerDay: number;
  mailchimpSequencesPerWeek: number;
  /** Do not re-SEO the same product or page within this window. */
  seoCooldownDays: number;
};

export const PACE_PROFILES: Record<AutopilotPace, PaceProfile> = {
  normal: {
    id: 'normal',
    label: 'Normal',
    description: 'Steady weekly operator — today’s default cadence.',
    cycleMinutes: 60,
    checkpointPauseHours: 24,
    actionsPerWeekMin: 3,
    actionsPerWeekMax: 5,
    instagramFeedPerDay: 1,
    instagramStoryPerDay: 0,
    instagramReelPerWeek: 1,
    productSeoPerDay: 1,
    shopifyContentPerDay: 1,
    mailchimpSequencesPerWeek: 1,
    seoCooldownDays: 14,
  },
  high: {
    id: 'high',
    label: 'High',
    description: 'Push harder — more actions, faster cycles, still spam-safe.',
    cycleMinutes: 30,
    checkpointPauseHours: 12,
    actionsPerWeekMin: 5,
    actionsPerWeekMax: 8,
    instagramFeedPerDay: 1,
    instagramStoryPerDay: 1,
    instagramReelPerWeek: 2,
    productSeoPerDay: 2,
    shopifyContentPerDay: 1,
    mailchimpSequencesPerWeek: 1,
    seoCooldownDays: 14,
  },
  intense: {
    id: 'intense',
    label: 'Intense',
    description:
      'Month-long push — daily IG, more SEO breadth, 15m cycles. Same product/page SEO waits 14 days.',
    cycleMinutes: 15,
    checkpointPauseHours: 6,
    actionsPerWeekMin: 6,
    actionsPerWeekMax: 10,
    instagramFeedPerDay: 1,
    instagramStoryPerDay: 1,
    instagramReelPerWeek: 3,
    productSeoPerDay: 2,
    shopifyContentPerDay: 1,
    mailchimpSequencesPerWeek: 1,
    seoCooldownDays: 14,
  },
};

export function parseAutopilotPace(value: unknown): AutopilotPace {
  if (value === 'high' || value === 'intense' || value === 'normal') return value;
  return 'normal';
}

export function getPaceProfile(pace: AutopilotPace): PaceProfile {
  return PACE_PROFILES[pace];
}

/** Prompt notes for Claude plan generation. */
export function pacePlanPromptNotes(pace: AutopilotPace): string {
  const p = getPaceProfile(pace);
  return `
PACE MODE: ${p.label} (${p.id})
- Schedule ${p.actionsPerWeekMin}–${p.actionsPerWeekMax} actions this week (unique ids).
- Instagram feed: at most ${p.instagramFeedPerDay}/day; Stories at most ${p.instagramStoryPerDay}/day; Reels at most ${p.instagramReelPerWeek}/week.
- Shopify product SEO: at most ${p.productSeoPerDay}/day — NEVER re-optimize the same product within ${p.seoCooldownDays} days (organic SEO needs settle time). Prefer different products.
- Shopify pages/blog: at most ${p.shopifyContentPerDay}/day; do not recreate or re-SEO the same page within ${p.seoCooldownDays} days.
- Mailchimp: at most ${p.mailchimpSequencesPerWeek} draft sequence(s)/week (drafts only).
- Prefer goal-linked, high-leverage actions over filler. Intensity means breadth + cadence, not spam.
`.trim();
}
