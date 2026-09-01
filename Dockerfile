# =============================================================================
# acne-api - Orquestacion clinica (NestJS)
# Multi-stage build. Playwright's base image is used for the runtime stage because
# the PDF reports (RNF-06) are rendered with headless Chromium.
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

FROM mcr.microsoft.com/playwright:v1.48.2-noble AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --prod --frozen-lockfile=false

COPY --from=build /app/dist ./dist

# Images are encrypted before they land here, so a volume snapshot leaks nothing
# without ENCRYPTION_KEY (RNF-02).
RUN mkdir -p /app/storage /app/reports-output
VOLUME ["/app/storage"]

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/main.js"]
