FROM node:22-slim

# China apt mirror + system deps
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/* \
    && npm config set registry https://registry.npmmirror.com \
    && npm install -g pnpm@10.4.0 \
    && pnpm config set registry https://registry.npmmirror.com

WORKDIR /app
