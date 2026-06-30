import type { Metadata } from 'next';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import { DevTweaksPanel } from '@/components/dev/tweaks-panel';
import { AppPreferencesProvider } from '@/providers/app-preferences-provider';
import { AuthProvider } from '@/providers/auth-provider';
import { GoalProvider } from '@/providers/goal-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Hundres — Marketing AI Agent',
  description: 'Marketing AI agent for small businesses',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <AppPreferencesProvider>
          <AuthProvider>
            <GoalProvider>
              {children}
              <DevTweaksPanel />
            </GoalProvider>
          </AuthProvider>
        </AppPreferencesProvider>
      </body>
    </html>
  );
}
