# Hundres — Baseline assessment

**Date:** 2026-06-08 (plan realigned — Phase 5 autopilot)  
**Purpose:** Snapshot of product + integration health. Use to compare progress.

**Runbook:** [INTEGRATIONS_SETUP.md](./INTEGRATIONS_SETUP.md) · **Tests:** [TASKS_AND_TESTS.md](./TASKS_AND_TESTS.md) · **Vision:** [PROJECT_PLAN.md](./PROJECT_PLAN.md)

---

## Executive summary

| Area | Status | Notes |
|------|--------|--------|
| **Product model** | **Phase 5** | Autopilot Home, rolling weeks, assist/hands-off — **metric loop (5C) not yet built** |
| **Platform** | Healthy | API + web; Docker |
| **Best workspace** | **Keylo / MIA** | Shopify + Meta connected; active multi-action plan |
| **Core loop gap** | **M7 open** | Goal → autopilot week → **metric check** → next week OR met |
| **External blockers** | Shopify write, Google Ads token | P4 deferred; Ads Basic Access **submitted 2026-06-13**, **still pending 2026-06-25** |

**Recommended next action:** Pass [M7 gate](./TASKS_AND_TESTS.md#phase-5-gate--autopilot--goal-loop-m7) on Keylo — prove metric loop before new features.

---

## Product build status (phases)

| Phase | Build | Verified E2E |
|-------|-------|----------------|
| **0–3** | Done | P0–P3 Pass |
| **4** Gated execution | Code done | P4 deferred (Shopify write) |
| **5A–5B** Autopilot + rolling weeks | Done | Partial manual |
| **5C** Metric loop | **Not started** | **M7 blocker** |
| **5D** Intent routing | Not started | Known bug on Keylo plan |

---

## Milestone scorecard

| ID | Milestone | Status |
|----|-----------|--------|
| M0–M5 | Trust → traceable decisions | ✅ Verified |
| M6 | Safe execution | Deferred (Shopify write) |
| **M7** | **Goal loop (autopilot)** | **Next — Phase 5 gate** |

---

## Next engineering priorities (ordered — anti-drift)

1. **5C** — `goalProgressService`: read metrics vs `goalTarget`; set `goal_status` or advance.
2. **5D** — Fix `actionRouter` intent (audit/assist vs product SEO).
3. **5A.3** — Collapsible “Why?” on Autopilot Home action cards.
4. **M7 E2E** on Keylo — document pass/fail in TASKS_AND_TESTS.
5. **When unblocked:** Test P4 (Shopify write); Google Ads Basic Access re-test.

**Do not prioritize:** New nav, 8-week upfront plans, new executors, ads API writes until M7 passes.

---

## Legacy notes (2026-06-06 snapshot)

<details>
<summary>Earlier baseline (pre–Phase 5)</summary>

| Area | Status |
|------|--------|
| Integrations (env) | GA, Ads, Meta configured |
| MIA workspace | GA + Ads + Meta Ready |
| Plans | Pre-5B plans may still have 8 weeks in JSON — UI uses `current_week` |

</details>

_Update this file when M7 passes or integration baseline changes._
