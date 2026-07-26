import { query } from '../database/connection.js';
import { MetaAdsSnapshotService } from '../services/metaAdsSnapshotService.js';
import { reconcileMetaCampaignLibrary } from './metaCampaignReconciliation.js';

export type MetaCampaignPerfRow = {
  name: string;
  spend: number;
  clicks: number;
  impressions: number;
  purchases: number;
};

export type PaidAdThrottleDecision = {
  /** False = do not create another Meta campaign yet */
  allowCreate: boolean;
  reason: string;
  awaitingHumanCount: number;
  pushedLibraryCount: number;
  executedRecentCount: number;
  accountSpendLast30d: number | null;
  /** Parsed Meta insights (last 30d) — empty if none / fetch failed */
  performance: MetaCampaignPerfRow[];
  /** Library campaigns already pushed to Meta */
  librarySummary: Array<{
    name: string;
    slug: string;
    metaCampaignId: string | null;
    status: string;
    pushedAt: string | null;
  }>;
};

/**
 * Decision gate: multiple Meta campaigns are fine once we have spend/performance
 * data. Creating more while earlier ones sit at $0 spend is pointless — no signal
 * to learn from.
 */
export async function evaluateMetaAdsCreateThrottle(
  organizationId: string
): Promise<PaidAdThrottleDecision> {
  // Reconcile local library records against Meta's live campaign status first.
  // Fixes: deleting a campaign in Ads Manager directly (outside Hundres) used
  // to leave a stale 'pushed' row here forever, permanently blocking new
  // campaign creation since a deleted campaign always shows $0 spend.
  await reconcileMetaCampaignLibrary(organizationId);

  const awaiting = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM action_run_states ars
     LEFT JOIN action_executions ae ON ae.id = ars.execution_id
     WHERE ars.organization_id = $1
       AND ars.run_status = 'awaiting_human_action'
       AND (
         ae.execution_type = 'create_meta_ads_campaign'
         OR ars.human_gate_reason ILIKE '%Meta%'
         OR ars.human_gate_reason ILIKE '%Ads Manager%'
       )`,
    [organizationId]
  );
  const awaitingHumanCount = Number(awaiting.rows[0]?.count ?? 0);

  const libraryRows = await query<{
    name: string;
    slug: string;
    meta_campaign_id: string | null;
    status: string;
    meta_pushed_at: Date | null;
  }>(
    `SELECT name, slug, meta_campaign_id, status, meta_pushed_at
     FROM ad_campaign_library
     WHERE organization_id = $1
       AND is_active = TRUE
       AND status IN ('pushed', 'ready', 'draft')
     ORDER BY updated_at DESC
     LIMIT 25`,
    [organizationId]
  );
  const librarySummary = libraryRows.rows.map((r) => ({
    name: r.name,
    slug: r.slug,
    metaCampaignId: r.meta_campaign_id,
    status: r.status,
    pushedAt: r.meta_pushed_at?.toISOString() ?? null,
  }));
  const pushedLibraryCount = librarySummary.filter(
    (c) => c.status === 'pushed' && c.metaCampaignId
  ).length;

  const executed = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM action_executions
     WHERE organization_id = $1
       AND execution_type = 'create_meta_ads_campaign'
       AND status = 'executed'
       AND created_at > NOW() - INTERVAL '60 days'`,
    [organizationId]
  );
  const executedRecentCount = Number(executed.rows[0]?.count ?? 0);

  let accountSpendLast30d: number | null = null;
  let performance: MetaCampaignPerfRow[] = [];
  let snapshotText: string | null = null;
  try {
    const snapshot = await new MetaAdsSnapshotService().fetchSnapshot(organizationId);
    if (snapshot?.text) {
      snapshotText = snapshot.text;
      performance = parseCampaignPerformanceFromSnapshot(snapshot.text);
      accountSpendLast30d = performance.reduce((sum, row) => sum + row.spend, 0);
    }
  } catch {
    accountSpendLast30d = null;
  }

  const hasExistingPipeline =
    awaitingHumanCount > 0 || pushedLibraryCount > 0 || executedRecentCount > 0;
  const noSpendSignal = accountSpendLast30d == null || accountSpendLast30d <= 0;

  const base = {
    awaitingHumanCount,
    pushedLibraryCount,
    executedRecentCount,
    accountSpendLast30d,
    performance,
    librarySummary,
  };

  // Multiple campaigns OK — but only after we have performance signal on prior work.
  if (hasExistingPipeline && noSpendSignal) {
    const existingLabel =
      pushedLibraryCount > 0
        ? `${pushedLibraryCount} Meta campaign(s) in your library (paused / pushed)`
        : executedRecentCount > 0
          ? `${executedRecentCount} Meta campaign(s) created recently`
          : `${awaitingHumanCount} Meta campaign(s) parked for spend review`;

    return {
      ...base,
      allowCreate: false,
      reason: `${existingLabel} but Meta shows $0 spend in the last 30 days — so there is no performance data to learn from. Enable spend on an existing paused campaign first; then the agent can run additional campaigns using those results. Creating more paused ads without data is pointless.`,
    };
  }

  if (accountSpendLast30d && accountSpendLast30d > 0) {
    const top = [...performance].sort((a, b) => b.spend - a.spend)[0];
    return {
      ...base,
      allowCreate: true,
      reason: `Meta has spend signal ($${accountSpendLast30d.toFixed(2)} / 30d)${
        top ? ` — top: “${top.name}” ($${top.spend.toFixed(2)}, ${top.clicks} clicks)` : ''
      }. Additional campaigns are allowed; prefer doubling down on what works.`,
    };
  }

  return {
    ...base,
    allowCreate: true,
    reason:
      'No prior Meta campaigns with unpaid pipeline — first campaign create is allowed (will be paused until you enable spend).',
  };
}

export function parseCampaignPerformanceFromSnapshot(text: string): MetaCampaignPerfRow[] {
  const rows: MetaCampaignPerfRow[] = [];
  // "- Name: spend $12.34, clicks 10, impressions 100, purchases 1"
  const re =
    /^\s*-\s*(.+?):\s*spend\s+\$([0-9]+(?:\.[0-9]+)?|n\/a),\s*clicks\s+(\d+|n\/a),\s*impressions\s+(\d+|n\/a),\s*purchases\s+(\d+|n\/a)/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) != null) {
    rows.push({
      name: m[1].trim(),
      spend: m[2] === 'n/a' ? 0 : Number(m[2]) || 0,
      clicks: m[3] === 'n/a' ? 0 : Number(m[3]) || 0,
      impressions: m[4] === 'n/a' ? 0 : Number(m[4]) || 0,
      purchases: m[5] === 'n/a' ? 0 : Number(m[5]) || 0,
    });
  }
  return rows;
}

function formatPerformanceBlock(decision: PaidAdThrottleDecision): string {
  const lines: string[] = [];

  if (decision.performance.length) {
    lines.push('META CAMPAIGN PERFORMANCE (last 30 days — use this to decide what to do next):');
    const sorted = [...decision.performance].sort((a, b) => b.spend - a.spend);
    for (const row of sorted.slice(0, 12)) {
      const verdict =
        row.spend <= 0
          ? 'NO DATA YET (still paused or no spend)'
          : row.purchases > 0
            ? 'WORKING (has purchases)'
            : row.clicks > 0
              ? 'TRAFFIC (clicks, watch CPA)'
              : 'SPEND WITH WEAK ENGAGEMENT';
      lines.push(
        `  - ${row.name}: spend $${row.spend.toFixed(2)}, clicks ${row.clicks}, impressions ${row.impressions}, purchases ${row.purchases} → ${verdict}`
      );
    }
  } else if (decision.accountSpendLast30d === 0) {
    lines.push(
      'META CAMPAIGN PERFORMANCE (last 30 days): no campaign spend yet — Meta has nothing to learn from.'
    );
  } else {
    lines.push(
      'META CAMPAIGN PERFORMANCE: insights unavailable this cycle — be conservative on new paid tests.'
    );
  }

  if (decision.librarySummary.length) {
    lines.push('');
    lines.push('HUNDRES AD CAMPAIGN LIBRARY (agent-created blueprints):');
    for (const c of decision.librarySummary.slice(0, 12)) {
      const meta = c.metaCampaignId ? `Meta ID ${c.metaCampaignId}` : 'not pushed';
      lines.push(`  - ${c.name} [${c.status}] · ${meta}`);
    }
  }

  return lines.join('\n');
}

/**
 * Full prompt block for plan generation / week advance / Meta drafting.
 * Feeds prior campaign performance into the decision layer.
 */
export function formatMetaAdsThrottleForPrompt(decision: PaidAdThrottleDecision): string {
  const perf = formatPerformanceBlock(decision);

  if (!decision.allowCreate) {
    return `
PAID META RULE (critical — obey strictly):
Multiple Meta campaigns are allowed later — but NOT while prior ones have $0 spend / no performance data.
Reason: ${decision.reason}

${perf}

DO NOT add any new "Create Meta campaign" actions this week.
Instead: recommend enabling one existing paused campaign in Ads Manager, then measure; or schedule organic Instagram / Shopify / content.
If you mention paid ads, phrase as "Review & enable existing paused Meta campaign using Ads Manager" — never "Create new campaign".
`;
  }

  if (decision.accountSpendLast30d && decision.accountSpendLast30d > 0) {
    return `
PAID META RULE:
Multiple Meta campaigns are allowed. You HAVE performance data — use it.
${perf}

Guidance:
- Prefer 0–1 NEW Meta campaign actions only if a clear gap remains (new angle / audience / offer).
- Double down on campaigns marked WORKING or TRAFFIC (reuse angles, audiences, creatives that performed).
- Avoid cloning losers (spend with weak engagement) unless the brief explicitly tests a fix.
- New campaigns are still created PAUSED — user enables spend.
`;
  }

  return `
PAID META RULE:
First Meta campaign is fine (created PAUSED). After it runs with spend, feed those results into the next decision before stacking more campaigns.

${perf}
`;
}

/** Compact block for Meta campaign copy generation. */
export function formatMetaAdsPerformanceForCreativePrompt(
  decision: PaidAdThrottleDecision
): string {
  if (!decision.performance.length && decision.librarySummary.length === 0) {
    return '';
  }
  return `
EXISTING META / LIBRARY CONTEXT (design copy that learns from this — do not invent new campaigns if $0 spend):
${formatPerformanceBlock(decision)}
${decision.allowCreate ? '' : `\nBLOCKED FROM CREATING ANOTHER CAMPAIGN: ${decision.reason}`}
`.trim();
}
