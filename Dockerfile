# Use the official Nakama image from Docker Hub to avoid registry rate limits
FROM heroiclabs/nakama:3.22.0

# Copy pre-bundled JS runtime and defaults into the modules directory
COPY ./nakama_modules /nakama/data/modules/

# Copy entrypoint script and make it executable
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Expose Nakama ports
EXPOSE 7349 7350 7351

# Run via the shell entrypoint for reliable env variable expansion
ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
