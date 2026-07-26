import { query } from '../database/connection.js';
import { MCPConnectionService } from '../services/mcpConnectionService.js';
import { logger } from '../lib/logger.js';

const log = logger('meta-reconcile');

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION ?? 'v21.0';

type LibraryRowForReconcile = {
  id: string;
  meta_campaign_id: string;
};

/**
 * Root cause fixed here: the paid-ad throttle previously trusted
 * `ad_campaign_library.status = 'pushed'` forever, even after the user
 * deleted the campaign directly in Meta Ads Manager. Because a deleted
 * campaign obviously shows $0 spend, the throttle would block new Meta
 * campaigns permanently with no way to self-heal.
 *
 * This reconciles local library rows against Meta's live campaign status
 * before the throttle makes its decision. Any campaign Meta no longer
 * recognises (deleted / not found) gets archived locally so it stops
 * counting toward "existing pipeline" in evaluateMetaAdsCreateThrottle.
 *
 * Fails soft: any error (no Meta connection, rate limit, network issue)
 * is swallowed and reconciliation is simply skipped for that cycle — it
 * never blocks or breaks the throttle decision itself.
 */
export async function reconcileMetaCampaignLibrary(organizationId: string): Promise<number> {
  let archivedCount = 0;

  try {
    const mcp = new MCPConnectionService();
    const ctx = await mcp.getMetaAdsContext(organizationId);
    if (!ctx) return 0; // Meta not connected — nothing to reconcile against.

    const rows = await query<LibraryRowForReconcile>(
      `SELECT id, meta_campaign_id
       FROM ad_campaign_library
       WHERE organization_id = $1
         AND is_active = TRUE
         AND status IN ('pushed', 'ready')
         AND meta_campaign_id IS NOT NULL`,
      [organizationId]
    );

    for (const row of rows.rows) {
      const stillExists = await metaCampaignStillExists(row.meta_campaign_id, ctx.accessToken);
      if (stillExists) continue;

      await query(
        `UPDATE ad_campaign_library
         SET status = 'archived', updated_at = NOW()
         WHERE id = $1 AND organization_id = $2`,
        [row.id, organizationId]
      );
      archivedCount += 1;
    }
  } catch (err) {
    log.warn(
      'skipped this cycle:', err);
  }

  return archivedCount;
}

/**
 * Returns false only when Meta positively tells us the campaign is gone
 * (deleted or otherwise inaccessible under this token). Any ambiguous
 * failure (network error, rate limit, transient 5xx) returns true so we
 * never archive a live campaign on a flaky request.
 */
async function metaCampaignStillExists(
  campaignId: string,
  accessToken: string
): Promise<boolean> {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${campaignId}`);
  url.searchParams.set('fields', 'id,effective_status,configured_status');
  url.searchParams.set('access_token', accessToken);

  let response: Response;
  try {
    response = await fetch(url.toString());
  } catch {
    return true; // network hiccup — don't archive on ambiguity
  }

  if (response.ok) {
    const data = (await response.json()) as { effective_status?: string };
    // DELETED is Meta's real value for a removed campaign; treat it as gone.
    return data.effective_status !== 'DELETED';
  }

  if (response.status === 400 || response.status === 404) {
    let code: number | undefined;
    try {
      const data = (await response.json()) as { error?: { code?: number; error_subcode?: number } };
      code = data.error?.code;
    } catch {
      /* ignore parse failure */
    }
    // Meta error code 100 = "Unsupported get request" / object does not
    // exist — this is what a deleted campaign ID returns.
    if (code === 100 || response.status === 404) return false;
  }

  // Any other error (auth, rate limit, 5xx) — assume it still exists.
  return true;
}
