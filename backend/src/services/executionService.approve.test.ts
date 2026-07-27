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

    if (normalised.startsWith('UPDATE')) {
      const setStatus = /SET\s+status\s*=\s*'(\w+)'/.exec(normalised)?.[1];

      // The precondition is read from the SQL, never assumed. An earlier version
      // hardcoded "the claim only succeeds from previewed" in the mock, which
      // meant deleting `AND status = 'previewed'` from the real query changed
      // nothing under test — the mock was enforcing the guard on the code's
      // behalf. Mutation testing caught that.
      const requiredStatus = /WHERE[\s\S]*?\bstatus\s*=\s*'(\w+)'/.exec(normalised)?.[1];
      let applies = !requiredStatus || currentRow?.status === requiredStatus;

      // Simulate losing the race: another caller claimed it between our read and
      // our claim, so the row is already executing and we get no rows back.
      if (setStatus === 'executing' && !claimSucceeds) {
        currentRow = { ...(currentRow ?? {}), status: 'executing' };
        applies = false;
      }

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

/**
 * Guards reached by direct module import rather than through injected deps.
 *
 * These are mocked so they can be controlled. Without that, they read through the
 * mocked `query` above, get empty results, and permit everything — which meant
 * deleting the Meta zero-spend throttle or the SEO cooldown changed nothing under
 * test. Mutation testing caught both.
 */
const throttleState = { allowCreate: true, reason: '' };
const cooldownState = { productIds: new Set<string>(), cooldownDays: 7 };
const capsState = { allow: true, reason: '' as string | undefined };

vi.mock('../lib/paidAdThrottle.js', () => ({
  evaluateMetaAdsCreateThrottle: vi.fn(async () => ({ ...throttleState })),
}));

vi.mock('../lib/seoCooldown.js', () => ({
  getSeoCooldownTargets: vi.fn(async () => ({
    productIds: cooldownState.productIds,
    cooldownDays: cooldownState.cooldownDays,
  })),
  evaluateChannelCaps: vi.fn(async () => ({ ...capsState })),
}));

vi.mock('./autopilotService.js', () => ({
  getAutopilotPace: vi.fn(async () => 'normal'),
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
  // Fakes echo the payload they were handed, as the real clients do. A fake that
  // invents its own shape hides bugs in how the result is used — the first draft
  // of this file returned bare stubs, and the summary assertions read
  // "Created Shopify page draft "undefined"" as a result.
  const shopify = {
    applyProductSeo: vi.fn(async (_d: string, _t: string, state: Record<string, unknown>) => ({
      ...state,
      kind: 'product_seo',
    })),
    createPage: vi.fn(async (_d: string, _t: string, state: Record<string, unknown>) => ({
      ...state,
      kind: 'shopify_page',
      pageId: 'page-1',
      shopDomain: 'shop.myshopify.com',
    })),
    createBlogArticle: vi.fn(async (_d: string, _t: string, state: Record<string, unknown>) => ({
      ...state,
      kind: 'shopify_blog_article',
      articleId: 'art-1',
      shopDomain: 'shop.myshopify.com',
    })),
    listBlogs: vi.fn(async () => [{ id: 'blog-1', title: 'News' }]),
    pickDefaultBlog: vi.fn(async () => ({ id: 'blog-1', title: 'News' })),
    deletePage: vi.fn(async () => undefined),
    deleteArticle: vi.fn(async () => undefined),
  };
  const googleAdsCampaign = {
    createPausedCampaign: vi.fn(async (_org: string, state: Record<string, unknown>) => ({
      ...state,
      kind: 'google_ads_campaign',
      campaignId: 'g-1',
    })),
  };
  const metaAdsCampaign = {
    createPausedCampaign: vi.fn(async (_org: string, state: Record<string, unknown>) => ({
      ...state,
      kind: 'meta_ads_campaign',
      campaignId: 'm-1',
      ads: [],
    })),
  };
  const mailchimpExecution = {
    createDraftSequence: vi.fn(async (_ctx: unknown, state: Record<string, unknown>) => ({
      ...state,
      kind: 'mailchimp_sequence',
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
  throttleState.allowCreate = true;
  throttleState.reason = '';
  cooldownState.productIds = new Set();
  cooldownState.cooldownDays = 7;
  capsState.allow = true;
  capsState.reason = undefined;
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

  it('claims with a previewed precondition in the SQL itself', async () => {
    // Structural rather than behavioural, deliberately.
    //
    // approve() also pre-checks the status with a plain read before claiming, and
    // that read shadows the SQL guard in any single-threaded test: remove
    // `AND status = 'previewed'` and every behavioural test still passes, as
    // mutation testing confirmed.
    //
    // But the guard is the only thing that holds in the case it exists for — two
    // callers both passing the pre-check, then both attempting the claim. That
    // race is what 7400720 fixed, and it cannot be reproduced through this
    // interface, so assert the precondition is present in the statement.
    const f = makeFakes();
    currentRow = row();
    await service(f).approve('org-1', 'exec-1');

    const claimSql = sqlIssued().find((s) => s.includes("SET status = 'executing'"))!;
    expect(claimSql).toContain("status = 'previewed'");
    expect(claimSql).toContain('RETURNING *');
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

/**
 * `markExecuted` is now shared by all seven handlers, so its two variants need
 * pinning. Getting `before_state` wrong is not cosmetic: `rollbackProductSeo`
 * restores from it, so nulling it would make a product SEO change
 * unrecoverable — silently, and only discovered when someone tried to undo.
 */
describe('markExecuted variants (shared by every handler)', () => {
  function executedSql(): string {
    return sqlIssued().find((s) => s.includes("SET status = 'executed'")) ?? '';
  }
  /**
   * The success UPDATE specifically. Matching on `status = 'executed'` alone also
   * catches unrelated queries whose parameters happen to contain that text.
   */
  function executedUpdate(): QueryCall {
    // SQL is written as an indented template literal, so normalise before
    // matching on the leading keyword.
    const call = queryCalls.find((c) => {
      const sql = c.sql.replace(/\s+/g, ' ').trim();
      return sql.startsWith('UPDATE action_executions') && sql.includes("status = 'executed'");
    });
    if (!call) throw new Error('no executed UPDATE was issued');
    return call;
  }

  it('product SEO preserves before_state, because rollback restores from it', async () => {
    const f = makeFakes();
    currentRow = row({ execution_type: 'update_product_seo' });
    await service(f).approve('org-1', 'exec-1');
    expect(executedSql()).toContain('before_state = COALESCE(before_state, proposed_state)');
  });

  it('product SEO stores the edited values as proposed_state, not the original', async () => {
    // proposed_state becomes the record of what was actually applied.
    const f = makeFakes();
    currentRow = row();
    await service(f).approve('org-1', 'exec-1', { seoTitle: 'Edited' });
    const call = executedUpdate();
    expect(JSON.stringify(call.params)).toContain('Edited');
  });

  it('product SEO leaves the existing summary untouched', async () => {
    const f = makeFakes();
    currentRow = row();
    await service(f).approve('org-1', 'exec-1');
    expect(executedSql()).toContain('summary = summary');
  });

  it('stamps executed_at and clears any previous error', async () => {
    // executed_at drives "when did this happen" in the activity feed and the
    // outcome measurement window; a stale error_message would keep showing a
    // failure the user already resolved.
    const f = makeFakes();
    currentRow = row();
    await service(f).approve('org-1', 'exec-1');
    expect(executedSql()).toContain('executed_at = NOW()');
    expect(executedSql()).toContain('error_message = NULL');
  });

  it('scopes the update to both id and organization', async () => {
    // Without organization_id in the WHERE clause, a guessed execution id would
    // let one tenant mark another tenant's execution executed.
    const f = makeFakes();
    currentRow = row();
    await service(f).approve('org-1', 'exec-1');
    expect(executedSql()).toMatch(/WHERE id = \$1 AND organization_id = \$2/);
  });

  it.each([
    ['create_shopify_page', { kind: 'shopify_page', title: 'A', handle: 'a', bodyHtml: '<p>x</p>', seoTitle: 'A', seoDescription: 'd', isPublished: false }],
    ['create_google_ads_campaign', { kind: 'google_ads_campaign', campaignName: 'G', campaignId: null }],
    ['create_meta_ads_campaign', { kind: 'meta_ads_campaign', campaignName: 'M', campaignId: null, ads: [] }],
  ])('%s nulls before_state — there is no prior state to restore', async (type, payload) => {
    const f = makeFakes();
    currentRow = row({ execution_type: type, proposed_state: payload });
    await service(f).approve('org-1', 'exec-1');
    expect(executedSql()).toContain('before_state = NULL');
  });

  it('create paths replace the summary with a link the user can follow', async () => {
    const f = makeFakes();
    currentRow = row({
      execution_type: 'create_shopify_page',
      proposed_state: {
        kind: 'shopify_page',
        title: 'About',
        handle: 'about',
        bodyHtml: '<p>x</p>',
        seoTitle: 'About',
        seoDescription: 'd',
        isPublished: false,
      },
    });
    await service(f).approve('org-1', 'exec-1');
    const call = executedUpdate();
    const summary = String(call.params.at(-1));
    expect(summary).toMatch(/Shopify page/i);
    expect(summary).toContain('/pages/about');
  });

  it('the Mailchimp summary always states that nothing is auto-sent', async () => {
    // The load-bearing reassurance for an email integration.
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
    const call = executedUpdate();
    expect(String(call.params.at(-1))).toMatch(/never auto-sent|you send from Mailchimp/i);
  });

  it('saves a Meta campaign to the ad library before writing the audit row', async () => {
    // Ordering preserved from the original: library first, audit second.
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
    expect(f.adCampaignLibrary.upsertFromMetaState).toHaveBeenCalledTimes(1);
    expect(
      f.adCampaignLibrary.upsertFromMetaState.mock.invocationCallOrder[0]!
    ).toBeLessThan(f.audit.recordExecutionWrite.mock.invocationCallOrder[0]!);
  });

  it('still completes when the ad library upsert fails', async () => {
    // The campaign exists in Ads Manager regardless; reconciliation repairs the
    // library later. A library error must not fail the execution.
    const f = makeFakes();
    f.adCampaignLibrary.upsertFromMetaState.mockRejectedValueOnce(new Error('library down'));
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
    await expect(service(f).approve('org-1', 'exec-1')).resolves.toBeTruthy();
    expect(statusTransitions()).toContain('executed');
  });
});

describe('approve() state transitions', () => {
  it('reaches executed on success', async () => {
    const f = makeFakes();
    currentRow = row();
    await service(f).approve('org-1', 'exec-1');
    expect(statusTransitions()).toContain('executed');
    expect(statusTransitions()).not.toContain('failed');
  });

  it('does not undo a completed write when the audit row fails to save', async () => {
    // The platform write already succeeded and the row says executed. Letting the
    // audit failure propagate meant approve()'s catch called markFailed, recording
    // a live Shopify page as failed — so the user would retry and create it twice.
    const f = makeFakes();
    f.audit.recordExecutionWrite.mockRejectedValueOnce(new Error('audit table down'));
    currentRow = row();

    await expect(service(f).approve('org-1', 'exec-1')).resolves.toBeTruthy();
    expect(f.shopify.applyProductSeo).toHaveBeenCalledTimes(1);
    expect(statusTransitions()).toContain('executed');
    expect(statusTransitions()).not.toContain('failed');
  });

  it('does not undo a completed rollback when the audit row fails to save', async () => {
    const f = makeFakes();
    f.audit.recordExecutionWrite.mockRejectedValueOnce(new Error('audit table down'));
    currentRow = row({
      status: 'executed',
      before_state: { kind: 'product_seo', productId: 'p1', seoTitle: 'Old', seoDescription: 'Old' },
      after_state: { kind: 'product_seo', productId: 'p1', seoTitle: 'New', seoDescription: 'New' },
    });

    await expect(service(f).rollback('org-1', 'exec-1')).resolves.toBeTruthy();
    expect(statusTransitions()).toContain('rolled_back');
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
// The registry, and the PreflightRefusal contract it relies on
// ---------------------------------------------------------------------------

describe('executor registry', () => {
  it('registers exactly one executor per approvable type', async () => {
    const { EXECUTORS, APPROVABLE_EXECUTION_TYPES } = await import('./execution/registry.js');
    expect(new Set(APPROVABLE_EXECUTION_TYPES).size).toBe(EXECUTORS.length);
  });

  it('covers every type approve() accepts, and no others', async () => {
    const { APPROVABLE_EXECUTION_TYPES } = await import('./execution/registry.js');
    expect([...APPROVABLE_EXECUTION_TYPES].sort()).toEqual(
      [
        'create_google_ads_campaign',
        'create_mailchimp_drafts',
        'create_meta_ads_campaign',
        'create_shopify_blog_article',
        'create_shopify_page',
        'update_product_seo',
      ].sort()
    );
  });

  it('each executor declares the type it is registered under', async () => {
    // Guards against an entry being added to the list while its executionType
    // still says something else — which would silently register it for the wrong
    // type.
    const { EXECUTORS, findExecutor } = await import('./execution/registry.js');
    for (const executor of EXECUTORS) {
      expect(findExecutor(executor.executionType)).toBe(executor);
    }
  });

  it('returns undefined for an unknown type rather than a default', async () => {
    // A default would mean a new execution type silently gets someone else's
    // platform.
    const { findExecutor } = await import('./execution/registry.js');
    expect(findExecutor('create_tiktok_post')).toBeUndefined();
    expect(findExecutor('')).toBeUndefined();
  });
});

/**
 * The guards that stop the agent doing something expensive or counterproductive.
 * Each must refuse *before* the external call, and leave the execution retryable.
 */
describe('spend and quality guards refuse before reaching the platform', () => {
  const metaRow = () =>
    row({
      platform: 'meta_ads',
      execution_type: 'create_meta_ads_campaign',
      proposed_state: {
        kind: 'meta_ads_campaign',
        campaignName: 'M',
        campaignId: null,
        ads: [],
      },
    });

  it('the Meta zero-spend throttle blocks a new campaign', async () => {
    // The guard that stops budget going out while earlier campaigns sit unspent.
    throttleState.allowCreate = false;
    throttleState.reason =
      'Earlier Meta campaigns have $0 spend — no signal to learn from yet. Enable spend on one before creating another.';

    const f = makeFakes();
    currentRow = metaRow();

    await expect(service(f).approve('org-1', 'exec-1')).rejects.toThrow(/\$0 spend/);
    expect(f.metaAdsCampaign.createPausedCampaign).not.toHaveBeenCalled();
    // Retryable: it becomes allowed once the earlier campaign spends.
    expect(statusTransitions()).toContain('previewed');
    expect(statusTransitions()).not.toContain('failed');
  });

  it('the throttle is skipped for a re-run against an existing campaign', async () => {
    // campaignId already set means this is not a new campaign, so the
    // "don't create another" rule does not apply.
    throttleState.allowCreate = false;
    throttleState.reason = 'blocked';

    const f = makeFakes();
    currentRow = row({
      platform: 'meta_ads',
      execution_type: 'create_meta_ads_campaign',
      proposed_state: {
        kind: 'meta_ads_campaign',
        campaignName: 'M',
        campaignId: 'existing-123',
        ads: [],
      },
    });

    await expect(service(f).approve('org-1', 'exec-1')).resolves.toBeTruthy();
    expect(f.metaAdsCampaign.createPausedCampaign).toHaveBeenCalledTimes(1);
  });

  it('the SEO cooldown blocks re-editing the same product', async () => {
    // Re-editing churns rankings without producing measurable signal.
    cooldownState.productIds = new Set(['p1']);
    cooldownState.cooldownDays = 14;

    const f = makeFakes();
    currentRow = row();

    await expect(service(f).approve('org-1', 'exec-1')).rejects.toThrow(
      /within the last 14 days/
    );
    expect(f.shopify.applyProductSeo).not.toHaveBeenCalled();
    expect(statusTransitions()).toContain('previewed');
  });

  it('the cooldown allows a different product', async () => {
    cooldownState.productIds = new Set(['some-other-product']);
    const f = makeFakes();
    currentRow = row();
    await expect(service(f).approve('org-1', 'exec-1')).resolves.toBeTruthy();
    expect(f.shopify.applyProductSeo).toHaveBeenCalledTimes(1);
  });

  it('the daily channel cap blocks further SEO writes', async () => {
    capsState.allow = false;
    capsState.reason = 'Product SEO daily cap reached';

    const f = makeFakes();
    currentRow = row();

    await expect(service(f).approve('org-1', 'exec-1')).rejects.toThrow(/daily cap reached/);
    expect(f.shopify.applyProductSeo).not.toHaveBeenCalled();
    expect(statusTransitions()).toContain('previewed');
  });

  it('falls back to a usable message when the cap gives no reason', async () => {
    capsState.allow = false;
    capsState.reason = undefined;
    const f = makeFakes();
    currentRow = row();
    await expect(service(f).approve('org-1', 'exec-1')).rejects.toThrow(
      /Product SEO daily cap reached/
    );
  });
});

describe('rollback() routes through the same registry', () => {
  function executedRow(overrides: Record<string, unknown> = {}) {
    return row({
      status: 'executed',
      before_state: {
        kind: 'product_seo',
        productId: 'p1',
        productTitle: 'Product A',
        seoTitle: 'Original title',
        seoDescription: 'Original description',
      },
      after_state: {
        kind: 'product_seo',
        productId: 'p1',
        productTitle: 'Product A',
        seoTitle: 'New title',
        seoDescription: 'New description',
      },
      ...overrides,
    });
  }

  it('restores product SEO from before_state', async () => {
    const f = makeFakes();
    currentRow = executedRow();
    await service(f).rollback('org-1', 'exec-1');

    expect(f.shopify.applyProductSeo).toHaveBeenCalledTimes(1);
    const [, , payload] = f.shopify.applyProductSeo.mock.calls[0]!;
    // The *original* values, not the ones that were applied.
    expect(payload).toMatchObject({ seoTitle: 'Original title' });
    expect(statusTransitions()).toContain('rolled_back');
  });

  it('deletes the page it created, by id', async () => {
    const f = makeFakes();
    currentRow = executedRow({
      execution_type: 'create_shopify_page',
      before_state: null,
      after_state: { kind: 'shopify_page', pageId: 'page-99', title: 'About' },
    });
    await service(f).rollback('org-1', 'exec-1');

    expect(f.shopify.deletePage).toHaveBeenCalledWith(
      'shop.myshopify.com',
      't',
      'page-99'
    );
  });

  it('deletes the blog article it created', async () => {
    const f = makeFakes();
    currentRow = executedRow({
      execution_type: 'create_shopify_blog_article',
      before_state: null,
      after_state: { kind: 'shopify_blog_article', articleId: 'art-99', title: 'Post' },
    });
    await service(f).rollback('org-1', 'exec-1');
    expect(f.shopify.deleteArticle).toHaveBeenCalledWith('shop.myshopify.com', 't', 'art-99');
  });

  it('refuses when the platform cannot undo the write', async () => {
    // Both ad platforms and Mailchimp have no rollback. Telling a user their
    // campaign was rolled back when it still exists in Ads Manager would stop
    // them looking for it.
    const f = makeFakes();
    currentRow = executedRow({
      platform: 'meta_ads',
      execution_type: 'create_meta_ads_campaign',
      before_state: null,
      after_state: { kind: 'meta_ads_campaign', campaignName: 'M', campaignId: 'm-1', ads: [] },
    });

    await expect(service(f).rollback('org-1', 'exec-1')).rejects.toThrow(
      /cannot be rolled back automatically/
    );
    expect(statusTransitions()).not.toContain('rolled_back');
  });

  it('names the platform in the refusal so the user knows where to look', async () => {
    const f = makeFakes();
    currentRow = executedRow({
      platform: 'mailchimp',
      execution_type: 'create_mailchimp_drafts',
      before_state: null,
      after_state: { kind: 'mailchimp_sequence', sequenceName: 'W', emails: [] },
    });
    await expect(service(f).rollback('org-1', 'exec-1')).rejects.toThrow(/Mailchimp/);
  });

  it('refuses to roll back something that never executed', async () => {
    const f = makeFakes();
    currentRow = row({ status: 'previewed' });
    await expect(service(f).rollback('org-1', 'exec-1')).rejects.toThrow(
      /Only executed actions/
    );
    expect(f.shopify.applyProductSeo).not.toHaveBeenCalled();
  });

  it('refuses when before_state is missing, rather than writing something wrong', async () => {
    const f = makeFakes();
    currentRow = executedRow({ before_state: null });
    await expect(service(f).rollback('org-1', 'exec-1')).rejects.toThrow(/No before-state/);
    expect(f.shopify.applyProductSeo).not.toHaveBeenCalled();
  });

  it('refuses to delete a page with no stored id', async () => {
    // Guessing by handle could delete a page someone created by hand.
    const f = makeFakes();
    currentRow = executedRow({
      execution_type: 'create_shopify_page',
      before_state: null,
      after_state: { kind: 'shopify_page', pageId: null, title: 'About' },
    });
    await expect(service(f).rollback('org-1', 'exec-1')).rejects.toThrow(/No page ID/);
    expect(f.shopify.deletePage).not.toHaveBeenCalled();
  });

  it('records an audit entry with the rolled-back event type', async () => {
    const f = makeFakes();
    currentRow = executedRow();
    await service(f).rollback('org-1', 'exec-1');
    expect(f.audit.recordExecutionWrite.mock.calls[0]![0]).toMatchObject({
      eventType: 'action_rolled_back',
    });
  });

  it('stamps rolled_back_at and scopes the update to the organization', async () => {
    const f = makeFakes();
    currentRow = executedRow();
    await service(f).rollback('org-1', 'exec-1');
    const sql = sqlIssued().find((s) => s.includes("status = 'rolled_back'"))!;
    expect(sql).toContain('rolled_back_at = NOW()');
    expect(sql).toMatch(/WHERE id = \$1 AND organization_id = \$2/);
  });
});

describe('PreflightRefusal decides retryability', () => {
  it('a refusal from an executor leaves the execution previewed', async () => {
    const { PreflightRefusal } = await import('./execution/types.js');
    const f = makeFakes();
    f.mcp.getShopifyContext.mockImplementationOnce(async () => {
      throw new PreflightRefusal('Shopify is not connected');
    });
    currentRow = row();

    await expect(service(f).approve('org-1', 'exec-1')).rejects.toThrow(/not connected/);
    expect(statusTransitions()).toContain('previewed');
    expect(statusTransitions()).not.toContain('failed');
  });

  it('a plain Error is assumed to have reached the platform and marks failed', async () => {
    // The safe default: if we cannot prove nothing was sent, do not invite a
    // retry that could double-apply.
    const f = makeFakes();
    f.shopify.applyProductSeo.mockRejectedValueOnce(new Error('socket hang up'));
    currentRow = row();

    await expect(service(f).approve('org-1', 'exec-1')).rejects.toThrow('socket hang up');
    expect(statusTransitions()).toContain('failed');
    expect(statusTransitions()).not.toContain('previewed');
  });

  it('a payload-mismatch guard marks failed, because routing is a code bug', async () => {
    // asProductSeo throwing means the wrong executor received this row. Leaving it
    // previewed would let it be retried into the same wrong executor forever.
    const f = makeFakes();
    currentRow = row({ proposed_state: { kind: 'shopify_page' } });
    await expect(service(f).approve('org-1', 'exec-1')).rejects.toThrow(/Expected .* payload/);
    expect(f.shopify.applyProductSeo).not.toHaveBeenCalled();
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
