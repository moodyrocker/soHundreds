# Hundres MCP architecture

Unified Model Context Protocol layout for all integrations. **Analytical companies (GA, Google Ads, Meta) are the core** — they drive plans, workers, autopilot preflight, and the goal loop. Commerce and actuation layers sit on top.

**Related:** [INTEGRATIONS_SETUP.md](./INTEGRATIONS_SETUP.md) · [SHOPIFY_MCP_ARCHITECTURE.md](./SHOPIFY_MCP_ARCHITECTURE.md) · [README.md](./README.md)

---

## Design principles

| Principle | Meaning |
|-----------|---------|
| **Analytics core first** | GA + Ads + Meta snapshots always load before Shopify or writes |
| **MCP everywhere** | One protocol for reads and writes; deploy bridges where needed |
| **Snapshots = ground truth for plans** | Pre-fetch reliable metrics into plan generation (fast, auditable) |
| **MCP bridges = live agent access** | Claude calls the same data via tools during execution / deep analysis |
| **OAuth per workspace** | Unchanged — `mcp_connections` stores encrypted tokens |

---

## Tier model

```
┌─────────────────────────────────────────────────────────────────┐
│  TIER 1 — ANALYTICAL CORE (required for serious plans)          │
│  Google Analytics · Google Ads · Meta Ads                         │
│  → snapshots → workers → plans → goal loop                        │
│  MCP: /mcp/analytics · /mcp/google-ads · /mcp/meta-ads           │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  TIER 2 — COMMERCE (e-commerce ground truth)                      │
│  Shopify — revenue, catalog, orders                               │
│  MCP: /mcp/shopify                                                │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  TIER 3 — ACTUATION (gated writes via MCP tools)                  │
│  Shopify pages, SEO, blog — approve → MCP mutation → audit        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Deployment

All Hundres-hosted MCP bridges run **inside the API container** (no extra service required for v1):

| Route | Platform | Tier | Tools (v1) |
|-------|----------|------|------------|
| `/mcp/analytics` | Google Analytics | analytical_core | `get_analytics_summary`, `get_traffic_metrics` |
| `/mcp/google-ads` | Google Ads | analytical_core | `get_ads_performance` |
| `/mcp/meta-ads` | Meta Ads | analytical_core | `get_meta_ads_performance` |
| `/mcp/shopify` | Shopify | commerce + actuation | catalog, orders, pages, SEO — see Shopify doc |

Anthropic’s Messages API requires **HTTPS URL** MCP servers. Set public URLs in `.env`:

```bash
WEB_ORIGIN=https://YOUR-HOST
ANALYTICS_MCP_PUBLIC_URL=https://YOUR-HOST/mcp/analytics
GOOGLE_ADS_MCP_PUBLIC_URL=https://YOUR-HOST/mcp/google-ads
META_ADS_MCP_PUBLIC_URL=https://YOUR-HOST/mcp/meta-ads
SHOPIFY_MCP_PUBLIC_URL=https://YOUR-HOST/mcp/shopify
# Or one secret for all bridge JWTs:
# MCP_BRIDGE_SECRET=...
```

Optional: point GA at Google’s official hosted MCP instead of the Hundres bridge:

```bash
ANALYTICS_MCP_OFFICIAL_URL=https://analytics-mcp.googleapis.com/mcp/v1
```

Hundres still uses the **Data API for plan snapshots** (more reliable than remote MCP for batch reads). The bridge exposes the same metrics to Claude for live tool calls.

---

## Data flow

### Plan generation (analytics core)

```
Integrations OAuth
  → mcp_connections (tokens + property/customer/account IDs)
  → Snapshot services (GA, Ads, Meta, Shopify) — parallel pre-fetch
  → Worker reports cite analytical core first
  → Claude plan JSON — data_source: analytics | multi
```

### Agentic execution (MCP connector)

```
McpOrchestrationService.buildClaudeMcpConfig(orgId)
  → analytical platforms listed FIRST in mcp_servers
  → bridge JWT per platform (15 min, org-scoped)
  → Claude beta API + mcp_toolset
  → Gated approve / audit / rollback for writes
```

Code: `backend/src/services/mcpOrchestrationService.ts`, `backend/src/lib/mcpRegistry.ts`

---

## Cursor / Claude Desktop (local)

`.cursor/mcp.json` should include at minimum:

```json
{
  "mcpServers": {
    "analytics-mcp": {
      "type": "url",
      "url": "https://analytics-mcp.googleapis.com/mcp/v1"
    },
    "shopify-dev-mcp": {
      "command": "npx",
      "args": ["-y", "@shopify/dev-mcp@latest"]
    }
  }
}
```

Local stdio MCP is for **your** dev machine. Hundres production uses **HTTP bridges** with merchant OAuth.

---

## What stays direct API vs MCP

| Use case | Path | Why |
|----------|------|-----|
| Plan snapshots | Direct API (GA Data API, Ads GAQL, Meta Graph, Shopify MCP tools) | Speed, reliability, audit in preflight |
| Claude live queries | MCP bridges | Same metrics, agent-selectable |
| Shopify writes | MCP tools | Same as Claude Desktop store ops |
| Goal loop (5C) | Analytical snapshots | Core metrics vs `goalTarget` |

---

## Future: separate MCP sidecar

If bridge load grows, extract bridges to a dedicated `mcp` service in `docker-compose.yml` pointing at the same Postgres for token lookup. Registry and JWT format stay the same — only `*_MCP_PUBLIC_URL` changes.

---

## Changelog

| Date | Note |
|------|------|
| 2026-06-26 | Unified MCP architecture; analytical core bridges; registry + orchestration |
