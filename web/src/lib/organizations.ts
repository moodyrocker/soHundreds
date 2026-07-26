import { apiFetch } from '@/lib/api';
import type { Organization } from '@/lib/auth-types';

export function deleteOrganization(token: string, organizationId: string) {
  return apiFetch<void>(`/api/organizations/${organizationId}`, {
    method: 'DELETE',
    token,
  });
}

export function createOrganization(token: string, name: string) {
  return apiFetch<Organization>('/api/organizations', {
    method: 'POST',
    token,
    body: JSON.stringify({ name }),
  });
}
