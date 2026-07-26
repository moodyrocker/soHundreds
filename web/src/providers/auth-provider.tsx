'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthUser, MeResponse, Organization } from '@/lib/auth-types';
import { ApiError, apiFetch } from '@/lib/api';
import { shouldClearAuthSession } from '@/lib/auth-session';
import { clearPendingSignup, readPendingSignup, savePendingSignup } from '@/lib/pending-signup';
import { createClient } from '@/lib/supabase/client';

const ACTIVE_ORG_KEY = 'hundres:active_org_id';

const CONFIG_ERROR =
  'Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env and rebuild the web container.';

function authRedirectUrl(path = '/auth/callback'): string {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}${path}`;
  }
  return `${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:5000'}${path}`;
}

function needsEmailConfirmation(user: User | null): boolean {
  if (!user) return true;
  if (user.email_confirmed_at) return false;
  if (user.confirmed_at) return false;
  if (user.identities?.length === 0) return true;
  return true;
}

interface AuthContextValue {
  user: AuthUser | null;
  organizations: Organization[];
  activeOrganization: Organization | null;
  loading: boolean;
  configError: string | null;
  accessToken: string | null;
  setActiveOrganization: (orgId: string) => void;
  signIn: (email: string, password: string, redirectTo?: string) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    fullName?: string,
    organizationName?: string
  ) => Promise<{ needsEmailConfirmation: boolean; email: string }>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function pickActiveOrg(orgs: Organization[], storedId: string | null): Organization | null {
  if (orgs.length === 0) return null;
  if (storedId) {
    const match = orgs.find((o) => o.id === storedId);
    if (match) return match;
  }
  return orgs[0];
}

function isAuthPage(pathname: string): boolean {
  return (
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/auth/callback') ||
    pathname.startsWith('/integrations/callback')
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = useMemo(() => createClient(), []);

  const [user, setUser] = useState<AuthUser | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [activeOrganization, setActiveOrganizationState] = useState<Organization | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  const applyMe = useCallback((me: MeResponse) => {
    setUser(me.user);
    setOrganizations(me.organizations);
    const stored = typeof window !== 'undefined' ? localStorage.getItem(ACTIVE_ORG_KEY) : null;
    const active = pickActiveOrg(me.organizations, stored);
    setActiveOrganizationState((prev) => {
      if (prev?.id === active?.id) return prev;
      return active;
    });
    if (active && typeof window !== 'undefined') {
      localStorage.setItem(ACTIVE_ORG_KEY, active.id);
    }
  }, []);

  const completePendingSignup = useCallback(async (token: string) => {
    const pending = readPendingSignup();
    if (!pending?.organizationName) return;

    await apiFetch<Organization>('/api/organizations', {
      method: 'POST',
      token,
      body: JSON.stringify({ name: pending.organizationName }),
    });
    clearPendingSignup();
  }, []);

  const clearAuthState = useCallback(() => {
    setUser(null);
    setOrganizations([]);
    setActiveOrganizationState(null);
    setAccessToken(null);
  }, []);

  const refreshMe = useCallback(async () => {
    if (!supabase) return;

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();

      if (userError && shouldClearAuthSession(userError)) {
        clearAuthState();
        await supabase.auth.signOut();
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        if (!userData.user) clearAuthState();
        return;
      }

      setAccessToken(token);
      await completePendingSignup(token);

      const me = await apiFetch<MeResponse>('/api/auth/me', { token, timeoutMs: 10_000 });
      applyMe(me);
    } catch (err) {
      // Keep the current session on transient failures (e.g. during DELETE) — only sign out on 401.
      if (err instanceof ApiError && err.status === 401) {
        clearAuthState();
        await supabase.auth.signOut();
      }
    }
  }, [applyMe, clearAuthState, completePendingSignup, supabase]);

  useEffect(() => {
    if (!supabase) {
      setConfigError(CONFIG_ERROR);
      setLoading(false);
      return;
    }

    let mounted = true;
    const client = supabase as SupabaseClient;

    const timeout = window.setTimeout(() => {
      if (mounted) setLoading(false);
    }, 4_000);

    void (async () => {
      try {
        await refreshMe();
      } finally {
        if (mounted) setLoading(false);
        window.clearTimeout(timeout);
      }
    })();

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      // Keep React accessToken in sync on refresh without a full /me round-trip
      // (full refreshMe on TOKEN_REFRESHED used to bounce users to /login).
      if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
        if (session?.access_token) setAccessToken(session.access_token);
        return;
      }
      void refreshMe();
    });

    return () => {
      mounted = false;
      window.clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, [refreshMe, supabase]);

  useEffect(() => {
    const isOAuthCallback = pathname.startsWith('/integrations/callback');
    if (isAuthPage(pathname) && !isOAuthCallback) {
      setLoading(false);
    }
  }, [pathname]);

  const setActiveOrganization = useCallback(
    (orgId: string) => {
      const org = organizations.find((o) => o.id === orgId) ?? null;
      setActiveOrganizationState(org);
      if (org) localStorage.setItem(ACTIVE_ORG_KEY, org.id);
    },
    [organizations]
  );

  const requireSupabase = useCallback(() => {
    if (!supabase) throw new Error(CONFIG_ERROR);
    return supabase;
  }, [supabase]);

  const signIn = useCallback(
    async (email: string, password: string, redirectTo = '/') => {
      const client = requireSupabase();
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      await refreshMe();
      // Full navigation ensures Supabase cookies are applied (avoids login redirect loops on ngrok).
      window.location.assign(redirectTo);
    },
    [refreshMe, requireSupabase]
  );

  const signUp = useCallback(
    async (email: string, password: string, fullName?: string, organizationName?: string) => {
      const client = requireSupabase();
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: authRedirectUrl('/auth/callback'),
          data: fullName ? { full_name: fullName } : undefined,
        },
      });

      if (error) throw new Error(error.message);

      const awaitingConfirmation = !data.session || needsEmailConfirmation(data.user);
      if (awaitingConfirmation) {
        if (organizationName) {
          savePendingSignup({ email, organizationName, fullName });
        }
        return { needsEmailConfirmation: true, email };
      }

      setAccessToken(data.session!.access_token);

      if (organizationName) {
        await apiFetch<Organization>('/api/organizations', {
          method: 'POST',
          token: data.session!.access_token,
          body: JSON.stringify({ name: organizationName }),
        });
      }

      await refreshMe();
      router.push('/');
      router.refresh();
      return { needsEmailConfirmation: false, email };
    },
    [refreshMe, requireSupabase, router]
  );

  const signOut = useCallback(async () => {
    const client = requireSupabase();
    await client.auth.signOut();
    localStorage.removeItem(ACTIVE_ORG_KEY);
    setUser(null);
    setOrganizations([]);
    setActiveOrganizationState(null);
    setAccessToken(null);
    router.push('/login');
    router.refresh();
  }, [requireSupabase, router]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      organizations,
      activeOrganization,
      loading,
      configError,
      accessToken,
      setActiveOrganization,
      signIn,
      signUp,
      signOut,
      refreshMe,
    }),
    [
      user,
      organizations,
      activeOrganization,
      loading,
      configError,
      accessToken,
      setActiveOrganization,
      signIn,
      signUp,
      signOut,
      refreshMe,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
