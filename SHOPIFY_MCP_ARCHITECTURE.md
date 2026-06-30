# Shopify MCP — architecture (MCP-first)

> **See [MCP_ARCHITECTURE.md](./MCP_ARCHITECTURE.md)** for the full tier model (analytics core + commerce + actuation).

Hundres uses the **same Shopify MCP pattern as Claude Desktop / Claude Code**: Claude calls MCP tools against the merchant store, instead of bespoke Admin REST/GraphQL clients and copy-paste prompts.

**Related:** [INTEGRATIONS_SETUP.md](./INTEGRATIONS_SETUP.md) · [README.md](./README.md)

---

## Why change

| Before (direct API) | After (MCP-first) |
|---------------------|-------------------|
| `shopifySnapshotService` → REST Admin API | MCP tools (`get_store_summary`, `list_products`) |
| `shopifyExecutionService` → GraphQL mutations | Claude + MCP tools (`create_page`, `update_product_seo`) |
| No write scope → copy-paste `shopifyMcpPrompt` to Claude.ai | Same MCP path; scopes gate which tools succeed |
| Two mental models (Hundres vs Claude) | One model everywhere |

OAuth per workspace **stays the same** — Integrations → Connect store → tokens in `mcp_connections`.

---

## Three layers

```
┌─────────────────────────────────────────────────────────────┐
│  LAYER 1 — Shopify Partner app (once)                       │
│  OAuth scopes on app version · Client ID / Secret in .env   │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  LAYER 2 — Hundres Shopify MCP bridge (per deployment)      │
│  HTTPS URL: {WEB_ORIGIN}/mcp/shopify                        │
│  Tools wrap Admin API using workspace token from bridge JWT  │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  LAYER 3 — Claude (plans + execution)                       │
│  beta messages API · mcp_servers + mcp_toolset              │
│  authorization_token = short-lived bridge JWT for org       │
│  Approval / dry-run / audit / rollback unchanged            │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  LAYER 4 — Workspace (each customer)                        │
│  Integrations → Connect store → Ready                       │
└─────────────────────────────────────────────────────────────┘
```

---

## MCP bridge

Anthropic’s API only accepts **URL** MCP servers (`type: "url"`), not stdio. Your Claude Desktop config (e.g. `npx shopify-admin-mcp`) runs locally; Hundres runs an equivalent **HTTP bridge** that:

1. Accepts Streamable HTTP MCP at `GET|POST /mcp/shopify`
2. Validates `Authorization: Bearer <bridge-jwt>` (org-scoped, 15 min TTL)
3. Loads `shopDomain` + `access_token` from `mcp_connections`
4. Registers tools that mirror common Shopify MCP servers

### Tools (v1)

| Tool | Purpose | Needs scope |
|------|---------|-------------|
| `get_store_summary` | Orders + revenue (30 days), fallback to catalog | `read_orders` / `read_products` |
| `list_products` | Active products + prices | `read_products` |
| `get_product` | Single product SEO fields | `read_products` |
| `update_product_seo` | Product SEO title + description | `write_products` |
| `create_page` | Online Store page (draft) | `write_content` |
| `shopify_graphql` | Read-only Admin GraphQL | matching read scopes |

### Claude API wiring

```typescript
mcp_servers: [{
  type: 'url',
  url: `${SHOPIFY_MCP_PUBLIC_URL}`,  // e.g. https://your-ngrok.app/mcp/shopify
  name: 'shopify',
  authorization_token: bridgeJwt,
}],
tools: [{ type: 'mcp_toolset', mcp_server_name: 'shopify' }],
betas: ['mcp-client-2025-11-20'],
```

Snapshots call bridge tools **directly** (no Claude) for speed and cost — same data, same tool layer.

---

## Environment

```bash
# Public HTTPS URL for Anthropic MCP connector (must match how you open the app)
SHOPIFY_MCP_PUBLIC_URL=https://YOUR-HOST/mcp/shopify

# Optional — use your own Claude-side MCP instead of the built-in bridge
# SHOPIFY_EXTERNAL_MCP_URL=https://...
```

Existing Shopify OAuth vars unchanged: `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_OAUTH_REDIRECT_URI`, `SHOPIFY_SCOPES`.

---

## Cursor / Claude Desktop (local dev)

Add the same MCP you use in Claude to `.cursor/mcp.json` for local store work. That is **separate** from the Hundres bridge (stdio vs URL). Paste your Claude `mcpServers.shopify` block into `.cursor/mcp.json` so Cursor matches Claude.

Example (Dev MCP — docs/validation only):

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

For **live store** ops in Claude Code, use your Shopify AI Toolkit or admin MCP config — then mirror it here.

---

## Safety (unchanged)

- **Dry-run first** — preview shows proposed MCP tool calls / field changes
- **User approves** before any write tool runs
- **Audit log** — before/after state, org, action id
- **Rollback** — inverse mutation where supported
- Hundres never auto-publishes or auto-spends

---

## Migration status

| Component | Status |
|-----------|--------|
| MCP bridge route + tools | ✅ Implemented |
| `ShopifyMcpService` (Claude + bridge JWT) | ✅ Implemented |
| Snapshots via MCP tools | ✅ Implemented |
| Execution via MCP (pages, SEO, blog) | ✅ Wired |
| Copy-paste `shopifyMcpPrompt` UI | 🗑 Removed |
| Direct `shopifyExecutionService` | Deprecated — thin wrapper over MCP tools |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| MCP connector 502 | `SHOPIFY_MCP_PUBLIC_URL` must be **https** (ngrok); API restarted |
| Tools return 401 | Disconnect → Connect Shopify; token expired |
| Write tools fail | Add scopes in Partners → release → reconnect |
| Claude works but Hundres doesn’t | Claude may use CLI/Partner dev auth — Hundres uses **merchant OAuth** only |

---

## Changelog

| Date | Note |
|------|------|
| 2026-06-26 | MCP-first architecture; bridge + Claude connector; remove copy-paste prompts |
