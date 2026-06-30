import { query } from '../database/connection.js';
import type { CheckupDocument } from '../types/checkup.js';
import type { SnapshotProbeResult } from '../types/snapshot.js';
import { ClaudeService, type PlanGenerationContext } from './claudeService.js';
import { GoogleAdsSnapshotService } from './googleAdsSnapshotService.js';
import { GoogleAnalyticsSnapshotService } from './googleAnalyticsSnapshotService.js';
import { MetaAdsSnapshotService } from './metaAdsSnapshotService.js';
import { ShopifySnapshotService } from './shopifySnapshotService.js';
import { MCPConnectionService } from './mcpConnectionService.js';
import { SnapshotHealthService } from './snapshotHealthService.js';
import {
  getBusinessProfile,
  resolveStrategyContext,
} from './businessProfileService.js';
import type { StrategyDataSource } from './strategyService.js';
import { MarketIntelService } from './marketIntel/marketIntelService.js';

export type CheckupRecord = {
  id: string;
  organizationId: string;
  dataSource: StrategyDataSource;
  report: CheckupDocument;
  createdAt: string;
};

type CheckupRow = {
  id: string;
  organization_id: string;
  data_source: StrategyDataSource;
  report_json: CheckupDocument;
  created_at: Date;
};

function mapRow(row: CheckupRow): CheckupRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    dataSource: row.data_source,
    report: row.report_json,
    createdAt: row.created_at.toISOString(),
  };
}

function resolveDataSource(flags: {
  analytics: boolean;
  googleAds: boolean;
  metaAds: boolean;
  shopify: boolean;
}): StrategyDataSource {
  const active: StrategyDataSource[] = [];
  if (flags.analytics) active.push('analytics');
  if (flags.googleAds) active.push('google_ads');
  if (flags.metaAds) active.push('meta_ads');
  if (flags.shopify) active.push('shopify');
  if (active.length >= 2) return 'multi';
  if (active.length === 1) return active[0];
  return 'generic';
}

function buildDataCoverage(probes: SnapshotProbeResult[]): CheckupDocument['dataCoverage'] {
  return probes
    .filter((p) => p.connectionReady || p.platform !== 'shopify')
    .map((p) => ({
      source: p.platform,
      connected: p.connectionReady,
      loaded: p.dataAvailable,
      note: p.userMessage ?? (p.connectionReady && !p.dataAvailable ? p.error : null) ?? null,
    }));
}

export class CheckupService {
  private claude = new ClaudeService();
  private mcp = new MCPConnectionService();
  private health = new SnapshotHealthService();
  private marketIntel = new MarketIntelService();
  private gaSnapshot = new GoogleAnalyticsSnapshotService();
  private adsSnapshot = new GoogleAdsSnapshotService();
  private metaSnapshot = new MetaAdsSnapshotService();
  private shopifySnapshot = new ShopifySnapshotService();

  private async loadContext(organizationId: string): Promise<{
    dataSource: StrategyDataSource;
    ctx: PlanGenerationContext;
    coverage: CheckupDocument['dataCoverage'];
    businessContext: string | null;
    marketIntelSection: ReturnType<MarketIntelService['buildPromptSection']>;
  }> {
    const connections = await this.mcp.getActiveConnections(organizationId);
    const analytics = connections.find((c) => c.platform === 'google_analytics');
    const ads = connections.find((c) => c.platform === 'google_ads');
    const meta = connections.find((c) => c.platform === 'meta_ads');
    const shopify = connections.find((c) => c.platform === 'shopify');
    const hasProperty = Boolean(analytics?.propertyId);
    const hasAdsCustomer = Boolean(ads?.config?.customerId);
    const hasMetaAccount = Boolean(meta?.config?.adAccountId);
    const hasShop = Boolean(shopify?.config?.shopDomain);

    const { platforms } = await this.health.getHealth(organizationId);
    const coverage = buildDataCoverage(platforms);

    const safeFetch = async <T extends { text: string }>(
      enabled: boolean,
      fetcher: () => Promise<T | null>
    ): Promise<string | undefined> => {
      if (!enabled) return undefined;
      try {
        const snapshot = await fetcher();
        return snapshot?.text;
      } catch {
        return undefined;
      }
    };

    const [analyticsSnapshotText, googleAdsSnapshotText, metaAdsSnapshotText, shopifySnapshotText] =
      await Promise.all([
        safeFetch(hasProperty, () => this.gaSnapshot.fetchSnapshot(organizationId)),
        safeFetch(hasAdsCustomer, () => this.adsSnapshot.fetchSnapshot(organizationId)),
        safeFetch(hasMetaAccount, () => this.metaSnapshot.fetchSnapshot(organizationId)),
        safeFetch(hasShop, () => this.shopifySnapshot.fetchSnapshot(organizationId)),
      ]);

    const dataSource = resolveDataSource({
      analytics: Boolean(analyticsSnapshotText),
      googleAds: Boolean(googleAdsSnapshotText),
      metaAds: Boolean(metaAdsSnapshotText),
      shopify: Boolean(shopifySnapshotText),
    });

    const businessProfile = await getBusinessProfile(organizationId);
    const { context } = resolveStrategyContext(businessProfile, undefined, undefined);
    const marketIntelSection = this.marketIntel.buildPromptSection(businessProfile);

    return {
      dataSource,
      coverage,
      businessContext: context,
      marketIntelSection,
      ctx: {
        hasAnalytics: hasProperty,
        propertyId: analytics?.propertyId,
        analyticsSnapshotText,
        hasGoogleAds: hasAdsCustomer,
        googleAdsSnapshotText,
        hasMetaAds: hasMetaAccount,
        metaAdsSnapshotText,
        hasShopify: hasShop,
        shopifySnapshotText,
      },
    };
  }

  async run(organizationId: string): Promise<CheckupRecord> {
    const { dataSource, ctx, coverage, businessContext, marketIntelSection } =
      await this.loadContext(organizationId);

    const generated = await this.claude.generateCheckupReport({
      businessContext,
      generationContext: ctx,
      dataCoverage: coverage,
      marketIntel: marketIntelSection,
    });

    // Coverage comes from snapshot health probes — do not let the model override it.
    const report: CheckupDocument = { ...generated, dataCoverage: coverage };

    const result = await query<CheckupRow>(
      `INSERT INTO checkup_reports (organization_id, data_source, report_json)
       VALUES ($1, $2, $3::jsonb)
       RETURNING *`,
      [organizationId, dataSource, JSON.stringify(report)]
    );

    console.log(`[checkup] created id=${result.rows[0].id} org=${organizationId}`);
    return mapRow(result.rows[0]);
  }

  async getLatest(organizationId: string): Promise<CheckupRecord | null> {
    const result = await query<CheckupRow>(
      `SELECT * FROM checkup_reports
       WHERE organization_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [organizationId]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async getById(organizationId: string, id: string): Promise<CheckupRecord | null> {
    const result = await query<CheckupRow>(
      `SELECT * FROM checkup_reports WHERE id = $1 AND organization_id = $2`,
      [id, organizationId]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async list(organizationId: string, limit = 10): Promise<CheckupRecord[]> {
    const result = await query<CheckupRow>(
      `SELECT * FROM checkup_reports
       WHERE organization_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [organizationId, limit]
    );
    return result.rows.map(mapRow);
  }
}
