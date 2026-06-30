import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import {
  createOrganizationForUser,
  deleteOrganizationForUser,
  listUserOrganizations,
} from '../services/organizationService.js';

const createSchema = z.object({
  name: z.string().min(1),
});

export function createOrganizationsRouter(): Router {
  const router = Router();

  router.use(authMiddleware);

  router.get('/', async (req, res, next) => {
    try {
      const user = (req as AuthRequest).user;
      const organizations = await listUserOrganizations(user.id);
      res.json({ organizations });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const user = (req as AuthRequest).user;
      const body = createSchema.parse(req.body);
      const organization = await createOrganizationForUser(user.id, body.name);
      res.status(201).json(organization);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const user = (req as unknown as AuthRequest).user;
      await deleteOrganizationForUser(user.id, req.params.id);
      res.status(204).send();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Delete failed';
      if (message === 'Workspace not found') {
        res.status(404).json({ error: message });
        return;
      }
      if (message.includes('owner') || message.includes('another workspace')) {
        res.status(403).json({ error: message });
        return;
      }
      next(err);
    }
  });

  return router;
}
