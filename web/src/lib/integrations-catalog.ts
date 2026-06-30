export type IntegrationTier = 'required' | 'nice_to_have';
export type IntegrationStatus = 'available' | 'coming_soon' | 'planned';

export interface IntegrationDefinition {
  id: string;
  name: string;
  description: string;
  tier: IntegrationTier;
  status: IntegrationStatus;
  platform?: 'google_analytics' | 'google_ads' | 'meta_ads' | 'shopify' | 'unsplash' | 'instagram';
}

export const INTEGRATIONS: IntegrationDefinition[] = [
  {
    id: 'google_analytics',
    name: 'Google Analytics',
    description: 'Traffic, conversions, and channels — analytical core via MCP (GA4).',
    tier: 'required',
    status: 'available',
    platform: 'google_analytics',
  },
  {
    id: 'google_ads',
    name: 'Google Ads',
    description: 'Paid search spend and campaigns — analytical core via MCP.',
    tier: 'required',
    status: 'available',
    platform: 'google_ads',
  },
  {
    id: 'meta_ads',
    name: 'Meta Ads',
    description: 'Facebook and Instagram ad performance — analytical core via MCP.',
    tier: 'required',
    status: 'available',
    platform: 'meta_ads',
  },
  {
    id: 'shopify',
    name: 'Shopify',
    description: 'Store revenue and catalog via MCP; gated writes when scopes allow.',
    tier: 'required',
    status: 'available',
    platform: 'shopify',
  },
  {
    id: 'unsplash',
    name: 'Unsplash',
    description: 'Stock photos for blog posts and pages — search via MCP with attribution.',
    tier: 'nice_to_have',
    status: 'available',
    platform: 'unsplash',
  },
  {
    id: 'instagram',
    name: 'Instagram',
    description: 'Organic posts, stories, reels, comments, and likes via MCP (Meta OAuth).',
    tier: 'nice_to_have',
    status: 'available',
    platform: 'instagram',
  },
  {
    id: 'meta_ad_library',
    name: 'Meta Ad Library',
    description: 'Competitor ad creative and copy from the official Meta Ad Library API.',
    tier: 'nice_to_have',
    status: 'planned',
  },
  {
    id: 'google_ads_transparency',
    name: 'Google Ads Transparency Center',
    description: 'Competitor Search, Display, and YouTube ads from Google’s transparency feed.',
    tier: 'nice_to_have',
    status: 'planned',
  },
  {
    id: 'spyfu',
    name: 'SpyFu / keyword intel',
    description: 'Directional PPC and SEO estimates — competitor keywords, spend, and ad history.',
    tier: 'nice_to_have',
    status: 'planned',
  },
  {
    id: 'google_trends',
    name: 'Google Trends & search demand',
    description: 'Seasonality and demand signals to time campaigns and content.',
    tier: 'nice_to_have',
    status: 'planned',
  },
  {
    id: 'similarweb',
    name: 'SimilarWeb',
    description: 'Channel mix and traffic source estimates for competitive context.',
    tier: 'nice_to_have',
    status: 'planned',
  },
  {
    id: 'reviews',
    name: 'Review platforms',
    description: 'Voice-of-customer mining from G2, Trustpilot, Capterra, and app stores.',
    tier: 'nice_to_have',
    status: 'planned',
  },
];

export const REQUIRED_INTEGRATIONS = INTEGRATIONS.filter((i) => i.tier === 'required');
export const NICE_TO_HAVE_INTEGRATIONS = INTEGRATIONS.filter((i) => i.tier === 'nice_to_have');
