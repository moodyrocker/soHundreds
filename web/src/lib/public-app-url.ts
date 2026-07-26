import type { NextRequest } from 'next/server';

function configuredPublicOrigin(): string | null {
  const configured =
    process.env.WEB_ORIGIN?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configured) return null;
  return configured.replace(/\/$/, '');
}

function requestPublicOrigin(request?: NextRequest | Request): string | null {
  if (!request) return null;

  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (forwardedHost) {
    const host = forwardedHost.split(',')[0].trim();
    if (host && !host.startsWith('0.0.0.0')) {
      const proto = forwardedProto || (host.includes('localhost') || host.startsWith('127.') ? 'http' : 'https');
      return `${proto}://${host}`;
    }
  }

  const host = request.headers.get('host');
  if (host && !host.startsWith('0.0.0.0')) {
    const proto =
      request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ||
      (host.includes('localhost') || host.startsWith('127.') ? 'http' : 'https');
    return `${proto}://${host}`;
  }

  return null;
}

/** True when localhost/127 and a public tunnel host would fight over cookies. */
function isLocalHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.localhost')
  );
}

/**
 * Public browser-facing origin (never Docker's 0.0.0.0 bind address).
 *
 * Prefer the request Host so localhost:5000 does not bounce to a stale WEB_ORIGIN
 * (ngrok) and vice versa — that cookie mismatch causes login loops.
 */
export function publicAppOrigin(request?: NextRequest | Request): string {
  const fromRequest = requestPublicOrigin(request);
  const configured = configuredPublicOrigin();

  if (fromRequest) {
    try {
      const reqHost = new URL(fromRequest).hostname;
      if (configured) {
        const cfgHost = new URL(configured).hostname;
        // Keep the browser on whatever host it already opened
        if (reqHost !== cfgHost) return fromRequest;
      }
      return fromRequest;
    } catch {
      return fromRequest;
    }
  }

  if (configured) return configured;
  return 'http://localhost:5000';
}

export function publicAppUrl(request: NextRequest | Request, pathWithQuery: string): URL {
  const base = publicAppOrigin(request);
  const path = pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`;
  return new URL(path, `${base}/`);
}

/** For debugging / health — not used in redirects. */
export function isLocalVsTunnelMismatch(request: NextRequest | Request): boolean {
  const fromRequest = requestPublicOrigin(request);
  const configured = configuredPublicOrigin();
  if (!fromRequest || !configured) return false;
  try {
    const a = new URL(fromRequest).hostname;
    const b = new URL(configured).hostname;
    return a !== b && (isLocalHost(a) || isLocalHost(b));
  } catch {
    return false;
  }
}
