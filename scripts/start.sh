#!/bin/sh
set -e

echo "Step 1: Fix enum data (idempotent)..."
npx prisma db execute --file ./prisma/pre-migrate-1.sql --url "$DATABASE_URL" 2>/dev/null || true
npx prisma db execute --file ./prisma/pre-migrate-2.sql --url "$DATABASE_URL" 2>/dev/null || true

echo "Step 2: Sync schema to GCP database..."
npx prisma db push --accept-data-loss

echo "Step 3: Starting server..."
exec node dist/src/main
