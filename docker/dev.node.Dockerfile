FROM node:22-slim

RUN npm install -g pnpm@10.4.0

WORKDIR /app
