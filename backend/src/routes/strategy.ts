import { Router } from 'express';
import { z } from 'zod';
import { ActionCompletionService } from '../services/actionCompletionService.js';
import { AuditLogService } from '../services/auditLogService.js';
import { StrategyService } from '../services/strategyService.js';
import type { TenantRequest } from '../middleware/tenant.js';

const createSchema = z.object({
  goal: z.string().min(1),
  context: z.string().optional(),
  budget: z.string().optional(),
});

const refineSchema = z.object({
  refinementNotes: z.string().min(1).max(2000),
});

const completionSchema = z.object({
  completed: z.boolean(),
});

export function createStrategyRouter(): Router {
  const router = Router();
  const strategyService = new StrategyService();
  const completionService = new ActionCompletionService();
  const auditLogService = new AuditLogService();

  router.post('/create', async (req, res, next) => {
    const tenant = (req as unknown as TenantRequest).tenant;

    try {
      const body = createSchema.parse(req.body);
      const request = {
        organizationId: tenant.id,
        goal: body.goal,
        context: body.context,
        budget: body.budget,
      };

      const existing = await strategyService.getGenerating(tenant.id);
      const pending = existing ?? (await strategyService.startCreate(tenant.id, request));

      if (!existing) {
        strategyService.runGeneration(tenant.id, pending.id, request);
      }

      const accepted = !existing;
      res.status(accepted ? 202 : 200).json({ strategy: pending, accepted });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'create failed';
      console.error(`[strategy] create failed org=${tenant.id}:`, message);

      if (/MCP server|communicating with MCP/i.test(message)) {
        res.status(502).json({
          error:
            'Analytics connector is temporarily unavailable. Try again — plans now use direct GA API data instead of remote MCP.',
        });
        return;
      }

      next(err);
    }
  });

  router.get('/generating', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const strategy = await strategyService.getGenerating(tenant.id);

      if (!strategy) {
        res.status(404).json({ error: 'No plan is currently generating' });
        return;
      }

      res.json({ strategy });
    } catch (err) {
      next(err);
    }
  });

  router.get('/active', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const strategy = await strategyService.getActive(tenant.id);

      if (!strategy) {
        res.status(404).json({ error: 'No active plan for this workspace' });
        return;
      }

      res.json({ strategy });
    } catch (err) {
      next(err);
    }
  });

  router.get('/list', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const limit = Math.min(Number(req.query.limit) || 10, 50);
      const strategies = await strategyService.list(tenant.id, limit);
      res.json({ strategies });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/goal-progress', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const strategy = await strategyService.getById(tenant.id, req.params.id);
      if (!strategy) {
        res.status(404).json({ error: 'Plan not found' });
        return;
      }
      const result = await strategyService.getGoalProgress(tenant.id, req.params.id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/advance-week', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const strategy = await strategyService.advanceToNextWeek(tenant.id, req.params.id);
      res.json({ strategy });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Advance failed';
      if (/not found|already met|Finish preparing/i.test(message)) {
        res.status(400).json({ error: message });
        return;
      }
      next(err);
    }
  });

  router.post('/:id/refine', async (req, res, next) => {
    const tenant = (req as unknown as TenantRequest).tenant;

    try {
      const body = refineSchema.parse(req.body);
      const parentId = req.params.id;

      const existing = await strategyService.getGenerating(tenant.id);
      const pending =
        existing ??
        (await strategyService.startRefine(tenant.id, parentId, body.refinementNotes));

      if (!existing) {
        strategyService.runGeneration(tenant.id, pending.id, {
          organizationId: tenant.id,
          goal: pending.goal,
          context: pending.context ?? undefined,
          budget: pending.budget ?? undefined,
          refinementNotes: body.refinementNotes,
        });
      }

      const accepted = !existing;
      res.status(accepted ? 202 : 200).json({ strategy: pending, accepted });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'refine failed';
      console.error(`[strategy] refine failed org=${tenant.id}:`, message);

      if (message === 'Plan not found') {
        res.status(404).json({ error: message });
        return;
      }
      if (message === 'Refine only works on a completed plan') {
        res.status(400).json({ error: message });
        return;
      }

      next(err);
    }
  });

  router.get('/:id/completions', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const strategy = await strategyService.getById(tenant.id, req.params.id);
      if (!strategy) {
        res.status(404).json({ error: 'Plan not found' });
        return;
      }

      const completedActionIds = await completionService.listCompletedActionIds(
        tenant.id,
        req.params.id
      );
      res.json({ completedActionIds });
    } catch (err) {
      next(err);
    }
  });

  router.put('/:id/completions/:actionId', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const strategy = await strategyService.getById(tenant.id, req.params.id);
      if (!strategy) {
        res.status(404).json({ error: 'Plan not found' });
        return;
      }

      const body = completionSchema.parse(req.body);
      const completedActionIds = await completionService.setCompleted(
        tenant.id,
        req.params.id,
        req.params.actionId,
        body.completed
      );
      res.json({ completedActionIds });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/audit', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const strategy = await strategyService.getById(tenant.id, req.params.id);
      if (!strategy) {
        res.status(404).json({ error: 'Plan not found' });
        return;
      }

      const audit = await auditLogService.getForStrategy(tenant.id, req.params.id);
      if (!audit) {
        res.status(404).json({ error: 'No audit entry for this plan' });
        return;
      }

      res.json({ audit });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const deleted = await strategyService.delete(tenant.id, req.params.id);
      if (!deleted) {
        res.status(404).json({ error: 'Plan not found' });
        return;
      }
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const strategy = await strategyService.getById(tenant.id, req.params.id);

      if (!strategy) {
        res.status(404).json({ error: 'Plan not found' });
        return;
      }

      res.json({ strategy });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
