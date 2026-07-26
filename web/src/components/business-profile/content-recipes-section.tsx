'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/hundres/button';
import { Card } from '@/components/hundres/card';
import { Chip } from '@/components/hundres/chip';
import { Icon } from '@/components/hundres/icon';
import {
  RUNWAY_CUSTOM_ENGINES,
  askPhraseForRecipe,
  buildUserRecipeConfig,
  createContentRecipe,
  deleteContentRecipe,
  draftRecipePrompt,
  engineIdFromRecipe,
  isOfficialRunwayRecipe,
  listContentRecipes,
  previewRecipePrompt,
  scoreRecipePrompt,
  updateContentRecipe,
  type ContentRecipe,
  type ContentRecipeInput,
  type ContentRecipeMedium,
  type RecipePromptPreview,
  type RunwayCustomEngineId,
} from '@/lib/content-recipes';
import { formatDateTime } from '@/lib/format-datetime';
import { useAuth } from '@/providers/auth-provider';

type FormState = {
  name: string;
  slug: string;
  description: string;
  engineId: RunwayCustomEngineId;
  channel: string;
  promptTemplate: string;
  styleNotes: string;
  negativePrompt: string;
  durationSeconds: string;
  isDefault: boolean;
};

type PanelState =
  | { kind: 'view'; recipe: ContentRecipe }
  | { kind: 'edit' }
  | { kind: 'create' };

type ContentRecipesSectionProps = {
  /** When true, omit page chrome (used inside Runway → Recipes tab). */
  embedded?: boolean;
};

const EMPTY_FORM: FormState = {
  name: '',
  slug: '',
  description: '',
  engineId: 'text_to_image',
  channel: 'instagram',
  promptTemplate: RUNWAY_CUSTOM_ENGINES[0].defaultPrompt,
  styleNotes: 'Natural light, shallow depth of field, premium aesthetic',
  negativePrompt: 'logos, text overlays, watermarks, wrong product, generic stock jar',
  durationSeconds: '',
  isDefault: false,
};

const WORKING_PREVIEW_LIMIT = 2;

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function recipeToForm(recipe: ContentRecipe): FormState {
  const engineId = engineIdFromRecipe(recipe);
  return {
    name: recipe.name,
    slug: recipe.slug,
    description: recipe.description ?? '',
    engineId,
    channel: recipe.channel ?? 'instagram',
    promptTemplate: recipe.promptTemplate,
    styleNotes: recipe.styleNotes ?? '',
    negativePrompt: recipe.negativePrompt ?? '',
    durationSeconds:
      recipe.durationSeconds != null ? String(recipe.durationSeconds) : '',
    isDefault: recipe.isDefault,
  };
}

function formToInput(form: FormState): ContentRecipeInput {
  const engine =
    RUNWAY_CUSTOM_ENGINES.find((e) => e.id === form.engineId) ?? RUNWAY_CUSTOM_ENGINES[0];
  const durationRaw = Number(form.durationSeconds);
  const durationSeconds =
    engine.medium === 'video' &&
    Number.isFinite(durationRaw) &&
    durationRaw >= 2 &&
    durationRaw <= 15
      ? Math.floor(durationRaw)
      : engine.defaultDuration;

  return {
    slug: slugify(form.slug || form.name),
    name: form.name.trim(),
    description: form.description.trim() || null,
    medium: engine.medium,
    provider: 'runway',
    channel: form.channel.trim() || 'instagram',
    promptTemplate: form.promptTemplate.trim(),
    styleNotes: form.styleNotes.trim() || null,
    negativePrompt: form.negativePrompt.trim() || null,
    durationSeconds,
    aspectRatio: engine.medium === 'video' ? '720:1280' : '1080:1920',
    model: engine.model,
    tags: ['custom', engine.medium, form.channel.trim() || 'instagram', engine.id].filter(
      Boolean
    ),
    isDefault: form.isDefault,
    isActive: true,
    config: buildUserRecipeConfig(form.engineId),
  };
}

function sortWorking(a: ContentRecipe, b: ContentRecipe): number {
  if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
  if (b.usageCount !== a.usageCount) return b.usageCount - a.usageCount;
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

function Field({
  id,
  label,
  hint,
  value,
  onChange,
  placeholder,
  multiline,
  rows = 4,
  expandable,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  expandable?: boolean;
}) {
  return (
    <label className="profile-field" htmlFor={id}>
      <span className="profile-label">{label}</span>
      {hint ? <span className="profile-hint">{hint}</span> : null}
      {multiline ? (
        <textarea
          id={id}
          className={
            expandable
              ? 'auth-input profile-textarea recipes-prompt-textarea'
              : 'auth-input profile-textarea'
          }
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <input
          id={id}
          className="auth-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
    </label>
  );
}

export function ContentRecipesSection({ embedded = false }: ContentRecipesSectionProps) {
  const { accessToken, activeOrganization } = useAuth();
  const [recipes, setRecipes] = useState<ContentRecipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draftingPrompt, setDraftingPrompt] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<RecipePromptPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [slugManual, setSlugManual] = useState(false);
  const [promptDrafted, setPromptDrafted] = useState(false);
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [expandedTypes, setExpandedTypes] = useState<Partial<Record<RunwayCustomEngineId, boolean>>>(
    {}
  );

  const load = useCallback(async () => {
    if (!accessToken || !activeOrganization) return;
    setLoading(true);
    setError(null);
    try {
      const { recipes: items } = await listContentRecipes(
        accessToken,
        activeOrganization.id,
        { activeOnly: false }
      );
      setRecipes(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load recipes');
    } finally {
      setLoading(false);
    }
  }, [accessToken, activeOrganization]);

  useEffect(() => {
    void load();
  }, [load]);

  const typeGroups = useMemo(() => {
    return RUNWAY_CUSTOM_ENGINES.map((engine) => {
      const forEngine = recipes.filter((r) => engineIdFromRecipe(r) === engine.id);
      const template = forEngine.find((r) => isOfficialRunwayRecipe(r)) ?? null;
      const working = forEngine.filter((r) => !isOfficialRunwayRecipe(r)).sort(sortWorking);
      return { engine, template, working };
    });
  }, [recipes]);

  const closePanel = useCallback(() => {
    setPanel(null);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setSlugManual(false);
    setPromptDrafted(false);
    setPreview(null);
  }, []);

  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePanel();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [panel, closePanel]);

  const openCreate = (engineId?: RunwayCustomEngineId) => {
    const engine =
      RUNWAY_CUSTOM_ENGINES.find((e) => e.id === engineId) ?? RUNWAY_CUSTOM_ENGINES[0];
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      engineId: engine.id,
      promptTemplate: engine.defaultPrompt,
      durationSeconds: engine.defaultDuration != null ? String(engine.defaultDuration) : '',
    });
    setSlugManual(false);
    setPromptDrafted(false);
    setPreview(null);
    setError(null);
    setPanel({ kind: 'create' });
  };

  const openView = (recipe: ContentRecipe) => {
    setError(null);
    setPanel({ kind: 'view', recipe });
  };

  const openEditForm = (recipe: ContentRecipe) => {
    setEditingId(recipe.id);
    setForm(recipeToForm(recipe));
    setSlugManual(true);
    setPromptDrafted(false);
    setPreview(null);
    setError(null);
    setPanel({ kind: 'edit' });
  };

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'name' && !slugManual && typeof value === 'string') {
        next.slug = slugify(value);
      }
      if (key === 'engineId' && typeof value === 'string') {
        const engine = RUNWAY_CUSTOM_ENGINES.find((e) => e.id === value);
        if (engine) {
          const prevEngine = RUNWAY_CUSTOM_ENGINES.find((e) => e.id === prev.engineId);
          if (
            !prev.promptTemplate.trim() ||
            prev.promptTemplate === prevEngine?.defaultPrompt
          ) {
            next.promptTemplate = engine.defaultPrompt;
          }
          next.durationSeconds =
            engine.defaultDuration != null ? String(engine.defaultDuration) : '';
        }
      }
      return next;
    });
    setPromptDrafted(false);
  };

  const isPromptOnlyEngine =
    form.engineId === 'text_to_image' || form.engineId === 'text_to_video';

  const writePromptWithAi = async (engineOverride?: 'text_to_image' | 'text_to_video') => {
    if (!accessToken || !activeOrganization) return;
    const engineId = engineOverride ?? form.engineId;
    if (engineId !== 'text_to_image' && engineId !== 'text_to_video') {
      setError('Write with AI is for text-to-image and text-to-video recipes.');
      return;
    }
    setDraftingPrompt(true);
    setError(null);
    setPromptDrafted(false);
    try {
      const formOpen = panel?.kind === 'edit' || panel?.kind === 'create';
      const startingPrompt =
        formOpen && form.engineId === engineId ? form.promptTemplate : undefined;
      const startingName = formOpen && form.engineId === engineId ? form.name : undefined;
      const startingDesc =
        formOpen && form.engineId === engineId ? form.description : undefined;

      if (!formOpen || form.engineId !== engineId) {
        setEditingId(null);
        setSlugManual(false);
        setForm({
          ...EMPTY_FORM,
          engineId,
          promptTemplate:
            RUNWAY_CUSTOM_ENGINES.find((e) => e.id === engineId)?.defaultPrompt ??
            EMPTY_FORM.promptTemplate,
          durationSeconds: engineId === 'text_to_video' ? '5' : '',
        });
        setPanel({ kind: 'create' });
      }

      const { draft } = await draftRecipePrompt(accessToken, activeOrganization.id, {
        engine: engineId,
        recipeName: startingName || undefined,
        concept: startingDesc || undefined,
        currentPrompt: startingPrompt || undefined,
      });
      setForm((prev) => ({
        ...prev,
        engineId,
        name: prev.name.trim() || draft.name,
        slug: prev.slug.trim() || slugify(draft.name),
        description: prev.description.trim() || draft.description,
        promptTemplate: draft.promptTemplate,
        styleNotes: draft.styleNotes,
        negativePrompt: draft.negativePrompt,
        durationSeconds:
          engineId === 'text_to_video' ? prev.durationSeconds || '5' : '',
      }));
      setPromptDrafted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI prompt draft failed');
    } finally {
      setDraftingPrompt(false);
    }
  };

  const generatePreview = async () => {
    if (!accessToken || !activeOrganization) return;
    if (!form.promptTemplate.trim()) {
      setError('Add a prompt before generating a preview.');
      return;
    }
    setPreviewing(true);
    setError(null);
    setPreview(null);
    try {
      const { preview: result } = await previewRecipePrompt(
        accessToken,
        activeOrganization.id,
        {
          promptTemplate: form.promptTemplate,
          styleNotes: form.styleNotes || null,
          negativePrompt: form.negativePrompt || null,
          recipeName: form.name || null,
          useLibraryReference: true,
        }
      );
      setPreview(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview generation failed');
    } finally {
      setPreviewing(false);
    }
  };

  const save = async () => {
    if (!accessToken || !activeOrganization) return;
    if (!form.name.trim() || !form.promptTemplate.trim()) {
      setError('Name and prompt are required.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const body = formToInput(form);
      if (editingId) {
        await updateContentRecipe(accessToken, activeOrganization.id, editingId, body);
      } else {
        await createContentRecipe(accessToken, activeOrganization.id, body);
      }
      closePanel();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save recipe');
    } finally {
      setSaving(false);
    }
  };

  const duplicateRecipe = async (
    recipe: ContentRecipe,
    opts?: { openEdit?: boolean }
  ): Promise<ContentRecipe | null> => {
    if (!accessToken || !activeOrganization) return null;
    setError(null);
    setSaving(true);
    try {
      const engineId = engineIdFromRecipe(recipe);
      const baseSlug = slugify(`${recipe.slug}-custom`);
      const body: ContentRecipeInput = {
        slug: baseSlug,
        name: `${recipe.name} (mine)`,
        description:
          recipe.description ??
          `Saved copy of ${recipe.name} — edit and reuse from Ask.`,
        medium: recipe.medium,
        provider: recipe.provider,
        channel: recipe.channel ?? 'instagram',
        promptTemplate: recipe.promptTemplate,
        styleNotes: recipe.styleNotes,
        negativePrompt: recipe.negativePrompt,
        durationSeconds: recipe.durationSeconds,
        aspectRatio: recipe.aspectRatio,
        model: recipe.model,
        tags: Array.from(new Set([...(recipe.tags ?? []), 'custom', 'saved'])),
        isDefault: false,
        isActive: true,
        config: buildUserRecipeConfig(engineId),
      };
      const { recipe: created } = await createContentRecipe(
        accessToken,
        activeOrganization.id,
        body
      );
      setCopiedId(recipe.id);
      window.setTimeout(() => setCopiedId(null), 2000);
      await load();
      if (opts?.openEdit) {
        openEditForm(created);
      }
      return created;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to copy recipe');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (recipe: ContentRecipe) => {
    if (isOfficialRunwayRecipe(recipe)) {
      void duplicateRecipe(recipe, { openEdit: true });
      return;
    }
    openEditForm(recipe);
  };

  const copyRecipe = (recipe: ContentRecipe) => {
    void duplicateRecipe(recipe, { openEdit: false });
  };

  const remove = async (recipe: ContentRecipe) => {
    if (!accessToken || !activeOrganization) return;
    if (!window.confirm(`Delete “${recipe.name}”? The agent won’t use it anymore.`)) return;
    setError(null);
    try {
      await deleteContentRecipe(accessToken, activeOrganization.id, recipe.id);
      if (editingId === recipe.id || (panel?.kind === 'view' && panel.recipe.id === recipe.id)) {
        closePanel();
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete recipe');
    }
  };

  const copyAskPhrase = async (recipe: ContentRecipe) => {
    const phrase = askPhraseForRecipe(recipe);
    try {
      await navigator.clipboard.writeText(phrase);
      setCopiedId(`ask-${recipe.id}`);
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setError(`Copy failed — Ask with: ${phrase}`);
    }
  };

  const selectedEngine =
    RUNWAY_CUSTOM_ENGINES.find((e) => e.id === form.engineId) ?? RUNWAY_CUSTOM_ENGINES[0];

  const renderCompactCard = (recipe: ContentRecipe, role: 'template' | 'working') => {
    const quality = scoreRecipePrompt(recipe);
    const isTemplate = role === 'template';
    return (
      <li key={recipe.id} className="recipes-compact-card">
        <div className="recipes-compact-main">
          <div className="recipes-item-title-row">
            <span className="recipes-item-name">{recipe.name}</span>
            {isTemplate ? (
              <Chip variant="accent">Template</Chip>
            ) : (
              <Chip variant="success">Working</Chip>
            )}
            {recipe.isDefault ? <Chip variant="success">Default</Chip> : null}
            {!recipe.isActive ? <Chip variant="warn">Off</Chip> : null}
            <Chip
              className={`chip-quality chip-quality-${quality.tone}`}
              title={`Prompt confidence ${quality.score}/100`}
            >
              <span className="chip-quality-dot" aria-hidden />
              {quality.label}
            </Chip>
          </div>
          <p className="recipes-item-meta">
            <code>{recipe.slug}</code>
            {recipe.usageCount > 0 ? ` · ${recipe.usageCount}× run` : ''}
            {' · '}
            {formatDateTime(recipe.updatedAt)}
          </p>
          <p className={`recipes-item-preview recipes-prompt-tone-${quality.tone}`}>
            {recipe.promptTemplate.slice(0, 100)}
            {recipe.promptTemplate.length > 100 ? '…' : ''}
          </p>
        </div>
        <div className="recipes-item-actions">
          <Button variant="ghost" type="button" onClick={() => openView(recipe)}>
            View
          </Button>
          <Button
            variant="ghost"
            type="button"
            disabled={saving || draftingPrompt}
            onClick={() => openEdit(recipe)}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            type="button"
            disabled={saving}
            onClick={() => copyRecipe(recipe)}
          >
            {copiedId === recipe.id ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </li>
    );
  };

  const panelOpen = panel != null;
  const panelTitle =
    panel?.kind === 'view'
      ? panel.recipe.name
      : panel?.kind === 'edit'
        ? 'Edit recipe'
        : panel?.kind === 'create'
          ? 'New recipe'
          : '';

  const recipeCount = recipes.filter((r) => !isOfficialRunwayRecipe(r)).length;

  return (
    <div className={embedded ? 'runway-section recipes-page' : 'profile-page profile-page--wide recipes-page'}>
      <div className="profile-header">
        <div>
          {embedded ? (
            <>
              <div className="goal-eyebrow" style={{ justifyContent: 'flex-start', marginBottom: 8 }}>
                {!loading ? (
                  <Chip variant="accent">
                    {recipeCount} working · {RUNWAY_CUSTOM_ENGINES.length} types
                  </Chip>
                ) : null}
              </div>
              <h2 className="runway-section-title">Recipes</h2>
              <p className="profile-sub">
                Templates are official starters. Working recipes are yours — edit in the side panel,
                then reuse in Ask with <code>use recipe your-slug</code>. Product stills live in the{' '}
                <Link href="/visuals" style={{ color: 'var(--accent-hover)' }}>
                  Visual library
                </Link>
                .
              </p>
            </>
          ) : (
            <>
              <div className="goal-eyebrow" style={{ justifyContent: 'flex-start', marginBottom: 12 }}>
                <Chip variant="accent">
                  <Icon name="plans" style={{ width: 11, height: 11 }} />
                  Creatives
                </Chip>
                {!loading ? (
                  <Chip variant="accent">
                    {recipeCount} working · {RUNWAY_CUSTOM_ENGINES.length} types
                  </Chip>
                ) : null}
              </div>
              <h1 className="profile-title">Recipes</h1>
              <p className="profile-sub">
                Templates are official starters. Working recipes are yours — edit in the side panel,
                then reuse in Ask with <code>use recipe your-slug</code>. Product stills live in the{' '}
                <Link href="/visuals" style={{ color: 'var(--accent-hover)' }}>
                  Visual library
                </Link>
                .
              </p>
            </>
          )}
        </div>
        <div className="profile-actions">
          <Button variant="ghost" type="button" disabled={loading} onClick={() => void load()}>
            Refresh
          </Button>
          <Button variant="primary" type="button" onClick={() => openCreate()}>
            New recipe
          </Button>
        </div>
      </div>

      {error && !panelOpen ? (
        <Card style={{ marginBottom: 16, borderColor: 'var(--warn)' }}>
          <p style={{ margin: 0, color: 'var(--warn)' }}>{error}</p>
        </Card>
      ) : null}

      <Card>
        {loading ? (
          <p className="t-dim">Loading recipes…</p>
        ) : (
          <div className="recipes-type-list">
            {typeGroups.map(({ engine, template, working }) => {
              const expanded = Boolean(expandedTypes[engine.id]);
              const visibleWorking = expanded
                ? working
                : working.slice(0, WORKING_PREVIEW_LIMIT);
              const hiddenCount = working.length - visibleWorking.length;

              return (
                <div key={engine.id} className="recipes-type-block">
                  <div className="recipes-type-header">
                    <div>
                      <h3 className="recipes-type-title">{engine.label}</h3>
                      <p className="recipes-type-meta">
                        {engine.medium}
                        {' · '}
                        <a href={engine.docsUrl} target="_blank" rel="noreferrer">
                          docs
                        </a>
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={() => openCreate(engine.id)}
                    >
                      New for this type
                    </Button>
                  </div>

                  <div className="recipes-type-columns">
                    <div className="recipes-type-col">
                      <div className="recipes-group-label">Template</div>
                      {template ? (
                        <ul className="recipes-list recipes-list-compact">
                          {renderCompactCard(template, 'template')}
                        </ul>
                      ) : (
                        <p className="recipes-type-empty">No template seeded yet.</p>
                      )}
                    </div>

                    <div className="recipes-type-col">
                      <div className="recipes-group-label">
                        Working
                        {working.length > 0 ? ` · ${working.length}` : ''}
                      </div>
                      {working.length === 0 ? (
                        <div className="recipes-type-empty">
                          <p style={{ margin: 0 }}>None yet — copy the template or create one.</p>
                          {template ? (
                            <Button
                              variant="ghost"
                              type="button"
                              disabled={saving}
                              onClick={() => copyRecipe(template)}
                            >
                              Copy template
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              type="button"
                              onClick={() => openCreate(engine.id)}
                            >
                              Create
                            </Button>
                          )}
                        </div>
                      ) : (
                        <>
                          <ul className="recipes-list recipes-list-compact">
                            {visibleWorking.map((r) => renderCompactCard(r, 'working'))}
                          </ul>
                          {hiddenCount > 0 ? (
                            <Button
                              variant="ghost"
                              type="button"
                              className="recipes-show-more"
                              onClick={() =>
                                setExpandedTypes((prev) => ({
                                  ...prev,
                                  [engine.id]: true,
                                }))
                              }
                            >
                              Show {hiddenCount} more
                            </Button>
                          ) : null}
                          {expanded && working.length > WORKING_PREVIEW_LIMIT ? (
                            <Button
                              variant="ghost"
                              type="button"
                              className="recipes-show-more"
                              onClick={() =>
                                setExpandedTypes((prev) => ({
                                  ...prev,
                                  [engine.id]: false,
                                }))
                              }
                            >
                              Show less
                            </Button>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="recipes-placeholders-card">
        <div className="recipes-group-label" style={{ marginBottom: 8 }}>
          Prompt placeholders
        </div>
        <p className="recipes-sub" style={{ marginBottom: 12, maxWidth: 'none' }}>
          Leave these as written in your prompt — Hundres fills them when the recipe runs.
          For stills that use the visual library, also include <code>@product</code> so Runway
          matches the real packaging photo.
        </p>
        <dl className="recipes-placeholders">
          <div>
            <dt>
              <code>@product</code>
            </dt>
            <dd>
              Visual library product photo (Runway reference). Required for packaging match on
              text-to-image.
            </dd>
          </div>
          <div>
            <dt>
              <code>{'{{brand}}'}</code>
            </dt>
            <dd>Business one-liner (or offer if one-liner is empty)</dd>
          </div>
          <div>
            <dt>
              <code>{'{{product}}'}</code>
            </dt>
            <dd>Product name text from Ask, or the first part of your offer (pairs with @product)</dd>
          </div>
          <div>
            <dt>
              <code>{'{{audience}}'}</code>
            </dt>
            <dd>Audience from Business profile</dd>
          </div>
          <div>
            <dt>
              <code>{'{{offer}}'}</code>
            </dt>
            <dd>Offer / products from Business profile</dd>
          </div>
          <div>
            <dt>
              <code>{'{{vibe}}'}</code>
            </dt>
            <dd>Mood from the Ask brief (or a default like “clean lifestyle”)</dd>
          </div>
          <div>
            <dt>
              <code>{'{{brief}}'}</code>
            </dt>
            <dd>Full Ask request / creative brief for this run</dd>
          </div>
        </dl>
        <p className="recipes-footer t-dim" style={{ marginTop: 12, marginBottom: 0 }}>
          <Icon name="info" style={{ width: 12, height: 12, verticalAlign: -2, marginRight: 6 }} />
          In Ask, say <code>use recipe your-slug</code> to force a saved style.
        </p>
      </Card>

      {panelOpen ? (
        <div className="action-drawer-root recipes-drawer-root" role="presentation">
          <button
            type="button"
            className="action-drawer-backdrop"
            aria-label="Close panel"
            onClick={closePanel}
          />
          <aside
            className="action-drawer-panel recipes-drawer-panel"
            role="dialog"
            aria-modal
            aria-labelledby="recipes-drawer-title"
          >
            <header className="action-drawer-header">
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 id="recipes-drawer-title" className="h-lg" style={{ margin: 0, lineHeight: 1.3 }}>
                  {panelTitle}
                </h2>
                {panel?.kind === 'view' ? (
                  <p className="recipes-item-meta" style={{ marginTop: 6 }}>
                    <code>{panel.recipe.slug}</code>
                    {' · '}
                    {isOfficialRunwayRecipe(panel.recipe) ? 'Template' : 'Working'}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                className="btn btn-ghost action-drawer-close"
                onClick={closePanel}
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

              {panel?.kind === 'view' ? (
                (() => {
                  const recipe = panel.recipe;
                  const quality = scoreRecipePrompt(recipe);
                  const official = isOfficialRunwayRecipe(recipe);
                  return (
                    <>
                      <div className="recipes-item-title-row" style={{ marginBottom: 12 }}>
                        {official ? (
                          <Chip variant="accent">Template</Chip>
                        ) : (
                          <Chip variant="success">Working</Chip>
                        )}
                        <Chip variant={recipe.usageCount > 0 ? 'accent' : 'warn'}>
                          {recipe.usageCount}× run
                        </Chip>
                        <Chip
                          className={`chip-quality chip-quality-${quality.tone}`}
                          title={`Prompt confidence ${quality.score}/100`}
                        >
                          <span className="chip-quality-dot" aria-hidden />
                          {quality.label} · {quality.score}
                        </Chip>
                      </div>
                      <p className="recipes-item-meta">
                        created {formatDateTime(recipe.createdAt)}
                        {recipe.lastUsedAt
                          ? ` · last run ${formatDateTime(recipe.lastUsedAt)}`
                          : ''}
                      </p>
                      {recipe.description ? (
                        <p className="recipes-sub" style={{ marginBottom: 12, maxWidth: 'none' }}>
                          {recipe.description}
                        </p>
                      ) : null}
                      <div className="profile-field">
                        <span className="profile-label">Prompt</span>
                        <pre
                          className={`recipes-view-prompt recipes-prompt-tone-${quality.tone}`}
                        >
                          {recipe.promptTemplate}
                        </pre>
                      </div>
                      {recipe.styleNotes ? (
                        <p className="recipes-item-meta">
                          <strong>Style:</strong> {recipe.styleNotes}
                        </p>
                      ) : null}
                      {recipe.negativePrompt ? (
                        <p className="recipes-item-meta">
                          <strong>Avoid:</strong> {recipe.negativePrompt}
                        </p>
                      ) : null}
                      {!official ? (
                        <p className="recipes-item-ask" style={{ marginTop: 12 }}>
                          Ask: <code>{askPhraseForRecipe(recipe)}</code>
                        </p>
                      ) : null}
                      <div className="recipes-form-actions" style={{ marginTop: 20 }}>
                        <Button
                          variant="primary"
                          type="button"
                          disabled={saving}
                          onClick={() => openEdit(recipe)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="default"
                          type="button"
                          disabled={saving}
                          onClick={() => copyRecipe(recipe)}
                        >
                          {copiedId === recipe.id ? 'Copied' : 'Copy'}
                        </Button>
                        {!official ? (
                          <Button
                            variant="ghost"
                            type="button"
                            onClick={() => void copyAskPhrase(recipe)}
                          >
                            {copiedId === `ask-${recipe.id}` ? 'Ask copied' : 'Copy ask'}
                          </Button>
                        ) : null}
                        {!official ? (
                          <Button
                            variant="ghost"
                            type="button"
                            onClick={() => void remove(recipe)}
                          >
                            Delete
                          </Button>
                        ) : null}
                      </div>
                    </>
                  );
                })()
              ) : null}

              {panel?.kind === 'edit' || panel?.kind === 'create' ? (
                <div className="profile-form">
                  <Field
                    id="recipe-name"
                    label="Name"
                    hint="What you’ll recognize this style as later"
                    value={form.name}
                    onChange={(v) => setField('name', v)}
                    placeholder="Cream of Dreams marble still"
                  />
                  <Field
                    id="recipe-slug"
                    label="Short key"
                    hint='Reference later with: use recipe this-key'
                    value={form.slug}
                    onChange={(v) => {
                      setSlugManual(true);
                      setField('slug', slugify(v));
                    }}
                    placeholder="cream-of-dreams-marble"
                  />
                  <Field
                    id="recipe-description"
                    label="Notes"
                    hint="Optional — when to use this recipe"
                    value={form.description}
                    onChange={(v) => setField('description', v)}
                    placeholder="Quiet bathroom stills for feed posts"
                    multiline
                    rows={2}
                  />

                  <div className="recipes-row">
                    <label className="profile-field" htmlFor="recipe-engine">
                      <span className="profile-label">Runway engine</span>
                      <span className="profile-hint">What this recipe actually calls</span>
                      <select
                        id="recipe-engine"
                        className="auth-input"
                        value={form.engineId}
                        onChange={(e) =>
                          setField('engineId', e.target.value as RunwayCustomEngineId)
                        }
                      >
                        {RUNWAY_CUSTOM_ENGINES.map((engine) => (
                          <option key={engine.id} value={engine.id}>
                            {engine.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="profile-field" htmlFor="recipe-duration">
                      <span className="profile-label">Length</span>
                      <select
                        id="recipe-duration"
                        className="auth-input"
                        value={form.durationSeconds}
                        onChange={(e) => setField('durationSeconds', e.target.value)}
                        disabled={selectedEngine.medium !== 'video'}
                      >
                        <option value="4">4 seconds</option>
                        <option value="5">5 seconds</option>
                        <option value="8">8 seconds</option>
                        <option value="10">10 seconds</option>
                        <option value="15">15 seconds</option>
                        <option value="">Not set</option>
                      </select>
                    </label>
                    <label className="profile-field" htmlFor="recipe-channel">
                      <span className="profile-label">Channel</span>
                      <input
                        id="recipe-channel"
                        className="auth-input"
                        value={form.channel}
                        onChange={(e) => setField('channel', e.target.value)}
                        placeholder="instagram"
                      />
                    </label>
                  </div>

                  <p className="t-dim" style={{ fontSize: 12, margin: '0 0 8px' }}>
                    Type: <strong>{selectedEngine.medium}</strong>
                    {' · '}
                    <a href={selectedEngine.docsUrl} target="_blank" rel="noreferrer">
                      engine docs
                    </a>
                  </p>

                  {promptDrafted ? (
                    <p className="t-dim" style={{ fontSize: 13, margin: '0 0 12px' }}>
                      AI drafted the prompt from your Business profile — edit anything off, then
                      save.
                    </p>
                  ) : null}

                  <div className="recipes-form-actions" style={{ marginBottom: 12 }}>
                    {isPromptOnlyEngine ? (
                      <Button
                        variant="default"
                        type="button"
                        disabled={draftingPrompt || saving}
                        onClick={() => void writePromptWithAi()}
                      >
                        <Icon name="sparkle" style={{ width: 14, height: 14, marginRight: 6 }} />
                        {draftingPrompt ? 'Writing prompt…' : 'Write prompt with AI'}
                      </Button>
                    ) : (
                      <p className="t-dim" style={{ fontSize: 12, margin: 0 }}>
                        AI prompt drafting is for text-to-image / text-to-video. Product recipes use
                        your visual library photos instead.
                      </p>
                    )}
                  </div>

                  <Field
                    id="recipe-prompt"
                    label="Prompt"
                    hint="Use @product for the library photo, plus placeholders like {{brand}}, {{vibe}}"
                    value={form.promptTemplate}
                    onChange={(v) => setField('promptTemplate', v)}
                    placeholder="Photorealistic vertical…"
                    multiline
                    rows={14}
                    expandable
                  />
                  <Field
                    id="recipe-style"
                    label="Style notes"
                    hint="Look and feel extras"
                    value={form.styleNotes}
                    onChange={(v) => setField('styleNotes', v)}
                    placeholder="Soft daylight, shallow DOF, premium"
                    multiline
                    rows={3}
                  />
                  <Field
                    id="recipe-avoid"
                    label="Avoid"
                    hint="Things the generator should not include"
                    value={form.negativePrompt}
                    onChange={(v) => setField('negativePrompt', v)}
                    placeholder="logos, text, watermarks"
                    multiline
                    rows={2}
                  />

                  <label className="recipes-check" htmlFor="recipe-default">
                    <input
                      id="recipe-default"
                      type="checkbox"
                      checked={form.isDefault}
                      onChange={(e) => setField('isDefault', e.target.checked)}
                    />
                    <span>Use as default for this type ({selectedEngine.medium})</span>
                  </label>

                  <div className="recipes-form-actions">
                    <Button
                      variant="primary"
                      type="button"
                      disabled={saving || draftingPrompt || previewing}
                      onClick={() => void save()}
                    >
                      {saving ? 'Saving…' : editingId ? 'Save changes' : 'Save recipe'}
                    </Button>
                    <Button
                      variant="default"
                      type="button"
                      disabled={
                        saving || draftingPrompt || previewing || !form.promptTemplate.trim()
                      }
                      onClick={() => void generatePreview()}
                    >
                      <Icon name="sparkle" style={{ width: 14, height: 14, marginRight: 6 }} />
                      {previewing ? 'Generating preview…' : 'Generate AI preview'}
                    </Button>
                    {editingId ? (
                      <Button
                        variant="ghost"
                        type="button"
                        onClick={() => {
                          const current = recipes.find((r) => r.id === editingId);
                          if (current) void remove(current);
                        }}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </div>

                  {form.slug ? (
                    <p className="t-dim" style={{ fontSize: 12, marginTop: 12 }}>
                      Later:{' '}
                      <code>
                        {askPhraseForRecipe({
                          slug: form.slug,
                          medium: selectedEngine.medium as ContentRecipeMedium,
                        })}
                      </code>
                    </p>
                  ) : null}

                  {preview ? (
                    <div className="recipes-preview">
                      <div className="recipes-preview-meta">
                        <span className="profile-label">Runway still preview</span>
                        <span className="profile-hint">
                          Low-credit text-to-image test of this prompt
                          {preview.libraryTitle
                            ? ` · library product: ${preview.libraryTitle}`
                            : ' · add a product image in Visual library for on-brand refs'}
                        </span>
                      </div>
                      <div className="recipes-preview-frame">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={preview.imageUrl}
                          alt="Recipe prompt preview"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                      <p className="recipes-item-meta" style={{ marginTop: 8 }}>
                        <a href={preview.imageUrl} target="_blank" rel="noreferrer">
                          Open image
                        </a>
                        {preview.taskId ? ` · task ${preview.taskId}` : ''}
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
