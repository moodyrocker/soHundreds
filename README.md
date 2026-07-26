# SEO Hundreds / Hundres (V1)

Goal-driven marketing operator — **weekly autopilot toward a measurable goal** (decision layer + real data, not another dashboard).

### Documentation

**→ [docs/DOCUMENTATION.md](./docs/DOCUMENTATION.md)** — full index of product, integrations, Autopilot, Meta/Instagram, and engineering docs.

| Doc | Purpose |
|-----|---------|
| **[docs/DOCUMENTATION.md](./docs/DOCUMENTATION.md)** | **All docs in one place** |
| **[docs/ORIGIN_AND_STATUS.md](./docs/ORIGIN_AND_STATUS.md)** | Original goal vs today (go-live map) |
| **[docs/META_FACEBOOK_INSTAGRAM_CAPABILITIES.md](./docs/META_FACEBOOK_INSTAGRAM_CAPABILITIES.md)** | Facebook vs Instagram posts & ads |
| **[MIGRATIONS.md](./MIGRATIONS.md)** | How the schema is applied and versioned |
| **[INTEGRATIONS_SETUP.md](./INTEGRATIONS_SETUP.md)** | Connect GA, Meta, Shopify (OAuth, `.env`) |
| **[PROJECT_PLAN.md](./PROJECT_PLAN.md)** | Vision, true north, roadmap |
| **[TASKS_AND_TESTS.md](./TASKS_AND_TESTS.md)** | Milestones and manual test playbook |
| **[MCP_ARCHITECTURE.md](./MCP_ARCHITECTURE.md)** | MCP tiers and bridges |
| **[README.md](./README.md)** | How to run the stack (this file) |

Stack: **Supabase** (Postgres + Auth), **Express API**, **Next.js** web, **Docker Compose**.

## Stack

| Layer | Tech |
|-------|------|
| Database | [Supabase](https://supabase.com) (hosted Postgres) |
| API | Node.js + Express + Anthropic MCP connector |
| Deploy (local) | Docker Compose |

## 1. Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. **Project Settings → Database** → copy the **Connection string** (URI).
   - Use **Transaction pooler** (`:6543`) for the API — recommended.
   - Use **Direct** (`:5432`) only for one-off migrations if the pooler fails.
3. Apply the schema.

   `supabase/migrations/` is the **single source of truth**. Every file is applied
   at most once, in filename order, and recorded in a `schema_migrations` table.
   There is no separate `schema.sql` — it was removed after drifting from the
   migrations (see `MIGRATIONS.md`).

   **Nothing to do by hand.** The API container runs the migration runner on boot,
   so `docker compose up` brings a brand-new Supabase project fully up to date:

   ```bash
   docker compose up --build -d
   docker compose logs api | grep '\[migrate\]'
   ```

   To run it yourself instead:

   ```bash
   cd backend && npm run db:migrate        # dev (tsx)
   cd backend && npm run db:migrate:prod   # against a build
   ```

   Or use the Supabase CLI, which reads the same directory:

   ```bash
   brew install supabase/tap/supabase
   supabase login
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```

   To check what has been applied:

   ```sql
   SELECT version, applied_at FROM schema_migrations ORDER BY version;
   ```

## 2. Environment

```bash
cp .env.example .env
```

Fill in:

| Variable | Where to get it |
|----------|-----------------|
| `DATABASE_URL` | Supabase → Database → Connection string (URI) |
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon` `public` key |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `ENCRYPTION_KEY` | `openssl rand -hex 32` |
| `GOOGLE_OAUTH_*` | Google Cloud Console (optional) |

## 3. Run with Docker

```bash
docker compose up --build -d
```

Three services come up:

| Service | Role | Notes |
|---|---|---|
| `api` | Express server + MCP bridges | Runs migrations on boot. Does **not** run the autopilot loop. |
| `worker` | Autopilot cycle loop | Same image, `CONTAINER_ROLE=worker`. Claims work atomically, so replicas are safe. |
| `web` | Next.js frontend | Proxies `/api/*` to `api`. |

- **Frontend:** http://localhost:5000  
- **API:** http://localhost:3001  
- **Health:** http://localhost:3001/health  

```bash
docker compose up -d --build   # detached
docker compose logs -f
docker compose logs -f web
docker compose logs -f api
docker compose logs -f worker
docker compose down
```

> The api/worker image builds from the **repository root** (`context: .`,
> `dockerfile: ./backend/Dockerfile`) because it needs `supabase/migrations`.
> Building from inside `backend/` will fail.

### Local frontend dev (optional, without Docker)

```bash
cd web
npm install
npm run dev    # http://localhost:5000
```

## 4. Run locally (without Docker)

```bash
cd backend
npm install
npm run db:migrate
npm run dev
```

**Use the root `.env` only.** The backend resolves it automatically from any
working directory (`src/lib/loadEnv.ts`), so there is no need for a second file
in `backend/`.

Creating `backend/.env` is supported but discouraged: it takes precedence, so a
stale value there silently shadows the root file. That previously caused a
`role "postgres" does not exist` failure when a leftover `backend/.env` pointed at
a local Postgres. If both files exist you'll now see a warning naming them:

```
[env] multiple .env files loaded, earlier wins: …/backend/.env > …/.env
```

`ENCRYPTION_KEY` is the dangerous one to duplicate — it decrypts stored OAuth
credentials, and a mismatch makes every connected integration unreadable.

> **Migrations and the connection pooler.** Supabase's transaction pooler
> (`:6543`) multiplexes statements across backend sessions, which is fine for the
> API but not for session-scoped advisory locks. Prefer the session pooler
> (`:5432`, same host) or a direct connection when migrating. The runner detects
> `:6543` and falls back to transaction-scoped locks, so either works — you'll
> just see a warning.

## 5. API usage

### Auth (Supabase)

Get your **anon key** from Supabase → **Project Settings → API**.

```bash
# Sign up (creates user + optional first organization)
curl -s -X POST http://localhost:3001/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"your-password","organizationName":"My Store"}'

# Login
curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"your-password"}'

export TOKEN="<access_token-from-response>"
export ORG_ID="<organization-id-from-response>"
```

Use `Authorization: Bearer $TOKEN` and `X-Organization-Id: $ORG_ID` on all tenant routes.

```bash
# Current user + organizations
curl -s http://localhost:3001/api/auth/me \
  -H "Authorization: Bearer $TOKEN"

# Create another organization
curl -s -X POST http://localhost:3001/api/organizations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Second Store"}'
```

### MCP & strategy

```bash
# Connect Analytics (test token)
curl -s -X POST http://localhost:3001/api/mcp/connect \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Organization-Id: $ORG_ID" \
  -H "Content-Type: application/json" \
  -d '{"platform":"google_analytics","tokens":{"access_token":"<token>"}}'

# Save business profile (website, offer, audience — injected into every plan)
curl -s -X PATCH http://localhost:3001/api/business-profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Organization-Id: $ORG_ID" \
  -H "Content-Type: application/json" \
  -d '{"website":"https://example.com","oneLiner":"Local bakery","audience":"Families nearby","offer":"Sourdough and pastries"}'

# Generate strategy (week 1 + goalTarget; rolling weeks added over time)
curl -s -X POST http://localhost:3001/api/strategy/create \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Organization-Id: $ORG_ID" \
  -H "Content-Type: application/json" \
  -d '{"goal":"Increase revenue by 30% in 90 days"}'

# Active plan for workspace
curl -s http://localhost:3001/api/strategy/active \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Organization-Id: $ORG_ID"
```

## API routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/signup` | — | Register user (optional `organizationName`) |
| POST | `/api/auth/login` | — | Login, returns token + organizations |
| GET | `/api/auth/me` | Bearer | Current user + organizations |
| GET | `/api/organizations` | Bearer | List your organizations |
| POST | `/api/organizations` | Bearer | Create organization (you become owner) |
| GET | `/api/business-profile` | Bearer + org | Workspace business context (website, offer, audience, budget) |
| PATCH | `/api/business-profile` | Bearer + org | Update business profile (used automatically on every plan) |
| GET | `/api/mcp/capabilities` | Bearer + org | Which integrations are implemented |
| GET | `/api/mcp/status` | Bearer + org | MCP connection status |
| GET | `/api/mcp/oauth/google-ads` | Bearer + org | Start Google Ads OAuth |
| GET | `/api/mcp/google-ads/customers` | Bearer + org | List Ads customer accounts |
| PUT | `/api/mcp/google-ads/customer` | Bearer + org | Save selected Ads customer |
| GET | `/api/mcp/oauth/meta-ads` | Bearer + org | Start Meta Ads OAuth |
| GET | `/api/mcp/meta-ads/accounts` | Bearer + org | List Meta ad accounts |
| PUT | `/api/mcp/meta-ads/account` | Bearer + org | Save selected Meta ad account |
| GET | `/api/mcp/oauth/shopify?shop=` | Bearer + org | Start Shopify OAuth (shop domain required) |
| POST | `/api/mcp/connect` | Bearer + org | Connect GA / store tokens |
| POST | `/api/strategy/create` | Bearer + org | Generate goal pursuit (week 1 + goalTarget) |
| POST | `/api/strategy/:id/advance-week` | Bearer + org | Plan and run next week toward goal |
| GET | `/api/strategy/active` | Bearer + org | Active plan for workspace |
| GET | `/api/strategy/:id` | Bearer + org | Plan by id |
| GET | `/api/strategy/list` | Bearer + org | Recent plans |

**Headers for tenant routes:** `Authorization: Bearer <token>`, `X-Organization-Id: <uuid>`

## Project layout

```
backend/           # Express API (Docker image)
web/               # Next.js 14 frontend (Hundres UI)
supabase/
  migrations/      # Schema for Supabase
docker-compose.yml # API + Next.js frontend
.env.example
UIHundreds/        # Original static prototype (reference)
```

### Frontend (web/)

```bash
cd web
npm install
npm run dev    # http://localhost:5000
```

Routes: `/` (Autopilot), `/new` (goal input), `/thinking`, `/plan` (Control room).

## Integrations (Google, Meta, Shopify)

Full setup (OAuth consoles, `.env`, ngrok for Meta HTTPS, in-app steps, troubleshooting): **[INTEGRATIONS_SETUP.md](./INTEGRATIONS_SETUP.md)**

---

## Notes

- **No Postgres in Docker** — the database lives on Supabase; Compose only runs the API.
- **SSL** is enabled automatically when `DATABASE_URL` contains `supabase.co`.
- **Supabase Auth** handles user login; each user belongs to one or more organizations via `organization_members`. Tenant routes require `Authorization: Bearer <jwt>` and `X-Organization-Id`.
- Apply `supabase/migrations/20250523000000_auth_multitenancy.sql` in the SQL Editor (or `supabase db push`) after the initial schema.

See [MCP_ARCHITECTURE.md](./MCP_ARCHITECTURE.md) for MCP / worker AI roadmap.
