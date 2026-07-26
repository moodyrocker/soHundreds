#!/bin/sh
set -e

# Role selects what this container runs. Both roles use the same image.
#   api    (default) — runs migrations, then the Express server
#   worker           — runs the autopilot cycle loop only
#
# Only the api role applies migrations. If both roles migrated, a scaled-out
# deploy would run the same DDL concurrently from several containers.
ROLE="${CONTAINER_ROLE:-api}"

case "$ROLE" in
  api)
    echo "Running database migrations..."
    node dist/database/migrate.js

    echo "Starting API on port ${PORT:-3001}..."
    exec node dist/index.js
    ;;

  worker)
    # Wait for the api container to finish migrating. Compose's
    # depends_on: service_healthy already orders startup, but this keeps the
    # worker safe when run outside Compose (bare docker, ECS, systemd).
    echo "Waiting for claim columns to exist..."
    i=0
    until node -e "
      import('./dist/database/connection.js')
        .then(({ pool }) => pool.query(\"SELECT 1 FROM information_schema.columns WHERE table_name='strategies' AND column_name='cycle_claimed_at'\"))
        .then((r) => process.exit(r.rowCount > 0 ? 0 : 1))
        .catch(() => process.exit(1))
    " 2>/dev/null; do
      i=$((i + 1))
      if [ "$i" -ge 60 ]; then
        echo "Claim columns still missing after 60 attempts — has 20260726110000_atomic_work_claiming.sql been applied?" >&2
        exit 1
      fi
      echo "  not ready yet (attempt $i) — retrying in 2s"
      sleep 2
    done

    echo "Starting autopilot worker..."
    exec node dist/workers/autopilotWorkerMain.js
    ;;

  *)
    echo "Unknown CONTAINER_ROLE '$ROLE' (expected 'api' or 'worker')" >&2
    exit 1
    ;;
esac
