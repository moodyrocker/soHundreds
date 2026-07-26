# Integrations setup guide

Step-by-step instructions for connecting **Google Analytics**, **Google Ads**, **Meta Ads**, and **Shopify** to Hundres. Written for operators and non-developers; server secrets stay in `.env` (configured once per deployment).

**Related docs:** [README.md](./README.md) (run the stack) · [TASKS_AND_TESTS.md](./TASKS_AND_TESTS.md) (verify after setup) · [PROJECT_PLAN.md](./PROJECT_PLAN.md) (product vision)

---

## Before you start

| Requirement | Notes |
|-------------|--------|
| App running | `docker compose up -d api web` — web on port **5000**, API on **3001** |
| Supabase migrations applied | Includes `mcp_connections.config` — see [README.md](./README.md) Option C if needed |
| Logged into Hundres | Sign up → create a **workspace** (organization) |
| One Google Cloud project | Same project for Analytics + Ads OAuth client |

**End users** only use **Integrations** in the app (Connect, pick account/property, Save). **You** configure `.env` and developer consoles once.

---

## Local development: HTTPS (required for Meta)

Meta usually requires **`https://`** redirect URIs. Google often allows `http://localhost`; for one consistent setup, use **ngrok** for everything.

### 1. Install and auth ngrok

```bash
brew install ngrok/ngrok/ngrok
ngrok config add-authtoken YOUR_NGROK_TOKEN   # from dashboard.ngrok.com
```

### 2. Start tunnel (keep this terminal open)

```bash
ngrok http 5000
```

Copy the **https** forwarding URL, e.g. `https://abc123.ngrok-free.app`.

### 3. Use one host everywhere

Put the **same** host in all of these (replace `abc123.ngrok-free.app` with yours):

| Place | Value |
|-------|--------|
| `.env` → `WEB_ORIGIN` | `https://abc123.ngrok-free.app` |
| `.env` → `GOOGLE_OAUTH_REDIRECT_URI` | `https://abc123.ngrok-free.app/integrations/callback` |
| `.env` → `META_OAUTH_REDIRECT_URI` | `https://abc123.ngrok-free.app/integrations/callback` |
| `.env` → `SHOPIFY_OAUTH_REDIRECT_URI` | same as Google |
| Google Cloud → OAuth client → Authorized redirect URIs | same callback URL |
| Meta → Facebook Login for Business → Valid OAuth Redirect URIs | same callback URL |
| Shopify app → Allowed redirection URL(s) | same callback URL |
| Supabase → Auth → Redirect URLs | `https://abc123.ngrok-free.app/**` |

Restart API after `.env` changes:

```bash
docker compose up -d api web
```

**Open the app only at your ngrok URL** when testing OAuth (not `http://localhost:5000`).

> **Tip:** Free ngrok URLs change when you restart ngrok. If the subdomain changes, update Meta, Google, Shopify, Supabase, and `.env` again — or use a [reserved ngrok domain](https://ngrok.com/docs/guides/how-to-set-up-a-custom-domain).

---

## Environment variables (`.env`)

Copy from [`.env.example`](./.env.example). Minimum for integrations:

```bash
# Core
DATABASE_URL=
ANTHROPIC_API_KEY=
ENCRYPTION_KEY=
SUPABASE_URL=
SUPABASE_ANON_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_API_URL=http://localhost:3001

# Google (Analytics + Ads share one OAuth client)
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=https://YOUR-HOST/integrations/callback
WEB_ORIGIN=https://YOUR-HOST

# Google Ads only
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_API_VERSION=v20

# Meta Ads
META_APP_ID=
META_APP_SECRET=
META_OAUTH_REDIRECT_URI=https://YOUR-HOST/integrations/callback

# Shopify (optional)
SHOPIFY_CLIENT_ID=
SHOPIFY_CLIENT_SECRET=
SHOPIFY_OAUTH_REDIRECT_URI=https://YOUR-HOST/integrations/callback
# SHOPIFY_SCOPES=read_orders,read_products
```

After editing `.env`: `docker compose up -d api web`

---

## 1. Google Analytics

### One-time (Google Cloud)

1. [Google Cloud Console](https://console.cloud.google.com/) → create or select a project.
2. **APIs & Services → Library** → enable:
   - **Google Analytics Admin API**
   - **Google Analytics Data API**
3. **APIs & Services → Credentials** → **Create credentials → OAuth client ID** → type **Web application**.
4. **Authorized redirect URIs** → add your callback (ngrok or production):
   ```
   https://YOUR-HOST/integrations/callback
   ```
5. Copy **Client ID** and **Client secret** → `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` in `.env`.

### In Hundres (each workspace)

1. Open app → **Integrations**.
2. **Google Analytics** → **Connect with Google**.
3. Sign in with the Google account that has access to your GA4 property.
4. After redirect, choose **GA4 property** → **Save property**.
5. Status should show **Connected** / Ready.

### Troubleshooting

| Problem | Fix |
|---------|-----|
| Connect button missing | Set Google OAuth vars in `.env`; restart API |
| No properties listed | Use a Google user with GA4 access; enable Analytics Admin API |
| Plan not using GA data | Property must be saved (Ready); create a **new** plan |

---

## 2. Google Ads

Uses the **same Google OAuth client** as Analytics, plus a **developer token** and **Google Ads API** enabled on the same GCP project.

### One-time (Google Cloud + Ads)

1. Same GCP project as above → **Enable [Google Ads API](https://console.cloud.google.com/apis/library/googleads.googleapis.com)**.
   - Direct link (replace project id if needed):  
     `https://console.developers.google.com/apis/api/googleads.googleapis.com/overview?project=YOUR_PROJECT_NUMBER`
2. [Google Ads API Center](https://ads.google.com/aw/apicenter) → apply for **Developer token** (Test or Basic access).
   - **Application status:** Basic Access **submitted 2026-06-13** — **still pending as of 2026-06-25** (developer token remains Test Account Access until Google approves). Design doc: `docs/google-ads-api-design-document.pdf`.
3. Copy token → `GOOGLE_ADS_DEVELOPER_TOKEN` in `.env`.
4. Set `GOOGLE_ADS_API_VERSION=v20` (do **not** use v18 — sunset).
5. OAuth client must include scope **`https://www.googleapis.com/auth/adwords`** (Hundres requests this on Connect).

### In Hundres (each workspace)

1. **Integrations** → **Google Ads** → **Connect with Google** (may reuse Google session).
2. After callback, select **Ads customer account** → **Save account**.
3. Status **Ready**.

### Troubleshooting

| Problem | Fix |
|---------|-----|
| HTML 404 on customer list | Set `GOOGLE_ADS_API_VERSION=v20` (or newer); rebuild API |
| API not used in project 403 | Enable **Google Ads API** on the GCP project; wait 2–5 min |
| No customer accounts | Google user needs access in Ads; developer token approved |
| Insufficient scope | Disconnect Ads → Connect again to refresh `adwords` token |
| `DEVELOPER_TOKEN_NOT_APPROVED` in API logs | Dev token is **Test Account Access** only; customer `5908253551` is **production**. Apply for **Basic Access** in [API Center](https://ads.google.com/aw/apicenter), or point Hundres at a **test** Ads account for dev. Integrations can still show **Ready**. |

### Test whether Ads snapshots work

After Connect + customer saved, from project root:

```bash
# Replace ORG_ID with your workspace UUID (Integrations / docker logs org=...)
docker compose exec api node -e "
const { GoogleAdsSnapshotService } = require('./dist/services/googleAdsSnapshotService.js');
const org = process.env.ORG_ID || 'YOUR_ORG_ID';
new GoogleAdsSnapshotService().fetchSnapshot(org).then((r) => {
  if (r) console.log('OK\\n', r.text.slice(0, 500));
  else console.log('FAILED — see docker compose logs api for [google-ads-snapshot]');
});
"
```

**Success:** prints campaign lines with spend. **Failure:** `null` + log shows `403` / `DEVELOPER_TOKEN_NOT_APPROVED`.

### Fix `DEVELOPER_TOKEN_NOT_APPROVED`

1. Open **[Google Ads API Center](https://ads.google.com/aw/apicenter)** — must be a **manager** account (not a single customer account).
2. Check **Access level**:
   - **Test Account Access** → production customers (e.g. `5908253551`) will **always** 403 on `googleAds:search`.
   - **Explorer** / **Basic** / **Standard** → can query production (within daily limits).
3. **Apply for Basic Access:** API Center → dropdown next to access level → **Apply for Basic Access**. Use a real contact email; describe Hundres as read-only reporting for small businesses. Attach design doc: **`docs/google-ads-api-design-document.pdf`** (regenerate: `python3 docs/generate-google-ads-design-pdf.py`). Review is often ~2 business days ([Google docs](https://developers.google.com/google-ads/api/docs/access-levels)).
4. Confirm `.env`: `GOOGLE_ADS_DEVELOPER_TOKEN` matches API Center; `GOOGLE_ADS_API_VERSION=v20`; restart API: `docker compose up -d api`.
5. **Dev-only workaround:** create a [Google Ads test account](https://developers.google.com/google-ads/api/docs/best-practices/testing), connect that customer in Hundres instead of production until Basic is approved.

Hundres **does not block** plan generation when Ads fails — GA + Meta still run; only the Ads block in the Claude prompt is empty.

---

## 3. Meta Ads

**Full walkthrough:** [META_ADS_SETUP.md](./META_ADS_SETUP.md) — OAuth, permissions, Facebook Page, App Review, and verification.

Meta OAuth is configured in the **Meta Developer** app, **not** Meta Business Settings (business.facebook.com).

### One-time (Meta Developer)

1. [developers.facebook.com](https://developers.facebook.com) → **My Apps** → create **Business** app (or use existing).
2. Add product **Facebook Login for Business** (this is correct for `ads_read`).
3. **Facebook Login for Business → Settings** → **Client OAuth settings**:
   - Turn **Client OAuth login** **On**.
   - **Valid OAuth Redirect URIs** — add the **full** URL (must be `https://`):
     ```
     https://YOUR-HOST/integrations/callback
     ```
   - **Save changes** and refresh the page to confirm it persisted.
4. **App settings → Basic**:
   - **App domains:** `YOUR-HOST` only (e.g. `abc123.ngrok-free.app`, no `https://` or path).
5. Add **Marketing API** product if prompted.
6. Permission **`ads_read`** — required; production may need **App Review** (dev mode: app admins/testers).
7. Copy **App ID** / **App secret** → `META_APP_ID` / `META_APP_SECRET` in `.env`.
8. `META_OAUTH_REDIRECT_URI` must match Meta’s redirect URI **exactly**.

You do **not** need “Create and manage ads” for read-only Hundres plans.

### In Hundres (each workspace)

1. **Integrations** → **Meta Ads** → **Connect with Meta**.
2. Approve permissions in Meta.
3. Select **Meta ad account** → **Save account**.
4. Status **Ready**.

### Troubleshooting

| Problem | Fix |
|---------|-----|
| Redirect URI disappears after save | Use **Facebook Login for Business → Client OAuth settings**, not only App domains; enable Client OAuth login |
| Redirect URI mismatch | Match `.env`, Meta, and the URL you use to open the app (ngrok) |
| No ad accounts | User needs access in Business Manager; `ads_read` granted |
| HTTPS required | Use ngrok or production `https://` domain |

---

## 4. Shopify (optional)

**Architecture:** [MCP_ARCHITECTURE.md](./MCP_ARCHITECTURE.md) (tiers) · [SHOPIFY_MCP_ARCHITECTURE.md](./SHOPIFY_MCP_ARCHITECTURE.md) (Shopify detail)

### One-time (Shopify Partners)

1. [Shopify Partners](https://partners.shopify.com/) → **Apps** → **Create app**.
2. Open the app → **Configuration** (or **Versions** → active version) → set **Allowed redirection URL(s)**:
   ```
   https://YOUR-HOST/integrations/callback
   ```
3. **Admin API access scopes** on that same app version (required — scopes are fixed at install time):
   - `read_products`
   - `read_orders`
   Save / **Release** the version after adding scopes. If you add scopes later, merchants must **disconnect & reconnect** in Hundres.
4. **API access** → **Protected customer data** → request access to **Orders** (for revenue metrics once orders exist).
5. Copy **Client ID** / **Client secret** → `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET`.
6. Set **`SHOPIFY_MCP_PUBLIC_URL`** to `https://YOUR-HOST/mcp/shopify` (same host as `WEB_ORIGIN` / ngrok).

### In Hundres (each workspace)

1. **Integrations** → **Shopify**.
2. Enter store domain, e.g. `your-store.myshopify.com`.
3. **Connect store** → approve in Shopify admin.
4. No extra picker — store is **Ready** after OAuth.

### Troubleshooting

| Problem | Fix |
|---------|-----|
| Connect unavailable | Set `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET`; restart API |
| OAuth error | Redirect URL must match Shopify app settings and `.env` |
| `merchant approval for read_* scope` | App version is missing Admin API scopes. Partners → app → **Configuration** → enable `read_products` + `read_orders` → save/release → disconnect & reconnect in Hundres. |
| Connected but `HTTP_403` on orders only | Enable **Protected customer data → Orders** in Partners, then disconnect & reconnect. Catalog may still load via `read_products`. |

---

## After all connections: test a plan

1. Confirm each integration shows **Ready** on **Integrations**.
2. **New** → enter a real business goal → wait for **Thinking** → **Plan**.
3. Plan chip should show **GA-informed**, **Multi-source informed**, etc., when multiple sources are ready.
4. Optional DB check:
   ```bash
   docker compose exec api node -e "
   const {query}=require('./dist/database/connection.js');
   query(\"SELECT platform, status, config FROM mcp_connections WHERE status='connected'\")
     .then(r=>console.table(r.rows));
   "
   ```

Full checklist: [TASKS_AND_TESTS.md](./TASKS_AND_TESTS.md).

---

## Production deployment

Replace ngrok with your real domain everywhere:

```bash
WEB_ORIGIN=https://app.yourdomain.com
GOOGLE_OAUTH_REDIRECT_URI=https://app.yourdomain.com/integrations/callback
META_OAUTH_REDIRECT_URI=https://app.yourdomain.com/integrations/callback
SHOPIFY_OAUTH_REDIRECT_URI=https://app.yourdomain.com/integrations/callback
```

Update Google, Meta, Shopify, and Supabase redirect URLs to match. Keep secrets only in server `.env` or your host’s secret manager — never in the git repo.

---

## Quick reference: who configures what

| Task | Who | Where |
|------|-----|--------|
| OAuth apps, API keys, developer tokens | Operator / dev | GCP, Meta Developers, Shopify Partners, `.env` |
| Connect, pick property/account | End user | Hundres → **Integrations** |
| Generate marketing plan | End user | **New** → **Thinking** → **Plan** |

---

## Changelog

| Date | Note |
|------|------|
| 2026-06 | Initial guide: GA, Ads, Meta (Facebook Login for Business + ngrok), Shopify |
| 2026-06-13 | Google Ads API Basic Access application submitted |
| 2026-06-25 | Basic Access still pending — production Ads accounts return `DEVELOPER_TOKEN_NOT_APPROVED` until approved |
| 2026-06-25 | Added [META_ADS_SETUP.md](./META_ADS_SETUP.md) — full Meta Ads setup guide |
