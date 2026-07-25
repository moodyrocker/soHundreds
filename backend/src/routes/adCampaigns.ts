import { Router } from 'express';
import { z } from 'zod';
import type { TenantRequest } from '../middleware/tenant.js';
import { AdCampaignLibraryService } from '../services/adCampaignLibraryService.js';

const channelSchema = z.enum(['meta', 'instagram', 'both']);
const statusSchema = z.enum(['draft', 'ready', 'pushed', 'archived']);
const objectiveSchema = z.enum(['OUTCOME_TRAFFIC', 'OUTCOME_SALES']);
const currencySchema = z.enum(['GBP', 'USD', 'EUR']);
const ctaSchema = z.enum(['SHOP_NOW', 'LEARN_MORE', 'SIGN_UP', 'ORDER_NOW']);

const creativeSchema = z.object({
  name: z.string().min(1).max(120),
  primaryText: z.string().max(2000),
  headline: z.string().max(200),
  description: z.string().max(500).optional(),
  cta: ctaSchema,
  finalUrl: z.string().url().max(2000),
  imageUrl: z.string().url().max(2000).nullable().optional(),
  imageSource: z
    .enum(['library', 'canva', 'runway', 'shopify', 'unsplash', 'manual', 'none'])
    .nullable()
    .optional(),
  imageHash: z.string().max(200).nullable().optional(),
  metaAdId: z.string().max(80).nullable().optional(),
  metaCreativeId: z.string().max(80).nullable().optional(),
});

const targetingSchema = z.object({
  countries: z.array(z.string().length(2)).min(1).max(20).optional(),
  ageMin: z.number().int().min(18).max(65).optional(),
  ageMax: z.number().int().min(18).max(65).optional(),
  interestNotes: z.string().max(500).optional(),
});

const createBodySchema = z.object({
  slug: z.string().max(80).optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  channel: channelSchema.optional(),
  status: statusSchema.optional(),
  objective: objectiveSchema.optional(),
  dailyBudget: z.number().min(1).max(100000).optional(),
  currencyCode: currencySchema.optional(),
  durationDays: z.number().int().min(1).max(90).nullable().optional(),
  targeting: targetingSchema.optional(),
  ads: z.array(creativeSchema).max(10).optional(),
  reasoning: z.string().max(4000).nullable().optional(),
  recipeSlug: z.string().max(80).nullable().optional(),
  isActive: z.boolean().optional(),
});

const patchSchema = createBodySchema.partial().extend({
  name: z.string().min(1).max(200).optional(),
});

const generateSchema = z.object({
  prefer: z.enum(['library', 'canva', 'runway', 'auto']).optional(),
  force: z.boolean().optional(),
});

export function createAdCampaignsRouter(): Router {
  const router = Router();
  const library = new AdCampaignLibraryService();

  router.get('/', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const activeOnly = req.query.activeOnly !== 'false';
      const channel =
        typeof req.query.channel === 'string'
          ? channelSchema.parse(req.query.channel)
          : undefined;
      const campaigns = await library.list(tenant.id, { activeOnly, channel });
      res.json({ campaigns });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const campaign = await library.getById(tenant.id, req.params.id);
      if (!campaign) {
        res.status(404).json({ error: 'Campaign not found' });
        return;
      }
      res.json({ campaign });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const body = createBodySchema.parse(req.body);
      const campaign = await library.create(tenant.id, body);
      res.status(201).json({ campaign });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const body = patchSchema.parse(req.body);
      const campaign = await library.update(tenant.id, req.params.id, body);
      res.json({ campaign });
    } catch (err) {
      if (err instanceof Error && err.message === 'Campaign not found') {
        res.status(404).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      await library.delete(tenant.id, req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/generate-creatives', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const body = generateSchema.parse(req.body ?? {});
      const campaign = await library.generateCreatives(tenant.id, req.params.id, body);
      res.json({ campaign });
    } catch (err) {
      if (err instanceof Error && err.message === 'Campaign not found') {
        res.status(404).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  router.post('/:id/push-to-meta', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const campaign = await library.pushToMeta(tenant.id, req.params.id);
      res.json({ campaign });
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === 'Campaign not found') {
          res.status(404).json({ error: err.message });
          return;
        }
        if (/Connect Meta|Facebook Page|Instagram-only|ad account/i.test(err.message)) {
          res.status(400).json({ error: err.message });
          return;
        }
      }
      next(err);
    }
  });

  return router;
}
