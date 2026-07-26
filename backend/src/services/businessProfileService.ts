import { query } from '../database/connection.js';

export interface BusinessProfile {
  website: string | null;
  oneLiner: string | null;
  audience: string | null;
  offer: string | null;
  emulate: string | null;
  budget: string | null;
  updatedAt: string | null;
}

export interface BusinessProfileUpdate {
  website?: string | null;
  oneLiner?: string | null;
  audience?: string | null;
  offer?: string | null;
  emulate?: string | null;
  budget?: string | null;
}

type BusinessProfileRow = {
  business_website: string | null;
  business_one_liner: string | null;
  business_audience: string | null;
  business_offer: string | null;
  business_emulate: string | null;
  business_budget: string | null;
  business_profile_updated_at: Date | null;
};

function mapRow(row: BusinessProfileRow): BusinessProfile {
  return {
    website: row.business_website,
    oneLiner: row.business_one_liner,
    audience: row.business_audience,
    offer: row.business_offer,
    emulate: row.business_emulate,
    budget: row.business_budget,
    updatedAt: row.business_profile_updated_at?.toISOString() ?? null,
  };
}

function trimOrNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const t = value.trim();
  return t.length ? t : null;
}

export function isBusinessProfileComplete(profile: BusinessProfile): boolean {
  const hasWebsite = Boolean(profile.website?.trim());
  const hasStory = Boolean(
    profile.oneLiner?.trim() || profile.audience?.trim() || profile.offer?.trim()
  );
  return hasWebsite && hasStory;
}

/** Structured text injected into Claude prompts and stored on strategies.context */
export function formatBusinessProfileForPrompt(profile: BusinessProfile): string | null {
  const lines: string[] = [];

  if (profile.website?.trim()) lines.push(`Website: ${profile.website.trim()}`);
  if (profile.oneLiner?.trim()) lines.push(`One-liner: ${profile.oneLiner.trim()}`);
  if (profile.audience?.trim()) lines.push(`Audience: ${profile.audience.trim()}`);
  if (profile.offer?.trim()) lines.push(`Offer / products: ${profile.offer.trim()}`);
  if (profile.emulate?.trim()) lines.push(`Businesses to emulate: ${profile.emulate.trim()}`);
  if (profile.budget?.trim()) lines.push(`Marketing budget (user stated): ${profile.budget.trim()}`);

  if (!lines.length) return null;
  return lines.join('\n');
}

export async function getBusinessProfile(organizationId: string): Promise<BusinessProfile> {
  const result = await query<BusinessProfileRow>(
    `SELECT business_website, business_one_liner, business_audience,
            business_offer, business_emulate, business_budget, business_profile_updated_at
     FROM organizations WHERE id = $1`,
    [organizationId]
  );
  const row = result.rows[0];
  if (!row) {
    return {
      website: null,
      oneLiner: null,
      audience: null,
      offer: null,
      emulate: null,
      budget: null,
      updatedAt: null,
    };
  }
  return mapRow(row);
}

export async function updateBusinessProfile(
  organizationId: string,
  update: BusinessProfileUpdate
): Promise<BusinessProfile> {
  const fields: Array<keyof BusinessProfileUpdate> = [];
  const sets: string[] = [];
  const values: unknown[] = [organizationId];
  let idx = 2;

  const columnMap: Record<keyof BusinessProfileUpdate, string> = {
    website: 'business_website',
    oneLiner: 'business_one_liner',
    audience: 'business_audience',
    offer: 'business_offer',
    emulate: 'business_emulate',
    budget: 'business_budget',
  };

  for (const key of Object.keys(columnMap) as Array<keyof BusinessProfileUpdate>) {
    if (update[key] === undefined) continue;
    fields.push(key);
    sets.push(`${columnMap[key]} = $${idx++}`);
    values.push(trimOrNull(update[key]));
  }

  if (!fields.length) {
    return getBusinessProfile(organizationId);
  }

  sets.push('business_profile_updated_at = NOW()');

  const result = await query<BusinessProfileRow>(
    `UPDATE organizations SET ${sets.join(', ')}
     WHERE id = $1
     RETURNING business_website, business_one_liner, business_audience,
               business_offer, business_emulate, business_budget, business_profile_updated_at`,
    values
  );

  if (!result.rows[0]) {
    throw new Error('Organization not found');
  }
  return mapRow(result.rows[0]);
}

/** Merge saved workspace profile with optional per-run overrides from the client */
export function resolveStrategyContext(
  profile: BusinessProfile,
  requestContext?: string,
  requestBudget?: string
): { context: string | null; budget: string | null } {
  const profileText = formatBusinessProfileForPrompt(profile);
  const extra = trimOrNull(requestContext);

  let context: string | null = null;
  if (profileText && extra) {
    context = `${profileText}\n\nAdditional notes for this run:\n${extra}`;
  } else if (profileText) {
    context = profileText;
  } else if (extra) {
    context = extra;
  }

  const budget = trimOrNull(requestBudget) ?? trimOrNull(profile.budget ?? undefined);
  return { context, budget };
}
