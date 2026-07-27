# Splitting `executionService.ts` — plan

**Status:** steps 1–4 done. The approve paths are extracted; preview generation is
not. See §7 for what remains.

| Step | Status | Commit |
|---|---|---|
| 0 — unit tests for parsers and guards | done | `860d9da` |
| 1 — constructor injection + characterisation net | done | `b5e61f7` |
| 2 — `markExecuted` / `markFailed` | done | `c8ef94d` |
| 3 — six platform executors | done | `55280f2` |
| 4 — registry replaces the switch | done | `55280f2` |
| — Instagram publish guard | done | `9cbb7e9` |
| — rollback into executors | done | `cb31f04` |
| 5 — preview extraction | **not started** | — |
| 6 — `claudeService` prompt extraction | not started | — |

> **Note on commit hashes.** History from step 0 onward was rewritten to remove a
> test fixture that matched the format of a real Shopify token (GitHub push
> protection blocked it, correctly — the fixture was `shpat_` plus 32 hex
> characters, which is indistinguishable from a live credential to a scanner).
> The hashes above are the post-rewrite ones. One commit message — step 2's —
> still refers to step 1 by its pre-rewrite hash `a82a35c`; that commit is now
> `b5e61f7`. References to `7400720` and earlier predate the rewrite and remain
> valid.

`backend/src/services/executionService.ts` is 2,981 lines in a single class with
49 methods. Every branch in it performs an irreversible external write: a live
Shopify page, a published Instagram post, a funded ad campaign.

---

## 1. Why not just do it

A refactor here cannot be verified by `tsc`. Every `approve*` handler has the
same shape — take a context, call an external API, write status — and the same
types. A type checker will happily accept a version that routes a Meta campaign
through `approveShopifyPage`, because both are
`(organizationId: string, executionId: string, row: ExecutionRow) => Promise<ExecutionRecord>`.

The failure mode is not a crash. It is a duplicate ad campaign, or a Shopify page
created with an Instagram caption in the body, discovered by a customer.

So the sequence matters: characterise behaviour, then move code, then verify
against the characterisation.

---

## 2. What the file actually contains

Grouped by concern, with current line ranges:

| Concern | Methods | Lines (approx) |
|---|---|---|
| **Orchestration** | `runWeekBatch`, `runWeek`, `runWeekActions`, `runWeekAutopilot`, `finalizeForSequentialStep` | 266–650, 1239 |
| **Preview generation** | `preview`, `executeActionPreview*`, `runShopifyPagePreview`, `runShopifyBlogPreview`, `runShopifyProductSeoPreview`, `runGoogleAdsCampaignPreview`, `runMetaAdsCampaignPreview`, `runMailchimpSequencePreview` | 664–979, 2175–2817 |
| **Approval / external write** | `approve`, `approveProductSeo`, `approveShopifyPage`, `approveShopifyBlogArticle`, `approveGoogleAdsCampaign`, `approveMetaAdsCampaign`, `approveMailchimpSequence` | 1465–1882, 2233 |
| **Rollback** | `rollback`, `rollbackProductSeo`, `rollbackShopifyPage`, `rollbackShopifyBlogArticle` | 1897–2007, 2319 |
| **Auto-apply decisioning** | `canAutoApplyExecution`, `tryAutoApplyExecution`, `autoApplyTitle`, `autoApplyDoneTitle`, `publishedDoneTitle` | 1249–1448 |
| **Agent tasks** | `runAgentTask`, `isAdHocInstagramContentRequest`, `buildAdHocInstagramAction`, `mergeAgentExecutionBrief` | 979–1239, 2007–2085 |
| **Activity copy** | `actionDecisionLabel`, `actionExecutingDetail`, `agentTaskCompleteDetail`, `metaCreatedSummary`, `googleCreatedSummary`, `logPreflightActivity` | 323, 766–864, 1448 |
| **Persistence / claiming** | `getRow`, `claimExecutionForWrite`, `releaseExecutionClaim`, `loadAction`, `listForStrategy`, `skip` | 1882, 2817, 2869+ |
| **Integration flags** | `getIntegrationFlags`, `getIntegrationFlagsPublic`, `buildMcpCapabilityNotes` | 223, 2868–2874 |

The important observation: **per-platform executors already exist** and are
comparatively small — `shopifyExecutionService` (507), `instagramExecutionService`
(461), `mailchimpExecutionService` (78), `googleAdsCampaignService` (196),
`metaAdsCampaignService` (230). `executionService` is not doing the platform work;
it is doing the *orchestration around* the platform work, and the two have grown
together.

`executors/actionRouter.ts` (872 lines) already exists as a dispatch layer, so
the seam is present — it just is not used for approve/rollback.

---

## 3. Target shape

```
services/
  executionService.ts          orchestration + persistence only  (~700 lines)
  execution/
    types.ts                   PlatformExecutor interface, shared row types
    registry.ts                executionType -> PlatformExecutor
    shopifyPageExecutor.ts     preview / approve / rollback for one type
    shopifyBlogExecutor.ts
    productSeoExecutor.ts
    instagramPublishExecutor.ts
    googleAdsExecutor.ts
    metaAdsExecutor.ts
    mailchimpExecutor.ts
    activityCopy.ts            the title/detail string builders
```

One interface, seven implementations:

```ts
export interface PlatformExecutor {
  readonly executionType: ExecutionType;
  readonly platform: ExecutionPlatform;
  /** Can this run without human approval, given the org's integration flags? */
  canAutoApply(flags: OrgIntegrationFlags): boolean;
  /** Build the proposed_state payload. No external writes. */
  preview(ctx: PreviewContext): Promise<ExecutionPayload>;
  /** Perform the external write. Called only after the claim is won. */
  apply(ctx: ApplyContext): Promise<ExecutionPayload>;
  /** Undo, where the platform allows it. */
  rollback?(ctx: RollbackContext): Promise<ExecutionPayload>;
}
```

`executionService.approve()` keeps the atomic claim (that logic must not move —
see `claimExecutionForWrite`) and becomes:

```ts
const row = await this.claimExecutionForWrite(organizationId, executionId);
if (!row) { /* lost the race — unchanged */ }
try {
  const executor = registry.get(row.execution_type);   // replaces the switch
  const after = await executor.apply({ organizationId, row, edits });
  return await this.markExecuted(organizationId, executionId, after);
} catch (err) {
  await this.releaseExecutionClaim(organizationId, executionId);
  throw err;
}
```

The registry lookup replacing a hand-written switch is the single highest-value
part of the change: it makes "wrong platform for this execution type" a
structural impossibility rather than something a reviewer has to notice.

---

## 4. Sequence

**Done — step 0.** 171 unit tests covering the parsers, spend guards, encryption,
logger and concurrency helper. These are the inputs and guards around the file,
not the file itself.

**Step 1 — characterisation tests (do this first).**
Not yet written. Test `approve()` and `preview()` against fake platform clients,
asserting for each of the seven types:

- the correct external client method is called, with the expected payload
- no *other* platform client is touched — this is the test that catches
  mis-routing
- a pre-flight refusal (missing scope, channel cap, SEO cooldown) returns the
  execution to `previewed` and performs no external call
- an external failure sets `failed` and does not release to `previewed`
- a second concurrent `approve` loses the claim and performs no external call

This requires injecting the platform services rather than constructing them as
field initialisers (`private shopify = new ShopifyExecutionService()`), so a
small constructor-injection change comes first. That change is itself
type-checked and mechanical.

**Step 2 — extract the pure pieces.** `activityCopy.ts` (the title/detail
builders), the `as*` payload type guards, and `metaCreatedSummary` /
`googleCreatedSummary`. No behaviour, no I/O, directly unit-testable.

**Step 3 — one executor at a time.** Start with `mailchimpExecutor` — drafts
only, never sends, so the blast radius is smallest. Then Shopify page, Shopify
blog, product SEO, Instagram. **Meta and Google Ads last**, because they are the
two that spend money.

After each extraction: full test suite, `tsc`, and a manual smoke test of that
one action type through the UI.

**Step 4 — registry replaces the switch** in `approve`, `rollback` and
`canAutoApplyExecution`.

**Step 5 — `claudeService.ts`** (1,880 lines) separately: extract the prompts to
`prompts/*.ts` so prompt changes become diffable, which matters when plan quality
regresses and you need to know what moved.

---

## 5. What must not move

- **`claimExecutionForWrite` / `releaseExecutionClaim`.** These are the
  duplicate-spend guard added in `7400720`. The claim must stay in
  `executionService.approve()`, before dispatch. An executor must never be able
  to run without the claim having been won.
- **The `SAFE_MESSAGE_PATTERNS` contract.** Executors throw plain `Error` with
  user-facing text ("Product SEO daily cap reached") that `lib/errorHandler.ts`
  matches by pattern to decide what reaches the UI. Reworded messages must be
  added to that list or they become generic 500s.
- **Ordering of pre-flight checks.** `evaluateChannelCaps` and
  `getSeoCooldownTargets` run *before* the external call. Moving either after it
  would spend first and refuse second.

---

## 6. Estimate

| Step | Effort |
|---|---|
| 1 — constructor injection + characterisation tests | 3–4 h |
| 2 — extract pure pieces | 1 h |
| 3 — seven executors, one at a time | 4–6 h |
| 4 — registry | 1 h |
| **Total** | **~1.5 days** |

Steps 1 and 2 are independently valuable and low-risk. Step 3 is where care is
needed; it is also interruptible between executors, so it does not need to be
finished in one sitting.

---

## 7. What remains

**Preview generation.** Seven `run*Preview` methods, roughly 900 lines, still in
`executionService.ts`. They are harder than the approve paths were:

- they reach `ClaudeService`, the analytics/ads snapshot services, the content
  recipe library and the brand visual library — a much wider dependency surface
  than the six platform clients an executor needs
- they are *not* covered by `executionService.approve.test.ts`, so there is no
  net for them yet
- unlike approve, they have no single uniform shape to factor out

Sequence, when it is picked up: characterisation tests for `preview()` first,
asserting the same negative property the approve tests do — each execution type
consults its own generator and no other — then extract one at a time, and only
then add `preview()` to the `PlatformExecutor` interface.

**Non-approve write paths.** `runInstagramPublish` and `runAssist` write
externally but do not go through `approve()`, so they were out of scope here.
Instagram publishing in particular deserves the same treatment, since
`INSTAGRAM_AUTO_PUBLISH` makes it unattended.

**Rollback.** `rollbackProductSeo`, `rollbackShopifyPage` and
`rollbackShopifyBlogArticle` are still on the service. They are small and
symmetrical with the executors, so adding an optional `rollback` to
`PlatformExecutor` is the natural follow-on — and cheap, because
`preserveBeforeState` is already tested.

**`claudeService.ts`** (1,880 lines) is untouched. Extracting prompts to
`prompts/*.ts` would make prompt changes diffable, which matters when plan quality
regresses and you need to know what moved.

## 8. Notes from doing it

Two things worth recording, because both were cases of the work looking safer
than it was.

**A mock can enforce a guard on the code's behalf.** The first version of the
database mock hardcoded "the claim only succeeds from `previewed`" instead of
reading the precondition out of the SQL. Deleting `AND status = 'previewed'` from
the real query therefore changed nothing under test. Mutation testing found it;
the mock now derives every precondition from the statement.

**Some guards are not observable through the public interface.** That same claim
precondition cannot be exercised behaviourally, because `approve()` pre-checks the
status with a plain read which shadows it. It only holds in the race it exists for
— two callers both passing the pre-check, then both claiming. There is now an
explicit structural assertion that the precondition is present in the statement,
with a comment saying why it is structural rather than pretending otherwise.

**Guards reached by direct import are invisible to a dependency-injection net.**
The Meta zero-spend throttle and the SEO cooldown are module imports, not injected
deps, so they read through the mocked `query`, got empty results, and permitted
everything. Deleting either changed no test. They are now mocked explicitly. Worth
checking for the same pattern before trusting a net over the preview paths.
