'use client';

import { Sidebar } from '@/components/layout/sidebar';
import { TopBar } from '@/components/layout/top-bar';
import { useAppPreferences } from '@/providers/app-preferences-provider';
import type { ReactNode } from 'react';

export function AppShell({ children }: { children: ReactNode }) {
  const { hideAids } = useAppPreferences();

  return (
    <div className={`app${hideAids ? ' hide-aids' : ''}`}>
      <Sidebar />
      <main className="main">
        <TopBar />
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
