import { Router } from 'express';
import { z } from 'zod';
import type { TenantRequest } from '../middleware/tenant.js';
import { BrandVisualLibraryService } from '../services/brandVisualLibraryService.js';

const useForSchema = z.enum(['any', 'feed', 'story', 'reel', 'product', 'lifestyle']);

const assetBodySchema = z.object({
  title: z.string().min(1).max(200),
  imageUrl: z.string().url().max(2000),
  theme: z.string().max(2000).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  useFor: useForSchema.optional(),
  isActive: z.boolean().optional(),
});

const patchSchema = assetBodySchema.partial().extend({
  title: z.string().min(1).max(200).optional(),
  imageUrl: z.string().url().max(2000).optional(),
});

export function createBrandVisualsRouter(): Router {
  const router = Router();
  const library = new BrandVisualLibraryService();

  router.get('/', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const activeOnly = req.query.activeOnly !== 'false';
      const useFor =
        typeof req.query.useFor === 'string' ? useForSchema.parse(req.query.useFor) : undefined;
      const assets = await library.list(tenant.id, { activeOnly, useFor });
      res.json({ assets });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const asset = await library.getById(tenant.id, req.params.id);
      if (!asset) {
        res.status(404).json({ error: 'Asset not found' });
        return;
      }
      res.json({ asset });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const body = assetBodySchema.parse(req.body);
      if (!body.imageUrl.startsWith('https://')) {
        res.status(400).json({ error: 'Image URL must use HTTPS' });
        return;
      }
      const asset = await library.create(tenant.id, body);
      res.status(201).json({ asset });
    } catch (err) {
      if (err instanceof Error && /image url|unsplash|direct image/i.test(err.message)) {
        res.status(400).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  router.patch('/:id', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const body = patchSchema.parse(req.body);
      if (body.imageUrl && !body.imageUrl.startsWith('https://')) {
        res.status(400).json({ error: 'Image URL must use HTTPS' });
        return;
      }
      const asset = await library.update(tenant.id, req.params.id, body);
      res.json({ asset });
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === 'Asset not found') {
          res.status(404).json({ error: err.message });
          return;
        }
        if (/image url|unsplash|direct image|title is required/i.test(err.message)) {
          res.status(400).json({ error: err.message });
          return;
        }
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

  return router;
}
