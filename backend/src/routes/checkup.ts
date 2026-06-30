import { Router } from 'express';
import { CheckupService } from '../services/checkupService.js';
import type { TenantRequest } from '../middleware/tenant.js';

export function createCheckupRouter(): Router {
  const router = Router();
  const checkup = new CheckupService();

  router.post('/run', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const record = await checkup.run(tenant.id);
      res.status(201).json({ checkup: record });
    } catch (err) {
      next(err);
    }
  });

  router.get('/latest', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const record = await checkup.getLatest(tenant.id);
      if (!record) {
        res.status(404).json({ error: 'No check-up report yet' });
        return;
      }
      res.json({ checkup: record });
    } catch (err) {
      next(err);
    }
  });

  router.get('/history', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const limit = Math.min(Number(req.query.limit) || 10, 25);
      const checkups = await checkup.list(tenant.id, limit);
      res.json({ checkups });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const record = await checkup.getById(tenant.id, req.params.id);
      if (!record) {
        res.status(404).json({ error: 'Check-up not found' });
        return;
      }
      res.json({ checkup: record });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
