import { resolvePublicImageUrl } from '../lib/resolvePublicImageUrl.js';
import { query } from '../database/connection.js';
import { logger } from '../lib/logger.js';

const log = logger('brand-visuals');
import type {
  BrandVisualAssetInput,
  BrandVisualAssetRecord,
  BrandVisualUseFor,
} from '../types/brandVisual.js';

type AssetRow = {
  id: string;
  organization_id: string;
  title: string;
  image_url: string;
  theme: string | null;
  notes: string | null;
  tags: string[] | null;
  use_for: BrandVisualUseFor;
  is_active: boolean;
  usage_count: number;
  last_used_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function mapRow(row: AssetRow): BrandVisualAssetRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    title: row.title,
    imageUrl: row.image_url,
    theme: row.theme,
    notes: row.notes,
    tags: row.tags ?? [],
    useFor: row.use_for,
    isActive: row.is_active,
    usageCount: row.usage_count,
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Org-scoped library of image links + visual themes for Instagram / Runway.
 */
export class BrandVisualLibraryService {
  async list(
    organizationId: string,
    filters?: { activeOnly?: boolean; useFor?: BrandVisualUseFor }
  ): Promise<BrandVisualAssetRecord[]> {
    const clauses = [
      'organization_id = $1',
      // Hide legacy Instagram inspiration rows if any were saved
      `COALESCE(asset_kind, 'image') = 'image'`,
    ];
    const params: unknown[] = [organizationId];
    let i = 2;

    if (filters?.activeOnly !== false) {
      clauses.push('is_active = TRUE');
    }
    if (filters?.useFor && filters.useFor !== 'any') {
      clauses.push(`(use_for = $${i} OR use_for = 'any')`);
      params.push(filters.useFor);
      i += 1;
    }

    const result = await query<AssetRow>(
      `SELECT * FROM brand_visual_assets
       WHERE ${clauses.join(' AND ')}
       ORDER BY usage_count DESC, updated_at DESC`,
      params
    );
    const assets = result.rows.map(mapRow);
    for (const asset of assets) {
      if (!/unsplash\.com\/photos\//i.test(asset.imageUrl)) continue;
      try {
        const fixed = await resolvePublicImageUrl(asset.imageUrl);
        if (fixed === asset.imageUrl) continue;
        await query(
          `UPDATE brand_visual_assets SET image_url = $3, updated_at = NOW()
           WHERE id = $1 AND organization_id = $2`,
          [asset.id, organizationId, fixed]
        );
        asset.imageUrl = fixed;
      } catch (err) {
        log.warn(
          'failed to resolve Unsplash page URL',
          asset.id,
          err instanceof Error ? err.message : err
        );
      }
    }
    return assets;
  }

  async getById(
    organizationId: string,
    assetId: string
  ): Promise<BrandVisualAssetRecord | null> {
    const result = await query<AssetRow>(
      `SELECT * FROM brand_visual_assets
       WHERE id = $1 AND organization_id = $2
         AND COALESCE(asset_kind, 'image') = 'image'`,
      [assetId, organizationId]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async create(
    organizationId: string,
    input: BrandVisualAssetInput
  ): Promise<BrandVisualAssetRecord> {
    const title = input.title.trim();
    if (!title) throw new Error('Title is required');
    const imageUrl = await resolvePublicImageUrl(input.imageUrl);

    const result = await query<AssetRow>(
      `INSERT INTO brand_visual_assets (
         organization_id, title, image_url, asset_kind, theme, notes, tags, use_for, is_active
       ) VALUES ($1, $2, $3, 'image', $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        organizationId,
        title.slice(0, 200),
        imageUrl,
        input.theme?.trim() || null,
        input.notes?.trim() || null,
        input.tags ?? [],
        input.useFor ?? 'any',
        input.isActive ?? true,
      ]
    );
    return mapRow(result.rows[0]);
  }

  async update(
    organizationId: string,
    assetId: string,
    patch: Partial<BrandVisualAssetInput>
  ): Promise<BrandVisualAssetRecord> {
    const current = await this.getById(organizationId, assetId);
    if (!current) throw new Error('Asset not found');

    const title = (patch.title ?? current.title).trim();
    if (!title) throw new Error('Title is required');
    const imageUrl = await resolvePublicImageUrl(patch.imageUrl ?? current.imageUrl);

    const result = await query<AssetRow>(
      `UPDATE brand_visual_assets SET
         title = $3,
         image_url = $4,
         asset_kind = 'image',
         theme = $5,
         notes = $6,
         tags = $7,
         use_for = $8,
         is_active = $9,
         updated_at = NOW()
       WHERE id = $1 AND organization_id = $2
       RETURNING *`,
      [
        assetId,
        organizationId,
        title.slice(0, 200),
        imageUrl,
        patch.theme !== undefined ? patch.theme?.trim() || null : current.theme,
        patch.notes !== undefined ? patch.notes?.trim() || null : current.notes,
        patch.tags ?? current.tags,
        patch.useFor ?? current.useFor,
        patch.isActive ?? current.isActive,
      ]
    );
    return mapRow(result.rows[0]);
  }

  async delete(organizationId: string, assetId: string): Promise<void> {
    await query(`DELETE FROM brand_visual_assets WHERE id = $1 AND organization_id = $2`, [
      assetId,
      organizationId,
    ]);
  }

  async recordUsage(organizationId: string, assetId: string): Promise<void> {
    await query(
      `UPDATE brand_visual_assets SET
         usage_count = usage_count + 1,
         last_used_at = NOW(),
         updated_at = NOW()
       WHERE id = $1 AND organization_id = $2`,
      [assetId, organizationId]
    );
  }

  async pickForBrief(
    organizationId: string,
    keywords: string,
    options?: {
      count?: number;
      useFor?: BrandVisualUseFor;
      preferProduct?: boolean;
    }
  ): Promise<BrandVisualAssetRecord[]> {
    const count = Math.min(10, Math.max(1, options?.count ?? 1));
    const assets = await this.list(organizationId, {
      activeOnly: true,
      useFor: options?.useFor,
    });
    if (!assets.length) return [];

    const words = keywords
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2);

    const scored = assets
      .map((asset) => {
        const hay = [
          asset.title,
          asset.theme ?? '',
          asset.notes ?? '',
          ...asset.tags,
          asset.useFor,
        ]
          .join(' ')
          .toLowerCase();
        let score = 0;
        for (const word of words) {
          if (hay.includes(word)) score += 2;
        }
        if (asset.theme?.trim()) score += 1;
        // Prefer fresher assets — heavily used images get pushed down so posts vary.
        score -= Math.min(12, asset.usageCount * 2);
        if (options?.preferProduct) {
          if (asset.useFor === 'product') score += 24;
          else if (asset.useFor === 'any') score += 8;
          else if (asset.useFor === 'lifestyle') score += 4;
          if (/\bproduct\b|hero|pack|sku|bottle|jar|tube/i.test(hay)) score += 6;
        }
        return { asset, score };
      })
      .sort((a, b) => b.score - a.score);

    if (!words.length && !options?.preferProduct) {
      // Prefer least-used assets when keywords don't discriminate.
      return [...assets]
        .sort((a, b) => a.usageCount - b.usageCount || a.title.localeCompare(b.title))
        .slice(0, count);
    }

    const matched = scored.filter((s) => s.score > 0).map((s) => s.asset);
    if (matched.length) return matched.slice(0, count);
    return scored.map((s) => s.asset).slice(0, count);
  }

  async pickProductImages(
    organizationId: string,
    keywords: string,
    options?: { count?: number }
  ): Promise<BrandVisualAssetRecord[]> {
    const count = Math.min(10, Math.max(1, options?.count ?? 1));

    const productFirst = await this.pickForBrief(organizationId, keywords, {
      count,
      useFor: 'product',
      preferProduct: true,
    });
    if (productFirst.length >= count) return productFirst.slice(0, count);

    const anyBest = await this.pickForBrief(organizationId, keywords, {
      count,
      preferProduct: true,
    });
    const seen = new Set(productFirst.map((a) => a.id));
    const merged = [...productFirst];
    for (const asset of anyBest) {
      if (seen.has(asset.id)) continue;
      merged.push(asset);
      seen.add(asset.id);
      if (merged.length >= count) break;
    }
    return merged.slice(0, count);
  }

  async formatForPrompt(organizationId: string, limit = 12): Promise<string> {
    const assets = await this.list(organizationId, { activeOnly: true });
    if (!assets.length) return '';
    return assets
      .slice(0, limit)
      .map((a) => {
        const theme = a.theme?.trim() ? ` — theme: ${a.theme.trim()}` : '';
        return `- ${a.title}${theme} [${a.useFor}] ${a.imageUrl}`;
      })
      .join('\n');
  }
}
