# Hundres documentation index

**One place for all product and engineering docs.**  
Start here, then follow links for depth.

**Last updated:** 2026-07-19

---

## Start here

| Doc | When to read |
|-----|----------------|
| [ORIGIN_AND_STATUS.md](./ORIGIN_AND_STATUS.md) | Original goal vs today — go-live capability map |
| [META_FACEBOOK_INSTAGRAM_CAPABILITIES.md](./META_FACEBOOK_INSTAGRAM_CAPABILITIES.md) | Facebook vs Instagram: posts vs ads (what works) |
| [AUTOPILOT_V1_OPERATING_SPEC.md](./AUTOPILOT_V1_OPERATING_SPEC.md) | How Autopilot decides, executes, and gates spend |
| [../README.md](../README.md) | How to run the stack (Docker, env, ports) |

---

## Product & go-live

| Doc | Purpose |
|-----|---------|
| [ORIGIN_AND_STATUS.md](./ORIGIN_AND_STATUS.md) | True north, capability matrix, pre-flight checklist |
| [V1_READINESS_TRACKING.md](./V1_READINESS_TRACKING.md) | V1 sign-off: M7, Keylo tests, open fixes |
| [AUTOPILOT_V1_OPERATING_SPEC.md](./AUTOPILOT_V1_OPERATING_SPEC.md) | Decision gates, Meta throttle, human spend gate |
| [META_FACEBOOK_INSTAGRAM_CAPABILITIES.md](./META_FACEBOOK_INSTAGRAM_CAPABILITIES.md) | Organic IG posts vs Meta ads on FB+IG |
| [AD_CAMPAIGN_LIBRARY.md](./AD_CAMPAIGN_LIBRARY.md) | Meta creatives library + enrichment flow |
| [../PROJECT_PLAN.md](../PROJECT_PLAN.md) | Vision, anti-drift guardrails, roadmap |
| [../TASKS_AND_TESTS.md](../TASKS_AND_TESTS.md) | Milestones, phase gates, manual test playbook |
| [../BASELINE_ASSESSMENT.md](../BASELINE_ASSESSMENT.md) | Status baseline (what’s connected / what’s next) |

---

## Integrations & setup

| Doc | Purpose |
|-----|---------|
| [../INTEGRATIONS_SETUP.md](../INTEGRATIONS_SETUP.md) | Connect GA, Google Ads, Meta, Shopify (OAuth, `.env`, ngrok) |
| [../META_ADS_SETUP.md](../META_ADS_SETUP.md) | Meta Ads OAuth / app setup notes |
| [../MCP_ARCHITECTURE.md](../MCP_ARCHITECTURE.md) | MCP tiers — analytics core + actuation bridges |
| [../ANALYTICS_MCP_ARCHITECTURE.md](../ANALYTICS_MCP_ARCHITECTURE.md) | Analytics MCP bridge detail |
| [../SHOPIFY_MCP_ARCHITECTURE.md](../SHOPIFY_MCP_ARCHITECTURE.md) | Shopify MCP bridge detail |
| [CANVA_TO_INSTAGRAM_WORKFLOW.md](./CANVA_TO_INSTAGRAM_WORKFLOW.md) | Canva design → Instagram photo |
| [RUNWAY_TO_INSTAGRAM_WORKFLOW.md](./RUNWAY_TO_INSTAGRAM_WORKFLOW.md) | Runway AI video → Instagram Reel |
| [google-ads-api-design-document.md](./google-ads-api-design-document.md) | Google Ads design (deferred for V1) |

---

## Creative & content

| Doc | Purpose |
|-----|---------|
| [AD_CAMPAIGN_LIBRARY.md](./AD_CAMPAIGN_LIBRARY.md) | Ad campaigns library (Meta drafts + images) |
| [CANVA_TO_INSTAGRAM_WORKFLOW.md](./CANVA_TO_INSTAGRAM_WORKFLOW.md) | Still creatives via Canva |
| [RUNWAY_TO_INSTAGRAM_WORKFLOW.md](./RUNWAY_TO_INSTAGRAM_WORKFLOW.md) | Video creatives via Runway |
| [META_FACEBOOK_INSTAGRAM_CAPABILITIES.md](./META_FACEBOOK_INSTAGRAM_CAPABILITIES.md) | What posts/ads exist on each platform |

**In-app surfaces (no separate docs yet):** Visual library (`/visuals`), Content recipes (`/recipes`), Ad campaigns (`/ads`), Settings → Autopilot pace.

---

## Planning & research specs

| Doc | Purpose |
|-----|---------|
| [checkup-spec.md](./checkup-spec.md) | Marketing check-up report shape |
| [market-intel-spec.md](./market-intel-spec.md) | Market intel / competitor research prompts |

---

## Engineering

| Doc | Purpose |
|-----|---------|
| [../README.md](../README.md) | Run locally, Docker Compose, env overview |
| [../BUILD_PLAN.md](../BUILD_PLAN.md) | Engineering phases, checklists, file map |
| [../ROLLBACK.md](../ROLLBACK.md) | Rollback notes |
| [../.env.example](../.env.example) | All env vars (flags, OAuth, MCP URLs, keys) |
| [../MCP_ARCHITECTURE.md](../MCP_ARCHITECTURE.md) | MCP server layout |
| `supabase/migrations/` | Schema migrations (apply via migrate or SQL Editor) |

---

## By question

| Question | Read |
|----------|------|
| Can we post / advertise on Instagram or Facebook? | [META_FACEBOOK_INSTAGRAM_CAPABILITIES.md](./META_FACEBOOK_INSTAGRAM_CAPABILITIES.md) |
| Are we ready to go live? | [ORIGIN_AND_STATUS.md](./ORIGIN_AND_STATUS.md) · [V1_READINESS_TRACKING.md](./V1_READINESS_TRACKING.md) |
| How does Autopilot decide and gate paid spend? | [AUTOPILOT_V1_OPERATING_SPEC.md](./AUTOPILOT_V1_OPERATING_SPEC.md) |
| How do I connect Meta / Shopify / GA? | [../INTEGRATIONS_SETUP.md](../INTEGRATIONS_SETUP.md) |
| How do Meta creatives get generated? | [AD_CAMPAIGN_LIBRARY.md](./AD_CAMPAIGN_LIBRARY.md) |
| How do I run the app? | [../README.md](../README.md) |
| What’s the product vision? | [../PROJECT_PLAN.md](../PROJECT_PLAN.md) |

---

## Keeping this index current

When you add a new doc under `docs/` or a top-level `*.md` that operators need, add one row here and (if it’s go-live critical) a link from [README.md](../README.md).
