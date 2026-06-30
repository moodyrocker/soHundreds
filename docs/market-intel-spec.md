# Market intel — Phase 2 spec

**Status:** Phase 2 V1 shipped — web_search connector  
**Last updated:** 2026-06-09

---

## Purpose

Add **directional** competitor and market context to plans and check-ups — separate from first-party GA/Meta/Ads data. Never presented as ground truth.

| First-party snapshots | Market intel |
|----------------------|--------------|
| Your numbers | Public web signals |
| `high` confidence possible | `low` or `medium` only |
| Integrations | Business profile seed |

---

## V1 (this phase)

**Seed from Business profile:**

- Website, offer, audience, one-liner
- **Businesses to emulate** (`business_emulate` column)

**Connector:** `WebSearchMarketIntelConnector` — Claude `web_search` (max 3 queries).

**Plan output:** optional `marketIntel` block in plan JSON + **Market context** card on `/plan`.

**Check-up:** web research when profile seeded; directional notes in priorities.

---

## Confidence rules

- `marketIntel.confidence` → always `low` or `medium`
- `summary.confidence` → still driven by first-party data only
- UI shows **directional** chip on market block

---

## Future connectors (2.2+)

SpyFu, Google Trends, Meta Ad Library — implement `MarketIntelConnector` interface; no prompt changes required.
