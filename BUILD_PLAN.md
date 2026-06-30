# Hundres — Build Plan

**How to use this doc:** Read the **Phase map** first. Work **one phase at a time**. Do not start Phase 2 until Phase 1 exit criteria pass.

| Doc | Purpose |
|-----|---------|
| [PROJECT_PLAN.md](./PROJECT_PLAN.md) | Vision, USP, product roadmap |
| [BUILD_PLAN.md](./BUILD_PLAN.md) | **This file** — engineering phases & checklists |
| [TASKS_AND_TESTS.md](./TASKS_AND_TESTS.md) | Test scripts & milestone gates |
| [BASELINE_ASSESSMENT.md](./BASELINE_ASSESSMENT.md) | Current integration/plan snapshot |
| [INTEGRATIONS_SETUP.md](./INTEGRATIONS_SETUP.md) | OAuth & env runbook |

**Last updated:** 2026-06-08 (Phase 5 Autopilot & goal loop — current focus)

---

## True north (engineering)

Ship the **goal loop** on one real workspace before adding features:

```
Goal + goalTarget → this week → autopilot run → metric check → next week OR goal met
```

See [PROJECT_PLAN.md](./PROJECT_PLAN.md) **Anti-drift guardrails** before starting work outside Phase 5.

---

## Phase map (at a glance)

| Phase | Name | Status | Exit criteria (short) |
|-------|------|--------|------------------------|
| **0** | Trustworthy UI | ✅ **Done** | No fake data; honest empty states |
| **1A** | Connect data (read-only) | 🟡 **Mostly done** | GA, Meta, Ads OAuth + snapshots (Ads token pending) |
| **1B** | Business context & plan UX | ✅ **Done** | Profile + background generation |
| **1C** | Multi-source polish | ✅ **Done** | M2: plan cites real GA+Meta |
| **1D** | Advisor / check-up | ✅ **Done** | Report at `/checkup` |
| **2** | Market intel | ✅ **Done** | Directional market block in plans |
| **2B** | Plan refinement & brand focus | ✅ **Done** | Refine without new goal |
| **3** | Workers + audit | ✅ **Done** | Workers + audit log + completions |
| **4** | Gated execution | ✅ **Code done** | Shopify SEO v1; **P4 E2E blocked** on Shopify scope |
| **5** | **Autopilot & goal loop** | 🟡 **M7 pending E2E** | Rolling weeks, metric loop, intent routing |

### You are here → **Phase 5 — Autopilot & goal loop**

**Do next (in order — do not skip):**

1. **5C** — Weekly metric read vs `goalTarget`; set `goal_status = met` or advance week.
2. **5D** — Intent-correct action routing (title/channel → right executor).
3. **5E** — Outcome log feeding next week’s decision prompt.
4. **When unblocked:** Shopify `write_products` → [Test P4](./TASKS_AND_TESTS.md#test-p4); Google Ads Basic Access → 1C-U5.

**Do not start until M7 passes:** New executors, ads writes, extra nav, 8-week upfront plans.

---

## Trello — should you use it?

**Yes, optional but helpful** if you want a visual board. Keep **BUILD_PLAN.md as source of truth**; mirror it in Trello so you drag cards, not rewrite the plan.

Suggested board: **Hundres Build**

| List | What goes here |
|------|----------------|
| **Phase 5 — Now** | 5C metric loop, 5D intent routing |
| **Waiting on external** | Shopify write, Google Ads token |
| **Done** | Phases 0–4 (incl. autopilot 5A–5B) |
| **Backlog** | Phase 5E+, new executors, ads writes |

**Card template** (copy per task):

```
Title: [1C.2] Parallel snapshot fetch
Phase: 1C
Owner: Engineering | You
Done when: …
Link: BUILD_PLAN.md#phase-1c
```

You do **not** need Trello to proceed — this file + [TASKS_AND_TESTS.md](./TASKS_AND_TESTS.md) is enough for a solo builder.

---

## Phase 0 — Trustworthy UI ✅ DONE

**Goal:** User trusts what they see — no demo bakery, no invented plans.

**Exit criteria:** New user sees only their org, their goal, their plan or empty states.

| ID | Task | Status |
|----|------|--------|
| 0.1 | Remove mock plan/dashboard data; neutral goal examples | ✅ |
| 0.2 | Neutral copy (no Maya/bakery) | ✅ |
| 0.3 | Capabilities API + honest Integrations catalog | ✅ |
| 0.4 | Autopilot Home shows this week from active plan or empty | ✅ |
| 0.5 | `mcp_connections.config` JSONB migration | ✅ |
| 0.T1 | Test P0 ([TASKS_AND_TESTS.md](./TASKS_AND_TESTS.md#test-p0)) | ✅ 2026-06-06 |

**Verify:** Sign up → empty dashboard → no fake tasks. **Gate closed** — M0 verified.

---

## Phase 1A — Connect data (read-only) 🟡 MOSTLY DONE

**Goal:** User connects GA, Google Ads, Meta, (optional Shopify). Each connection can feed **read-only** snapshots into plans.

**Exit criteria:** On a test workspace, Integrations show **Ready** for GA + Meta; Ads **Ready** after Google approves token; new plan includes snapshot text for each working source.

### You (setup & credentials)

| ID | Task | Status | Notes |
|----|------|--------|-------|
| 1A-U1 | Supabase + `.env` core vars | ✅ | See [Env checklist](#env-checklist) |
| 1A-U2 | Google OAuth + GA4 property on workspace | ✅ | [INTEGRATIONS_SETUP.md](./INTEGRATIONS_SETUP.md) §1 |
| 1A-U3 | Meta Ads OAuth + ad account | ✅ | HTTPS redirect via ngrok |
| 1A-U4 | Google Ads **Basic Access** application | 🟡 **Submitted 2026-06-13** | Still pending as of **2026-06-25**. Design doc: `docs/google-ads-api-design-document.pdf` |
| 1A-U5 | Shopify Partner app + `.env` (if e-commerce) | ⬜ | Optional |

### Engineering (built)

| ID | Task | Status |
|----|------|--------|
| 1A-E1 | GA OAuth + property picker + snapshot | ✅ |
| 1A-E2 | Google Ads OAuth + customer picker + snapshot service | ✅ |
| 1A-E3 | Meta OAuth + ad account picker + snapshot | ✅ |
| 1A-E4 | Shopify OAuth + orders snapshot | ✅ (code) |
| 1A-E5 | Wire all snapshots into `StrategyService` | ✅ |
| 1A-E6 | `data_source` on `strategies` row | ✅ |

### Still open (moved to Phase 1C)

- Show snapshot **errors** on Integrations (GA + Ads) — user sees why “Ready” ≠ data in plan.

**Verify:** `docker compose logs api` — no 403 on Ads **after** token approved; Meta + GA lines in plan “why” fields.

---

## Phase 1B — Business context & plan UX ✅ DONE

**Goal:** User describes their business once; plan generation survives refresh; Claude returns valid JSON reliably.

**Exit criteria:** Business profile saved → new plan uses it; refresh during Thinking does not restart job; failed plans show error + retry.

| ID | Task | Status |
|----|------|--------|
| 1B.1 | DB: `organizations` business fields | ✅ |
| 1B.2 | `GET/PATCH /api/business-profile` + `/business` UI | ✅ |
| 1B.3 | Merge profile into every plan (`context` / `budget`) | ✅ |
| 1B.4 | Background generation (`generating` → `active` / `failed`) | ✅ |
| 1B.5 | Poll + top-bar “Building your plan…” banner | ✅ |
| 1B.6 | Claude: `pause_turn`, JSON retry, less web_search when data present | ✅ |

**Verify:**

1. Fill `/business` → run new plan → DB `strategies.context` contains website.
2. Start plan → refresh → same `strategyId` in URL; banner persists.
3. `docker compose up -d --build` after code changes.

**Migrations required:**

- `20250606000000_organization_business_profile.sql`
- `20250607000000_strategy_generating_status.sql`

---

## Phase 1C — Multi-source polish ✅ DONE (2026-06-06)

**Goal:** Prove **M2** — one plan grounded in **multiple real data sources**; UI honest about what actually loaded.

**Exit criteria (M2 gate):**

- [ ] Business profile complete on **MIA** (optional polish — not blocking M2)
- [x] New plan completes (`status=active`, no `generation_error`)
- [x] Plan chip reflects sources used (e.g. **Multi-source informed** or GA + Meta)
- [x] At least 2 action “why” fields cite **real numbers** (sessions, spend, etc.)
- [x] DB: `data_source` = `multi` (plan `8359a766-52d5-49d4-8cbb-e128d7fa3c49`)

### You (manual test — ~15 min)

| ID | Task | Status |
|----|------|--------|
| 1C-U1 | Apply DB migrations if missing | ✅ |
| 1C-U2 | `docker compose up -d --build` | ✅ |
| 1C-U3 | MIA: Business profile filled | ⬜ optional |
| 1C-U4 | MIA: New plan → Thinking → Plan (M2 script below) | ✅ 2026-06-06 |
| 1C-U5 | When Google approves Ads: re-run plan; confirm Ads metrics in output | ⬜ deferred |

**M2 test script:**

1. Workspace **MIA** → Integrations: GA + Meta **Ready**
2. **New** → clear goal → **Thinking** → wait for Plan
3. Check chip + skim 2–3 “why” fields for real metrics
4. Run DB check (see [How to verify](#how-to-verify))

### Engineering

| ID | Task | Status | Owner |
|----|------|--------|-------|
| 1C-E1 | Show GA snapshot errors on Integrations | ✅ | Eng |
| 1C-E2 | Show Google Ads errors (`DEVELOPER_TOKEN_NOT_APPROVED`, etc.) | ✅ | Eng |
| 1C-E3 | `GET /api/mcp/snapshot-health` + `GET /api/mcp/google-ads/probe` | ✅ | Eng |
| 1C-E4 | Parallel snapshot fetch (today: sequential) | ✅ | Eng |
| 1C-E5 | Thinking UI: list sources that **actually** loaded, not just MCP Ready | ✅ | Eng |

**Done when:** M2 checklist above is checked; Integrations distinguish **Connected** vs **Data loading OK**.

---

## Phase 1D — Advisor / check-up ✅ DONE

**Goal:** Beyond 8-week plan JSON — a fast **report snapshot** of connected data (even when metrics are zero), with history to track progress over time.

**Exit criteria:** User can run a check-up at `/checkup` that shows live metrics, data coverage, priorities, and past snapshots — without the full plan flow.

| ID | Task | Status |
|----|------|--------|
| 1D.1 | Product spec: one-page report vs chat | ✅ [`docs/checkup-spec.md`](./docs/checkup-spec.md) |
| 1D.2 | API + `checkup_reports` table + Claude prompt | ✅ `POST/GET /api/checkup/*` |
| 1D.3 | UI: `/checkup` + sidebar “Check-up” | ✅ |
| 1D.4 | Manual E2E on MIA (GA + Meta) | ✅ |

**Depends on:** Phase 1C complete (honest data layer).

---

## Phase 2 — Market intel 🟡 IN PROGRESS

**Goal:** Competitor and market **context** (directional, low/medium confidence) — not ground truth.

**Exit criteria:** Plan includes `marketIntel` block when profile seeded; UI labels directional confidence; no competitor metric as fact.

| ID | Task | Status |
|----|------|--------|
| 2.1 | `MarketIntelConnector` interface | ✅ [`docs/market-intel-spec.md`](./docs/market-intel-spec.md) |
| 2.2 | API keys / org settings for SpyFu, Trends, etc. | ⬜ Future |
| 2.3 | Prompt section + confidence rules | ✅ web_search connector |
| 2.4 | “Businesses to emulate” UX | ✅ `/business` field |
| 2.5 | Plan UI: Market context card | ✅ `/plan` |
| 2.6 | Manual E2E: new plan with profile filled | ⬜ |

**Sources (pick later):** Meta Ad Library, Google Trends, SpyFu, SimilarWeb, reviews.

### Input model (who goes where)

| User intent | Where it lives | Example |
|-------------|----------------|---------|
| Brands you always admire | Business profile → **Businesses to emulate** | “Glossier, Aesop” |
| Outcome for this pursuit | **New goal** | “Grow Shopify revenue 25%” |
| Steer after seeing the draft | **Refine this plan** (Phase 2B) | “Analyse Brand X’s Instagram; be more like them on content, not pricing” |

Today **Edit goal** on `/plan` links to `/new` (starts over). Phase 2B adds **Refine** (same goal + integrations, new generation with add-on notes).

---

## Phase 2B — Plan refinement & brand focus ✅ DONE

**Goal:** After the first plan is generated, the user can add competitor / brand direction (“analyse this brand”, “be like them”, “follow their social strategy”) and **regenerate** without re-entering the goal or reconnecting integrations.

**Exit criteria:** User refines an active plan → new plan row (or updated plan) reflects refinement in **Market context** and action “why” fields; prior plan remains in Settings history. **Verified** Test P2B 2026-06-07.

| ID | Task | Status |
|----|------|--------|
| 2B.1 | Spec: refine vs new plan vs profile emulate | ✅ |
| 2B.2 | DB: `strategies.refinement_notes` and/or `parent_strategy_id` (lineage) | ✅ |
| 2B.3 | `POST /api/strategy/:id/refine` — re-fetch snapshots + merge refinement into prompt | ✅ |
| 2B.4 | Prompt: refinement block weights web_search toward named brands; updates `marketIntel.emulateNotes` | ✅ |
| 2B.5 | Plan UI: **Refine this plan** button + modal (textarea + “Regenerate with this context”) | ✅ |
| 2B.6 | Clarify **Edit goal** copy → “Start new plan” (avoid confusion with Refine) | ✅ |
| 2B.7 | (Optional) Thinking UI: **Add competitor focus** before generation starts (merge into context) | ⬜ |
| 2B.8 | Settings: show refined plans in history with refinement snippet | ✅ |
| 2B.T1 | Manual E2E: refine with brand name → Market context + actions update | ✅ 2026-06-07 |

**Depends on:** Phase 2 market intel block shipped (2.1–2.5).

**Verify:**

1. Generate plan with profile emulate filled → open `/plan` → **Refine this plan**.
2. Enter: “Analyse how [Brand X] runs paid social — I want to emulate their cadence, not their budget.”
3. Wait for regeneration → **Market context → Emulate** mentions Brand X; at least one week-1 action cites the refinement.
4. Settings → both plans visible (original + refined).

---

## Phase 3 — Workers + audit ✅ DONE

**Goal:** Deeper reasoning + traceability.

| ID | Task | Status |
|----|------|--------|
| 3.1 | Research / Analysis / Optimization workers (structured JSON) | ✅ |
| 3.2 | `audit_log` table (sources, model, org, timestamp) | ✅ |
| 3.3 | Plan action completion tracking | ✅ |

**Test gate:** [Test P3](./TASKS_AND_TESTS.md#test-p3) — **Pass** 2026-06-07 (audit row on refine + action checkbox persists).

---

## Phase 4 — Gated execution ✅ CODE DONE · ⏸ P4 DEFERRED

**Goal:** User-approved changes to external systems — never autonomous spend.

| ID | Task | Status |
|----|------|--------|
| 4.1 | Approve / Edit / Skip on plan actions | ✅ |
| 4.2 | Audit log: before/after on writes | ✅ |
| 4.3 | Rollback for Shopify mutations | ✅ |
| 4.4 | Dry-run preview before commit | ✅ |

**V1 scope:** SEO/content plan actions → Shopify product SEO meta (title + description).

**Test gate:** [Test P4](./TASKS_AND_TESTS.md#test-p4) — **skipped** until Shopify Partners grants `write_products` (app review). Preview/dry-run works without write scope.

**Future (not V1):** Google Ads writes require permissible-use upgrade — see `docs/google-ads-api-design-document.md` §9.

---

## Phase 5 — Autopilot & goal loop 🟡 IN PROGRESS

**Goal:** User sets a goal once; Hundres runs **weekly cycles toward a measurable target** until met — simple Home UX, no 40-action overwhelm.

**Exit criteria (M7 gate):**

- [x] Autopilot Home is default path (not Thinking → 8-week plan)
- [x] Initial plan = week 1 + `goalTarget` (not full 8-week calendar)
- [x] `current_week`, `goal_status` on strategies; advance-week API
- [x] Autopilot batch run (assist + hands-off modes)
- [ ] Weekly metric read vs `goalTarget` → advance or `goal_status = met`
- [ ] Action routing matches intent (no SEO audit → random product SEO)
- [ ] Keylo E2E: goal → week prepared → metric check → week 2 OR victory

| ID | Task | Status |
|----|------|--------|
| 5A.1 | Autopilot Home (`/`) — this week, inline deliverables, mode toggle | ✅ |
| 5A.2 | Simplified nav; goal → Home; Thinking optional | ✅ |
| 5A.3 | Collapsible **Why?** on action cards (decision layer visible) | ✅ |
| 5B.1 | Rolling week prompt (week 1 only on create) | ✅ |
| 5B.2 | `generateNextPlanWeek` + append to plan | ✅ |
| 5B.3 | Migrations: `autopilot_mode`, `current_week`, `goal_status` | ✅ |
| 5B.4 | Hands-off auto-advance; assist manual “Next week →” | ✅ |
| 5C.1 | `goalProgressService` — read GA/Shopify vs `goalTarget` | ✅ |
| 5C.2 | Goal check on advance + autopilot; `GET /goal-progress` | ✅ |
| 5D.1 | Fix `actionRouter` intent (audit/assist vs product SEO) | ✅ |
| 5E.1 | `goal_week_outcomes` + feed into next-week Claude prompt | ✅ |
| 5.T1 | M7 E2E on Keylo | ⬜ |

**Depends on:** Phases 1–4 (data + execution spine). **Blocks:** All new feature phases.

**Verify (M7 script):**

1. MIA/Keylo: New goal with Shopify + Meta connected.
2. Home shows week 1 + target metric; autopilot prepares actions.
3. After week complete: metric check runs; week 2 appears OR “Goal met”.
4. User never required to open Full plan for happy path.

---

## Architecture (reference)

```
Business profile + goal
    → POST /api/strategy/create (status: generating)
    → Snapshots: GA4 | Ads | Meta | Shopify (read-only)
    → Workers → Claude → week 1 + goalTarget (rolling)
    → strategies (active, current_week, goal_status)
    → Autopilot: POST /api/execution/batch (assist | hands-off)
    → (5C) Metric check vs goalTarget
    → generateNextPlanWeek OR goal_status = met
    → Autopilot Home (this week + deliverables)
    → (optional) /plan History, refine, advanced execution modal
```

**Integration pattern:** OAuth → snapshot → decision prompt → weekly loop.

**Key paths (Phase 5):**

| Concern | Path |
|---------|------|
| Autopilot Home | `web/src/components/dashboard/dashboard-view.tsx` |
| Autopilot mode | `backend/src/services/autopilotService.ts` |
| Rolling weeks | `backend/src/services/strategyService.ts`, `claudeService.generateNextPlanWeek` |
| Execution batch | `backend/src/routes/execution.ts`, `executionService.runWeekAutopilot` |
| Action routing | `backend/src/executors/actionRouter.ts` |

## How to verify

```bash
docker compose up -d --build
docker compose logs api --tail 80 -f

# Latest plans
docker compose exec api node -e "
  const {query}=require('./dist/database/connection.js');
  query(\"SELECT id, status, data_source, generation_error, left(goal,40) AS goal FROM strategies ORDER BY created_at DESC LIMIT 5\")
    .then(r=>console.log(r.rows));
"

# Ads snapshot probe (replace ORG_ID)
docker compose exec api node -e "
  const { GoogleAdsSnapshotService } = require('./dist/services/googleAdsSnapshotService.js');
  new GoogleAdsSnapshotService().fetchSnapshot('YOUR_ORG_ID').then(r => console.log(r ? 'OK' : 'FAIL'));
"
```

### Known issues

| Symptom | Fix |
|---------|-----|
| `generation_error` column missing | Run migration `20250607000000` |
| `DEVELOPER_TOKEN_NOT_APPROVED` | Wait for Google Basic Access |
| Plan restarts on refresh | Rebuild web + api |
| `Model response did not contain JSON` | Rebuild api; retry plan |

---

## Env checklist

```bash
# Core
DATABASE_URL=
ANTHROPIC_API_KEY=
ENCRYPTION_KEY=
SUPABASE_URL=
SUPABASE_ANON_KEY=
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:5000/integrations/callback
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_API_URL=http://localhost:3001

# Google Ads
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_API_VERSION=v20

# Meta
META_APP_ID=
META_APP_SECRET=
META_OAUTH_REDIRECT_URI=http://localhost:5000/integrations/callback

# Shopify (optional)
SHOPIFY_CLIENT_ID=
SHOPIFY_CLIENT_SECRET=
SHOPIFY_SCOPES=read_orders,read_products,read_analytics
```

---

## File map (where to code)

| Concern | Path |
|---------|------|
| Integrations UI | `web/src/components/integrations/` |
| OAuth + tokens | `backend/src/services/mcpConnectionService.ts` |
| Snapshots | `backend/src/services/*SnapshotService.ts` |
| Plan generation | `backend/src/services/strategyService.ts`, `claudeService.ts` |
| Autopilot / goal loop | `autopilotService.ts`, `dashboard-view.tsx`, migrations `20250613*`, `20250614*` |
| Plan refinement (2B) | `backend/src/routes/strategy.ts`, `web/src/components/plan/plan-view.tsx` |
| Business profile | `backend/src/services/businessProfileService.ts`, `web/src/components/business-profile/` |
| Background jobs (UI) | `web/src/providers/strategy-generation-provider.tsx` |
| Migrations | `supabase/migrations/` |

---

## Progress log

| Date | Milestone |
|------|-----------|
| 2026-05 | Phase 0 + 1A integrations (GA, Ads, Meta, Shopify code) |
| 2026-06-04 | Baseline assessment; MIA 3× Ready |
| 2026-06 | Phase 1B complete (profile + background plans) |
| 2026-06-13 | Google Ads Basic Access **application submitted** |
| 2026-06-25 | Basic Access **still pending** — `DEVELOPER_TOKEN_NOT_APPROVED` on production accounts |
| 2026-06-06 | BUILD_PLAN restructured (phase map + 1C focus) |
| 2026-06-06 | **Phase 0 gate Pass** | Test P0 (P0-1–P0-4); M0 verified |
| 2026-06-06 | **Phase 1C engineering** | Snapshot health API; Integrations Data OK/errors; parallel snapshots; Thinking shows loaded sources |
| 2026-06-06 | **Phase 1C / M2 gate Pass** | Plan `8359a766…` — `data_source=multi`, why fields cite real GA+Meta metrics |
| 2026-06-07 | **Phase 2B scoped** | Refine plan + brand/competitor focus added to roadmap |
| 2026-06-07 | **Phase 2B gate Pass** | Test P2B on MIA — refine + Market context |
| 2026-06-07 | **Phase 3 gate Pass** | Workers + `audit_log` + action completions; Test P3 (M5) |
| 2026-06-08 | **Phase 4 started** | Gated Shopify SEO execution + rollback + dry-run modal |
| 2026-06-08 | **Test P4 deferred** | Shopify app review — no `write_products` on production store yet |
| 2026-06-08 | **Phase 5A–5B shipped** | Autopilot Home, rolling weeks, assist/hands-off |
| 2026-06-08 | **Plan realigned** | PROJECT_PLAN + BUILD_PLAN — goal loop, anti-drift guardrails |

_Update progress log when a phase exit criteria passes._
