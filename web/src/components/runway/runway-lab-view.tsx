'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/hundres/button';
import { Card } from '@/components/hundres/card';
import { Chip } from '@/components/hundres/chip';
import { Icon } from '@/components/hundres/icon';
import { draftRecipePrompt } from '@/lib/content-recipes';
import { formatDateTime } from '@/lib/format-datetime';
import { listBrandVisuals, type BrandVisualAsset } from '@/lib/brand-visuals';
import {
  approveRunwayPromptTest,
  createRunwayPromptTest,
  deleteRunwayPromptTest,
  listRunwayPromptTests,
  rejectRunwayPromptTest,
  type RunwayPromptTest,
  type RunwayPromptTestReviewStatus,
} from '@/lib/runway-prompt-tests';
import { useAuth } from '@/providers/auth-provider';

type FormState = {
  title: string;
  promptText: string;
  styleNotes: string;
  negativePrompt: string;
  useLibraryReference: boolean;
  libraryAssetId: string;
};

type RunwayLabViewProps = {
  /** When true, omit page chrome (used inside Runway → Lab tab). */
  embedded?: boolean;
};

const EMPTY: FormState = {
  title: '',
  promptText: [
    'Photorealistic vertical 9:16 Instagram feed photograph.',
    'Brand: {{brand}}.',
    'Feature product: @product (exact packaging from the reference image).',
    'Mood / setting: {{vibe}}.',
    'Natural lighting, shallow depth of field, premium aesthetic, no logos or text overlays.',
    '{{brief}}',
  ].join(' '),
  styleNotes: 'Natural light, shallow depth of field, premium aesthetic',
  negativePrompt: 'logos, text overlays, watermarks, wrong product, generic stock jar',
  useLibraryReference: true,
  libraryAssetId: '',
};

const FILTERS: Array<{ value: 'all' | RunwayPromptTestReviewStatus; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

function reviewChip(test: RunwayPromptTest): { label: string; variant: 'accent' | 'success' | 'warn' | 'default' } {
  if (test.generationStatus === 'failed') return { label: 'Failed', variant: 'warn' };
  if (test.reviewStatus === 'approved') return { label: 'Approved', variant: 'success' };
  if (test.reviewStatus === 'rejected') return { label: 'Rejected', variant: 'warn' };
  return { label: 'Pending', variant: 'accent' };
}

export function RunwayLabView({ embedded = false }: RunwayLabViewProps) {
  const { accessToken, activeOrganization } = useAuth();
  const [tests, setTests] = useState<RunwayPromptTest[]>([]);
  const [visuals, setVisuals] = useState<BrandVisualAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [filter, setFilter] = useState<'all' | RunwayPromptTestReviewStatus>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveAsRecipe, setSaveAsRecipe] = useState(false);
  const [rejectNotes, setRejectNotes] = useState('');

  const load = useCallback(async () => {
    if (!accessToken || !activeOrganization) return;
    setLoading(true);
    setError(null);
    try {
      const [{ tests: items }, { assets }] = await Promise.all([
        listRunwayPromptTests(accessToken, activeOrganization.id, {
          reviewStatus: 'all',
        }),
        listBrandVisuals(accessToken, activeOrganization.id, { activeOnly: true }),
      ]);
      setTests(items);
      setVisuals(assets);
      setForm((f) => {
        if (f.libraryAssetId || !assets.length) return f;
        const product =
          assets.find((a) => a.useFor === 'product') ??
          assets.find((a) => a.useFor === 'any') ??
          assets[0];
        return product ? { ...f, libraryAssetId: product.id } : f;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Runway tests');
    } finally {
      setLoading(false);
    }
  }, [accessToken, activeOrganization]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedVisual = useMemo(
    () => visuals.find((v) => v.id === form.libraryAssetId) ?? null,
    [visuals, form.libraryAssetId]
  );

  const filtered = useMemo(() => {
    if (filter === 'all') return tests;
    return tests.filter((t) => {
      if (filter === 'pending') {
        return t.reviewStatus === 'pending' && t.generationStatus === 'succeeded';
      }
      return t.reviewStatus === filter;
    });
  }, [tests, filter]);

  const selected = useMemo(
    () => tests.find((t) => t.id === selectedId) ?? filtered[0] ?? null,
    [tests, selectedId, filtered]
  );

  useEffect(() => {
    if (selected && selectedId !== selected.id) {
      setSelectedId(selected.id);
    }
  }, [selected, selectedId]);

  const pendingCount = tests.filter(
    (t) => t.reviewStatus === 'pending' && t.generationStatus === 'succeeded'
  ).length;
  const approvedCount = tests.filter((t) => t.reviewStatus === 'approved').length;

  const draftWithAi = async () => {
    if (!accessToken || !activeOrganization) return;
    setDrafting(true);
    setError(null);
    try {
      const { draft } = await draftRecipePrompt(accessToken, activeOrganization.id, {
        engine: 'text_to_image',
        recipeName: form.title.trim() || 'Runway lab test',
        concept: form.title.trim() || null,
        currentPrompt: form.promptText.trim() || null,
      });
      setForm((f) => ({
        ...f,
        title: f.title.trim() || draft.name || f.title,
        promptText: draft.promptTemplate,
        styleNotes: draft.styleNotes ?? f.styleNotes,
        negativePrompt: draft.negativePrompt ?? f.negativePrompt,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to draft prompt');
    } finally {
      setDrafting(false);
    }
  };

  const generate = async () => {
    if (!accessToken || !activeOrganization) return;
    if (!form.promptText.trim()) {
      setError('Add a prompt before generating.');
      return;
    }
    if (form.useLibraryReference && visuals.length === 0) {
      setError('Add a product photo in Visual library first, or turn off “Use product image”.');
      return;
    }
    if (form.useLibraryReference && !form.libraryAssetId) {
      setError('Pick which product image from the visual library to use as @product.');
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const { test } = await createRunwayPromptTest(accessToken, activeOrganization.id, {
        title: form.title.trim() || null,
        promptText: form.promptText.trim(),
        styleNotes: form.styleNotes.trim() || null,
        negativePrompt: form.negativePrompt.trim() || null,
        useLibraryReference: form.useLibraryReference,
        libraryAssetId: form.useLibraryReference ? form.libraryAssetId || null : null,
      });
      setTests((prev) => [test, ...prev]);
      setSelectedId(test.id);
      setFilter(test.generationStatus === 'failed' ? 'all' : 'pending');
      if (test.generationStatus === 'failed') {
        setError(test.generationError || 'Runway generation failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate');
    } finally {
      setGenerating(false);
    }
  };

  const reusePrompt = (test: RunwayPromptTest) => {
    setForm((f) => ({
      title: test.title,
      promptText: test.promptText,
      styleNotes: test.styleNotes ?? '',
      negativePrompt: test.negativePrompt ?? '',
      useLibraryReference: test.useLibraryReference,
      libraryAssetId: f.libraryAssetId,
    }));
    setError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const approve = async (test: RunwayPromptTest) => {
    if (!accessToken || !activeOrganization) return;
    setActingId(test.id);
    setError(null);
    try {
      const { test: updated } = await approveRunwayPromptTest(
        accessToken,
        activeOrganization.id,
        test.id,
        {
          title: test.title,
          saveAsRecipe,
          recipeName: test.title,
        }
      );
      setTests((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setSaveAsRecipe(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve');
    } finally {
      setActingId(null);
    }
  };

  const reject = async (test: RunwayPromptTest) => {
    if (!accessToken || !activeOrganization) return;
    setActingId(test.id);
    setError(null);
    try {
      const { test: updated } = await rejectRunwayPromptTest(
        accessToken,
        activeOrganization.id,
        test.id,
        rejectNotes.trim() || null
      );
      setTests((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setRejectNotes('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject');
    } finally {
      setActingId(null);
    }
  };

  const remove = async (test: RunwayPromptTest) => {
    if (!accessToken || !activeOrganization) return;
    if (!window.confirm(`Delete this test “${test.title}”?`)) return;
    setActingId(test.id);
    setError(null);
    try {
      await deleteRunwayPromptTest(accessToken, activeOrganization.id, test.id);
      setTests((prev) => prev.filter((t) => t.id !== test.id));
      if (selectedId === test.id) setSelectedId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className={embedded ? 'runway-section' : 'profile-page profile-page--wide'}>
      <div className="profile-header">
        <div>
          {embedded ? (
            <>
              <div className="goal-eyebrow" style={{ justifyContent: 'flex-start', marginBottom: 8 }}>
                {!loading ? <Chip variant="accent">{pendingCount} pending</Chip> : null}
                {!loading ? <Chip variant="success">{approvedCount} in library</Chip> : null}
              </div>
              <h2 className="runway-section-title">Lab</h2>
              <p className="profile-sub">
                Try image prompts with Runway, approve winners into the{' '}
                <Link href="/visuals">visual library</Link>, and optionally save them as recipes.
                Pick a product photo and include <code>@product</code> so packaging matches.
              </p>
            </>
          ) : (
            <>
              <div className="goal-eyebrow" style={{ justifyContent: 'flex-start', marginBottom: 12 }}>
                <Chip variant="accent">
                  <Icon name="sparkle" style={{ width: 11, height: 11 }} />
                  Lab
                </Chip>
                {!loading ? <Chip variant="accent">{pendingCount} pending</Chip> : null}
                {!loading ? <Chip variant="success">{approvedCount} in library</Chip> : null}
              </div>
              <h1 className="profile-title">Lab</h1>
              <p className="profile-sub">
                Try image prompts with Runway, approve the ones you like into the{' '}
                <Link href="/visuals">visual library</Link>, and optionally save winning prompts as{' '}
                <Link href="/runway?section=recipes">recipes</Link>. Pick a product photo and include{' '}
                <code>@product</code> so packaging matches.
              </p>
            </>
          )}
        </div>
        <div className="profile-actions">
          <Button variant="ghost" type="button" disabled={loading} onClick={() => void load()}>
            Refresh
          </Button>
          {!embedded ? (
            <Link href="/integrations" className="btn btn-ghost">
              Runway connection
            </Link>
          ) : null}
        </div>
      </div>

      {error ? (
        <Card style={{ marginBottom: 16, borderColor: 'var(--warn)' }}>
          <p style={{ margin: 0, color: 'var(--warn)' }}>{error}</p>
        </Card>
      ) : null}

      <Card className="recipes-form-card runway-lab-form">
        <div className="profile-form">
          <label className="profile-field" htmlFor="lab-title">
            <span className="profile-label">Test title (optional)</span>
            <input
              id="lab-title"
              className="auth-input"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Marble bathroom — cream jar close-up"
            />
          </label>
          <label className="profile-field" htmlFor="lab-prompt">
            <span className="profile-label">Prompt</span>
            <span className="profile-hint">
              Use <code>@product</code> for the library photo (required for product match), plus
              placeholders like <code>{'{{brand}}'}</code>, <code>{'{{vibe}}'}</code>,{' '}
              <code>{'{{brief}}'}</code>. Long prompts are trimmed from the end — put product
              identity near the top.
            </span>
            <textarea
              id="lab-prompt"
              className="auth-input recipes-prompt-textarea"
              rows={6}
              value={form.promptText}
              onChange={(e) => setForm((f) => ({ ...f, promptText: e.target.value }))}
            />
          </label>
          <div className="recipes-row">
            <label className="profile-field" htmlFor="lab-style">
              <span className="profile-label">Style notes</span>
              <input
                id="lab-style"
                className="auth-input"
                value={form.styleNotes}
                onChange={(e) => setForm((f) => ({ ...f, styleNotes: e.target.value }))}
              />
            </label>
            <label className="profile-field" htmlFor="lab-negative">
              <span className="profile-label">Negative prompt</span>
              <input
                id="lab-negative"
                className="auth-input"
                value={form.negativePrompt}
                onChange={(e) => setForm((f) => ({ ...f, negativePrompt: e.target.value }))}
              />
            </label>
          </div>
          <label className="recipes-check">
            <input
              type="checkbox"
              checked={form.useLibraryReference}
              onChange={(e) =>
                setForm((f) => ({ ...f, useLibraryReference: e.target.checked }))
              }
            />
            Use a product image from the visual library as <code>@product</code>
          </label>
          {form.useLibraryReference ? (
            <div className="runway-lab-ref">
              {visuals.length === 0 ? (
                <p className="t-dim" style={{ margin: 0 }}>
                  No library images yet.{' '}
                  <Link href="/visuals">Add a product photo</Link> first, or turn this off.
                </p>
              ) : (
                <>
                  <label className="profile-field" htmlFor="lab-visual">
                    <span className="profile-label">Product reference</span>
                    <select
                      id="lab-visual"
                      className="auth-input"
                      value={form.libraryAssetId}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, libraryAssetId: e.target.value }))
                      }
                    >
                      <option value="">Select a library image…</option>
                      {visuals.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.title}
                          {asset.useFor !== 'any' ? ` · ${asset.useFor}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedVisual ? (
                    <div className="runway-lab-ref-preview">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={selectedVisual.imageUrl}
                        alt={selectedVisual.title}
                        referrerPolicy="no-referrer"
                      />
                      <div>
                        <div className="recipes-item-name">{selectedVisual.title}</div>
                        <p className="t-dim" style={{ margin: '4px 0 0' }}>
                          Runway will match this packaging via <code>@product</code>
                          {selectedVisual.theme ? ` · ${selectedVisual.theme}` : ''}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
          <div className="recipes-form-actions">
            <Button
              variant="ghost"
              type="button"
              disabled={drafting || generating}
              onClick={() => void draftWithAi()}
            >
              {drafting ? 'Drafting…' : 'Write with AI'}
            </Button>
            <Button
              variant="primary"
              type="button"
              disabled={generating || drafting || !form.promptText.trim()}
              onClick={() => void generate()}
            >
              {generating ? 'Generating still…' : 'Generate still'}
            </Button>
          </div>
          {generating ? (
            <p className="t-dim" style={{ margin: 0 }}>
              Runway usually takes 30–90 seconds. Keep this tab open.
            </p>
          ) : null}
        </div>
      </Card>

      <div className="runway-lab-layout">
        <div className="runway-lab-list">
          <div className="visual-filters" role="group" aria-label="Filter by review">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                className={`visual-filter${filter === f.value ? ' active' : ''}`}
                onClick={() => setFilter(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>

          {loading ? (
            <p className="t-dim">Loading tests…</p>
          ) : filtered.length === 0 ? (
            <Card>
              <div className="recipes-empty">
                <p style={{ margin: 0 }}>
                  No tests yet in this filter. Generate a still above, then approve or reject it.
                </p>
              </div>
            </Card>
          ) : (
            <ul className="runway-lab-grid">
              {filtered.map((test) => {
                const chip = reviewChip(test);
                const active = selected?.id === test.id;
                return (
                  <li key={test.id}>
                    <button
                      type="button"
                      className={`runway-lab-thumb${active ? ' active' : ''}`}
                      onClick={() => setSelectedId(test.id)}
                    >
                      {test.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={test.imageUrl}
                          alt={test.title}
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="runway-lab-thumb-empty">No image</div>
                      )}
                      <div className="runway-lab-thumb-meta">
                        <span className="runway-lab-thumb-title">{test.title}</span>
                        <Chip variant={chip.variant}>{chip.label}</Chip>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="runway-lab-detail">
          {selected ? (
            <Card className="runway-lab-detail-card">
              <div className="recipes-item-title-row">
                <h2 className="runway-lab-detail-title">{selected.title}</h2>
                <Chip variant={reviewChip(selected).variant}>{reviewChip(selected).label}</Chip>
              </div>
              <p className="t-dim" style={{ marginTop: 0 }}>
                {formatDateTime(selected.createdAt)}
                {selected.libraryTitle ? ` · ref: ${selected.libraryTitle}` : ''}
                {selected.taskId ? ` · task ${selected.taskId}` : ''}
              </p>

              {selected.imageUrl ? (
                <div className="recipes-preview-frame runway-lab-frame">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={selected.imageUrl}
                    alt={selected.title}
                    referrerPolicy="no-referrer"
                  />
                </div>
              ) : (
                <p className="t-dim">
                  {selected.generationError || 'Generation did not return an image.'}
                </p>
              )}

              <label className="profile-field">
                <span className="profile-label">Prompt used</span>
                <pre className="runway-lab-prompt">{selected.promptText}</pre>
              </label>
              {selected.renderedPrompt && selected.renderedPrompt !== selected.promptText ? (
                <label className="profile-field">
                  <span className="profile-label">Rendered for Runway</span>
                  <pre className="runway-lab-prompt">{selected.renderedPrompt}</pre>
                </label>
              ) : null}

              {selected.reviewStatus === 'pending' && selected.generationStatus === 'succeeded' ? (
                <div className="runway-lab-review">
                  <label className="recipes-check">
                    <input
                      type="checkbox"
                      checked={saveAsRecipe}
                      onChange={(e) => setSaveAsRecipe(e.target.checked)}
                    />
                    Also save this prompt as a content recipe
                  </label>
                  <label className="profile-field" htmlFor="lab-reject-notes">
                    <span className="profile-label">Reject notes (optional)</span>
                    <input
                      id="lab-reject-notes"
                      className="auth-input"
                      value={rejectNotes}
                      onChange={(e) => setRejectNotes(e.target.value)}
                      placeholder="Too dark / wrong product / off-brand…"
                    />
                  </label>
                  <div className="recipes-form-actions">
                    <Button
                      variant="primary"
                      type="button"
                      disabled={actingId === selected.id}
                      onClick={() => void approve(selected)}
                    >
                      {actingId === selected.id ? 'Saving…' : 'Approve → library'}
                    </Button>
                    <Button
                      variant="ghost"
                      type="button"
                      disabled={actingId === selected.id}
                      onClick={() => void reject(selected)}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              ) : null}

              {selected.reviewStatus === 'approved' ? (
                <p className="t-dim" style={{ marginBottom: 12 }}>
                  Saved to the visual library
                  {selected.brandVisualId ? (
                    <>
                      {' '}
                      · <Link href="/visuals">Open visual library</Link>
                    </>
                  ) : null}
                  {selected.recipeId ? (
                    <>
                      {' '}
                      · <Link href="/runway?section=recipes">Open recipes</Link>
                    </>
                  ) : null}
                </p>
              ) : null}

              {selected.reviewNotes ? (
                <p className="t-dim">Notes: {selected.reviewNotes}</p>
              ) : null}

              <div className="recipes-form-actions">
                <Button variant="ghost" type="button" onClick={() => reusePrompt(selected)}>
                  Reuse prompt
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  disabled={actingId === selected.id}
                  onClick={() => void remove(selected)}
                >
                  Delete test
                </Button>
              </div>
            </Card>
          ) : (
            <Card>
              <p className="t-dim" style={{ margin: 0 }}>
                Select a test to review, or generate your first still above.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
