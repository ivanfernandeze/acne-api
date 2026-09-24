# =============================================================================
# acne-api - Orquestacion clinica (NestJS)
# Multi-stage build. The runtime stage installs headless Chromium through Playwright
# because the PDF reports (RNF-06) are rendered with it.
# =============================================================================

FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile=false

FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN corepack enable
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --prod --frozen-lockfile=false

# Chromium for the PDF reports, installed by the SAME playwright version the lockfile resolved.
# A fixed `mcr.microsoft.com/playwright:vX` base image drifts: the package was bumped to 1.62 while
# the image stayed at 1.48, and every PDF then failed with "Executable doesn't exist".
RUN pnpm exec playwright install --with-deps chromium

COPY --from=build /app/dist ./dist

# Images are encrypted before they land here, so a volume snapshot leaks nothing
# without ENCRYPTION_KEY (RNF-02).
RUN mkdir -p /app/storage /app/reports-output
VOLUME ["/app/storage"]

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# RUN_MIGRATIONS=true (docker-compose default) brings the schema up to date before serving, so a
# fresh machine or an empty local database needs no manual step. Migrations are idempotent.
ENV RUN_MIGRATIONS=true
CMD ["sh", "-c", "if [ \"$RUN_MIGRATIONS\" = \"true\" ]; then node dist/database/run-migrations.js || exit 1; fi; exec node dist/main.js"]
