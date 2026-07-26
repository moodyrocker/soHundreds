import { describe, expect, it } from 'vitest';
import { buildPaidAdHumanGateReason } from './paidAdHumanGate.js';
import {
  SUPPORTED_PLAN_CHANNELS,
  actionMentionsUnsupportedPlatform,
} from './supportedPlanChannels.js';
import type { ExecutionRecord } from '../types/execution.js';
import type { PlanAction } from '../types/plan.js';

/**
 * The guards that stand between the agent and real money.
 *
 * `buildPaidAdHumanGateReason` produces the copy a user reads when a paid campaign
 * is parked for review. It is the only thing telling them a campaign exists in a
 * paused state and that spend is off until they act. If it says the wrong thing —
 * or implies a campaign is already live when it is not, or vice versa — the user
 * either leaves budget unspent or turns on spend they did not intend.
 *
 * `actionMentionsUnsupportedPlatform` strips actions the system cannot execute.
 * Without it a plan promises TikTok posts nothing will ever publish.
 */

function execution(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    id: 'exec-1',
    organizationId: 'org-1',
    strategyId: 'strategy-1',
    actionId: 'w1-a1',
    platform: 'meta_ads',
    executionType: 'create_meta_ads_campaign',
    status: 'previewed',
    riskLevel: 'high',
    summary: 'Launch a test campaign',
    targetLabel: null,
    beforeState: null,
    proposedState: null as never,
    afterState: null,
    errorMessage: null,
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:00.000Z',
    executedAt: null,
    rolledBackAt: null,
    ...overrides,
  } as ExecutionRecord;
}

function metaCampaign(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'meta_ads_campaign',
    campaignName: 'Summer Test',
    campaignId: null,
    ads: [],
    ...overrides,
  } as never;
}

describe('buildPaidAdHumanGateReason', () => {
  it('names the campaign and its Ads Manager id once created', () => {
    // The id is what lets the user find the campaign. Omitting it makes the
    // instruction unfollowable.
    const reason = buildPaidAdHumanGateReason(
      execution({ afterState: metaCampaign({ campaignId: '1203', campaignName: 'Summer Test' }) })
    );
    expect(reason).toContain('Summer Test');
    expect(reason).toContain('1203');
    expect(reason).toMatch(/paused/i);
  });

  it('states that spend is off until the user acts', () => {
    const reason = buildPaidAdHumanGateReason(
      execution({ afterState: metaCampaign({ campaignId: '1203' }) })
    );
    // This is the load-bearing sentence: it must be unambiguous that no money is
    // moving yet.
    expect(reason).toMatch(/turn spend on when you are ready/i);
  });

  it('reports how many creative images were attached', () => {
    const reason = buildPaidAdHumanGateReason(
      execution({
        afterState: metaCampaign({
          campaignId: '1203',
          ads: [{ imageUrl: 'https://x/1.png' }, { imageHash: 'abc' }, {}],
        }),
      })
    );
    expect(reason).toContain('2 creative images');
  });

  it('uses the singular for exactly one image', () => {
    const reason = buildPaidAdHumanGateReason(
      execution({ afterState: metaCampaign({ campaignId: '1203', ads: [{ imageHash: 'a' }] }) })
    );
    expect(reason).toContain('1 creative image.');
    expect(reason).not.toContain('1 creative images');
  });

  it('omits the creative note entirely when no images are attached', () => {
    const reason = buildPaidAdHumanGateReason(
      execution({ afterState: metaCampaign({ campaignId: '1203', ads: [{}, {}] }) })
    );
    expect(reason).not.toMatch(/creative image/);
  });

  it('uses future tense before the campaign exists', () => {
    // campaignId null means nothing has been created yet. Saying otherwise would
    // send the user hunting in Ads Manager for something that is not there.
    const reason = buildPaidAdHumanGateReason(
      execution({ proposedState: metaCampaign({ campaignId: null, campaignName: 'Autumn Test' }) })
    );
    expect(reason).toContain('Autumn Test');
    expect(reason).toMatch(/will be created paused/i);
    expect(reason).not.toMatch(/ID null|ID undefined/);
  });

  it('prefers afterState over proposedState', () => {
    // afterState is the real, post-write truth; proposedState is the plan.
    const reason = buildPaidAdHumanGateReason(
      execution({
        proposedState: metaCampaign({ campaignName: 'Proposed', campaignId: null }),
        afterState: metaCampaign({ campaignName: 'Actual', campaignId: '999' }),
      })
    );
    expect(reason).toContain('Actual');
    expect(reason).not.toContain('Proposed');
  });

  it('falls back to Google copy for a Google Ads execution', () => {
    const reason = buildPaidAdHumanGateReason(
      execution({ executionType: 'create_google_ads_campaign', platform: 'google_ads' })
    );
    expect(reason).toMatch(/Google Ads/);
    expect(reason).not.toMatch(/Meta/);
  });

  it('falls back to Meta copy for a Meta execution with no usable payload', () => {
    expect(buildPaidAdHumanGateReason(execution())).toMatch(/Meta Ads Manager/);
  });

  it('never returns an empty string', () => {
    // The reason is displayed as the sole instruction on a parked action. An empty
    // string would leave the user with a blocked action and no explanation.
    const shapes: Array<Partial<ExecutionRecord>> = [
      {},
      { proposedState: null as never, afterState: null },
      { executionType: 'create_shopify_page' as never },
      { proposedState: { kind: 'something_else' } as never },
      { afterState: {} as never },
    ];
    for (const shape of shapes) {
      const reason = buildPaidAdHumanGateReason(execution(shape));
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  it('always tells the user to mark the action done', () => {
    // Otherwise the orchestrator waits forever on a gate the user does not know
    // how to clear.
    for (const type of ['create_meta_ads_campaign', 'create_google_ads_campaign'] as const) {
      expect(buildPaidAdHumanGateReason(execution({ executionType: type }))).toMatch(
        /mark (it )?done/i
      );
    }
  });
});

function planAction(overrides: Partial<PlanAction> = {}): PlanAction {
  return {
    id: 'w1-a1',
    title: 'Publish an Instagram carousel',
    channel: 'instagram',
    day: 'Mon',
    time: '30m',
    impact: 'high',
    difficulty: 'easy',
    why: 'Engagement is highest midweek',
    outcome: 'More reach',
    kpi: 'reach',
    ...overrides,
  };
}

describe('actionMentionsUnsupportedPlatform', () => {
  it('passes a supported Instagram action', () => {
    expect(actionMentionsUnsupportedPlatform(planAction())).toBe(false);
  });

  it.each([
    ['TikTok', 'Post a TikTok about the new range'],
    ['tik tok with a space', 'Post to tik tok this week'],
    ['YouTube', 'Upload a YouTube short'],
    ['LinkedIn', 'Share on LinkedIn'],
    ['Pinterest', 'Pin the lookbook to Pinterest'],
    ['Snapchat', 'Run a Snapchat story'],
    ['Twitter', 'Tweet on Twitter about the launch'],
    ['Threads', 'Cross-post to Threads'],
  ])('flags %s', (_label, title) => {
    expect(actionMentionsUnsupportedPlatform(planAction({ title }))).toBe(true);
  });

  it('flags an unsupported platform mentioned only in the why field', () => {
    // The blob spans title, outcome, kpi and why — a model often puts the
    // giveaway in the rationale.
    expect(
      actionMentionsUnsupportedPlatform(
        planAction({ why: 'Competitors get most reach from TikTok' })
      )
    ).toBe(true);
  });

  it('flags an unsupported platform mentioned only in the outcome', () => {
    expect(
      actionMentionsUnsupportedPlatform(planAction({ outcome: 'Grow the LinkedIn following' }))
    ).toBe(true);
  });

  it('does not flag "X" used as an ordinary word', () => {
    // A bare "x" must not match, or ordinary copy would be stripped. Only the
    // explicit "X (formerly Twitter)" phrasing is caught.
    expect(actionMentionsUnsupportedPlatform(planAction({ title: 'Add x-ray view to PDP' }))).toBe(
      false
    );
    expect(actionMentionsUnsupportedPlatform(planAction({ outcome: '2x the click rate' }))).toBe(
      false
    );
  });

  it('flags the explicit "X (formerly Twitter)" phrasing', () => {
    expect(
      actionMentionsUnsupportedPlatform(planAction({ title: 'Post to X (formerly Twitter)' }))
    ).toBe(true);
  });

  it('is case insensitive', () => {
    expect(actionMentionsUnsupportedPlatform(planAction({ title: 'post a TIKTOK' }))).toBe(true);
    expect(actionMentionsUnsupportedPlatform(planAction({ title: 'post a tiktok' }))).toBe(true);
  });

  it('does not flag supported platforms', () => {
    for (const title of [
      'Publish an Instagram Reel',
      'Send an email campaign',
      'Improve product SEO',
      'Write a blog article',
      'Launch a paid Meta test',
      'Update the Google Business listing',
    ]) {
      expect(actionMentionsUnsupportedPlatform(planAction({ title }))).toBe(false);
    }
  });
});

describe('SUPPORTED_PLAN_CHANNELS', () => {
  it('matches the channel enum the plan schema validates against', () => {
    // If these drift, a plan can validate but have no execution path — or a
    // routable channel gets stripped from generation guidance.
    expect([...SUPPORTED_PLAN_CHANNELS].sort()).toEqual(
      ['content', 'email', 'instagram', 'local', 'paid', 'seo'].sort()
    );
  });

  it('includes exactly one channel that can spend money', () => {
    expect(SUPPORTED_PLAN_CHANNELS.filter((c) => c === 'paid')).toHaveLength(1);
  });
});
