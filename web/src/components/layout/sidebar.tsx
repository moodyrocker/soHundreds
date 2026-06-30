'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/hundres/icon';
import { useAuth } from '@/providers/auth-provider';

const navItems = [
  { href: '/', label: 'Autopilot', icon: 'home' as const, kbd: 'H' },
  { href: '/new', label: 'New goal', icon: 'sparkle' as const, kbd: 'N' },
  { href: '/plan', label: 'Full plan', icon: 'plans' as const },
];

const secondaryItems: Array<
  | { href: string; label: string; icon: 'settings' | 'insights' | 'library' }
  | { label: string; icon: 'settings' | 'insights' | 'library' }
> = [
  { href: '/business', label: 'Business', icon: 'library' },
  { href: '/integrations', label: 'Connect', icon: 'settings' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
];

function userInitials(email?: string) {
  return email?.slice(0, 2).toUpperCase() ?? '?';
}

export function Sidebar() {
  const pathname = usePathname();
  const { user, activeOrganization, signOut } = useAuth();

  const displayName = user?.email?.split('@')[0] ?? 'User';

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">H</div>
        <div>
          <div className="brand-name">Hundres</div>
          <div className="brand-org">{activeOrganization?.name ?? 'No workspace'}</div>
        </div>
      </div>

      <div className="nav-section">
        <div className="nav-label">Menu</div>
        {navItems.map((item) => {
          const active = pathname === item.href || (item.href === '/plan' && pathname.startsWith('/plan'));
          return (
            <Link key={item.href} href={item.href} className={`nav-item${active ? ' active' : ''}`}>
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.kbd ? <span className="nav-kbd">{item.kbd}</span> : null}
            </Link>
          );
        })}
      </div>

      <div className="nav-section">
        <div className="nav-label">Setup</div>
        {secondaryItems.map((item) =>
          'href' in item ? (
            <Link
              key={item.label}
              href={item.href}
              className={`nav-item${pathname === item.href ? ' active' : ''}`}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </Link>
          ) : (
            <button key={item.label} className="nav-item" type="button" style={{ opacity: 0.5, cursor: 'default' }}>
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          )
        )}
      </div>

      <div className="sidebar-foot">
        <div className="avatar">{userInitials(user?.email)}</div>
        <div className="avatar-info">
          <div className="avatar-name">{displayName}</div>
          <div className="avatar-meta">{activeOrganization?.role ?? 'member'}</div>
        </div>
        <button className="icon-btn" type="button" title="Sign out" onClick={() => signOut()}>
          <Icon name="log-out" />
        </button>
      </div>
    </aside>
  );
}
