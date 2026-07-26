import { Router } from 'express';
import { z } from 'zod';
import type { TenantRequest } from '../middleware/tenant.js';
import {
  getAutopilotMode,
  getAutopilotPace,
  setAutopilotMode,
  setAutopilotPace,
} from '../services/autopilotService.js';
import {
  getBusinessProfile,
  isBusinessProfileComplete,
  updateBusinessProfile,
} from '../services/businessProfileService.js';
import { ClaudeService } from '../services/claudeService.js';
import { getPaceProfile } from '../lib/autopilotPaceConfig.js';

const patchSchema = z.object({
  website: z.string().max(500).nullable().optional(),
  oneLiner: z.string().max(300).nullable().optional(),
  audience: z.string().max(2000).nullable().optional(),
  offer: z.string().max(2000).nullable().optional(),
  emulate: z.string().max(2000).nullable().optional(),
  budget: z.string().max(200).nullable().optional(),
  autopilotMode: z.enum(['assist', 'hands_off']).optional(),
  autopilotPace: z.enum(['normal', 'high', 'intense']).optional(),
});

const draftSchema = z.object({
  website: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  current: z
    .object({
      oneLiner: z.string().max(300).nullable().optional(),
      audience: z.string().max(2000).nullable().optional(),
      offer: z.string().max(2000).nullable().optional(),
      emulate: z.string().max(2000).nullable().optional(),
      budget: z.string().max(200).nullable().optional(),
    })
    .optional(),
});

export function createBusinessProfileRouter(): Router {
  const router = Router();
  const claude = new ClaudeService();

  router.get('/', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const profile = await getBusinessProfile(tenant.id);
      const autopilotMode = await getAutopilotMode(tenant.id);
      const autopilotPace = await getAutopilotPace(tenant.id);
      res.json({
        profile,
        complete: isBusinessProfileComplete(profile),
        autopilotMode,
        autopilotPace,
        paceProfile: getPaceProfile(autopilotPace),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/draft', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const body = draftSchema.parse(req.body ?? {});
      const saved = await getBusinessProfile(tenant.id);
      const website = body.website?.trim() || saved.website || null;
      const draft = await claude.draftBusinessProfile({
        website,
        notes: body.notes,
        current: {
          oneLiner: body.current?.oneLiner ?? saved.oneLiner,
          audience: body.current?.audience ?? saved.audience,
          offer: body.current?.offer ?? saved.offer,
          emulate: body.current?.emulate ?? saved.emulate,
          budget: body.current?.budget ?? saved.budget,
        },
      });
      res.json({
        draft: {
          website,
          ...draft,
        },
      });
    } catch (err) {
      if (err instanceof Error && /website|empty profile|draft/i.test(err.message)) {
        res.status(400).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  router.patch('/', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const body = patchSchema.parse(req.body);
      const { autopilotMode, autopilotPace, ...profilePatch } = body;
      const profile = await updateBusinessProfile(tenant.id, profilePatch);
      const mode =
        autopilotMode !== undefined
          ? await setAutopilotMode(tenant.id, autopilotMode)
          : await getAutopilotMode(tenant.id);
      const pace =
        autopilotPace !== undefined
          ? await setAutopilotPace(tenant.id, autopilotPace)
          : await getAutopilotPace(tenant.id);
      res.json({
        profile,
        complete: isBusinessProfileComplete(profile),
        autopilotMode: mode,
        autopilotPace: pace,
        paceProfile: getPaceProfile(pace),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
