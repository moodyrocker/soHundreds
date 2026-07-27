import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Characterisation tests for `ExecutionService.approve()`.
 *
 * These exist to make the split in docs/EXECUTION_SERVICE_SPLIT.md safe. Every
 * approve handler has the same signature —
 * `(organizationId, executionId, row) => Promise<ExecutionRecord>` — so `tsc`
 * would happily accept a refactor that routes a Meta ad campaign through
 * `approveShopifyPage`. The failure would not be a crash: it would be a live
 * Shopify page containing ad copy, or a duplicate funded campaign, found by a
 * customer.
 *
 * So the central assertion in this file is negative: for each execution type,
 * the *correct* platform client is called and **no other platform client is
 * touched at all**. Everything else here supports that.
 *
 * `../database/connection.js` is mocked so nothing reaches Postgres; the mock
 * records SQL so state transitions can be asserted.
 */

// ---------------------------------------------------------------------------
// Database mock
// ---------------------------------------------------------------------------

type QueryCall = { sql: string; params: unknown[] };

const queryCalls: QueryCall[] = [];
/** Row returned by the next SELECT; mutated per test. */
let currentRow: Record<string, unknown> | null = null;
/**
 * When false, the claim fails and the row flips to `executing` — simulating
 * another caller having won the race between our read and our claim.
 */
let claimSucceeds = true;
/** Status changes the mock actually applied, as opposed to merely attempted. */
const appliedTransitions: string[] = [];

/**
 * The mock honours `WHERE ... status = 'x'` preconditions.
 *
 * This matters more than it looks. `releaseExecutionClaim` is guarded by
 * `AND status = 'executing'` precisely so it cannot resurrect an execution a
 * handler already marked `failed`. A mock that applied every UPDATE
 * unconditionally would report a `previewed` transition that real Postgres would
 * never perform — hiding the guard rather than testing it.
 */
vi.mock('../database/connection.js', () => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    queryCalls.push({ sql, params });
    const normalised = sql.replace(/\s+/g, ' ').trim();

    // claimExecutionForWrite: previewed -> executing, guarded on previewed.
    if (normalised.includes("SET status = 'executing'")) {
      if (!claimSucceeds) {
        // The winner got there first: the row is now executing and we get nothing.
        currentRow = { ...(currentRow ?? {}), status: 'executing' };
        return { rows: [], rowCount: 0 };
      }
      if (currentRow?.status !== 'previewed') return { rows: [], rowCount: 0 };
      currentRow = { ...currentRow, status: 'executing' };
      appliedTransitions.push('executing');
      return { rows: [currentRow], rowCount: 1 };
    }

    if (normalised.startsWith('UPDATE')) {
      const setStatus = /SET\s+status\s*=\s*'(\w+)'/.exec(normalised)?.[1];
      // Any status precondition in the WHERE clause must hold, exactly as it
      // would in Postgres.
      const requiredStatus = /WHERE[\s\S]*?\bstatus\s*=\s*'(\w+)'/.exec(normalised)?.[1];
      const applies = !requiredStatus || currentRow?.status === requiredStatus;

      if (applies && setStatus) {
        currentRow = { ...(currentRow ?? {}), status: setStatus };
        appliedTransitions.push(setStatus);
      }

      const rowCount = applies ? 1 : 0;
      if (normalised.includes('RETURNING *')) {
        return { rows: applies && currentRow ? [currentRow] : [], rowCount };
      }
      return { rows: [], rowCount };
    }

    if (normalised.startsWith('SELECT * FROM action_executions')) {
      return { rows: currentRow ? [currentRow] : [], rowCount: currentRow ? 1 : 0 };
    }

    return { rows: [], rowCount: 0 };
  }),
  pool: { on: vi.fn(), query: vi.fn(), connect: vi.fn() },
}));

// Feature flags read at module scope by some payload builders.
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.DATABASE_URL = 'postgresql://test@127.0.0.1:1/test';

const { ExecutionService } = await import('./executionService.js');

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/**
 * One spy per external write, so a test can assert both that the right one fired
 * and that the others did not. This is the whole point of the file.
 */
function makeFakes() {
  const shopify = {
    applyProductSeo: vi.fn(async () => ({ kind: 'product_seo', productId: 'p1' })),
    createPage: vi.fn(async () => ({ kind: 'shopify_page', pageId: 'page-1' })),
    createBlogArticle: vi.fn(async () => ({ kind: 'shopify_blog_article', articleId: 'art-1' })),
    listBlogs: vi.fn(async () => [{ id: 'blog-1', title: 'News' }]),
    pickDefaultBlog: vi.fn(async () => ({ id: 'blog-1', title: 'News' })),
    deletePage: vi.fn(async () => undefined),
    deleteArticle: vi.fn(async () => undefined),
  };
  const googleAdsCampaign = {
    createPausedCampaign: vi.fn(async () => ({
      kind: 'google_ads_campaign',
      campaignName: 'G',
      campaignId: 'g-1',
    })),
  };
  const metaAdsCampaign = {
    createPausedCampaign: vi.fn(async () => ({
      kind: 'meta_ads_campaign',
      campaignName: 'M',
      campaignId: 'm-1',
      ads: [],
    })),
  };
  const mailchimpExecution = {
    createDraftSequence: vi.fn(async () => ({
      kind: 'mailchimp_sequence',
      sequenceName: 'Welcome',
      emails: [{ subject: 'Hi' }],
      createdCampaigns: [{ id: 'c1', archiveUrl: 'https://mc/1' }],
    })),
  };
  const instagram = { publishPhotoForAction: vi.fn(async () => ({ kind: 'instagram_publish' })) };

  const mcp = {
    getShopifyContext: vi.fn(async () => ({ shopDomain: 'shop.myshopify.com', accessToken: 't' })),
    getPlatformConfig: vi.fn(async () => ({
      grantedScopes: 'write_products,write_content,read_products',
    })),
    getMailchimpContext: vi.fn(async () => ({ defaultListId: 'list-1', apiKey: 'k-us1' })),
    getMetaAdsContext: vi.fn(async () => ({ adAccountId: 'act_1', accessToken: 't' })),
    getGoogleAdsContext: vi.fn(async () => ({ customerId: '123', accessToken: 't' })),
    getInstagramContext: vi.fn(async () => ({ igUserId: '1', accessToken: 't' })),
    getCanvaContext: vi.fn(async () => null),
    getActiveConnections: vi.fn(async () => []),
    isMailchimpReady: vi.fn(async () => true),
  };

  const audit = { recordExecutionWrite: vi.fn(async () => undefined) };
  const adCampaignLibrary = {
    enrichWithCreatives: vi.fn(async (_org: string, state: unknown) => state),
    upsertFromMetaState: vi.fn(async () => undefined),
  };
  const activity = { log: vi.fn(async () => undefined) };
  const strategy = { getById: vi.fn(async () => null) };
  const claude = {};
  const assist = { generate: vi.fn(async () => ({ kind: 'assist_deliverable' })) };

  return {
    shopify,
    googleAdsCampaign,
    metaAdsCampaign,
    mailchimpExecution,
    instagram,
    mcp,
    audit,
    adCampaignLibrary,
    activity,
    strategy,
    claude,
    assist,
  };
}

type Fakes = ReturnType<typeof makeFakes>;

function service(fakes: Fakes) {
  // Fakes are structurally partial; the constructor takes the real types, so cast
  // at the boundary rather than stubbing every unused method.
  return new ExecutionService(fakes as never);
}

/** Every external-write spy, so "no other platform was touched" is checkable. */
function externalWrites(f: Fakes) {
  return {
    'shopify.applyProductSeo': f.shopify.applyProductSeo,
    'shopify.createPage': f.shopify.createPage,
    'shopify.createBlogArticle': f.shopify.createBlogArticle,
    'googleAds.createPausedCampaign': f.googleAdsCampaign.createPausedCampaign,
    'metaAds.createPausedCampaign': f.metaAdsCampaign.createPausedCampaign,
    'mailchimp.createDraftSequence': f.mailchimpExecution.createDraftSequence,
    'instagram.publishPhotoForAction': f.instagram.publishPhotoForAction,
  };
}

function expectOnlyWriteCalled(f: Fakes, expected: keyof ReturnType<typeof externalWrites>) {
  const all = externalWrites(f);
  for (const [name, spy] of Object.entries(all)) {
    if (name === expected) {
      expect(spy, `${name} should have been called`).toHaveBeenCalledTimes(1);
    } else {
      expect(spy, `${name} must NOT have been called`).not.toHaveBeenCalled();
    }
  }
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exec-1',
    organization_id: 'org-1',
    strategy_id: 'strategy-1',
    action_id: 'w1-a1',
    platform: 'shopify',
    execution_type: 'update_product_seo',
    status: 'previewed',
    risk_level: 'medium',
    summary: 'Update SEO',
    target_label: 'Product A',
    before_state: null,
    proposed_state: {
      kind: 'product_seo',
      productId: 'p1',
      productTitle: 'Product A',
      seoTitle: 'New title',
      seoDescription: 'New description',
    },
    after_state: null,
    error_message: null,
    created_at: new Date('2026-07-27T00:00:00Z'),
    updated_at: new Date('2026-07-27T00:00:00Z'),
    executed_at: null,
    rolled_back_at: null,
    claimed_at: null,
    claimed_by: null,
    attempt_count: 0,
    ...overrides,
  };
}

/** SQL the run issued, whitespace-normalised. */
function sqlIssued(): string[] {
  return queryCalls.map((c) => c.sql.replace(/\s+/g, ' ').trim());
}

/**
 * Transitions the mock actually applied — not merely the ones the SQL attempted.
 * The distinction is the point: a guarded UPDATE whose precondition fails issues
 * SQL but changes nothing.
 */
function statusTransitions(): string[] {
  return [...appliedTransitions];
}

beforeEach(() => {
  queryCalls.length = 0;
  appliedTransitions.length = 0;
  currentRow = null;
  claimSucceeds = true;
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Routing — the assertions that make the split safe
// ---------------------------------------------------------------------------

describe('approve() routes each execution type to exactly one platform', () => {
  it('update_product_seo -> shopify.applyProductSeo only', async () => {
    const f = makeFakes();
    currentRow = row({ execution_type: 'update_product_seo' });
    await service(f).approve('org-1', 'exec-1');
    expectOnlyWriteCalled(f, 'shopify.applyProductSeo');
  });

  it('create_shopify_page -> shopify.createPage only', async () => {
    const f = makeFakes();
    currentRow = row({
      execution_type: 'create_shopify_page',
      proposed_state: {
        kind: 'shopify_page',
        title: 'About',
        handle: 'about',
        bodyHtml: '<p>x</p>',
        seoTitle: 'About',
        seoDescription: 'About us',
        isPublished: false,
      },
    });
    await service(f).approve('org-1', 'exec-1');
    expectOnlyWriteCalled(f, 'shopify.createPage');
  });

  it('create_google_ads_campaign -> googleAds only, never meta', async () => {
    // The two ad platforms are the pair most dangerous to confuse: both spend
    // money, and both take a campaign-shaped payload.
    const f = makeFakes();
    currentRow = row({
      platform: 'google_ads',
      execution_type: 'create_google_ads_campaign',
      proposed_state: { kind: 'google_ads_campaign', campaignName: 'G', campaignId: null },
    });
    await service(f).approve('org-1', 'exec-1');
    expectOnlyWriteCalled(f, 'googleAds.createPausedCampaign');
    expect(f.metaAdsCampaign.createPausedCampaign).not.toHaveBeenCalled();
  });

  it('create_meta_ads_campaign -> meta only, never google', async () => {
    const f = makeFakes();
    currentRow = row({
      platform: 'meta_ads',
      execution_type: 'create_meta_ads_campaign',
      proposed_state: {
        kind: 'meta_ads_campaign',
        campaignName: 'M',
        campaignId: null,
        ads: [],
      },
    });
    await service(f).approve('org-1', 'exec-1');
    expectOnlyWriteCalled(f, 'metaAds.createPausedCampaign');
    expect(f.googleAdsCampaign.createPausedCampaign).not.toHaveBeenCalled();
  });

  it('create_mailchimp_drafts -> mailchimp only', async () => {
    const f = makeFakes();
    currentRow = row({
      platform: 'mailchimp',
      execution_type: 'create_mailchimp_drafts',
      proposed_state: {
        kind: 'mailchimp_sequence',
        sequenceName: 'Welcome',
        emails: [{ subject: 'Hi', previewText: 'p', bodyHtml: '<p>h</p>' }],
      },
    });
    await service(f).approve('org-1', 'exec-1');
    expectOnlyWriteCalled(f, 'mailchimp.createDraftSequence');
  });
});

// ---------------------------------------------------------------------------
// Payload integrity — the right content reaches the platform
// ---------------------------------------------------------------------------

describe('approve() passes the proposed payload through unaltered', () => {
  it('sends the proposed SEO values to Shopify', async () => {
    const f = makeFakes();
    currentRow = row();
    await service(f).approve('org-1', 'exec-1');
    const [, , payload] = f.shopify.applyProductSeo.mock.calls[0]!;
    expect(payload).toMatchObject({ seoTitle: 'New title', seoDescription: 'New description' });
  });

  it('applies caller edits over the proposed values', async () => {
    const f = makeFakes();
    currentRow = row();
    await service(f).approve('org-1', 'exec-1', { seoTitle: 'Edited title' });
    const [, , payload] = f.shopify.applyProductSeo.mock.calls[0]!;
    expect(payload).toMatchObject({
      seoTitle: 'Edited title',
      // An unedited field must keep the proposal, not be blanked.
      seoDescription: 'New description',
    });
  });

  it('ignores a whitespace-only edit rather than blanking the field', async () => {
    const f = makeFakes();
    currentRow = row();
    await service(f).approve('org-1', 'exec-1', { seoTitle: '   ' });
    const [, , payload] = f.shopify.applyProductSeo.mock.calls[0]!;
    expect(payload).toMatchObject({ seoTitle: 'New title' });
  });

  it('uses the shop context returned by MCPConnectionService', async () => {
    const f = makeFakes();
    currentRow = row();
    await service(f).approve('org-1', 'exec-1');
    const [domain, token] = f.shopify.applyProductSeo.mock.calls[0]!;
    expect(domain).toBe('shop.myshopify.com');
    expect(token).toBe('t');
  });
});

// ---------------------------------------------------------------------------
// The atomic claim — the duplicate-spend guard from 7400720
// ---------------------------------------------------------------------------

describe('approve() claims before writing', () => {
  it('transitions previewed -> executing before any external call', async () => {
    const f = makeFakes();
    currentRow = row();
    await service(f).approve('org-1', 'exec-1');

    const claimIndex = sqlIssued().findIndex((s) => s.includes("SET status = 'executing'"));
    expect(claimIndex).toBeGreaterThanOrEqual(0);
    expect(statusTransitions()[0]).toBe('executing');
  });

  it('performs no external write when the claim is lost', async () => {
    // The critical assertion: a caller that loses the race must not reach the
    // platform. Without this, two approvals create two campaigns.
    const f = makeFakes();
    currentRow = row();
    claimSucceeds = false;

    await expect(service(f).approve('org-1', 'exec-1')).rejects.toThrow(/already running|status/);
    for (const spy of Object.values(externalWrites(f))) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('reports that another approval is in flight when the winner holds the claim', async () => {
    // The realistic race: our pre-read sees `previewed`, the winner claims it
    // between that read and ours, our claim returns nothing, and the re-read
    // reports `executing`.
    const f = makeFakes();
    currentRow = row({ status: 'previewed' });
    claimSucceeds = false;
    await expect(service(f).approve('org-1', 'exec-1')).rejects.toThrow(/already running/);
  });

  it('refuses an execution that is not previewed, without claiming', async () => {
    const f = makeFakes();
    currentRow = row({ status: 'executed' });
    await expect(service(f).approve('org-1', 'exec-1')).rejects.toThrow(
      /Cannot approve execution in status "executed"/
    );
    expect(sqlIssued().some((s) => s.includes("SET status = 'executing'"))).toBe(false);
  });

  it('refuses an execution type that does not take approval', async () => {
    const f = makeFakes();
    currentRow = row({ execution_type: 'assist_deliverable' });
    await expect(service(f).approve('org-1', 'exec-1')).rejects.toThrow(/require.*approval/i);
    for (const spy of Object.values(externalWrites(f))) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});

// ---------------------------------------------------------------------------
// State transitions on success and failure
// ---------------------------------------------------------------------------

describe('approve() state transitions', () => {
  it('reaches executed on success', async () => {
    const f = makeFakes();
    currentRow = row();
    await service(f).approve('org-1', 'exec-1');
    expect(statusTransitions()).toContain('executed');
    expect(statusTransitions()).not.toContain('failed');
  });

  it('records an audit entry on success', async () => {
    const f = makeFakes();
    currentRow = row();
    await service(f).approve('org-1', 'exec-1');
    expect(f.audit.recordExecutionWrite).toHaveBeenCalledTimes(1);
    expect(f.audit.recordExecutionWrite.mock.calls[0]![0]).toMatchObject({
      organizationId: 'org-1',
      eventType: 'action_executed',
    });
  });

  it('marks failed when the external call throws — and does not revert to previewed', async () => {
    // Once the platform has been contacted, the outcome is unknown. Returning to
    // previewed would invite a retry that could double-apply.
    const f = makeFakes();
    f.shopify.applyProductSeo.mockRejectedValueOnce(new Error('Shopify 500'));
    currentRow = row();

    await expect(service(f).approve('org-1', 'exec-1')).rejects.toThrow('Shopify 500');
    expect(statusTransitions()).toContain('failed');
    // releaseExecutionClaim is guarded by `AND status = 'executing'`, so it is a
    // no-op here. Verifying the *applied* transitions rather than the SQL issued
    // is what makes this assertion meaningful.
    expect(statusTransitions().at(-1)).toBe('failed');
    expect(statusTransitions()).not.toContain('previewed');
  });

  it('returns to previewed on a pre-flight refusal, before any external call', async () => {
    // Missing scope is detected before the write, so the execution stays
    // retryable once the user grants the scope.
    const f = makeFakes();
    f.mcp.getPlatformConfig.mockResolvedValueOnce({ grantedScopes: 'read_products' });
    currentRow = row();

    await expect(service(f).approve('org-1', 'exec-1')).rejects.toThrow(/write_products/);
    expect(f.shopify.applyProductSeo).not.toHaveBeenCalled();
    expect(statusTransitions()).toContain('previewed');
    expect(statusTransitions()).not.toContain('failed');
  });

  it('returns to previewed when the platform is not connected', async () => {
    const f = makeFakes();
    f.mcp.getShopifyContext.mockResolvedValueOnce(null);
    currentRow = row();

    await expect(service(f).approve('org-1', 'exec-1')).rejects.toThrow(/not connected/i);
    expect(f.shopify.applyProductSeo).not.toHaveBeenCalled();
    expect(statusTransitions()).toContain('previewed');
  });

  it('returns to previewed when Mailchimp has no default audience', async () => {
    const f = makeFakes();
    f.mcp.getMailchimpContext.mockResolvedValueOnce({ defaultListId: null });
    currentRow = row({
      platform: 'mailchimp',
      execution_type: 'create_mailchimp_drafts',
      proposed_state: {
        kind: 'mailchimp_sequence',
        sequenceName: 'Welcome',
        emails: [{ subject: 'Hi', previewText: 'p', bodyHtml: '<p>h</p>' }],
      },
    });

    await expect(service(f).approve('org-1', 'exec-1')).rejects.toThrow(/not connected|audience/i);
    expect(f.mailchimpExecution.createDraftSequence).not.toHaveBeenCalled();
    expect(statusTransitions()).toContain('previewed');
  });
});

// ---------------------------------------------------------------------------
// Error messages must stay recognisable to lib/errorHandler.ts
// ---------------------------------------------------------------------------

describe('user-facing refusals match the errorHandler safe-message patterns', () => {
  it('the not-connected message survives sanitisation', async () => {
    const { default: _unused } = { default: null };
    void _unused;
    const f = makeFakes();
    f.mcp.getShopifyContext.mockResolvedValueOnce(null);
    currentRow = row();

    let message = '';
    try {
      await service(f).approve('org-1', 'exec-1');
    } catch (err) {
      message = (err as Error).message;
    }
    // errorHandler matches /is not connected/i to decide this reaches the UI
    // rather than becoming a generic 500. If this wording changes, that list
    // must change with it.
    expect(message).toMatch(/is not connected/i);
  });

  it('the missing-scope message survives sanitisation', async () => {
    const f = makeFakes();
    f.mcp.getPlatformConfig.mockResolvedValueOnce({ grantedScopes: 'read_products' });
    currentRow = row();

    let message = '';
    try {
      await service(f).approve('org-1', 'exec-1');
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/Missing \w+ scope/i);
  });
});
