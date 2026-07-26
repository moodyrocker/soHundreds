/**
 * Minimal bounded-parallelism helper.
 *
 * Kept in-repo rather than adding p-limit: it is ~20 lines, has no edge cases
 * we need beyond this, and the backend deliberately runs a small dependency
 * set. Semantics match p-limit's mapper form.
 */

/**
 * Runs `worker` over every item with at most `limit` in flight at once.
 *
 * Never rejects — each result is reported individually so one failing item
 * cannot abort the rest of the batch. This matters for the autopilot loop:
 * one tenant's broken integration must not stop other tenants' cycles.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<Array<{ item: T; value?: R; error?: unknown }>> {
  const results: Array<{ item: T; value?: R; error?: unknown }> = new Array(items.length);
  const bound = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;

  async function runner(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      const item = items[index];
      try {
        results[index] = { item, value: await worker(item, index) };
      } catch (error) {
        results[index] = { item, error };
      }
    }
  }

  await Promise.all(Array.from({ length: bound }, () => runner()));
  return results;
}
