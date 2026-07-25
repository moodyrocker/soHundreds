# Ad campaign library — Meta / Instagram creatives

## Hands-off agent loop

Autopilot / Ask (when Meta is Ready):

1. Claude drafts campaign copy + `imageBrief` per ad  
2. Agent **auto-generates** images: Visual library → Canva → Runway  
3. Saves to **Ad campaigns** library (`ready`)  
4. Auto-creates campaign in Meta as **PAUSED** (with `image_hash`)  
5. Parks a human gate: **you only enable spend** in Ads Manager  

Manual Generate / Push buttons on `/ads` are overrides — not required for the agent path.

## Surfaces

| Layer | Path |
|--------|------|
| UI | Setup → **Ad campaigns** → `/ads` |
| API | `/api/ad-campaigns` |
| Table | `ad_campaign_library` |
| Migration | `supabase/migrations/20250718120000_ad_campaign_library.sql` |

## Image pipeline

`POST /api/ad-campaigns/:id/generate-creatives`

Prefer order (`prefer: auto`):

1. **Visual library** product / brand assets  
2. **Canva** finished design export (if connected)  
3. **Runway** text-to-image (content recipe or default ad prompt)

Same stack as Instagram organic + recipe preview.

## Meta push

`POST /api/ad-campaigns/:id/push-to-meta`

- Generates images if missing  
- Uploads image → Meta `adimages` → `image_hash` on link creative  
- Creates Campaign → Ad set → Ads as **PAUSED**  
- Never auto-enables spend  

Autopilot approve path also: save draft → generate creatives → create paused → update library.

## Channels

- `meta` — paid Meta  
- `instagram` — creative blueprint only (no Meta push)  
- `both` — reusable for either  

## Status

`draft` → `ready` (has images) → `pushed` (Meta IDs stored) → `archived`
