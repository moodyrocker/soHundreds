# Check-up report — Phase 1D product spec

**Status:** 1D.1 approved — **report / snapshot** (not chat)  
**Last updated:** 2026-06-06

---

## Purpose

A **marketing check-up** is a fast, read-only assessment of the user’s connected data and business context — without generating a full 8-week plan.

| Full plan (`/new`) | Check-up (`/checkup`) |
|--------------------|------------------------|
| 8-week JSON, many actions | One scrollable snapshot |
| Goal required | Optional focus question later |
| 1–3 min generation | ~30–60 s |
| Drives execution roadmap | Drives “what’s the situation?” |

---

## V1 deliverable (this phase)

**Single report page** with:

1. **Headline + overall health** — `good` | `fair` | `weak` | `unknown`
2. **Live metrics** — key numbers pulled from GA / Meta / Ads snapshots (even if zero)
3. **Data coverage** — which sources connected, which loaded, which failed (from snapshot health)
4. **What’s working / weak / missing** — bullet lists grounded in real data when available
5. **Top 3 priorities** — before any big campaigns
6. **Confidence** — high only when first-party metrics loaded

**Actions:**

- **Run check-up** — POST generates a new report (Claude + snapshots)
- **View latest** — default on page load
- **History** — last 5 reports per workspace (progress over time)

---

## Report JSON schema (stored in `checkup_reports.report_json`)

```json
{
  "headline": "One sentence summary",
  "overallHealth": "good",
  "confidence": "high",
  "liveMetrics": [
    { "source": "google_analytics", "label": "Sessions (28d)", "value": "1,240" }
  ],
  "dataCoverage": [
    { "source": "google_analytics", "connected": true, "loaded": true, "note": null }
  ],
  "whatsWorking": ["…"],
  "whatsWeak": ["…"],
  "whatsMissing": ["…"],
  "topPriorities": [
    { "title": "…", "why": "…", "impact": "high" }
  ],
  "summary": "2–4 sentences executive summary"
}
```

---

## Evolution (later phases — not V1 blockers)

| Feature | Phase | Notes |
|---------|-------|-------|
| Compare check-up vs last month | 1D+ | Diff priorities + metrics from `checkup_reports` history |
| Trend arrows on live metrics | 2+ | Needs stored metric snapshots or time-series |
| Link check-up → “Create plan from priorities” | 1D+ | Pre-fill `/new` goal from top priority |
| Scheduled check-ups | 3+ | Cron + email |
| Chat follow-up on report | 2+ | Optional; report remains canonical |

---

## Non-goals (V1)

- No writes to Ads, Meta, or Shopify
- No 8-week plan JSON
- No Shopify requirement (skip if not connected)
- No competitor intel (Phase 2)

---

## Entry points

- Sidebar: **Check-up** (`/checkup`) — replaces disabled “Insights”
- Future: Dashboard CTA “Run a check-up”

---

## Success criteria (1D gate)

- [ ] User runs check-up on MIA with GA + Meta → report cites real metrics
- [ ] Failed Ads token shows in data coverage, not silent omission
- [ ] Second run creates new row; history lists both
- [ ] Generation completes in &lt; 90 s typical
