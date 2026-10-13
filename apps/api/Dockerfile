# syntax=docker/dockerfile:1
# Pulse API — reproducible production image (PULSE-BE-001 section 103-104).
# Build from repo root: docker build -f apps/api/Dockerfile -t pulse-api:<tag> .

FROM node:22-alpine AS deps
# corepack ships pnpm but may need a registry fetch; retry on flakes.
RUN for i in 1 2 3; do corepack enable && corepack prepare pnpm@11.5.0 --activate && break || sleep 15; done \
 && pnpm --version
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY apps/api/package.json apps/api/
COPY packages/*/package.json packages/*/
RUN pnpm install --frozen-lockfile --filter api...

FROM node:22-alpine AS build
RUN for i in 1 2 3; do corepack enable && corepack prepare pnpm@11.5.0 --activate && break || sleep 15; done \
 && pnpm --version
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm --filter api build

FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S pulse && adduser -S pulse -G pulse
# Mirror the workspace layout so Node resolves workspace node_modules.
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
# pnpm workspaces split modules across root + per-package node_modules (symlinked store)
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
USER pulse
WORKDIR /app/apps/api
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/health/live || exit 1
CMD ["node", "dist/main.js"]
