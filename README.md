# SEO Hundreds / Hundres (V1)

Goal-driven marketing operator — **weekly autopilot toward a measurable goal** (decision layer + real data, not another dashboard).

| Doc | Purpose |
|-----|---------|
| **[PROJECT_PLAN.md](./PROJECT_PLAN.md)** | Vision, true north, anti-drift guardrails, roadmap |
| **[INTEGRATIONS_SETUP.md](./INTEGRATIONS_SETUP.md)** | **Connect GA, Google Ads, Meta, Shopify** (OAuth, `.env`, ngrok, troubleshooting) |
| **[MCP_ARCHITECTURE.md](./MCP_ARCHITECTURE.md)** | **MCP tiers — analytics core + bridges** |
| **[SHOPIFY_MCP_ARCHITECTURE.md](./SHOPIFY_MCP_ARCHITECTURE.md)** | Shopify MCP bridge detail |
| **[BASELINE_ASSESSMENT.md](./BASELINE_ASSESSMENT.md)** | **Current status baseline** (what’s connected, what’s next) |
| **[TASKS_AND_TESTS.md](./TASKS_AND_TESTS.md)** | Task list, milestones, phase gates, manual test playbook |
| **[BUILD_PLAN.md](./BUILD_PLAN.md)** | Engineering phases, checklists, env vars, file map |
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
3. Apply the schema (pick one):

   **Option A — SQL Editor**  
   Paste contents of `supabase/migrations/20250520000000_initial_schema.sql` and run.

   **Option B — Supabase CLI**
   ```bash
   brew install supabase/tap/supabase
   supabase login
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```

   **Option C — Apply pending migrations on a running API container** (if `config` column or `data_source` errors):
   ```bash
   docker cp supabase/migrations $(docker compose ps -q api):/tmp/migrations
   docker cp backend/scripts/apply-pending-migrations.mjs $(docker compose ps -q api):/app/apply-pending-migrations.mjs
   docker compose exec api node /app/apply-pending-migrations.mjs
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

- **Frontend:** http://localhost:5000  
- **API:** http://localhost:3001  
- **Health:** http://localhost:3001/health  

```bash
docker compose up -d --build   # detached
docker compose logs -f
docker compose logs -f web
docker compose logs -f api
docker compose down
```

### Local frontend dev (optional, without Docker)

```bash
cd web
npm install
npm run dev    # http://localhost:5000
```

## 4. Run locally (without Docker)

```bash
cd backend
cp .env.example .env   # or use root .env with DATABASE_URL
npm install
npm run db:migrate
npm run dev
```

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

Routes: `/` (dashboard), `/new` (goal input), `/thinking`, `/plan`.

## Integrations (Google, Meta, Shopify)

Full setup (OAuth consoles, `.env`, ngrok for Meta HTTPS, in-app steps, troubleshooting): **[INTEGRATIONS_SETUP.md](./INTEGRATIONS_SETUP.md)**

---

## Notes

- **No Postgres in Docker** — the database lives on Supabase; Compose only runs the API.
- **SSL** is enabled automatically when `DATABASE_URL` contains `supabase.co`.
- **Supabase Auth** handles user login; each user belongs to one or more organizations via `organization_members`. Tenant routes require `Authorization: Bearer <jwt>` and `X-Organization-Id`.
- Apply `supabase/migrations/20250523000000_auth_multitenancy.sql` in the SQL Editor (or `supabase db push`) after the initial schema.

See [MCP_ARCHITECTURE.md](./MCP_ARCHITECTURE.md) for MCP / worker AI roadmap.
