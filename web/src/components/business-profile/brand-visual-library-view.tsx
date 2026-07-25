'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/hundres/button';
import { Card } from '@/components/hundres/card';
import { Chip } from '@/components/hundres/chip';
import { Icon } from '@/components/hundres/icon';
import {
  createBrandVisual,
  deleteBrandVisual,
  listBrandVisuals,
  updateBrandVisual,
  type BrandVisualAsset,
  type BrandVisualAssetInput,
  type BrandVisualUseFor,
} from '@/lib/brand-visuals';
import { useAuth } from '@/providers/auth-provider';

type FormState = {
  title: string;
  imageUrl: string;
  theme: string;
  notes: string;
  tags: string;
  useFor: BrandVisualUseFor;
};

const EMPTY: FormState = {
  title: '',
  imageUrl: '',
  theme: '',
  notes: '',
  tags: '',
  useFor: 'any',
};

const USE_FILTERS: Array<{ value: 'all' | BrandVisualUseFor; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'any', label: 'Any post' },
  { value: 'feed', label: 'Feed' },
  { value: 'story', label: 'Story' },
  { value: 'reel', label: 'Reel' },
  { value: 'product', label: 'Product' },
  { value: 'lifestyle', label: 'Lifestyle' },
];

function assetToForm(asset: BrandVisualAsset): FormState {
  return {
    title: asset.title,
    imageUrl: asset.imageUrl,
    theme: asset.theme ?? '',
    notes: asset.notes ?? '',
    tags: asset.tags.join(', '),
    useFor: asset.useFor,
  };
}

function formToInput(form: FormState): BrandVisualAssetInput {
  return {
    title: form.title.trim(),
    imageUrl: form.imageUrl.trim(),
    theme: form.theme.trim() || null,
    notes: form.notes.trim() || null,
    tags: form.tags
      .split(/[,#]/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 20),
    useFor: form.useFor,
    isActive: true,
  };
}

function matchesQuery(asset: BrandVisualAsset, query: string): boolean {
  if (!query) return true;
  const hay = [
    asset.title,
    asset.theme ?? '',
    asset.notes ?? '',
    asset.useFor,
    ...asset.tags,
  ]
    .join(' ')
    .toLowerCase();
  return hay.includes(query);
}

export function BrandVisualLibraryView() {
  const { accessToken, activeOrganization } = useAuth();
  const [assets, setAssets] = useState<BrandVisualAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [query, setQuery] = useState('');
  const [useFilter, setUseFilter] = useState<'all' | BrandVisualUseFor>('all');

  const load = useCallback(async () => {
    if (!accessToken || !activeOrganization) return;
    setLoading(true);
    setError(null);
    try {
      const { assets: items } = await listBrandVisuals(accessToken, activeOrganization.id, {
        activeOnly: false,
      });
      setAssets(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load visual library');
    } finally {
      setLoading(false);
    }
  }, [accessToken, activeOrganization]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter((asset) => {
      if (useFilter !== 'all' && asset.useFor !== useFilter) return false;
      return matchesQuery(asset, q);
    });
  }, [assets, query, useFilter]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY);
    setFormOpen(true);
    setError(null);
  };

  const openEdit = (asset: BrandVisualAsset) => {
    setEditingId(asset.id);
    setForm(assetToForm(asset));
    setFormOpen(true);
    setError(null);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY);
  };

  const save = async () => {
    if (!accessToken || !activeOrganization) return;
    if (!form.title.trim() || !form.imageUrl.trim()) {
      setError('Title and image URL are required.');
      return;
    }
    if (!form.imageUrl.trim().startsWith('https://')) {
      setError('Image URL must start with https://');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const body = formToInput(form);
      if (editingId) {
        await updateBrandVisual(accessToken, activeOrganization.id, editingId, body);
      } else {
        await createBrandVisual(accessToken, activeOrganization.id, body);
      }
      closeForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (asset: BrandVisualAsset) => {
    if (!accessToken || !activeOrganization) return;
    if (!window.confirm(`Remove “${asset.title}” from the library?`)) return;
    setError(null);
    try {
      await deleteBrandVisual(accessToken, activeOrganization.id, asset.id);
      if (editingId === asset.id) closeForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  return (
    <div className="profile-page profile-page--wide">
      <div className="profile-header">
        <div>
          <div className="goal-eyebrow" style={{ justifyContent: 'flex-start', marginBottom: 12 }}>
            <Chip variant="accent">
              <Icon name="library" style={{ width: 11, height: 11 }} />
              Creatives
            </Chip>
            {!loading ? <Chip variant="accent">{assets.length} saved</Chip> : null}
          </div>
          <h1 className="profile-title">Visual library</h1>
          <p className="profile-sub">
            Save direct HTTPS image links and a theme for each. Paste a file URL
            (Shopify CDN, ImgBB, <code>images.unsplash.com</code>) — not a photo webpage.
            Unsplash photo pages are resolved automatically when possible. The agent prefers these
            over random stock photos for Instagram posts and Runway product references.
          </p>
        </div>
        <div className="profile-actions">
          <Button variant="ghost" type="button" disabled={loading} onClick={() => void load()}>
            Refresh
          </Button>
          {!formOpen ? (
            <Button variant="primary" type="button" onClick={openCreate}>
              Add image
            </Button>
          ) : (
            <Button variant="ghost" type="button" onClick={closeForm}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      {error ? (
        <Card style={{ marginBottom: 16, borderColor: 'var(--warn)' }}>
          <p style={{ margin: 0, color: 'var(--warn)' }}>{error}</p>
        </Card>
      ) : null}

      {formOpen ? (
        <Card className="recipes-form-card">
          <div className="profile-form">
            <label className="profile-field" htmlFor="visual-title">
              <span className="profile-label">Title</span>
              <span className="profile-hint">Short name you’ll recognize</span>
              <input
                id="visual-title"
                className="auth-input"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Cream of Dreams — marble bathroom"
              />
            </label>
            <label className="profile-field" htmlFor="visual-url">
              <span className="profile-label">Image URL</span>
              <span className="profile-hint">
                Direct image address (right‑click image → Copy image address). Webpage links like
                unsplash.com/photos/… won’t display until resolved.
              </span>
              <input
                id="visual-url"
                className="auth-input"
                value={form.imageUrl}
                onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
                placeholder="https://images.unsplash.com/photo-… or https://cdn.shopify.com/…/product.jpg"
              />
            </label>
            {form.imageUrl.startsWith('https://') ? (
              <div className="visual-preview">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={form.imageUrl}
                  alt={form.title || 'Preview'}
                  referrerPolicy="no-referrer"
                />
              </div>
            ) : null}
            <label className="profile-field" htmlFor="visual-theme">
              <span className="profile-label">Theme</span>
              <span className="profile-hint">
                Look &amp; feel the agent should match — e.g. clean marble bathroom, soft morning light
              </span>
              <textarea
                id="visual-theme"
                className="auth-input"
                rows={3}
                value={form.theme}
                onChange={(e) => setForm((f) => ({ ...f, theme: e.target.value }))}
                placeholder="Clean lifestyle, marble counter, soft natural light, muted beige tones"
              />
            </label>
            <div className="recipes-row">
              <label className="profile-field" htmlFor="visual-use">
                <span className="profile-label">Best for</span>
                <select
                  id="visual-use"
                  className="auth-input"
                  value={form.useFor}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, useFor: e.target.value as BrandVisualUseFor }))
                  }
                >
                  <option value="any">Any post</option>
                  <option value="feed">Feed photo</option>
                  <option value="story">Story</option>
                  <option value="reel">Reel / video ref</option>
                  <option value="product">Product hero</option>
                  <option value="lifestyle">Lifestyle</option>
                </select>
              </label>
              <label className="profile-field" htmlFor="visual-tags">
                <span className="profile-label">Tags</span>
                <input
                  id="visual-tags"
                  className="auth-input"
                  value={form.tags}
                  onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                  placeholder="marble, skincare, cream-of-dreams"
                />
              </label>
            </div>
            <label className="profile-field" htmlFor="visual-notes">
              <span className="profile-label">Notes (optional)</span>
              <textarea
                id="visual-notes"
                className="auth-input"
                rows={2}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Use for quiet bathroom posts — avoid busy backgrounds"
              />
            </label>
            <div className="recipes-form-actions">
              <Button
                variant="primary"
                type="button"
                disabled={saving}
                onClick={() => void save()}
              >
                {saving ? 'Saving…' : editingId ? 'Save changes' : 'Save to library'}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {!formOpen ? (
        <div className="visual-toolbar">
          <label className="visual-search" htmlFor="visual-search">
            <Icon name="search" style={{ width: 14, height: 14 }} />
            <input
              id="visual-search"
              className="auth-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title, theme, tags…"
            />
          </label>
          <div className="visual-filters" role="group" aria-label="Filter by use">
            {USE_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                className={`visual-filter${useFilter === f.value ? ' active' : ''}`}
                onClick={() => setUseFilter(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <Card>
        {loading ? (
          <p className="t-dim">Loading library…</p>
        ) : assets.length === 0 ? (
          <div className="recipes-empty">
            <p style={{ margin: 0 }}>
              No images yet. Paste product/lifestyle photo URLs and a theme so Instagram posts stay
              on-brand.
            </p>
            <Button variant="ghost" type="button" onClick={openCreate}>
              Add first image
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <p className="t-dim" style={{ margin: 0 }}>
            No images match this search. Clear filters or add a new link.
          </p>
        ) : (
          <ul className="visual-grid">
            {filtered.map((asset) => (
              <li key={asset.id} className="visual-card">
                <div className="visual-card-thumb">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={asset.imageUrl}
                    alt={asset.title}
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="visual-card-body">
                  <div className="recipes-item-title-row">
                    <span className="recipes-item-name">{asset.title}</span>
                    <Chip variant="accent">{asset.useFor}</Chip>
                    {!asset.isActive ? <Chip variant="warn">Off</Chip> : null}
                  </div>
                  {asset.theme ? <p className="visual-theme-line">{asset.theme}</p> : null}
                  <p className="recipes-item-meta">
                    <a href={asset.imageUrl} target="_blank" rel="noreferrer">
                      Open image
                    </a>
                    {asset.tags.length ? ` · ${asset.tags.join(', ')}` : ''}
                    {asset.usageCount > 0 ? ` · used ${asset.usageCount}×` : ''}
                  </p>
                  <div className="recipes-item-actions">
                    <Button variant="ghost" type="button" onClick={() => openEdit(asset)}>
                      Edit
                    </Button>
                    <Button variant="ghost" type="button" onClick={() => void remove(asset)}>
                      Delete
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="profile-footer t-dim">
        <Icon name="info" style={{ width: 12, height: 12, verticalAlign: -2, marginRight: 6 }} />
        Different from{' '}
        <Link href="/business" style={{ color: 'var(--accent-hover)' }}>
          Businesses to emulate
        </Link>{' '}
        (competitor research). This library is your creative reference for posts.
      </p>
    </div>
  );
}
