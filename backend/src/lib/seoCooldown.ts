import { query } from '../database/connection.js';
import { getPaceProfile, type AutopilotPace } from './autopilotPaceConfig.js';

export type SeoCooldownTargets = {
  productIds: Set<string>;
  pageIds: Set<string>;
  cooldownDays: number;
};

type ExecutionTargetRow = {
  execution_type: string;
  proposed_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  executed_at: Date;
};

function extractId(
  state: Record<string, unknown> | null,
  keys: string[]
): string | null {
  if (!state) return null;
  for (const key of keys) {
    const v = state[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Products / pages that received SEO or page writes within the cooldown window.
 * Do not schedule or apply SEO changes to these targets again until the window elapses.
 */
export async function getSeoCooldownTargets(
  organizationId: string,
  pace: AutopilotPace
): Promise<SeoCooldownTargets> {
  const cooldownDays = getPaceProfile(pace).seoCooldownDays;
  const result = await query<ExecutionTargetRow>(
    `SELECT execution_type, proposed_state, after_state, executed_at
     FROM action_executions
     WHERE organization_id = $1
       AND status = 'executed'
       AND executed_at >= NOW() - ($2 || ' days')::interval
       AND execution_type IN (
         'update_product_seo',
         'create_shopify_page',
         'create_shopify_blog_article'
       )`,
    [organizationId, String(cooldownDays)]
  );

  const productIds = new Set<string>();
  const pageIds = new Set<string>();

  for (const row of result.rows) {
    const state = row.after_state ?? row.proposed_state;
    if (row.execution_type === 'update_product_seo') {
      const id = extractId(state, ['productId']);
      if (id) productIds.add(id);
    }
    if (row.execution_type === 'create_shopify_page') {
      const id = extractId(state, ['pageId', 'handle']);
      if (id) pageIds.add(id);
    }
    if (row.execution_type === 'create_shopify_blog_article') {
      const id = extractId(state, ['articleId', 'handle']);
      if (id) pageIds.add(id);
    }
  }

  return { productIds, pageIds, cooldownDays };
}

export async function countExecutionsSince(
  organizationId: string,
  executionTypes: string[],
  sinceIsoOrInterval: { hours?: number; days?: number }
): Promise<number> {
  const hours = sinceIsoOrInterval.hours;
  const days = sinceIsoOrInterval.days;
  const interval =
    hours !== undefined ? `${hours} hours` : `${days ?? 1} days`;

  const result = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM action_executions
     WHERE organization_id = $1
       AND status = 'executed'
       AND executed_at >= NOW() - $2::interval
       AND execution_type = ANY($3::text[])`,
    [organizationId, interval, executionTypes]
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function evaluateChannelCaps(
  organizationId: string,
  pace: AutopilotPace,
  executionType: string
): Promise<{ allow: boolean; reason: string | null }> {
  const p = getPaceProfile(pace);

  if (executionType === 'update_product_seo') {
    const today = await countExecutionsSince(organizationId, ['update_product_seo'], {
      hours: 24,
    });
    if (today >= p.productSeoPerDay) {
      return {
        allow: false,
        reason: `Pace ${p.label}: product SEO cap reached (${p.productSeoPerDay}/day). Try again tomorrow — SEO needs settle time.`,
      };
    }
    return { allow: true, reason: null };
  }

  if (
    executionType === 'create_shopify_page' ||
    executionType === 'create_shopify_blog_article'
  ) {
    const today = await countExecutionsSince(
      organizationId,
      ['create_shopify_page', 'create_shopify_blog_article'],
      { hours: 24 }
    );
    if (today >= p.shopifyContentPerDay) {
      return {
        allow: false,
        reason: `Pace ${p.label}: Shopify page/blog cap reached (${p.shopifyContentPerDay}/day).`,
      };
    }
    return { allow: true, reason: null };
  }

  if (executionType === 'publish_instagram_photo') {
    const today = await countExecutionsSince(organizationId, ['publish_instagram_photo'], {
      hours: 24,
    });
    if (today >= p.instagramFeedPerDay) {
      return {
        allow: false,
        reason: `Pace ${p.label}: Instagram feed cap reached (${p.instagramFeedPerDay}/day).`,
      };
    }
    return { allow: true, reason: null };
  }

  if (executionType === 'publish_instagram_story') {
    if (p.instagramStoryPerDay <= 0) {
      return { allow: false, reason: `Pace ${p.label}: Instagram Stories are not enabled.` };
    }
    const today = await countExecutionsSince(organizationId, ['publish_instagram_story'], {
      hours: 24,
    });
    if (today >= p.instagramStoryPerDay) {
      return {
        allow: false,
        reason: `Pace ${p.label}: Instagram Story cap reached (${p.instagramStoryPerDay}/day).`,
      };
    }
    return { allow: true, reason: null };
  }

  if (executionType === 'publish_instagram_reel') {
    const week = await countExecutionsSince(organizationId, ['publish_instagram_reel'], {
      days: 7,
    });
    if (week >= p.instagramReelPerWeek) {
      return {
        allow: false,
        reason: `Pace ${p.label}: Instagram Reel cap reached (${p.instagramReelPerWeek}/week).`,
      };
    }
    return { allow: true, reason: null };
  }

  if (executionType === 'create_mailchimp_drafts') {
    const week = await countExecutionsSince(organizationId, ['create_mailchimp_drafts'], {
      days: 7,
    });
    if (week >= p.mailchimpSequencesPerWeek) {
      return {
        allow: false,
        reason: `Pace ${p.label}: Mailchimp sequence cap reached (${p.mailchimpSequencesPerWeek}/week).`,
      };
    }
    return { allow: true, reason: null };
  }

  return { allow: true, reason: null };
}
