'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { ConfigError } from '@/components/auth/config-error';
import { useAuth } from '@/providers/auth-provider';

export function RequireOrganization({ children }: { children: ReactNode }) {
  const { loading, organizations, configError, accessToken } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (loading || configError) return;

    if (!accessToken) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }

    if (organizations.length === 0 && pathname !== '/setup') {
      router.replace('/setup');
    }
    if (organizations.length > 0 && pathname === '/setup') {
      router.replace('/');
    }
  }, [loading, configError, accessToken, organizations.length, pathname, router]);

  if (configError) {
    return <ConfigError message={configError} />;
  }

  if (loading) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <p className="auth-sub">Loading…</p>
        </div>
      </div>
    );
  }

  if (!accessToken) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <p className="auth-sub">Checking session…</p>
        </div>
      </div>
    );
  }

  if (organizations.length === 0 && pathname !== '/setup') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <p className="auth-sub">Setting up workspace…</p>
        </div>
      </div>
    );
  }

  return children;
}
