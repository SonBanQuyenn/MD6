# syntax=docker/dockerfile:1.7
# Image backend dùng chung cho API và WORKER (khác nhau ở lệnh chạy):
#   API:    node dist/main.js     (mặc định)
#   Worker: node dist/worker.js
#   Migrate: npx prisma migrate deploy      Seed demo: node dist-seed/seed.js
# Multi-stage: công cụ build (TypeScript, Nest CLI…) KHÔNG nằm trong image chạy thật
# → image nhỏ hơn, ít lỗ hổng hơn.

ARG NODE_IMAGE=node:20.18.1-bookworm-slim

# ---------- 1. deps: cài đủ dependency (kể cả dev) để build ----------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# ---------- 2. build: biên dịch TypeScript + Prisma client ----------
FROM deps AS build
COPY . .
RUN npx prisma generate \
    && npm run build \
    && npm run build:seed \
    && npm prune --omit=dev --ignore-scripts

# ---------- 3. runtime: chỉ những gì cần để chạy ----------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl tini \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/dist-seed ./dist-seed
COPY --from=build --chown=node:node /app/prisma ./prisma

# Không chạy bằng root: lỗ hổng trong app cũng không chiếm được quyền root của container
USER node
EXPOSE 3000

# Docker tự đánh dấu container "unhealthy" nếu tiến trình treo (chỉ kiểm tra tiến trình, không DB)
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini làm PID 1: chuyển SIGTERM tới Node đúng cách → tắt gọn (đóng DB, chờ job đang chạy)
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
