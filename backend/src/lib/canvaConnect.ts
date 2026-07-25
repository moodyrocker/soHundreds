import { createHash, randomBytes } from 'node:crypto';
import type { OAuthTokens } from '../types/index.js';

const CANVA_API_BASE = 'https://api.canva.com/rest/v1';
const CANVA_AUTH_BASE = 'https://www.canva.com/api/oauth';

/** Scopes for design create/list/export used by Hundres Instagram workflow. */
export const CANVA_OAUTH_SCOPES = [
  'design:meta:read',
  'design:content:read',
  'design:content:write',
  'profile:read',
].join(' ');

export function generateCanvaPkce(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

export function canvaAppCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.CANVA_CLIENT_ID?.trim();
  const clientSecret = process.env.CANVA_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function canvaOAuthRedirectUri(): string {
  const uri =
    process.env.CANVA_OAUTH_REDIRECT_URI?.trim() ||
    process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  if (!uri) {
    throw new Error('CANVA_OAUTH_REDIRECT_URI or GOOGLE_OAUTH_REDIRECT_URI is required for Canva login');
  }
  return uri;
}

export function isCanvaConnectConfigured(): boolean {
  try {
    canvaOAuthRedirectUri();
    return canvaAppCredentials() !== null;
  } catch {
    return false;
  }
}

function basicAuthHeader(): string {
  const creds = canvaAppCredentials();
  if (!creds) throw new Error('Canva OAuth is not configured');
  return `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')}`;
}

function withExpiry(tokens: OAuthTokens): OAuthTokens {
  if (!tokens.expires_in) return tokens;
  return { ...tokens, expires_at: Date.now() + tokens.expires_in * 1000 };
}

export function buildCanvaAuthorizeUrl(input: {
  organizationId: string;
  state: string;
  codeChallenge: string;
}): string {
  const creds = canvaAppCredentials();
  if (!creds) throw new Error('Canva OAuth is not configured');

  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: canvaOAuthRedirectUri(),
    response_type: 'code',
    code_challenge: input.codeChallenge,
    code_challenge_method: 's256',
    state: input.state,
  });
  // Canva expects space-separated scopes as %20 (not +) and scopes must be
  // enabled on the integration in canva.dev → Scopes.
  params.set('scope', CANVA_OAUTH_SCOPES);

  const qs = params
    .toString()
    .replace(/(?:^|&)scope=[^&]*/, (m) => m.replace(/\+/g, '%20'));

  return `${CANVA_AUTH_BASE}/authorize?${qs}`;
}

export async function exchangeCanvaCode(
  code: string,
  codeVerifier: string
): Promise<{ tokens: OAuthTokens; profile: { id: string; displayName?: string } }> {
  const creds = canvaAppCredentials();
  if (!creds) throw new Error('Canva OAuth is not configured');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    redirect_uri: canvaOAuthRedirectUri(),
  });

  const response = await fetch(`${CANVA_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Canva token exchange failed: ${text.slice(0, 400)}`);
  }

  const tokens = withExpiry(JSON.parse(text) as OAuthTokens);
  const profile = await fetchCanvaCurrentUser(tokens.access_token);
  return { tokens, profile };
}

export async function refreshCanvaToken(refreshToken: string): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const response = await fetch(`${CANVA_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Canva token refresh failed: ${text.slice(0, 400)}`);
  }

  return withExpiry(JSON.parse(text) as OAuthTokens);
}

async function fetchCanvaCurrentUser(
  accessToken: string
): Promise<{ id: string; displayName?: string }> {
  const meRes = await fetch(`${CANVA_API_BASE}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const meText = await meRes.text();
  if (!meRes.ok) {
    throw new Error(`Canva /users/me failed: ${meText.slice(0, 300)}`);
  }

  const me = JSON.parse(meText) as {
    team_user?: { user_id?: string; team_id?: string };
    user?: { id?: string };
  };
  const id = me.team_user?.user_id ?? me.user?.id;
  if (!id) throw new Error('Canva /users/me missing team_user.user_id');

  let displayName: string | undefined;
  try {
    const profileRes = await fetch(`${CANVA_API_BASE}/users/me/profile`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (profileRes.ok) {
      const profile = (await profileRes.json()) as {
        profile?: { display_name?: string };
      };
      displayName = profile.profile?.display_name;
    }
  } catch {
    /* display name is optional */
  }

  return { id, displayName };
}
