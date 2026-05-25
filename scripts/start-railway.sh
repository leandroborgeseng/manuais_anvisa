#!/bin/sh
set -e

echo "=== ANVISA Dashboard — Railway startup (deploy v2026-05-25-catalog) ==="

if [ -n "$DATABASE_URL" ]; then
  echo "Running database migrations..."
  node /app/scripts/run-migrations.mjs || echo "Migration warning (continuing anyway)"
else
  echo "DATABASE_URL not set — skipping migrations"
fi

echo "Starting server on port ${PORT:-3000}..."
exec node /app/dist/index.js
