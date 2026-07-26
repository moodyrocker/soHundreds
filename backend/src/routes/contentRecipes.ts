import { Router } from 'express';
import { z } from 'zod';
import type { TenantRequest } from '../middleware/tenant.js';
import { ClaudeService } from '../services/claudeService.js';
import { getBusinessProfile } from '../services/businessProfileService.js';
import { ContentRecipeKnowledgeService } from '../services/contentRecipeKnowledgeService.js';
import { previewRecipePromptWithRunway } from '../services/runwayAssistVideoService.js';

const mediumSchema = z.enum(['video', 'image']);
const providerSchema = z.enum(['runway', 'canva', 'generic']);

const recipeBodySchema = z.object({
  slug: z.string().min(1).max(80),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  medium: mediumSchema.optional(),
  provider: providerSchema.optional(),
  channel: z.string().max(80).nullable().optional(),
  promptTemplate: z.string().min(1).max(4000),
  styleNotes: z.string().max(2000).nullable().optional(),
  negativePrompt: z.string().max(2000).nullable().optional(),
  model: z.string().max(80).nullable().optional(),
  aspectRatio: z.string().max(40).nullable().optional(),
  durationSeconds: z
    .union([z.number().int().min(2).max(15), z.null()])
    .optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
});

const patchSchema = recipeBodySchema.partial().extend({
  slug: z.string().min(1).max(80).optional(),
  name: z.string().min(1).max(200).optional(),
  promptTemplate: z.string().min(1).max(4000).optional(),
});

const resolveSchema = z.object({
  medium: mediumSchema,
  provider: providerSchema.optional(),
  channel: z.string().max(80).nullable().optional(),
  slug: z.string().max(80).nullable().optional(),
  tags: z.array(z.string().max(40)).max(10).optional(),
});

const draftPromptSchema = z.object({
  engine: z.enum(['text_to_image', 'text_to_video']),
  recipeName: z.string().max(200).nullable().optional(),
  concept: z.string().max(2000).nullable().optional(),
  currentPrompt: z.string().max(4000).nullable().optional(),
});

const previewSchema = z.object({
  promptTemplate: z.string().min(1).max(4000),
  styleNotes: z.string().max(2000).nullable().optional(),
  negativePrompt: z.string().max(2000).nullable().optional(),
  recipeName: z.string().max(200).nullable().optional(),
  useLibraryReference: z.boolean().optional(),
});

export function createContentRecipesRouter(): Router {
  const router = Router();
  const recipes = new ContentRecipeKnowledgeService();
  const claude = new ClaudeService();

  router.get('/', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const medium = typeof req.query.medium === 'string' ? mediumSchema.parse(req.query.medium) : undefined;
      const provider =
        typeof req.query.provider === 'string' ? providerSchema.parse(req.query.provider) : undefined;
      const channel = typeof req.query.channel === 'string' ? req.query.channel : undefined;
      const activeOnly = req.query.activeOnly !== 'false';
      const items = await recipes.list(tenant.id, { medium, provider, channel, activeOnly });
      res.json({ recipes: items });
    } catch (err) {
      next(err);
    }
  });

  router.post('/draft-prompt', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const body = draftPromptSchema.parse(req.body ?? {});
      const profile = await getBusinessProfile(tenant.id);
      if (
        !profile.oneLiner?.trim() &&
        !profile.offer?.trim() &&
        !profile.audience?.trim() &&
        !profile.website?.trim()
      ) {
        res.status(400).json({
          error:
            'Fill your Business profile first (or use Write with AI there), then draft recipe prompts.',
        });
        return;
      }
      const draft = await claude.draftRunwayPrompt({
        engine: body.engine,
        profile,
        recipeName: body.recipeName,
        concept: body.concept,
        currentPrompt: body.currentPrompt,
      });
      res.json({ draft });
    } catch (err) {
      if (err instanceof Error && /prompt|profile|draft/i.test(err.message)) {
        res.status(400).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  router.post('/preview', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const body = previewSchema.parse(req.body ?? {});
      const preview = await previewRecipePromptWithRunway({
        organizationId: tenant.id,
        promptTemplate: body.promptTemplate,
        styleNotes: body.styleNotes,
        negativePrompt: body.negativePrompt,
        recipeName: body.recipeName,
        useLibraryReference: body.useLibraryReference,
      });
      res.json({ preview });
    } catch (err) {
      if (
        err instanceof Error &&
        /runway|prompt|preview|not configured|credits|moderation/i.test(err.message)
      ) {
        res.status(400).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  router.post('/resolve', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const body = resolveSchema.parse(req.body);
      const recipe = await recipes.resolveForGeneration(tenant.id, body);
      res.json({ recipe });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const recipe = await recipes.getById(tenant.id, req.params.id);
      if (!recipe) {
        res.status(404).json({ error: 'Recipe not found' });
        return;
      }
      res.json({ recipe });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const body = recipeBodySchema.parse(req.body);
      const recipe = await recipes.create(tenant.id, body);
      res.status(201).json({ recipe });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const body = patchSchema.parse(req.body);
      const recipe = await recipes.update(tenant.id, req.params.id, body);
      res.json({ recipe });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      await recipes.delete(tenant.id, req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
