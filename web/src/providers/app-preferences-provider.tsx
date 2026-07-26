'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Tone } from '@/lib/channels';

export type ThemeId = 'ink' | 'paper' | 'lime';
export type DensityId = 'cozy' | 'comfortable' | 'spacious';

interface AppPreferences {
  theme: ThemeId;
  density: DensityId;
  tone: Tone;
  hideAids: boolean;
}

interface AppPreferencesContextValue extends AppPreferences {
  setTheme: (theme: ThemeId) => void;
  setDensity: (density: DensityId) => void;
  setTone: (tone: Tone) => void;
  setHideAids: (hide: boolean) => void;
}

const defaults: AppPreferences = {
  theme: 'ink',
  density: 'comfortable',
  tone: 'expert',
  hideAids: false,
};

const AppPreferencesContext = createContext<AppPreferencesContextValue | null>(null);

export function AppPreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<AppPreferences>(defaults);

  useEffect(() => {
    const el = document.documentElement;
    if (prefs.theme === 'ink') {
      el.removeAttribute('data-theme');
    } else {
      el.setAttribute('data-theme', prefs.theme);
    }
    el.setAttribute('data-density', prefs.density);
  }, [prefs.theme, prefs.density]);

  const value = useMemo<AppPreferencesContextValue>(
    () => ({
      ...prefs,
      setTheme: (theme) => setPrefs((p) => ({ ...p, theme })),
      setDensity: (density) => setPrefs((p) => ({ ...p, density })),
      setTone: (tone) => setPrefs((p) => ({ ...p, tone })),
      setHideAids: (hideAids) => setPrefs((p) => ({ ...p, hideAids })),
    }),
    [prefs]
  );

  return <AppPreferencesContext.Provider value={value}>{children}</AppPreferencesContext.Provider>;
}

export function useAppPreferences() {
  const ctx = useContext(AppPreferencesContext);
  if (!ctx) throw new Error('useAppPreferences must be used within AppPreferencesProvider');
  return ctx;
}
