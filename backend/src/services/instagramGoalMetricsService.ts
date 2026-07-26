import { query } from '../database/connection.js';
import {
  igGetMediaInsights,
  igGetProfile,
  igListMedia,
  type InstagramContext,
} from '../lib/instagramGraphClient.js';
import { MCPConnectionService } from './mcpConnectionService.js';

type InsightResponse = {
  data?: Array<{ name: string; values?: Array<{ value?: number }> }>;
};

export type InstagramEngagementSnapshot = {
  mediaId: string;
  likes: number;
  comments: number;
  saves: number;
  reach: number;
  followers: number;
  engagementRate: number;
};

function readInsightValue(insights: InsightResponse, name: string): number {
  const row = insights.data?.find((d) => d.name === name);
  const v = row?.values?.[0]?.value;
  return typeof v === 'number' ? v : 0;
}

export class InstagramGoalMetricsService {
  private mcp = new MCPConnectionService();

  async fetchLatestPostEngagementRate(
    organizationId: string,
    strategyId?: string
  ): Promise<InstagramEngagementSnapshot | null> {
    const ctx = await this.mcp.getInstagramContext(organizationId);
    if (!ctx) return null;

    const mediaId =
      (strategyId ? await this.findLatestMediaIdForStrategy(organizationId, strategyId) : null) ??
      (await this.findLatestMediaIdFromAccount(ctx));
    if (!mediaId) return null;

    const [insights, profile] = await Promise.all([
      igGetMediaInsights(ctx, mediaId, 'likes,comments,saved,reach') as Promise<InsightResponse>,
      igGetProfile(ctx) as Promise<{ followers_count?: number }>,
    ]);

    const likes = readInsightValue(insights, 'likes');
    const comments = readInsightValue(insights, 'comments');
    const saves = readInsightValue(insights, 'saved');
    const reach = readInsightValue(insights, 'reach');
    const followers = profile.followers_count ?? 0;
    const engagements = likes + comments + saves;

    const denominator = followers > 0 ? followers : reach > 0 ? reach : null;
    if (denominator === null || denominator === 0) return null;

    const engagementRate = Math.round((engagements / denominator) * 10000) / 100;

    return {
      mediaId,
      likes,
      comments,
      saves,
      reach,
      followers,
      engagementRate,
    };
  }

  private async findLatestMediaIdForStrategy(
    organizationId: string,
    strategyId: string
  ): Promise<string | null> {
    const result = await query<{ media_id: string }>(
      `SELECT proposed_state->>'mediaId' AS media_id
       FROM action_executions
       WHERE organization_id = $1 AND strategy_id = $2
         AND platform = 'instagram'
         AND status = 'executed'
         AND proposed_state->>'kind' = 'instagram_publish'
         AND proposed_state->>'mediaId' IS NOT NULL
         AND proposed_state->>'mediaId' != ''
       ORDER BY executed_at DESC NULLS LAST, updated_at DESC
       LIMIT 1`,
      [organizationId, strategyId]
    );
    return result.rows[0]?.media_id ?? null;
  }

  private async findLatestMediaIdFromAccount(ctx: InstagramContext): Promise<string | null> {
    const list = await igListMedia(ctx, 1);
    const first = list.data?.[0] as { id?: string } | undefined;
    return first?.id ?? null;
  }
}
