# Facebook & Instagram — ads and posts in Hundres

**Last updated:** 2026-07-19  
**Audience:** Operators connecting Meta for Keylo / go-live  
**Related:** [DOCUMENTATION.md](./DOCUMENTATION.md) · [ORIGIN_AND_STATUS.md](./ORIGIN_AND_STATUS.md) · [AD_CAMPAIGN_LIBRARY.md](./AD_CAMPAIGN_LIBRARY.md) · [CANVA_TO_INSTAGRAM_WORKFLOW.md](./CANVA_TO_INSTAGRAM_WORKFLOW.md) · [RUNWAY_TO_INSTAGRAM_WORKFLOW.md](./RUNWAY_TO_INSTAGRAM_WORKFLOW.md)

This is the source of truth for **what Hundres can and cannot do** on Facebook vs Instagram — organic posts vs paid ads.

---

## Quick matrix

| Capability | Instagram | Facebook |
|------------|-----------|----------|
| **Organic feed post** | ✅ Yes | ❌ No |
| **Organic Story** | ✅ Yes | ❌ No |
| **Organic Reel / video** | ✅ Yes (Runway) | ❌ No |
| **Organic carousel** | ✅ Yes (MCP) | ❌ No |
| **Boost an existing post** | ❌ No | ❌ No |
| **Paid ads (new campaign)** | ✅ Via Meta Ads placements | ✅ Via Meta Ads placements |
| **Agent creates campaign** | ✅ Paused in Ads Manager | ✅ Same campaign (FB+IG) |
| **Agent turns spend on** | ❌ You enable spend | ❌ You enable spend |
| **Pause/resume existing ads via API** | ❌ Out of V1 | ❌ Out of V1 |

**Rule of thumb:**  
- **Posting** = Instagram only (organic).  
- **Advertising** = Meta Ads, which can show on **both** Instagram and Facebook.  
- **Boost** (the in-app “Boost post” button) is **not** supported.

---

## What you need connected

| Integration | Used for |
|-------------|----------|
| **Meta Ads** | Paid campaigns (FB + IG placements). Needs ad account + Facebook Page. |
| **Instagram** (Business Login) | Organic Instagram publish (feed / story / Reel). |
| **Facebook Page** | Required for Meta ads creatives; links Instagram Business for ads + publishing. |
| **Visual library / Canva / Runway** | Creatives for IG posts and Meta ad images / Reels. |

---

## Organic posts

### Instagram — supported

When **Instagram** is connected and `INSTAGRAM_AUTO_PUBLISH=true`:

| Format | What Hundres does | Notes |
|--------|-------------------|--------|
| **Feed photo** | Caption + image → publish | Image from Visual library, Canva, Unsplash, or Shopify |
| **Story** | Image (or video URL) → Stories | Disappears after 24h |
| **Reel** | Runway AI video → publish Reel | Needs `RUNWAY_API_KEY`; credit-aware |
| **Carousel** | Multi-image publish via MCP | Available on Instagram MCP tools |

Without auto-publish, Hundres still prepares captions / image previews as assist deliverables.

### Facebook — not supported (organic)

Hundres does **not** publish organic posts to a Facebook Page (no Page feed / Page Story / Page Reel automation).

Your Facebook Page is still important: it backs **Meta Ads** and links your Instagram Business account.

---

## Paid ads (Meta Ads)

Hundres does **not** run a separate “Instagram Ads” or “Facebook Ads” product. It creates **one Meta campaign** with placements on **both** platforms:

```text
publisher_platforms: ['facebook', 'instagram']
```

### What the agent does

1. Drafts campaign (budget, audience, copy, CTAs)  
2. Generates creatives (Visual library → Canva → Runway)  
3. Uploads images to Meta when available  
4. Creates campaign + ad set + ads as **PAUSED**  
5. Saves draft to **Ad campaigns library**  
6. **Stops** — you review and **enable spend** in Meta Ads Manager  

### What you do

- Approve the creative direction if needed  
- Open Ads Manager → turn the campaign/ad set **on** when ready to spend  

### Guardrails

| Guard | Behavior |
|-------|----------|
| **Human spend gate** | Never auto-enables spend |
| **$0 spend throttle** | Won’t stack new Meta creates while prior campaigns still show $0 spend |
| **Multiple campaigns** | Allowed once earlier campaigns have real spend/performance data |

### Not supported (paid)

| Feature | Status |
|---------|--------|
| Boost existing Instagram/Facebook post | ❌ Not built |
| Instagram-only or Facebook-only placement toggle in UI | ❌ Defaults to both |
| Edit / pause / resume live campaigns via Hundres API | ❌ Out of V1 — use Ads Manager |
| Google Ads | Deferred (`GOOGLE_ADS_ENABLED=false`) |

---

## Side-by-side: “I want to…”

| Goal | Use this |
|------|----------|
| Post a photo on Instagram today | Instagram organic (`INSTAGRAM_AUTO_PUBLISH`) |
| Post a Reel | Instagram + Runway |
| Get a post in front of more people for money | Meta Ads **new campaign** (not Boost) |
| Advertise on Instagram | Meta Ads (IG placement) |
| Advertise on Facebook | Same Meta Ads campaign (FB placement) |
| Boost a post I already published | Do it in Instagram / Ads Manager — not Hundres |
| Post on the Facebook Page feed | Not available — use Meta/Facebook manually |

---

## Integrations checklist

1. **Meta Ads** → connect → select **ad account** → select **Facebook Page**  
2. **Instagram** → Business Login for the brand account (e.g. Keylo)  
3. Confirm Instagram Business is linked to that Facebook Page in Meta Business Suite  
4. Optional: Visual library images, Canva, Runway  
5. Flags: `INSTAGRAM_AUTO_PUBLISH=true` only if live organic posts are OK  

---

## Related docs

- [AD_CAMPAIGN_LIBRARY.md](./AD_CAMPAIGN_LIBRARY.md) — Meta creative library + enrichment  
- [CANVA_TO_INSTAGRAM_WORKFLOW.md](./CANVA_TO_INSTAGRAM_WORKFLOW.md) — design → IG photo  
- [RUNWAY_TO_INSTAGRAM_WORKFLOW.md](./RUNWAY_TO_INSTAGRAM_WORKFLOW.md) — AI video → Reel  
- [AUTOPILOT_V1_OPERATING_SPEC.md](./AUTOPILOT_V1_OPERATING_SPEC.md) — spend gates and Meta throttle  
