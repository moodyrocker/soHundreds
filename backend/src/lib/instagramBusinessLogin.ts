import type { OAuthTokens } from '../types/index.js';

/** Scopes for Instagram API with Instagram Business Login (2025+). */
export const INSTAGRAM_BUSINESS_OAUTH_SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
  'instagram_business_manage_comments',
].join(',');

/**
 * Instagram Business Login uses a separate Instagram App ID — NOT the Meta/Facebook App ID
 * at the top of developers.facebook.com. Find it under:
 * App Dashboard → Instagram → API setup with Instagram login → Business login settings
 */
export function instagramAppCredentials(): { appId: string; appSecret: string } | null {
  const appId = process.env.INSTAGRAM_APP_ID?.trim();
  const appSecret = process.env.INSTAGRAM_APP_SECRET?.trim();
  if (!appId || !appSecret) return null;
  return { appId, appSecret };
}

export function instagramOAuthRedirectUri(): string {
  const uri =
    process.env.INSTAGRAM_OAUTH_REDIRECT_URI?.trim() ||
    process.env.META_OAUTH_REDIRECT_URI?.trim() ||
    process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  if (!uri) {
    throw new Error(
      'INSTAGRAM_OAUTH_REDIRECT_URI or META_OAUTH_REDIRECT_URI is required for Instagram login'
    );
  }
  return uri;
}

export function isInstagramBusinessLoginConfigured(): boolean {
  try {
    instagramOAuthRedirectUri();
    return instagramAppCredentials() !== null;
  } catch {
    return false;
  }
}

type ShortLivedResponse =
  | { access_token: string; user_id: string | number }
  | { data?: Array<{ access_token?: string; user_id?: string | number }> };

export async function exchangeInstagramBusinessCode(
  code: string
): Promise<{ tokens: OAuthTokens; igUserId: string }> {
  const creds = instagramAppCredentials();
  if (!creds) {
    throw new Error(
      'Instagram Business Login is not configured. Set INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET (from Instagram → API setup with Instagram login), not only META_APP_ID.'
    );
  }
  const { appId: clientId, appSecret: clientSecret } = creds;
  const redirectUri = instagramOAuthRedirectUri();

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code,
  });

  const response = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Instagram token exchange failed: ${text.slice(0, 400)}`);
  }

  let parsed: ShortLivedResponse;
  try {
    parsed = JSON.parse(text) as ShortLivedResponse;
  } catch {
    throw new Error(`Instagram token exchange returned invalid JSON: ${text.slice(0, 200)}`);
  }

  const entry =
    'data' in parsed && parsed.data?.[0]
      ? parsed.data[0]
      : (parsed as { access_token?: string; user_id?: string | number });
  const shortToken = entry.access_token;
  const igUserId = entry.user_id != null ? String(entry.user_id) : '';

  if (!shortToken || !igUserId) {
    throw new Error(`Instagram token exchange missing access_token or user_id: ${text.slice(0, 300)}`);
  }

  const longLived = await exchangeInstagramLongLivedToken(shortToken);
  const profile = await resolveInstagramBusinessProfile(longLived.access_token);
  return { tokens: longLived, igUserId: profile.id };
}

async function exchangeInstagramLongLivedToken(shortLivedToken: string): Promise<OAuthTokens> {
  const creds = instagramAppCredentials();
  if (!creds) {
    throw new Error('Instagram app credentials are not configured');
  }
  const clientSecret = creds.appSecret;
  const url = new URL('https://graph.instagram.com/access_token');
  url.searchParams.set('grant_type', 'ig_exchange_token');
  url.searchParams.set('client_secret', clientSecret);
  url.searchParams.set('access_token', shortLivedToken);

  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Instagram long-lived token exchange failed: ${text.slice(0, 400)}`);
  }

  const data = JSON.parse(text) as OAuthTokens;
  return withExpiry(data);
}

export async function refreshInstagramBusinessToken(accessToken: string): Promise<OAuthTokens> {
  const url = new URL('https://graph.instagram.com/refresh_access_token');
  url.searchParams.set('grant_type', 'ig_refresh_token');
  url.searchParams.set('access_token', accessToken);

  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Instagram token refresh failed: ${text.slice(0, 400)}`);
  }

  const data = JSON.parse(text) as OAuthTokens;
  return withExpiry(data);
}

function withExpiry(tokens: OAuthTokens): OAuthTokens {
  if (!tokens.expires_in) return tokens;
  return {
    ...tokens,
    expires_at: Date.now() + tokens.expires_in * 1000,
  };
}

export async function resolveInstagramBusinessProfile(
  accessToken: string
): Promise<{ id: string; username?: string }> {
  const version = process.env.META_GRAPH_API_VERSION ?? 'v21.0';
  const url = new URL(`https://graph.instagram.com/${version}/me`);
  url.searchParams.set('fields', 'id,username');
  url.searchParams.set('access_token', accessToken);

  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Instagram /me profile lookup failed: ${text.slice(0, 300)}`);
  }

  const data = JSON.parse(text) as { id?: string; username?: string };
  if (!data.id) {
    throw new Error('Instagram /me profile lookup missing id');
  }
  return { id: data.id, username: data.username };
}

export async function fetchInstagramBusinessUsername(
  accessToken: string
): Promise<string | undefined> {
  try {
    const profile = await resolveInstagramBusinessProfile(accessToken);
    return profile.username;
  } catch {
    return undefined;
  }
}
