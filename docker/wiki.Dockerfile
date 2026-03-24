FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g pnpm@10.4.0

WORKDIR /app

COPY wiki/package.json wiki/pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

COPY wiki/ .

# VITE_* vars must be available at build time (baked into static files)
ARG VITE_DOCMOST_API_URL
ARG VITE_ADMIN_URL
ARG VITE_DIFY_MODE=api
ARG VITE_DIFY_API_BASE
ARG VITE_DIFY_API_KEY
ARG VITE_DIFY_EMBED_URL

ENV VITE_DOCMOST_API_URL=$VITE_DOCMOST_API_URL \
    VITE_ADMIN_URL=$VITE_ADMIN_URL \
    VITE_DIFY_MODE=$VITE_DIFY_MODE \
    VITE_DIFY_API_BASE=$VITE_DIFY_API_BASE \
    VITE_DIFY_API_KEY=$VITE_DIFY_API_KEY \
    VITE_DIFY_EMBED_URL=$VITE_DIFY_EMBED_URL

RUN pnpm docs:build

FROM nginx:alpine

COPY --from=builder /app/docs/.vitepress/dist /usr/share/nginx/html
COPY docker/wiki-nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
