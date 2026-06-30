import { createClient } from '@/lib/supabase/client';

const DEFAULT_TIMEOUT_MS = 8_000;

async function resolveAccessToken(explicit?: string): Promise<string | undefined> {
  if (explicit) return explicit;
  if (typeof window === 'undefined') return undefined;
  const supabase = createClient();
  if (!supabase) return undefined;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token;
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
  const headers = new Headers(initHeaders);

  const accessToken = await resolveAccessToken(token);
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
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError('Request timed out. Is the API running on port 3001?', 408);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
