import { Router } from 'express';
import { z } from 'zod';
import type { TenantRequest } from '../middleware/tenant.js';
import { getAutopilotMode, setAutopilotMode } from '../services/autopilotService.js';
import {
  getBusinessProfile,
  isBusinessProfileComplete,
  updateBusinessProfile,
} from '../services/businessProfileService.js';

const patchSchema = z.object({
  website: z.string().max(500).nullable().optional(),
  oneLiner: z.string().max(300).nullable().optional(),
  audience: z.string().max(2000).nullable().optional(),
  offer: z.string().max(2000).nullable().optional(),
  emulate: z.string().max(2000).nullable().optional(),
  budget: z.string().max(200).nullable().optional(),
  autopilotMode: z.enum(['assist', 'hands_off']).optional(),
});

export function createBusinessProfileRouter(): Router {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const profile = await getBusinessProfile(tenant.id);
      const autopilotMode = await getAutopilotMode(tenant.id);
      res.json({
        profile,
        complete: isBusinessProfileComplete(profile),
        autopilotMode,
      });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/', async (req, res, next) => {
    try {
      const tenant = (req as unknown as TenantRequest).tenant;
      const body = patchSchema.parse(req.body);
      const { autopilotMode, ...profilePatch } = body;
      const profile = await updateBusinessProfile(tenant.id, profilePatch);
      const mode =
        autopilotMode !== undefined
          ? await setAutopilotMode(tenant.id, autopilotMode)
          : await getAutopilotMode(tenant.id);
      res.json({
        profile,
        complete: isBusinessProfileComplete(profile),
        autopilotMode: mode,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
