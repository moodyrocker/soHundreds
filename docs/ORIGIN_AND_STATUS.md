# Hundres — Original goal & where we are today

**Last updated:** 2026-07-18  
**Audience:** Product / go-live sign-off  
**Related:** [DOCUMENTATION.md](./DOCUMENTATION.md) (full index) · [PROJECT_PLAN.md](../PROJECT_PLAN.md) · [docs/V1_READINESS_TRACKING.md](./V1_READINESS_TRACKING.md) · [docs/AD_CAMPAIGN_LIBRARY.md](./AD_CAMPAIGN_LIBRARY.md) · [docs/AUTOPILOT_V1_OPERATING_SPEC.md](./AUTOPILOT_V1_OPERATING_SPEC.md) · [docs/META_FACEBOOK_INSTAGRAM_CAPABILITIES.md](./META_FACEBOOK_INSTAGRAM_CAPABILITIES.md)

---

## Original goal (true north)

From day one, Hundres was defined as:

> **An autonomous decision engine that runs weekly work toward a measurable goal, shows defensible reasoning for each action, and stops or adapts when the data says the goal is met.**

### What that meant in practice

A non-marketer (small business / solo operator) should be able to:

1. State an outcome in plain English (“grow revenue 25%”, “get more local customers”).
2. Connect **their** data once (analytics, ads, store, social).
3. Land on **Autopilot Home** — this week’s ranked actions with a clear **why**.
4. Let the agent **prepare or run** those actions (assist or hands-off).
5. See progress against a **real metric**.
6. **Repeat weekly until the goal is met** — weeks are cycles, not a fixed calendar.

### Explicit non-goals (still true)

| Not building | Why |
|--------------|-----|
| Another metrics dashboard | Decisions + execution matter more than charts |
| A chatbot that dumps 50 tips | One week, high-leverage actions only |
| Silent auto-spend | Paid media is gated — create paused, human enables spend |
| Enterprise / multi-client agency suite | Solo operator first |

### USP we optimized for

**Hundres turns disconnected marketing data into clear, defensible decisions — then runs them toward your goal.**

---

## Where we are today (2026-07-18)

### Verdict

**Core V1 loop is proven on Keylo (M7).**  
The product now also has a stronger **creative + paid agent stack** (Visual library, Content recipes, Ad campaigns library, Canva, Runway) so Meta and Instagram work is much more hands-off than the original Phase 4 “assist / SEO write” scope.

| Layer | Status |
|-------|--------|
| Goal → plan → Autopilot week | **Shipped** |
| Metric check → week advance / goal met | **Proven on Keylo (M7)** |
| GA + Meta + Shopify + Instagram | **Live on Keylo** |
| Agentic Meta ads + creatives (paused) | **Shipped** (spend sign-off only) |
| Agentic Instagram creatives + publish | **Shipped** (flag-gated) |
| Google Ads live writes | **Deferred** (`GOOGLE_ADS_ENABLED=false`) |
| Ready for go-live smoke | **Yes** — with pre-flight below |

---

## Original journey vs today

| Original “good” UX | Today |
|--------------------|--------|
| Business profile once | ✅ Business page (+ AI draft) |
| Integrations once (no API keys in UI) | ✅ Connect: GA, Meta, Shopify, Instagram, Canva, Runway, Unsplash, Mailchimp (API key paste); Google Ads optional/deferred |
| One goal → Autopilot Home | ✅ New goal → Autopilot / Ask / Activity |
| This week’s 3–5 actions with why | ✅ Autopilot + Control room |
| Autopilot assist or hands-off | ✅ Assist deliverables + automated writes |
| Target metric + next week until goal met | ✅ Goal loop / M7 on Keylo |
| Plans cite real data when connected | ✅ Snapshots feed Claude plans |
| Traceable reasoning / audit | ✅ Activity log, execution states, human gates |

### What expanded beyond the early plan

Early plans focused on **read snapshots + Shopify SEO gated writes**. Today the operator also:

- **Publishes Instagram** (feed / story / Reel) with library / Canva / Runway creatives  
- **Creates Meta campaigns** with AI copy **and auto-generated images**, stored in an **Ad campaigns library**, pushed **paused** to Ads Manager  
- Keeps **Visual library** and **Content recipes** as first-class Setup surfaces (same pattern as Business)

---

## Capability & sign-off map (go-live)

| Service | Agent does | Your sign-off | Go-live? |
|---------|------------|---------------|----------|
| **Google Analytics** | Reads metrics for plans + goal checks | None (read-only) | ✅ Core |
| **Meta Ads** | Drafts campaign + generates creatives + creates **paused** in Meta + saves to Ad campaigns library; **feeds prior campaign performance into the next decision** | **Enable spend** in Ads Manager | ✅ Core — multiple campaigns OK once earlier ones have spend data; blocked while prior campaigns show $0 spend |
| **Instagram (organic)** | Caption + creative + publish (if `INSTAGRAM_AUTO_PUBLISH=true`) | No spend gate; posts can go live | ✅ Core |
| **Shopify** | SEO / pages / blog (write when scopes allow) | Soft approve / live-vs-draft flag | ✅ Core |
| **Mailchimp** | Audience select + draft email sequence campaigns (MCP) | **Send** in Mailchimp — Hundres never auto-sends | ✅ Email / list-building |
| **Autopilot pace** | Normal / High / Intense cadence + channel caps; **14-day SEO cooldown** per product/page | You pick pace in Settings | ✅ Intensity control |
| **Visual library** | Preferred images for IG + Meta | You curate assets | ✅ Creative stack |
| **Content recipes** | Prompt styles for Runway / stills | You refine templates | ✅ Creative stack |
| **Ad campaigns library** | Stores agent Meta drafts + images | Optional manual override | ✅ Creative stack |
| **Canva** | Export finished designs into creatives | Connect once | ✅ Creative stack |
| **Runway** | AI stills + Reel video | API key + credits | ✅ Creative stack |
| **Unsplash** | Stock fallback | None | ✅ Fallback |
| **Ask the agent** | Same execution routes, conversational | Same gates as Autopilot | ✅ |
| **Google Ads** | Paused Search create (code exists) | Enable spend | ⏸ Deferred for V1 |

**Hard rule (unchanged from original):** Hundres **never turns on ad spend**. Meta (and Google when enabled) = agentic create + creatives, human spend enablement.

---

## Proven on Keylo (reference workspace)

From [V1_READINESS_TRACKING.md](./V1_READINESS_TRACKING.md) (2026-07-08 snapshot; still the E2E reference):

| Check | Result |
|-------|--------|
| M7 happy path (goal → week → metric → advance/met) | **8 / 8** |
| GA4 connected + purchase data | Yes |
| Meta Ads connected | Yes |
| Instagram publishes | Yes (multiple) |
| Shopify connected | Yes (occasional snapshot blips) |
| Goal met example | Engagement rate goal met on live strategy |

---

## Gap vs original ambition (honest)

| Still thin / deferred | Notes |
|-----------------------|--------|
| Google Ads as first-class paid channel | Env-disabled; Basic Access / token gating |
| Meta Pixel as V1 requirement | Useful for conversion ops; not required for platform M7 |
| Pause/resume existing Meta campaigns via API | Explicitly out of V1 |
| Competitor ad libraries / Trends / SimilarWeb | Planned, not implemented |
| Perfect hands-off on every Shopify write | Depends on scopes + `SHOPIFY_AUTO_PUBLISH_LIVE` |
| Instagram Ads (Boost / IG-only ad objects) | Meta Ads cover FB+IG placements; not a separate IG Ads product |

---

## Go-live pre-flight checklist

1. Connect **GA, Meta Ads** (ad account + Page), **Shopify**, **Instagram**  
2. Add **Visual library** product images (strongly recommended for Meta/IG creatives)  
3. Optional: **Canva** + **Runway** for richer creatives  
4. Set flags intentionally:
   - `INSTAGRAM_AUTO_PUBLISH=true` only if live posts are OK  
   - Keep `GOOGLE_ADS_ENABLED=false` unless Google Ads is ready  
5. Rebuild: `docker compose up -d --build api web`  
6. Smoke:
   - One **Meta** Autopilot/Ask action → paused campaign + images in Ads Manager + library  
   - One **Instagram** post (if auto-publish on)  
   - Confirm **goal metric** reads on Autopilot Home  

---

## One-sentence status

**Original goal:** a weekly, data-backed marketing operator that decides, acts, and stops when the goal is met — without silent ad spend.  
**Today:** that loop is real on Keylo, and Meta/Instagram creatives are agentic end-to-end; the only required human gate for paid is **turning spend on**.
