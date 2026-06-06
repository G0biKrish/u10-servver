#!/bin/sh
set -e

# Resolve database URL from either env variable Render might inject
DB_URL="${DATABASE_URL:-${INTERNAL_DATABASE_URL}}"

if [ -z "$DB_URL" ]; then
  echo "[entrypoint] ERROR: No DATABASE_URL or INTERNAL_DATABASE_URL set. Exiting."
  exit 1
fi

echo "[entrypoint] Running migrations against: $DB_URL"
/nakama/nakama migrate up --database.address "$DB_URL"

echo "[entrypoint] Starting Nakama..."
exec /nakama/nakama \
  --database.address "$DB_URL" \
  --runtime.js_entrypoint index.js \
  --logger.level info \
  --session.token_expiry_sec 7200 \
  --socket.server_key ChickenThokkuBriyani
