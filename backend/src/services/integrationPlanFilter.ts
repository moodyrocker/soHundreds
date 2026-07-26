import {
  classifyActionIntent,
  isSingleShopifyBlogPost,
  type OrgIntegrationFlags,
} from '../executors/actionRouter.js';
import { isInstagramAutoPublishEnabled } from '../lib/contentPublishFeatureFlags.js';
import { isGoogleAdsEnabled } from '../lib/googleFeatureFlags.js';
import { actionMentionsUnsupportedPlatform } from '../lib/supportedPlanChannels.js';
import type { PlanAction, PlanDocument, PlanWeek } from '../types/plan.js';

export type ConnectionSuggestion = {
  platform: string;
  message: string;
  relatedActionTitle?: string;
};

function requiresDisconnectedIntegration(
  action: PlanAction,
  integrations: OrgIntegrationFlags
): ConnectionSuggestion | null {
  const intent = classifyActionIntent(action);

  if (intent === 'instagram_publish' && isInstagramAutoPublishEnabled()) {
    if (!integrations.instagramReady) {
      return {
        platform: 'instagram',
        message: 'Connect Instagram Business to auto-publish feed posts.',
        relatedActionTitle: action.title,
      };
    }
  }

  if (intent === 'instagram_story' && isInstagramAutoPublishEnabled()) {
    if (!integrations.instagramReady) {
      return {
        platform: 'instagram',
        message: 'Connect Instagram Business to auto-publish Instagram Stories.',
        relatedActionTitle: action.title,
      };
    }
  }

  if (intent === 'shopify_page' || intent === 'shopify_blog') {
    if (!integrations.shopify) {
      return {
        platform: 'shopify',
        message: 'Connect Shopify to create store pages and blog posts automatically.',
        relatedActionTitle: action.title,
      };
    }
    if (!integrations.shopifyContentWrite) {
      return {
        platform: 'shopify',
        message: 'Reconnect Shopify with write content scope to publish pages automatically.',
        relatedActionTitle: action.title,
      };
    }
  }

  if (intent === 'product_seo') {
    if (!integrations.shopify) {
      return {
        platform: 'shopify',
        message: 'Connect Shopify to apply product SEO changes in your store.',
        relatedActionTitle: action.title,
      };
    }
    if (!integrations.shopifyWrite) {
      return {
        platform: 'shopify',
        message: 'Reconnect Shopify with product write scope to apply SEO updates automatically.',
        relatedActionTitle: action.title,
      };
    }
  }

  if (intent === 'meta_ads_campaign') {
    if (!integrations.metaAdsReady) {
      return {
        platform: 'meta_ads',
        message: 'Connect Meta Ads to create paused campaigns in your ad account.',
        relatedActionTitle: action.title,
      };
    }
  }

  if (intent === 'google_ads_campaign') {
    if (!isGoogleAdsEnabled()) {
      return {
        platform: 'google_ads',
        message: 'Google Ads automation is disabled — use Meta Ads or manual copy instead.',
        relatedActionTitle: action.title,
      };
    }
    if (!integrations.googleAdsReady) {
      return {
        platform: 'google_ads',
        message: 'Connect Google Ads to create paused Search campaigns automatically.',
        relatedActionTitle: action.title,
      };
    }
  }

  if (intent === 'mailchimp_campaign') {
    if (!integrations.mailchimpReady) {
      return {
        platform: 'mailchimp',
        message:
          'Connect Mailchimp and select an audience to create email campaign drafts automatically.',
        relatedActionTitle: action.title,
      };
    }
  }

  return null;
}

/** Remove actions for platforms Hundres cannot execute (e.g. TikTok). */
export function stripUnsupportedPlatformsFromPlan(plan: PlanDocument): PlanDocument {
  const weeks = plan.weeks.map((week) => ({
    ...week,
    actions: week.actions.filter((a) => !actionMentionsUnsupportedPlatform(a)),
  }));

  const stripped = weeks.some((w, i) => w.actions.length < plan.weeks[i]!.actions.length);
  if (!stripped) return plan;

  return {
    ...plan,
    weeks,
    summary: {
      ...plan.summary,
      connectionSuggestions: [
        ...(plan.summary.connectionSuggestions ?? []),
        'TikTok and other unsupported social platforms were removed — use Instagram or content actions instead.',
      ],
    },
  };
}

/** Drop or rewrite actions that require disconnected integrations; collect connect suggestions. */
export function filterPlanByIntegrations(
  plan: PlanDocument,
  integrations: OrgIntegrationFlags
): { plan: PlanDocument; suggestions: ConnectionSuggestion[] } {
  const suggestions: ConnectionSuggestion[] = [];
  const seen = new Set<string>();

  const weeks = plan.weeks.map((week) => filterWeekActions(week, integrations, suggestions, seen));
  const strippedUnsupported = weeks.some((w, i) =>
    w.actions.length < plan.weeks[i]!.actions.length
  );

  return {
    plan: {
      ...plan,
      summary: {
        ...plan.summary,
        connectionSuggestions: [
          ...(plan.summary.connectionSuggestions ?? []),
          ...suggestions.map((s) => s.message),
          ...(strippedUnsupported
            ? [
                'TikTok and other unsupported social platforms were removed from this plan — use Instagram or content actions instead.',
              ]
            : []),
        ],
      },
      weeks,
    },
    suggestions,
  };
}

function filterWeekActions(
  week: PlanWeek,
  integrations: OrgIntegrationFlags,
  suggestions: ConnectionSuggestion[],
  seen: Set<string>
): PlanWeek {
  const kept: PlanAction[] = [];
  const eligible = week.actions.filter((a) => !actionMentionsUnsupportedPlatform(a));

  for (const action of eligible) {
    const blocked = requiresDisconnectedIntegration(action, integrations);
    if (!blocked) {
      kept.push(action);
      continue;
    }

    const key = `${blocked.platform}:${blocked.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      suggestions.push(blocked);
    }
    // Do not queue an action that cannot execute on a disconnected service.
  }

  return {
    ...week,
    actions: kept.length > 0 ? kept : week.actions,
  };
}
