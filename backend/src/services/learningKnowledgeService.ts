import { query } from '../database/connection.js';
import {
  learningDecayDays,
  learningMinSampleSize,
  learningTopPatterns,
} from '../lib/learningConfig.js';
import type {
  LearningPatternApplied,
  LearningPatternRecord,
  LearningPromptContext,
} from '../types/learning.js';

type PatternRow = {
  id: string;
  organization_id: string;
  pattern_key: string;
  pattern_text: string;
  execution_type: string | null;
  action_channel: string | null;
  confidence: string;
  sample_size: number;
  success_rate: string | null;
  avg_score: string | null;
  goal_context_hint: string | null;
  last_reinforced_at: Date;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type AggregateRow = {
  execution_type: string;
  action_channel: string | null;
  sample_size: string;
  success_rate: string;
  avg_score: string;
  goal_context_hint: string | null;
};

function mapPatternRow(row: PatternRow): LearningPatternRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    patternKey: row.pattern_key,
    patternText: row.pattern_text,
    executionType: row.execution_type,
    actionChannel: row.action_channel,
    confidence: Number(row.confidence),
    sampleSize: row.sample_size,
    successRate: row.success_rate != null ? Number(row.success_rate) : null,
    avgScore: row.avg_score != null ? Number(row.avg_score) : null,
    goalContextHint: row.goal_context_hint,
    lastReinforcedAt: row.last_reinforced_at.toISOString(),
    expiresAt: row.expires_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function patternKey(executionType: string, channel: string | null): string {
  return `${executionType}:${channel ?? 'any'}`;
}

function humanLabel(executionType: string, channel: string | null): string {
  if (executionType === 'create_meta_ads_campaign') return 'Meta Ads campaigns';
  if (executionType === 'create_google_ads_campaign') return 'Google Ads campaigns';
  if (executionType === 'create_shopify_page') return 'Shopify landing pages';
  if (executionType === 'update_product_seo') return 'Product SEO updates';
  if (channel === 'instagram' || channel === 'content') return 'UGC / content actions';
  if (channel === 'email') return 'Email campaigns';
  if (channel === 'paid') return 'Paid ad actions';
  if (executionType === 'assist_deliverable') return `${channel ?? 'Assist'} deliverables`;
  return `${executionType} (${channel ?? 'general'})`;
}

function buildPatternText(
  executionType: string,
  channel: string | null,
  successRate: number,
  sampleSize: number,
  avgScore: number,
  goalHint: string | null
): string {
  const label = humanLabel(executionType, channel);
  const pct = Math.round(successRate * 100);
  const direction =
    avgScore >= 0.5 ? 'tended to correlate with metric gains' : avgScore <= -0.15 ? 'often coincided with weaker blocks' : 'had mixed results';
  const goalPart = goalHint ? ` for ${goalHint}` : '';
  return `${label} ${direction}${goalPart} (${pct}% positive rating across ${sampleSize} actions).`;
}

/**
 * Aggregates action_outcomes into ranked learning_patterns (#3).
 * Gracefully no-ops when insufficient data (#6).
 */
export class LearningKnowledgeService {
  async refreshPatterns(organizationId: string): Promise<LearningPatternRecord[]> {
    const minSample = learningMinSampleSize();
    const decayDays = learningDecayDays();

    const agg = await query<AggregateRow>(
      `SELECT
         execution_type,
         action_channel,
         COUNT(*)::text AS sample_size,
         AVG(CASE WHEN rating = 'success' THEN 1.0 WHEN rating = 'failure' THEN 0.0 ELSE 0.5 END)::text AS success_rate,
         AVG(effectiveness_score)::text AS avg_score,
         MODE() WITHIN GROUP (ORDER BY goal_context) AS goal_context_hint
       FROM action_outcomes
       WHERE organization_id = $1
         AND created_at >= NOW() - ($2 || ' days')::interval
         AND rating != 'unknown'
       GROUP BY execution_type, action_channel
       HAVING COUNT(*) >= $3
       ORDER BY AVG(effectiveness_score) DESC
       LIMIT 20`,
      [organizationId, String(decayDays), minSample]
    );

    const patterns: LearningPatternRecord[] = [];
    const expiresAt = new Date(Date.now() + decayDays * 24 * 60 * 60 * 1000);

    for (const row of agg.rows) {
      const sampleSize = Number(row.sample_size);
      const successRate = Number(row.success_rate);
      const avgScore = Number(row.avg_score);
      const key = patternKey(row.execution_type, row.action_channel);
      const confidence = Math.min(
        0.95,
        0.35 + sampleSize * 0.08 + Math.abs(avgScore) * 0.25
      );
      const patternText = buildPatternText(
        row.execution_type,
        row.action_channel,
        successRate,
        sampleSize,
        avgScore,
        row.goal_context_hint
      );

      const result = await query<PatternRow>(
        `INSERT INTO learning_patterns (
           organization_id, pattern_key, pattern_text,
           execution_type, action_channel, confidence, sample_size,
           success_rate, avg_score, goal_context_hint,
           last_reinforced_at, expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),$11)
         ON CONFLICT (organization_id, pattern_key) DO UPDATE SET
           pattern_text = EXCLUDED.pattern_text,
           confidence = EXCLUDED.confidence,
           sample_size = EXCLUDED.sample_size,
           success_rate = EXCLUDED.success_rate,
           avg_score = EXCLUDED.avg_score,
           goal_context_hint = EXCLUDED.goal_context_hint,
           last_reinforced_at = NOW(),
           expires_at = EXCLUDED.expires_at,
           updated_at = NOW()
         RETURNING *`,
        [
          organizationId,
          key,
          patternText,
          row.execution_type,
          row.action_channel,
          confidence,
          sampleSize,
          successRate,
          avgScore,
          row.goal_context_hint,
          expiresAt,
        ]
      );
      patterns.push(mapPatternRow(result.rows[0]));
    }

    // Decay: remove expired patterns for this org
    await query(
      `DELETE FROM learning_patterns
       WHERE organization_id = $1 AND expires_at IS NOT NULL AND expires_at < NOW()`,
      [organizationId]
    );

    return patterns;
  }

  /** Top-N patterns for planning prompt injection (#4). Empty when no history (#6). */
  async getPatternsForPlanning(
    organizationId: string,
    goalMetricHint?: string | null
  ): Promise<LearningPromptContext> {
    const topN = learningTopPatterns();
    const minSample = learningMinSampleSize();

    const result = await query<PatternRow>(
      `SELECT * FROM learning_patterns
       WHERE organization_id = $1
         AND sample_size >= $2
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY confidence DESC, sample_size DESC, avg_score DESC NULLS LAST
       LIMIT $3`,
      [organizationId, minSample, topN]
    );

    const patterns = result.rows.map(mapPatternRow);
    if (!patterns.length) {
      return { patterns: [], promptSection: '', applied: [] };
    }

    const applied: LearningPatternApplied[] = patterns.map((p) => ({
      patternKey: p.patternKey,
      pattern: p.patternText,
      confidence: p.confidence,
      sampleSize: p.sampleSize,
    }));

    const goalLine = goalMetricHint?.trim()
      ? `Goal metric context: ${goalMetricHint}\n`
      : '';

    const bullets = patterns
      .map(
        (p, i) =>
          `${i + 1}. [confidence ${Math.round(p.confidence * 100)}%, n=${p.sampleSize}] ${p.patternText}`
      )
      .join('\n');

    const promptSection = `${goalLine}HISTORICAL LEARNING (what worked for this account — weight new actions accordingly, cite in action "why" when relevant):
${bullets}

These patterns are evidence from past blocks, not rules. Combine with current checkpoint data and live metrics.

`;

    return { patterns, promptSection, applied };
  }

  async listPatterns(organizationId: string): Promise<LearningPatternRecord[]> {
    const result = await query<PatternRow>(
      `SELECT * FROM learning_patterns
       WHERE organization_id = $1
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY confidence DESC, sample_size DESC
       LIMIT 20`,
      [organizationId]
    );
    return result.rows.map(mapPatternRow);
  }
}
