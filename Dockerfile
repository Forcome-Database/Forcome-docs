FROM node:22-slim AS base
LABEL org.opencontainers.image.source="https://github.com/docmost/docmost"

# China npm mirror
RUN npm config set registry https://registry.npmmirror.com \
  && npm install -g pnpm@10.4.0 \
  && pnpm config set registry https://registry.npmmirror.com

FROM base AS builder

WORKDIR /app

# ---- Dependency layer (cached unless package files change) ----
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY patches/ patches/
COPY apps/server/package.json apps/server/package.json
COPY apps/client/package.json apps/client/package.json
# editor-ext is a workspace package with no external deps;
# copy full source so pnpm workspace link resolves correctly
COPY packages/ packages/

RUN pnpm install --frozen-lockfile

# ---- Source & build layer ----
COPY apps/ apps/

# VITE_* vars must be available at build time (baked into static client bundle)
ARG VITE_WIKI_URL
ENV VITE_WIKI_URL=$VITE_WIKI_URL

# Build editor-ext first — its dist/index.d.ts is required by client & server
RUN pnpm --filter @docmost/editor-ext build && pnpm build

FROM base AS installer

# China apt mirror
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends curl bash \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy apps
COPY --from=builder /app/apps/server/dist /app/apps/server/dist
COPY --from=builder /app/apps/client/dist /app/apps/client/dist
COPY --from=builder /app/apps/server/package.json /app/apps/server/package.json

# Copy packages
COPY --from=builder /app/packages/editor-ext/dist /app/packages/editor-ext/dist
COPY --from=builder /app/packages/editor-ext/package.json /app/packages/editor-ext/package.json

# Copy root package files
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/pnpm*.yaml /app/
COPY --from=builder /app/.npmrc /app/.npmrc

# Copy patches
COPY --from=builder /app/patches /app/patches

RUN chown -R node:node /app

USER node

RUN pnpm install --frozen-lockfile --prod

RUN mkdir -p /app/data/storage

VOLUME ["/app/data/storage"]

ENV PORT=3000
EXPOSE ${PORT}

CMD ["pnpm", "start"]
