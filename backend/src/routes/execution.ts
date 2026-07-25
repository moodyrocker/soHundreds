import { Router } from 'express';
import { z, ZodError } from 'zod';
import { getAutopilotMode } from '../services/autopilotService.js';
import { AutopilotActivityService } from '../services/autopilotActivityService.js';
import { ExecutionService } from '../services/executionService.js';
import { ExecutionOrchestratorService } from '../services/executionOrchestratorService.js';
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

const orchestrateSchema = z.object({
  strategyId: z.string().uuid(),
  week: z.number().int().min(1).max(12),
});

const agentTaskMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(8000),
});

const agentTaskSchema = z.object({
  strategyId: z.string().uuid(),
  message: z.string().min(1).max(4000),
  history: z.array(agentTaskMessageSchema).max(40).optional(),
});

function isZodError(err: unknown): err is ZodError {
  return (
    err instanceof ZodError ||
    (typeof err === 'object' &&
      err !== null &&
      'name' in err &&
      (err as { name?: string }).name === 'ZodError' &&
      'issues' in err)
  );
}

function formatZodIssues(err: ZodError): string {
  return err.issues
    .slice(0, 3)
    .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
    .join('; ');
}

const confirmHumanSchema = z.object({
  strategyId: z.string().uuid(),
  week: z.number().int().min(1).max(12),
  actionId: z.string().min(1),
});

export function createExecutionRouter(): Router {
  const router = Router();
  const executionService = new ExecutionService();
  const orchestrator = new ExecutionOrchestratorService();
  const strategyService = new StrategyService();

  router.get('/strategy/:strategyId/activity', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const activityService = new AutopilotActivityService();
      const recentLimit =
        typeof req.query.recentLimit === 'string' ? Number(req.query.recentLimit) : undefined;
      const outcomeLimit =
        typeof req.query.outcomeLimit === 'string' ? Number(req.query.outcomeLimit) : undefined;
      const activities = await activityService.listForStrategy(tenant.id, req.params.strategyId, {
        recentLimit: Number.isFinite(recentLimit) ? recentLimit : undefined,
        outcomeLimit: Number.isFinite(outcomeLimit) ? outcomeLimit : undefined,
      });
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

  router.get('/orchestrate/:strategyId/:week', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const week = Number(req.params.week);
      const snapshot = await orchestrator.getSnapshot(
        tenant.id,
        req.params.strategyId,
        week
      );
      res.json(snapshot);
    } catch (err) {
      next(err);
    }
  });

  router.post('/orchestrate/step', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const body = orchestrateSchema.parse(req.body);
      const snapshot = await orchestrator.runNextStep(
        tenant.id,
        body.strategyId,
        body.week
      );
      res.json(snapshot);
    } catch (err) {
      next(err);
    }
  });

  router.post('/orchestrate/confirm', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const body = confirmHumanSchema.parse(req.body);
      const snapshot = await orchestrator.confirmHumanAction(
        tenant.id,
        body.strategyId,
        body.week,
        body.actionId
      );
      res.json(snapshot);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Confirm failed';
      if (/not found|not awaiting/i.test(message)) {
        res.status(400).json({ error: message });
        return;
      }
      next(err);
    }
  });

  router.post('/orchestrate/advance-checkpoint', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const body = orchestrateSchema.parse(req.body);
      const result = await orchestrator.advanceFromCheckpoint(
        tenant.id,
        body.strategyId,
        body.week
      );
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Advance failed';
      if (/not at checkpoint|Goal already met|Finish preparing/i.test(message)) {
        res.status(400).json({ error: message });
        return;
      }
      next(err);
    }
  });

  router.post('/agent-task', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const body = agentTaskSchema.parse(req.body);
      const history = (body.history ?? [])
        .map((h) => ({
          role: h.role,
          content: String(h.content ?? '').trim(),
        }))
        .filter((h) => h.content.length > 0);

      const result = await executionService.runAgentTask(
        tenant.id,
        body.strategyId,
        body.message.trim(),
        history.length ? history : undefined
      );
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Agent task failed';
      if (isZodError(err)) {
        const detail = formatZodIssues(err);
        console.warn('[agent-task] validation failed:', detail, err.issues);
        res.status(400).json({
          error: `I couldn't read that chat turn (${detail}). Try again with a short line like: Instagram story — Cream of Dreams — clean lifestyle — Runway video.`,
          details: err.issues,
        });
        return;
      }
      if (/Connect Shopify|not found|Plan not found|RUNWAY_API_KEY|Runway is not configured/i.test(message)) {
        res.status(400).json({ error: message });
        return;
      }
      if (/Runway|moderation|timed out|task [a-z0-9-]+/i.test(message)) {
        console.error('[agent-task] runway failed:', message);
        res.status(422).json({ error: message });
        return;
      }
      console.error('[agent-task] failed:', message);
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
