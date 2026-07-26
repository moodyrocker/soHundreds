import type { Request, Response, NextFunction } from 'express';

/**
 * Security response headers.
 *
 * Written in-repo rather than adding `helmet`. This is a JSON API with no
 * server-rendered HTML, so only a handful of helmet's ~15 middlewares apply, and
 * the backend deliberately keeps a small dependency set (10 runtime deps). The
 * relevant ones are ~25 lines.
 *
 * The Next.js app is a separate origin and sets its own headers; nothing here
 * affects it.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  // Never let a browser second-guess a declared content type. Without this, a
  // JSON response containing attacker-influenced text can be sniffed as HTML
  // and executed.
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // No API response should ever be framed.
  res.setHeader('X-Frame-Options', 'DENY');

  // Belt and braces with X-Frame-Options, and covers the JSON-as-document case:
  // nothing may be loaded, framed, or executed from an API response.
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
  );

  // Do not leak API paths (which contain organization and execution ids) to
  // third parties via the Referer header.
  res.setHeader('Referrer-Policy', 'no-referrer');

  // Deny device access outright; this API has no use for any of it.
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
  );

  // Tenant data must never be cached by an intermediary.
  res.setHeader('Cache-Control', 'no-store');

  // Do not advertise Express and its version.
  res.removeHeader('X-Powered-By');

  // HSTS only makes sense once served over TLS, and only from the real origin —
  // setting it in local HTTP development would pin localhost to https.
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}
