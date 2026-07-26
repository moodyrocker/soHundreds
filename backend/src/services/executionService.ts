import { randomUUID } from 'node:crypto';
import { query } from '../database/connection.js';
import type { AgentExecutionBrief } from '../types/agentTask.js';
import { inferAgentBriefFallback } from '../types/agentTask.js';
import type { PlanAction, PlanDocument } from '../types/plan.js';
import type {
  BatchExecutionResult,
  BatchRunResponse,
  ExecutionMode,
  ExecutionPayload,
  ExecutionPreviewResponse,
  ExecutionRecord,
  ExecutionStatus,
  GoogleAdsCampaignState,
  InstagramPublishState,
  MailchimpSequenceState,
  MetaAdsCampaignState,
  ProductSeoState,
  ShopifyBlogArticleState,
  ShopifyPageState,
} from '../types/execution.js';
import { AssistExecutor } from '../executors/assistExecutor.js';
import {
  classifyActionIntent,
  explainActionRoute,
  isAdvertPlanAssist,
  isAutomatedWrite,
  isInstagramStoryAction,
  isSingleShopifyBlogPost,
  resolveActionRoute,
  resolveAdHocActionRoute,
  type OrgIntegrationFlags,
} from '../executors/actionRouter.js';
import { shopifyHasWriteContentScope, shopifyHasWriteProductsScope } from '../lib/shopifyAdmin.js';
import { INSTANCE_ID } from '../lib/workerIdentity.js';
import { AuditLogService } from './auditLogService.js';
import { AutopilotActivityService } from './autopilotActivityService.js';
import { AutopilotPreflightService } from './autopilotPreflightService.js';
import { ActionCompletionService } from './actionCompletionService.js';
import { ClaudeService } from './claudeService.js';
import { isGoogleAdsEnabled } from '../lib/googleFeatureFlags.js';
import { isRunwayConfigured } from '../lib/runwayClient.js';
import { MCPConnectionService } from './mcpConnectionService.js';
import { ShopifyExecutionService } from './shopifyExecutionService.js';
import { GoogleAdsCampaignService } from './googleAdsCampaignService.js';
import { MetaAdsCampaignService } from './metaAdsCampaignService.js';
import { MailchimpExecutionService } from './mailchimpExecutionService.js';
import { GoogleAdsSnapshotService } from './googleAdsSnapshotService.js';
import { MetaAdsSnapshotService } from './metaAdsSnapshotService.js';
import { StrategyService } from './strategyService.js';
import { getBusinessProfile, formatBusinessProfileForPrompt, type BusinessProfile } from './businessProfileService.js';
import { isInstagramImagePreviewEnabled } from '../lib/instagramFeatureFlags.js';
import { isShopifyAutoPublishLiveEnabled } from '../lib/contentPublishFeatureFlags.js';
import {
  evaluateMetaAdsCreateThrottle,
  formatMetaAdsPerformanceForCreativePrompt,
} from '../lib/paidAdThrottle.js';
import { evaluateChannelCaps, getSeoCooldownTargets } from '../lib/seoCooldown.js';
import { getAutopilotPace } from './autopilotService.js';
import { getPaceProfile } from '../lib/autopilotPaceConfig.js';
import { pickInstagramImagesForAssist } from './instagramAssistImageService.js';
import { InstagramExecutionService } from './instagramExecutionService.js';
import { LearningKnowledgeService } from './learningKnowledgeService.js';
import { ContentRecipeKnowledgeService } from './contentRecipeKnowledgeService.js';
import { BrandVisualLibraryService } from './brandVisualLibraryService.js';
import { AdCampaignLibraryService } from './adCampaignLibraryService.js';
import { isUnsplashConfigured } from '../lib/unsplashClient.js';
import { shopStorefrontUrl } from '../lib/shopStorefrontUrl.js';
import { logger } from '../lib/logger.js';

const log = logger('execution');

type ExecutionRow = {
  id: string;
  organization_id: string;
  strategy_id: string;
  action_id: string;
  platform: string;
  execution_type: string;
  status: ExecutionStatus;
  risk_level: string;
  summary: string;
  target_label: string | null;
  before_state: ExecutionPayload | null;
  proposed_state: ExecutionPayload;
  after_state: ExecutionPayload | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
  executed_at: Date | null;
  rolled_back_at: Date | null;
};

function mapRow(row: ExecutionRow): ExecutionRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    strategyId: row.strategy_id,
    actionId: row.action_id,
    platform: row.platform as ExecutionRecord['platform'],
    executionType: row.execution_type as ExecutionRecord['executionType'],
    status: row.status,
    riskLevel: row.risk_level as ExecutionRecord['riskLevel'],
    summary: row.summary,
    targetLabel: row.target_label,
    beforeState: row.before_state,
    proposedState: row.proposed_state,
    afterState: row.after_state,
    errorMessage: row.error_message,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    executedAt: row.executed_at?.toISOString() ?? null,
    rolledBackAt: row.rolled_back_at?.toISOString() ?? null,
  };
}

function findPlanAction(plan: PlanDocument, actionId: string): PlanAction | null {
  for (const week of plan.weeks) {
    const action = week.actions.find((a) => a.id === actionId);
    if (action) return action;
  }
  return null;
}

function asProductSeo(payload: ExecutionPayload): ProductSeoState {
  if (payload.kind !== 'product_seo') {
    throw new Error('Expected Shopify SEO payload');
  }
  return payload;
}

function asShopifyBlogArticle(payload: ExecutionPayload): ShopifyBlogArticleState {
  if (payload.kind !== 'shopify_blog_article') {
    throw new Error('Expected Shopify blog article payload');
  }
  return payload;
}

function asInstagramPublish(payload: ExecutionPayload): InstagramPublishState {
  if (payload.kind !== 'instagram_publish') {
    throw new Error('Expected Instagram publish payload');
  }
  return payload;
}

function asShopifyPage(payload: ExecutionPayload): ShopifyPageState {
  if (payload.kind !== 'shopify_page') {
    throw new Error('Expected Shopify page payload');
  }
  return payload;
}

function asGoogleAdsCampaign(payload: ExecutionPayload): GoogleAdsCampaignState {
  if (payload.kind !== 'google_ads_campaign') {
    throw new Error('Expected Google Ads campaign payload');
  }
  return payload;
}

function asMetaAdsCampaign(payload: ExecutionPayload): MetaAdsCampaignState {
  if (payload.kind !== 'meta_ads_campaign') {
    throw new Error('Expected Meta Ads campaign payload');
  }
  return payload;
}

function asMailchimpSequence(payload: ExecutionPayload): MailchimpSequenceState {
  if (payload.kind !== 'mailchimp_sequence') {
    throw new Error('Expected Mailchimp sequence payload');
  }
  return payload;
}

function extractPayloadReasoning(payload: ExecutionPayload): string | null {
  if (payload.kind === 'assist_deliverable' && payload.reasoning) {
    return payload.reasoning;
  }
  if (payload.kind === 'shopify_page' && payload.reasoning) {
    return payload.reasoning;
  }
  if (payload.kind === 'product_seo' && payload.reasoning) {
    return payload.reasoning;
  }
  if (payload.kind === 'google_ads_campaign' && payload.reasoning) {
    return payload.reasoning;
  }
  if (payload.kind === 'meta_ads_campaign' && payload.reasoning) {
    return payload.reasoning;
  }
  if (payload.kind === 'mailchimp_sequence' && payload.reasoning) {
    return payload.reasoning;
  }
  if (payload.kind === 'instagram_publish' && payload.reasoning) {
    return payload.reasoning;
  }
  if (payload.kind === 'shopify_blog_article' && payload.reasoning) {
    return payload.reasoning;
  }
  return null;
}

export class ExecutionService {
  private strategy = new StrategyService();
  private mcp = new MCPConnectionService();
  private shopify = new ShopifyExecutionService();
  private instagram = new InstagramExecutionService();
  private googleAdsCampaign = new GoogleAdsCampaignService();
  private metaAdsCampaign = new MetaAdsCampaignService();
  private mailchimpExecution = new MailchimpExecutionService();
  private googleAdsSnapshot = new GoogleAdsSnapshotService();
  private metaAdsSnapshot = new MetaAdsSnapshotService();
  private assist = new AssistExecutor();
  private claude = new ClaudeService();
  private audit = new AuditLogService();
  private activity = new AutopilotActivityService();
  private preflight = new AutopilotPreflightService();
  private completions = new ActionCompletionService();
  private learning = new LearningKnowledgeService();
  private recipes = new ContentRecipeKnowledgeService();
  private visuals = new BrandVisualLibraryService();
  private adCampaignLibrary = new AdCampaignLibraryService();

  private buildMcpCapabilityNotes(integrations: OrgIntegrationFlags): string {
    const lines: string[] = [];
    if (integrations.runwayReady) {
      lines.push(
        '- Runway MCP ready: generate_instagram_reel / text_to_video → public HTTPS MP4 (9:16). Use for AI video Stories or Reels.'
      );
    }
    if (integrations.instagramReady) {
      lines.push(
        '- Instagram MCP ready: publish_photo, publish_story (image or video URL), publish_reel, publish_carousel.'
      );
    }
    if (integrations.canvaReady) {
      lines.push(
        '- Canva MCP ready: create_instagram_design + export_design → PNG for feed/story stills.'
      );
    }
    if (isUnsplashConfigured()) {
      lines.push('- Unsplash MCP ready: search_photos for lifestyle stills.');
    }
    if (integrations.shopify) {
      lines.push('- Shopify MCP ready: create_blog_article, create_page, product SEO (when write scopes allow).');
    }
    if (integrations.mailchimpReady) {
      lines.push(
        '- Mailchimp MCP ready: list_audiences, ensure_audience, upsert_member, create_draft_campaign (drafts only — never auto-send).'
      );
    }
    if (!lines.length) {
      return 'No content MCPs ready yet — ask the user to connect Integrations.';
    }
    return lines.join('\n');
  }

  private async markPlanActionComplete(
    organizationId: string,
    strategyId: string,
    actionId: string
  ): Promise<void> {
    await this.completions.setCompleted(organizationId, strategyId, actionId, true);
  }

  /** Pull live integration data, log to activity feed, optionally execute the week. */
  async runWeekBatch(
    organizationId: string,
    strategyId: string,
    week: number,
    options: { confirm: boolean }
  ): Promise<BatchRunResponse> {
    const strategy = await this.strategy.getById(organizationId, strategyId);
    if (!strategy?.plan) {
      throw new Error('Plan not found');
    }

    const weekBlock = strategy.plan.weeks.find((w) => w.week === week);
    if (!weekBlock) {
      throw new Error(`Week ${week} not found in plan`);
    }

    const integrations = await this.getIntegrationFlags(organizationId);
    const preflightResult = await this.preflight.build(
      organizationId,
      strategyId,
      week,
      integrations
    );

    await this.logPreflightActivity(organizationId, strategyId, week, preflightResult);

    if (!options.confirm) {
      await this.activity.log({
        organizationId,
        strategyId,
        weekNumber: week,
        step: 'awaiting_confirmation',
        title: 'Review live data before autopilot runs',
        detail: [
          preflightResult.summary,
          preflightResult.blockedCount > 0
            ? `${preflightResult.blockedCount} action(s) cannot write to Shopify — copy the Claude MCP prompts after preparation.`
            : 'Confirm to prepare this week\'s actions.',
        ].join(' '),
        status: 'warn',
      });
      return { phase: 'preflight', preflight: preflightResult, results: [] };
    }

    await this.activity.clearStaleRunning(organizationId, strategyId, week);

    const results = await this.runWeekActions(
      organizationId,
      strategyId,
      week,
      weekBlock.actions,
      integrations
    );

    return { phase: 'executed', preflight: preflightResult, results };
  }

  private async logPreflightActivity(
    organizationId: string,
    strategyId: string,
    week: number,
    preflight: Awaited<ReturnType<AutopilotPreflightService['build']>>
  ): Promise<void> {
    await this.activity.log({
      organizationId,
      strategyId,
      weekNumber: week,
      step: 'data_pull_start',
      title: 'Pulling live integration data',
      detail: preflight.summary,
      status: 'running',
    });

    for (const line of preflight.snapshots) {
      if (!line.connected) continue;
      await this.activity.log({
        organizationId,
        strategyId,
        weekNumber: week,
        step: 'data_pull',
        title: line.loaded ? `${line.label} — data loaded` : `${line.label} — no data`,
        detail: line.loaded
          ? line.excerpt ?? 'Snapshot loaded.'
          : line.error ?? 'Connected but snapshot empty.',
        status: line.loaded ? 'success' : 'warn',
      });
    }

    for (const blocked of preflight.blockedActions) {
      await this.activity.log({
        organizationId,
        strategyId,
        weekNumber: week,
        actionId: blocked.actionId,
        step: 'blocked',
        title: `Cannot auto-write: ${blocked.title}`,
        detail: blocked.reason,
        status: 'warn',
      });
    }

    await this.activity.log({
      organizationId,
      strategyId,
      weekNumber: week,
      step: 'data_pull_done',
      title: 'Data pull complete',
      detail: preflight.summary,
      status: preflight.snapshots.some((s) => s.connected && !s.loaded) ? 'warn' : 'success',
    });

    if (preflight.weekReasoning) {
      await this.activity.log({
        organizationId,
        strategyId,
        weekNumber: week,
        step: 'week_reasoning',
        title: 'How autopilot will use this data',
        detail: preflight.weekReasoning,
        status: 'info',
      });
    }

    for (const line of preflight.actionReasoning) {
      await this.activity.log({
        organizationId,
        strategyId,
        weekNumber: week,
        actionId: line.actionId,
        step: 'action_plan',
        title: `${line.intent}: ${line.title}`,
        detail: line.routing,
        status: 'info',
      });
    }
  }

  async runWeek(
    organizationId: string,
    strategyId: string,
    week: number
  ): Promise<BatchExecutionResult[]> {
    const response = await this.runWeekBatch(organizationId, strategyId, week, {
      confirm: true,
    });
    return response.results;
  }

  private async runWeekActions(
    organizationId: string,
    strategyId: string,
    week: number,
    actions: PlanAction[],
    integrations: OrgIntegrationFlags
  ): Promise<BatchExecutionResult[]> {
    const existing = await this.listForStrategy(organizationId, strategyId);

    const results: BatchExecutionResult[] = [];

    await this.activity.log({
      organizationId,
      strategyId,
      weekNumber: week,
      step: 'week_start',
      title: `Autopilot started — week ${week}`,
      detail: `${actions.length} actions in queue for this week.`,
      status: 'running',
    });

    for (const action of actions) {
      const reasoning = explainActionRoute(action, integrations);
      const route = resolveActionRoute(action, integrations);
      const decisionLabel =
        route.executionType === 'create_meta_ads_campaign'
          ? 'Meta Ads campaign draft'
          : route.executionType === 'create_mailchimp_drafts'
            ? 'Mailchimp email drafts'
          : route.executionType === 'create_google_ads_campaign'
          ? 'Google Ads campaign draft'
          : route.executionType === 'publish_instagram_photo'
            ? 'Instagram feed publish'
          : route.executionType === 'publish_instagram_story'
            ? 'Instagram story publish'
          : route.executionType === 'publish_instagram_reel'
            ? 'Instagram Reel publish'
          : route.executionType === 'create_shopify_page'
          ? integrations.shopifyContentWrite
            ? 'Shopify page write'
            : 'Shopify page draft + MCP prompt'
          : classifyActionIntent(action) === 'shopify_blog'
            ? integrations.shopifyContentWrite
              ? 'Shopify blog draft'
              : 'Blog calendar + MCP prompt'
            : route.mode === 'automated_write'
            ? integrations.shopifyWrite
              ? 'Shopify SEO write'
              : 'Shopify SEO draft only'
            : 'Assist deliverable';

      // Only skip when the same action already has a preview/execute for THIS route type.
      // Wrong prior type (e.g. Meta Ads for an Instagram feed post) must re-run.
      const priorSameType = existing.find(
        (e) =>
          e.actionId === action.id &&
          e.executionType === route.executionType &&
          (e.status === 'executed' || e.status === 'previewed')
      );
      const priorAny = existing.find((e) => e.actionId === action.id);

      if (priorSameType) {
        if (this.canAutoApplyExecution(priorSameType, integrations)) {
          let execution = priorSameType;
          execution = await this.tryAutoApplyExecution(
            organizationId,
            strategyId,
            execution,
            integrations,
            week,
            action.id
          );
          results.push({
            actionId: action.id,
            ok: execution.status === 'executed',
            execution,
            ...(execution.errorMessage ? { error: execution.errorMessage } : {}),
          });
          if (execution.status === 'executed') {
            await this.activity.log({
              organizationId,
              strategyId,
              weekNumber: week,
              actionId: action.id,
              step: 'complete',
              title:
                execution.status === 'executed'
                  ? this.publishedDoneTitle(execution, action)
                  : `Created: ${action.title}`,
              detail: execution.summary,
              status: 'success',
            });
          }
          continue;
        }

        results.push({
          actionId: action.id,
          ok: true,
          execution: priorSameType,
        });
        await this.activity.log({
          organizationId,
          strategyId,
          weekNumber: week,
          actionId: action.id,
          step: 'skipped',
          title: action.title,
          detail: `Already prepared — skipped (${decisionLabel}).`,
          status: 'success',
        });
        continue;
      }

      if (priorAny && priorAny.executionType !== route.executionType) {
        await this.activity.log({
          organizationId,
          strategyId,
          weekNumber: week,
          actionId: action.id,
          step: 'decision',
          title: `Re-routing: ${decisionLabel}`,
          detail: `Previous attempt was ${priorAny.executionType}; running again as ${route.executionType}. ${reasoning}`,
          status: 'warn',
        });
      } else {
        await this.activity.log({
          organizationId,
          strategyId,
          weekNumber: week,
          actionId: action.id,
          step: 'decision',
          title: `Decision: ${decisionLabel}`,
          detail: reasoning,
          status: 'info',
        });
      }

      await this.activity.log({
        organizationId,
        strategyId,
        weekNumber: week,
        actionId: action.id,
        step: 'executing',
        title: action.title,
        detail:
          route.mode === 'assist'
            ? 'Generating deliverable with Claude…'
            : route.executionType === 'create_meta_ads_campaign'
              ? 'Drafting Meta campaign + generating creatives (library / Canva / Runway)…'
              : route.executionType === 'create_google_ads_campaign'
              ? 'Drafting Google Search campaign with Claude…'
              : route.executionType === 'publish_instagram_photo'
              ? 'Creating Instagram feed post (images + caption) and publishing…'
              : route.executionType === 'publish_instagram_story'
              ? 'Creating Instagram story and publishing…'
              : route.executionType === 'publish_instagram_reel'
              ? 'Generating Reel video and publishing…'
              : route.executionType === 'create_shopify_page'
              ? integrations.shopifyContentWrite
                ? 'Writing store page content with Claude…'
                : 'Drafting page + Claude.ai Shopify MCP prompt…'
              : 'Loading Shopify product and drafting SEO changes…',
        status: 'running',
      });

      try {
        const preview = await this.executeActionPreview(organizationId, strategyId, action.id);
        let execution = preview.execution;
        if (this.canAutoApplyExecution(execution, integrations)) {
          execution = await this.tryAutoApplyExecution(
            organizationId,
            strategyId,
            execution,
            integrations,
            week,
            action.id
          );
        }
        results.push({ actionId: action.id, ok: true, execution });
        const aiReasoning = extractPayloadReasoning(execution.proposedState);
        if (aiReasoning) {
          await this.activity.log({
            organizationId,
            strategyId,
            weekNumber: week,
            actionId: action.id,
            step: 'ai_reasoning',
            title: `Why: ${action.title}`,
            detail: aiReasoning,
            status: 'info',
          });
        }
        await this.activity.log({
          organizationId,
          strategyId,
          weekNumber: week,
          actionId: action.id,
          step: 'complete',
          title:
            execution.status === 'executed'
              ? this.publishedDoneTitle(execution, action)
              : `Ready: ${action.title}`,
          detail: preview.scopeWarning ?? execution.summary,
          status: 'success',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed';
        results.push({ actionId: action.id, ok: false, error: message });
        await this.activity.log({
          organizationId,
          strategyId,
          weekNumber: week,
          actionId: action.id,
          step: 'failed',
          title: `Failed: ${action.title}`,
          detail: message,
          status: 'error',
        });
      }
    }

    const ok = results.filter((r) => r.ok).length;
    await this.activity.log({
      organizationId,
      strategyId,
      weekNumber: week,
      step: 'week_done',
      title: `Week ${week} complete`,
      detail: `Prepared ${ok} of ${results.length} actions.`,
      status: ok === results.length ? 'success' : 'warn',
    });

    return results;
  }

  async listForStrategy(
    organizationId: string,
    strategyId: string
  ): Promise<ExecutionRecord[]> {
    const result = await query<ExecutionRow>(
      `SELECT DISTINCT ON (action_id) *
       FROM action_executions
       WHERE organization_id = $1 AND strategy_id = $2
       ORDER BY action_id, created_at DESC`,
      [organizationId, strategyId]
    );
    return result.rows.map(mapRow);
  }

  async preview(
    organizationId: string,
    strategyId: string,
    actionId: string
  ): Promise<ExecutionPreviewResponse> {
    const { strategy, action } = await this.loadAction(organizationId, strategyId, actionId);
    const integrations = await this.getIntegrationFlags(organizationId);
    const route = resolveActionRoute(action, integrations);
    const reasoning = explainActionRoute(action, integrations);
    const week = strategy.currentWeek;

    await this.activity.log({
      organizationId,
      strategyId,
      weekNumber: week,
      actionId: action.id,
      step: 'decision',
      title: `Decision: ${this.actionDecisionLabel(action, route, integrations)}`,
      detail: reasoning,
      status: 'info',
    });

    await this.activity.log({
      organizationId,
      strategyId,
      weekNumber: week,
      actionId: action.id,
      step: 'executing',
      title: action.title,
      detail: this.actionExecutingDetail(route, integrations),
      status: 'running',
    });

    try {
      const result = await this.executeActionPreviewForAction(
        organizationId,
        strategyId,
        action,
        strategy,
        route,
        integrations
      );
      let execution = result.execution;

      if (this.canAutoApplyExecution(execution, integrations)) {
        try {
          execution = await this.tryAutoApplyExecution(
            organizationId,
            strategyId,
            execution,
            integrations,
            week,
            action.id
          );
        } catch {
          // Keep previewed execution if auto-create fails.
        }
      }

      const aiReasoning = extractPayloadReasoning(execution.proposedState);
      if (aiReasoning) {
        await this.activity.log({
          organizationId,
          strategyId,
          weekNumber: week,
          actionId: action.id,
          step: 'ai_reasoning',
          title: `Why: ${action.title}`,
          detail: aiReasoning,
          status: 'info',
        });
      }
      await this.activity.log({
        organizationId,
        strategyId,
        weekNumber: week,
        actionId: action.id,
        step: 'complete',
        title:
          execution.status === 'executed'
            ? this.publishedDoneTitle(execution, action)
            : `Ready: ${action.title}`,
        detail: result.scopeWarning ?? execution.summary,
        status: 'success',
      });
      return { ...result, execution, reasoning };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      await this.activity.log({
        organizationId,
        strategyId,
        weekNumber: week,
        actionId: action.id,
        step: 'failed',
        title: `Failed: ${action.title}`,
        detail: message,
        status: 'error',
      });
      throw err;
    }
  }

  private actionDecisionLabel(
    action: PlanAction,
    route: ReturnType<typeof resolveActionRoute>,
    integrations: OrgIntegrationFlags
  ): string {
    if (route.executionType === 'create_meta_ads_campaign') return 'Meta Ads campaign draft';
    if (route.executionType === 'create_mailchimp_drafts') return 'Mailchimp email drafts';
    if (route.executionType === 'create_google_ads_campaign') return 'Google Ads campaign draft';
    if (route.executionType === 'publish_instagram_photo') return 'Instagram auto-publish';
    if (route.executionType === 'publish_instagram_story') return 'Instagram story';
    if (route.executionType === 'publish_instagram_reel') return 'Instagram Reel (Runway video)';
    if (route.executionType === 'create_shopify_blog_article') {
      return integrations.shopifyContentWrite
        ? 'Shopify blog article write'
        : 'Shopify blog draft + MCP prompt';
    }
    if (route.executionType === 'create_shopify_page') {
      return integrations.shopifyContentWrite
        ? 'Shopify page write'
        : 'Shopify page draft + MCP prompt';
    }
    if (classifyActionIntent(action) === 'shopify_blog' && !isSingleShopifyBlogPost(action)) {
      return integrations.shopifyContentWrite
        ? 'Shopify blog draft'
        : 'Blog calendar + MCP prompt';
    }
    if (route.mode === 'automated_write') {
      return integrations.shopifyWrite ? 'Shopify SEO write' : 'Shopify SEO draft only';
    }
    return 'Assist deliverable';
  }

  private actionExecutingDetail(
    route: ReturnType<typeof resolveActionRoute>,
    integrations: OrgIntegrationFlags
  ): string {
    if (route.mode === 'assist') return 'Generating deliverable with Claude…';
    if (route.executionType === 'create_meta_ads_campaign') {
      return 'Drafting Meta campaign with Claude…';
    }
    if (route.executionType === 'create_mailchimp_drafts') {
      return 'Drafting Mailchimp email sequence with Claude…';
    }
    if (route.executionType === 'create_google_ads_campaign') {
      return 'Drafting Google Search campaign with Claude…';
    }
    if (route.executionType === 'publish_instagram_photo') {
      return 'Exporting creative (Canva if requested) and publishing photo to Instagram…';
    }
    if (route.executionType === 'publish_instagram_story') {
      return 'Publishing to Instagram Stories…';
    }
    if (route.executionType === 'publish_instagram_reel') {
      return 'Generating Runway AI video (5s) and publishing Instagram Reel…';
    }
    if (route.executionType === 'create_shopify_blog_article') {
      return integrations.shopifyContentWrite
        ? 'Writing blog article with Claude…'
        : 'Drafting blog article + Claude.ai Shopify MCP prompt…';
    }
    if (route.executionType === 'create_shopify_page') {
      return integrations.shopifyContentWrite
        ? 'Writing store page content with Claude…'
        : 'Drafting page + Claude.ai Shopify MCP prompt…';
    }
    return 'Loading Shopify product and drafting SEO changes…';
  }

  private agentTaskCompleteDetail(
    result: ExecutionPreviewResponse,
    execution: ExecutionRecord
  ): string {
    const base = result.scopeWarning ?? execution.summary;
    const state = execution.proposedState;
    if (state.kind !== 'instagram_publish') return base;

    const parts = [base];
    if (state.imageSource === 'canva') {
      parts.push(
        state.canvaDesignId
          ? `Canva design ${state.canvaDesignId} exported`
          : 'Creative exported from Canva'
      );
      if (state.canvaEditUrl) parts.push(`Edit in Canva: ${state.canvaEditUrl}`);
    } else if (state.mediaType === 'reel' || state.imageSource === 'runway') {
      parts.push(
        state.runwayTaskId
          ? `Runway AI video ${state.runwayTaskId}`
          : 'Runway AI video Reel'
      );
    } else if (state.imageSource) {
      parts.push(`Image source: ${state.imageSource}`);
    }
    if (state.imageRationale) parts.push(state.imageRationale.slice(0, 220));
    if (state.permalink) parts.push(state.permalink);
    return parts.filter(Boolean).join(' · ');
  }

  private async executeActionPreviewForAction(
    organizationId: string,
    strategyId: string,
    action: PlanAction,
    strategy: NonNullable<Awaited<ReturnType<StrategyService['getById']>>>,
    route: ReturnType<typeof resolveActionRoute>,
    integrations: OrgIntegrationFlags,
    agentBrief?: AgentExecutionBrief | null
  ): Promise<ExecutionPreviewResponse> {
    if (route.mode === 'assist') {
      return this.runAssist(
        organizationId,
        strategyId,
        action,
        strategy,
        route,
        agentBrief
      );
    }

    if (
      route.executionType === 'publish_instagram_photo' ||
      route.executionType === 'publish_instagram_story' ||
      route.executionType === 'publish_instagram_reel'
    ) {
      return this.runInstagramPublish(
        organizationId,
        strategyId,
        action,
        strategy,
        route,
        agentBrief
      );
    }

    if (route.executionType === 'create_shopify_blog_article') {
      return this.runShopifyBlogPreview(
        organizationId,
        strategyId,
        action,
        strategy,
        route,
        integrations.shopifyContentWrite
      );
    }

    if (route.executionType === 'create_shopify_page') {
      return this.runShopifyPagePreview(
        organizationId,
        strategyId,
        action,
        strategy,
        route,
        integrations.shopifyContentWrite
      );
    }

    if (route.executionType === 'create_google_ads_campaign') {
      return this.runGoogleAdsCampaignPreview(
        organizationId,
        strategyId,
        action,
        strategy,
        route
      );
    }

    if (route.executionType === 'create_meta_ads_campaign') {
      return this.runMetaAdsCampaignPreview(
        organizationId,
        strategyId,
        action,
        strategy,
        route
      );
    }

    if (route.executionType === 'create_mailchimp_drafts') {
      return this.runMailchimpSequencePreview(
        organizationId,
        strategyId,
        action,
        strategy,
        route
      );
    }

    return this.runShopifyProductSeoPreview(
      organizationId,
      strategyId,
      action,
      route,
      integrations.shopifyWrite
    );
  }

  private async executeActionPreview(
    organizationId: string,
    strategyId: string,
    actionId: string
  ): Promise<ExecutionPreviewResponse> {
    const { strategy, action } = await this.loadAction(organizationId, strategyId, actionId);
    const integrations = await this.getIntegrationFlags(organizationId);
    const route = resolveActionRoute(action, integrations);
    return this.executeActionPreviewForAction(
      organizationId,
      strategyId,
      action,
      strategy,
      route,
      integrations
    );
  }

  /** Conversational agent chat — may clarify, then run one supported action. */
  async runAgentTask(
    organizationId: string,
    strategyId: string,
    message: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<{
    reply: string;
    supported: boolean;
    unsupportedReason?: string;
    needsClarification?: boolean;
    sentiment?: string;
    action?: PlanAction;
    routing?: string;
    result?: ExecutionPreviewResponse;
    needsHumanGate?: boolean;
  }> {
    const strategy = await this.strategy.getById(organizationId, strategyId);
    if (!strategy) {
      throw new Error('Plan not found');
    }

    const integrations = await this.getIntegrationFlags(organizationId);
    const connectedPlatforms: string[] = [];
    if (integrations.shopify) connectedPlatforms.push('Shopify');
    if (integrations.canvaReady) connectedPlatforms.push('Canva');
    if (integrations.runwayReady) connectedPlatforms.push('Runway');
    if (integrations.instagramReady) connectedPlatforms.push('Instagram');
    if (integrations.mailchimpReady) connectedPlatforms.push('Mailchimp');
    if (integrations.metaAdsReady) connectedPlatforms.push('Meta Ads');
    if (integrations.googleAdsReady) connectedPlatforms.push('Google Ads');

    const profile = await getBusinessProfile(organizationId);
    const brandProfile =
      formatBusinessProfileForPrompt(profile) ||
      [profile.website, profile.oneLiner, profile.audience, profile.offer]
        .filter(Boolean)
        .join(' · ') ||
      strategy.context ||
      'Brand profile not filled in yet — use Keylo / workspace context if known.';

    const learningCtx = await this.learning
      .getPatternsForPlanning(organizationId, strategy.goal)
      .catch(() => ({
        promptSection: '',
        patterns: [],
        applied: [],
      }));

    const recipesForPrompt = await this.recipes
      .formatForPrompt(organizationId, 16)
      .catch(() => '');

    const visualsForPrompt = await this.visuals
      .formatForPrompt(organizationId, 12)
      .catch(() => '');

    const knowledgeExtras = [
      recipesForPrompt
        ? `SAVED CONTENT RECIPES:\n${recipesForPrompt}`
        : '',
      visualsForPrompt
        ? `BRAND VISUAL LIBRARY (prefer these image URLs + themes for Instagram stills):\n${visualsForPrompt}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    let parsed = await this.claude.parseAgentTask({
      message,
      goal: strategy.goal,
      brandProfile,
      businessContext: brandProfile,
      connectedPlatforms,
      mcpCapabilities: this.buildMcpCapabilityNotes(integrations),
      learningKnowledge: learningCtx.promptSection || undefined,
      contentRecipes: knowledgeExtras || undefined,
      history,
    });

    if (!parsed.action && this.isAdHocInstagramContentRequest(message, history)) {
      parsed = {
        ...parsed,
        supported: true,
        needsClarification: false,
        action: this.buildAdHocInstagramAction(message, strategy.goal),
        executionBrief: parsed.executionBrief ?? inferAgentBriefFallback(message, history),
      };
    }

    if (parsed.needsClarification && !parsed.action) {
      return {
        reply: parsed.reply,
        supported: false,
        needsClarification: true,
        sentiment: parsed.sentiment,
        unsupportedReason:
          parsed.unsupportedReason ??
          'Tell me one more detail (product name or vibe) and I will publish.',
      };
    }

    if (!parsed.action) {
      return {
        reply: parsed.reply,
        supported: false,
        sentiment: parsed.sentiment,
        unsupportedReason:
          parsed.unsupportedReason ?? 'This request could not be mapped to a supported action.',
      };
    }

    const action = parsed.action;
    let agentBrief = this.mergeAgentExecutionBrief(parsed.executionBrief, message, history);
    const matchedRecipe = await this.recipes
      .matchFromBrief(
        organizationId,
        `${agentBrief.recipeSlug ?? ''} ${agentBrief.fullRequest} ${message}`
      )
      .catch(() => null);
    if (matchedRecipe) {
      agentBrief = {
        ...agentBrief,
        recipeSlug: matchedRecipe.slug,
        mediaFormat:
          matchedRecipe.medium === 'image'
            ? agentBrief.mediaFormat === 'carousel'
              ? 'carousel'
              : 'feed'
            : agentBrief.mediaFormat === 'story'
              ? 'story'
              : 'reel',
        videoSource: matchedRecipe.medium === 'video' ? 'runway' : undefined,
      };
    }
    const week = strategy.currentWeek;
    const route = resolveAdHocActionRoute(action, integrations, agentBrief);
    const routing = explainActionRoute(action, integrations);

    await this.activity.log({
      organizationId,
      strategyId,
      weekNumber: week,
      actionId: action.id,
      step: 'agent_task',
      title: `Ask: ${message.slice(0, 80)}${message.length > 80 ? '…' : ''}`,
      detail: parsed.reply,
      status: 'info',
    });

    await this.activity.log({
      organizationId,
      strategyId,
      weekNumber: week,
      actionId: action.id,
      step: 'decision',
      title: `Decision: ${this.actionDecisionLabel(action, route, integrations)}`,
      detail: routing,
      status: 'info',
    });

    await this.activity.log({
      organizationId,
      strategyId,
      weekNumber: week,
      actionId: action.id,
      step: 'executing',
      title: action.title,
      detail: this.actionExecutingDetail(route, integrations),
      status: 'running',
    });

    try {
      let result = await this.executeActionPreviewForAction(
        organizationId,
        strategyId,
        action,
        strategy,
        route,
        integrations,
        agentBrief
      );
      let execution = result.execution;

      if (this.canAutoApplyExecution(execution, integrations)) {
        try {
          execution = await this.tryAutoApplyExecution(
            organizationId,
            strategyId,
            execution,
            integrations,
            week,
            action.id
          );
          result = { ...result, execution };
        } catch {
          // Keep preview if auto-apply fails.
        }
      }

      const isPaidAd =
        execution.executionType === 'create_meta_ads_campaign' ||
        execution.executionType === 'create_google_ads_campaign';
      const needsHumanGate = isPaidAd && execution.status === 'executed';

      const aiReasoning = extractPayloadReasoning(execution.proposedState);
      if (aiReasoning) {
        await this.activity.log({
          organizationId,
          strategyId,
          weekNumber: week,
          actionId: action.id,
          step: 'ai_reasoning',
          title: `Why: ${action.title}`,
          detail: aiReasoning,
          status: 'info',
        });
      }

      const completeDetail = this.agentTaskCompleteDetail(result, execution);

      await this.activity.log({
        organizationId,
        strategyId,
        weekNumber: week,
        actionId: action.id,
        step: 'complete',
        title:
          execution.status === 'executed'
            ? this.publishedDoneTitle(execution, action)
            : `Ready: ${action.title}`,
        detail: completeDetail,
        status: 'success',
      });

      return {
        reply: parsed.reply,
        supported: true,
        sentiment: parsed.sentiment,
        action,
        routing,
        result,
        needsHumanGate,
      };
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : 'Failed';
      await this.activity.log({
        organizationId,
        strategyId,
        weekNumber: week,
        actionId: action.id,
        step: 'failed',
        title: `Failed: ${action.title}`,
        detail: errMessage,
        status: 'error',
      });
      throw err;
    }
  }

  /** Prepare a week and auto-create campaigns / Shopify changes when integrations allow. */
  async runWeekAutopilot(
    organizationId: string,
    strategyId: string,
    week: number,
    _autoApply: boolean,
    confirm = true
  ): Promise<BatchRunResponse> {
    return this.runWeekBatch(organizationId, strategyId, week, { confirm });
  }

  private canAutoApplyExecution(
    execution: ExecutionRecord,
    integrations: OrgIntegrationFlags
  ): boolean {
    if (execution.status !== 'previewed') {
      return false;
    }
    switch (execution.executionType) {
      case 'update_product_seo':
        return integrations.shopifyWrite;
      case 'create_shopify_page':
        return integrations.shopifyContentWrite;
      case 'create_shopify_blog_article':
        return integrations.shopifyContentWrite;
      case 'create_google_ads_campaign':
        return (
          isGoogleAdsEnabled() &&
          integrations.googleAdsReady &&
          Boolean(process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim())
        );
      case 'create_meta_ads_campaign':
        return integrations.metaAdsReady;
      case 'create_mailchimp_drafts':
        return integrations.mailchimpReady;
      default:
        return false;
    }
  }

  private autoApplyTitle(execution: ExecutionRecord): string {
    switch (execution.executionType) {
      case 'create_meta_ads_campaign':
        return 'Agent: generating creatives + creating paused Meta campaign';
      case 'create_google_ads_campaign':
        return 'Agent: creating paused Google Ads campaign';
      case 'create_mailchimp_drafts':
        return 'Agent: creating Mailchimp draft campaigns';
      case 'create_shopify_page':
        return 'Agent: creating Shopify page';
      case 'create_shopify_blog_article':
        return 'Agent: publishing Shopify blog article';
      default:
        return 'Agent: applying Shopify change';
    }
  }

  private autoApplyDoneTitle(execution: ExecutionRecord): string {
    switch (execution.executionType) {
      case 'publish_instagram_photo':
        return 'Published: Instagram post';
      case 'publish_instagram_story':
        return 'Published: Instagram story';
      case 'publish_instagram_reel':
        return 'Published: Instagram Reel';
      case 'create_meta_ads_campaign':
        return 'Published: Meta campaign (paused — you enable spend)';
      case 'create_google_ads_campaign':
        return 'Published: Google Ads campaign (paused)';
      case 'create_mailchimp_drafts':
        return 'Published: Mailchimp email drafts (you send)';
      case 'create_shopify_page':
        return 'Published: Shopify page';
      case 'create_shopify_blog_article':
        return 'Published: Shopify blog article';
      default:
        return 'Published: Shopify change';
    }
  }

  /** Clear activity-log title once something actually went live (or was drafted in-channel). */
  private publishedDoneTitle(execution: ExecutionRecord, action: PlanAction): string {
    const state = execution.proposedState;
    switch (execution.executionType) {
      case 'publish_instagram_photo':
      case 'publish_instagram_story':
      case 'publish_instagram_reel': {
        if (state.kind === 'instagram_publish') {
          if (state.mediaType === 'carousel') {
            return `Published: Instagram carousel — ${action.title}`;
          }
          if (state.mediaType === 'reel') {
            return `Published: Instagram Reel — ${action.title}`;
          }
          if (state.mediaType === 'story') {
            return `Published: Instagram story — ${action.title}`;
          }
          return `Published: Instagram post — ${action.title}`;
        }
        return `Published: Instagram — ${action.title}`;
      }
      case 'create_shopify_page':
        return `Published: Shopify page — ${action.title}`;
      case 'create_shopify_blog_article':
        return `Published: Shopify blog — ${action.title}`;
      case 'create_mailchimp_drafts':
        return `Published: Mailchimp drafts — ${action.title}`;
      case 'create_meta_ads_campaign':
        return `Published: Meta campaign (paused) — ${action.title}`;
      case 'create_google_ads_campaign':
        return `Published: Google Ads (paused) — ${action.title}`;
      default:
        return `Published: ${action.title}`;
    }
  }

  private async tryAutoApplyExecution(
    organizationId: string,
    strategyId: string,
    execution: ExecutionRecord,
    integrations: OrgIntegrationFlags,
    week: number,
    actionId: string
  ): Promise<ExecutionRecord> {
    if (!this.canAutoApplyExecution(execution, integrations)) {
      return execution;
    }

    if (execution.executionType === 'create_meta_ads_campaign') {
      const throttle = await evaluateMetaAdsCreateThrottle(organizationId);
      if (!throttle.allowCreate) {
        await this.activity.log({
          organizationId,
          strategyId,
          weekNumber: week,
          actionId,
          step: 'awaiting_human',
          title: 'Skipped Meta create — waiting for spend data',
          detail: throttle.reason,
          status: 'warn',
        });
        return execution;
      }
    }

    const pace = await getAutopilotPace(organizationId);
    const caps = await evaluateChannelCaps(organizationId, pace, execution.executionType);
    if (!caps.allow) {
      await this.activity.log({
        organizationId,
        strategyId,
        weekNumber: week,
        actionId,
        step: 'awaiting_human',
        title: `Skipped — ${getPaceProfile(pace).label} pace cap`,
        detail: caps.reason ?? 'Channel cap reached',
        status: 'warn',
      });
      return execution;
    }

    await this.activity.log({
      organizationId,
      strategyId,
      weekNumber: week,
      actionId,
      step: 'auto_apply',
      title: this.autoApplyTitle(execution),
      detail: execution.summary,
      status: 'running',
    });

    try {
      const approved = await this.approve(organizationId, execution.id);
      await this.activity.log({
        organizationId,
        strategyId,
        weekNumber: week,
        actionId,
        step: 'auto_apply_done',
        title: this.autoApplyDoneTitle(approved),
        detail: approved.summary,
        status: 'success',
      });
      if (approved.status === 'executed' || approved.status === 'skipped') {
        await this.markPlanActionComplete(organizationId, strategyId, actionId);
      }
      return approved;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Auto-create failed';
      const failed = await query<ExecutionRow>(
        `UPDATE action_executions SET error_message = $3, updated_at = NOW()
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [execution.id, organizationId, message.slice(0, 2000)]
      );
      await this.activity.log({
        organizationId,
        strategyId,
        weekNumber: week,
        actionId,
        step: 'auto_apply_failed',
        title: 'Auto-create failed',
        detail: message,
        status: 'error',
      });
      return failed.rows[0] ? mapRow(failed.rows[0]) : execution;
    }
  }

  private metaCreatedSummary(campaignName: string, campaignId: string): string {
    return `Created paused Meta campaign "${campaignName}" with creatives (ID ${campaignId}) — enable spend in Ads Manager when ready.`;
  }

  private googleCreatedSummary(campaignName: string): string {
    return `Created paused Google Ads campaign "${campaignName}" — enable it in Google Ads when ready.`;
  }

  /**
   * Approves an execution and performs its external write.
   *
   * Every path below actuates something irreversible on a third-party platform
   * — a live Shopify page, a published Instagram post, a funded ad campaign. So
   * the execution is claimed atomically first (see claimExecutionForWrite) and
   * only the caller that wins the claim proceeds. A losing caller gets a clear
   * error rather than silently duplicating the write.
   */
  async approve(
    organizationId: string,
    executionId: string,
    edits?: Partial<Pick<ProductSeoState, 'seoTitle' | 'seoDescription'>>
  ): Promise<ExecutionRecord> {
    // Read first purely to produce a useful message for the common,
    // non-racing failure cases (wrong status, unsupported type).
    const existing = await this.getRow(organizationId, executionId);
    if (existing.status !== 'previewed') {
      throw new Error(`Cannot approve execution in status "${existing.status}"`);
    }
    if (
      existing.execution_type !== 'create_shopify_page' &&
      existing.execution_type !== 'create_shopify_blog_article' &&
      existing.execution_type !== 'create_google_ads_campaign' &&
      existing.execution_type !== 'create_meta_ads_campaign' &&
      existing.execution_type !== 'create_mailchimp_drafts' &&
      existing.execution_type !== 'update_product_seo'
    ) {
      throw new Error('Only Shopify or ad platform writes require approval');
    }

    const row = await this.claimExecutionForWrite(organizationId, executionId);
    if (!row) {
      // Lost the race. Report the state the winner left behind so the caller
      // (or the activity log) shows what actually happened.
      const current = await this.getRow(organizationId, executionId);
      throw new Error(
        current.status === 'executing'
          ? 'This execution is already running — another approval is in flight.'
          : `Cannot approve execution in status "${current.status}"`
      );
    }

    try {
      switch (row.execution_type) {
        case 'create_shopify_page':
          return await this.approveShopifyPage(organizationId, executionId, row);
        case 'create_shopify_blog_article':
          return await this.approveShopifyBlogArticle(organizationId, executionId, row);
        case 'create_google_ads_campaign':
          return await this.approveGoogleAdsCampaign(organizationId, executionId, row);
        case 'create_meta_ads_campaign':
          return await this.approveMetaAdsCampaign(organizationId, executionId, row);
        case 'create_mailchimp_drafts':
          return await this.approveMailchimpSequence(organizationId, executionId, row);
        default:
          return await this.approveProductSeo(organizationId, executionId, row, edits);
      }
    } catch (err) {
      // No-op when the handler already reached 'failed'; restores 'previewed'
      // when the throw came from a pre-flight refusal (missing scope, channel
      // cap, SEO cooldown) that never touched the external API.
      await this.releaseExecutionClaim(organizationId, executionId);
      throw err;
    }
  }

  private async approveProductSeo(
    organizationId: string,
    executionId: string,
    row: ExecutionRow,
    edits?: Partial<Pick<ProductSeoState, 'seoTitle' | 'seoDescription'>>
  ): Promise<ExecutionRecord> {
    const ctx = await this.mcp.getShopifyContext(organizationId);
    if (!ctx) {
      throw new Error('Shopify is not connected');
    }

    const config = await this.mcp.getPlatformConfig(organizationId, 'shopify');
    if (!shopifyHasWriteProductsScope(config?.grantedScopes)) {
      throw new Error(
        'Missing write_products scope. Disconnect and reconnect Shopify, then approve all requested permissions.'
      );
    }

    const proposed = asProductSeo(row.proposed_state);
    const pace = await getAutopilotPace(organizationId);
    const caps = await evaluateChannelCaps(organizationId, pace, 'update_product_seo');
    if (!caps.allow) {
      throw new Error(caps.reason ?? 'Product SEO daily cap reached');
    }
    const cooldown = await getSeoCooldownTargets(organizationId, pace);
    if (cooldown.productIds.has(proposed.productId)) {
      throw new Error(
        `This product was SEO-updated within the last ${cooldown.cooldownDays} days. Waiting for rankings to settle.`
      );
    }

    const toApply: ProductSeoState = {
      ...proposed,
      seoTitle: edits?.seoTitle?.trim() || proposed.seoTitle,
      seoDescription: edits?.seoDescription?.trim() || proposed.seoDescription,
    };

    try {
      const after = await this.shopify.applyProductSeo(
        ctx.shopDomain,
        ctx.accessToken,
        toApply
      );

      const updated = await query<ExecutionRow>(
        `UPDATE action_executions SET
           status = 'executed',
           before_state = COALESCE(before_state, proposed_state),
           proposed_state = $3::jsonb,
           after_state = $4::jsonb,
           error_message = NULL,
           executed_at = NOW(),
           updated_at = NOW()
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [executionId, organizationId, JSON.stringify(toApply), JSON.stringify(after)]
      );

      const execution = mapRow(updated.rows[0]);

      await this.audit.recordExecutionWrite({
        organizationId,
        strategyId: execution.strategyId,
        eventType: 'action_executed',
        executionId: execution.id,
        actionId: execution.actionId,
        platform: execution.platform,
        beforeState: execution.beforeState,
        afterState: after,
        summary: execution.summary,
      });

      return execution;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Execution failed';
      await query(
        `UPDATE action_executions SET status = 'failed', error_message = $3, updated_at = NOW()
         WHERE id = $1 AND organization_id = $2`,
        [executionId, organizationId, message.slice(0, 2000)]
      );
      throw err;
    }
  }

  private async approveShopifyPage(
    organizationId: string,
    executionId: string,
    row: ExecutionRow
  ): Promise<ExecutionRecord> {
    const ctx = await this.mcp.getShopifyContext(organizationId);
    if (!ctx) {
      throw new Error('Shopify is not connected');
    }

    const config = await this.mcp.getPlatformConfig(organizationId, 'shopify');
    if (!shopifyHasWriteContentScope(config?.grantedScopes)) {
      throw new Error(
        'Missing write_content scope. Disconnect and reconnect Shopify, then approve all requested permissions.'
      );
    }

    const proposed = asShopifyPage(row.proposed_state);

    try {
      const after = await this.shopify.createPage(ctx.shopDomain, ctx.accessToken, proposed);
      const pageUrl = shopStorefrontUrl(after.shopDomain ?? ctx.shopDomain, `/pages/${after.handle}`);
      const createdSummary = after.isPublished
        ? `Published Shopify page "${after.title}" — ${pageUrl}`
        : `Created Shopify page draft "${after.title}" — ${pageUrl}`;

      const updated = await query<ExecutionRow>(
        `UPDATE action_executions SET
           status = 'executed',
           before_state = NULL,
           proposed_state = $3::jsonb,
           after_state = $4::jsonb,
           summary = $5,
           error_message = NULL,
           executed_at = NOW(),
           updated_at = NOW()
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [
          executionId,
          organizationId,
          JSON.stringify(after),
          JSON.stringify(after),
          createdSummary,
        ]
      );

      const execution = mapRow(updated.rows[0]);

      await this.audit.recordExecutionWrite({
        organizationId,
        strategyId: execution.strategyId,
        eventType: 'action_executed',
        executionId: execution.id,
        actionId: execution.actionId,
        platform: execution.platform,
        beforeState: null,
        afterState: after,
        summary: createdSummary,
      });

      return execution;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Execution failed';
      await query(
        `UPDATE action_executions SET status = 'failed', error_message = $3, updated_at = NOW()
         WHERE id = $1 AND organization_id = $2`,
        [executionId, organizationId, message.slice(0, 2000)]
      );
      throw err;
    }
  }

  private async approveGoogleAdsCampaign(
    organizationId: string,
    executionId: string,
    row: ExecutionRow
  ): Promise<ExecutionRecord> {
    const proposed = asGoogleAdsCampaign(row.proposed_state);

    try {
      const after = await this.googleAdsCampaign.createPausedCampaign(organizationId, proposed);
      const createdSummary = this.googleCreatedSummary(after.campaignName);

      const updated = await query<ExecutionRow>(
        `UPDATE action_executions SET
           status = 'executed',
           before_state = NULL,
           proposed_state = $3::jsonb,
           after_state = $4::jsonb,
           summary = $5,
           error_message = NULL,
           executed_at = NOW(),
           updated_at = NOW()
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [executionId, organizationId, JSON.stringify(after), JSON.stringify(after), createdSummary]
      );

      const execution = mapRow(updated.rows[0]);

      await this.audit.recordExecutionWrite({
        organizationId,
        strategyId: execution.strategyId,
        eventType: 'action_executed',
        executionId: execution.id,
        actionId: execution.actionId,
        platform: execution.platform,
        beforeState: null,
        afterState: after,
        summary: createdSummary,
      });

      return execution;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Execution failed';
      await query(
        `UPDATE action_executions SET status = 'failed', error_message = $3, updated_at = NOW()
         WHERE id = $1 AND organization_id = $2`,
        [executionId, organizationId, message.slice(0, 2000)]
      );
      throw err;
    }
  }

  private async approveMetaAdsCampaign(
    organizationId: string,
    executionId: string,
    row: ExecutionRow
  ): Promise<ExecutionRecord> {
    const proposed = asMetaAdsCampaign(row.proposed_state);

    try {
      if (!proposed.campaignId) {
        const throttle = await evaluateMetaAdsCreateThrottle(organizationId);
        if (!throttle.allowCreate) {
          throw new Error(throttle.reason);
        }
      }

      let proposal = proposed;
      try {
        proposal = await this.adCampaignLibrary.enrichWithCreatives(
          organizationId,
          proposed,
          {
            sourceExecutionId: executionId,
            channel: 'meta',
            prefer: 'auto',
          }
        );
      } catch (creativeErr) {
        log.warn(
          'Meta creative prep skipped:',
          creativeErr instanceof Error ? creativeErr.message : creativeErr
        );
      }

      const after = await this.metaAdsCampaign.createPausedCampaign(organizationId, proposal);
      const createdSummary = this.metaCreatedSummary(after.campaignName, after.campaignId);

      const updated = await query<ExecutionRow>(
        `UPDATE action_executions SET
           status = 'executed',
           before_state = NULL,
           proposed_state = $3::jsonb,
           after_state = $4::jsonb,
           summary = $5,
           error_message = NULL,
           executed_at = NOW(),
           updated_at = NOW()
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [executionId, organizationId, JSON.stringify(after), JSON.stringify(after), createdSummary]
      );

      const execution = mapRow(updated.rows[0]);

      try {
        await this.adCampaignLibrary.upsertFromMetaState(organizationId, after, {
          sourceExecutionId: execution.id,
          channel: 'meta',
        });
      } catch (libErr) {
        log.warn(
          'failed to save Meta campaign to ads library:',
          libErr instanceof Error ? libErr.message : libErr
        );
      }

      await this.audit.recordExecutionWrite({
        organizationId,
        strategyId: execution.strategyId,
        eventType: 'action_executed',
        executionId: execution.id,
        actionId: execution.actionId,
        platform: execution.platform,
        beforeState: null,
        afterState: after,
        summary: createdSummary,
      });

      return execution;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Execution failed';
      await query(
        `UPDATE action_executions SET status = 'failed', error_message = $3, updated_at = NOW()
         WHERE id = $1 AND organization_id = $2`,
        [executionId, organizationId, message.slice(0, 2000)]
      );
      throw err;
    }
  }

  private async approveMailchimpSequence(
    organizationId: string,
    executionId: string,
    row: ExecutionRow
  ): Promise<ExecutionRecord> {
    const proposed = asMailchimpSequence(row.proposed_state);
    const ctx = await this.mcp.getMailchimpContext(organizationId);
    if (!ctx?.defaultListId) {
      throw new Error('Mailchimp is not connected or no default audience is selected');
    }

    try {
      const after = await this.mailchimpExecution.createDraftSequence(ctx, proposed);
      const count = after.createdCampaigns?.length ?? after.emails.length;
      const archiveUrl = after.createdCampaigns?.find((c) => c.archiveUrl?.startsWith('http'))
        ?.archiveUrl;
      const createdSummary = archiveUrl
        ? `Created ${count} Mailchimp draft(s) for "${after.sequenceName}" — open: ${archiveUrl} (you send from Mailchimp; never auto-sent).`
        : `Created ${count} Mailchimp draft campaign(s) for "${after.sequenceName}" — review and send in Mailchimp (Hundres never auto-sends).`;

      const updated = await query<ExecutionRow>(
        `UPDATE action_executions SET
           status = 'executed',
           before_state = NULL,
           proposed_state = $3::jsonb,
           after_state = $4::jsonb,
           summary = $5,
           error_message = NULL,
           executed_at = NOW(),
           updated_at = NOW()
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [executionId, organizationId, JSON.stringify(after), JSON.stringify(after), createdSummary]
      );

      const execution = mapRow(updated.rows[0]);

      await this.audit.recordExecutionWrite({
        organizationId,
        strategyId: execution.strategyId,
        eventType: 'action_executed',
        executionId: execution.id,
        actionId: execution.actionId,
        platform: execution.platform,
        beforeState: null,
        afterState: after,
        summary: createdSummary,
      });

      return execution;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Execution failed';
      await query(
        `UPDATE action_executions SET status = 'failed', error_message = $3, updated_at = NOW()
         WHERE id = $1 AND organization_id = $2`,
        [executionId, organizationId, message.slice(0, 2000)]
      );
      throw err;
    }
  }

  async skip(organizationId: string, executionId: string): Promise<ExecutionRecord> {
    const row = await this.getRow(organizationId, executionId);
    if (row.status !== 'previewed') {
      throw new Error(`Cannot skip execution in status "${row.status}"`);
    }

    const updated = await query<ExecutionRow>(
      `UPDATE action_executions SET status = 'skipped', updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 RETURNING *`,
      [executionId, organizationId]
    );

    return mapRow(updated.rows[0]);
  }

  async rollback(organizationId: string, executionId: string): Promise<ExecutionRecord> {
    const row = await this.getRow(organizationId, executionId);
    if (row.status !== 'executed') {
      throw new Error('Only executed actions can be rolled back');
    }

    if (row.execution_type === 'create_shopify_page') {
      return this.rollbackShopifyPage(organizationId, executionId, row);
    }

    if (row.execution_type === 'create_shopify_blog_article') {
      return this.rollbackShopifyBlogArticle(organizationId, executionId, row);
    }

    if (row.execution_type !== 'update_product_seo') {
      throw new Error('Rollback is only available for Shopify writes');
    }
    if (!row.before_state) {
      throw new Error('No before-state stored for rollback');
    }

    return this.rollbackProductSeo(organizationId, executionId, row);
  }

  private async rollbackProductSeo(
    organizationId: string,
    executionId: string,
    row: ExecutionRow
  ): Promise<ExecutionRecord> {
    const ctx = await this.mcp.getShopifyContext(organizationId);
    if (!ctx) {
      throw new Error('Shopify is not connected');
    }

    const restored = await this.shopify.applyProductSeo(
      ctx.shopDomain,
      ctx.accessToken,
      asProductSeo(row.before_state!)
    );

    const updated = await query<ExecutionRow>(
      `UPDATE action_executions SET
         status = 'rolled_back',
         after_state = $3::jsonb,
         rolled_back_at = NOW(),
         updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 RETURNING *`,
      [executionId, organizationId, JSON.stringify(restored)]
    );

    const execution = mapRow(updated.rows[0]);

    await this.audit.recordExecutionWrite({
      organizationId,
      strategyId: execution.strategyId,
      eventType: 'action_rolled_back',
      executionId: execution.id,
      actionId: execution.actionId,
      platform: execution.platform,
      beforeState: row.after_state,
      afterState: restored,
      summary: `Rollback for ${execution.targetLabel ?? execution.actionId}`,
    });

    return execution;
  }

  private async rollbackShopifyPage(
    organizationId: string,
    executionId: string,
    row: ExecutionRow
  ): Promise<ExecutionRecord> {
    const afterState = row.after_state ? asShopifyPage(row.after_state) : null;
    if (!afterState?.pageId) {
      throw new Error('No page ID stored for rollback');
    }

    const ctx = await this.mcp.getShopifyContext(organizationId);
    if (!ctx) {
      throw new Error('Shopify is not connected');
    }

    await this.shopify.deletePage(ctx.shopDomain, ctx.accessToken, afterState.pageId);

    const updated = await query<ExecutionRow>(
      `UPDATE action_executions SET
         status = 'rolled_back',
         rolled_back_at = NOW(),
         updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 RETURNING *`,
      [executionId, organizationId]
    );

    const execution = mapRow(updated.rows[0]);

    await this.audit.recordExecutionWrite({
      organizationId,
      strategyId: execution.strategyId,
      eventType: 'action_rolled_back',
      executionId: execution.id,
      actionId: execution.actionId,
      platform: execution.platform,
      beforeState: afterState,
      afterState: null,
      summary: `Deleted page "${afterState.title}" during rollback`,
    });

    return execution;
  }

  private isAdHocInstagramContentRequest(
    message: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
  ): boolean {
    const blob = inferAgentBriefFallback(message, history).fullRequest.toLowerCase();
    return (
      /\bugc\b|user.?generated/.test(blob) ||
      (/instagram/.test(blob) &&
        /post|publish|reel|story|carousel|photo|video/.test(blob))
    );
  }

  private buildAdHocInstagramAction(message: string, goal: string): PlanAction {
    const brief = inferAgentBriefFallback(message);
    const blob = brief.fullRequest.toLowerCase();
    const isUgc = /\bugc\b|user.?generated/.test(blob);
    const isReel =
      brief.mediaFormat === 'reel' ||
      brief.videoSource === 'runway' ||
      isUgc ||
      /\breels?\b|\bvideo\b/.test(blob);
    const title = isUgc
      ? `Instagram UGC Reel: ${brief.ctaText ?? 'brand product'}`
      : isReel
        ? `Instagram Reel: ${brief.ctaText ?? 'brand highlight'}`
        : `Instagram feed post: ${brief.ctaText ?? 'brand highlight'}`;
    return {
      id: `adhoc-${randomUUID()}`,
      title,
      channel: 'instagram',
      day: 'NOW',
      time: '5 min',
      impact: 'high',
      difficulty: 'Easy',
      why: `Ad-hoc Ask request toward: ${goal}`,
      outcome: title,
      kpi: 'engagement',
    };
  }

  private mergeAgentExecutionBrief(
    fromParser: Partial<AgentExecutionBrief> | undefined,
    message: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
  ): AgentExecutionBrief {
    const fallback = inferAgentBriefFallback(message, history);
    const recipeSlug = fromParser?.recipeSlug?.trim() || fallback.recipeSlug;
    const videoSource = fromParser?.videoSource ?? fallback.videoSource;
    let mediaFormat = fromParser?.mediaFormat ?? fallback.mediaFormat;
    const imageRecipe =
      recipeSlug === 'runway-text-to-image' ||
      recipeSlug === 'runway-product-campaign-image' ||
      mediaFormat === 'feed' ||
      mediaFormat === 'carousel' ||
      /\b(image|photo|still|feed)\b/.test(recipeSlug ?? '');
    // Video + Runway requests must never silently become static feed photos —
    // except when the recipe/format is explicitly still/image.
    if (videoSource === 'runway' && mediaFormat !== 'story' && !imageRecipe) {
      mediaFormat = 'reel';
    }
    if (!mediaFormat && fallback.mediaFormat) {
      mediaFormat = fallback.mediaFormat;
    }
    return {
      fullRequest: fromParser?.fullRequest?.trim() || fallback.fullRequest,
      imageSource: fromParser?.imageSource ?? fallback.imageSource,
      imageSearchQuery: fromParser?.imageSearchQuery?.trim() || fallback.imageSearchQuery,
      slideCount: fromParser?.slideCount ?? fallback.slideCount,
      ctaText: fromParser?.ctaText?.trim() || fallback.ctaText,
      mediaFormat: imageRecipe && mediaFormat === 'reel' ? 'feed' : mediaFormat,
      videoUrl: fromParser?.videoUrl?.trim() || fallback.videoUrl,
      videoSource: imageRecipe ? undefined : videoSource,
      recipeSlug,
      productImageUrl: fromParser?.productImageUrl?.trim() || undefined,
      characterImageUrl: fromParser?.characterImageUrl?.trim() || undefined,
    };
  }

  private async runInstagramPublish(
    organizationId: string,
    strategyId: string,
    action: PlanAction,
    strategy: NonNullable<Awaited<ReturnType<StrategyService['getById']>>>,
    route: ReturnType<typeof resolveActionRoute>,
    agentBrief?: AgentExecutionBrief | null
  ): Promise<ExecutionPreviewResponse> {
    const pace = await getAutopilotPace(organizationId);
    const caps = await evaluateChannelCaps(organizationId, pace, route.executionType);
    if (!caps.allow) {
      throw new Error(caps.reason ?? 'Instagram pace cap reached');
    }

    const profile = await getBusinessProfile(organizationId);
    const businessContext = [profile.website, profile.oneLiner, profile.audience]
      .filter(Boolean)
      .join(' · ');

    const published = await this.instagram.publishPhotoForAction({
      organizationId,
      action,
      goal: strategy.goal,
      businessContext: businessContext || strategy.context,
      profile,
      brief: agentBrief,
    });

    const summary =
      published.mediaType === 'story'
        ? published.permalink
          ? `Published Instagram story — ${published.permalink}`
          : `Published Instagram story (media ${published.mediaId ?? 'created'})`
        : published.mediaType === 'reel'
          ? published.permalink
            ? `Published Instagram Reel via Runway${published.runwayTaskId ? ` (${published.runwayTaskId})` : ''} — ${published.permalink}`
            : `Published Instagram Reel via Runway (media ${published.mediaId ?? 'created'})`
        : published.mediaType === 'carousel' && published.slideCount
        ? published.permalink
          ? `Published ${published.slideCount}-slide carousel to Instagram — ${published.permalink}`
          : `Published ${published.slideCount}-slide carousel to Instagram (media ${published.mediaId ?? 'created'})`
        : published.permalink
          ? `Published to Instagram — ${published.permalink}`
          : `Published to Instagram (media ${published.mediaId ?? 'created'})`;

    const insert = await query<ExecutionRow>(
      `INSERT INTO action_executions (
         organization_id, strategy_id, action_id, platform, execution_type,
         status, risk_level, summary, target_label, before_state, proposed_state,
         after_state, executed_at
       ) VALUES ($1, $2, $3, $4, $5, 'executed', $6, $7, $8, NULL, $9::jsonb, $9::jsonb, NOW())
       RETURNING *`,
      [
        organizationId,
        strategyId,
        action.id,
        route.platform,
        route.executionType,
        route.riskLevel,
        summary,
        action.title,
        JSON.stringify(published),
      ]
    );

    const execution = mapRow(insert.rows[0]);

    await this.audit.recordExecutionWrite({
      organizationId,
      strategyId: execution.strategyId,
      eventType: 'action_executed',
      executionId: execution.id,
      actionId: execution.actionId,
      platform: execution.platform,
      beforeState: null,
      afterState: published,
      summary,
    });

    await this.markPlanActionComplete(organizationId, strategyId, action.id);

    return {
      execution,
      mode: 'automated_write',
      canExecute: false,
      scopeWarning: null,
      reasoning: published.reasoning ?? undefined,
    };
  }

  private async runShopifyBlogPreview(
    organizationId: string,
    strategyId: string,
    action: PlanAction,
    strategy: NonNullable<Awaited<ReturnType<StrategyService['getById']>>>,
    route: ReturnType<typeof resolveActionRoute>,
    shopifyContentWrite: boolean
  ): Promise<ExecutionPreviewResponse> {
    const ctx = await this.mcp.getShopifyContext(organizationId);
    if (!ctx) {
      throw new Error('Connect Shopify in Integrations before creating blog articles.');
    }

    const profile = await getBusinessProfile(organizationId);
    const businessContext = [profile.website, profile.oneLiner, profile.audience]
      .filter(Boolean)
      .join(' · ');

    const proposed = await this.claude.generateShopifyBlogArticle({
      action,
      goal: strategy.goal,
      businessContext: businessContext || strategy.context,
    });

    const live = isShopifyAutoPublishLiveEnabled();
    const summary = shopifyContentWrite
      ? `${live ? 'Publish' : 'Draft'} Shopify blog article "${proposed.title}".`
      : `Draft article "${proposed.title}" — approve after write_content scope is granted.`;

    const insert = await query<ExecutionRow>(
      `INSERT INTO action_executions (
         organization_id, strategy_id, action_id, platform, execution_type,
         status, risk_level, summary, target_label, before_state, proposed_state
       ) VALUES ($1, $2, $3, $4, $5, 'previewed', $6, $7, $8, NULL, $9::jsonb)
       RETURNING *`,
      [
        organizationId,
        strategyId,
        action.id,
        route.platform,
        route.executionType,
        route.riskLevel,
        summary,
        proposed.title,
        JSON.stringify(proposed),
      ]
    );

    return {
      execution: mapRow(insert.rows[0]),
      mode: 'automated_write',
      canExecute: shopifyContentWrite && isAutomatedWrite(route),
      scopeWarning: shopifyContentWrite
        ? null
        : 'Blog publish requires write_content — add the scope in Shopify Partners, reconnect, then approve.',
    };
  }

  private async approveShopifyBlogArticle(
    organizationId: string,
    executionId: string,
    row: ExecutionRow
  ): Promise<ExecutionRecord> {
    const ctx = await this.mcp.getShopifyContext(organizationId);
    if (!ctx) {
      throw new Error('Shopify is not connected');
    }

    const config = await this.mcp.getPlatformConfig(organizationId, 'shopify');
    if (!shopifyHasWriteContentScope(config?.grantedScopes)) {
      throw new Error(
        'Missing write_content scope. Disconnect and reconnect Shopify, then approve all requested permissions.'
      );
    }

    const proposed = asShopifyBlogArticle(row.proposed_state);
    const blogs = await this.shopify.listBlogs(ctx.shopDomain, ctx.accessToken);
    const blog = this.shopify.pickDefaultBlog(blogs);

    const toApply: ShopifyBlogArticleState = {
      ...proposed,
      blogId: blog.id,
      blogHandle: blog.handle,
      shopDomain: ctx.shopDomain,
    };

    try {
      const after = await this.shopify.createBlogArticle(
        ctx.shopDomain,
        ctx.accessToken,
        toApply
      );

      const createdSummary = after.isPublished
        ? `Published blog article "${after.title}" — ${shopStorefrontUrl(
            after.shopDomain ?? ctx.shopDomain,
            `/blogs/${after.blogHandle}/${after.handle}`
          )}`
        : `Created blog draft "${after.title}" — ${shopStorefrontUrl(
            after.shopDomain ?? ctx.shopDomain,
            `/blogs/${after.blogHandle}/${after.handle}`
          )}`;

      const updated = await query<ExecutionRow>(
        `UPDATE action_executions SET
           status = 'executed',
           before_state = NULL,
           proposed_state = $3::jsonb,
           after_state = $4::jsonb,
           summary = $5,
           error_message = NULL,
           executed_at = NOW(),
           updated_at = NOW()
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [executionId, organizationId, JSON.stringify(after), JSON.stringify(after), createdSummary]
      );

      const execution = mapRow(updated.rows[0]);

      await this.audit.recordExecutionWrite({
        organizationId,
        strategyId: execution.strategyId,
        eventType: 'action_executed',
        executionId: execution.id,
        actionId: execution.actionId,
        platform: execution.platform,
        beforeState: null,
        afterState: after,
        summary: createdSummary,
      });

      return execution;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Execution failed';
      await query(
        `UPDATE action_executions SET status = 'failed', error_message = $3, updated_at = NOW()
         WHERE id = $1 AND organization_id = $2`,
        [executionId, organizationId, message.slice(0, 2000)]
      );
      throw err;
    }
  }

  private async rollbackShopifyBlogArticle(
    organizationId: string,
    executionId: string,
    row: ExecutionRow
  ): Promise<ExecutionRecord> {
    const afterState = row.after_state ? asShopifyBlogArticle(row.after_state) : null;
    if (!afterState?.articleId) {
      throw new Error('No article ID stored for rollback');
    }

    const ctx = await this.mcp.getShopifyContext(organizationId);
    if (!ctx) {
      throw new Error('Shopify is not connected');
    }

    await this.shopify.deleteArticle(ctx.shopDomain, ctx.accessToken, afterState.articleId);

    const updated = await query<ExecutionRow>(
      `UPDATE action_executions SET
         status = 'rolled_back',
         rolled_back_at = NOW(),
         updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 RETURNING *`,
      [executionId, organizationId]
    );

    const execution = mapRow(updated.rows[0]);

    await this.audit.recordExecutionWrite({
      organizationId,
      strategyId: execution.strategyId,
      eventType: 'action_rolled_back',
      executionId: execution.id,
      actionId: execution.actionId,
      platform: execution.platform,
      beforeState: afterState,
      afterState: null,
      summary: `Deleted blog article "${afterState.title}" during rollback`,
    });

    return execution;
  }

  private async generateInstagramAssistDeliverable(
    organizationId: string,
    action: PlanAction,
    strategy: NonNullable<Awaited<ReturnType<StrategyService['getById']>>>,
    profile: BusinessProfile,
    businessContext: string | null | undefined,
    agentBrief?: AgentExecutionBrief | null
  ) {
    const imagePicks = await pickInstagramImagesForAssist({
      organizationId,
      profile,
      action,
      brief: agentBrief,
    });

    return this.claude.generateInstagramAssist({
      action,
      goal: strategy.goal,
      businessContext,
      images: imagePicks.map((pick) => ({
        url: pick.proposedImageUrl,
        alt: pick.imageAlt,
        source: pick.imageSource,
        attribution: pick.imageAttribution,
        rationale: pick.imageRationale,
      })),
      userInstructions: agentBrief?.fullRequest ?? null,
      ctaText: agentBrief?.ctaText ?? null,
      mediaKind:
        agentBrief?.mediaFormat === 'story' || isInstagramStoryAction(action)
          ? 'story'
          : undefined,
    });
  }

  private async runAssist(
    organizationId: string,
    strategyId: string,
    action: PlanAction,
    strategy: NonNullable<Awaited<ReturnType<StrategyService['getById']>>>,
    route: ReturnType<typeof resolveActionRoute>,
    agentBrief?: AgentExecutionBrief | null
  ): Promise<ExecutionPreviewResponse> {
    const profile = await getBusinessProfile(organizationId);
    const businessContext = [
      profile.website,
      profile.oneLiner,
      profile.audience,
    ]
      .filter(Boolean)
      .join(' · ');

    const intent = classifyActionIntent(action);
    const ctx = await this.mcp.getShopifyContext(organizationId);
    const integrations = await this.getIntegrationFlags(organizationId);

    let deliverable =
      action.channel === 'instagram' && isInstagramImagePreviewEnabled()
        ? await this.generateInstagramAssistDeliverable(
            organizationId,
            action,
            strategy,
            profile,
            businessContext || strategy.context,
            agentBrief
          )
        : intent === 'shopify_blog' && ctx
        ? await this.claude.generateShopifyBlogAssist({
            action,
            goal: strategy.goal,
            businessContext: businessContext || strategy.context,
          })
        : isAdvertPlanAssist(action)
          ? await this.claude.generateAdvertPlanAssist({
              action,
              goal: strategy.goal,
              businessContext: businessContext || strategy.context,
              websiteUrl: profile.website,
            })
          : await this.assist.generate(action, {
              goal: strategy.goal,
              businessContext: businessContext || strategy.context,
            });

    const scopeWarning =
      intent === 'shopify_blog' && ctx && !integrations.shopifyContentWrite
        ? 'Blog posts require write_content on your Shopify app — add the scope in Partners, update SHOPIFY_SCOPES, reconnect, then approve to publish via Shopify MCP.'
        : null;

    const insert = await query<ExecutionRow>(
      `INSERT INTO action_executions (
         organization_id, strategy_id, action_id, platform, execution_type,
         status, risk_level, summary, target_label, before_state, proposed_state,
         executed_at
       ) VALUES ($1, $2, $3, $4, $5, 'executed', $6, $7, $8, NULL, $9::jsonb, NOW())
       RETURNING *`,
      [
        organizationId,
        strategyId,
        action.id,
        route.platform,
        route.executionType,
        route.riskLevel,
        route.summary,
        action.title,
        JSON.stringify(deliverable),
      ]
    );

    return {
      execution: mapRow(insert.rows[0]),
      mode: 'assist',
      canExecute: false,
      scopeWarning,
    };
  }

  private async runShopifyPagePreview(
    organizationId: string,
    strategyId: string,
    action: PlanAction,
    strategy: NonNullable<Awaited<ReturnType<StrategyService['getById']>>>,
    route: ReturnType<typeof resolveActionRoute>,
    shopifyContentWrite: boolean
  ): Promise<ExecutionPreviewResponse> {
    const ctx = await this.mcp.getShopifyContext(organizationId);
    if (!ctx) {
      throw new Error('Connect Shopify in Integrations before creating store pages.');
    }

    const profile = await getBusinessProfile(organizationId);
    const businessContext = [profile.website, profile.oneLiner, profile.audience]
      .filter(Boolean)
      .join(' · ');

    const proposed = await this.claude.generateShopifyPage({
      action,
      goal: strategy.goal,
      businessContext: businessContext || strategy.context,
    });

    const live = isShopifyAutoPublishLiveEnabled();
    const summary = shopifyContentWrite
      ? `${live ? 'Publish' : 'Draft'} Shopify page "${proposed.title}" at /pages/${proposed.handle}.`
      : `Draft page "${proposed.title}" — approve after write_content scope is granted to publish via Shopify MCP.`;

    const insert = await query<ExecutionRow>(
      `INSERT INTO action_executions (
         organization_id, strategy_id, action_id, platform, execution_type,
         status, risk_level, summary, target_label, before_state, proposed_state
       ) VALUES ($1, $2, $3, $4, $5, 'previewed', $6, $7, $8, NULL, $9::jsonb)
       RETURNING *`,
      [
        organizationId,
        strategyId,
        action.id,
        route.platform,
        route.executionType,
        route.riskLevel,
        summary,
        proposed.title,
        JSON.stringify(proposed),
      ]
    );

    return {
      execution: mapRow(insert.rows[0]),
      mode: 'automated_write',
      canExecute: shopifyContentWrite && isAutomatedWrite(route),
      scopeWarning: shopifyContentWrite
        ? null
        : 'Page publish requires write_content — add the scope in Shopify Partners, reconnect, then approve to create via Shopify MCP.',
    };
  }

  private async runGoogleAdsCampaignPreview(
    organizationId: string,
    strategyId: string,
    action: PlanAction,
    strategy: NonNullable<Awaited<ReturnType<StrategyService['getById']>>>,
    route: ReturnType<typeof resolveActionRoute>
  ): Promise<ExecutionPreviewResponse> {
    const ctx = await this.mcp.getGoogleAdsContext(organizationId);
    if (!ctx) {
      throw new Error('Connect Google Ads in Integrations and select an account before creating campaigns.');
    }

    const profile = await getBusinessProfile(organizationId);
    const businessContext = [profile.website, profile.oneLiner, profile.audience]
      .filter(Boolean)
      .join(' · ');

    const snapshot = await this.googleAdsSnapshot.fetchSnapshot(organizationId);

    const proposed = await this.claude.generateGoogleAdsCampaign({
      action,
      goal: strategy.goal,
      businessContext: businessContext || strategy.context,
      websiteUrl: profile.website,
      adsSnapshotText: snapshot?.text ?? null,
    });

    const devTokenConfigured = Boolean(process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim());
    const summary = `Draft Search campaign "${proposed.campaignName}" ($${proposed.dailyBudgetUsd}/day) — agent creates it paused in Google Ads.`;

    const insert = await query<ExecutionRow>(
      `INSERT INTO action_executions (
         organization_id, strategy_id, action_id, platform, execution_type,
         status, risk_level, summary, target_label, before_state, proposed_state
       ) VALUES ($1, $2, $3, $4, $5, 'previewed', $6, $7, $8, NULL, $9::jsonb)
       RETURNING *`,
      [
        organizationId,
        strategyId,
        action.id,
        route.platform,
        route.executionType,
        route.riskLevel,
        summary,
        proposed.campaignName,
        JSON.stringify(proposed),
      ]
    );

    return {
      execution: mapRow(insert.rows[0]),
      mode: 'automated_write',
      canExecute: devTokenConfigured && isAutomatedWrite(route),
      scopeWarning: devTokenConfigured
        ? null
        : 'Google Ads write API is not configured on the server — you can review the draft here but cannot create in Google Ads yet.',
    };
  }

  private async runMetaAdsCampaignPreview(
    organizationId: string,
    strategyId: string,
    action: PlanAction,
    strategy: NonNullable<Awaited<ReturnType<StrategyService['getById']>>>,
    route: ReturnType<typeof resolveActionRoute>
  ): Promise<ExecutionPreviewResponse> {
    const ctx = await this.mcp.getMetaAdsContext(organizationId);
    if (!ctx) {
      throw new Error('Connect Meta Ads in Integrations and select an ad account before creating campaigns.');
    }

    const throttle = await evaluateMetaAdsCreateThrottle(organizationId);
    if (!throttle.allowCreate) {
      throw new Error(throttle.reason);
    }

    const profile = await getBusinessProfile(organizationId);
    const businessContext = [profile.website, profile.oneLiner, profile.audience]
      .filter(Boolean)
      .join(' · ');

    const snapshot = await this.metaAdsSnapshot.fetchSnapshot(organizationId);

    const proposed = await this.claude.generateMetaAdsCampaign({
      action,
      goal: strategy.goal,
      businessContext: businessContext || strategy.context,
      websiteUrl: profile.website,
      metaSnapshotText: snapshot?.text ?? null,
      performanceContext: formatMetaAdsPerformanceForCreativePrompt(throttle),
    });

    // Hands-off: agent fills creatives immediately (library → Canva → Runway)
    let enriched = proposed;
    try {
      enriched = await this.adCampaignLibrary.enrichWithCreatives(organizationId, proposed, {
        channel: 'meta',
        prefer: 'auto',
      });
    } catch (creativeErr) {
      log.warn(
        'Meta creative enrichment at preview skipped:',
        creativeErr instanceof Error ? creativeErr.message : creativeErr
      );
    }

    const imageCount = enriched.ads.filter((a) => a.imageUrl).length;
    const symbol =
      enriched.currencyCode === 'GBP' ? '£' : enriched.currencyCode === 'EUR' ? '€' : '$';
    const summary =
      imageCount > 0
        ? `Agent drafted Meta campaign "${enriched.campaignName}" (${symbol}${enriched.dailyBudget}/day) with ${imageCount} creative image${imageCount === 1 ? '' : 's'} — will create paused in Ads Manager.`
        : `Agent drafted Meta campaign "${enriched.campaignName}" (${symbol}${enriched.dailyBudget}/day) — creatives pending; will create paused in Ads Manager.`;

    const insert = await query<ExecutionRow>(
      `INSERT INTO action_executions (
         organization_id, strategy_id, action_id, platform, execution_type,
         status, risk_level, summary, target_label, before_state, proposed_state
       ) VALUES ($1, $2, $3, $4, $5, 'previewed', $6, $7, $8, NULL, $9::jsonb)
       RETURNING *`,
      [
        organizationId,
        strategyId,
        action.id,
        route.platform,
        route.executionType,
        route.riskLevel,
        summary,
        enriched.campaignName,
        JSON.stringify(enriched),
      ]
    );

    const execution = mapRow(insert.rows[0]);
    try {
      await this.adCampaignLibrary.upsertFromMetaState(organizationId, enriched, {
        sourceExecutionId: execution.id,
        channel: 'meta',
      });
    } catch (libErr) {
      log.warn(
        'failed to save Meta draft to ads library:',
        libErr instanceof Error ? libErr.message : libErr
      );
    }

    return {
      execution,
      mode: 'automated_write',
      canExecute: isAutomatedWrite(route),
      scopeWarning: null,
    };
  }

  private async runMailchimpSequencePreview(
    organizationId: string,
    strategyId: string,
    action: PlanAction,
    strategy: NonNullable<Awaited<ReturnType<StrategyService['getById']>>>,
    route: ReturnType<typeof resolveActionRoute>
  ): Promise<ExecutionPreviewResponse> {
    const ctx = await this.mcp.getMailchimpContext(organizationId);
    if (!ctx?.defaultListId) {
      throw new Error(
        'Connect Mailchimp in Integrations and select a default audience before creating email drafts.'
      );
    }

    const profile = await getBusinessProfile(organizationId);
    const businessContext = [profile.website, profile.oneLiner, profile.audience]
      .filter(Boolean)
      .join(' · ');

    const ping = await import('../lib/mailchimpClient.js').then((m) => m.mailchimpPing(ctx));
    const fromName =
      ctx.accountName?.trim() ||
      profile.oneLiner?.split(/[.!—–-]/)[0]?.trim() ||
      'Team';
    const replyTo = ping.email?.trim() || 'hello@example.com';

    const proposed = await this.claude.generateMailchimpSequence({
      action,
      goal: strategy.goal,
      businessContext: businessContext || strategy.context,
      fromName,
      replyTo,
      defaultAudienceName: null,
    });

    const summary = `Agent drafted ${proposed.emails.length} email(s) for "${proposed.sequenceName}" — will create as Mailchimp drafts (not sent).`;

    const insert = await query<ExecutionRow>(
      `INSERT INTO action_executions (
         organization_id, strategy_id, action_id, platform, execution_type,
         status, risk_level, summary, target_label, before_state, proposed_state
       ) VALUES ($1, $2, $3, $4, $5, 'previewed', $6, $7, $8, NULL, $9::jsonb)
       RETURNING *`,
      [
        organizationId,
        strategyId,
        action.id,
        route.platform,
        route.executionType,
        route.riskLevel,
        summary,
        proposed.sequenceName,
        JSON.stringify(proposed),
      ]
    );

    return {
      execution: mapRow(insert.rows[0]),
      mode: 'automated_write',
      canExecute: isAutomatedWrite(route),
      scopeWarning: null,
    };
  }

  private async runShopifyProductSeoPreview(
    organizationId: string,
    strategyId: string,
    action: PlanAction,
    route: ReturnType<typeof resolveActionRoute>,
    shopifyWrite: boolean
  ): Promise<ExecutionPreviewResponse> {
    const ctx = await this.mcp.getShopifyContext(organizationId);
    if (!ctx) {
      throw new Error('Connect Shopify in Integrations before executing store changes.');
    }

    const pace = await getAutopilotPace(organizationId);
    const caps = await evaluateChannelCaps(organizationId, pace, 'update_product_seo');
    if (!caps.allow) {
      throw new Error(caps.reason ?? 'Product SEO daily cap reached for this pace.');
    }

    const cooldown = await getSeoCooldownTargets(organizationId, pace);
    const current = await this.shopify.fetchActiveProductForSeo(
      ctx.shopDomain,
      ctx.accessToken,
      cooldown.productIds
    );
    if (!current) {
      throw new Error(
        `All active products were SEO-updated within the last ${cooldown.cooldownDays} days. Waiting for rankings to settle — pick Intense breadth next week on new products, or wait.`
      );
    }

    const proposal = this.shopify.buildProductSeoProposal(action, current);

    const insert = await query<ExecutionRow>(
      `INSERT INTO action_executions (
         organization_id, strategy_id, action_id, platform, execution_type,
         status, risk_level, summary, target_label, before_state, proposed_state
       ) VALUES ($1, $2, $3, $4, $5, 'previewed', $6, $7, $8, $9::jsonb, $10::jsonb)
       RETURNING *`,
      [
        organizationId,
        strategyId,
        action.id,
        route.platform,
        route.executionType,
        route.riskLevel,
        proposal.summary,
        proposal.targetLabel,
        JSON.stringify(proposal.before),
        JSON.stringify(proposal.proposed),
      ]
    );

    return {
      execution: mapRow(insert.rows[0]),
      mode: 'automated_write',
      canExecute: shopifyWrite && isAutomatedWrite(route),
      scopeWarning: shopifyWrite
        ? null
        : 'Reconnect Shopify to grant write_products scope before auto-applying. Copy the SEO fields manually for now.',
    };
  }

  private async loadAction(
    organizationId: string,
    strategyId: string,
    actionId: string
  ) {
    const strategy = await this.strategy.getById(organizationId, strategyId);
    if (!strategy?.plan) {
      throw new Error('Plan not found');
    }

    const action = findPlanAction(strategy.plan, actionId);
    if (!action) {
      throw new Error('Action not found in this plan');
    }

    return { strategy, action };
  }

  /** Sequential orchestrator: auto-apply non-ad previews; only ads pause for human spend enablement. */
  async finalizeForSequentialStep(
    organizationId: string,
    execution: ExecutionRecord
  ): Promise<{ execution: ExecutionRecord; needsHumanGate: boolean }> {
    const integrations = await this.getIntegrationFlags(organizationId);
    let current = execution;

    if (current.status === 'previewed' && this.canAutoApplyExecution(current, integrations)) {
      if (current.executionType === 'create_meta_ads_campaign') {
        const throttle = await evaluateMetaAdsCreateThrottle(organizationId);
        if (!throttle.allowCreate) {
          return { execution: current, needsHumanGate: true };
        }
      }
      current = await this.approve(organizationId, current.id);
    }

    const isPaidAd =
      current.executionType === 'create_meta_ads_campaign' ||
      current.executionType === 'create_google_ads_campaign';

    if (isPaidAd && current.status === 'executed') {
      return { execution: current, needsHumanGate: true };
    }

    if (current.status === 'failed') {
      throw new Error(current.errorMessage ?? 'Action failed');
    }

    return { execution: current, needsHumanGate: false };
  }

  async getIntegrationFlagsPublic(
    organizationId: string
  ): Promise<OrgIntegrationFlags> {
    return this.getIntegrationFlags(organizationId);
  }

  private async getIntegrationFlags(
    organizationId: string
  ): Promise<OrgIntegrationFlags> {
    const connections = await this.mcp.getActiveConnections(organizationId);
    const shopifyConfig = await this.mcp.getPlatformConfig(organizationId, 'shopify');
    const adsConn = connections.find((c) => c.platform === 'google_ads');
    const metaConn = connections.find((c) => c.platform === 'meta_ads');

    return {
      shopify: connections.some((c) => c.platform === 'shopify'),
      shopifyWrite: shopifyHasWriteProductsScope(shopifyConfig?.grantedScopes),
      shopifyContentWrite: shopifyHasWriteContentScope(shopifyConfig?.grantedScopes),
      metaAds: Boolean(metaConn),
      metaAdsReady: Boolean(metaConn?.config?.adAccountId),
      googleAds: isGoogleAdsEnabled() && Boolean(adsConn),
      googleAdsReady:
        isGoogleAdsEnabled() && Boolean(adsConn?.config?.customerId),
      analytics: connections.some((c) => c.platform === 'google_analytics'),
      canva: connections.some((c) => c.platform === 'canva'),
      canvaReady: Boolean(await this.mcp.getCanvaContext(organizationId)),
      runway: isRunwayConfigured(),
      runwayReady: isRunwayConfigured(),
      instagram: connections.some((c) => c.platform === 'instagram'),
      instagramReady: Boolean(await this.mcp.getInstagramContext(organizationId)),
      mailchimp: connections.some((c) => c.platform === 'mailchimp'),
      mailchimpReady: await this.mcp.isMailchimpReady(organizationId),
    };
  }

  private async getRow(organizationId: string, executionId: string): Promise<ExecutionRow> {
    const result = await query<ExecutionRow>(
      `SELECT * FROM action_executions WHERE id = $1 AND organization_id = $2`,
      [executionId, organizationId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('Execution not found');
    }
    return row;
  }

  /**
   * Atomically takes ownership of an execution before any external write.
   *
   * Replaces the previous read-then-check pattern:
   *
   *   const row = await this.getRow(...);
   *   if (row.status !== 'previewed') throw ...;   // <- gap
   *   await externalApi.create(...);               // <- both callers get here
   *   await query(`UPDATE ... SET status = 'executed'`);
   *
   * Two callers could both pass the check before either wrote, so a user
   * double-clicking Approve — or the autopilot worker racing an operator —
   * could create the same Shopify page or, more expensively, the same Meta ad
   * campaign twice. The window was real even on a single instance.
   *
   * `WHERE status = 'previewed'` makes the transition the serialisation point:
   * Postgres applies row-level locking to the UPDATE, so exactly one caller
   * observes rowCount 1 and every other caller observes 0. Only the winner
   * proceeds to the external API.
   *
   * Returns the claimed row, or null if another caller already holds it.
   */
  private async claimExecutionForWrite(
    organizationId: string,
    executionId: string
  ): Promise<ExecutionRow | null> {
    const result = await query<ExecutionRow>(
      `UPDATE action_executions
       SET status = 'executing',
           claimed_at = NOW(),
           claimed_by = $3,
           attempt_count = attempt_count + 1,
           updated_at = NOW()
       WHERE id = $1
         AND organization_id = $2
         AND status = 'previewed'
       RETURNING *`,
      [executionId, organizationId, INSTANCE_ID]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Returns a claimed execution to 'previewed' so it can be retried.
   *
   * Guarded by `status = 'executing'` so it is a no-op when the handler has
   * already reached a terminal state. That matters because the per-type
   * handlers set status = 'failed' in their own catch blocks after an external
   * call fails — we must not resurrect those. This only rescues throws that
   * happen *before* the external write: missing OAuth scope, daily channel cap
   * reached, SEO cooldown still active. Those were retryable before this change
   * and must stay retryable.
   */
  private async releaseExecutionClaim(
    organizationId: string,
    executionId: string
  ): Promise<void> {
    await query(
      `UPDATE action_executions
       SET status = 'previewed',
           claimed_at = NULL,
           claimed_by = NULL,
           updated_at = NOW()
       WHERE id = $1
         AND organization_id = $2
         AND status = 'executing'`,
      [executionId, organizationId]
    );
  }
}
