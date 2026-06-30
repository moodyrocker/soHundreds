# Meta (Facebook & Instagram) Ads — full setup guide

Step-by-step instructions to get **Meta Ads working in Hundres** — from zero to **Ready** in Integrations, with live data in plans and optional **auto-create paused campaigns**.

**Who does what**

| Who | What |
|-----|------|
| **You (developer / operator)** | Meta Developer app, `.env`, ngrok, App Review (for production) |
| **End user (business owner)** | Integrations → Connect with Meta → pick ad account → Save |

**Related docs:** [INTEGRATIONS_SETUP.md](./INTEGRATIONS_SETUP.md) (all integrations) · [README.md](./README.md) (run the stack)

---

## What “working” means in Hundres

There are **two levels**. Both need OAuth + an ad account saved.

| Level | What you get | Requirements |
|-------|----------------|--------------|
| **1 — Read data (plans & snapshots)** | Last 30 days spend/campaigns in plans and autopilot | `ads_read` scope + ad account **Ready** |
| **2 — Create campaigns (autopilot)** | AI drafts a campaign; user approves → created **PAUSED** in Ads Manager | Level 1 **plus** `ads_management`, `pages_show_list`, and a **Facebook Page** the user admins |

Hundres **never turns on spend automatically**. Campaigns are created paused; the user enables them in [Meta Ads Manager](https://adsmanager.facebook.com/).

Hundres does **not** adjust existing campaigns (budget changes, pausing live ads, etc.) in v1.

---

## Before you start — checklist

- [ ] Hundres running: `docker compose up -d api web` (web **5000**, API **3001**)
- [ ] Supabase migrations applied (includes `mcp_connections.config`)
- [ ] A **Meta (Facebook) account** that admins your **ad account** and a **Facebook Page**
- [ ] **HTTPS URL** for OAuth (Meta requires `https://` — use ngrok locally; see below)
- [ ] You will configure settings in **[Meta for Developers](https://developers.facebook.com)** — **not** only business.facebook.com

---

## Part 1 — Local HTTPS with ngrok (required for Meta)

Meta redirect URIs must use **`https://`**. `http://localhost` usually fails.

### 1. Install ngrok

```bash
brew install ngrok/ngrok/ngrok
ngrok config add-authtoken YOUR_NGROK_TOKEN   # from dashboard.ngrok.com
```

### 2. Start the tunnel (keep this terminal open)

```bash
ngrok http 5000
```

Copy the **https** forwarding URL, e.g. `https://abc123.ngrok-free.app`.

> **Important:** Free ngrok URLs **change** when you restart ngrok. If the subdomain changes, update Meta, Supabase, and `.env` again — or use a [reserved ngrok domain](https://ngrok.com/docs/guides/how-to-set-up-a-custom-domain).

### 3. Use the **same host everywhere**

Replace `abc123.ngrok-free.app` with your ngrok host:

| Place | Value |
|-------|--------|
| `.env` → `WEB_ORIGIN` | `https://abc123.ngrok-free.app` |
| `.env` → `META_OAUTH_REDIRECT_URI` | `https://abc123.ngrok-free.app/integrations/callback` |
| Meta app → Valid OAuth Redirect URIs | same callback URL |
| Meta app → App domains | `abc123.ngrok-free.app` (host only, no `https://`) |
| Supabase → Auth → Redirect URLs | `https://abc123.ngrok-free.app/**` |

**Open the app only at your ngrok URL** when testing OAuth — not `http://localhost:5000`.

After any `.env` change:

```bash
docker compose up -d api web
```

---

## Part 2 — Create the Meta Developer app (one-time)

All of this is at [developers.facebook.com](https://developers.facebook.com) → **My Apps**.

### Step 1 — Create or select an app

1. **My Apps** → **Create App**
2. Choose type **Business** (or use an existing Business app)
3. Name it (e.g. “Hundres” / “TheHundreds”) and link your Business portfolio if asked

### Step 2 — Add products

Add these products to the app:

1. **Facebook Login for Business** — required for OAuth
2. **Marketing API** — required for ad account data and campaign APIs

### Step 3 — Facebook Login for Business → Settings

Open **Facebook Login for Business → Settings → Client OAuth settings**:

| Setting | Value |
|---------|--------|
| **Client OAuth login** | **On** |
| **Valid OAuth Redirect URIs** | `https://YOUR-HOST/integrations/callback` (full URL, must match `.env` exactly) |
| **Deauthorize callback URL** | optional for now |
| **Data deletion callback** | optional for now |

Click **Save changes**, then **refresh the page** and confirm the redirect URI is still there (Meta sometimes drops it if saved in the wrong place).

> **Common mistake:** Putting the redirect URI only under **App settings → Basic → App domains**. You need it in **Facebook Login for Business → Client OAuth settings**.

### Step 4 — App settings → Basic

| Field | Value |
|-------|--------|
| **App domains** | `YOUR-HOST` only (e.g. `abc123.ngrok-free.app`) — no `https://`, no path |
| **Privacy Policy URL** | Required before App Review / going Live — use your site or a placeholder you control |
| **App mode** | **Development** while testing; **Live** when App Review is approved |

Copy **App ID** and **App secret** (click **Show**) — you need these for `.env`.

### Step 5 — Permissions Hundres requests

On Connect, Hundres asks Meta for these scopes:

| Permission | Purpose |
|------------|---------|
| **`ads_read`** | Read ad account spend, campaigns, metrics (plans & snapshots) |
| **`ads_management`** | Create **paused** campaigns after user approval |
| **`pages_show_list`** | List Facebook Pages so link ads can use a Page identity |

**Development mode:** App **Admins**, **Developers**, and **Testers** can grant all three without App Review.

**Live / production:** You must submit **`ads_read`**, **`ads_management`**, and **`pages_show_list`** (and often **`pages_read_engagement`**) for [App Review](#part-6--app-review-for-production-users).

---

## Part 3 — Server environment (`.env`)

In the project root `.env` (see [`.env.example`](./.env.example)):

```bash
# Meta Marketing API
META_APP_ID=your_app_id
META_APP_SECRET=your_app_secret
META_OAUTH_REDIRECT_URI=https://YOUR-HOST/integrations/callback

# Must match how you open the app (ngrok or production)
WEB_ORIGIN=https://YOUR-HOST

# Optional — default is v21.0
# META_GRAPH_API_VERSION=v21.0
```

Restart after editing:

```bash
docker compose up -d api web
```

**Verify server config** (no login needed):

```bash
curl -s http://localhost:3001/health
# In the app: Integrations → Meta section should NOT show "Unavailable"
```

If Integrations shows **Unavailable**, `META_APP_ID`, `META_APP_SECRET`, or `META_OAUTH_REDIRECT_URI` is missing or the API was not restarted.

---

## Part 4 — Connect in Hundres (each workspace)

Do this **as the business user** who owns the ad account (log in at your **ngrok or production URL**).

### Step 1 — Open Integrations

1. Sign in to Hundres
2. Select the correct **workspace** (organization)
3. Go to **Integrations** → **Meta Ads**

### Step 2 — Connect with Meta

1. Click **Connect with Meta**
2. Sign in with the Facebook account that has access to your ad account
3. On the Meta permission screen, **accept all requested permissions** — especially:
   - Access your ad accounts (`ads_read`)
   - Manage your ads (`ads_management`)
   - Show a list of Pages you manage (`pages_show_list`)

If you only see limited permissions, your Meta app may be in Development and your user is not an app Admin/Developer/Tester — add them in **App roles** on developers.facebook.com.

### Step 3 — Select ad account

After redirect back to Hundres:

1. A dropdown lists ad accounts from Meta
2. Pick the account you run ads from
3. Click **Save account**

Status should change from **Needs account** to **Connected** with snapshot data OK.

### Step 4 — Confirm “Ready”

**Ready** means:

- OAuth connected (`status = connected` in database)
- Ad account ID saved (e.g. `act_123456789`)

If connected but no accounts in the dropdown:

- User needs access in [Meta Business Manager](https://business.facebook.com/) → **Ad accounts**
- User must have granted `ads_read`

---

## Part 5 — Facebook Page (required for campaign creation)

Reading ad data does **not** need a Page. **Creating** paused campaigns does.

Hundres uses the **first Facebook Page** the connected user manages (`/me/accounts`).

### If you don’t have a Page

1. [Meta Business Suite](https://business.facebook.com/) → **Settings** → **Accounts** → **Pages**
2. Create a Page or claim one for your business
3. Assign the **same Facebook user** who connects Hundres as **Page admin**

### Link Page to ad account

In Business Manager, ensure the ad account can use that Page for ads (standard Business Manager setup).

### Reconnect after adding a Page

If you connected Meta **before** granting page access:

1. **Integrations** → **Meta Ads** → **Disconnect**
2. **Connect with Meta** again and accept **all** permissions
3. Save ad account again

---

## Part 6 — App Review (for production users)

While the app is in **Development** mode, only app roles (Admin / Developer / Tester) can complete OAuth with full permissions.

To let **any customer** connect:

1. **developers.facebook.com** → your app → **App Review** → **Permissions and Features**
2. Request:
   - `ads_read`
   - `ads_management`
   - `pages_show_list`
3. Provide:
   - Screencast of Connect flow and how data is used in plans
   - Privacy policy URL
   - Explanation: read-only reporting + user-approved creation of **paused** campaigns only; no automatic spend
4. Switch app to **Live** after approval

Review can take days to weeks. You can develop with Development mode + app Testers in the meantime.

---

## Part 7 — Verify everything works

### A — Integrations UI

| Check | Expected |
|-------|----------|
| Meta chip | **Connected** (not “Needs account”) |
| Snapshot / Data | Green / loaded (last 30 days metrics) |
| Quick link | Opens correct ad account in Ads Manager |

### B — New plan uses Meta data

1. **New** → enter a business goal
2. After **Plan**, chip should show **Multi-source informed** or **Meta-informed** when Meta is Ready
3. Plan “why” fields should reference real spend/campaign names (not generic advice)

### C — Autopilot can create campaigns (optional)

1. Plan includes a **Meta / Facebook / Instagram ads** action
2. Run autopilot for the week
3. Action should route as **Meta Ads campaign** (not “advert plan only”)
4. Review draft → **Approve** → campaign appears **PAUSED** in Ads Manager

### D — Server-side token check (developer)

Replace `YOUR_ORG_ID` with workspace UUID from Integrations or logs:

```bash
docker compose exec api node -e "
const { MCPConnectionService } = require('./dist/services/mcpConnectionService.js');
const org = 'YOUR_ORG_ID';
const mcp = new MCPConnectionService();
(async () => {
  const row = await mcp.getConnectionRow(org, 'meta_ads');
  if (!row) { console.log('NOT CONNECTED'); return; }
  const { decrypt } = require('./dist/utils/encryption.js');
  const cred = JSON.parse(decrypt(row.credentials_encrypted));
  const v = process.env.META_GRAPH_API_VERSION || 'v21.0';
  const debug = await fetch(
    'https://graph.facebook.com/' + v + '/debug_token?input_token=' +
    cred.access_token + '&access_token=' +
    process.env.META_APP_ID + '|' + process.env.META_APP_SECRET
  );
  const d = await debug.json();
  console.log('scopes:', d.data?.scopes);
  console.log('adAccountId:', row.config?.adAccountId);
  const pageId = await mcp.getMetaPromotePageId(org);
  console.log('pageId:', pageId || 'MISSING — campaign create will fail');
})();
"
```

**Healthy output example:**

```
scopes: [ 'ads_read', 'ads_management', 'pages_show_list', 'public_profile' ]
adAccountId: act_339458228238808
pageId: 123456789012345
```

**Common bad output:**

```
scopes: [ 'ads_read', 'public_profile' ]   ← reconnect Meta; ads_management not granted
pageId: MISSING                             ← add Page + pages_show_list + reconnect
```

---

## Troubleshooting

| Problem | Likely cause | Fix |
|---------|--------------|-----|
| **Connect** button missing / Unavailable | `.env` Meta vars empty or API not restarted | Set `META_APP_*`, `docker compose up -d api web` |
| **Redirect URI mismatch** | URL mismatch between Meta, `.env`, and browser | Same host in all three; use ngrok URL in browser |
| Redirect URI **disappears** after save | Saved in wrong Meta screen | **Facebook Login for Business → Client OAuth settings**; enable Client OAuth login |
| OAuth works but **no ad accounts** | User lacks Business Manager access or `ads_read` | Grant ad account access in Business Manager; reconnect |
| **Connected** but not **Ready** | Ad account not saved | Pick account → **Save account** |
| Snapshot fails / no data | Token expired or wrong account | Disconnect → Connect again |
| Plans ignore Meta | Meta not Ready on **this workspace** | Connect on the workspace you’re using for plans |
| Campaign draft works but **Approve fails** | Token missing `ads_management` | Disconnect → Connect; accept manage-ads permission; App Review if Live |
| **No Facebook Page found** | No Page or missing `pages_show_list` | Create Page, admin the connecting user, reconnect |
| Only **advert plan** (no auto-create) | Meta not Ready or action not detected as Meta campaign | Fix Ready status; action title should mention Meta/Facebook/Instagram ads |
| ngrok URL changed | Free ngrok subdomain rotated | Update Meta, Supabase, `.env`; restart stack |

---

## Quick reference — three layers

```
┌─────────────────────────────────────────────────────────────┐
│  LAYER 1 — Meta Developer app (once)                        │
│  Facebook Login for Business + Marketing API                │
│  Redirect URI + App domains + App ID / Secret               │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  LAYER 2 — Server .env (once per deployment)                │
│  META_APP_ID, META_APP_SECRET, META_OAUTH_REDIRECT_URI      │
│  WEB_ORIGIN = same https host                               │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  LAYER 3 — Hundres workspace (each customer)                │
│  Integrations → Connect with Meta → Save ad account         │
│  (+ Facebook Page admin for campaign create)                │
└─────────────────────────────────────────────────────────────┘
```

---

## Changelog

| Date | Note |
|------|------|
| 2026-06-25 | Initial Meta Ads setup guide (OAuth, scopes, Page, App Review, verification) |
