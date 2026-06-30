import type { MetaAdsCampaignState } from '../types/execution.js';
import { MCPConnectionService } from './mcpConnectionService.js';

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION ?? 'v21.0';

type GraphError = { error?: { message?: string; code?: number } };

export type MetaAdsCampaignCreateResult = MetaAdsCampaignState & {
  campaignId: string;
  adSetId: string;
  adAccountId: string;
  status: 'created_paused';
};

function graphUrl(path: string, accessToken: string): string {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`);
  url.searchParams.set('access_token', accessToken);
  return url.toString();
}

async function graphPost(
  path: string,
  accessToken: string,
  params: Record<string, string>
): Promise<Record<string, unknown>> {
  const body = new URLSearchParams(params);
  const response = await fetch(graphUrl(path, accessToken), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = (await response.json()) as Record<string, unknown> & GraphError;
  if (!response.ok || data.error) {
    const err = data.error as { message?: string; error_user_msg?: string } | undefined;
    const message = err?.error_user_msg ?? err?.message ?? `Meta API error (${response.status})`;
    console.warn('[meta-ads-campaign] POST failed:', path, message);
    throw new Error(message);
  }
  return data;
}

function budgetMinorUnits(amount: number): string {
  return String(Math.max(100, Math.round(amount * 100)));
}

/**
 * Creates a Meta (Facebook/Instagram) campaign as PAUSED — user enables in Ads Manager.
 * Requires ads_management OAuth scope and a Facebook Page linked to the user.
 */
export class MetaAdsCampaignService {
  private mcp = new MCPConnectionService();

  async createPausedCampaign(
    organizationId: string,
    proposal: MetaAdsCampaignState
  ): Promise<MetaAdsCampaignCreateResult> {
    const ctx = await this.mcp.getMetaAdsContext(organizationId);
    if (!ctx) {
      throw new Error('Connect Meta Ads in Integrations and select an ad account first.');
    }

    const adAccountId = ctx.adAccountId.startsWith('act_')
      ? ctx.adAccountId
      : `act_${ctx.adAccountId.replace(/\D/g, '')}`;

    const pageId = await this.mcp.getMetaPromotePageId(organizationId);
    if (!pageId) {
      throw new Error(
        'No Facebook Page found for this account. Link a Page to your Meta account, reconnect Meta in Integrations (grant pages access), then try again.'
      );
    }

    const campaign = await graphPost(`${adAccountId}/campaigns`, ctx.accessToken, {
      name: proposal.campaignName,
      objective: proposal.objective,
      status: 'PAUSED',
      special_ad_categories: '[]',
      is_adset_budget_sharing_enabled: 'false',
    });

    const campaignId = String(campaign.id ?? '');
    if (!campaignId) {
      throw new Error('Meta did not return a campaign ID.');
    }

    const targeting = {
      geo_locations: { countries: proposal.targeting.countries },
      age_min: proposal.targeting.ageMin,
      age_max: proposal.targeting.ageMax,
      publisher_platforms: ['facebook', 'instagram'],
      targeting_automation: { advantage_audience: 0 },
    };

    const adSet = await graphPost(`${adAccountId}/adsets`, ctx.accessToken, {
      name: `${proposal.campaignName} · Ad set`,
      campaign_id: campaignId,
      daily_budget: budgetMinorUnits(proposal.dailyBudget),
      billing_event: 'IMPRESSIONS',
      optimization_goal:
        proposal.objective === 'OUTCOME_SALES' ? 'OFFSITE_CONVERSIONS' : 'LINK_CLICKS',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      status: 'PAUSED',
      targeting: JSON.stringify(targeting),
    });

    const adSetId = String(adSet.id ?? '');
    if (!adSetId) {
      throw new Error('Meta did not return an ad set ID.');
    }

    const updatedAds = [];
    for (const adProposal of proposal.ads) {
      const creative = await graphPost(`${adAccountId}/adcreatives`, ctx.accessToken, {
        name: `${adProposal.name} · Creative`,
        object_story_spec: JSON.stringify({
          page_id: pageId,
          link_data: {
            link: adProposal.finalUrl,
            message: adProposal.primaryText,
            name: adProposal.headline,
            description: adProposal.description ?? '',
            call_to_action: { type: adProposal.cta, value: { link: adProposal.finalUrl } },
          },
        }),
      });

      const creativeId = String(creative.id ?? '');

      const ad = await graphPost(`${adAccountId}/ads`, ctx.accessToken, {
        name: adProposal.name,
        adset_id: adSetId,
        creative: JSON.stringify({ creative_id: creativeId }),
        status: 'PAUSED',
      });

      updatedAds.push({
        ...adProposal,
        adId: String(ad.id ?? ''),
        creativeId,
      });
    }

    return {
      ...proposal,
      ads: updatedAds,
      campaignId,
      adSetId,
      adAccountId,
      status: 'created_paused',
    };
  }
}
