'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/hundres/button';
import { Card } from '@/components/hundres/card';
import { Chip } from '@/components/hundres/chip';
import { Icon } from '@/components/hundres/icon';
import {
  draftBusinessProfile,
  getBusinessProfile,
  updateBusinessProfile,
  type BusinessProfile,
} from '@/lib/business-profile';
import { useAuth } from '@/providers/auth-provider';

type FormState = {
  website: string;
  oneLiner: string;
  audience: string;
  offer: string;
  emulate: string;
  budget: string;
};

function profileToForm(profile: BusinessProfile): FormState {
  return {
    website: profile.website ?? '',
    oneLiner: profile.oneLiner ?? '',
    audience: profile.audience ?? '',
    offer: profile.offer ?? '',
    emulate: profile.emulate ?? '',
    budget: profile.budget ?? '',
  };
}

function Field({
  id,
  label,
  hint,
  value,
  onChange,
  placeholder,
  multiline,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  multiline?: boolean;
}) {
  const shared = {
    id,
    className: multiline ? 'profile-textarea auth-input' : 'auth-input',
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(e.target.value),
    placeholder,
  };

  return (
    <label className="profile-field" htmlFor={id}>
      <span className="profile-label">{label}</span>
      {hint ? <span className="profile-hint">{hint}</span> : null}
      {multiline ? <textarea {...shared} rows={4} /> : <input type="text" {...shared} />}
    </label>
  );
}

export function BusinessProfileView() {
  const { accessToken, activeOrganization } = useAuth();
  const [form, setForm] = useState<FormState>({
    website: '',
    oneLiner: '',
    audience: '',
    offer: '',
    emulate: '',
    budget: '',
  });
  const [complete, setComplete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [drafted, setDrafted] = useState(false);

  const load = useCallback(async () => {
    if (!accessToken || !activeOrganization) return;
    setLoading(true);
    setError(null);
    try {
      const { profile, complete: isComplete } = await getBusinessProfile(
        accessToken,
        activeOrganization.id
      );
      setForm(profileToForm(profile));
      setComplete(isComplete);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [accessToken, activeOrganization]);

  useEffect(() => {
    void load();
  }, [load]);

  const setField = (key: keyof FormState, value: string) => {
    setSaved(false);
    setDrafted(false);
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const writeWithAi = async () => {
    if (!accessToken || !activeOrganization) return;
    if (!form.website.trim()) {
      setError('Add a website URL first — AI uses it to draft your profile.');
      return;
    }
    setDrafting(true);
    setError(null);
    setSaved(false);
    setDrafted(false);
    try {
      const { draft } = await draftBusinessProfile(accessToken, activeOrganization.id, {
        website: form.website,
        current: {
          oneLiner: form.oneLiner,
          audience: form.audience,
          offer: form.offer,
          emulate: form.emulate,
          budget: form.budget,
        },
      });
      setForm((prev) => ({
        website: draft.website ?? prev.website,
        oneLiner: draft.oneLiner || prev.oneLiner,
        audience: draft.audience || prev.audience,
        offer: draft.offer || prev.offer,
        emulate: draft.emulate || prev.emulate,
        budget: draft.budget || prev.budget,
      }));
      setDrafted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI draft failed');
    } finally {
      setDrafting(false);
    }
  };

  const save = async () => {
    if (!accessToken || !activeOrganization) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const { profile, complete: isComplete } = await updateBusinessProfile(
        accessToken,
        activeOrganization.id,
        {
          website: form.website,
          oneLiner: form.oneLiner,
          audience: form.audience,
          offer: form.offer,
          emulate: form.emulate,
          budget: form.budget,
        }
      );
      setForm(profileToForm(profile));
      setComplete(isComplete);
      setSaved(true);
      setDrafted(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="profile-page">
      <div className="profile-header">
        <div>
          <div className="goal-eyebrow" style={{ justifyContent: 'flex-start', marginBottom: 12 }}>
            <Chip variant="accent">
              <Icon name="insights" style={{ width: 11, height: 11 }} />
              Workspace
            </Chip>
            {complete ? (
              <Chip variant="success">Ready for plans</Chip>
            ) : (
              <Chip variant="warn">Incomplete</Chip>
            )}
          </div>
          <h1 className="profile-title">Business profile</h1>
          <p className="profile-sub">
            Tell Hundres what you sell and who you serve. “Businesses to emulate” is for
            competitor/inspiration research. Image creatives live in the{' '}
            <Link href="/visuals" style={{ color: 'var(--accent-hover)' }}>
              Visual library
            </Link>
            ; prompt styles live in{' '}
            <Link href="/runway" style={{ color: 'var(--accent-hover)' }}>
              Runway
            </Link>
            .
          </p>
        </div>
        <div className="profile-actions">
          <Button variant="ghost" type="button" disabled={loading} onClick={() => void load()}>
            Refresh
          </Button>
          <Button
            variant="default"
            type="button"
            disabled={loading || drafting || saving}
            onClick={() => void writeWithAi()}
          >
            <Icon name="sparkle" style={{ width: 14, height: 14, marginRight: 6 }} />
            {drafting ? 'Writing…' : 'Write with AI'}
          </Button>
          <Button
            variant="primary"
            type="button"
            disabled={loading || saving || drafting}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save profile'}
          </Button>
        </div>
      </div>

      {error && (
        <Card style={{ marginBottom: 20, borderColor: 'var(--warn)' }}>
          <p style={{ margin: 0, color: 'var(--warn)' }}>{error}</p>
        </Card>
      )}

      {drafted && !error && (
        <Card style={{ marginBottom: 20 }}>
          <p className="t-dim" style={{ margin: 0, fontSize: 14 }}>
            AI draft filled in below — review the copy, edit anything off, then hit Save profile.
          </p>
        </Card>
      )}

      {saved && !error && (
        <Card style={{ marginBottom: 20 }}>
          <p className="t-dim" style={{ margin: 0, fontSize: 14 }}>
            Saved. New plans will use this context automatically.
          </p>
        </Card>
      )}

      <Card>
        {loading ? (
          <p className="t-dim">Loading…</p>
        ) : (
          <div className="profile-form">
            <Field
              id="website"
              label="Website"
              hint="Your main site or store URL — required for Write with AI"
              value={form.website}
              onChange={(v) => setField('website', v)}
              placeholder="https://yourbusiness.com"
            />
            <Field
              id="oneLiner"
              label="One-liner"
              hint="How you’d describe the business in one sentence"
              value={form.oneLiner}
              onChange={(v) => setField('oneLiner', v)}
              placeholder="Handmade sourdough bakery in Brooklyn focused on weekend walk-ins"
            />
            <Field
              id="audience"
              label="Audience"
              hint="Who you’re trying to reach"
              value={form.audience}
              onChange={(v) => setField('audience', v)}
              placeholder="Local families and foodies within 3 miles; tourists on Saturdays"
              multiline
            />
            <Field
              id="offer"
              label="Offer"
              hint="Products, services, pricing tier — what you sell"
              value={form.offer}
              onChange={(v) => setField('offer', v)}
              placeholder="Sourdough loaves, pastries, custom cakes; average ticket $18"
              multiline
            />
            <Field
              id="emulate"
              label="Businesses to emulate"
              hint="Brands or competitors you admire — used for directional market research in plans (positioning ideas, not your creatives). Separate from the Visual library."
              value={form.emulate}
              onChange={(v) => setField('emulate', v)}
              placeholder="e.g. Glossier, local competitor on Main St, https://example-brand.com"
              multiline
            />
            <Field
              id="budget"
              label="Marketing budget (optional)"
              hint="Rough monthly spend or range — helps paid media advice"
              value={form.budget}
              onChange={(v) => setField('budget', v)}
              placeholder="e.g. $500/month on Meta and Google combined"
            />
          </div>
        )}
      </Card>

      <p className="profile-footer t-dim">
        <Icon name="info" style={{ width: 12, height: 12, verticalAlign: -2, marginRight: 6 }} />
        Image creatives?{' '}
        <Link href="/visuals" style={{ color: 'var(--accent-hover)' }}>
          Visual library
        </Link>{' '}
        · Prompt styles?{' '}
        <Link href="/runway" style={{ color: 'var(--accent-hover)' }}>
          Runway
        </Link>{' '}
        · Need to connect data sources?{' '}
        <Link href="/integrations" style={{ color: 'var(--accent-hover)' }}>
          Integrations
        </Link>{' '}
        · Ready for a plan?{' '}
        <Link href="/new" style={{ color: 'var(--accent-hover)' }}>
          New strategy
        </Link>
      </p>
    </div>
  );
}
