'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { ContentRecipesSection } from '@/components/business-profile/content-recipes-section';
import { Chip } from '@/components/hundres/chip';
import { Icon } from '@/components/hundres/icon';
import { RunwayLabView } from '@/components/runway/runway-lab-view';

export type RunwaySection = 'recipes' | 'lab';

const SECTIONS: Array<{ id: RunwaySection; label: string; hint: string }> = [
  { id: 'recipes', label: 'Recipes', hint: 'Saved prompt templates' },
  { id: 'lab', label: 'Lab', hint: 'Test & approve stills' },
];

function parseSection(raw: string | null): RunwaySection {
  return raw === 'lab' ? 'lab' : 'recipes';
}

export function RunwayView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const section = parseSection(searchParams.get('section'));

  const setSection = useCallback(
    (next: RunwaySection) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === 'recipes') params.delete('section');
      else params.set('section', next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  return (
    <div className="profile-page profile-page--wide runway-page">
      <div className="profile-header">
        <div>
          <div className="goal-eyebrow" style={{ justifyContent: 'flex-start', marginBottom: 12 }}>
            <Chip variant="accent">
              <Icon name="sparkle" style={{ width: 11, height: 11 }} />
              Runway
            </Chip>
          </div>
          <h1 className="profile-title">Runway</h1>
          <p className="profile-sub">
            Saved prompt recipes and a testing lab for Runway stills. Approve winners into the{' '}
            <Link href="/visuals" style={{ color: 'var(--accent-hover)' }}>
              visual library
            </Link>
            .
          </p>
        </div>
        <div className="profile-actions">
          <Link href="/integrations" className="btn btn-ghost">
            Connection
          </Link>
        </div>
      </div>

      <div className="runway-section-tabs" role="tablist" aria-label="Runway sections">
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={section === item.id}
            className={`runway-section-tab${section === item.id ? ' active' : ''}`}
            onClick={() => setSection(item.id)}
          >
            <span className="runway-section-tab-label">{item.label}</span>
            <span className="runway-section-tab-hint">{item.hint}</span>
          </button>
        ))}
      </div>

      {section === 'recipes' ? (
        <ContentRecipesSection embedded />
      ) : (
        <RunwayLabView embedded />
      )}
    </div>
  );
}
