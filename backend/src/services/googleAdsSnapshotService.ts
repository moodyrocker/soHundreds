import { MCPConnectionService } from './mcpConnectionService.js';
import type { SnapshotFetchResult, SnapshotProbeResult } from '../types/snapshot.js';
import { idleProbe, probeFromFetch } from '../types/snapshot.js';
import { parseGoogleAdsError } from '../utils/parseGoogleAdsError.js';

const API_VERSION = process.env.GOOGLE_ADS_API_VERSION ?? 'v21';

export interface GoogleAdsSnapshot {
  customerId: string;
  text: string;
}

type SearchResponse = {
  results?: Array<{
    campaign?: { name?: string };
    metrics?: {
      costMicros?: string;
      conversions?: number;
      clicks?: string;
      impressions?: string;
    };
  }>;
};

/**
 * Campaign performance via Google Ads API search (GAQL).
 * Requires GOOGLE_ADS_DEVELOPER_TOKEN and OAuth adwords scope.
 */
export class GoogleAdsSnapshotService {
  private mcp = new MCPConnectionService();

  async fetchSnapshot(organizationId: string): Promise<GoogleAdsSnapshot | null> {
    const result = await this.fetchSnapshotResult(organizationId);
    return result.ok ? result.data : null;
  }

  async probeSnapshot(organizationId: string): Promise<SnapshotProbeResult> {
    const ctx = await this.mcp.getGoogleAdsContext(organizationId);
    const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
    if (!ctx || !devToken) return idleProbe('google_ads');
    return probeFromFetch('google_ads', true, await this.fetchSnapshotResult(organizationId));
  }

  async fetchSnapshotResult(
    organizationId: string
  ): Promise<SnapshotFetchResult<GoogleAdsSnapshot>> {
    const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
    if (!devToken) {
      return {
        ok: false,
        error: 'GOOGLE_ADS_DEVELOPER_TOKEN not configured',
        errorCode: 'MISSING_DEVELOPER_TOKEN',
        userMessage: 'Google Ads API is not configured on the server.',
      };
    }

    const ctx = await this.mcp.getGoogleAdsContext(organizationId);
    if (!ctx) {
      return {
        ok: false,
        error: 'Google Ads customer not configured',
        errorCode: null,
        userMessage: null,
      };
    }

    const customerId = ctx.customerId.replace(/-/g, '');
    const query = `
      SELECT
        campaign.name,
        metrics.cost_micros,
        metrics.conversions,
        metrics.clicks,
        metrics.impressions
      FROM campaign
      WHERE segments.date DURING LAST_30_DAYS
      ORDER BY metrics.cost_micros DESC
      LIMIT 15
    `.trim();

    const url = `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/googleAds:search`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        'developer-token': devToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      const err = await response.text();
      const parsed = parseGoogleAdsError(err, response.status);
      console.warn('[google-ads-snapshot] search failed:', response.status, err.slice(0, 400));
      return {
        ok: false,
        error: parsed.message,
        errorCode: parsed.code,
        userMessage: parsed.userMessage,
      };
    }

    const data = (await response.json()) as SearchResponse;
    const lines: string[] = [
      `Google Ads customer: ${customerId}`,
      'Date range: last 30 days',
      '',
      'Top campaigns by spend:',
    ];

    if (!data.results?.length) {
      lines.push('  (no campaign data in this period)');
    } else {
      for (const row of data.results) {
        const name = row.campaign?.name ?? 'Campaign';
        const cost = row.metrics?.costMicros
          ? `$${(Number(row.metrics.costMicros) / 1_000_000).toFixed(2)}`
          : 'n/a';
        const conv = row.metrics?.conversions ?? 0;
        const clicks = row.metrics?.clicks ?? '0';
        lines.push(`  - ${name}: spend ${cost}, conversions ${conv}, clicks ${clicks}`);
      }
    }

    return { ok: true, data: { customerId, text: lines.join('\n') } };
  }
}
