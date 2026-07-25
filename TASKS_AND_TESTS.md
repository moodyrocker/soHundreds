# Hundres — Task List & Test Playbook

**Purpose:** Single place to see **where we are**, **what’s left**, and **how to prove** a phase is done before moving on.

| Related docs |
|--------------|
| [PROJECT_PLAN.md](./PROJECT_PLAN.md) — vision & USP |
| [BUILD_PLAN.md](./BUILD_PLAN.md) — engineering checklists |
| [README.md](./README.md) — run the stack |
| [INTEGRATIONS_SETUP.md](./INTEGRATIONS_SETUP.md) — connect GA, Ads, Meta, Shopify |
| [BASELINE_ASSESSMENT.md](./BASELINE_ASSESSMENT.md) — current status snapshot (2026-06-04) |
| [docs/V1_READINESS_TRACKING.md](./docs/V1_READINESS_TRACKING.md) — **V1 + Keylo test tracker** (M7, P4, conversion suite) |

**How to use:** Work top-down by phase. Do not mark a phase **Complete** until every task is checked **and** every test in that phase’s gate is **Pass**.

---

## Latest automated test run (agent — 2026-05-31)

| Area | Result | Notes |
|------|--------|-------|
| API `/health` | **Pass** | `{"status":"ok"}` |
| Web `:5000` | **Pass** | HTTP 307 (redirect to app) |
| Backend `tsc` / web `next build` | **Pass** | |
| DB tables | **Pass** | `organizations`, `strategies`, `mcp_connections` |
| Pending migrations | **Fixed** | Applied `20250602000000`–`20250605000000` via `docker compose exec api node /app/apply-pending-migrations.mjs` (see below) |
| `mcp_connections.config` | **Pass** | Column present after migration |
| `data_source` constraint | **Pass** | Includes `analytics`, `google_ads`, `meta_ads`, `shopify`, `multi`, `generic` |
| GA in DB | **Pass** | 1 connection, property `properties/389865356` |
| Strategies | **Pass** | 2 rows, `data_source=analytics` |
| Env: Google OAuth | **Pass** | Connect button can work |
| Env: Ads / Meta / Shopify | **Skip** | Not in `.env` — E2E blocked until you add credentials |
| OAuth UI flows (GA–Shopify) | **Manual** | Agent cannot sign in as you — **you** run browser tests below |
| P0-3 no `.env` in UI | **Pass** | No `.env` copy in integration components (prod build) |
| `mock-data.ts` removed | **Pass** | File gone |
| Minor copy | **Warn** | Goal placeholder still mentions “bakery” as an example only |

**Action for you (≈15 min):** Log in → run [GA E2E](#test-ga) checklist in browser. Add `GOOGLE_ADS_DEVELOPER_TOKEN` / Meta / Shopify to `.env` when you want those tests.

**Apply migrations (if a fresh DB):**

```bash
docker cp supabase/migrations <api-container>:/tmp/migrations
docker cp backend/scripts/apply-pending-migrations.mjs <api-container>:/app/apply-pending-migrations.mjs
docker compose exec api node /app/apply-pending-migrations.mjs
```

---

## Where we are now (snapshot)

**Product model (2026-06-08):** Rolling goal pursuit — weekly autopilot until `goalTarget` met. Not a fixed 8-week calendar.

| Phase | Build status | Verified E2E? | Gate to next phase |
|-------|--------------|-----------------|-------------------|
| **0–4** | Complete (4 E2E deferred on Shopify write) | P0–P3 Pass; P4 skipped | → **Phase 5** |
| **5A–5B** Autopilot UX + rolling weeks | ✅ Shipped | Manual on Keylo partial | → **5C** |
| **5C** Metric loop | ✅ Shipped | Keylo E2E → **M7** |
| **5D** Intent routing | ✅ Shipped | M7 |
| **5E** Outcome learn loop | ✅ Shipped | M7 |

**Current focus:** Phase **5C** (metric check vs goal) + **5D** (execution intent). Do not add features outside [PROJECT_PLAN.md anti-drift](./PROJECT_PLAN.md#anti-drift-guardrails).

**External blockers (parallel):** Google Ads Basic Access **submitted 2026-06-13**, **pending** (deferred from V1 suite).

---

## Milestones

| ID | Milestone | Target | Done when |
|----|-----------|--------|-----------|
| **M0** | Trustworthy product shell | ✅ **Verified** | Phase 0 gate Pass (Test P0, 2026-06-06) |
| **M1** | First real plan (GA only) | ✅ Shipped (code) | GA E2E Pass |
| **M2** | Multi-channel read-only | ✅ **Verified** 2026-06-06 | Plan `8359a766…` — `data_source=multi`, why fields cite GA+Meta |
| **M3** | Phase 1 complete | ✅ | 1D check-up shipped; 1E largely proven by M2 |
| **M4** | Market-aware plans | ✅ **Verified** | Phase 2 gate Pass (Test P2) |
| **M4B** | Refineable plans | ✅ **Verified** | Phase 2B gate Pass (Test P2B) |
| **M5** | Traceable decisions (audit) | ✅ **Verified** 2026-06-07 | Phase 3 gate Pass (Test P3) |
| **M6** | Safe execution | **Verified** 2026-07-07 | Test P4 Pass on Keylo (dry-run, execute, audit, rollback) |
| **M7** | **Goal loop (autopilot)** | **Next** | Phase 5 gate Pass — metric check → next week or goal met on Keylo |

---

## Phase 5 gate — Autopilot & goal loop (M7)

Advance to Phase 5E / new executors only when all Pass:

- [x] New goal → Autopilot Home (not Thinking-first)
- [x] Week 1 + `goalTarget` in plan summary
- [x] Autopilot prepares this week’s actions (≥80% success rate)
- [x] Metric read compares to `goalTarget` (GA and/or Shopify and/or Instagram)
- [x] System advances to week 2 OR sets `goal_status = met` with reason
- [x] SEO/content actions route to assist — not wrong Shopify product
- [x] User can complete happy path without opening Full plan

**Test script (Keylo / MIA):**

1. Connect Shopify + Meta (minimum).
2. **New goal** → wait on Home → week 1 actions appear with deliverables.
3. Confirm target metric shown on Home.
4. Complete or run autopilot for all week-1 actions.
5. Trigger metric check (manual or auto) → week 2 OR goal met banner.
6. Record pass/fail below.

---

## Phase gates (advance only when all Pass)

### Phase 0 → Phase 1 work ✅ (closed 2026-06-06)

- [x] New user: signup → setup org → dashboard shows **empty state** or real plan (no bakery demo) — P0-1, P0-2
- [x] Integrations: capabilities drive Connect visibility (no Connect on “planned” only) — P0-3, P0-4
- [x] Dashboard week 1 = first week of **saved** plan or empty copy — P0-2

### Phase 1 (1A–1D) → Phase 1E

- [ ] Every integration you **ship to users** has E2E test **Pass** (see integration tests below)
- [ ] Plans never show fake property/customer IDs from old mock data
- [ ] Tenant isolation: second org does not see first org’s connections (manual or SQL check)

### Phase 1E → Phase 2

- [ ] With GA + Ads (or GA + Shopify) connected: new plan has `data_source = multi`
- [ ] Plan “why” fields reference numbers from **both** sources (spot-check)
- [ ] Thinking screen lists all ready sources
- [ ] Snapshot fetches run in parallel (API logs show concurrent calls; no sequential timeout failures)

### Phase 2 → Phase 2B ✅

- [x] Business profile **Businesses to emulate** saved and used in Market context
- [x] Plan includes `marketIntel` with **low/medium** confidence + disclaimer
- [x] No competitor metric presented as ground truth

### Phase 2B → Phase 3 ✅

- [x] **Refine this plan** on `/plan` regenerates with user’s brand/competitor notes
- [x] Refinement visible in Market context (emulateNotes) or action “why” fields
- [x] Original plan kept in history; **Edit goal** clearly distinct from **Refine**
- [ ] (Optional) Early competitor focus on Thinking before generation starts

### Phase 3 → Phase 4 ✅

- [x] `audit_log` row per plan generation
- [x] At least one worker produces structured JSON consumed by orchestrator
- [x] Action completion toggles persist after refresh (Test P3-2)

### Phase 4 → production execution ⏸ deferred

- [x] Approve / Edit / Skip UI + dry-run preview (code shipped)
- [x] Audit before/after on writes (code shipped)
- [x] Rollback path (code shipped)
- [ ] **Test P4 E2E** — blocked: Shopify app not reviewed; no `write_products` on live Keylo store yet
- [ ] No write to external system without Approve UI (verify when P4 unblocked)

---

## Master task list

### Phase 0 — Trustworthy UI ✅

| ID | Task | Status |
|----|------|--------|
| 0.1 | Remove mock plan/dashboard data | [x] |
| 0.2 | Neutral copy (no bakery persona) | [x] |
| 0.3 | Neutral signup/setup placeholders | [x] |
| 0.4 | `GET /api/mcp/capabilities` | [x] |
| 0.5 | Integrations honor capabilities | [x] |
| 0.6 | Dashboard week 1 from active plan | [x] |
| 0.7 | `mcp_connections.config` JSONB | [x] |
| 0.T1 | Run [Phase 0 test script](#test-p0) | [x] 2026-06-06 |

---

### Phase 1A — Google Analytics harden

| ID | Task | Status |
|----|------|--------|
| 1A.1 | Show GA snapshot errors on Integrations (permission / API disabled) | [ ] |
| 1A.2 | (Optional) Persist platforms used on `strategies` row | [ ] |
| 1A.T1 | Run [GA hardening tests](#test-1a) | [ ] |

---

### Phase 1B — Google Ads ✅ code

| ID | Task | Status |
|----|------|--------|
| 1B.1–1B.7 | See [BUILD_PLAN.md](./BUILD_PLAN.md) | [x] |
| 1B.T1 | Env: `GOOGLE_ADS_DEVELOPER_TOKEN` in deployed `.env` | [ ] |
| 1B.T2 | Run [Google Ads E2E](#test-1b-google-ads) | [ ] |

---

### Phase 1C — Meta Ads ✅ code

| ID | Task | Status |
|----|------|--------|
| 1C.1–1C.4 | See BUILD_PLAN | [x] |
| 1C.T1 | Env: `META_APP_ID`, `META_APP_SECRET`, redirect URI | [ ] |
| 1C.T2 | Run [Meta Ads E2E](#test-1c-meta-ads) | [ ] |

---

### Phase 1D — Shopify ✅ code

| ID | Task | Status |
|----|------|--------|
| 1D.1–1D.4 | See BUILD_PLAN | [x] |
| 1D.T1 | Env: `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` | [ ] |
| 1D.T2 | Run [Shopify E2E](#test-1d-shopify) | [ ] |

---

### Phase 1D — Marketing check-up (advisor) 🟡

| ID | Task | Status |
|----|------|--------|
| 1D-CH.1 | Spec: report snapshot vs chat | [x] [`docs/checkup-spec.md`](./docs/checkup-spec.md) |
| 1D-CH.2 | Backend: `checkup_reports` + `/api/checkup/*` | [x] |
| 1D-CH.3 | Frontend: `/checkup` + sidebar link | [x] |
| 1D-CH.T1 | `checkup_reports` in `schema.sql` (auto on API start) | [x] |
| 1D-CH.T2 | Run [Check-up E2E](#test-1d-checkup) on MIA | [x] |

---

### Phase 2 — Market intel 🟡

| ID | Task | Status |
|----|------|--------|
| 2.1 | `MarketIntelConnector` + web_search V1 | [x] |
| 2.2 | Business profile: businesses to emulate | [x] |
| 2.3 | Plan `marketIntel` JSON + prompt rules | [x] |
| 2.4 | Plan UI: Market context card | [x] |
| 2.T1 | Run [Test P2](#test-p2) on MIA | [x] |

---

### Phase 2B — Plan refinement & brand focus

| ID | Task | Status |
|----|------|--------|
| 2B.1 | Spec: refine vs new plan vs profile emulate | [x] |
| 2B.2 | DB: `refinement_notes` and/or `parent_strategy_id` on `strategies` | [x] |
| 2B.3 | `POST /api/strategy/:id/refine` — snapshots + refinement in prompt | [x] |
| 2B.4 | Prompt: weight brand analysis / emulate in refinement runs | [x] |
| 2B.5 | Plan UI: **Refine this plan** modal + regenerate flow | [x] |
| 2B.6 | Rename/clarify **Edit goal** → “Start new plan” | [x] |
| 2B.7 | (Optional) Thinking: **Add competitor focus** before generation | [ ] |
| 2B.8 | Settings: history shows refinement snippet | [x] |
| 2B.T1 | Run [Test P2B](#test-p2b) on MIA | [x] 2026-06-07 |

---

### Phase 1E — Unified multi-source

| ID | Task | Status |
|----|------|--------|
| 1E.1 | Parallel snapshot fetch in `StrategyService.create()` | [ ] |
| 1E.2 | `data_source` covers all single sources + `multi` (verify DB constraint) | [ ] |
| 1E.3 | Plan chip lists sources (e.g. “GA + Ads + Shopify informed” vs generic “Multi-source”) | [ ] |
| 1E.T1 | Run [Multi-source E2E](#test-1e-multi-source) | [ ] |

---

### Phase 3 — Workers + audit

| ID | Task | Status |
|----|------|--------|
| 3.1 | Research worker E2E pattern | [x] |
| 3.2 | Analysis + Optimization workers (stub OK initially) | [x] |
| 3.3 | `audit_log` migration + write on plan create | [x] |
| 3.4 | `plan_action_completions` + UI toggle on actions | [x] |
| 3.T1 | Run [Phase 3 tests](#test-p3) | [x] 2026-06-07 |

---

### Phase 4 — Gated execution

| ID | Task | Status |
|----|------|--------|
| 4.1 | Approve / Edit / Skip on plan actions | [x] |
| 4.2 | Audit log: before/after on writes | [x] |
| 4.3 | Rollback for Shopify toolkit mutations | [x] |
| 4.4 | Dry-run preview before commit | [x] |
| 4.T1 | Run [Phase 4 tests](#test-p4) | [x] **Pass** Keylo 2026-07-07 |

---

## Test playbook

### Preconditions (every session)

```bash
# From repo root
docker compose build api web && docker compose up -d api web
docker compose logs api --tail 20   # no crash loop
curl -s http://localhost:3001/health  # expect OK
```

| Check | Pass? |
|-------|-------|
| Web loads http://localhost:5000 | [ ] |
| API health OK | [ ] |
| Supabase migrations applied (incl. `strategies`, `mcp_connections`, `data_source` constraints) | [ ] |
| `.env` has `ANTHROPIC_API_KEY`, `ENCRYPTION_KEY`, Supabase keys | [ ] |

**Tester:** _______________ **Date:** _______________ **Build/git ref:** _______________

---

<a id="test-p0"></a>

### Test P0 — Phase 0

| # | Steps | Expected | Pass? |
|---|--------|----------|-------|
| P0-1 | Incognito → signup → create org | Lands on dashboard or setup; org name is yours | [x] |
| P0-2 | Dashboard with no plan | Empty state; no hardcoded “Maya” / bakery tasks | [x] |
| P0-3 | Integrations without server OAuth | “Not available yet” / no `.env` instructions (prod build) | [x] |
| P0-4 | `GET /api/mcp/capabilities` (logged in) | JSON list; `implemented` matches what Connect shows | [x] |

---

<a id="test-1a"></a>

### Test 1A — GA hardening

| # | Steps | Expected | Pass? |
|---|--------|----------|-------|
| 1A-1 | Connect GA + valid property | Status **Ready**; property id shown | [ ] |
| 1A-2 | Revoke Data API in GCP (or wrong property) → refresh Integrations | User-visible error, not silent failure | [ ] |
| 1A-3 | New plan with GA ready | Chip **GA-informed** or **Multi-source**; “why” cites metrics | [ ] |
| 1A-4 | Disconnect GA → new plan | Chip **Research-based**; no GA numbers in plan | [ ] |

---

<a id="test-ga"></a>

### Test 1 — Google Analytics E2E

| # | Steps | Expected | Pass? |
|---|--------|----------|-------|
| GA-1 | Integrations → Connect with Google | OAuth → callback → “Select property” | [ ] |
| GA-2 | Save property | Chip **Connected** / Ready | [ ] |
| GA-3 | New goal → Thinking → Plan | Plan saves; goal matches input | [ ] |
| GA-4 | Dashboard | Same goal; week 1 actions present | [ ] |
| GA-5 | API: latest strategy | `data_source` = `analytics` (if only GA) | [ ] |

```bash
docker compose exec api node -e "
  const {query}=require('./dist/database/connection.js');
  query(\"SELECT goal, data_source, created_at FROM strategies ORDER BY created_at DESC LIMIT 1\")
    .then(r=>console.log(r.rows[0]));
"
```

---

<a id="test-1b-google-ads"></a>

### Test 1B — Google Ads E2E

| # | Steps | Expected | Pass? |
|---|--------|----------|-------|
| ADS-1 | Integrations → Google Ads → Connect with Google | Callback; pick customer account | [ ] |
| ADS-2 | Save customer | Ready; customer id shown | [ ] |
| ADS-3 | New plan | `data_source` = `google_ads` or `multi`; paid search context in actions | [ ] |
| ADS-4 | Disconnect Ads → new plan | No Ads snapshot in reasoning (unless other sources) | [ ] |

---

<a id="test-1c-meta-ads"></a>

### Test 1C — Meta Ads E2E

| # | Steps | Expected | Pass? |
|---|--------|----------|-------|
| META-1 | Connect with Meta → pick ad account | Ready | [ ] |
| META-2 | New plan | `meta_ads` or `multi`; paid social references | [ ] |

---

<a id="test-1d-checkup"></a>

### Test 1D-CH — Marketing check-up E2E

**Setup:** `docker compose up -d --build`. Migration applied. MIA with GA + Meta Ready.

| # | Steps | Expected | Pass? |
|---|--------|----------|-------|
| CH-1 | Sidebar → **Check-up** | `/checkup` loads; empty state or past report | [ ] |
| CH-2 | Click **Run check-up** | ~30–60 s; headline + overall health chip | [ ] |
| CH-3 | Live metrics grid | GA and/or Meta numbers (or honest zeros) | [ ] |
| CH-4 | Data coverage | Connected vs loaded vs error per source | [ ] |
| CH-5 | Sections | What's working / weak / missing + top 3 priorities | [ ] |
| CH-6 | Run again | New row in **Past check-ups**; can switch between snapshots | [ ] |
| CH-7 | **Turn into 8-week plan** link | Navigates to `/new` | [ ] |

---

<a id="test-1d-shopify"></a>

### Test 1D — Shopify E2E

| # | Steps | Expected | Pass? |
|---|--------|----------|-------|
| SH-1 | Enter `store.myshopify.com` → Connect store | Shopify approve → back with success notice | [ ] |
| SH-2 | Integrations | Store domain shown; Ready (no extra picker) | [ ] |
| SH-3 | New plan | `shopify` or `multi`; revenue/product context | [ ] |

---

<a id="test-1c-polish"></a>

### Test 1C-P — Snapshot health & honest Integrations

**Setup:** `docker compose up -d --build`. MIA workspace with GA + Meta Ready (Ads Ready optional).

| # | Steps | Expected | Pass? |
|---|--------|----------|-------|
| 1CP-1 | Integrations → wait for health check | Ready integrations show **Data OK** or **Data error** chip (not only Connected) | [ ] |
| 1CP-2 | Google Ads Ready (if token pending) | **Data error** with `DEVELOPER_TOKEN_NOT_APPROVED` user message | [ ] |
| 1CP-3 | GA Ready with bad API | Red error explaining Data API / auth issue | [ ] |
| 1CP-4 | `GET /api/mcp/snapshot-health` (auth) | JSON `platforms[]` with `dataAvailable`, `userMessage` per source | [ ] |
| 1CP-5 | New plan → Thinking | Data step lists **loaded** sources only; skipped sources noted if connected but failing | [ ] |

---

<a id="test-1e-multi-source"></a>

### Test 1E — Multi-source E2E

**Setup:** GA Ready + at least one of (Ads, Meta, Shopify) Ready.

| # | Steps | Expected | Pass? |
|---|--------|----------|-------|
| MS-1 | Thinking screen | Lists sources that **loaded** (probe passed), not merely MCP Ready | [ ] |
| MS-2 | New plan | `data_source` = `multi` | [x] 2026-06-06 `8359a766…` |
| MS-3 | Plan chip | Reflects multiple sources (not only “GA-informed”) | [x] |
| MS-4 | Read 2–3 action “why” blocks | References numbers from **≥2** connected platforms | [x] |
| MS-5 | API logs during create | Snapshots requested in parallel (timing overlap) | [ ] |

---

<a id="test-p2"></a>

### Test P2 — Phase 2 market intel

**Setup:** `docker compose up -d --build`. Business profile has website + offer (and optional emulate list).

| # | Steps | Expected | Pass? |
|---|--------|----------|-------|
| P2-1 | `/business` → save website + emulate | Profile saved | [ ] |
| P2-2 | `/new` → create plan | Generation completes (may take longer — web search) | [ ] |
| P2-3 | `/plan` | **Market context** card with headline + comparables/trends | [ ] |
| P2-4 | Market chip | Shows `low` or `medium` + “directional” — not `high` | [ ] |
| P2-5 | Plan summary chip | First-party confidence unchanged (e.g. `high` if Meta loaded) | [ ] |
| P2-6 | Disclaimer | “verify before acting” or similar on market block | [ ] |

---

<a id="test-p2b"></a>

### Test P2B — Phase 2B plan refinement

**Setup:** Active plan on MIA (Phase 2 Test P2 passed or equivalent). Business profile has website; emulate optional.

| # | Steps | Expected | Pass? |
|---|--------|----------|-------|
| P2B-1 | `/plan` → **Refine this plan** | Modal opens with textarea (brand/competitor placeholder) | [x] |
| P2B-2 | Enter refinement e.g. “Analyse Glossier’s Instagram — I want to emulate their content rhythm, not pricing” → Regenerate | Thinking/generation starts; prior plan still in Settings history | [x] |
| P2B-3 | New/refined `/plan` | **Market context → Emulate** references named brand or refinement theme | [x] |
| P2B-4 | Week 1 actions | At least one “why” ties refinement to a concrete action | [x] |
| P2B-5 | **Edit goal** / **Start new plan** | Starts fresh plan at `/new` — does not merge refinement into old row | [x] |
| P2B-6 | (Optional) Thinking before first run | **Add competitor focus** merges into context if generation not started | [ ] |

---

<a id="test-p3"></a>

### Test P3 — Phase 3 ✅

| # | Steps | Expected | Pass? |
|---|--------|----------|-------|
| P3-1 | Create or refine plan | Row in `audit_log` with org, model, sources, worker_reports | [x] 2026-06-07 |
| P3-2 | Mark week-1 action complete | Persists after refresh | [x] 2026-06-07 |

**Proof (MIA / Keylo):** Refine run `89856094…` — `plan_refined`, `data_source=multi`, sources `meta_ads`+`shopify`, three worker reports in audit row.

---

<a id="test-p4"></a>

### Test P4 — Phase 4 (Shopify SEO v1) ✅ Pass (Keylo 2026-07-07)

**Status:** **Pass 4/4** on Keylo — dry-run, execute, audit log, rollback verified by user.

**Setup (when unblocked):** Shopify connected with **write_products** scope. Active plan with an SEO or content action.

| # | Steps | Expected | Pass? |
|---|--------|----------|-------|
| P4-1 | `/plan` → expand SEO/content action → **Hundres do this for me** | Dry-run modal shows before/after SEO fields; nothing written yet | [x] |
| P4-2 | **Approve & run** | Shopify product SEO updates; action shows **Executed** | [x] |
| P4-3 | SQL: `SELECT event_type, metadata FROM audit_log WHERE event_type = 'action_executed' ORDER BY created_at DESC LIMIT 1` | Row with before/after in metadata | [x] |
| P4-4 | **Rollback change** on same action | Shopify SEO restored; status **Rolled back** | [x] |

**Verified on Keylo:** `write_products` + `write_content` scopes; full approve → audit → rollback path confirmed.

---

## Cross-cutting tests (run before any milestone sign-off)

| # | Area | Steps | Pass? |
|---|------|--------|-------|
| X-1 | Auth | Logout/login; `next` redirect preserves OAuth callback | [ ] |
| X-2 | Multi-tenant | Two users/orgs: org B cannot see org A strategy (API with wrong `X-Organization-Id` → 403/empty) | [ ] |
| X-3 | Security | No tokens in browser network tab (only Bearer to API; tokens server-side encrypted) | [ ] |
| X-4 | Errors | API down during Thinking → user sees error, not infinite spinner | [ ] |
| X-5 | Honest UI | Integration unavailable → friendly message, not `.env` (production build) | [ ] |

---

## Smoke commands (quick dev check)

```bash
# Capabilities require auth (Bearer + X-Organization-Id) — use browser Network tab on Integrations
# Or after login, copy token from devtools and:
# curl -s -H "Authorization: Bearer <token>" -H "X-Organization-Id: <org-id>" http://localhost:3001/api/mcp/capabilities

# After login, use browser network tab for:
# GET /api/mcp/status  (with Bearer + X-Organization-Id)
# POST /api/strategy/create

# DB: connections per org
docker compose exec api node -e "
  const {query}=require('./dist/database/connection.js');
  query('SELECT organization_id, platform, status, property_id, config FROM mcp_connections ORDER BY platform')
    .then(r=>console.table(r.rows));
"
```

---

## Test run log (copy per release)

| Run date | Phase tested | Tester | Git commit | Pass/Fail | Notes |
|----------|--------------|--------|------------|-----------|-------|
| 2026-05-31 | Infra + DB + build | Agent | — | **Partial Pass** | Migrations applied; GA connected in DB |
| 2026-05-31 | P0 browser | | | **Pending** | You: signup/empty states |
| 2026-06-06 | **Test P0** (Phase 0) | User | — | **Pass** | P0-1–P0-4; M0 verified |
| 2026-06-06 | **M2 / Phase 1C** | User | — | **Pass** | Plan `8359a766…` multi-source; why fields OK |
| 2026-05-31 | GA E2E | | | **Pending** | You: OAuth UI (DB shows prior success) |
| | Ads E2E | | | **Blocked** | Add `GOOGLE_ADS_DEVELOPER_TOKEN` |
| | Meta E2E | | | **Blocked** | Add `META_APP_*` |
| | Shopify E2E | | | **Blocked** | Add `SHOPIFY_*` |
| | 1E multi | | | **Pending** | After 1E build + 2+ integrations |

---

## Recommended order (next 2–3 sprints)

1. ~~**Verify P0**~~ — Done 2026-06-06.
2. ~~**1C-E1–E5**~~ — Snapshot health API + Integrations/Thinking UX (2026-06-06).
3. ~~**M2**~~ — Multi-source plan verified 2026-06-06.
4. ~~**Phase 2**~~ — Test P2 Pass.
5. ~~**Phase 2B**~~ — Refine plan UI + API + Test P2B Pass.
6. **Google Ads** — When Basic Access approved, re-test Ads snapshot → full `multi`.
7. ~~**Phase 3**~~ — Workers + audit + Test P3 Pass (2026-06-07).
8. ~~**Phase 4 / M6**~~ — Test P4 **Pass** on Keylo 2026-07-07.

---

## Sync with BUILD_PLAN

When a task completes here, check the matching item in [BUILD_PLAN.md](./BUILD_PLAN.md) and add a line to its **Progress log**. When a phase gate is fully Pass, update [PROJECT_PLAN.md](./PROJECT_PLAN.md) progress table if needed.
