import { Router } from 'express';
import { z } from 'zod';
import { getAutopilotMode } from '../services/autopilotService.js';
import { AutopilotActivityService } from '../services/autopilotActivityService.js';
import { ExecutionService } from '../services/executionService.js';
import { StrategyService } from '../services/strategyService.js';
import type { TenantRequest } from '../middleware/tenant.js';

const previewSchema = z.object({
  strategyId: z.string().uuid(),
  actionId: z.string().min(1),
});

const approveSchema = z.object({
  seoTitle: z.string().max(200).optional(),
  seoDescription: z.string().max(500).optional(),
});

const batchSchema = z.object({
  strategyId: z.string().uuid(),
  week: z.number().int().min(1).max(12),
  confirm: z.boolean().optional(),
});

export function createExecutionRouter(): Router {
  const router = Router();
  const executionService = new ExecutionService();
  const strategyService = new StrategyService();

  router.get('/strategy/:strategyId/activity', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const activityService = new AutopilotActivityService();
      const activities = await activityService.listForStrategy(
        tenant.id,
        req.params.strategyId
      );
      res.json({ activities });
    } catch (err) {
      next(err);
    }
  });

  router.get('/strategy/:strategyId', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const executions = await executionService.listForStrategy(
        tenant.id,
        req.params.strategyId
      );
      res.json({ executions });
    } catch (err) {
      next(err);
    }
  });

  router.post('/batch', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const body = batchSchema.parse(req.body);
      const mode = await getAutopilotMode(tenant.id);
      const response = await executionService.runWeekAutopilot(
        tenant.id,
        body.strategyId,
        body.week,
        mode === 'hands_off',
        body.confirm ?? false
      );
      if (body.confirm && response.phase === 'executed') {
        void strategyService.afterAutopilotBatch(tenant.id, body.strategyId);
      }
      res.json(response);
    } catch (err) {
      next(err);
    }
  });

  router.post('/preview', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const body = previewSchema.parse(req.body);
      const result = await executionService.preview(
        tenant.id,
        body.strategyId,
        body.actionId
      );
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Preview failed';
      if (/only available for SEO|Connect Shopify|not found/i.test(message)) {
        res.status(400).json({ error: message });
        return;
      }
      next(err);
    }
  });

  router.post('/:id/approve', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const edits = approveSchema.parse(req.body ?? {});
      const execution = await executionService.approve(tenant.id, req.params.id, edits);
      res.json({ execution });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Approve failed';
      if (/Cannot approve|not found|Missing write_products|Missing write_content/i.test(message)) {
        res.status(400).json({ error: message });
        return;
      }
      next(err);
    }
  });

  router.post('/:id/skip', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const execution = await executionService.skip(tenant.id, req.params.id);
      res.json({ execution });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Skip failed';
      if (/Cannot skip|not found/i.test(message)) {
        res.status(400).json({ error: message });
        return;
      }
      next(err);
    }
  });

  router.post('/:id/rollback', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const execution = await executionService.rollback(tenant.id, req.params.id);
      res.json({ execution });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Rollback failed';
      if (/Only executed|not found|No before-state/i.test(message)) {
        res.status(400).json({ error: message });
        return;
      }
      next(err);
    }
  });

  return router;
}
