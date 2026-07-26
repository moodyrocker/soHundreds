import { Router } from 'express';
import { z } from 'zod';
import type { TenantRequest } from '../middleware/tenant.js';
import { RunwayPromptTestService } from '../services/runwayPromptTestService.js';

const createSchema = z.object({
  title: z.string().max(200).nullable().optional(),
  promptText: z.string().min(1).max(4000),
  styleNotes: z.string().max(2000).nullable().optional(),
  negativePrompt: z.string().max(2000).nullable().optional(),
  useLibraryReference: z.boolean().optional(),
  libraryAssetId: z.string().uuid().nullable().optional(),
});

const approveSchema = z.object({
  title: z.string().max(200).nullable().optional(),
  theme: z.string().max(2000).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  useFor: z.enum(['any', 'feed', 'story', 'reel', 'product', 'lifestyle']).optional(),
  saveAsRecipe: z.boolean().optional(),
  recipeName: z.string().max(200).nullable().optional(),
});

const rejectSchema = z.object({
  notes: z.string().max(2000).nullable().optional(),
});

const reviewFilterSchema = z.enum(['pending', 'approved', 'rejected', 'all']);

export function createRunwayPromptTestsRouter(): Router {
  const router = Router();
  const tests = new RunwayPromptTestService();

  router.get('/', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const reviewStatus =
        typeof req.query.reviewStatus === 'string'
          ? reviewFilterSchema.parse(req.query.reviewStatus)
          : 'all';
      const items = await tests.list(tenant.id, { reviewStatus });
      res.json({ tests: items });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const item = await tests.getById(tenant.id, req.params.id);
      if (!item) {
        res.status(404).json({ error: 'Test not found' });
        return;
      }
      res.json({ test: item });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const body = createSchema.parse(req.body ?? {});
      const item = await tests.createAndGenerate(tenant.id, body);
      res.status(201).json({ test: item });
    } catch (err) {
      if (
        err instanceof Error &&
        /runway|prompt|preview|not configured|credits|moderation|visual library|product image/i.test(
          err.message
        )
      ) {
        res.status(400).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  router.post('/:id/approve', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const body = approveSchema.parse(req.body ?? {});
      const item = await tests.approve(tenant.id, req.params.id, body);
      res.json({ test: item });
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === 'Test not found') {
          res.status(404).json({ error: err.message });
          return;
        }
        if (/approved|successful|image url|unsplash|title/i.test(err.message)) {
          res.status(400).json({ error: err.message });
          return;
        }
      }
      next(err);
    }
  });

  router.post('/:id/reject', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const body = rejectSchema.parse(req.body ?? {});
      const item = await tests.reject(tenant.id, req.params.id, body.notes);
      res.json({ test: item });
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === 'Test not found') {
          res.status(404).json({ error: err.message });
          return;
        }
        if (/cannot be rejected/i.test(err.message)) {
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
      await tests.delete(tenant.id, req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
