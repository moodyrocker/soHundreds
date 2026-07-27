import { googleAdsExecutor, metaAdsExecutor } from './adExecutors.js';
import { mailchimpExecutor } from './mailchimpExecutor.js';
import {
  productSeoExecutor,
  shopifyBlogExecutor,
  shopifyPageExecutor,
} from './shopifyExecutors.js';
import type { PlatformExecutor } from './types.js';

/**
 * Maps `action_executions.execution_type` to the executor that owns it.
 *
 * This replaces a hand-written `switch` in `ExecutionService.approve()`. The
 * switch was the single most dangerous line in the file: every arm called a method
 * with an identical signature, so `tsc` would accept
 *
 *     case 'create_meta_ads_campaign':
 *       return await this.approveShopifyPage(...)
 *
 *  — and the failure would surface as a live storefront page containing ad copy,
 * or a second funded campaign, found by a customer rather than by a compiler.
 *
 * With the registry, an executor is reachable only under the type it declares, and
 * the build-time check below refuses duplicate registrations. Mis-routing stops
 * being something a reviewer has to notice.
 */
const EXECUTORS: readonly PlatformExecutor[] = [
  // Ordered least-to-most consequential, matching the order they were extracted.
  mailchimpExecutor, // drafts only, never sends
  shopifyPageExecutor,
  shopifyBlogExecutor,
  productSeoExecutor,
  googleAdsExecutor, // spends money
  metaAdsExecutor, // spends money
];

const byType = new Map<string, PlatformExecutor>();
for (const executor of EXECUTORS) {
  if (byType.has(executor.executionType)) {
    // Thrown at import time, so a duplicate registration fails the process on boot
    // and in CI rather than silently shadowing one executor with another.
    throw new Error(
      `Duplicate PlatformExecutor registered for execution_type "${executor.executionType}"`
    );
  }
  byType.set(executor.executionType, executor);
}

/** Execution types that require approval, derived from the registry. */
export const APPROVABLE_EXECUTION_TYPES: readonly string[] = EXECUTORS.map(
  (e) => e.executionType
);

export function findExecutor(executionType: string): PlatformExecutor | undefined {
  return byType.get(executionType);
}

/**
 * Resolves an executor or throws.
 *
 * `approve()` validates the type up front, so reaching this without a match means
 * a new execution type was added without an executor — a programmer error, not a
 * user one.
 */
export function requireExecutor(executionType: string): PlatformExecutor {
  const executor = byType.get(executionType);
  if (!executor) {
    throw new Error(`No executor registered for execution type "${executionType}"`);
  }
  return executor;
}

export { EXECUTORS };
