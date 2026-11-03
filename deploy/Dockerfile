# syntax=docker/dockerfile:1

# ── 构建阶段 ─────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# 原生模块（better-sqlite3 / argon2）优先用预编译包，缺少时回退本地编译
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --registry=https://registry.npmjs.org

COPY . .
RUN npm run build && npm prune --omit=dev

# ── 运行阶段 ─────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3300 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data \
    DATABASE_PATH=/app/data/kaoshiya.db \
    MEDIA_DIR=/app/data/media \
    BACKUP_DIR=/app/data/backups \
    WEB_ROOT=/app/apps/web/dist

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/server/package.json ./apps/server/package.json
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/server/migrations ./apps/server/migrations
COPY --from=builder /app/apps/web/dist ./apps/web/dist

# 非 root 运行，并保证数据目录可写
RUN groupadd -g 10001 kaoshiya \
  && useradd -m -u 10001 -g kaoshiya kaoshiya \
  && mkdir -p /app/data/media /app/data/backups \
  && chown -R kaoshiya:kaoshiya /app/data

USER kaoshiya
EXPOSE 3300

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3300)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/server/dist/index.js"]
