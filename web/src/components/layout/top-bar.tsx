'use client';

import { usePathname } from 'next/navigation';
import { Icon } from '@/components/hundres/icon';
import { GenerationBanner } from '@/components/layout/generation-banner';
import { useAuth } from '@/providers/auth-provider';

const PAGE_LABELS: Record<string, string> = {
  '/': 'Home',
  '/new': 'New plan',
  '/thinking': 'Generating…',
  '/plan': 'Control room',
  '/integrations': 'Integrations',
  '/business': 'Business profile',
  '/visuals': 'Visual library',
  '/runway': 'Runway',
  '/recipes': 'Runway',
  '/ads': 'Ad campaigns',
  '/checkup': 'Check-up',
  '/settings': 'Settings',
  '/setup': 'Setup',
};

export function TopBar() {
  const pathname = usePathname();
  const { activeOrganization } = useAuth();
  const orgName = activeOrganization?.name ?? 'Workspace';
  const page = PAGE_LABELS[pathname] ?? 'Hundres';

  const crumb = ['Hundres', orgName, page];

  return (
    <div className="topbar">
      <div className="crumb">
        {crumb.map((c, i) => (
          <span key={`${c}-${i}`} style={{ display: 'contents' }}>
            {i > 0 && <span className="sep">/</span>}
            <span className={i === crumb.length - 1 ? 'current' : i === 1 ? 'crumb-mid' : ''}>{c}</span>
          </span>
        ))}
      </div>
      <GenerationBanner />
      <div className="topbar-spacer" />
      <div className="search-pill">
        <Icon name="search" style={{ width: 13, height: 13 }} />
        <span>Search plans, actions, drafts</span>
        <span className="kbd">⌘K</span>
      </div>
      <button className="icon-btn" type="button" title="Notifications">
        <Icon name="bell" />
      </button>
      <button className="icon-btn" type="button" title="Help">
        <Icon name="help" />
      </button>
    </div>
  );
}
