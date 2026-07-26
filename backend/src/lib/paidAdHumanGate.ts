import type { ExecutionRecord, MetaAdsCampaignState } from '../types/execution.js';

const DEFAULT_META_COPY =
  'Review the paused campaign in Meta Ads Manager, then mark done to continue.';

const DEFAULT_GOOGLE_COPY =
  'Review the paused campaign in Google Ads, then mark done to continue.';

export function buildPaidAdHumanGateReason(execution: ExecutionRecord): string {
  const payload = (execution.afterState ?? execution.proposedState) as
    | MetaAdsCampaignState
    | { kind?: string }
    | null;

  if (payload?.kind === 'meta_ads_campaign') {
    const campaign = payload as MetaAdsCampaignState;
    if (campaign.campaignId) {
      const withImages = campaign.ads.filter((a) => a.imageUrl || a.imageHash).length;
      const creativeNote =
        withImages > 0
          ? ` Agent already attached ${withImages} creative image${withImages === 1 ? '' : 's'}.`
          : '';
      return `Hundres created paused campaign "${campaign.campaignName}" in Ads Manager (ID ${campaign.campaignId}).${creativeNote} Open Ads Manager only to turn spend on when you are ready — then mark done.`;
    }
    return `Campaign "${campaign.campaignName}" will be created paused in Ads Manager when the agent runs this step (copy + images).`;
  }

  if (execution.executionType === 'create_meta_ads_campaign') {
    return DEFAULT_META_COPY;
  }

  if (execution.executionType === 'create_google_ads_campaign') {
    return DEFAULT_GOOGLE_COPY;
  }

  return DEFAULT_META_COPY;
}
