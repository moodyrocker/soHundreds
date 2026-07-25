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
export type AutopilotPace = 'normal' | 'high' | 'intense';

export type PaceProfile = {
  id: AutopilotPace;
  label: string;
  description: string;
  cycleMinutes: number;
  checkpointPauseHours: number;
  actionsPerWeekMin: number;
  actionsPerWeekMax: number;
  instagramFeedPerDay: number;
  instagramStoryPerDay: number;
  instagramReelPerWeek: number;
  productSeoPerDay: number;
  shopifyContentPerDay: number;
  mailchimpSequencesPerWeek: number;
  seoCooldownDays: number;
};

export interface BusinessProfileResponse {
  profile: BusinessProfile;
  complete: boolean;
  autopilotMode: AutopilotMode;
  autopilotPace?: AutopilotPace;
  paceProfile?: PaceProfile;
}

export type BusinessProfilePatch = {
  website?: string | null;
  oneLiner?: string | null;
  audience?: string | null;
  offer?: string | null;
  emulate?: string | null;
  budget?: string | null;
  autopilotMode?: AutopilotMode;
  autopilotPace?: AutopilotPace;
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

export type BusinessProfileDraft = {
  website: string | null;
  oneLiner: string;
  audience: string;
  offer: string;
  emulate: string;
  budget: string;
};

export function draftBusinessProfile(
  token: string,
  organizationId: string,
  body: {
    website?: string | null;
    notes?: string | null;
    current?: {
      oneLiner?: string | null;
      audience?: string | null;
      offer?: string | null;
      emulate?: string | null;
      budget?: string | null;
    };
  }
) {
  return apiFetch<{ draft: BusinessProfileDraft }>('/api/business-profile/draft', {
    method: 'POST',
    token,
    organizationId,
    body: JSON.stringify(body),
    timeoutMs: 90_000,
  });
}
