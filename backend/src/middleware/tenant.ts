import type { Request, Response, NextFunction } from 'express';
import { query } from '../database/connection.js';
import { addLogContext } from '../lib/logger.js';
import type { AuthRequest } from './auth.js';

export interface TenantRequest extends AuthRequest {
  tenant: {
    id: string;
    name: string;
    role: 'owner' | 'admin' | 'member';
  };
}

/**
 * Resolves organization from X-Organization-Id and verifies the authenticated
 * user is a member of that organization.
 */
export async function tenantMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authReq = req as AuthRequest;
  const orgId = req.header('X-Organization-Id');

  if (!orgId) {
    res.status(400).json({
      error: 'X-Organization-Id header is required',
      hint: 'List your orgs via GET /api/organizations',
    });
    return;
  }

  try {
    const result = await query<{ id: string; name: string; role: string }>(
      `SELECT o.id, o.name, om.role
       FROM organization_members om
       JOIN organizations o ON o.id = om.organization_id
       WHERE om.organization_id = $1 AND om.user_id = $2`,
      [orgId, authReq.user.id]
    );

    if (result.rowCount === 0) {
      res.status(403).json({ error: 'You do not have access to this organization' });
      return;
    }

    const row = result.rows[0];
    (req as TenantRequest).tenant = {
      id: row.id,
      name: row.name,
      role: row.role as TenantRequest['tenant']['role'],
    };

    // Every log line for the rest of this request is now attributable to an
    // organization and user, without passing them down through call signatures.
    addLogContext({ organizationId: row.id, userId: authReq.user.id });

    next();
  } catch (err) {
    next(err);
  }
}
