import { query, pool } from '../database/connection.js';

export interface OrganizationSummary {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
  created_at: string;
}

export async function listUserOrganizations(userId: string): Promise<OrganizationSummary[]> {
  const result = await query<OrganizationSummary>(
    `SELECT o.id, o.name, om.role, o.created_at
     FROM organization_members om
     JOIN organizations o ON o.id = om.organization_id
     WHERE om.user_id = $1
     ORDER BY o.created_at ASC`,
    [userId]
  );
  return result.rows;
}

export async function createOrganizationForUser(
  userId: string,
  name: string
): Promise<OrganizationSummary> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orgResult = await client.query<{ id: string; name: string; created_at: string }>(
      `INSERT INTO organizations (name) VALUES ($1) RETURNING id, name, created_at`,
      [name]
    );
    const org = orgResult.rows[0];

    await client.query(
      `INSERT INTO organization_members (organization_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [org.id, userId]
    );

    await client.query('COMMIT');

    return {
      id: org.id,
      name: org.name,
      role: 'owner',
      created_at: org.created_at,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteOrganizationForUser(
  userId: string,
  organizationId: string
): Promise<void> {
  const membership = await query<{ role: string }>(
    `SELECT role FROM organization_members
     WHERE organization_id = $1 AND user_id = $2`,
    [organizationId, userId]
  );
  const role = membership.rows[0]?.role;
  if (!role) {
    throw new Error('Workspace not found');
  }
  if (role !== 'owner') {
    throw new Error('Only the workspace owner can delete it');
  }

  const count = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM organization_members WHERE user_id = $1`,
    [userId]
  );
  const orgCount = Number(count.rows[0]?.n ?? 0);
  if (orgCount <= 1) {
    throw new Error('Create another workspace before deleting your only one');
  }

  await query(`DELETE FROM organizations WHERE id = $1`, [organizationId]);
}

export async function ensureProfile(userId: string, email?: string, fullName?: string): Promise<void> {
  await query(
    `INSERT INTO profiles (id, email, full_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET
       email = COALESCE(EXCLUDED.email, profiles.email),
       full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
       updated_at = NOW()`,
    [userId, email ?? null, fullName ?? null]
  );
}
