import type { Request, Response, NextFunction } from 'express';
import { query } from '../database/connection.js';
import type { AuthRequest } from '../middleware/auth.js';
import type { TenantRequest } from '../middleware/tenant.js';
import { logger } from '../lib/logger.js';

const log = logger('rate-limit');

/**
 * Rate limiting.
 *
 * The API previously had none, so nothing stopped a loop against
 * POST /api/strategy/create from burning the Anthropic budget (each call runs up
 * to 8 turns at 16k tokens, plus web search), or a loop against the execution
 * routes from creating Shopify content, Instagram posts and funded ad campaigns.
 *
 * Two tiers, because the failure modes differ:
 *
 *   dbLimiter    — cost-critical routes. Counters live in Postgres
 *                  (rate_limit_counters), so the limit is a real ceiling rather
 *                  than one-per-replica. These routes are low-volume, so the
 *                  extra round trip is irrelevant next to a Claude call.
 *
 *   memoryLimiter — everything else. Per-process and approximate, which is fine
 *                  for cheap reads; the point is only to blunt a runaway client.
 *
 * Limits are per organization, keyed on the tenant resolved by tenantMiddleware.
 * Cost is incurred per organization, so that is the unit that should be capped —
 * and it means one tenant cannot starve another, nor can a shared office IP
 * penalise unrelated users.
 */

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

/** Buckets, tuned so normal use never notices and a loop is stopped quickly. */
export const LIMITS = {
  /** Plan generation, refinement, check-ups, agent tasks — every Claude call. */
  ai_generation: {
    windowSecs: envInt('RATE_LIMIT_AI_WINDOW_SECS', 3600),
    max: envInt('RATE_LIMIT_AI_MAX', 40),
  },
  /** Creating or pushing paid campaigns — real money, and gated by design. */
  paid_ads: {
    windowSecs: envInt('RATE_LIMIT_PAID_ADS_WINDOW_SECS', 3600),
    max: envInt('RATE_LIMIT_PAID_ADS_MAX', 10),
  },
  /** Publishing to Shopify / Instagram / Mailchimp. */
  content_publish: {
    windowSecs: envInt('RATE_LIMIT_PUBLISH_WINDOW_SECS', 3600),
    max: envInt('RATE_LIMIT_PUBLISH_MAX', 60),
  },
  /** Signup and login, keyed on IP — the only pre-tenant bucket. */
  auth: {
    windowSecs: envInt('RATE_LIMIT_AUTH_WINDOW_SECS', 900),
    max: envInt('RATE_LIMIT_AUTH_MAX', 20),
  },
} as const;

export type LimitScope = keyof typeof LIMITS;

function clientIp(req: Request): string {
  // Behind the Next.js proxy and any load balancer. Only used for the auth
  // bucket, where a shared IP being throttled together is acceptable.
  const fwd = req.header('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

/** Organization if the tenant is resolved, else user, else IP. */
function subjectFor(req: Request): string {
  const tenant = (req as TenantRequest).tenant;
  if (tenant?.id) return `org:${tenant.id}`;
  const user = (req as AuthRequest).user;
  if (user?.id) return `user:${user.id}`;
  return `ip:${clientIp(req)}`;
}

function tooMany(res: Response, scope: LimitScope, retryAfterSecs: number): void {
  res.setHeader('Retry-After', String(retryAfterSecs));
  res.status(429).json({
    error:
      scope === 'ai_generation'
        ? 'Too many plan generations for this workspace in the last hour. This limit protects your AI spend — try again shortly.'
        : scope === 'paid_ads'
          ? 'Too many paid campaign operations for this workspace in the last hour. This limit exists so a retry loop cannot spend real budget.'
          : scope === 'auth'
            ? 'Too many authentication attempts. Try again shortly.'
            : 'Too many requests for this workspace. Try again shortly.',
    scope,
    retryAfterSeconds: retryAfterSecs,
  });
}

let lastPrune = 0;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

function maybePrune(): void {
  const now = Date.now();
  if (now - lastPrune < PRUNE_INTERVAL_MS) return;
  lastPrune = now;
  void query('SELECT public.prune_rate_limit_counters($1)', [86_400]).catch((err) => {
    log.warn(
      'prune skipped:', err);
  });
}

/**
 * Postgres-backed limiter for cost-critical routes.
 *
 * Fails **open** on a database error. A limiter that 500s would take the whole
 * API down over a transient blip, which is worse than briefly not enforcing a
 * ceiling — the human gates and paid-ad throttle still stand behind it.
 */
export function dbLimiter(scope: LimitScope) {
  const { windowSecs, max } = LIMITS[scope];

  return async function limiter(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const subject = subjectFor(req);
    try {
      const result = await query<{ bump_rate_limit: number }>(
        'SELECT public.bump_rate_limit($1, $2, $3) AS bump_rate_limit',
        [scope, subject, windowSecs]
      );
      const count = Number(result.rows[0]?.bump_rate_limit ?? 0);

      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - count)));

      if (count > max) {
        log.warn(
          `${scope} exceeded by ${subject} (${count}/${max} in ${windowSecs}s)`
        );
        tooMany(res, scope, windowSecs);
        return;
      }

      maybePrune();
      next();
    } catch (err) {
      log.error(
        `${scope} check failed for ${subject}, allowing request:`,
        err instanceof Error ? err.message : err
      );
      next();
    }
  };
}

/**
 * In-memory limiter for high-volume cheap routes.
 *
 * Per-process, so the effective ceiling scales with replica count. Deliberate:
 * these requests cost nothing meaningful, and the goal is only to blunt a
 * runaway client without adding a database round trip to every read.
 */
export function memoryLimiter(options?: { windowSecs?: number; max?: number }) {
  const windowSecs = options?.windowSecs ?? envInt('RATE_LIMIT_GENERAL_WINDOW_SECS', 60);
  const max = options?.max ?? envInt('RATE_LIMIT_GENERAL_MAX', 300);

  const hits = new Map<string, { count: number; resetAt: number }>();

  // Bounded cleanup so an attacker cycling subjects cannot grow the map without
  // limit. unref'd so it never holds the process open.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowSecs * 1000);
  if (typeof sweep.unref === 'function') sweep.unref();

  return function limiter(req: Request, res: Response, next: NextFunction): void {
    const key = subjectFor(req);
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowSecs * 1000 });
      next();
      return;
    }

    entry.count++;
    if (entry.count > max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        error: 'Too many requests. Slow down and try again shortly.',
        retryAfterSeconds: retryAfter,
      });
      return;
    }

    next();
  };
}
