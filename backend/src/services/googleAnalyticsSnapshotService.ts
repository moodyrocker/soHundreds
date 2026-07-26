import { MCPConnectionService } from './mcpConnectionService.js';
import type { SnapshotFetchResult, SnapshotProbeResult } from '../types/snapshot.js';
import { idleProbe, probeFromFetch } from '../types/snapshot.js';
import { gaSnapshotUserMessage } from '../utils/snapshotErrors.js';
import { logger } from '../lib/logger.js';

const log = logger('ga-snapshot');

export interface AnalyticsSnapshot {
  propertyId: string;
  text: string;
}

type RunReportResponse = {
  rows?: Array<{
    dimensionValues?: Array<{ value?: string }>;
    metricValues?: Array<{ value?: string }>;
  }>;
  totals?: Array<{
    metricValues?: Array<{ value?: string }>;
  }>;
};

type ReportResult =
  | { ok: true; data: RunReportResponse }
  | { ok: false; status: number; body: string };

/** GA4 returns aggregate metrics in `rows[0]` unless metricAggregations requests `totals`. */
function overviewMetricValues(
  data: RunReportResponse | null | undefined
): Array<{ value?: string }> | undefined {
  return data?.totals?.[0]?.metricValues ?? data?.rows?.[0]?.metricValues;
}

/**
 * Pulls GA4 metrics via the Data API (same OAuth as Integrations).
 * Avoids Anthropic's remote MCP connector, which often fails for analytics-mcp.googleapis.com.
 */
export class GoogleAnalyticsSnapshotService {
  private mcp = new MCPConnectionService();

  async fetchSnapshot(organizationId: string): Promise<AnalyticsSnapshot | null> {
    const result = await this.fetchSnapshotResult(organizationId);
    return result.ok ? result.data : null;
  }

  async probeSnapshot(organizationId: string): Promise<SnapshotProbeResult> {
    const connections = await this.mcp.getActiveConnections(organizationId);
    const ga = connections.find((c) => c.platform === 'google_analytics' && c.propertyId);
    if (!ga?.propertyId || !ga.accessToken) return idleProbe('google_analytics');
    return probeFromFetch(
      'google_analytics',
      true,
      await this.fetchSnapshotResult(organizationId)
    );
  }

  async fetchSnapshotResult(
    organizationId: string
  ): Promise<SnapshotFetchResult<AnalyticsSnapshot>> {
    const connections = await this.mcp.getActiveConnections(organizationId);
    const ga = connections.find((c) => c.platform === 'google_analytics' && c.propertyId);
    if (!ga?.propertyId || !ga.accessToken) {
      return {
        ok: false,
        error: 'GA4 property not configured',
        errorCode: null,
        userMessage: null,
      };
    }

    const propertyId = ga.propertyId.startsWith('properties/')
      ? ga.propertyId
      : `properties/${ga.propertyId}`;

    const headers = {
      Authorization: `Bearer ${ga.accessToken}`,
      'Content-Type': 'application/json',
    };

    const baseUrl = `https://analyticsdata.googleapis.com/v1beta/${propertyId}:runReport`;

    const [overview, channels] = await Promise.all([
      this.runReport(baseUrl, headers, {
        dateRanges: [{ startDate: '28daysAgo', endDate: 'yesterday' }],
        metrics: [
          { name: 'activeUsers' },
          { name: 'sessions' },
          { name: 'engagementRate' },
        ],
      }),
      this.runReport(baseUrl, headers, {
        dateRanges: [{ startDate: '28daysAgo', endDate: 'yesterday' }],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
        orderBys: [{ desc: true, metric: { metricName: 'sessions' } }],
        limit: 8,
      }),
    ]);

    if (!overview.ok) {
      log.warn(
        'overview runReport failed:',
        overview.status,
        overview.body.slice(0, 300)
      );
      return {
        ok: false,
        error: overview.body.slice(0, 400),
        errorCode: `HTTP_${overview.status}`,
        userMessage: gaSnapshotUserMessage(overview.status, overview.body),
      };
    }

    if (!overviewMetricValues(overview.data)?.length) {
      return {
        ok: false,
        error: 'GA4 overview returned no metric values for the last 28 days',
        errorCode: 'NO_METRICS',
        userMessage:
          'No GA4 metrics for this property in the last 28 days. Confirm you selected the correct property on Integrations, or enable the Google Analytics Data API on your GCP OAuth project.',
      };
    }

    const lines: string[] = [
      `GA4 property: ${propertyId}`,
      'Date range: last 28 days (ending yesterday)',
      '',
      'Site overview:',
      this.formatMetricRow(overview.ok ? overview.data : null, [
        'activeUsers',
        'sessions',
        'engagementRate',
      ]),
      '',
      'Traffic by channel:',
      this.formatChannelRows(channels.ok ? channels.data : null),
    ];

    return {
      ok: true,
      data: {
        propertyId,
        text: lines.join('\n'),
      },
    };
  }

  private async runReport(
    url: string,
    headers: Record<string, string>,
    body: Record<string, unknown>
  ): Promise<ReportResult> {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      return { ok: false, status: response.status, body: err };
    }

    return { ok: true, data: (await response.json()) as RunReportResponse };
  }

  private formatMetricRow(
    data: RunReportResponse | null,
    labels: string[]
  ): string {
    const metricValues = overviewMetricValues(data);
    if (!metricValues?.length) {
      return '  (no overview metrics in response)';
    }

    return labels
      .map((label, i) => {
        const raw = metricValues[i]?.value ?? 'n/a';
        const value =
          label === 'engagementRate' && raw !== 'n/a'
            ? `${(Number(raw) * 100).toFixed(1)}%`
            : raw;
        return `  - ${label}: ${value}`;
      })
      .join('\n');
  }

  private formatChannelRows(data: RunReportResponse | null): string {
    if (!data?.rows?.length) {
      return '  (channel breakdown unavailable)';
    }

    return data.rows
      .map((row) => {
        const channel = row.dimensionValues?.[0]?.value ?? 'Unknown';
        const sessions = row.metricValues?.[0]?.value ?? '0';
        const users = row.metricValues?.[1]?.value ?? '0';
        return `  - ${channel}: ${sessions} sessions, ${users} active users`;
      })
      .join('\n');
  }
}
