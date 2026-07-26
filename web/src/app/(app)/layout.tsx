import { AppShell } from '@/components/layout/app-shell';
import { RequireOrganization } from '@/components/auth/require-organization';
import { StrategyGenerationProvider } from '@/providers/strategy-generation-provider';
import type { ReactNode } from 'react';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RequireOrganization>
      <StrategyGenerationProvider>
        <AppShell>{children}</AppShell>
      </StrategyGenerationProvider>
    </RequireOrganization>
  );
}
