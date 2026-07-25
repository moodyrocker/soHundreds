import { createClient } from '@/lib/supabase/client';

const DEFAULT_TIMEOUT_MS = 8_000;

async function resolveAccessToken(explicit?: string): Promise<string | undefined> {
  if (typeof window !== 'undefined') {
    const supabase = createClient();
    if (supabase) {
      // Prefer the live session — AuthProvider may still hold an expired accessToken
      // after TOKEN_REFRESHED (we intentionally skip a full /me refetch on refresh).
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) return data.session.access_token;

      const { data: refreshed } = await supabase.auth.refreshSession();
      if (refreshed.session?.access_token) return refreshed.session.access_token;
    }
  }
  return explicit;
}

/**
 * Browser calls use same-origin `/api/*` (proxied by Next.js — works over HTTPS/ngrok).
 * Server-side fallbacks use NEXT_PUBLIC_API_URL or localhost:3001.
 */
export function getApiUrl() {
  if (typeof window !== 'undefined') {
    return '';
  }
  const configured = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  return configured.replace(/\/$/, '');
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & {
    token?: string;
    organizationId?: string;
    timeoutMs?: number;
  } = {}
): Promise<T> {
  const { token, organizationId, timeoutMs = DEFAULT_TIMEOUT_MS, headers: initHeaders, ...rest } =
    options;

  const doFetch = async (accessToken: string | undefined) => {
    const headers = new Headers(initHeaders);
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
    if (organizationId) headers.set('X-Organization-Id', organizationId);
    if (rest.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${getApiUrl()}${path}`, {
        ...rest,
        headers,
        signal: controller.signal,
      });
      return res;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        const longRunning = /execution\/agent-task|execution\/run|orchestrator/i.test(path);
        throw new ApiError(
          longRunning
            ? 'This is taking longer than expected (Runway video can take 10–15 minutes). Check Activity log for a Failed row with the Runway task ID, or dev.runwayml.com → Usage for credit spend.'
            : 'Request timed out. Is the API running on port 3001?',
          408
        );
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  };

  let accessToken = await resolveAccessToken(token);
  let res = await doFetch(accessToken);

  // One retry after forced refresh if the access JWT was expired
  if (res.status === 401 && typeof window !== 'undefined') {
    const supabase = createClient();
    if (supabase) {
      const { data } = await supabase.auth.refreshSession();
      const retryToken = data.session?.access_token;
      if (retryToken && retryToken !== accessToken) {
        accessToken = retryToken;
        res = await doFetch(accessToken);
      }
    }
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(
      (data as { error?: string }).error ?? 'Request failed',
      res.status,
      (data as { details?: unknown }).details
    );
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const data = await res.json().catch(() => ({}));
  return data as T;
}
