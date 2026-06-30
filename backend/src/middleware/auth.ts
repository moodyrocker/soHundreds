import type { Request, Response, NextFunction } from 'express';
import { getSupabase } from '../lib/supabase.js';

export interface AuthUser {
  id: string;
  email?: string;
}

export interface AuthRequest extends Request {
  user: AuthUser;
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.header('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: 'Authorization: Bearer <token> is required' });
    return;
  }

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    (req as AuthRequest).user = {
      id: data.user.id,
      email: data.user.email,
    };
    next();
  } catch (err) {
    next(err);
  }
}
