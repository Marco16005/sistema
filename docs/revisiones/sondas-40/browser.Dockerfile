FROM mcr.microsoft.com/playwright@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27
COPY --from=codex-seguridad-dependencias:40 /app/node_modules/playwright /app/node_modules/playwright
COPY --from=codex-seguridad-dependencias:40 /app/node_modules/playwright-core /app/node_modules/playwright-core
