# Hundres — Project Plan

**Working name:** SEO Hundreds / Hundres  
**Category:** Autonomous marketing decision system for people who are not marketers  
**Status:** V1 in active build — integrations + decision layer shipped; **Phase 5 (Autopilot & goal loop)** in progress

**Last updated:** 2026-06-08 (plan realigned — rolling goals, autopilot UX)

---

## True north (read this before every sprint)

> **Hundres is an autonomous decision engine that runs weekly work toward a measurable goal, shows defensible reasoning for each action, and stops or adapts when the data says the goal is met.**

If a feature does not serve that sentence, it is **out of scope** until the core loop works on a real workspace (Keylo / MIA).

---

## What we are building

Hundres is a **goal-driven marketing operator**. A business owner states an outcome in plain English (“grow revenue 25%”, “get more local customers”). The system:

1. Pulls **their real data** (analytics, ads, store, market intel).
2. Runs a **decision layer** (workers + Claude) to choose the highest-leverage actions **this week**.
3. **Executes or prepares** those actions (autopilot — assist or hands-off).
4. **Measures progress** toward a defined target metric.
5. **Repeats** with a new week until the goal is met — not until a fixed calendar ends.

We are **not** building another dashboard or a chatbot that dumps 50 generic tips. We are building **better decisions under uncertainty**, executed on a **weekly loop** toward a **measurable goal**.

---

## USP — The power of decision-making

### One line

**Hundres turns disconnected marketing data into clear, defensible decisions — then runs them toward your goal.**

### Why this wins

| Others | Hundres |
|--------|---------|
| Show metrics | Recommend and **run what to do next** |
| Assume you know marketing | Speaks in **plain English** |
| One channel at a time | **Synthesizes** GA, Ads, Meta, Shopify |
| “Here are 50 ideas” | **This week’s** ranked actions with impact, effort, and **why** |
| Black-box autopilot | **Traceable** — tied to your numbers, labeled confidence, audit log |
| Fixed campaign calendars | **Runs until goal met** — weeks are cycles, not a finish line |
| Risky auto-spend | **Gated writes** — approval, audit, rollback; hands-off only within caps |

### The defensible core (our moat)

Anyone can connect APIs. Our moat is the **decision / synthesis / loop**:

1. **Ingest** — First-party snapshots per workspace.
2. **Reason** — Workers + Claude weigh options against goal, constraints, and prior weeks.
3. **Decide** — Small set of **high-leverage actions** with outcome, KPI, confidence.
4. **Act** — Autopilot prepares or applies (assist vs hands-off).
5. **Measure** — Compare metrics to `goalTarget` (Phase 5C).
6. **Learn** — Log recommend → act → outcome; improve next week (Phase 5E).

See [CURSOR_BUILD_PROMPT.md](./CURSOR_BUILD_PROMPT.md) for EV/risk caps long-term.

---

## Anti-drift guardrails

Use this checklist before merging features or starting a new phase.

### ✅ Always in scope

| Rule | Why |
|------|-----|
| **One goal, one active pursuit** | User should never manage 40 actions at once |
| **This week only** on Home | Depth (history, full plan) is secondary |
| **Every action has a “why”** | Even if collapsed — decision layer must stay visible |
| **Real data when connected** | Plans cite numbers or say confidence is lower |
| **Gated external writes** | Audit + rollback; no silent ad spend |
| **Goal loop before feature breadth** | Metric check → advance or declare victory |

### 🚫 Do not build until core loop passes Keylo E2E

| Drift risk | Instead |
|------------|---------|
| More nav pages / tabs | Improve Autopilot Home |
| Full 8-week plans upfront | Rolling week generation |
| New integration before loop works | Fix GA in audit + metric read |
| More execution types (pages, ads API) | Fix intent routing for existing actions |
| Thinking page as default path | Background job + banner on Home |
| Enterprise / agency features | Solo operator hands-off first |

### 📋 Doc discipline

When product behavior changes, update **in the same PR**:

1. **PROJECT_PLAN.md** (this file) — vision / journey
2. **BUILD_PLAN.md** — phase tasks and exit criteria
3. **TASKS_AND_TESTS.md** — gates and milestones

---

## What “good” looks like for a user

- **Business profile** once (website, offer, audience) — not repeated every goal.
- **Integrations** once (GA, Ads, Meta, Shopify) — no API keys in UI.
- **One goal** on **New goal** → lands on **Autopilot Home** (background generation).
- **This week** — 3–5 actions with inline deliverables; optional “Why?” per action.
- **Autopilot** runs the week (assist: copy/paste; hands-off: apply safe store changes).
- **Target metric** shown (e.g. online revenue → +25%).
- **Next week** auto-planned from data when current week is done — **until goal met**.
- Plan **quotes their reality** when integrations are connected.
- **Refine** and **History** available but not on the critical path.

---

## Who it is for

- **Primary:** Small business owners and solo operators who want marketing handled, not another tool to learn.
- **Secondary:** Junior marketers who want a data-backed weekly operator.
- **Not for (yet):** Enterprise attribution teams or agencies managing 50 clients.

---

## Product journey (current)

```
Sign up → Workspace → Business profile + Connect (integrations)
    → New goal → Autopilot Home (generating banner)
    → This week’s actions (prepared / applied)
    → Measure vs goalTarget → next week OR goal met
```

| Screen | Purpose | Critical path? |
|--------|---------|----------------|
| **Autopilot Home** (`/`) | Goal, target metric, this week, autopilot mode, progress | **Yes** |
| **New goal** (`/new`) | Capture goal; starts background generation | **Yes** |
| **Connect** (`/integrations`) | OAuth for data sources | Setup |
| **Business** (`/business`) | Workspace context for decisions | Setup |
| **Control room** (`/plan`) | Past weeks, refine, advanced execution | No |
| **Thinking** (`/thinking`) | Legacy/debug; generation runs without it | No |
| **Check-up** (`/checkup`) | Read-only snapshot report | No |

---

## System shape (how decisions get made)

```
Business profile + user goal
        ↓
POST /api/strategy/create → generating (background)
        ↓
Snapshots: GA4 │ Google Ads │ Meta │ Shopify (read-only)
        ↓
Workers: Research │ Analysis │ Optimization
        ↓
Claude → week 1 + goalTarget (rolling; not 8-week calendar)
        ↓
strategies (active, current_week, goal_status)
        ↓
Autopilot: runWeek → assist deliverables / gated Shopify writes
        ↓
(Phase 5C) Metric check vs goalTarget
        ↓
Next week generated OR goal_status = met
        ↓
Autopilot Home (this week + why + confidence)
```

**Principles:**

- Direct APIs over remote MCP for production reliability.
- Per-workspace isolation (`organization_id`).
- Honest UI — confidence and missing data labeled.
- Writes gated; hands-off respects scope + audit + rollback.

---

## Roadmap — strategic phases

| Phase | Name | Outcome | Status |
|-------|------|---------|--------|
| **0** | Trustworthy UI | No fake data; honest empty states | ✅ Done |
| **1** | First-party read-only | GA, Ads, Meta, Shopify → snapshots | ✅ Mostly done (Ads token pending) |
| **1F** | Business context + resilient jobs | Profile + background generation | ✅ Done |
| **2** | Market intel | Directional competitor/trend context | ✅ Done |
| **2B** | Plan refinement | Refine without new goal | ✅ Done |
| **3** | Workers + audit | Specialist reasoning + traceability | ✅ Done |
| **4** | Gated execution | Approve → act → rollback (Shopify SEO v1) | ✅ Code done; E2E blocked on Shopify write |
| **5** | **Autopilot & goal loop** | Simple UX, rolling weeks, run until goal met | 🟡 **In progress** |

### Phase 5 — Autopilot & goal loop (current focus)

| ID | Outcome | Status |
|----|---------|--------|
| **5A** | Autopilot Home; simplified nav; goal → Home | ✅ Shipped |
| **5B** | Rolling weeks; `goalTarget`; `current_week`; advance week API | ✅ Shipped |
| **5C** | Weekly metric read vs `goalTarget`; stop or continue | ⬜ **Next** |
| **5D** | Intent-correct execution (action title → right executor) | ⬜ Next |
| **5E** | Outcome log: recommend → act → metric delta → next decision | ⬜ Future |

**Phase 5 exit criteria (M7):** On Keylo/MIA, user sets goal → autopilot prepares week 1 → metric checked → week 2 generated OR goal declared met — without opening 40-action plan UI.

---

## What we are explicitly not building (yet)

- Autonomous **ad spend** changes without approval.
- Replacement for GA4 or Shopify Admin.
- Guaranteed ROI — we express **confidence** and **direction**.
- Full competitor spend accuracy.
- Google Ads **writes** in v1 (Reporting / read-only).
- New channels/executors before **5C + 5D** pass on one workspace.

### Google Ads API — external dependency

| Item | Status |
|------|--------|
| OAuth + customer picker | Done |
| Read-only GAQL snapshots | Done |
| **Basic Access application** | Submitted **2026-06-13** — still pending as of **2026-06-25** |
| Blocker | `DEVELOPER_TOKEN_NOT_APPROVED` on production until Google approves |

### Shopify — external dependency

| Item | Status |
|------|--------|
| Read + execution preview | Done |
| **`write_products` scope** | App review pending — Test P4 deferred |

---

## Competitive framing

- **vs. analytics tools:** We **act**, not just report.
- **vs. generic ChatGPT:** Bound to **your data** + structured weekly loop.
- **vs. agencies:** Fast, affordable **operator** for the long tail.
- **vs. black-box autopilot SaaS:** **Defensible decisions** — why + confidence + audit — not magic.

---

## Success metrics (product)

| Metric | Why it matters |
|--------|----------------|
| **Goal loop completion** (goal → week run → metric check → next week or met) | Core product works |
| % workspaces with ≥1 integration | Decisions grounded in data |
| **This-week actions prepared** (not 40-action plan views) | Autopilot delivers value |
| User: “I didn’t have to figure out marketing” | Simplicity wins |
| Confidence distribution honest when data thin | Trust |
| Audit rows for generations + executions | Traceability |

---

## Documentation map

| Document | Use when you need… |
|----------|-------------------|
| **PROJECT_PLAN.md** (this file) | Vision, true north, anti-drift, roadmap |
| **[BUILD_PLAN.md](./BUILD_PLAN.md)** | Engineering phases & exit criteria |
| **[TASKS_AND_TESTS.md](./TASKS_AND_TESTS.md)** | Milestones, gates, test scripts |
| **[docs/AUTOPILOT_V1_OPERATING_SPEC.md](./docs/AUTOPILOT_V1_OPERATING_SPEC.md)** | Decision thresholds, pause triggers, confidence gates |
| **[BASELINE_ASSESSMENT.md](./BASELINE_ASSESSMENT.md)** | Integration + workspace snapshot |
| **[INTEGRATIONS_SETUP.md](./INTEGRATIONS_SETUP.md)** | OAuth runbook |
| **[README.md](./README.md)** | Run locally |

---

## Progress log (high level)

| Date | Milestone |
|------|-----------|
| 2026-05 | Multi-tenant auth, GA OAuth, plan pipeline |
| 2026-06-06 | Phase 0 verified |
| 2026-06-13 | Google Ads Basic Access application submitted |
| 2026-06-25 | Basic Access still pending (Test token only on production Ads) |
| 2026-06-07 | Phases 2B + 3 verified (refine, workers, audit) |
| 2026-06-08 | Phase 4 code shipped; P4 deferred (Shopify write) |
| 2026-06-08 | **Phase 5A–5B** — Autopilot Home, rolling weeks, assist/hands-off |
| 2026-06-08 | **Plan realigned** — removed fixed 8-week calendar as product model |

### Current priorities

1. **Phase 5C** — Weekly metric check vs `goalTarget` (GA + Shopify); advance or `goal_status = met`.
2. **Phase 5D** — Fix execution intent routing (e.g. SEO audit ≠ random product SEO).
3. **External:** Shopify `write_products` → Test P4; Google Ads Basic Access → Ads in snapshots.
4. **Do not start** new phases or major UI until M7 gate passes on Keylo.

_Tasks & gates: [TASKS_AND_TESTS.md](./TASKS_AND_TESTS.md). Engineering: [BUILD_PLAN.md](./BUILD_PLAN.md)._
