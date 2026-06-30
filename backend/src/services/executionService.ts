import { query } from '../database/connection.js';
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
  MetaAdsCampaignState,
  ProductSeoState,
  ShopifyPageState,
} from '../types/execution.js';
import { AssistExecutor } from '../executors/assistExecutor.js';
import {
  classifyActionIntent,
  explainActionRoute,
  isAdvertPlanAssist,
  isAutomatedWrite,
  resolveActionRoute,
  type OrgIntegrationFlags,
} from '../executors/actionRouter.js';
import { shopifyHasWriteContentScope, shopifyHasWriteProductsScope } from '../lib/shopifyAdmin.js';
import { AuditLogService } from './auditLogService.js';
import { AutopilotActivityService } from './autopilotActivityService.js';
import { AutopilotPreflightService } from './autopilotPreflightService.js';
import { ClaudeService } from './claudeService.js';
import { MCPConnectionService } from './mcpConnectionService.js';
import { ShopifyExecutionService } from './shopifyExecutionService.js';
import { GoogleAdsCampaignService } from './googleAdsCampaignService.js';
import { MetaAdsCampaignService } from './metaAdsCampaignService.js';
import { GoogleAdsSnapshotService } from './googleAdsSnapshotService.js';
import { MetaAdsSnapshotService } from './metaAdsSnapshotService.js';
import { StrategyService } from './strategyService.js';
import { getBusinessProfile, type BusinessProfile } from './businessProfileService.js';
import { isInstagramImagePreviewEnabled } from '../lib/instagramFeatureFlags.js';
import { pickBrandImageForInstagramAssist } from './instagramAssistImageService.js';

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
  return null;
}

export class ExecutionService {
  private strategy = new StrategyService();
  private mcp = new MCPConnectionService();
  private shopify = new ShopifyExecutionService();
  private googleAdsCampaign = new GoogleAdsCampaignService();
  private metaAdsCampaign = new MetaAdsCampaignService();
  private googleAdsSnapshot = new GoogleAdsSnapshotService();
  private metaAdsSnapshot = new MetaAdsSnapshotService();
  private assist = new AssistExecutor();
  private claude = new ClaudeService();
  private audit = new AuditLogService();
  private activity = new AutopilotActivityService();
  private preflight = new AutopilotPreflightService();

  /** Pull live integration data, log to activity feed, optionally execute the week. */
  async runWeekBatch(
    organizationId: string,
    strategyId: string,
    week: number,
    options: { confirm: boolean; autoApply: boolean }
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

    if (options.autoApply) {
      await this.autoApplyResults(organizationId, strategyId, week, results, integrations);
    }

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
      autoApply: false,
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
    const doneIds = new Set(
      existing
        .filter((e) => e.status === 'executed' || e.status === 'previewed')
        .map((e) => e.actionId)
    );

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
          : route.executionType === 'create_google_ads_campaign'
          ? 'Google Ads campaign draft'
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

      if (doneIds.has(action.id)) {
        results.push({
          actionId: action.id,
          ok: true,
          execution: existing.find((e) => e.actionId === action.id),
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
              ? 'Drafting Meta campaign with Claude…'
              : route.executionType === 'create_google_ads_campaign'
              ? 'Drafting Google Search campaign with Claude…'
              : route.executionType === 'create_shopify_page'
              ? integrations.shopifyContentWrite
                ? 'Writing store page content with Claude…'
                : 'Drafting page + Claude.ai Shopify MCP prompt…'
              : 'Loading Shopify product and drafting SEO changes…',
        status: 'running',
      });

      try {
        const preview = await this.preview(organizationId, strategyId, action.id);
        results.push({ actionId: action.id, ok: true, execution: preview.execution });
        const aiReasoning = extractPayloadReasoning(preview.execution.proposedState);
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
        const completeDetail =
          preview.scopeWarning ??
          (preview.execution.proposedState.kind === 'meta_ads_campaign'
            ? 'Meta campaign drafted — review and approve to create it paused in Meta Ads Manager. You enable spending when ready.'
            : preview.execution.proposedState.kind === 'google_ads_campaign'
            ? 'Campaign drafted — review and approve to create it paused in Google Ads. You enable spending in Google Ads when ready.'
            : preview.execution.summary);
        await this.activity.log({
          organizationId,
          strategyId,
          weekNumber: week,
          actionId: action.id,
          step: 'complete',
          title: `Ready: ${action.title}`,
          detail: completeDetail,
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

    if (route.mode === 'assist') {
      const result = await this.runAssist(organizationId, strategyId, action, strategy, route);
      return { ...result, reasoning };
    }

    if (route.executionType === 'create_shopify_page') {
      const result = await this.runShopifyPagePreview(
        organizationId,
        strategyId,
        action,
        strategy,
        route,
        integrations.shopifyContentWrite
      );
      return { ...result, reasoning };
    }

    if (route.executionType === 'create_google_ads_campaign') {
      const result = await this.runGoogleAdsCampaignPreview(
        organizationId,
        strategyId,
        action,
        strategy,
        route
      );
      return { ...result, reasoning };
    }

    if (route.executionType === 'create_meta_ads_campaign') {
      const result = await this.runMetaAdsCampaignPreview(
        organizationId,
        strategyId,
        action,
        strategy,
        route
      );
      return { ...result, reasoning };
    }

    const result = await this.runShopifyProductSeoPreview(
      organizationId,
      strategyId,
      action,
      route,
      integrations.shopifyWrite
    );
    return { ...result, reasoning };
  }

  /** Prepare a week; in hands-off mode auto-apply low-risk Shopify writes when scoped. */
  async runWeekAutopilot(
    organizationId: string,
    strategyId: string,
    week: number,
    autoApply: boolean,
    confirm = true
  ): Promise<BatchRunResponse> {
    return this.runWeekBatch(organizationId, strategyId, week, { confirm, autoApply });
  }

  private async autoApplyResults(
    organizationId: string,
    strategyId: string,
    week: number,
    results: BatchExecutionResult[],
    integrations: OrgIntegrationFlags
  ): Promise<void> {
    if (!integrations.shopifyWrite && !integrations.shopifyContentWrite) {
      return;
    }

    for (const result of results) {
      const execution = result.execution;
      if (!result.ok || !execution || execution.status !== 'previewed') {
        continue;
      }

      const canAutoApply =
        execution.executionType === 'update_product_seo'
          ? integrations.shopifyWrite
          : execution.executionType === 'create_shopify_page'
            ? integrations.shopifyContentWrite
            : false;

      if (!canAutoApply) {
        continue;
      }

      await this.activity.log({
        organizationId,
        strategyId,
        weekNumber: week,
        actionId: execution.actionId,
        step: 'auto_apply',
        title:
          execution.executionType === 'create_shopify_page'
            ? 'Hands-off: creating Shopify page'
            : 'Hands-off: applying Shopify change',
        detail: execution.summary,
        status: 'running',
      });

      try {
        const approved = await this.approve(organizationId, execution.id);
        result.execution = approved;
        await this.activity.log({
          organizationId,
          strategyId,
          weekNumber: week,
          actionId: execution.actionId,
          step: 'auto_apply_done',
          title:
            execution.executionType === 'create_shopify_page'
              ? 'Page created in Shopify'
              : 'Applied in Shopify',
          detail: approved.summary,
          status: 'success',
        });
      } catch (err) {
        result.ok = false;
        result.error = err instanceof Error ? err.message : 'Auto-apply failed';
        await this.activity.log({
          organizationId,
          strategyId,
          weekNumber: week,
          actionId: execution.actionId,
          step: 'auto_apply_failed',
          title: 'Auto-apply failed',
          detail: result.error,
          status: 'error',
        });
      }
    }
  }

  async approve(
    organizationId: string,
    executionId: string,
    edits?: Partial<Pick<ProductSeoState, 'seoTitle' | 'seoDescription'>>
  ): Promise<ExecutionRecord> {
    const row = await this.getRow(organizationId, executionId);
    if (row.status !== 'previewed') {
      throw new Error(`Cannot approve execution in status "${row.status}"`);
    }

    if (row.execution_type === 'create_shopify_page') {
      return this.approveShopifyPage(organizationId, executionId, row);
    }

    if (row.execution_type === 'create_google_ads_campaign') {
      return this.approveGoogleAdsCampaign(organizationId, executionId, row);
    }

    if (row.execution_type === 'create_meta_ads_campaign') {
      return this.approveMetaAdsCampaign(organizationId, executionId, row);
    }

    if (row.execution_type !== 'update_product_seo') {
      throw new Error('Only Shopify or ad platform writes require approval');
    }

    return this.approveProductSeo(organizationId, executionId, row, edits);
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

      const updated = await query<ExecutionRow>(
        `UPDATE action_executions SET
           status = 'executed',
           before_state = NULL,
           proposed_state = $3::jsonb,
           after_state = $4::jsonb,
           error_message = NULL,
           executed_at = NOW(),
           updated_at = NOW()
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [executionId, organizationId, JSON.stringify(after), JSON.stringify(after)]
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
        summary: `Created Shopify page "${after.title}" at /pages/${after.handle}`,
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

      const updated = await query<ExecutionRow>(
        `UPDATE action_executions SET
           status = 'executed',
           before_state = NULL,
           proposed_state = $3::jsonb,
           after_state = $4::jsonb,
           error_message = NULL,
           executed_at = NOW(),
           updated_at = NOW()
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [executionId, organizationId, JSON.stringify(after), JSON.stringify(after)]
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
        summary: `Created paused Google Ads campaign "${after.campaignName}" — enable it in Google Ads when ready.`,
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
      const after = await this.metaAdsCampaign.createPausedCampaign(organizationId, proposed);

      const updated = await query<ExecutionRow>(
        `UPDATE action_executions SET
           status = 'executed',
           before_state = NULL,
           proposed_state = $3::jsonb,
           after_state = $4::jsonb,
           error_message = NULL,
           executed_at = NOW(),
           updated_at = NOW()
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [executionId, organizationId, JSON.stringify(after), JSON.stringify(after)]
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
        summary: `Created paused Meta campaign "${after.campaignName}" — enable it in Meta Ads Manager when ready.`,
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

  private async generateInstagramAssistDeliverable(
    organizationId: string,
    action: PlanAction,
    strategy: NonNullable<Awaited<ReturnType<StrategyService['getById']>>>,
    profile: BusinessProfile,
    businessContext: string | null | undefined
  ) {
    const imagePick = await pickBrandImageForInstagramAssist({
      organizationId,
      profile,
      action,
    });

    return this.claude.generateInstagramAssist({
      action,
      goal: strategy.goal,
      businessContext,
      image: imagePick
        ? {
            url: imagePick.proposedImageUrl,
            alt: imagePick.imageAlt,
            source: imagePick.imageSource,
            attribution: imagePick.imageAttribution,
            rationale: imagePick.imageRationale,
          }
        : null,
    });
  }

  private async runAssist(
    organizationId: string,
    strategyId: string,
    action: PlanAction,
    strategy: NonNullable<Awaited<ReturnType<StrategyService['getById']>>>,
    route: ReturnType<typeof resolveActionRoute>
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
            businessContext || strategy.context
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

    const summary = shopifyContentWrite
      ? `Draft Shopify page "${proposed.title}" at /pages/${proposed.handle}.`
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
    const summary = `Draft Search campaign "${proposed.campaignName}" ($${proposed.dailyBudgetUsd}/day) — approve to create paused in Google Ads.`;

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
    });

    const symbol =
      proposed.currencyCode === 'GBP' ? '£' : proposed.currencyCode === 'EUR' ? '€' : '$';
    const summary = `Draft Meta campaign "${proposed.campaignName}" (${symbol}${proposed.dailyBudget}/day) — approve to create paused in Meta Ads Manager.`;

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

    const current = await this.shopify.fetchFirstActiveProduct(
      ctx.shopDomain,
      ctx.accessToken
    );
    if (!current) {
      throw new Error('No active products found in your Shopify store.');
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
      googleAds: Boolean(adsConn),
      googleAdsReady: Boolean(adsConn?.config?.customerId),
      analytics: connections.some((c) => c.platform === 'google_analytics'),
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
}
