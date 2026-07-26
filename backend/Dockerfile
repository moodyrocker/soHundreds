# Build context is the REPOSITORY ROOT, not ./backend.
#
# The migration runner applies supabase/migrations/*.sql, which lives outside
# backend/, so the image needs both trees. Compose passes `context: .` with
# `dockerfile: ./backend/Dockerfile` — build manually with:
#
#   docker build -f backend/Dockerfile -t hundres-api .
#
# Same image serves both roles; CONTAINER_ROLE selects api or worker at runtime.

FROM node:22-alpine AS builder

WORKDIR /app

COPY backend/package.json backend/package-lock.json* ./
RUN npm ci

COPY backend/tsconfig.json ./
COPY backend/src ./src

RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY backend/package.json backend/package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# Single source of truth for schema. Resolved at runtime by
# migrate.ts -> resolveMigrationsDir(), which finds /app/supabase/migrations
# from /app/dist/database.
COPY supabase/migrations ./supabase/migrations

COPY backend/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3001

ENTRYPOINT ["docker-entrypoint.sh"]
