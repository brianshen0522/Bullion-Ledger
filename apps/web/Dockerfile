# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS dev
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @bullion-ledger/shared build
EXPOSE 5173
CMD ["pnpm", "--filter", "@bullion-ledger/web", "dev", "--host"]

FROM dev AS build
ARG GENERATE_SOURCEMAP=false
ENV GENERATE_SOURCEMAP=${GENERATE_SOURCEMAP}
RUN pnpm --filter @bullion-ledger/shared build && pnpm --filter @bullion-ledger/web build

FROM nginx:1.27-alpine AS prod
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
