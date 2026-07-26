import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from './concurrency.js';

/**
 * This helper governs how many autopilot cycles run at once. Two properties
 * matter operationally:
 *
 *   - The limit is respected. Exceeding it means more simultaneous Claude calls
 *     and Postgres connections than intended.
 *   - One failing item cannot abort the batch. A single tenant with a broken
 *     integration must not stop every other tenant's cycle, which is what a bare
 *     Promise.all would do.
 */

describe('mapWithConcurrency', () => {
  it('never exceeds the limit', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('processes every item exactly once', async () => {
    const seen: number[] = [];
    const items = Array.from({ length: 20 }, (_, i) => i);
    await mapWithConcurrency(items, 4, async (n) => {
      seen.push(n);
    });
    expect(seen.sort((a, b) => a - b)).toEqual(items);
  });

  it('returns results index-aligned with the input', async () => {
    // The caller pairs a result with its item to report per-strategy outcomes, so
    // a reordered array would attribute a failure to the wrong tenant.
    const items = ['a', 'b', 'c', 'd'];
    const results = await mapWithConcurrency(items, 2, async (s) => s.toUpperCase());
    expect(results.map((r) => r.item)).toEqual(items);
    expect(results.map((r) => r.value)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('isolates a failing item and keeps going', async () => {
    const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      if (n === 3) throw new Error('boom');
      return n * 2;
    });
    const failed = results.filter((r) => r.error !== undefined);
    const ok = results.filter((r) => r.error === undefined);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.item).toBe(3);
    expect(ok).toHaveLength(4);
    expect(ok.map((r) => r.value)).toEqual([2, 4, 8, 10]);
  });

  it('does not reject even when every item throws', async () => {
    // A rejection here would take down the worker tick.
    const results = await mapWithConcurrency([1, 2, 3], 2, async () => {
      throw new Error('always');
    });
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.error instanceof Error)).toBe(true);
  });

  it('handles an empty input', async () => {
    expect(await mapWithConcurrency([], 5, async () => 1)).toEqual([]);
  });

  it('caps parallelism at the input size when the limit is larger', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency([1, 2], 50, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('treats a limit below 1 as serial rather than stalling', async () => {
    const results = await mapWithConcurrency([1, 2, 3], 0, async (n) => n);
    expect(results.map((r) => r.value)).toEqual([1, 2, 3]);
  });

  it('actually runs concurrently, not sequentially', async () => {
    // 6 items of 30ms at concurrency 3 should take ~60ms, not ~180ms.
    const started = Date.now();
    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 3, async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(Date.now() - started).toBeLessThan(150);
  });

  it('passes the index to the worker', async () => {
    const indices: number[] = [];
    await mapWithConcurrency(['a', 'b', 'c'], 1, async (_item, i) => {
      indices.push(i);
    });
    expect(indices).toEqual([0, 1, 2]);
  });
});
