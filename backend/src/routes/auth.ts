import { Router } from 'express';
import { z } from 'zod';
import { getSupabase } from '../lib/supabase.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import {
  createOrganizationForUser,
  ensureProfile,
  listUserOrganizations,
} from '../services/organizationService.js';

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1).optional(),
  organizationName: z.string().min(1).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export function createAuthRouter(): Router {
  const router = Router();

  router.post('/signup', async (req, res, next) => {
    try {
      const body = signupSchema.parse(req.body);
      const supabase = getSupabase();

      const { data, error } = await supabase.auth.signUp({
        email: body.email,
        password: body.password,
        options: {
          data: body.fullName ? { full_name: body.fullName } : undefined,
        },
      });

      if (error) {
        res.status(400).json({ error: error.message });
        return;
      }

      if (!data.session || !data.user) {
        res.status(201).json({
          message: 'Check your email to confirm your account before signing in.',
          user: data.user ? { id: data.user.id, email: data.user.email } : null,
        });
        return;
      }

      await ensureProfile(data.user.id, data.user.email, body.fullName);

      let organization = null;
      if (body.organizationName) {
        organization = await createOrganizationForUser(data.user.id, body.organizationName);
      }

      res.status(201).json({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_in: data.session.expires_in,
        user: { id: data.user.id, email: data.user.email },
        organization,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/login', async (req, res, next) => {
    try {
      const body = loginSchema.parse(req.body);
      const supabase = getSupabase();

      const { data, error } = await supabase.auth.signInWithPassword({
        email: body.email,
        password: body.password,
      });

      if (error || !data.session || !data.user) {
        res.status(401).json({ error: error?.message ?? 'Login failed' });
        return;
      }

      await ensureProfile(
        data.user.id,
        data.user.email,
        data.user.user_metadata?.full_name as string | undefined
      );

      const organizations = await listUserOrganizations(data.user.id);

      res.json({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_in: data.session.expires_in,
        user: { id: data.user.id, email: data.user.email },
        organizations,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/me', authMiddleware, async (req, res, next) => {
    try {
      const user = (req as AuthRequest).user;
      const organizations = await listUserOrganizations(user.id);

      res.json({
        user,
        organizations,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
