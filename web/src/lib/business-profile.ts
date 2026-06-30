import { apiFetch } from '@/lib/api';

export interface BusinessProfile {
  website: string | null;
  oneLiner: string | null;
  audience: string | null;
  offer: string | null;
  emulate: string | null;
  budget: string | null;
  updatedAt: string | null;
}

export type AutopilotMode = 'assist' | 'hands_off';

export interface BusinessProfileResponse {
  profile: BusinessProfile;
  complete: boolean;
  autopilotMode: AutopilotMode;
}

export type BusinessProfilePatch = {
  website?: string | null;
  oneLiner?: string | null;
  audience?: string | null;
  offer?: string | null;
  emulate?: string | null;
  budget?: string | null;
  autopilotMode?: AutopilotMode;
};

export function getBusinessProfile(token: string, organizationId: string) {
  return apiFetch<BusinessProfileResponse>('/api/business-profile', {
    token,
    organizationId,
  });
}

export function updateBusinessProfile(
  token: string,
  organizationId: string,
  body: BusinessProfilePatch
) {
  return apiFetch<BusinessProfileResponse>('/api/business-profile', {
    method: 'PATCH',
    token,
    organizationId,
    body: JSON.stringify(body),
  });
}
