import { query } from '../database/connection.js';
import type { MetaAdsCampaignState } from '../types/execution.js';
import type {
  AdCampaignCreative,
  AdCampaignInput,
  AdCampaignRecord,
  AdCampaignTargeting,
  AdCreativeImageSource,
} from '../types/adCampaign.js';
import { getBusinessProfile } from './businessProfileService.js';
import { BrandVisualLibraryService } from './brandVisualLibraryService.js';
import { pickCanvaImageForInstagram } from './canvaAssistImageService.js';
import { MetaAdsCampaignService } from './metaAdsCampaignService.js';
import { previewRecipePromptWithRunway } from './runwayAssistVideoService.js';
import { ContentRecipeKnowledgeService } from './contentRecipeKnowledgeService.js';
import { isRunwayConfigured } from '../lib/runwayClient.js';
import { evaluateMetaAdsCreateThrottle } from '../lib/paidAdThrottle.js';
import { logger } from '../lib/logger.js';

const log = logger('ad-campaigns');

type CampaignRow = {
  id: string;
  organization_id: string;
  slug: string;
  name: string;
  description: string | null;
  channel: AdCampaignRecord['channel'];
  status: AdCampaignRecord['status'];
  objective: AdCampaignRecord['objective'];
  daily_budget: string | number;
  currency_code: AdCampaignRecord['currencyCode'];
  duration_days: number | null;
  targeting: AdCampaignTargeting | Record<string, unknown>;
  ads: AdCampaignCreative[] | unknown;
  reasoning: string | null;
  recipe_slug: string | null;
  source_execution_id: string | null;
  meta_campaign_id: string | null;
  meta_ad_set_id: string | null;
  meta_ad_account_id: string | null;
  meta_pushed_at: Date | null;
  is_active: boolean;
  usage_count: number;
  last_used_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function defaultTargeting(partial?: Partial<AdCampaignTargeting>): AdCampaignTargeting {
  return {
    countries: partial?.countries?.length ? partial.countries : ['GB'],
    ageMin: partial?.ageMin ?? 25,
    ageMax: partial?.ageMax ?? 55,
    interestNotes: partial?.interestNotes,
  };
}

function asAds(raw: unknown): AdCampaignCreative[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === 'object')
    .map((a) => ({
      name: String(a.name ?? 'Ad').slice(0, 120),
      primaryText: String(a.primaryText ?? '').slice(0, 2000),
      headline: String(a.headline ?? '').slice(0, 200),
      description: a.description != null ? String(a.description).slice(0, 500) : undefined,
      cta: (['SHOP_NOW', 'LEARN_MORE', 'SIGN_UP', 'ORDER_NOW'].includes(String(a.cta))
        ? String(a.cta)
        : 'SHOP_NOW') as AdCampaignCreative['cta'],
      finalUrl: String(a.finalUrl ?? 'https://example.com').slice(0, 2000),
      imageBrief: a.imageBrief != null ? String(a.imageBrief).slice(0, 500) : null,
      imageUrl: a.imageUrl != null ? String(a.imageUrl) : null,
      imageSource: (a.imageSource as AdCreativeImageSource | null) ?? null,
      imageHash: a.imageHash != null ? String(a.imageHash) : null,
      metaAdId: a.metaAdId != null ? String(a.metaAdId) : a.adId != null ? String(a.adId) : null,
      metaCreativeId:
        a.metaCreativeId != null
          ? String(a.metaCreativeId)
          : a.creativeId != null
            ? String(a.creativeId)
            : null,
    }));
}

function mapRow(row: CampaignRow): AdCampaignRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    channel: row.channel,
    status: row.status,
    objective: row.objective,
    dailyBudget: Number(row.daily_budget),
    currencyCode: row.currency_code,
    durationDays: row.duration_days,
    targeting: defaultTargeting(row.targeting as Partial<AdCampaignTargeting>),
    ads: asAds(row.ads),
    reasoning: row.reasoning,
    recipeSlug: row.recipe_slug,
    sourceExecutionId: row.source_execution_id,
    metaCampaignId: row.meta_campaign_id,
    metaAdSetId: row.meta_ad_set_id,
    metaAdAccountId: row.meta_ad_account_id,
    metaPushedAt: row.meta_pushed_at?.toISOString() ?? null,
    isActive: row.is_active,
    usageCount: row.usage_count,
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toMetaState(campaign: AdCampaignRecord): MetaAdsCampaignState {
  return {
    kind: 'meta_ads_campaign',
    campaignName: campaign.name,
    dailyBudget: campaign.dailyBudget,
    currencyCode: campaign.currencyCode,
    objective: campaign.objective,
    durationDays: campaign.durationDays ?? undefined,
    targeting: campaign.targeting,
    ads: campaign.ads.map((ad) => ({
      name: ad.name,
      primaryText: ad.primaryText,
      headline: ad.headline,
      description: ad.description,
      cta: ad.cta,
      finalUrl: ad.finalUrl,
      imageUrl: ad.imageUrl ?? null,
      imageSource: ad.imageSource ?? null,
      imageHash: ad.imageHash ?? null,
      adId: ad.metaAdId ?? null,
      creativeId: ad.metaCreativeId ?? null,
    })),
    reasoning: campaign.reasoning ?? undefined,
    campaignId: campaign.metaCampaignId,
    adSetId: campaign.metaAdSetId,
    adAccountId: campaign.metaAdAccountId,
    status: campaign.metaCampaignId ? 'created_paused' : 'draft_proposal',
  };
}

/**
 * Org-scoped library of Meta / Instagram ad campaign blueprints.
 * Stored locally first; push to Meta is optional and always PAUSED.
 */
export class AdCampaignLibraryService {
  private visuals = new BrandVisualLibraryService();
  private recipes = new ContentRecipeKnowledgeService();
  private meta = new MetaAdsCampaignService();

  async list(
    organizationId: string,
    filters?: { activeOnly?: boolean; channel?: AdCampaignRecord['channel'] }
  ): Promise<AdCampaignRecord[]> {
    const clauses = ['organization_id = $1'];
    const params: unknown[] = [organizationId];
    let i = 2;

    if (filters?.activeOnly !== false) {
      clauses.push('is_active = TRUE');
      clauses.push(`status <> 'archived'`);
    }
    if (filters?.channel) {
      clauses.push(`(channel = $${i} OR channel = 'both')`);
      params.push(filters.channel);
      i += 1;
    }

    const result = await query<CampaignRow>(
      `SELECT * FROM ad_campaign_library
       WHERE ${clauses.join(' AND ')}
       ORDER BY updated_at DESC`,
      params
    );
    return result.rows.map(mapRow);
  }

  async getById(organizationId: string, id: string): Promise<AdCampaignRecord | null> {
    const result = await query<CampaignRow>(
      `SELECT * FROM ad_campaign_library WHERE id = $1 AND organization_id = $2`,
      [id, organizationId]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async create(organizationId: string, input: AdCampaignInput): Promise<AdCampaignRecord> {
    const name = input.name.trim();
    if (!name) throw new Error('Campaign name is required');
    const slug = slugify(input.slug || name) || `campaign-${Date.now()}`;
    const ads = input.ads?.length
      ? input.ads
      : [
          {
            name: `${name} · Ad 1`,
            primaryText: '',
            headline: name.slice(0, 40),
            cta: 'SHOP_NOW' as const,
            finalUrl: 'https://example.com',
            imageUrl: null,
            imageSource: 'none' as const,
          },
        ];

    const result = await query<CampaignRow>(
      `INSERT INTO ad_campaign_library (
         organization_id, slug, name, description, channel, status,
         objective, daily_budget, currency_code, duration_days,
         targeting, ads, reasoning, recipe_slug, source_execution_id, is_active
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16)
       RETURNING *`,
      [
        organizationId,
        slug,
        name.slice(0, 200),
        input.description?.trim() || null,
        input.channel ?? 'meta',
        input.status ?? 'draft',
        input.objective ?? 'OUTCOME_TRAFFIC',
        input.dailyBudget ?? 10,
        input.currencyCode ?? 'GBP',
        input.durationDays ?? null,
        JSON.stringify(defaultTargeting(input.targeting)),
        JSON.stringify(ads),
        input.reasoning?.trim() || null,
        input.recipeSlug?.trim() || null,
        input.sourceExecutionId ?? null,
        input.isActive ?? true,
      ]
    );
    return mapRow(result.rows[0]);
  }

  async update(
    organizationId: string,
    id: string,
    patch: Partial<AdCampaignInput>
  ): Promise<AdCampaignRecord> {
    const current = await this.getById(organizationId, id);
    if (!current) throw new Error('Campaign not found');

    const name = (patch.name ?? current.name).trim();
    if (!name) throw new Error('Campaign name is required');
    const slug = patch.slug ? slugify(patch.slug) : current.slug;

    const result = await query<CampaignRow>(
      `UPDATE ad_campaign_library SET
         slug = $3,
         name = $4,
         description = $5,
         channel = $6,
         status = $7,
         objective = $8,
         daily_budget = $9,
         currency_code = $10,
         duration_days = $11,
         targeting = $12::jsonb,
         ads = $13::jsonb,
         reasoning = $14,
         recipe_slug = $15,
         is_active = $16,
         updated_at = NOW()
       WHERE id = $1 AND organization_id = $2
       RETURNING *`,
      [
        id,
        organizationId,
        slug,
        name.slice(0, 200),
        patch.description !== undefined
          ? patch.description?.trim() || null
          : current.description,
        patch.channel ?? current.channel,
        patch.status ?? current.status,
        patch.objective ?? current.objective,
        patch.dailyBudget ?? current.dailyBudget,
        patch.currencyCode ?? current.currencyCode,
        patch.durationDays !== undefined ? patch.durationDays : current.durationDays,
        JSON.stringify(
          patch.targeting
            ? defaultTargeting({ ...current.targeting, ...patch.targeting })
            : current.targeting
        ),
        JSON.stringify(patch.ads ?? current.ads),
        patch.reasoning !== undefined
          ? patch.reasoning?.trim() || null
          : current.reasoning,
        patch.recipeSlug !== undefined
          ? patch.recipeSlug?.trim() || null
          : current.recipeSlug,
        patch.isActive ?? current.isActive,
      ]
    );
    return mapRow(result.rows[0]);
  }

  async delete(organizationId: string, id: string): Promise<void> {
    await query(`DELETE FROM ad_campaign_library WHERE id = $1 AND organization_id = $2`, [
      id,
      organizationId,
    ]);
  }

  /** Save or refresh a library row from an autopilot / Ask Meta draft. */
  async upsertFromMetaState(
    organizationId: string,
    state: MetaAdsCampaignState,
    opts?: { sourceExecutionId?: string | null; channel?: AdCampaignRecord['channel'] }
  ): Promise<AdCampaignRecord> {
    const slugBase = slugify(state.campaignName) || `meta-${Date.now()}`;
    let existing: AdCampaignRecord | null = null;

    if (opts?.sourceExecutionId) {
      const byExec = await query<CampaignRow>(
        `SELECT * FROM ad_campaign_library
         WHERE organization_id = $1 AND source_execution_id = $2
         LIMIT 1`,
        [organizationId, opts.sourceExecutionId]
      );
      existing = byExec.rows[0] ? mapRow(byExec.rows[0]) : null;
    }

    if (!existing && state.campaignId) {
      const byMeta = await query<CampaignRow>(
        `SELECT * FROM ad_campaign_library
         WHERE organization_id = $1 AND meta_campaign_id = $2
         LIMIT 1`,
        [organizationId, state.campaignId]
      );
      existing = byMeta.rows[0] ? mapRow(byMeta.rows[0]) : null;
    }

    const ads: AdCampaignCreative[] = state.ads.map((ad) => ({
      name: ad.name,
      primaryText: ad.primaryText,
      headline: ad.headline,
      description: ad.description,
      cta: ad.cta,
      finalUrl: ad.finalUrl,
      imageBrief: ad.imageBrief ?? null,
      imageUrl: ad.imageUrl ?? null,
      imageSource: (ad.imageSource as AdCreativeImageSource | null) ?? null,
      imageHash: ad.imageHash ?? null,
      metaAdId: ad.adId ?? null,
      metaCreativeId: ad.creativeId ?? null,
    }));

    if (existing) {
      const pushed = Boolean(state.campaignId);
      return this.update(organizationId, existing.id, {
        name: state.campaignName,
        channel: opts?.channel ?? existing.channel,
        status: pushed ? 'pushed' : ads.some((a) => a.imageUrl) ? 'ready' : 'draft',
        objective: state.objective,
        dailyBudget: state.dailyBudget,
        currencyCode: state.currencyCode,
        durationDays: state.durationDays ?? null,
        targeting: state.targeting,
        ads,
        reasoning: state.reasoning ?? null,
        sourceExecutionId: opts?.sourceExecutionId ?? existing.sourceExecutionId,
      }).then(async (updated) => {
        if (!pushed) return updated;
        const result = await query<CampaignRow>(
          `UPDATE ad_campaign_library SET
             meta_campaign_id = $3,
             meta_ad_set_id = $4,
             meta_ad_account_id = $5,
             meta_pushed_at = NOW(),
             status = 'pushed',
             usage_count = usage_count + 1,
             last_used_at = NOW(),
             updated_at = NOW()
           WHERE id = $1 AND organization_id = $2
           RETURNING *`,
          [
            updated.id,
            organizationId,
            state.campaignId ?? null,
            state.adSetId ?? null,
            state.adAccountId ?? null,
          ]
        );
        return mapRow(result.rows[0]);
      });
    }

    const created = await this.create(organizationId, {
      slug: slugBase,
      name: state.campaignName,
      description: state.reasoning?.slice(0, 500) || null,
      channel: opts?.channel ?? 'meta',
      status: state.campaignId ? 'pushed' : 'draft',
      objective: state.objective,
      dailyBudget: state.dailyBudget,
      currencyCode: state.currencyCode,
      durationDays: state.durationDays ?? null,
      targeting: state.targeting,
      ads,
      reasoning: state.reasoning ?? null,
      sourceExecutionId: opts?.sourceExecutionId ?? null,
    });

    if (!state.campaignId) return created;

    const result = await query<CampaignRow>(
      `UPDATE ad_campaign_library SET
         meta_campaign_id = $3,
         meta_ad_set_id = $4,
         meta_ad_account_id = $5,
         meta_pushed_at = NOW(),
         status = 'pushed',
         updated_at = NOW()
       WHERE id = $1 AND organization_id = $2
       RETURNING *`,
      [
        created.id,
        organizationId,
        state.campaignId,
        state.adSetId ?? null,
        state.adAccountId ?? null,
      ]
    );
    return mapRow(result.rows[0]);
  }

  /**
   * Agent path: save campaign + auto-generate creatives (library → Canva → Runway).
   * Returns Meta state with imageUrl / imageSource filled where possible.
   */
  async enrichWithCreatives(
    organizationId: string,
    state: MetaAdsCampaignState,
    opts?: {
      sourceExecutionId?: string | null;
      channel?: AdCampaignRecord['channel'];
      prefer?: 'library' | 'canva' | 'runway' | 'auto';
      force?: boolean;
    }
  ): Promise<MetaAdsCampaignState> {
    const saved = await this.upsertFromMetaState(organizationId, state, {
      sourceExecutionId: opts?.sourceExecutionId,
      channel: opts?.channel ?? 'meta',
    });
    const withCreatives = await this.generateCreatives(organizationId, saved.id, {
      prefer: opts?.prefer ?? 'auto',
      force: opts?.force,
    });
    return {
      ...state,
      ads: withCreatives.ads.map((ad) => ({
        name: ad.name,
        primaryText: ad.primaryText,
        headline: ad.headline,
        description: ad.description,
        cta: ad.cta,
        finalUrl: ad.finalUrl,
        imageBrief: ad.imageBrief ?? null,
        imageUrl: ad.imageUrl ?? null,
        imageSource: ad.imageSource ?? null,
        imageHash: ad.imageHash ?? null,
        adId: ad.metaAdId ?? null,
        creativeId: ad.metaCreativeId ?? null,
      })),
    };
  }

  /**
   * Fill missing creative images using Visual library → Canva → Runway
   * (same tool stack as Instagram / recipes).
   */
  async generateCreatives(
    organizationId: string,
    campaignId: string,
    opts?: { prefer?: 'library' | 'canva' | 'runway' | 'auto'; force?: boolean }
  ): Promise<AdCampaignRecord> {
    const campaign = await this.getById(organizationId, campaignId);
    if (!campaign) throw new Error('Campaign not found');

    const profile = await getBusinessProfile(organizationId);
    const prefer = opts?.prefer ?? 'auto';
    const baseKeywords = [
      profile.offer,
      profile.oneLiner,
      campaign.name,
      campaign.targeting.interestNotes,
    ]
      .filter(Boolean)
      .join(' ');

    const updatedAds: AdCampaignCreative[] = [];
    for (const ad of campaign.ads) {
      if (ad.imageUrl && !opts?.force) {
        updatedAds.push(ad);
        continue;
      }

      let imageUrl: string | null = null;
      let imageSource: AdCreativeImageSource = 'none';
      const adBrief = [ad.imageBrief, ad.headline, ad.primaryText, ad.description]
        .filter(Boolean)
        .join(' ')
        .slice(0, 400);
      const keywords = `${baseKeywords} ${adBrief}`.trim();

      const tryLibrary = prefer === 'auto' || prefer === 'library';
      const tryCanva = prefer === 'auto' || prefer === 'canva';
      const tryRunway = prefer === 'auto' || prefer === 'runway';

      if (tryLibrary) {
        const picks = await this.visuals.pickProductImages(organizationId, keywords, {
          count: 1,
        });
        if (picks[0]?.imageUrl) {
          imageUrl = picks[0].imageUrl;
          imageSource = 'library';
          await this.visuals.recordUsage(organizationId, picks[0].id);
        }
      }

      if (!imageUrl && tryCanva) {
        try {
          const canva = await pickCanvaImageForInstagram({
            organizationId,
            profile,
            action: {
              id: campaign.id,
              title: campaign.name,
              channel: 'paid',
              day: '1',
              time: '10:00',
              impact: 'med',
              difficulty: 'med',
              why: campaign.description || campaign.name,
              outcome: ad.headline || campaign.name,
              kpi: 'CTR',
            },
            brief: {
              fullRequest: `${campaign.name}. ${adBrief}`.slice(0, 400),
              imageSearchQuery: keywords.slice(0, 80),
              imageSource: 'canva',
            },
          });
          if (canva?.proposedImageUrl) {
            imageUrl = canva.proposedImageUrl;
            imageSource = 'canva';
          }
        } catch (err) {
          log.warn(
            'Canva creative skipped:', err);
        }
      }

      if (!imageUrl && tryRunway && isRunwayConfigured()) {
        try {
          let promptTemplate = [
            'Photorealistic vertical 9:16 marketing photograph for Meta / Instagram ads.',
            'Brand: {{brand}}.',
            'Feature product: {{product}}.',
            'Mood / setting: {{vibe}}.',
            'Natural lighting, shallow depth of field, premium aesthetic, no logos or text overlays.',
            '{{brief}}',
          ].join(' ');
          let styleNotes: string | null =
            'Natural light, premium aesthetic, no logos or text overlays';
          let negativePrompt: string | null = 'logos, text overlays, watermarks, UI chrome';

          if (campaign.recipeSlug) {
            const recipe = await this.recipes.resolveForGeneration(organizationId, {
              slug: campaign.recipeSlug,
              medium: 'image',
            });
            if (recipe) {
              promptTemplate = recipe.promptTemplate;
              styleNotes = recipe.styleNotes;
              negativePrompt = recipe.negativePrompt;
            }
          }

          const preview = await previewRecipePromptWithRunway({
            organizationId,
            promptTemplate,
            styleNotes,
            negativePrompt,
            recipeName: `${campaign.name} · ${ad.name}: ${adBrief}`.slice(0, 200),
            useLibraryReference: true,
          });
          imageUrl = preview.imageUrl;
          imageSource = 'runway';
        } catch (err) {
          log.warn(
            'Runway creative skipped:', err);
        }
      }

      updatedAds.push({
        ...ad,
        imageUrl,
        imageSource,
        imageHash: null,
      });
    }

    const hasImages = updatedAds.some((a) => Boolean(a.imageUrl));
    return this.update(organizationId, campaignId, {
      ads: updatedAds,
      status: hasImages
        ? campaign.status === 'pushed'
          ? 'pushed'
          : 'ready'
        : campaign.status,
    });
  }

  /** Create paused campaign in Meta from a library row (requires creatives with images when possible). */
  async pushToMeta(organizationId: string, campaignId: string): Promise<AdCampaignRecord> {
    const throttle = await evaluateMetaAdsCreateThrottle(organizationId);
    const current = await this.getById(organizationId, campaignId);
    if (!current) throw new Error('Campaign not found');

    // Allow pushing THIS library row if it was never pushed; block if other unpaid campaigns exist.
    if (!throttle.allowCreate && current.status !== 'pushed' && !current.metaCampaignId) {
      if (throttle.pushedLibraryCount > 0 || throttle.awaitingHumanCount > 0) {
        throw new Error(throttle.reason);
      }
      // Also block when recent executed Meta campaigns show $0 spend
      if (/no spend|\$0 spend|were created recently/i.test(throttle.reason)) {
        throw new Error(throttle.reason);
      }
    }

    const campaign = current;
    if (campaign.channel === 'instagram') {
      throw new Error(
        'This campaign is Instagram-only. Set channel to Meta or Both before pushing to Ads Manager.'
      );
    }

    let ready = campaign;
    if (!campaign.ads.some((a) => a.imageUrl)) {
      ready = await this.generateCreatives(organizationId, campaignId, { prefer: 'auto' });
    }

    const proposal = toMetaState(ready);
    const after = await this.meta.createPausedCampaign(organizationId, proposal);

    return this.upsertFromMetaState(organizationId, after, {
      sourceExecutionId: ready.sourceExecutionId,
      channel: ready.channel,
    });
  }
}
