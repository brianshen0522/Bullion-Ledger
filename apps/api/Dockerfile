# syntax=docker/dockerfile:1.7

# --- dev stage: full toolchain with hot reload via bind mount ---
FROM node:24-bookworm-slim AS dev
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl procps \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @bullion-ledger/shared build
EXPOSE 3000
CMD ["pnpm", "--filter", "@bullion-ledger/api", "dev"]

# --- build stage: compile to dist/ ---
FROM dev AS build
RUN pnpm --filter @bullion-ledger/api prisma:generate
RUN pnpm --filter @bullion-ledger/shared build && pnpm --filter @bullion-ledger/api build

# --- prod stage: self-contained runtime ---
FROM node:24-bookworm-slim AS prod
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*
COPY --chown=node:node --from=build /workspace/node_modules ./node_modules
COPY --chown=node:node --from=build /workspace/apps/api/node_modules ./apps/api/node_modules
COPY --chown=node:node --from=build /workspace/apps/api/dist ./apps/api/dist
COPY --chown=node:node --from=build /workspace/apps/api/prisma ./apps/api/prisma
COPY --chown=node:node --from=build /workspace/apps/api/package.json ./apps/api/package.json
COPY --chown=node:node --from=build /workspace/packages/shared ./packages/shared
EXPOSE 3000
WORKDIR /app/apps/api
USER node
CMD ["sh", "-ec", "node node_modules/prisma/build/index.js migrate deploy && node node_modules/tsx/dist/cli.mjs prisma/seed.ts && exec node dist/main.js"]
