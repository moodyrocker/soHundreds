import { createClient } from '@/lib/supabase/server';
import { oauthSuccessQuery, parseOAuthState } from '@/lib/oauth-state';
import { publicAppUrl } from '@/lib/public-app-url';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function apiOrigin(): string {
  return process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
}

function integrationsUrl(request: NextRequest, query: string): URL {
  return publicAppUrl(request, `/integrations?${query}`);
}

async function readConnectError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const json = JSON.parse(text) as { error?: string };
    if (json.error) return json.error;
  } catch {
    /* plain text */
  }
  if (text.includes('already used')) {
    return 'This authorization link was already used. Go to Integrations and click Connect store again.';
  }
  return text.slice(0, 300) || `Connection failed (${response.status})`;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const oauthError = params.get('error');
  if (oauthError) {
    const description = params.get('error_description') ?? oauthError;
    return NextResponse.redirect(
      integrationsUrl(request, `oauth_error=${encodeURIComponent(description)}`)
    );
  }

  const code = params.get('code');
  const state = params.get('state');
  const shop = params.get('shop');

  if (!code || !state) {
    return NextResponse.redirect(
      integrationsUrl(request, `oauth_error=${encodeURIComponent('Missing authorization code.')}`)
    );
  }

  const { organizationId, platform, codeVerifier } = parseOAuthState(state);

  if (platform === 'shopify' && !shop) {
    return NextResponse.redirect(
      integrationsUrl(
        request,
        `oauth_error=${encodeURIComponent('Missing shop parameter from Shopify.')}`
      )
    );
  }

  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    const returnParams = new URLSearchParams({ code, state });
    if (shop) returnParams.set('shop', shop);
    const loginUrl = publicAppUrl(request, '/login');
    loginUrl.searchParams.set('next', `/integrations/callback?${returnParams}`);
    return NextResponse.redirect(loginUrl);
  }

  const codeCookie = `oauth_code_${code.slice(0, 24)}`;
  if (request.cookies.get(codeCookie)?.value === 'done') {
    return NextResponse.redirect(integrationsUrl(request, oauthSuccessQuery(platform)));
  }

  if (platform === 'canva' && !codeVerifier) {
    return NextResponse.redirect(
      integrationsUrl(
        request,
        `oauth_error=${encodeURIComponent(
          'Canva login was missing the PKCE verifier. Click Connect Canva again from Integrations.'
        )}`
      )
    );
  }

  let connectRes: Response | null = null;
  let lastConnectError = 'Connection failed';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      connectRes = await fetch(`${apiOrigin()}/api/mcp/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          'X-Organization-Id': organizationId,
        },
        body: JSON.stringify({
          platform,
          oauthCode: code,
          ...(codeVerifier ? { codeVerifier } : {}),
          ...(shop ? { shop } : {}),
        }),
        signal: AbortSignal.timeout(30_000),
      });
      break;
    } catch (err) {
      lastConnectError =
        err instanceof Error ? err.message : 'Could not reach the API to finish connecting';
      console.error(`[oauth/callback] connect attempt ${attempt + 1} failed:`, lastConnectError);
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
  }

  if (!connectRes) {
    return NextResponse.redirect(
      integrationsUrl(request, `oauth_error=${encodeURIComponent(lastConnectError)}`)
    );
  }

  if (!connectRes.ok) {
    const message = await readConnectError(connectRes);
    return NextResponse.redirect(
      integrationsUrl(request, `oauth_error=${encodeURIComponent(message)}`)
    );
  }

  const response = NextResponse.redirect(integrationsUrl(request, oauthSuccessQuery(platform)));
  response.cookies.set(codeCookie, 'done', {
    maxAge: 600,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
  return response;
}
