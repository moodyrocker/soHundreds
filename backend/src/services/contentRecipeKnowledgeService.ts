import { query } from '../database/connection.js';
import { RUNWAY_OFFICIAL_RECIPES } from '../lib/runwayOfficialRecipes.js';
import type {
  ContentRecipeInput,
  ContentRecipeMedium,
  ContentRecipePromptVars,
  ContentRecipeProvider,
  ContentRecipeRecord,
  ContentRecipeResolveQuery,
} from '../types/contentRecipe.js';

type RecipeRow = {
  id: string;
  organization_id: string;
  slug: string;
  name: string;
  description: string | null;
  medium: ContentRecipeMedium;
  provider: ContentRecipeProvider;
  channel: string | null;
  prompt_template: string;
  style_notes: string | null;
  negative_prompt: string | null;
  model: string | null;
  aspect_ratio: string | null;
  duration_seconds: number | null;
  tags: string[] | null;
  is_default: boolean;
  is_active: boolean;
  config: Record<string, unknown> | null;
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

function mapRow(row: RecipeRow): ContentRecipeRecord {
  const duration =
    row.duration_seconds != null &&
    Number.isFinite(row.duration_seconds) &&
    row.duration_seconds >= 2 &&
    row.duration_seconds <= 15
      ? Math.floor(row.duration_seconds)
      : null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    medium: row.medium,
    provider: row.provider,
    channel: row.channel,
    promptTemplate: row.prompt_template,
    styleNotes: row.style_notes,
    negativePrompt: row.negative_prompt,
    model: row.model,
    aspectRatio: row.aspect_ratio,
    durationSeconds: duration,
    tags: row.tags ?? [],
    isDefault: row.is_default,
    isActive: row.is_active,
    config: row.config ?? {},
    usageCount: row.usage_count,
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const LEGACY_DEFAULT_SLUG = 'instagram-reel-lifestyle';

/**
 * Knowledge base of reusable content-generation recipes (Runway video/image, later Canva).
 * Org-scoped; used at generation time instead of one-off hardcoded prompts.
 */
export class ContentRecipeKnowledgeService {
  /** Seed official Runway catalog recipes. Refreshes prompt copy for official rows only (never overwrites user_custom). */
  async ensureDefaults(organizationId: string): Promise<void> {
    for (const recipe of RUNWAY_OFFICIAL_RECIPES) {
      const existing = await this.getBySlug(organizationId, recipe.slug);
      if (existing) {
        const source = existing.config?.catalogSource;
        if (source === 'runway_official' || source == null) {
          const needsRefresh =
            existing.promptTemplate !== recipe.promptTemplate ||
            existing.styleNotes !== (recipe.styleNotes ?? null) ||
            existing.negativePrompt !== (recipe.negativePrompt ?? null) ||
            existing.description !== (recipe.description ?? null);
          if (needsRefresh) {
            await this.update(organizationId, existing.id, {
              promptTemplate: recipe.promptTemplate,
              styleNotes: recipe.styleNotes ?? null,
              negativePrompt: recipe.negativePrompt ?? null,
              description: recipe.description ?? null,
              config: {
                ...existing.config,
                ...(recipe.config ?? {}),
                catalogSource: 'runway_official',
              },
            });
          }
        }
        continue;
      }
      try {
        await this.create(organizationId, {
          ...recipe,
          // Only one default per medium/provider — text-to-video owns default video.
          isDefault: recipe.isDefault === true,
        });
      } catch (err) {
        // Concurrent seed / unique race — safe to ignore
        if (!(err instanceof Error) || !/unique|duplicate/i.test(err.message)) {
          console.warn('[content-recipes] seed failed:', recipe.slug, err);
        }
      }
    }

    // Prefer official text-to-video as default over any leftover legacy seed
    const officialDefault = await this.getBySlug(organizationId, 'runway-text-to-video');
    const legacy = await this.getBySlug(organizationId, LEGACY_DEFAULT_SLUG);
    if (officialDefault && legacy?.isDefault) {
      await this.update(organizationId, legacy.id, { isDefault: false, isActive: true });
    }

    await this.upgradeUserImageRecipesForProductTag(organizationId);
  }

  /**
   * One-time-ish upgrade: custom / agent image recipes that still say {{product}}
   * without @product get the Runway reference tag so library photos actually stick.
   */
  private async upgradeUserImageRecipesForProductTag(organizationId: string): Promise<void> {
    const result = await query<RecipeRow>(
      `SELECT * FROM content_recipes WHERE organization_id = $1 ORDER BY updated_at DESC`,
      [organizationId]
    );
    const items = result.rows.map(mapRow);

    for (const recipe of items) {
      if (recipe.config?.catalogSource === 'runway_official') continue;
      const path = typeof recipe.config?.runwayPath === 'string' ? recipe.config.runwayPath : '';
      const isImageEngine =
        recipe.medium === 'image' ||
        path === '/text_to_image' ||
        path === '/recipes/product_campaign_image';
      if (!isImageEngine) continue;
      if (/@product\b/i.test(recipe.promptTemplate)) continue;

      let next = recipe.promptTemplate;
      if (/\{\{\s*product\s*\}\}/i.test(next)) {
        next = next.replace(/\{\{\s*product\s*\}\}/gi, '@product ({{product}})');
      } else {
        next = `Hero product is @product. ${next}`.trim();
      }
      if (next === recipe.promptTemplate) continue;

      const negative = recipe.negativePrompt?.trim() ?? '';
      const nextNegative =
        /wrong product|generic stock/i.test(negative)
          ? recipe.negativePrompt
          : [negative, 'wrong product', 'generic stock jar'].filter(Boolean).join(', ');

      try {
        await this.update(organizationId, recipe.id, {
          promptTemplate: next.slice(0, 4000),
          negativePrompt: nextNegative,
        });
      } catch (err) {
        console.warn('[content-recipes] @product upgrade failed:', recipe.slug, err);
      }
    }
  }

  async list(
    organizationId: string,
    filters?: {
      medium?: ContentRecipeMedium;
      provider?: ContentRecipeProvider;
      channel?: string;
      activeOnly?: boolean;
    }
  ): Promise<ContentRecipeRecord[]> {
    await this.ensureDefaults(organizationId);

    const clauses = ['organization_id = $1'];
    const params: unknown[] = [organizationId];
    let i = 2;

    if (filters?.medium) {
      clauses.push(`medium = $${i++}`);
      params.push(filters.medium);
    }
    if (filters?.provider) {
      clauses.push(`provider = $${i++}`);
      params.push(filters.provider);
    }
    if (filters?.channel) {
      clauses.push(`channel = $${i++}`);
      params.push(filters.channel);
    }
    if (filters?.activeOnly !== false) {
      clauses.push('is_active = TRUE');
    }

    const result = await query<RecipeRow>(
      `SELECT * FROM content_recipes
       WHERE ${clauses.join(' AND ')}
       ORDER BY is_default DESC, usage_count DESC, name ASC`,
      params
    );
    return result.rows.map(mapRow);
  }

  async getById(
    organizationId: string,
    recipeId: string
  ): Promise<ContentRecipeRecord | null> {
    const result = await query<RecipeRow>(
      `SELECT * FROM content_recipes WHERE id = $1 AND organization_id = $2`,
      [recipeId, organizationId]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async getBySlug(
    organizationId: string,
    slug: string
  ): Promise<ContentRecipeRecord | null> {
    const result = await query<RecipeRow>(
      `SELECT * FROM content_recipes
       WHERE organization_id = $1 AND slug = $2 AND is_active = TRUE`,
      [organizationId, slugify(slug)]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  /**
   * Rotate among the 10 Instagram still style-example recipes (least-used first)
   * so feed posts don't all use the same generic text-to-image prompt.
   */
  async pickLeastUsedInstagramStillStyle(
    organizationId: string
  ): Promise<ContentRecipeRecord | null> {
    await this.ensureDefaults(organizationId);
    const result = await query<RecipeRow>(
      `SELECT * FROM content_recipes
       WHERE organization_id = $1
         AND is_active = TRUE
         AND medium = 'image'
         AND provider = 'runway'
         AND (
           slug LIKE 'runway-ig-still-%'
           OR COALESCE(tags, '{}') @> ARRAY['style_example']::text[]
         )
       ORDER BY usage_count ASC, last_used_at ASC NULLS FIRST, name ASC
       LIMIT 1`,
      [organizationId]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  /**
   * Resolve a saved recipe from chat text — matches "use recipe X", slug, or full name.
   * Prefers custom recipes when both match; ignores inactive.
   */
  async matchFromBrief(
    organizationId: string,
    text: string | null | undefined
  ): Promise<ContentRecipeRecord | null> {
    const blob = (text ?? '').trim();
    if (!blob) return null;

    await this.ensureDefaults(organizationId);
    const recipes = await this.list(organizationId, { activeOnly: true });
    if (!recipes.length) return null;

    const lower = blob.toLowerCase();

    const explicit =
      lower.match(/\b(?:use|with|via|from)\s+(?:my\s+)?recipe\s+["']?([a-z0-9][a-z0-9-]{1,79})/i) ??
      lower.match(/\brecipe\s*[:#]?\s*["']?([a-z0-9][a-z0-9-]{1,79})/i);
    if (explicit?.[1]) {
      const bySlug = recipes.find((r) => r.slug === slugify(explicit[1]));
      if (bySlug) return bySlug;
    }

    // Prefer longer names first so "skincare marble feed" beats "skincare"
    const byName = [...recipes]
      .filter((r) => r.config?.catalogSource !== 'runway_official')
      .sort((a, b) => b.name.length - a.name.length)
      .find((r) => {
        const name = r.name.trim().toLowerCase();
        return name.length >= 3 && lower.includes(name);
      });
    if (byName) return byName;

    const bySlug = [...recipes]
      .sort((a, b) => b.slug.length - a.slug.length)
      .find((r) => r.slug.length >= 4 && lower.includes(r.slug));
    return bySlug ?? null;
  }

  /**
   * Pick the best recipe for a generation job:
   * 1) explicit slug, 2) channel + tags match, 3) org default for medium/provider, 4) most used.
   */
  async resolveForGeneration(
    organizationId: string,
    queryOpts: ContentRecipeResolveQuery
  ): Promise<ContentRecipeRecord | null> {
    await this.ensureDefaults(organizationId);

    if (queryOpts.slug?.trim()) {
      const bySlug = await this.getBySlug(organizationId, queryOpts.slug);
      if (bySlug) return bySlug;
    }

    const provider = queryOpts.provider ?? 'runway';
    const result = await query<RecipeRow>(
      `SELECT * FROM content_recipes
       WHERE organization_id = $1
         AND is_active = TRUE
         AND medium = $2
         AND provider = $3
       ORDER BY
         CASE WHEN $4::text IS NOT NULL AND channel = $4 THEN 0 ELSE 1 END,
         CASE WHEN is_default THEN 0 ELSE 1 END,
         usage_count DESC,
         updated_at DESC
       LIMIT 20`,
      [organizationId, queryOpts.medium, provider, queryOpts.channel ?? null]
    );

    const rows = result.rows.map(mapRow);
    if (!rows.length) return null;

    const tags = (queryOpts.tags ?? []).map((t) => t.toLowerCase());
    if (tags.length) {
      const tagged = rows.find((r) =>
        tags.some((t) => r.tags.map((x) => x.toLowerCase()).includes(t) || r.slug.includes(t))
      );
      if (tagged) return tagged;
    }

    return rows[0] ?? null;
  }

  /** Substitute {{placeholders}} and append style/negative notes. */
  renderPrompt(recipe: ContentRecipeRecord, vars: ContentRecipePromptVars): string {
    const normalized: Record<string, string> = {};
    for (const [k, v] of Object.entries(vars)) {
      normalized[k] = (v ?? '').trim();
    }

    let text = recipe.promptTemplate.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
      const value = normalized[key] ?? '';
      if (key === 'brief' && value) return `Creative brief: ${value.slice(0, 400)}`;
      return value;
    });

    text = text.replace(/\s{2,}/g, ' ').trim();

    const extras: string[] = [];
    if (recipe.styleNotes?.trim()) extras.push(recipe.styleNotes.trim());
    if (recipe.negativePrompt?.trim()) {
      extras.push(`Avoid: ${recipe.negativePrompt.trim()}`);
    }

    return [text, ...extras].filter(Boolean).join(' ').slice(0, 1800);
  }

  async create(
    organizationId: string,
    input: ContentRecipeInput
  ): Promise<ContentRecipeRecord> {
    const slug = slugify(input.slug || input.name);
    if (!slug) throw new Error('Recipe slug is required');
    if (!input.promptTemplate?.trim()) throw new Error('promptTemplate is required');

    if (input.isDefault) {
      await this.clearDefault(
        organizationId,
        input.medium ?? 'video',
        input.provider ?? 'runway'
      );
    }

    const result = await query<RecipeRow>(
      `INSERT INTO content_recipes (
         organization_id, slug, name, description, medium, provider, channel,
         prompt_template, style_notes, negative_prompt, model, aspect_ratio,
         duration_seconds, tags, is_default, is_active, config
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11, $12,
         $13, $14, $15, $16, $17::jsonb
       )
       RETURNING *`,
      [
        organizationId,
        slug,
        input.name.trim(),
        input.description?.trim() || null,
        input.medium ?? 'video',
        input.provider ?? 'runway',
        input.channel?.trim() || null,
        input.promptTemplate.trim(),
        input.styleNotes?.trim() || null,
        input.negativePrompt?.trim() || null,
        input.model?.trim() || null,
        input.aspectRatio?.trim() || null,
        input.durationSeconds ?? null,
        input.tags ?? [],
        input.isDefault ?? false,
        input.isActive ?? true,
        JSON.stringify(input.config ?? {}),
      ]
    );
    return mapRow(result.rows[0]);
  }

  async update(
    organizationId: string,
    recipeId: string,
    patch: Partial<ContentRecipeInput>
  ): Promise<ContentRecipeRecord> {
    const current = await this.getById(organizationId, recipeId);
    if (!current) throw new Error('Recipe not found');

    const nextMedium = patch.medium ?? current.medium;
    const nextProvider = patch.provider ?? current.provider;
    const nextDefault = patch.isDefault ?? current.isDefault;

    if (nextDefault) {
      await this.clearDefault(organizationId, nextMedium, nextProvider, recipeId);
    }

    const result = await query<RecipeRow>(
      `UPDATE content_recipes SET
         slug = $3,
         name = $4,
         description = $5,
         medium = $6,
         provider = $7,
         channel = $8,
         prompt_template = $9,
         style_notes = $10,
         negative_prompt = $11,
         model = $12,
         aspect_ratio = $13,
         duration_seconds = $14,
         tags = $15,
         is_default = $16,
         is_active = $17,
         config = $18::jsonb,
         updated_at = NOW()
       WHERE id = $1 AND organization_id = $2
       RETURNING *`,
      [
        recipeId,
        organizationId,
        slugify(patch.slug ?? current.slug),
        (patch.name ?? current.name).trim(),
        patch.description !== undefined
          ? patch.description?.trim() || null
          : current.description,
        nextMedium,
        nextProvider,
        patch.channel !== undefined
          ? patch.channel?.trim() || null
          : current.channel,
        (patch.promptTemplate ?? current.promptTemplate).trim(),
        patch.styleNotes !== undefined
          ? patch.styleNotes?.trim() || null
          : current.styleNotes,
        patch.negativePrompt !== undefined
          ? patch.negativePrompt?.trim() || null
          : current.negativePrompt,
        patch.model !== undefined ? patch.model?.trim() || null : current.model,
        patch.aspectRatio !== undefined
          ? patch.aspectRatio?.trim() || null
          : current.aspectRatio,
        patch.durationSeconds !== undefined
          ? patch.durationSeconds
          : current.durationSeconds,
        patch.tags ?? current.tags,
        nextDefault,
        patch.isActive ?? current.isActive,
        JSON.stringify(patch.config ?? current.config),
      ]
    );
    return mapRow(result.rows[0]);
  }

  async delete(organizationId: string, recipeId: string): Promise<void> {
    const current = await this.getById(organizationId, recipeId);
    if (!current) throw new Error('Recipe not found');
    if (current.config?.catalogSource === 'runway_official') {
      throw new Error('Official Runway recipes cannot be deleted — duplicate them to customize.');
    }
    await query(
      `DELETE FROM content_recipes WHERE id = $1 AND organization_id = $2`,
      [recipeId, organizationId]
    );
  }

  async recordUsage(organizationId: string, recipeId: string): Promise<void> {
    await query(
      `UPDATE content_recipes SET
         usage_count = usage_count + 1,
         last_used_at = NOW(),
         updated_at = NOW()
       WHERE id = $1 AND organization_id = $2`,
      [recipeId, organizationId]
    );
  }

  /** Compact recipe list for Claude / planning prompts. */
  async formatForPrompt(
    organizationId: string,
    limit = 12
  ): Promise<string> {
    const recipes = await this.list(organizationId, { activeOnly: true });
    if (!recipes.length) return '';
    const custom = recipes.filter((r) => r.config?.catalogSource !== 'runway_official');
    const official = recipes.filter((r) => r.config?.catalogSource === 'runway_official');
    const ordered = [...custom, ...official].slice(0, limit);
    return ordered
      .map((r) => {
        const kind = r.config?.catalogSource === 'runway_official' ? 'official' : 'saved';
        return `- ${r.slug} [${kind}/${r.medium}]: ${r.name} — set executionBrief.recipeSlug to "${r.slug}" to use`;
      })
      .join('\n');
  }

  private async clearDefault(
    organizationId: string,
    medium: ContentRecipeMedium,
    provider: ContentRecipeProvider,
    exceptId?: string
  ): Promise<void> {
    if (exceptId) {
      await query(
        `UPDATE content_recipes SET is_default = FALSE, updated_at = NOW()
         WHERE organization_id = $1 AND medium = $2 AND provider = $3 AND id <> $4 AND is_default = TRUE`,
        [organizationId, medium, provider, exceptId]
      );
      return;
    }
    await query(
      `UPDATE content_recipes SET is_default = FALSE, updated_at = NOW()
       WHERE organization_id = $1 AND medium = $2 AND provider = $3 AND is_default = TRUE`,
      [organizationId, medium, provider]
    );
  }
}
