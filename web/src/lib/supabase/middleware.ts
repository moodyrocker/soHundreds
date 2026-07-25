import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { shouldClearAuthSession } from '@/lib/auth-session';
import { publicAppUrl } from '@/lib/public-app-url';

function redirectWithSessionCookies(url: URL, sessionResponse: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(url);
  sessionResponse.cookies.getAll().forEach((cookie) => {
    redirect.cookies.set(cookie.name, cookie.value);
  });
  return redirect;
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return supabaseResponse;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // getUser validates the session server-side; getSession alone can leave stale cookies
  // that bounce /login ↔ / (refresh_token_not_found loop).
  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user'] = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
    if (result.error && shouldClearAuthSession(result.error)) {
      await supabase.auth.signOut();
      user = null;
    }
  } catch {
    // Network/DNS blips to Supabase must not clear cookies or force /login —
    // that creates a bounce loop when Docker DNS briefly fails.
    return supabaseResponse;
  }

  const isAuthRoute =
    request.nextUrl.pathname.startsWith('/login') ||
    request.nextUrl.pathname.startsWith('/signup') ||
    request.nextUrl.pathname.startsWith('/auth/callback');

  const isOAuthCallback = request.nextUrl.pathname.startsWith('/integrations/callback');
  const isApiProxy = request.nextUrl.pathname.startsWith('/api/');

  if (!user && !isAuthRoute && !isOAuthCallback && !isApiProxy) {
    const loginUrl = publicAppUrl(request, '/login');
    loginUrl.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
    return redirectWithSessionCookies(loginUrl, supabaseResponse);
  }

  if (user && isAuthRoute) {
    const next = request.nextUrl.searchParams.get('next');
    if (next && next.startsWith('/') && !next.startsWith('//')) {
      return redirectWithSessionCookies(publicAppUrl(request, next), supabaseResponse);
    }

    const homeUrl = publicAppUrl(request, '/');
    return redirectWithSessionCookies(homeUrl, supabaseResponse);
  }

  return supabaseResponse;
}
