import type { NextRequest } from 'next/server';

/** Public browser-facing origin (never Docker's 0.0.0.0 bind address). */
export function publicAppOrigin(request?: NextRequest | Request): string {
  const configured =
    process.env.WEB_ORIGIN?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, '');
  }

  if (request) {
    const forwardedHost = request.headers.get('x-forwarded-host');
    const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
    if (forwardedHost) {
      const host = forwardedHost.split(',')[0].trim();
      const proto = forwardedProto || (host.includes('localhost') ? 'http' : 'https');
      return `${proto}://${host}`;
    }

    const host = request.headers.get('host');
    if (host && !host.startsWith('0.0.0.0')) {
      const proto = host.includes('localhost') || host.startsWith('127.') ? 'http' : 'https';
      return `${proto}://${host}`;
    }
  }

  return 'http://localhost:5000';
}

export function publicAppUrl(request: NextRequest | Request, pathWithQuery: string): URL {
  const base = publicAppOrigin(request);
  const path = pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`;
  return new URL(path, `${base}/`);
}
