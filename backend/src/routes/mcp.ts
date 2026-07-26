import { Router } from 'express';
import { z } from 'zod';
import { getIntegrationCapabilities } from '../lib/integrationCapabilities.js';
import {
  isConnectionReady,
  isGoogleAdsConfigured,
  isGoogleOAuthConfigured,
  isCanvaConnectConfigured,
  isInstagramBusinessLoginConfigured,
  isMetaOAuthConfigured,
  isShopifyConfigured,
  isUnsplashMcpConfigured,
  isRunwayMcpConfigured,
  MCPConnectionService,
} from '../services/mcpConnectionService.js';
import { SnapshotHealthService } from '../services/snapshotHealthService.js';
import { McpServerHealthService } from '../services/mcpServerHealthService.js';
import type { TenantRequest } from '../middleware/tenant.js';
import { logger } from '../lib/logger.js';

const log = logger('mcp');

const connectSchema = z.object({
  platform: z.enum([
    'google_analytics',
    'google_ads',
    'meta_ads',
    'shopify',
    'canva',
    'instagram',
    'mailchimp',
  ]),
  oauthCode: z.string().min(1).optional(),
  codeVerifier: z.string().min(1).optional(),
  shop: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
  defaultListId: z.string().min(1).optional(),
  tokens: z
    .object({
      access_token: z.string(),
      refresh_token: z.string().optional(),
      expires_in: z.number().optional(),
      token_type: z.string().optional(),
    })
    .optional(),
});

const propertySchema = z.object({
  propertyId: z.string().min(1),
});

const customerSchema = z.object({
  customerId: z.string().min(1),
});

const adAccountSchema = z.object({
  adAccountId: z.string().min(1),
});

const pageSchema = z.object({
  pageId: z.string().min(1),
});

const mailchimpListSchema = z.object({
  listId: z.string().min(1),
  listName: z.string().min(1).optional(),
});

export function createMCPRouter(): Router {
  const router = Router();
  const mcpService = new MCPConnectionService();
  const snapshotHealth = new SnapshotHealthService();
  const mcpServerHealth = new McpServerHealthService();

  router.get('/capabilities', (_req, res) => {
    res.json({
      integrations: getIntegrationCapabilities(),
      mcpArchitecture: 'MCP_ARCHITECTURE.md',
      analyticalCore: ['google_analytics', 'google_ads', 'meta_ads'],
    });
  });

  router.get('/snapshot-health', async (req, res, next) => {
    try {
      const tenant = (req as TenantRequest).tenant;
      const health = await snapshotHealth.getHealth(tenant.id);
      res.json(health);
    } catch (err) {
      next(err);
    }
  });

  router.get('/servers', async (req, res, next) => {
    try {
      const tenant = (req as TenantRequest).tenant;
      const status = await mcpServerHealth.getServerStatus(tenant.id);
      res.json(status);
    } catch (err) {
      next(err);
    }
  });

  router.get('/google-ads/probe', async (req, res, next) => {
    try {
      const tenant = (req as TenantRequest).tenant;
      const result = await snapshotHealth.probeGoogleAds(tenant.id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.get('/status', async (req, res, next) => {
    try {
      const tenant = (req as TenantRequest).tenant;
      const rows = await mcpService.getConnectionRows(tenant.id);

      res.json({
        connected: rows.map((row) => ({
          platform: row.platform,
          propertyId: row.property_id,
          customerId: row.config?.customerId ?? null,
          adAccountId: row.config?.adAccountId ?? null,
          pageId: row.config?.pageId ?? null,
          instagramUsername: row.config?.instagramUsername ?? null,
          canvaDisplayName: row.config?.canvaDisplayName ?? null,
          shopDomain: row.config?.shopDomain ?? null,
          mailchimpAccountName: row.config?.mailchimpAccountName ?? null,
          mailchimpListId: row.config?.mailchimpListId ?? null,
          mailchimpListName: row.config?.mailchimpListName ?? null,
          grantedScopes: row.config?.grantedScopes ?? null,
          ready: isConnectionReady(row.platform, row),
          lastSyncAt: row.last_sync_at?.toISOString() ?? null,
        })),
        hasAnalytics: rows.some((r) => r.platform === 'google_analytics'),
        hasGoogleAds: rows.some((r) => r.platform === 'google_ads'),
        hasMetaAds: rows.some((r) => r.platform === 'meta_ads'),
        hasShopify: rows.some((r) => r.platform === 'shopify'),
        hasUnsplash: isUnsplashMcpConfigured(),
        hasRunway: isRunwayMcpConfigured(),
        hasCanva: await mcpService.isCanvaReady(tenant.id),
        hasInstagram: await mcpService.isInstagramReady(tenant.id),
        hasMailchimp: await mcpService.isMailchimpReady(tenant.id),
        canvaConnectConfigured: isCanvaConnectConfigured(),
        instagramBusinessLoginConfigured: isInstagramBusinessLoginConfigured(),
        googleOAuthConfigured: isGoogleOAuthConfigured(),
        googleAdsConfigured: isGoogleAdsConfigured(),
        metaOAuthConfigured: isMetaOAuthConfigured(),
        shopifyConfigured: isShopifyConfigured(),
        unsplashConfigured: isUnsplashMcpConfigured(),
        runwayConfigured: isRunwayMcpConfigured(),
        mailchimpConfigured: true,
        googleOAuthRedirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI ?? null,
        metaOAuthRedirectUri:
          process.env.META_OAUTH_REDIRECT_URI?.trim() ||
          process.env.GOOGLE_OAUTH_REDIRECT_URI ||
          null,
        canvaOAuthRedirectUri: isCanvaConnectConfigured()
          ? (process.env.CANVA_OAUTH_REDIRECT_URI?.trim() ||
              process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() ||
              null)
          : null,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/oauth/google-analytics', (req, res, next) => {
    try {
      const tenant = (req as TenantRequest).tenant;
      const url = mcpService.getOAuthAuthorizeUrl(tenant.id, 'google_analytics');
      res.json({ url });
    } catch (err) {
      next(err);
    }
  });

  router.get('/google-analytics/properties', async (req, res, next) => {
    try {
      const tenant = (req as TenantRequest).tenant;
      const properties = await mcpService.listGoogleAnalyticsProperties(tenant.id);
      res.json({ properties });
    } catch (err) {
      next(err);
    }
  });

  router.get('/oauth/google-ads', (req, res, next) => {
    try {
      const tenant = (req as TenantRequest).tenant;
      const url = mcpService.getOAuthAuthorizeUrl(tenant.id, 'google_ads');
      res.json({ url });
    } catch (err) {
      next(err);
    }
  });

  router.get('/google-ads/customers', async (req, res, next) => {
    try {
      const tenant = (req as TenantRequest).tenant;
      const customers = await mcpService.listGoogleAdsCustomers(tenant.id);
      res.json({ customers });
    } catch (err) {
      next(err);
    }
  });

  router.get('/oauth/shopify', (req, res, next) => {
    try {
      const tenant = (req as TenantRequest).tenant;
      const shop = z.string().min(1).parse(req.query.shop);
      const url = mcpService.getShopifyOAuthAuthorizeUrl(tenant.id, shop);
      res.json({ url });
    } catch (err) {
      next(err);
    }
  });

  router.get('/oauth/canva', (req, res, next) => {
    try {
      const tenant = (req as TenantRequest).tenant;
      const { url } = mcpService.getCanvaOAuthAuthorizeUrl(tenant.id);
      res.json({ url });
    } catch (err) {
      next(err);
    }
  });

  router.get('/oauth/instagram', (req, res, next) => {
    try {
      const tenant = (req as TenantRequest).tenant;
      const reconnect = req.query.reconnect === '1' || req.query.reconnect === 'true';
      const url = mcpService.getInstagramOAuthAuthorizeUrl(tenant.id, { reconnect });
      res.json({ url });
    } catch (err) {
      next(err);
    }
  });

  router.get('/oauth/meta-ads', (req, res, next) => {
    try {
      const tenant = (req as TenantRequest).tenant;
      const reconnect = req.query.reconnect === '1' || req.query.reconnect === 'true';
      const includeInstagram =
        req.query.instagram === '1' || req.query.instagram === 'true';
      const url = mcpService.getMetaOAuthAuthorizeUrl(tenant.id, {
        reconnect,
        includeInstagram,
      });
      res.json({ url });
    } catch (err) {
      next(err);
    }
  });

  router.get('/meta-ads/accounts', async (req, res, next) => {
    try {
      const tenant = (req as TenantRequest).tenant;
      const accounts = await mcpService.listMetaAdAccounts(tenant.id);
      res.json({ accounts });
    } catch (err) {
      next(err);
    }
  });

  router.put('/meta-ads/account', async (req, res, next) => {
    try {
      const tenant = (req as TenantRequest).tenant;
      const body = adAccountSchema.parse(req.body);
      await mcpService.setMetaAdAccount(tenant.id, body.adAccountId);
      res.json({ success: true, adAccountId: body.adAccountId });
    } catch (err) {
      next(err);
    }
  });

  router.get('/meta-ads/pages', async (req, res, next) => {
    try {
      const tenant = (req as TenantRequest).tenant;
      const pages = await mcpService.listMetaPages(tenant.id);
      res.json({ pages });
    } catch (err) {
      next(err);
    }
  });

  router.put('/meta-ads/page', async (req, res, next) => {
    try {
      const tenant = (req as TenantRequest).tenant;
      const body = pageSchema.parse(req.body);
      await mcpService.setMetaPage(tenant.id, body.pageId);
      res.json({ success: true, pageId: body.pageId });
    } catch (err) {
      next(err);
    }
  });

  router.get('/mailchimp/audiences', async (req, res, next) => {
    try {
      const tenant = (req as TenantRequest).tenant;
      const ctx = await mcpService.getMailchimpContext(tenant.id);
      if (!ctx) {
        res.status(400).json({ error: 'Mailchimp is not connected' });
        return;
      }
      const { mailchimpListAudiences } = await import('../lib/mailchimpClient.js');
      const audiences = await mailchimpListAudiences(ctx);
      res.json({ audiences });
    } catch (err) {
      next(err);
    }
  });

  router.put('/mailchimp/audience', async (req, res, next) => {
    try {
      const tenant = (req as TenantRequest).tenant;
      const body = mailchimpListSchema.parse(req.body);
      await mcpService.setMailchimpDefaultList(tenant.id, body.listId, body.listName);
      res.json({ success: true, listId: body.listId });
    } catch (err) {
      next(err);
    }
  });

  router.put('/google-ads/customer', async (req, res, next) => {
    try {
      const tenant = (req as TenantRequest).tenant;
      const body = customerSchema.parse(req.body);
      await mcpService.setGoogleAdsCustomer(tenant.id, body.customerId);
      res.json({ success: true, customerId: body.customerId });
    } catch (err) {
      next(err);
    }
  });

  router.put('/google-analytics/property', async (req, res, next) => {
    try {
      const tenant = (req as TenantRequest).tenant;
      const body = propertySchema.parse(req.body);
      await mcpService.setGoogleAnalyticsProperty(tenant.id, body.propertyId);
      res.json({ success: true, propertyId: body.propertyId });
    } catch (err) {
      next(err);
    }
  });

  router.post('/connect', async (req, res, next) => {
    const tenant = (req as unknown as TenantRequest).tenant;
    let platform: string | undefined;

    try {
      const body = connectSchema.parse(req.body);
      platform = body.platform;

      if (body.platform === 'google_analytics') {
        if (body.oauthCode) {
          await mcpService.connectAnalytics(tenant.id, body.oauthCode);
        } else if (body.tokens) {
          await mcpService.connectPlatform(tenant.id, 'google_analytics', body.tokens);
        } else {
          res.status(400).json({
            error: 'Provide oauthCode (from OAuth flow) or tokens (for testing)',
          });
          return;
        }
      } else if (body.platform === 'google_ads') {
        if (body.oauthCode) {
          await mcpService.connectGoogleAds(tenant.id, body.oauthCode);
        } else if (body.tokens) {
          await mcpService.connectPlatform(tenant.id, 'google_ads', body.tokens);
        } else {
          res.status(400).json({
            error: 'Provide oauthCode (from OAuth flow) or tokens (for testing)',
          });
          return;
        }
      } else if (body.platform === 'meta_ads') {
        if (body.oauthCode) {
          await mcpService.connectMetaAds(tenant.id, body.oauthCode);
        } else if (body.tokens) {
          await mcpService.connectPlatform(tenant.id, 'meta_ads', body.tokens);
        } else {
          res.status(400).json({
            error: 'Provide oauthCode (from OAuth flow) or tokens (for testing)',
          });
          return;
        }
      } else if (body.platform === 'shopify') {
        if (!body.oauthCode || !body.shop) {
          res.status(400).json({
            error: 'Provide oauthCode and shop from the Shopify OAuth callback',
          });
          return;
        }
        await mcpService.connectShopify(tenant.id, body.oauthCode, body.shop);
      } else if (body.platform === 'canva') {
        if (!body.oauthCode || !body.codeVerifier) {
          res.status(400).json({
            error: 'Provide oauthCode and codeVerifier from the Canva OAuth callback',
          });
          return;
        }
        await mcpService.connectCanva(tenant.id, body.oauthCode, body.codeVerifier);
      } else if (body.platform === 'instagram') {
        if (!body.oauthCode) {
          res.status(400).json({ error: 'Provide oauthCode from Instagram Business Login' });
          return;
        }
        await mcpService.connectInstagramBusiness(tenant.id, body.oauthCode);
      } else if (body.platform === 'mailchimp') {
        if (!body.apiKey) {
          res.status(400).json({
            error:
              'Provide apiKey from Mailchimp → Account → Extras → API keys (must include datacenter suffix, e.g. xxxxx-us21)',
          });
          return;
        }
        const result = await mcpService.connectMailchimp(tenant.id, body.apiKey, {
          defaultListId: body.defaultListId ?? null,
        });
        log.info(`connect ok platform=mailchimp org=${tenant.id}`);
        res.json({
          success: true,
          platform: 'mailchimp',
          accountName: result.accountName,
          lists: result.lists,
        });
        return;
      } else if (body.tokens) {
        await mcpService.connectPlatform(tenant.id, body.platform, body.tokens);
      } else {
        res.status(400).json({ error: 'tokens required for this platform' });
        return;
      }

      log.info(`connect ok platform=${body.platform} org=${tenant.id}`);
      res.json({ success: true, platform: body.platform });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'connect failed';
      log.error(`connect failed platform=${platform ?? '?'} org=${tenant.id}:`, message);
      next(err);
    }
  });

  router.delete('/disconnect/:platform', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const platform = z
        .enum([
          'google_analytics',
          'google_ads',
          'meta_ads',
          'shopify',
          'canva',
          'instagram',
          'mailchimp',
        ])
        .parse(req.params.platform);

      const { query } = await import('../database/connection.js');
      await query(
        `UPDATE mcp_connections
         SET status = 'disconnected',
             property_id = NULL,
             config = '{}'::jsonb,
             credentials_encrypted = ''
         WHERE organization_id = $1 AND platform = $2`,
        [tenant.id, platform]
      );

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
