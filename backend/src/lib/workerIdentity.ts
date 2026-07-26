import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';

/**
 * Stable identifier for this process, used to stamp work claims.
 *
 * Correctness of claiming does not depend on this value — that comes from the
 * atomic conditional UPDATE in the database. This exists so that a stuck claim
 * can be traced back to the container that took it.
 */
export const INSTANCE_ID = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

/**
 * How long a claim may be held before another worker is allowed to steal it.
 *
 * Must exceed the longest realistic cycle. A single cycle can involve several
 * Claude calls (MAX_TURNS 8, MAX_TOKENS 16384) plus external API work; Runway
 * video generation alone is documented at 10-15 minutes and the web proxy
 * allows 900s for execution routes. 30 minutes leaves headroom without leaving
 * a genuinely dead claim parked for hours.
 */
export function getClaimStaleMinutes(): number {
  const raw = Number(process.env.AUTOPILOT_CLAIM_STALE_MINUTES ?? '30');
  if (!Number.isFinite(raw) || raw < 5) return 30;
  return Math.min(240, Math.floor(raw));
}

/** Maximum strategies processed concurrently by one worker instance. */
export function getCycleConcurrency(): number {
  const raw = Number(process.env.AUTOPILOT_CYCLE_CONCURRENCY ?? '3');
  if (!Number.isFinite(raw) || raw < 1) return 3;
  return Math.min(20, Math.floor(raw));
}

/** How many strategies one worker claims per tick. */
export function getCycleBatchSize(): number {
  const raw = Number(process.env.AUTOPILOT_CYCLE_BATCH_SIZE ?? '10');
  if (!Number.isFinite(raw) || raw < 1) return 10;
  return Math.min(100, Math.floor(raw));
}
