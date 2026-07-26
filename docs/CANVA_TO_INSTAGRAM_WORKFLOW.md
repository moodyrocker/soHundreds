# Canva → Instagram MCP workflow (Hundres)

End-to-end creative publishing is wired into Hundres MCP orchestration.

## Architecture

```
User prompt
    ↓
Claude agent (MCP toolsets: canva + instagram)
    ↓
canva.create_instagram_design → canva.export_design → instagram.publish_photo
```

Both MCP servers are included in `buildClaudeMcpConfig` when:
- **Canva** — workspace has connected Canva OAuth
- **Instagram** — workspace has connected Instagram Business login

Autopilot execution (`publish_instagram_photo`) also supports `executionBrief.imageSource: "canva"`.

## Setup

### 1. Server env (admin)

Add to `.env`:

```bash
CANVA_CLIENT_ID=...
CANVA_CLIENT_SECRET=...
CANVA_OAUTH_REDIRECT_URI=http://localhost:5000/integrations/callback
# Production: use https ngrok/public URL — same as other OAuth integrations
```

Create a Connect integration at [canva.dev](https://www.canva.dev/) with redirect URI matching `CANVA_OAUTH_REDIRECT_URI`.

### 2. Workspace connections (user)

In **Settings → Integrations**:
1. Connect **Canva** (OAuth)
2. Connect **Instagram** (Business login)

Both should show **MCP ready**.

### 3. Enable auto-publish (optional)

```bash
INSTAGRAM_AUTO_PUBLISH=true
```

## Agent chat examples

- “Create an Instagram post in Canva about our summer sale and publish it”
- “Design a 1080x1080 Canva creative for pine oil benefits, export PNG, post to Instagram with CTA Cream of Dreams”

The agent will set `executionBrief.imageSource: "canva"` and chain MCP tools.

## MCP tools

### Canva (`/mcp/canva`)
- `list_designs` — search existing designs
- `create_instagram_design` — blank 1080×1080 design
- `export_design` — PNG/JPG/MP4 download URL (~24h expiry)

### Instagram (`/mcp/instagram`)
- `publish_photo` — feed post with exported image URL + caption
- `publish_story` — story with image URL

## Limitations

- Canva Connect API creates **blank** designs; Hundres will **not** export/post those.
- For “create in Canva and post to Instagram”, you must already have a finished design in Canva (with a thumbnail), or open the edit link the agent returns, design it, save, then ask again.
- Export URLs expire in ~24 hours — publish soon after export.
- Carousel from Canva requires multiple exports (not yet automated).
