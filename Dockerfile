# Use the official Nakama image from Docker Hub to avoid registry rate limits
FROM heroiclabs/nakama:3.22.0

# Copy pre-bundled JS runtime and defaults into the modules directory
COPY ./nakama_modules /nakama/data/modules/

# Expose Nakama ports
EXPOSE 7349 7350 7351

# Run migrations and start Nakama using Render's DATABASE_URL or INTERNAL_DATABASE_URL
CMD DB_URL=${DATABASE_URL:-$INTERNAL_DATABASE_URL} && /nakama/nakama migrate up --database.address $DB_URL && exec /nakama/nakama --database.address $DB_URL --runtime.js_entrypoint index.js --logger.level info --session.token_expiry_sec 7200
