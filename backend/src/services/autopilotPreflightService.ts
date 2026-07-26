import { isGoogleAdsEnabled } from '../lib/googleFeatureFlags.js';
import {
  classifyActionIntent,
  explainActionRoute,
  isSingleShopifyBlogPost,
  resolveActionRoute,
  type OrgIntegrationFlags,
} from '../executors/actionRouter.js';
import { isInstagramAutoPublishEnabled, isShopifyAutoPublishLiveEnabled } from '../lib/contentPublishFeatureFlags.js';
import { MCPConnectionService } from './mcpConnectionService.js';
import { GoogleAnalyticsSnapshotService } from './googleAnalyticsSnapshotService.js';
import { GoogleAdsSnapshotService } from './googleAdsSnapshotService.js';
import { MetaAdsSnapshotService } from './metaAdsSnapshotService.js';
import { ShopifySnapshotService } from './shopifySnapshotService.js';
import { StrategyService } from './strategyService.js';
import { getBusinessProfile } from './businessProfileService.js';
import type { PlanAction } from '../types/plan.js';
import type { SnapshotPlatform } from '../types/snapshot.js';

const PLATFORM_LABELS: Record<SnapshotPlatform, string> = {
  google_analytics: 'Google Analytics',
  google_ads: 'Google Ads',
  meta_ads: 'Meta Ads',
  shopify: 'Shopify',
};

export type SnapshotPreflightLine = {
  platform: SnapshotPlatform;
  label: string;
  connected: boolean;
  loaded: boolean;
  /** Full snapshot text sent to Claude (same as plan generation). */
  text: string | null;
  /** Short preview for activity feed. */
  excerpt: string | null;
  error: string | null;
};

export type BlockedActionPreflight = {
  actionId: string;
  title: string;
  reason: string;
  resolution: 'reconnect' | 'connect';
};

export type ActionReasoningLine = {
  actionId: string;
  title: string;
  intent: string;
  routing: string;
};

export type AutopilotPreflight = {
  snapshots: SnapshotPreflightLine[];
  blockedActions: BlockedActionPreflight[];
  actionReasoning: ActionReasoningLine[];
  assistCount: number;
  automatedCount: number;
  blockedCount: number;
  summary: string;
  weekReasoning: string;
};

function excerpt(text: string, max = 520): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

export class AutopilotPreflightService {
  private mcp = new MCPConnectionService();
  private ga = new GoogleAnalyticsSnapshotService();
  private ads = new GoogleAdsSnapshotService();
  private meta = new MetaAdsSnapshotService();
  private shopify = new ShopifySnapshotService();
  private strategy = new StrategyService();

  async build(
    organizationId: string,
    strategyId: string,
    week: number,
    integrations: OrgIntegrationFlags
  ): Promise<AutopilotPreflight> {
    const strategy = await this.strategy.getById(organizationId, strategyId);
    const weekBlock = strategy?.plan?.weeks.find((w) => w.week === week);
    const actions = weekBlock?.actions ?? [];

    const connections = await this.mcp.getActiveConnections(organizationId);
    const analytics = connections.find((c) => c.platform === 'google_analytics');
    const adsConn = connections.find((c) => c.platform === 'google_ads');
    const metaConn = connections.find((c) => c.platform === 'meta_ads');
    const shopConn = connections.find((c) => c.platform === 'shopify');

    const shopDomain =
      typeof shopConn?.config?.shopDomain === 'string' ? shopConn.config.shopDomain : null;

    const [gaLine, adsLine, metaLine, shopLine] = await Promise.all([
      this.loadLine(
        'google_analytics',
        Boolean(analytics?.propertyId),
        () => this.ga.fetchSnapshot(organizationId)
      ),
      this.loadLine(
        'google_ads',
        isGoogleAdsEnabled() && Boolean(adsConn?.config?.customerId),
        () => this.ads.fetchSnapshot(organizationId)
      ),
      this.loadLine(
        'meta_ads',
        Boolean(metaConn?.config?.adAccountId),
        () => this.meta.fetchSnapshot(organizationId)
      ),
      this.loadLine('shopify', Boolean(shopDomain), () =>
        this.shopify.fetchSnapshot(organizationId)
      ),
    ]);

    const snapshots = [gaLine, adsLine, metaLine, shopLine];
    const loadedCount = snapshots.filter((s) => s.loaded).length;
    const connectedCount = snapshots.filter((s) => s.connected).length;

    const profile = await getBusinessProfile(organizationId);
    const businessContext = [profile.website, profile.oneLiner, profile.audience]
      .filter(Boolean)
      .join(' · ');

    const blockedActions: BlockedActionPreflight[] = [];
    const actionReasoning: ActionReasoningLine[] = [];
    let assistCount = 0;
    let automatedCount = 0;

    for (const action of actions) {
      const route = resolveActionRoute(action, integrations);
      const intent = classifyActionIntent(action);
      const intentLabel =
        route.executionType === 'create_meta_ads_campaign'
          ? 'Meta Ads campaign'
          : route.executionType === 'create_google_ads_campaign'
            ? 'Google Ads campaign'
            : route.executionType === 'publish_instagram_photo'
              ? /\bcarousel\b|\b\d[\d-]?\s*slides?\b|\b\d+-slide\b/.test(
                  `${action.title} ${action.outcome ?? ''}`.toLowerCase()
                )
                ? 'Instagram carousel'
                : 'Instagram auto-publish'
              : route.executionType === 'publish_instagram_story'
                ? 'Instagram story'
                : route.executionType === 'publish_instagram_reel'
                  ? 'Instagram Reel'
                : route.executionType === 'create_shopify_blog_article'
                ? 'Shopify blog article'
                : route.executionType === 'create_shopify_page'
                  ? 'Shopify page'
                  : intent === 'shopify_blog'
                    ? 'Shopify blog content'
                    : intent === 'product_seo'
                      ? 'Product SEO'
                      : 'Assist deliverable';

      actionReasoning.push({
        actionId: action.id,
        title: action.title,
        intent: intentLabel,
        routing: explainActionRoute(action, integrations),
      });

      if (intent === 'shopify_blog') {
        if (isSingleShopifyBlogPost(action) && integrations.shopifyContentWrite) {
          automatedCount += 1;
          continue;
        }
        assistCount += 1;
        if (!integrations.shopify) {
          blockedActions.push({
            actionId: action.id,
            title: action.title,
            reason: 'Shopify is not connected — blog posts cannot be created in your store.',
            resolution: 'connect',
          });
        } else if (!integrations.shopifyContentWrite && shopDomain) {
          blockedActions.push({
            actionId: action.id,
            title: action.title,
            reason:
              'Shopify MCP write_content scope not granted — blog posts will be drafted only until you add write_content in Partners and reconnect.',
            resolution: 'reconnect',
          });
        }
        continue;
      }

      if (intent === 'instagram_publish' && isInstagramAutoPublishEnabled()) {
        automatedCount += 1;
        if (!integrations.instagramReady) {
          blockedActions.push({
            actionId: action.id,
            title: action.title,
            reason: 'Instagram Business is not connected — feed posts cannot auto-publish.',
            resolution: 'connect',
          });
        }
        continue;
      }

      if (intent === 'mailchimp_campaign') {
        if (integrations.mailchimpReady) {
          automatedCount += 1;
        } else {
          assistCount += 1;
          blockedActions.push({
            actionId: action.id,
            title: action.title,
            reason:
              'Mailchimp is not connected — email will be copy-only until you connect and pick an audience.',
            resolution: 'connect',
          });
        }
        continue;
      }

      if (route.mode === 'assist') {
        assistCount += 1;
        continue;
      }

      automatedCount += 1;

      if (intent === 'shopify_page') {
        if (!integrations.shopify) {
          blockedActions.push({
            actionId: action.id,
            title: action.title,
            reason: 'Shopify is not connected — page cannot be created in your store.',
            resolution: 'connect',
          });
          continue;
        }
        if (!integrations.shopifyContentWrite && shopDomain) {
          blockedActions.push({
            actionId: action.id,
            title: action.title,
            reason:
              'Shopify MCP write_content scope not granted — page will be drafted only until you add write_content in Partners and reconnect.',
            resolution: 'reconnect',
          });
        }
        continue;
      }

      if (intent === 'product_seo') {
        if (!integrations.shopify) {
          blockedActions.push({
            actionId: action.id,
            title: action.title,
            reason: 'Shopify is not connected — product SEO cannot be loaded or applied.',
            resolution: 'connect',
          });
          continue;
        }
        if (!integrations.shopifyWrite) {
          blockedActions.push({
            actionId: action.id,
            title: action.title,
            reason:
              'write_products scope not granted — Hundres will draft SEO copy only (no auto-apply).',
            resolution: 'reconnect',
          });
        }
        continue;
      }

      if (route.executionType === 'create_google_ads_campaign') {
        if (!integrations.googleAdsReady) {
          blockedActions.push({
            actionId: action.id,
            title: action.title,
            reason: integrations.googleAds
              ? 'Select your Google Ads account in Integrations — campaign will draft as copy only until then.'
              : 'Google Ads is not connected — campaign will draft as copy and setup steps only.',
            resolution: integrations.googleAds ? 'reconnect' : 'connect',
          });
        }
        continue;
      }

      if (route.executionType === 'create_meta_ads_campaign') {
        if (!integrations.metaAdsReady) {
          blockedActions.push({
            actionId: action.id,
            title: action.title,
            reason: integrations.metaAds
              ? 'Select your Meta ad account in Integrations — campaign will draft as copy only until then.'
              : 'Meta Ads is not connected — reconnect with ads management permission to create paused campaigns.',
            resolution: integrations.metaAds ? 'reconnect' : 'connect',
          });
        }
      }
    }

    const blockedCount = blockedActions.length;
    const loadedLabels = snapshots.filter((s) => s.loaded).map((s) => s.label);
    const autoPublishNote =
      isInstagramAutoPublishEnabled() || isShopifyAutoPublishLiveEnabled()
        ? 'Some actions auto-publish to Instagram and/or Shopify when connected.'
        : null;
    const weekReasoning = [
      loadedLabels.length > 0
        ? `Live data from ${loadedLabels.join(', ')} will inform Claude when drafting this week's deliverables.`
        : 'No live snapshots loaded — Claude will rely on your goal, business profile, and plan context only.',
      autoPublishNote,
      assistCount > 0
        ? `${assistCount} action(s): agent-prepared deliverables (research, email copy, or waiting on a connection).`
        : null,
      automatedCount > 0
        ? `${automatedCount} action(s): auto-publish or apply in connected platforms${blockedCount ? ' (some need reconnection)' : ''}.`
        : null,
    ]
      .filter(Boolean)
      .join(' ');

    const summary =
      connectedCount === 0
        ? 'No integrations connected — autopilot will use assist deliverables only (no live store data).'
        : loadedCount === 0
          ? `${connectedCount} integration(s) connected but no live data loaded yet. Review errors below before continuing.`
          : `Live data loaded from ${loadedCount} of ${connectedCount} connected source(s). ${assistCount} assist action(s), ${automatedCount} store action(s)${blockedCount ? `, ${blockedCount} need manual handling` : ''}.`;

    return {
      snapshots,
      blockedActions,
      actionReasoning,
      assistCount,
      automatedCount,
      blockedCount,
      summary,
      weekReasoning,
    };
  }

  private async loadLine(
    platform: SnapshotPlatform,
    connected: boolean,
    fetcher: () => Promise<{ text: string } | null>
  ): Promise<SnapshotPreflightLine> {
    const label = PLATFORM_LABELS[platform];
    if (!connected) {
      return {
        platform,
        label,
        connected: false,
        loaded: false,
        text: null,
        excerpt: null,
        error: null,
      };
    }

    try {
      const snapshot = await fetcher();
      if (snapshot?.text) {
        const text = snapshot.text.trim();
        return {
          platform,
          label,
          connected: true,
          loaded: true,
          text,
          excerpt: excerpt(text),
          error: null,
        };
      }
      return {
        platform,
        label,
        connected: true,
        loaded: false,
        text: null,
        excerpt: null,
        error: 'Connected but snapshot returned no data.',
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Snapshot failed';
      return {
        platform,
        label,
        connected: true,
        loaded: false,
        text: null,
        excerpt: null,
        error: message,
      };
    }
  }
}
