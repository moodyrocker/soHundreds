# Cursor Build Prompt — Marketing AI Agent

> Paste this into Cursor as the project brief. It assumes a fresh repo. Build in the phase order given; do not jump ahead to execution features before the safety gates exist.

---

## ROLE & CONTEXT

You are building a production SaaS called the **Marketing AI Agent** — a goal-driven, autonomous system. A user states a marketing goal in plain English; the system pulls data from many sources, scores options with an Expected-Value (EV) and risk model, and returns (or, where authorized, executes) the highest-leverage actions. Target users are marketing novices, so the UX must be jargon-free and the system must be safe by default.

The product's defensible value is the **decision/synthesis layer**, not any single data source or actuator. Build accordingly: clean separation between data ingestion, the worker/analysis layer, the orchestration/decision layer, and a gated execution layer.

---

## HARD REQUIREMENTS (do not deviate)

1. **Dockerize every component.** Each service (frontend, API, workers, database, any connector services) must run as its own container with a `Dockerfile`, orchestrated by a root `docker-compose.yml`. Provide a `.env.example`. The whole stack must come up with a single `docker compose up`.
2. **Use the `UIHundreds` UI directory for all UI components.** Do not hand-roll or import a different component library for primitives. Pull buttons, inputs, cards, modals, tables, progress indicators, etc. from `UIHundreds`. If a needed component is missing there, extend `UIHundreds` rather than introducing a parallel system. Keep all shared UI in/through that directory.
3. **Safe by default.** Anything that writes to a live external system (especially Shopify) must be gated behind explicit user approval, fully logged, and reversible. No live mutation ships without approval + audit + rollback. Do not build auto-execution before these gates exist.
4. **Platform-agnostic core.** Platform-specific code (e.g. Shopify) lives behind connector interfaces. The core product must not depend on any single platform.
5. **Every recommendation is traceable** to its source(s) and a confidence tier.

---

## TECH STACK

- **Frontend:** React + TypeScript + Tailwind CSS, components sourced from `UIHundreds`.
- **Backend/API:** Node.js + Express + TypeScript.
- **Workers:** TypeScript services (can run in-process initially, but containerized and structured so they can scale out).
- **Database:** PostgreSQL (Supabase-compatible).
- **AI:** Anthropic Claude API (latest Sonnet/Opus tier) for orchestration, worker reasoning, and plain-English output.
- **Deployment:** Docker + Docker Compose.

---

## TARGET ARCHITECTURE

```
UI (React/TS/Tailwind, components from UIHundreds)
  → API Layer (Express): goal processing, orchestration, approval gates, auth
    → Claude Orchestration: worker dispatch, synthesis, EV/risk scoring, output
        ├── AI Workers (analysis)
        ├── Data / MCP Layer (ingestion)
        └── Execution Layer (gated actuators)
  → PostgreSQL: strategies, performance history, audit log, learning data
```

Each box above is a containerized concern. Keep clear interface boundaries so workers, data connectors, and actuators are swappable.

---

## COMPONENT SPECS

### AI Worker Layer (parallel specialists; each outputs a structured report + confidence)
- **Research Worker** — web search, competitor gathering, benchmarks, trends. → market intelligence report.
- **Competitive Intelligence Worker** — competitor ad creative, spend estimates, ad history, keyword/PPC data, messaging; voice-of-customer review mining; competitor pricing/page-change detection. Heuristic: **ad longevity ≈ conversion proxy** (weight long-running ads heavily). → competitive landscape report with confidence-rated signals.
- **Analysis Worker** — SEO technical analysis, keyword opportunities, multi-touch attribution (first/last/linear/time-decay/data-driven), customer journey, CLV. → analytics insights report.
- **Optimization Worker** — EV-based channel spend allocation, smart bidding, budget distribution, ROI optimization, A/B design (EV, portfolio optimization, diminishing-returns, Monte Carlo). → ranked actions that become execution candidates.
- **Forecasting Worker** — revenue/traffic/conversion modeling, seasonality, confidence intervals. → forecast with confidence bands.

### Data / MCP Layer (tag every source with a confidence tier)
- **First-party (highest confidence — ground truth), read-only first:** Google Ads, Meta Ads, GA4, Shopify — via MCP/OAuth.
- **Competitor ad intel:**
  - *Free official (build first):* Meta Ad Library API (active FB/IG ads + creative/copy), Google Ads Transparency Center (Search/Display/YouTube; needs a parsing layer).
  - *Paid estimation (directional only):* SpyFu (primary — keyword rankings, PPC spend estimates, ad-copy history, domain SEO; API on lower tiers). SEMrush or cheaper SE Ranking later. Pathmatics/Adbeat for display/video later.
- **Demand signals:** Google Trends + keyword volume; SimilarWeb channel mix.
- **Voice-of-customer & monitoring:** review mining (G2, Trustpilot, Capterra, app stores); Crayon-style competitor change detection.
- **SERP/AI-Overview modeling:** discount raw rankings — model AI Overview click-through suppression; prefer traffic-potential estimates over raw volume.
- **Data-quality rule:** only first-party platforms and official ad libraries are ground truth; everything else is an estimate. Lean on high-confidence signals (live ads, ad longevity, exact creative/copy, first-party metrics) for actual recommendations; treat spend figures as directional.

### Orchestration / Decision Layer
- Dispatches workers, synthesizes their reports, applies the **EV + risk model**, and produces a single ranked, plain-English recommendation set.
- Logs every recommendation, action, and outcome for the learning loop.

### Execution Layer (gated actuators — Phase 3, not before)
- **Shopify execution** via Shopify MCP + open-source Shopify AI Toolkit: edit product titles/descriptions, SEO title & meta fields, collections, bulk edits, pricing through validated GraphQL mutations. **Orchestrate the existing toolkit — do not rebuild execution plumbing.**
- **Mandatory gates around every write:**
  1. Approval by default (per action or batch); auto-execute is opt-in, scoped, EV/risk-capped.
  2. Full audit log — action, before/after state, timestamp, triggering reasoning/EV.
  3. One-click rollback — read & store current state before any change.
  4. Dry-run/preview — show exact change + predicted impact before commit.
  5. Least-privilege scopes.
- Same gated pattern extends later to WordPress and Ads write actions.

---

## UX REQUIREMENTS

- Goal input: text box + quick-goal buttons ("Make more money", "Get more customers") + optional context (business, budget, platforms). Single "Create my plan" button.
- Transparent 4-step progress: Understanding goal → Researching market → Analyzing opportunities → Creating strategy/executing.
- Results: large readable text, color-coded priorities, scannable sections — executive summary → expected results → 5–8 prioritized steps → tracking guidance.
- Execution-enabled steps render an **Approve / Edit / Skip** control with estimated impact + risk level.
- All of the above built from `UIHundreds` components.

---

## BUILD ORDER

**Phase 1 — Foundation (advisor):** repo + Docker scaffold (all services containerized, `docker compose up` works); UI shell from `UIHundreds`; goal input → 4-step flow → plain-English plan; Research/Analysis/Optimization/Forecasting workers; first-party MCP connectors **read-only**; EV/risk decision layer v1; Postgres schema incl. audit + learning tables.

**Phase 2 — Competitive edge:** Competitive Intelligence Worker; free ad libraries first (Meta Ad Library API, Google Ads Transparency); SpyFu API; Google Trends + keyword data; review mining + Crayon-style detection; SimilarWeb; SERP/AI-Overview modeling; confidence-tiering across all sources.

**Phase 3 — Execution (gated):** Execution Layer framework (approval gates, audit log, rollback, dry-run) **first**; then Shopify execution via MCP/Toolkit; opt-in scoped auto-execution with EV/risk caps.

**Phase 4 — Autonomy:** outcomes feed back into EV weights + confidence tiers; standing goals the agent monitors and (where pre-approved) acts on.

---

## DELIVERABLES FOR THIS SESSION (Phase 1)

1. Repo structure with a containerized service per concern + root `docker-compose.yml` + `.env.example`.
2. `UIHundreds`-based UI shell with the goal-input flow and 4-step progress.
3. Express API with goal endpoint, orchestration stub, and auth scaffold.
4. One worker fully implemented end-to-end (Research Worker) wired to the Claude API as the reference pattern; others stubbed with the same interface.
5. Postgres schema with strategies, performance history, **audit log**, and learning tables.
6. README: how to run with Docker, env vars, and where `UIHundreds` lives.

Confirm the repo structure and `docker-compose.yml` with me before implementing workers.
