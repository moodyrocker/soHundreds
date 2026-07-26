# Code Review — SEO Hundreds / Hundres V1

**Date:** 26 July 2026
**Reviewed at commit:** `c734041` (Initial commit: Hundres V1)
**Scope:** ~50k lines — `backend/src` (28.3k), `web/src` (20.4k), `UIHundreds` prototype (1.7k), 30 Supabase migrations

---

## 1. What the code does

Hundres is a **goal-driven marketing autopilot**. A user states a business goal in plain language ("get 100 more orders a month"), and the system plans, executes, measures and re-plans marketing work toward that goal on a continuous loop — without the user driving each step.

### The loop

```
Goal input
    ↓
Snapshot real data ──── Google Analytics, Google Ads, Meta Ads, Shopify
    ↓
Claude generates a PlanDocument (goal metric + Week 1 actions)
    ↓
Orchestrator runs actions until blocked
    ↓
Executors actuate ───── Shopify pages/blogs/product SEO, Instagram posts,
    ↓                   Mailchimp sequences, Google/Meta ad campaigns,
    ↓                   Canva & Runway creative, Unsplash imagery
Measure outcomes ────── goal progress, week outcomes, learning patterns
    ↓
Checkpoint → advance to next week (or declare goal met)
    ↓
    └──────────── loop, on a 15/30/60-minute cadence by "pace"
```

### Key architectural choices

| Layer | Implementation |
|---|---|
| **Frontend** | Next.js 14 App Router, Tailwind, server-side proxy at `/api/[...path]` that injects the Supabase JWT |
| **API** | Express, mounted in two zones: public (auth, orgs, Meta webhook, MCP bridges) and tenant-scoped (`authMiddleware` → `tenantMiddleware`) |
| **Multi-tenancy** | `X-Organization-Id` header, verified against `organization_members` on every tenant request |
| **AI layer** | `ClaudeService` — a single class owning every prompt, with `MAX_TURNS = 8`, Anthropic web-search tool, and JSON-repair parsers per output type |
| **Integrations** | 9 self-hosted MCP servers exposed over Streamable HTTP, authenticated by short-lived HMAC bridge tokens |
| **Autopilot** | In-process worker (`autopilotCycleWorker`) that ticks, finds due strategies, and runs a full agentic cycle per strategy |
| **Data** | Supabase Postgres, raw `pg` queries, 19 tables, forward-only timestamped migrations |
| **Deploy** | Docker Compose (api + web), EC2 bootstrap and rsync scripts |

### The genuinely interesting design idea

Most tools in this space are dashboards — they show you data and leave the decision to you. Hundres inverts that: the plan is a **living document that regenerates weekly from measured outcomes**, and the UI is a window onto an agent that has already acted. `learningKnowledgeService`, `actionOutcomeService` and `weekOutcomeService` feed prior results back into the next prompt, so the system is meant to get better at a specific business over time.

That's a real product thesis, and the code is organised around it rather than around CRUD.

---

## 2. What's good

**The safety architecture around money is thoughtful.** `paidAdHumanGate` + `paidAdThrottle` refuse to create a second Meta campaign while earlier ones sit at $0 spend — the reasoning being "no signal to learn from yet." `metaCampaignReconciliation` handles the case where someone deletes a campaign in Ads Manager directly, which would otherwise leave a stale row blocking creation forever. That's a bug someone clearly hit and fixed properly rather than papering over. Feature flags (`INSTAGRAM_AUTO_PUBLISH`, `SHOPIFY_AUTO_PUBLISH_LIVE`) mean actuation is off by default.

**Credential handling is correct.** AES-256-GCM with random IV and auth tag, hex-key fast path with scrypt fallback (`utils/encryption.ts`). Bridge tokens are HMAC-SHA256 with `timingSafeEqual` comparison, platform binding, and 15-minute expiry. No secrets are committed — `.gitignore` is comprehensive and `git ls-files` confirms only `.env.example` files are tracked.

**Tenant isolation at the API boundary is done right.** `tenantMiddleware` joins through `organization_members` on every request; the client-supplied `X-Organization-Id` is never trusted. Zod validation appears at 74 sites across 11 route files.

**Documentation is unusually good for a solo V1.** 17 markdown docs including an operating spec, rollback procedure, capability matrices, and a readiness tracker. The README actually works as a runbook. Migrations are timestamped, forward-only, and idempotent (`IF NOT EXISTS` throughout).

**TypeScript discipline is high** — exactly one `: any` in 28k backend lines, and a dedicated `types/` directory with real domain types (`PlanDocument`, `ExecutionPayload`, `ActionRunState`).

---

## 3. Critical issues

### 3.1 — 15 of 19 tables have no Row Level Security

RLS is enabled on `profiles`, `organizations`, `organization_members`, `mcp_connections` only. It is **not** enabled on:

```
strategies              action_executions      action_run_states
checkup_reports         action_outcomes        block_run_states
autopilot_activity      audit_log              goal_week_outcomes
learning_patterns       content_recipes        brand_visual_assets
ad_campaign_library     runway_prompt_tests    plan_action_completions
```

There are also **no `GRANT`/`REVOKE` statements anywhere** in the migrations, so Supabase's default grants to the `anon` and `authenticated` roles apply. Supabase exposes every table in the `public` schema through PostgREST at the project URL — and both `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are baked into the browser bundle by design.

**Impact:** any person who signs up can take the anon key from your JS bundle, take their own JWT, and `GET /rest/v1/strategies?select=*` to read every other tenant's goals, plans, ad campaigns, and audit log. Write access is likewise open. The careful `tenantMiddleware` work is bypassed entirely because it guards the Express API, not the database.

Right now nothing in `web/src` queries tables directly (only `supabase.auth`), so this is unexploited — but it is open, and it is the single highest-severity finding.

**Fix:** enable RLS on all 19 tables and add `organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())` policies. Belt and braces: `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;` since the backend connects as a privileged role over `DATABASE_URL` and doesn't need PostgREST grants at all.

### 3.2 — The autopilot worker cannot survive more than one instance

`workers/autopilotCycleWorker.ts` guards concurrency with two **in-process** primitives:

```ts
const running = new Set<string>();   // per-strategy guard
let tickInFlight = false;            // per-tick guard
```

There is no `SELECT ... FOR UPDATE SKIP LOCKED`, no `pg_try_advisory_lock`, and no idempotency key anywhere in the codebase (verified: zero matches for all three). `markCycleStarted` writes `last_autopilot_cycle_at` *after* the due-query and *after* fetching the strategy, so it isn't atomic with claim.

**Impact:** the moment you run two API containers, autoscale, or do a rolling deploy where old and new overlap, both instances select the same due strategies and both execute them. That means duplicate Instagram posts, duplicate Shopify blog articles, and **duplicate Meta/Google ad campaigns spending real budget**. For a system whose whole value proposition is unattended action, this is the failure mode that costs a customer money and trust.

**Fix:** claim work atomically —

```sql
UPDATE strategies SET last_autopilot_cycle_at = NOW()
WHERE id = (
  SELECT id FROM strategies WHERE <due conditions>
  ORDER BY ... FOR UPDATE SKIP LOCKED LIMIT 1
)
RETURNING *;
```

— and add an idempotency key per (strategy, week, action, attempt) that executors check before calling any external write API.

### 3.3 — Cycles run serially inside the web server process

Two problems compounded:

**Serial execution.** `runDueAutopilotCycles` is a `for...of` with `await` over up to 20 strategies. A single cycle involves multiple Claude calls (`MAX_TURNS = 8`, `MAX_TOKENS = 16384`) plus external API calls; the frontend proxy allows **900 seconds** for execution routes, and `api.ts` warns users that Runway video can take 10–15 minutes. One slow tenant therefore starves every other tenant on that tick.

**Wrong process.** The worker is started from inside `app.listen()` in `index.ts`. Long-running agent work shares an event loop and memory with HTTP request handling, so a deploy or OOM kill mid-cycle leaves executions in an indeterminate state with no resume logic. It also means you cannot scale API capacity independently of agent capacity — see 3.2.

**Fix:** split the worker into its own container (same image, different command — Compose makes this a ~10-line change), and process claimed strategies with bounded parallelism (`p-limit` at 3–5) rather than serially.

---

## 4. Significant issues

### 4.1 — MCP bridge sessions aren't bound to the organisation that created them

`mcp/mcpBridgeHttp.ts` keeps a module-level `Map<sessionId, transport>`. On a request with an existing `mcp-session-id`, the token is verified — but only for **validity and platform**, never against the org that owns that session:

```ts
const verified = verifyMcpBridgeToken(token, platform);   // checks org+platform in token
...
if (sessionId && transports.has(sessionId)) {
  transport = transports.get(sessionId);                  // ← verified.organizationId unused
}
```

A caller holding a valid token for their own org, who learns another org's session UUID, gets a transport wired to the *other* org's MCP server and its credentials. The UUID is unguessable in practice, so severity is moderate rather than critical — but the check is one line.

**Also:** sessions are only removed on `transport.onclose`. An abandoned session leaks its transport and MCP server for the lifetime of the process. Add a TTL sweep.

**Fix:** store `{ transport, organizationId }` and reject on mismatch.

### 4.2 — No tests. None.

Zero `*.test.*`, zero `*.spec.*`, no Jest/Vitest config, no `.github/` directory, no CI. Neither `package.json` has a `test` script.

For 50k lines this is a problem anywhere, but it's acute here because of what the code does: an LLM emits JSON, `jsonrepair` and eleven bespoke parsers (`parsePlanJson`, `parseAssistJson`, `parseMetaAdsCampaignJson`, …) coerce it into typed domain objects, and the result triggers irreversible external side effects. Those parsers are exactly the code most likely to break silently when a model's output drifts, and exactly the code cheapest to test — they're pure functions.

**Fix, in priority order:**

1. Vitest + golden-file tests for all 11 parsers, with real captured model outputs including malformed ones.
2. Unit tests for `paidAdThrottle`, `paidAdHumanGate`, `seoCooldown` — the money guards.
3. Integration tests for `authMiddleware`/`tenantMiddleware` cross-tenant denial.
4. GitHub Actions running `tsc --noEmit`, `next lint`, and the test suite.

### 4.3 — `executionService.ts` is 2,880 lines

One class, methods running 300–400 lines each (`approve` spans lines 1452–1848). It handles seven execution types (product SEO, Shopify blog, Shopify page, Instagram publish, Google Ads campaign, Meta Ads campaign, Mailchimp sequence) across preview / run / approve / skip / rollback / batch / autopilot paths.

`actionRouter.ts` already exists as a dispatch layer, and per-platform executors already exist (`shopifyExecutionService`, `instagramExecutionService`, `mailchimpExecutionService`). The refactor is mostly mechanical: move each execution type's preview/run/approve/rollback into its platform executor behind a common interface, leaving `ExecutionService` as persistence + orchestration only. Do this **after** tests exist, not before.

`claudeService.ts` (1,880 lines) has the same shape — prompts as inline template literals inside methods. Extracting them to a `prompts/` directory would let you diff and version prompt changes, which matters when plan quality regresses and you need to know what moved.

### 4.4 — Missing standard API hardening

- **No rate limiting.** Endpoints that trigger Claude calls and paid-ad creation are unthrottled per user and per org. A loop against `POST /api/strategy` burns your Anthropic budget.
- **No `helmet`** or security headers.
- **`ssl: { rejectUnauthorized: false }`** in `database/connection.ts` disables certificate verification on the Postgres connection — MITM-able. Supabase publishes a CA cert; pin it.
- **Unbounded `express.json()`** — no `limit` option.
- **Error handler leaks internals.** The fallback is `res.status(500).json({ error: message })` with the raw `Error.message`, which can carry SQL fragments, upstream API responses, and internal paths. Log the detail, return a generic message plus a correlation ID.
- **76 `console.*` calls** as the only observability. No structured logging, no request IDs, no error tracking. When an unattended agent misfires on a customer's ad account at 3am, `docker compose logs` is the entire forensic trail.

---

## 5. Smaller things

| Area | Issue |
|---|---|
| **Frontend data fetching** | Hand-rolled `fetch` + `useEffect` + `setInterval` in five components, polling at 3s and 4s. No caching, no dedupe, no request cancellation on unmount for in-flight calls. SWR or React Query would delete most of this and fix the thundering-herd problem when several panels poll at once. |
| **Frontend component size** | `content-recipes-section.tsx` 1,217 lines; `action-deliverable-card.tsx` 986; `autopilot-action-table.tsx` 871. Same extraction argument as the backend. |
| **Transactions** | `pool.connect()` / `BEGIN` appears in exactly one place (`organizationService`). Multi-step writes elsewhere — execution state + activity log + outcome rows — can partially fail and leave inconsistent state. |
| **Key rotation** | `ENCRYPTION_KEY` has no version prefix in the ciphertext, so rotating it makes every stored OAuth credential permanently undecryptable. Add a `v1:` prefix now while it's cheap. |
| **Dead config** | `SUPABASE_SERVICE_ROLE_KEY` is in `.env` and `.env.example` but referenced nowhere in the codebase. Remove it — an unused service-role key is pure downside risk. |
| **CORS** | Hardcoded `localhost:5000` origins alongside `WEB_ORIGIN`. Fine for dev, should be env-only in production. |
| **`UIHundreds/`** | 1,745 lines of JSX prototype sitting parallel to the real `web/src` implementation, with no README explaining the relationship. Either mark it clearly as a design reference or delete it. |
| **Git history** | One commit for the entire project. You lose bisect, blame, and any ability to reason about when a regression entered. |
| **Deprecated shims** | `mountShopifyMcpBridge`, `createShopifyBridgeToken`, `verifyShopifyBridgeToken`, `shopifyMcpPublicUrl` are all marked `@deprecated` with no callers. Delete them. |

---

## 6. Recommended order of work

**Before any real customer data lands (days, not weeks)**

1. Enable RLS on all 19 tables + revoke PostgREST grants — *§3.1*
2. Atomic work claiming with `FOR UPDATE SKIP LOCKED` + idempotency keys — *§3.2*
3. Bind MCP bridge sessions to `organizationId` — *§4.1*
4. Rate limiting, `helmet`, generic error responses, Postgres CA pinning — *§4.4*
5. Encryption key versioning; delete the unused service-role key — *§5*

**Next (weeks)**

6. Vitest + golden-file tests for the 11 JSON parsers and the money guards — *§4.2*
7. GitHub Actions CI: typecheck, lint, test — *§4.2*
8. Move the autopilot worker to its own container with bounded parallelism — *§3.3*
9. Structured logging with request/cycle correlation IDs — *§4.4*

**Then (with tests as a safety net)**

10. Break up `executionService.ts` behind the existing executor interfaces — *§4.3*
11. Extract prompts from `claudeService.ts` into versioned files — *§4.3*
12. SWR/React Query on the frontend; split the largest components — *§5*

---

## 7. Overall assessment

This is a **strong V1 with a clear thesis, undermined by exactly the gaps you'd expect from moving fast solo** — no tests, no CI, and infrastructure assumptions (single process, in-memory locks, RLS deferred) that hold in development and break the day you scale or the day someone probes the Supabase endpoint.

The product thinking is ahead of the engineering rigour, which is the right way round at this stage. The safety design around paid ads in particular shows someone who thought hard about what happens when an autonomous agent is wrong — that instinct is the hard part, and it's present.

What's missing is the layer that lets you *trust* the system unattended: database-enforced isolation, atomic work claiming, and tests around the LLM-output boundary. Those three are perhaps a week of focused work and they change the risk profile completely.

Two findings are urgent rather than merely important: **§3.1 (RLS)** because it's a live cross-tenant data exposure, and **§3.2 (work claiming)** because it will duplicate real ad spend the first time you run two instances. Everything else can wait.
