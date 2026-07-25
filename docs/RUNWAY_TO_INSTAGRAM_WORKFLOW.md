# Runway → Instagram Reels MCP workflow

Generate realistic AI video with Runway, then publish as an Instagram Reel.

## Two connection layers

### 1) Cursor (local agent) — official Runway MCP OAuth

Already in `.cursor/mcp.json`:

```json
"runway": {
  "url": "https://mcp.runwayml.com/mcp"
}
```

Restart Cursor → **Tools & MCPs** → **Connect** → sign in to your Runway **app** account.
Uses [app.runwayml.com](https://app.runwayml.com) credits. Docs: [Connecting to Runway MCP](https://help.runwayml.com/hc/en-us/articles/51931843164691-Connecting-to-Runway-MCP).

### 2) Hundres product — Developer API key bridge

Hundres hosts `/mcp/runway` using the **Developer API** (separate billing from the Runway app).

```bash
RUNWAY_API_KEY=...          # from https://dev.runwayml.com/
# RUNWAY_API_VERSION=2024-11-06
# RUNWAY_MCP_PUBLIC_URL=https://YOUR-HOST/mcp/runway
```

Restart API after adding the key. Integrations → **Runway** should show **MCP ready**.

## Chain

```
runway.generate_instagram_reel (9:16 MP4 URL)
    → instagram.publish_reel (caption + videoUrl)
```

## MCP tools (Hundres bridge)

| Tool | Purpose |
|------|---------|
| `text_to_video` | Prompt → 9:16 video |
| `text_to_image` | Prompt → 9:16 still (~5 credits) |
| `image_to_video` | Animate product image |
| `get_task` | Poll status |
| `generate_instagram_reel` | One-shot video URL for Instagram |

## Agent example

> Generate a realistic 9:16 lifestyle Reel of our skincare serum on a marble counter with soft morning light, then publish to Instagram with caption …

## Notes

- Runway **app** credits ≠ **API** credits ([FAQ](https://help.runwayml.com/hc/en-us/articles/21668552945171-Runway-API-FAQs)).
- Video URLs must stay public HTTPS until Instagram finishes processing.
- Generation can take 1–3+ minutes; the bridge waits by default.
