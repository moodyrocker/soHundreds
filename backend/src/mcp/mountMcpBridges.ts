import type { Express } from 'express';
import { mountOrgMcpBridge } from './mcpBridgeHttp.js';
import { createAnalyticsMcpServer } from './analyticsMcpServer.js';
import { createGoogleAdsMcpServer } from './googleAdsMcpServer.js';
import { createMetaAdsMcpServer } from './metaAdsMcpServer.js';
import { createShopifyMcpServerForOrg } from './shopifyMcpServerForOrg.js';
import { createUnsplashMcpServerForOrg } from './unsplashMcpServerForOrg.js';
import { createCanvaMcpServerForOrg } from './canvaMcpServerForOrg.js';
import { createRunwayMcpServerForOrg } from './runwayMcpServerForOrg.js';
import { createInstagramMcpServerForOrg } from './instagramMcpServerForOrg.js';
import { createMailchimpMcpServerForOrg } from './mailchimpMcpServerForOrg.js';

/**
 * Mount all Hundres-hosted MCP bridges on the API process.
 * Analytical core (GA, Ads, Meta) + commerce/actuation (Shopify, Instagram, Mailchimp).
 */
export function mountAllMcpBridges(app: Express): void {
  mountOrgMcpBridge(app, '/mcp/analytics', 'google_analytics', createAnalyticsMcpServer);
  mountOrgMcpBridge(app, '/mcp/google-ads', 'google_ads', createGoogleAdsMcpServer);
  mountOrgMcpBridge(app, '/mcp/meta-ads', 'meta_ads', createMetaAdsMcpServer);
  mountOrgMcpBridge(app, '/mcp/shopify', 'shopify', createShopifyMcpServerForOrg);
  mountOrgMcpBridge(app, '/mcp/unsplash', 'unsplash', createUnsplashMcpServerForOrg);
  mountOrgMcpBridge(app, '/mcp/canva', 'canva', createCanvaMcpServerForOrg);
  mountOrgMcpBridge(app, '/mcp/runway', 'runway', createRunwayMcpServerForOrg);
  mountOrgMcpBridge(app, '/mcp/instagram', 'instagram', createInstagramMcpServerForOrg);
  mountOrgMcpBridge(app, '/mcp/mailchimp', 'mailchimp', createMailchimpMcpServerForOrg);
}

