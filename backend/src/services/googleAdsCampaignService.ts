import type { GoogleAdsCampaignState } from '../types/execution.js';
import { MCPConnectionService } from './mcpConnectionService.js';
import { parseGoogleAdsError } from '../utils/parseGoogleAdsError.js';
import { logger } from '../lib/logger.js';

const log = logger('google-ads-campaign');

const API_VERSION = process.env.GOOGLE_ADS_API_VERSION ?? 'v21';

type MutateResponse = {
  mutateOperationResponses?: Array<{
    campaignBudgetResult?: { resourceName?: string };
    campaignResult?: { resourceName?: string };
    adGroupResult?: { resourceName?: string };
    adGroupCriterionResult?: { resourceName?: string };
    adGroupAdResult?: { resourceName?: string };
  }>;
};

export type GoogleAdsCampaignCreateResult = GoogleAdsCampaignState & {
  campaignId: string;
  campaignResourceName: string;
  customerId: string;
  status: 'created_paused';
};

/**
 * Creates a Search campaign in Google Ads as PAUSED — user must enable spending in Ads console.
 * Requires GOOGLE_ADS_DEVELOPER_TOKEN with write access and OAuth adwords scope.
 */
export class GoogleAdsCampaignService {
  private mcp = new MCPConnectionService();

  async createPausedCampaign(
    organizationId: string,
    proposal: GoogleAdsCampaignState
  ): Promise<GoogleAdsCampaignCreateResult> {
    const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
    if (!devToken) {
      throw new Error('Google Ads API is not configured on the server.');
    }

    const ctx = await this.mcp.getGoogleAdsContext(organizationId);
    if (!ctx) {
      throw new Error('Connect Google Ads in Integrations and select an account first.');
    }

    const customerId = ctx.customerId.replace(/\D/g, '');
    const budgetMicros = Math.round(proposal.dailyBudgetUsd * 1_000_000);
    if (budgetMicros < 1_000_000) {
      throw new Error('Daily budget must be at least $1.');
    }

    const mutateOperations: Record<string, unknown>[] = [];
    let tempId = -1;
    const nextTempId = () => tempId--;

    const budgetTempId = nextTempId();
    const budgetResource = `customers/${customerId}/campaignBudgets/${budgetTempId}`;

    mutateOperations.push({
      campaignBudgetOperation: {
        create: {
          resourceName: budgetResource,
          name: `${proposal.campaignName} · Hundres budget`,
          amountMicros: String(budgetMicros),
          deliveryMethod: 'STANDARD',
          explicitlyShared: false,
        },
      },
    });

    const campaignTempId = nextTempId();
    const campaignResource = `customers/${customerId}/campaigns/${campaignTempId}`;

    mutateOperations.push({
      campaignOperation: {
        create: {
          resourceName: campaignResource,
          name: proposal.campaignName,
          advertisingChannelType: 'SEARCH',
          status: 'PAUSED',
          campaignBudget: budgetResource,
          manualCpc: {},
          networkSettings: {
            targetGoogleSearch: true,
            targetSearchNetwork: true,
            targetContentNetwork: false,
            targetPartnerSearchNetwork: false,
          },
          containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
        },
      },
    });

    const updatedAdGroups = proposal.adGroups.map((group) => {
      const adGroupTempId = nextTempId();
      const adGroupResource = `customers/${customerId}/adGroups/${adGroupTempId}`;

      mutateOperations.push({
        adGroupOperation: {
          create: {
            resourceName: adGroupResource,
            name: group.name,
            campaign: campaignResource,
            status: 'PAUSED',
            type: 'SEARCH_STANDARD',
            cpcBidMicros: '1000000',
          },
        },
      });

      for (const keyword of group.keywords) {
        mutateOperations.push({
          adGroupCriterionOperation: {
            create: {
              adGroup: adGroupResource,
              status: 'PAUSED',
              keyword: {
                text: keyword.text,
                matchType: keyword.matchType,
              },
            },
          },
        });
      }

      mutateOperations.push({
        adGroupAdOperation: {
          create: {
            adGroup: adGroupResource,
            status: 'PAUSED',
            ad: {
              responsiveSearchAd: {
                headlines: group.headlines.map((text) => ({ text })),
                descriptions: group.descriptions.map((text) => ({ text })),
              },
              finalUrls: [group.finalUrl],
            },
          },
        },
      });

      return {
        ...group,
        adGroupResourceName: adGroupResource,
      };
    });

    const url = `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/googleAds:mutate`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        'developer-token': devToken,
        'login-customer-id': customerId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ mutateOperations }),
    });

    if (!response.ok) {
      const err = await response.text();
      const parsed = parseGoogleAdsError(err, response.status);
      log.warn('mutate failed:', response.status, err.slice(0, 600));
      throw new Error(
        parsed.userMessage ??
          parsed.message ??
          'Could not create campaign in Google Ads. Check your developer token has write access.'
      );
    }

    const data = (await response.json()) as MutateResponse;
    let createdCampaignResource: string | null = null;

    for (const item of data.mutateOperationResponses ?? []) {
      if (item.campaignResult?.resourceName) {
        createdCampaignResource = item.campaignResult.resourceName;
      }
    }

    const campaignId =
      createdCampaignResource?.match(/campaigns\/(\d+)/)?.[1] ??
      String(Math.abs(campaignTempId));

    return {
      ...proposal,
      adGroups: updatedAdGroups,
      campaignId,
      campaignResourceName: createdCampaignResource ?? campaignResource,
      customerId,
      status: 'created_paused',
    };
  }
}
