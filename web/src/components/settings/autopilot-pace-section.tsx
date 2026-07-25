'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/hundres/button';
import { Card } from '@/components/hundres/card';
import { Chip } from '@/components/hundres/chip';
import {
  getBusinessProfile,
  updateBusinessProfile,
  type AutopilotPace,
  type PaceProfile,
} from '@/lib/business-profile';
import { useAuth } from '@/providers/auth-provider';

const PACE_OPTIONS: Array<{
  id: AutopilotPace;
  label: string;
  blurb: string;
}> = [
  {
    id: 'normal',
    label: 'Normal',
    blurb: '3–5 actions/week · ~60m cycles · steady SEO & IG',
  },
  {
    id: 'high',
    label: 'High',
    blurb: '5–8 actions/week · ~30m cycles · up to 1 IG/day',
  },
  {
    id: 'intense',
    label: 'Intense',
    blurb: '6–10 actions/week · ~15m cycles · daily IG · 2 SEO/day (14-day settle)',
  },
];

export function AutopilotPaceSection() {
  const { accessToken, activeOrganization } = useAuth();
  const [pace, setPace] = useState<AutopilotPace>('normal');
  const [profile, setProfile] = useState<PaceProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken || !activeOrganization?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getBusinessProfile(accessToken, activeOrganization.id);
      setPace(res.autopilotPace ?? 'normal');
      setProfile(res.paceProfile ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pace');
    } finally {
      setLoading(false);
    }
  }, [accessToken, activeOrganization?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSelect = async (next: AutopilotPace) => {
    if (!accessToken || !activeOrganization?.id || next === pace) return;
    setSaving(true);
    setError(null);
    try {
      const res = await updateBusinessProfile(accessToken, activeOrganization.id, {
        autopilotPace: next,
      });
      setPace(res.autopilotPace ?? next);
      setProfile(res.paceProfile ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save pace');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card style={{ marginBottom: 24 }}>
      <div className="h-eyebrow" style={{ marginBottom: 12 }}>
        Autopilot pace
      </div>
      <p className="t-dim" style={{ margin: '0 0 16px', fontSize: 14, lineHeight: 1.55, maxWidth: 560 }}>
        How hard the agent pushes toward your goal. Intense is aggressive but spam-safe: same
        product or page SEO waits <strong>14 days</strong> to settle before another change.
      </p>

      {loading ? (
        <p className="auth-hint" style={{ margin: 0 }}>
          Loading…
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {PACE_OPTIONS.map((opt) => {
            const active = pace === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                disabled={saving}
                onClick={() => void onSelect(opt.id)}
                style={{
                  textAlign: 'left',
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: active ? '1px solid var(--accent, #888)' : '1px solid var(--border)',
                  background: active ? 'rgba(255,255,255,0.04)' : 'transparent',
                  color: 'var(--text)',
                  cursor: saving ? 'wait' : 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span style={{ fontSize: 14, fontWeight: 560 }}>{opt.label}</span>
                  {active ? <Chip variant="success">Active</Chip> : null}
                </div>
                <div className="t-dim" style={{ fontSize: 13, lineHeight: 1.45 }}>
                  {opt.blurb}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {profile && !loading ? (
        <p className="auth-hint" style={{ marginTop: 14, fontSize: 12, lineHeight: 1.5 }}>
          Live caps · IG feed {profile.instagramFeedPerDay}/day · SEO {profile.productSeoPerDay}/day ·
          pages/blog {profile.shopifyContentPerDay}/day · Reels {profile.instagramReelPerWeek}/week ·
          SEO cooldown {profile.seoCooldownDays} days · cycle every {profile.cycleMinutes}m
        </p>
      ) : null}

      {error ? (
        <p className="auth-error" style={{ marginTop: 10, fontSize: 12 }}>
          {error}
        </p>
      ) : null}

      {saving ? (
        <p className="auth-hint" style={{ marginTop: 8, fontSize: 12 }}>
          Saving…
        </p>
      ) : null}

      {!loading && pace === 'intense' ? (
        <p className="t-dim" style={{ marginTop: 12, fontSize: 13, lineHeight: 1.5 }}>
          Intense is a good month-long push. Paid Meta still never auto-spends; Mailchimp stays draft-only.
        </p>
      ) : null}

      <div style={{ marginTop: 12 }}>
        <Button variant="ghost" type="button" disabled={loading || saving} onClick={() => void load()}>
          Refresh
        </Button>
      </div>
    </Card>
  );
}
