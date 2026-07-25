'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/hundres/button';
import { Card } from '@/components/hundres/card';
import { Chip } from '@/components/hundres/chip';
import { Icon } from '@/components/hundres/icon';
import {
  createAdCampaign,
  currencySymbol,
  deleteAdCampaign,
  generateAdCreatives,
  listAdCampaigns,
  pushAdCampaignToMeta,
  updateAdCampaign,
  type AdCampaign,
  type AdCampaignChannel,
  type AdCampaignCreative,
  type AdCampaignInput,
} from '@/lib/ad-campaigns';
import { formatDateTime } from '@/lib/format-datetime';
import { useAuth } from '@/providers/auth-provider';

type PanelState =
  | { kind: 'view'; campaign: AdCampaign }
  | { kind: 'edit'; campaign: AdCampaign }
  | { kind: 'create' };

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function emptyCreative(name: string): AdCampaignCreative {
  return {
    name: `${name || 'Campaign'} · Ad 1`,
    primaryText: '',
    headline: '',
    cta: 'SHOP_NOW',
    finalUrl: 'https://example.com',
    imageUrl: null,
    imageSource: 'none',
  };
}

function statusVariant(
  status: AdCampaign['status']
): 'success' | 'warn' | 'accent' | 'default' {
  if (status === 'pushed') return 'success';
  if (status === 'ready') return 'accent';
  if (status === 'archived') return 'default';
  return 'warn';
}

export function AdCampaignLibraryView() {
  const { accessToken, activeOrganization } = useAuth();
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [form, setForm] = useState<AdCampaignInput>({
    name: '',
    channel: 'meta',
    objective: 'OUTCOME_TRAFFIC',
    dailyBudget: 15,
    currencyCode: 'GBP',
    ads: [emptyCreative('')],
  });

  const load = useCallback(async () => {
    if (!accessToken || !activeOrganization) return;
    setLoading(true);
    setError(null);
    try {
      const { campaigns: items } = await listAdCampaigns(
        accessToken,
        activeOrganization.id,
        { activeOnly: true }
      );
      setCampaigns(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  }, [accessToken, activeOrganization]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanel(null);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [panel]);

  const openCreate = () => {
    setForm({
      name: '',
      channel: 'meta',
      objective: 'OUTCOME_TRAFFIC',
      dailyBudget: 15,
      currencyCode: 'GBP',
      description: '',
      ads: [emptyCreative('New campaign')],
      targeting: { countries: ['GB'], ageMin: 25, ageMax: 55 },
    });
    setError(null);
    setPanel({ kind: 'create' });
  };

  const openEdit = (campaign: AdCampaign) => {
    setForm({
      name: campaign.name,
      slug: campaign.slug,
      description: campaign.description,
      channel: campaign.channel,
      objective: campaign.objective,
      dailyBudget: campaign.dailyBudget,
      currencyCode: campaign.currencyCode,
      durationDays: campaign.durationDays,
      targeting: campaign.targeting,
      ads: campaign.ads,
      recipeSlug: campaign.recipeSlug,
      status: campaign.status,
    });
    setError(null);
    setPanel({ kind: 'edit', campaign });
  };

  const openView = (campaign: AdCampaign) => {
    setError(null);
    setPanel({ kind: 'view', campaign });
  };

  const save = async () => {
    if (!accessToken || !activeOrganization) return;
    if (!form.name?.trim()) {
      setError('Name is required');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (panel?.kind === 'edit') {
        await updateAdCampaign(
          accessToken,
          activeOrganization.id,
          panel.campaign.id,
          form
        );
      } else {
        await createAdCampaign(accessToken, activeOrganization.id, {
          ...form,
          slug: slugify(form.slug || form.name),
        });
      }
      setPanel(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const copyCampaign = async (campaign: AdCampaign) => {
    if (!accessToken || !activeOrganization) return;
    setBusy(true);
    setError(null);
    try {
      await createAdCampaign(accessToken, activeOrganization.id, {
        name: `${campaign.name} (copy)`,
        slug: slugify(`${campaign.slug}-copy`),
        description: campaign.description,
        channel: campaign.channel,
        objective: campaign.objective,
        dailyBudget: campaign.dailyBudget,
        currencyCode: campaign.currencyCode,
        durationDays: campaign.durationDays,
        targeting: campaign.targeting,
        ads: campaign.ads.map((ad) => ({
          ...ad,
          imageHash: null,
          metaAdId: null,
          metaCreativeId: null,
        })),
        recipeSlug: campaign.recipeSlug,
        status: 'draft',
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Copy failed');
    } finally {
      setBusy(false);
    }
  };

  const generate = async (campaign: AdCampaign, force = false) => {
    if (!accessToken || !activeOrganization) return;
    setBusy(true);
    setError(null);
    try {
      const { campaign: updated } = await generateAdCreatives(
        accessToken,
        activeOrganization.id,
        campaign.id,
        { prefer: 'auto', force }
      );
      await load();
      if (panel?.kind === 'view') setPanel({ kind: 'view', campaign: updated });
      if (panel?.kind === 'edit') setPanel({ kind: 'edit', campaign: updated });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image generation failed');
    } finally {
      setBusy(false);
    }
  };

  const pushMeta = async (campaign: AdCampaign) => {
    if (!accessToken || !activeOrganization) return;
    if (
      !window.confirm(
        `Create “${campaign.name}” as PAUSED in Meta Ads? Spend stays off until you enable it in Ads Manager.`
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { campaign: updated } = await pushAdCampaignToMeta(
        accessToken,
        activeOrganization.id,
        campaign.id
      );
      await load();
      setPanel({ kind: 'view', campaign: updated });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Push to Meta failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (campaign: AdCampaign) => {
    if (!accessToken || !activeOrganization) return;
    if (!window.confirm(`Delete “${campaign.name}” from the library?`)) return;
    setBusy(true);
    try {
      await deleteAdCampaign(accessToken, activeOrganization.id, campaign.id);
      setPanel(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  const panelTitle =
    panel?.kind === 'view'
      ? panel.campaign.name
      : panel?.kind === 'edit'
        ? 'Edit campaign'
        : panel?.kind === 'create'
          ? 'New campaign'
          : '';

  return (
    <div className="profile-page profile-page--wide">
      <div className="profile-header">
        <div>
          <div className="goal-eyebrow" style={{ justifyContent: 'flex-start', marginBottom: 12 }}>
            <Chip variant="accent">
              <Icon name="target" style={{ width: 11, height: 11 }} />
              Paid + social
            </Chip>
            {!loading ? <Chip variant="accent">{campaigns.length} saved</Chip> : null}
          </div>
          <h1 className="profile-title">Ad campaigns</h1>
          <p className="profile-sub">
            Hands-off library for agent-built campaigns. Autopilot / Ask drafts the copy, generates
            images (Visual library → Canva → Runway), saves here, and creates the campaign{' '}
            <strong>paused</strong> in Meta. You only enable spend in Ads Manager when ready.
          </p>
        </div>
        <div className="profile-actions">
          <Button variant="ghost" type="button" disabled={loading} onClick={() => void load()}>
            Refresh
          </Button>
          <Button variant="primary" type="button" onClick={openCreate}>
            New campaign
          </Button>
        </div>
      </div>

      {error && !panel ? (
        <Card style={{ marginBottom: 16, borderColor: 'var(--warn)' }}>
          <p style={{ margin: 0, color: 'var(--warn)' }}>{error}</p>
        </Card>
      ) : null}

      <Card>
        {loading ? (
          <p className="t-dim">Loading campaigns…</p>
        ) : campaigns.length === 0 ? (
          <div className="recipes-empty">
            <p style={{ margin: 0 }}>
              No campaigns yet. Create one here, or let Autopilot / Ask draft a Meta campaign — it
              lands in this library automatically.
            </p>
            <Button variant="ghost" type="button" onClick={openCreate}>
              Create first campaign
            </Button>
          </div>
        ) : (
          <ul className="ads-campaign-list">
            {campaigns.map((campaign) => {
              const symbol = currencySymbol(campaign.currencyCode);
              const hasImages = campaign.ads.some((a) => a.imageUrl);
              return (
                <li key={campaign.id} className="ads-campaign-row">
                  <div className="ads-campaign-main">
                    <div className="recipes-item-title-row">
                      <span className="recipes-item-name">{campaign.name}</span>
                      <Chip variant={statusVariant(campaign.status)}>{campaign.status}</Chip>
                      <Chip variant="accent">{campaign.channel}</Chip>
                      {hasImages ? (
                        <Chip variant="success">Creatives</Chip>
                      ) : (
                        <Chip variant="warn">No images</Chip>
                      )}
                    </div>
                    <p className="recipes-item-meta">
                      <code>{campaign.slug}</code>
                      {' · '}
                      {symbol}
                      {campaign.dailyBudget}/day
                      {' · '}
                      {campaign.ads.length} ad{campaign.ads.length === 1 ? '' : 's'}
                      {' · '}
                      {formatDateTime(campaign.updatedAt)}
                      {campaign.metaCampaignId ? ` · Meta ${campaign.metaCampaignId}` : ''}
                    </p>
                    {campaign.ads[0]?.imageUrl ? (
                      <div className="ads-campaign-thumbs">
                        {campaign.ads.slice(0, 3).map((ad, i) =>
                          ad.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              key={`${campaign.id}-${i}`}
                              src={ad.imageUrl}
                              alt={ad.name}
                              className="ads-campaign-thumb"
                              referrerPolicy="no-referrer"
                            />
                          ) : null
                        )}
                      </div>
                    ) : null}
                  </div>
                  <div className="recipes-item-actions">
                    <Button variant="ghost" type="button" onClick={() => openView(campaign)}>
                      View
                    </Button>
                    <Button
                      variant="ghost"
                      type="button"
                      disabled={busy}
                      onClick={() => openEdit(campaign)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      type="button"
                      disabled={busy}
                      onClick={() => void copyCampaign(campaign)}
                    >
                      Copy
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {panel ? (
        <div className="action-drawer-root" role="presentation">
          <button
            type="button"
            className="action-drawer-backdrop"
            aria-label="Close"
            onClick={() => setPanel(null)}
          />
          <aside
            className="action-drawer-panel recipes-drawer-panel"
            role="dialog"
            aria-modal
            aria-labelledby="ads-drawer-title"
          >
            <header className="action-drawer-header">
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 id="ads-drawer-title" className="h-lg" style={{ margin: 0 }}>
                  {panelTitle}
                </h2>
              </div>
              <button
                type="button"
                className="btn btn-ghost action-drawer-close"
                onClick={() => setPanel(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </header>
            <div className="action-drawer-body">
              {error ? (
                <Card style={{ marginBottom: 16, borderColor: 'var(--warn)' }}>
                  <p style={{ margin: 0, color: 'var(--warn)' }}>{error}</p>
                </Card>
              ) : null}

              {panel.kind === 'view' ? (
                (() => {
                  const c = panel.campaign;
                  const symbol = currencySymbol(c.currencyCode);
                  return (
                    <>
                      <div className="recipes-item-title-row" style={{ marginBottom: 12 }}>
                        <Chip variant={statusVariant(c.status)}>{c.status}</Chip>
                        <Chip variant="accent">{c.channel}</Chip>
                        <Chip variant="default">
                          {symbol}
                          {c.dailyBudget}/day
                        </Chip>
                      </div>
                      {c.description ? (
                        <p className="recipes-sub" style={{ maxWidth: 'none', marginBottom: 12 }}>
                          {c.description}
                        </p>
                      ) : null}
                      <p className="recipes-item-meta">
                        Targeting: {c.targeting.countries.join(', ')} · ages{' '}
                        {c.targeting.ageMin}–{c.targeting.ageMax}
                      </p>
                      <div className="ads-creative-stack">
                        {c.ads.map((ad, i) => (
                          <div key={`${ad.name}-${i}`} className="ads-creative-card">
                            {ad.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={ad.imageUrl}
                                alt={ad.name}
                                className="ads-creative-image"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div className="ads-creative-placeholder">No image yet</div>
                            )}
                            <div>
                              <strong>{ad.name}</strong>
                              <p className="recipes-item-meta" style={{ marginTop: 4 }}>
                                {ad.imageSource ? `Source: ${ad.imageSource}` : 'No creative source'}
                              </p>
                              <p style={{ margin: '8px 0 0', fontSize: 14 }}>{ad.primaryText}</p>
                              <p className="recipes-item-meta">{ad.headline}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="recipes-form-actions" style={{ marginTop: 20 }}>
                        <Button
                          variant="primary"
                          type="button"
                          disabled={busy}
                          onClick={() => void generate(c, true)}
                        >
                          {busy ? 'Working…' : 'Generate images'}
                        </Button>
                        {c.channel !== 'instagram' ? (
                          <Button
                            variant="default"
                            type="button"
                            disabled={busy || c.status === 'pushed'}
                            onClick={() => void pushMeta(c)}
                          >
                            {c.status === 'pushed' ? 'Pushed to Meta' : 'Push paused to Meta'}
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          type="button"
                          disabled={busy}
                          onClick={() => openEdit(c)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          type="button"
                          disabled={busy}
                          onClick={() => void remove(c)}
                        >
                          Delete
                        </Button>
                      </div>
                    </>
                  );
                })()
              ) : null}

              {panel.kind === 'edit' || panel.kind === 'create' ? (
                <div className="profile-form">
                  <label className="profile-field" htmlFor="ad-name">
                    <span className="profile-label">Name</span>
                    <input
                      id="ad-name"
                      className="auth-input"
                      value={form.name ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    />
                  </label>
                  <label className="profile-field" htmlFor="ad-channel">
                    <span className="profile-label">Channel</span>
                    <select
                      id="ad-channel"
                      className="auth-input"
                      value={form.channel ?? 'meta'}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          channel: e.target.value as AdCampaignChannel,
                        }))
                      }
                    >
                      <option value="meta">Meta Ads</option>
                      <option value="instagram">Instagram (organic / creative only)</option>
                      <option value="both">Both</option>
                    </select>
                  </label>
                  <label className="profile-field" htmlFor="ad-budget">
                    <span className="profile-label">Daily budget</span>
                    <input
                      id="ad-budget"
                      className="auth-input"
                      type="number"
                      min={1}
                      value={form.dailyBudget ?? 15}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, dailyBudget: Number(e.target.value) || 15 }))
                      }
                    />
                  </label>
                  <label className="profile-field" htmlFor="ad-desc">
                    <span className="profile-label">Notes</span>
                    <textarea
                      id="ad-desc"
                      className="auth-input profile-textarea"
                      rows={3}
                      value={form.description ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    />
                  </label>
                  <label className="profile-field" htmlFor="ad-primary">
                    <span className="profile-label">Primary text (first ad)</span>
                    <textarea
                      id="ad-primary"
                      className="auth-input profile-textarea"
                      rows={4}
                      value={form.ads?.[0]?.primaryText ?? ''}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          ads: [
                            {
                              ...(f.ads?.[0] ?? emptyCreative(f.name || 'Campaign')),
                              primaryText: e.target.value,
                            },
                          ],
                        }))
                      }
                    />
                  </label>
                  <label className="profile-field" htmlFor="ad-headline">
                    <span className="profile-label">Headline</span>
                    <input
                      id="ad-headline"
                      className="auth-input"
                      value={form.ads?.[0]?.headline ?? ''}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          ads: [
                            {
                              ...(f.ads?.[0] ?? emptyCreative(f.name || 'Campaign')),
                              headline: e.target.value,
                            },
                          ],
                        }))
                      }
                    />
                  </label>
                  <label className="profile-field" htmlFor="ad-url">
                    <span className="profile-label">Final URL</span>
                    <input
                      id="ad-url"
                      className="auth-input"
                      value={form.ads?.[0]?.finalUrl ?? ''}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          ads: [
                            {
                              ...(f.ads?.[0] ?? emptyCreative(f.name || 'Campaign')),
                              finalUrl: e.target.value,
                            },
                          ],
                        }))
                      }
                    />
                  </label>
                  <div className="recipes-form-actions">
                    <Button
                      variant="primary"
                      type="button"
                      disabled={busy}
                      onClick={() => void save()}
                    >
                      {busy ? 'Saving…' : 'Save'}
                    </Button>
                    {panel.kind === 'edit' ? (
                      <Button
                        variant="default"
                        type="button"
                        disabled={busy}
                        onClick={() => void generate(panel.campaign, true)}
                      >
                        Generate images
                      </Button>
                    ) : null}
                    <Button variant="ghost" type="button" onClick={() => setPanel(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
