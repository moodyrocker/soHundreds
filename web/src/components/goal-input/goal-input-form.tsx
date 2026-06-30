'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/hundres/button';
import { Chip } from '@/components/hundres/chip';
import { Icon } from '@/components/hundres/icon';
import { getBusinessProfile } from '@/lib/business-profile';
import { GOAL_HEADLINES, GOAL_SUBS } from '@/lib/copy';
import { goalExamples } from '@/lib/goal-examples';
import { useAppPreferences } from '@/providers/app-preferences-provider';
import { useAuth } from '@/providers/auth-provider';
import { useGoal } from '@/providers/goal-provider';
import { useStrategyGeneration } from '@/providers/strategy-generation-provider';

export function GoalInputForm() {
  const { tone } = useAppPreferences();
  const { accessToken, activeOrganization } = useAuth();
  const { goal, setGoal } = useGoal();
  const { startGeneration, isGenerating } = useStrategyGeneration();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [profileComplete, setProfileComplete] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadProfileStatus = useCallback(async () => {
    if (!accessToken || !activeOrganization) return;
    try {
      const { complete } = await getBusinessProfile(accessToken, activeOrganization.id);
      setProfileComplete(complete);
    } catch {
      setProfileComplete(null);
    }
  }, [accessToken, activeOrganization]);

  useEffect(() => {
    void loadProfileStatus();
  }, [loadProfileStatus]);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.max(110, ta.scrollHeight)}px`;
  }, [goal]);

  const submit = async () => {
    if (!goal.trim() || submitting || isGenerating) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      sessionStorage.setItem('hundres:goal', goal.trim());
      await startGeneration(goal.trim());
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not start plan');
    } finally {
      setSubmitting(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
  };

  const headline = GOAL_HEADLINES[tone];

  return (
    <div className="goal-page">
      <div className="goal-eyebrow">
        <Chip variant="accent">
          <Icon name="sparkle" style={{ width: 11, height: 11 }} />
          New strategy
        </Chip>
        <span className="t-mono" style={{ fontSize: 11, color: 'var(--text-mute)', letterSpacing: '0.04em' }}>
          YOUR GOAL
        </span>
      </div>

      <h1 className="goal-headline">
        {headline.before}
        <em>{headline.em}</em>
        {headline.after ?? ''}
      </h1>
      <p className="goal-sub">{GOAL_SUBS[tone]}</p>

      {profileComplete === false && (
        <div className="goal-profile-nudge">
          <Icon name="info" style={{ width: 14, height: 14, flexShrink: 0, opacity: 0.85 }} />
          <span>
            Add your{' '}
            <Link href="/business" className="goal-profile-link">
              business profile
            </Link>{' '}
            (website, offer, audience) so plans aren&apos;t generic — you only enter your goal here.
          </span>
        </div>
      )}

      <div className="goal-input-wrap">
        <textarea
          ref={taRef}
          className="goal-textarea"
          placeholder="e.g. I run a small bakery in Brooklyn and I want more weekend customers. We make sourdough and pastries, mostly walk-ins, and Saturdays are quiet…"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={onKey}
          autoFocus
        />
        <div className="goal-input-bar">
          <button className="goal-attach" type="button">
            <Icon name="paperclip" style={{ width: 13, height: 13 }} />
            Attach brand brief
          </button>
          <button className="goal-attach" type="button">
            <Icon name="mic" style={{ width: 13, height: 13 }} />
            Voice
          </button>
          <div style={{ flex: 1 }} />
          <span className="t-mono" style={{ fontSize: 10.5, color: 'var(--text-faint)', letterSpacing: '0.04em' }}>
            ⌘ + ↵ TO RUN
          </span>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={!goal.trim() || submitting || isGenerating}
            style={{ opacity: goal.trim() && !submitting ? 1 : 0.5 }}
          >
            {submitting ? 'Starting…' : 'Start autopilot'}
            <Icon name="arrow-right" style={{ width: 13, height: 13 }} />
          </Button>
        </div>
      </div>

      {submitError ? (
        <p className="auth-error" style={{ marginTop: 12 }}>
          {submitError}
        </p>
      ) : null}

      <div className="goal-examples">
        <div className="goal-examples-label">OR TRY ONE OF THESE</div>
        <div className="goal-chips">
          {goalExamples.map((ex) => (
            <button key={ex} className="goal-chip" type="button" onClick={() => setGoal(ex)}>
              {ex}
            </button>
          ))}
        </div>
      </div>

      <div className="goal-tip">
        <Icon name="info" style={{ width: 12, height: 12, verticalAlign: -2, marginRight: 4, opacity: 0.7 }} />
        Focus on your <em>goal</em> — Hundres runs weekly work until it&apos;s met. Business basics live in{' '}
        <Link href="/business" className="goal-profile-link">
          Business profile
        </Link>
        .
      </div>
    </div>
  );
}
