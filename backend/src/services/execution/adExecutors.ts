import { evaluateMetaAdsCreateThrottle } from '../../lib/paidAdThrottle.js';
import { logger } from '../../lib/logger.js';
import { asGoogleAdsCampaign, asMetaAdsCampaign } from './payloads.js';
import { PreflightRefusal } from './types.js';
import type { ApplyContext, ApplyResult, PlatformExecutor } from './types.js';

const log = logger('execution:ads');

/**
 * The two executors that spend real money.
 *
 * Extracted last, deliberately: a mistake here is not a wrong page on a
 * storefront, it is budget leaving a customer's account. Everything below is a
 * move, not a rewrite — same order of operations, same guards, same wording.
 *
 * Both create campaigns **paused**. Nothing here turns spend on; that is always a
 * human action in Ads Manager, which is what the human gate copy in
 * lib/paidAdHumanGate.ts tells the user.
 */

/** Creates a paused Google Ads campaign. */
export const googleAdsExecutor: PlatformExecutor = {
  executionType: 'create_google_ads_campaign',
  label: 'Google Ads campaign',

  async apply({ organizationId, row, deps }: ApplyContext): Promise<ApplyResult> {
    const proposed = asGoogleAdsCampaign(row.proposed_state);

    const after = await deps.googleAdsCampaign.createPausedCampaign(organizationId, proposed);

    return {
      after,
      summary: `Created paused Google Ads campaign "${after.campaignName}" — enable it in Google Ads when ready.`,
    };
  },
};

/** Creates a paused Meta campaign, attaching creatives where available. */
export const metaAdsExecutor: PlatformExecutor = {
  executionType: 'create_meta_ads_campaign',
  label: 'Meta Ads campaign',

  async apply({ organizationId, executionId, row, deps }: ApplyContext): Promise<ApplyResult> {
    const proposed = asMetaAdsCampaign(row.proposed_state);

    // The spend guard, and the reason this executor is the most careful of the
    // seven. It refuses a *new* campaign while earlier ones sit at zero spend:
    // creating more before any of them has produced data is spending without
    // learning. Skipped when campaignId is already set, because that is a
    // re-run against an existing campaign rather than a new one.
    if (!proposed.campaignId) {
      const throttle = await evaluateMetaAdsCreateThrottle(organizationId);
      if (!throttle.allowCreate) {
        // Refused before any Meta API call, so the execution stays retryable
        // once earlier campaigns have produced spend data.
        throw new PreflightRefusal(throttle.reason);
      }
    }

    // Creative enrichment is best-effort. A campaign without images is still a
    // valid paused campaign the user can complete in Ads Manager, so a failure
    // here must not block the create.
    let proposal = proposed;
    try {
      proposal = await deps.adCampaignLibrary.enrichWithCreatives(organizationId, proposed, {
        sourceExecutionId: executionId,
        channel: 'meta',
      });
    } catch (creativeErr) {
      log.warn('Meta creative prep skipped:', creativeErr);
    }

    const after = await deps.metaAdsCampaign.createPausedCampaign(organizationId, proposal);

    // Library upsert runs before the caller persists and audits, preserving the
    // original ordering. Also best-effort: the campaign exists in Ads Manager
    // either way, and metaCampaignReconciliation repairs the library later —
    // which is what stops a stale library row blocking future creates.
    try {
      await deps.adCampaignLibrary.upsertFromMetaState(organizationId, after, {
        sourceExecutionId: executionId,
        channel: 'meta',
      });
    } catch (libErr) {
      log.warn('failed to save Meta campaign to ads library:', libErr);
    }

    return {
      after,
      summary: `Created paused Meta campaign "${after.campaignName}" with creatives (ID ${after.campaignId}) — enable spend in Ads Manager when ready.`,
    };
  },
};
