# Use the official Nakama image matching local version
FROM registry.heroiclabs.com/heroiclabs/nakama:3.22.0

# Copy pre-bundled JS runtime and defaults into the modules directory
COPY ./nakama_modules /nakama/data/modules/

# Expose Nakama ports
EXPOSE 7349 7350 7351

# Run migrations and start Nakama using Render's automatically injected DATABASE_URL
CMD ["/bin/sh", "-ec", "/nakama/nakama migrate up --database.address $DATABASE_URL && exec /nakama/nakama --database.address $DATABASE_URL --runtime.js_entrypoint index.js --logger.level info --session.token_expiry_sec 7200"]
