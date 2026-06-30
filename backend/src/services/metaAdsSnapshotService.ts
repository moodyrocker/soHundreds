import { MCPConnectionService } from './mcpConnectionService.js';
import type { SnapshotFetchResult, SnapshotProbeResult } from '../types/snapshot.js';
import { idleProbe, probeFromFetch } from '../types/snapshot.js';
import { metaSnapshotUserMessage } from '../utils/snapshotErrors.js';

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION ?? 'v21.0';

export interface MetaAdsSnapshot {
  adAccountId: string;
  text: string;
}

type InsightsRow = {
  campaign_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: Array<{ action_type?: string; value?: string }>;
};

/**
 * Campaign insights via Meta Marketing API (read-only ads_read).
 */
export class MetaAdsSnapshotService {
  private mcp = new MCPConnectionService();

  async fetchSnapshot(organizationId: string): Promise<MetaAdsSnapshot | null> {
    const result = await this.fetchSnapshotResult(organizationId);
    return result.ok ? result.data : null;
  }

  async probeSnapshot(organizationId: string): Promise<SnapshotProbeResult> {
    const ctx = await this.mcp.getMetaAdsContext(organizationId);
    if (!ctx) return idleProbe('meta_ads');
    return probeFromFetch('meta_ads', true, await this.fetchSnapshotResult(organizationId));
  }

  async fetchSnapshotResult(
    organizationId: string
  ): Promise<SnapshotFetchResult<MetaAdsSnapshot>> {
    const ctx = await this.mcp.getMetaAdsContext(organizationId);
    if (!ctx) {
      return {
        ok: false,
        error: 'Meta ad account not configured',
        errorCode: null,
        userMessage: null,
      };
    }

    const accountId = normalizeAdAccountId(ctx.adAccountId);
    const url = new URL(
      `https://graph.facebook.com/${GRAPH_VERSION}/${accountId}/insights`
    );
    url.searchParams.set('level', 'campaign');
    url.searchParams.set('date_preset', 'last_30d');
    url.searchParams.set(
      'fields',
      'campaign_name,spend,impressions,clicks,actions'
    );
    url.searchParams.set('limit', '15');
    url.searchParams.set('access_token', ctx.accessToken);

    const response = await fetch(url);

    if (!response.ok) {
      const err = await response.text();
      console.warn('[meta-ads-snapshot] insights failed:', response.status, err.slice(0, 400));
      return {
        ok: false,
        error: err.slice(0, 400),
        errorCode: `HTTP_${response.status}`,
        userMessage: metaSnapshotUserMessage(response.status, err),
      };
    }

    const data = (await response.json()) as { data?: InsightsRow[] };
    const lines: string[] = [
      `Meta ad account: ${accountId}`,
      'Date range: last 30 days',
      '',
      'Top campaigns by spend:',
    ];

    if (!data.data?.length) {
      lines.push('  (no campaign data in this period)');
    } else {
      for (const row of data.data) {
        const name = row.campaign_name ?? 'Campaign';
        const spend = row.spend ? `$${Number(row.spend).toFixed(2)}` : 'n/a';
        const clicks = row.clicks ?? '0';
        const impressions = row.impressions ?? '0';
        const purchases = sumAction(row.actions, 'purchase');
        lines.push(
          `  - ${name}: spend ${spend}, clicks ${clicks}, impressions ${impressions}, purchases ${purchases}`
        );
      }
    }

    return { ok: true, data: { adAccountId: accountId, text: lines.join('\n') } };
  }
}

function normalizeAdAccountId(id: string): string {
  const trimmed = id.trim();
  if (trimmed.startsWith('act_')) return trimmed;
  return `act_${trimmed.replace(/^act_/, '')}`;
}

function sumAction(
  actions: InsightsRow['actions'],
  actionType: string
): string {
  if (!actions?.length) return '0';
  let total = 0;
  for (const a of actions) {
    if (a.action_type === actionType && a.value) {
      total += Number(a.value);
    }
  }
  return String(total);
}
