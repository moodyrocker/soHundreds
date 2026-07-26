#!/bin/sh
set -e

echo "Running database migrations..."
node dist/database/migrate.js

echo "Starting API on port ${PORT:-3001}..."
exec node dist/index.js
