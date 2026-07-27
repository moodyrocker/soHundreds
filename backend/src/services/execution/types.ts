import type {
  ExecutionPayload,
  ExecutionStatus,
  GoogleAdsCampaignState,
  InstagramPublishState,
  MailchimpSequenceState,
  MetaAdsCampaignState,
  ProductSeoState,
  ShopifyBlogArticleState,
  ShopifyPageState,
} from '../../types/execution.js';
import type { MCPConnectionService } from '../mcpConnectionService.js';
import type { ShopifyExecutionService } from '../shopifyExecutionService.js';
import type { GoogleAdsCampaignService } from '../googleAdsCampaignService.js';
import type { MetaAdsCampaignService } from '../metaAdsCampaignService.js';
import type { MailchimpExecutionService } from '../mailchimpExecutionService.js';
import type { AdCampaignLibraryService } from '../adCampaignLibraryService.js';

/**
 * Shared contract for the per-platform executors.
 *
 * Background: ExecutionService held six `approve*` methods, all with the
 * signature `(organizationId, executionId, row) => Promise<ExecutionRecord>` and
 * all dispatched from a hand-written `switch`. Because the signatures were
 * identical, `tsc` would accept a switch arm that sent a Meta ad campaign to the
 * Shopify page handler — and the resulting failure would not be a crash but a
 * live storefront page containing ad copy, or a second funded campaign.
 *
 * A registry keyed by `executionType` makes that mis-route structurally
 * impossible rather than something a reviewer has to notice.
 *
 * Deliberate scope: executors own the **external write only**. Claiming,
 * persistence and the audit row stay in ExecutionService, because the atomic
 * claim added in 7400720 is the duplicate-spend guard and must not become
 * something each executor is trusted to remember. An executor returns what
 * should be persisted; the service persists it.
 *
 * Preview generation is *not* here yet — see the note at the end of
 * docs/EXECUTION_SERVICE_SPLIT.md. The characterisation suite covers the approve
 * paths, so those are what moved.
 */

/** Row shape of `action_executions`. */
export type ExecutionRow = {
  id: string;
  organization_id: string;
  strategy_id: string;
  action_id: string;
  platform: string;
  execution_type: string;
  status: ExecutionStatus;
  risk_level: string;
  summary: string;
  target_label: string | null;
  before_state: ExecutionPayload | null;
  proposed_state: ExecutionPayload;
  after_state: ExecutionPayload | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
  executed_at: Date | null;
  rolled_back_at: Date | null;
};

/** Platform clients an executor may reach for. */
export type ExecutorDeps = {
  mcp: MCPConnectionService;
  shopify: ShopifyExecutionService;
  googleAdsCampaign: GoogleAdsCampaignService;
  metaAdsCampaign: MetaAdsCampaignService;
  mailchimpExecution: MailchimpExecutionService;
  adCampaignLibrary: AdCampaignLibraryService;
};

export type ProductSeoEdits = Partial<Pick<ProductSeoState, 'seoTitle' | 'seoDescription'>>;

export type ApplyContext = {
  organizationId: string;
  executionId: string;
  /** The claimed row. Status is already `executing` by the time an executor runs. */
  row: ExecutionRow;
  /** Only meaningful for product SEO, where the user may edit before approving. */
  edits?: ProductSeoEdits;
  deps: ExecutorDeps;
};

/**
 * What to persist after a successful write. Mirrors the options of
 * `ExecutionService.markExecuted`, which is the only thing that writes.
 */
export type ApplyResult = {
  /** Payload returned by the platform. */
  after: ExecutionPayload;
  /** Stored as proposed_state. Defaults to `after` for create paths. */
  proposed?: ExecutionPayload;
  /**
   * COALESCE the existing before_state instead of nulling it. Product SEO only:
   * rollbackProductSeo restores the previous values from it, so nulling it would
   * make the change unrecoverable.
   */
  preserveBeforeState?: boolean;
  /** Replaces the row summary. Omit to leave the existing summary intact. */
  summary?: string;
};

/**
 * Thrown by an executor when it refuses **before** contacting the platform.
 *
 * This distinction decides whether the execution is left retryable, and it must
 * not be guessed. The first version of this split inferred it by pattern-matching
 * error messages in ExecutionService — which meant a reworded guard, or a new one,
 * would silently be classified as "the platform was contacted" and mark the
 * execution permanently `failed`.
 *
 * Now it is explicit:
 *
 *   PreflightRefusal  nothing was sent  -> return to `previewed`, still retryable
 *   any other error   assume it was     -> mark `failed`
 *
 * The default is deliberate. A false `failed` needs a human to look, which is
 * annoying. A false `previewed` invites a retry that could publish a second page
 * or fund a second campaign.
 *
 * `message` still reaches the UI, so it must stay matchable by the
 * SAFE_MESSAGE_PATTERNS list in lib/errorHandler.ts.
 */
export class PreflightRefusal extends Error {
  readonly isPreflightRefusal = true as const;

  constructor(message: string) {
    super(message);
    this.name = 'PreflightRefusal';
  }
}

export function isPreflightRefusal(err: unknown): err is PreflightRefusal {
  return err instanceof PreflightRefusal;
}

export interface PlatformExecutor {
  /** Value of `action_executions.execution_type` this executor handles. */
  readonly executionType: string;
  /** Human label, used in error messages and logs. */
  readonly label: string;
  /**
   * Performs the external write.
   *
   * Called only after the claim has been won. Pre-flight refusals (missing scope,
   * platform not connected, channel cap, cooldown) must throw **before** any
   * external call, because that is what lets ExecutionService return the
   * execution to `previewed` rather than `failed`.
   *
   * Messages for user-facing refusals must stay matchable by the
   * SAFE_MESSAGE_PATTERNS list in lib/errorHandler.ts, or they will be replaced
   * with a generic 500 before reaching the UI.
   */
  apply(ctx: ApplyContext): Promise<ApplyResult>;
}
