export interface StrategyRequest {
  organizationId: string;
  goal: string;
  context?: string;
  budget?: string;
  /** Phase 2B: user steer after seeing a draft plan */
  refinementNotes?: string;
}

export type MCPPlatform =
  | 'google_analytics'
  | 'google_ads'
  | 'meta_ads'
  | 'shopify'
  | 'unsplash'
  | 'canva'
  | 'runway'
  | 'instagram'
  | 'mailchimp';

export interface MCPConnectionConfig {
  customerId?: string;
  customerName?: string;
  adAccountId?: string;
  adAccountName?: string;
  shopDomain?: string;
  pageId?: string;
  instagramBusinessAccountId?: string;
  instagramUsername?: string;
  /** instagram_business = Instagram Login; facebook_page = legacy Page-linked token */
  instagramLoginMethod?: 'instagram_business' | 'facebook_page';
  grantedScopes?: string;
  canvaUserId?: string;
  canvaDisplayName?: string;
  /** Mailchimp default audience (list) id */
  mailchimpListId?: string;
  mailchimpListName?: string;
  mailchimpAccountName?: string;
  mailchimpDatacenter?: string;
}

export interface MetaAdAccountSummary {
  adAccountId: string;
  name: string;
  accountStatus?: number;
}

export interface MetaFacebookPageSummary {
  pageId: string;
  name: string;
  instagramUsername?: string;
  instagramBusinessAccountId?: string;
}

export interface MCPConnection {
  id: string;
  platform: MCPPlatform;
  name: string;
  url: string;
  accessToken: string;
  propertyId?: string;
  config?: MCPConnectionConfig;
}

export interface GoogleAdsCustomerSummary {
  customerId: string;
  resourceName: string;
  displayName: string;
}

export interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  expires_at?: number;
}

export interface GAPropertySummary {
  property: string;
  displayName: string;
  accountDisplayName: string;
}
