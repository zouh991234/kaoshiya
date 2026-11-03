# ── 构建阶段 ─────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# 使用国内镜像源安装编译工具（better-sqlite3 缺少预编译包时需要本地编译）
RUN sed -i 's|deb.debian.org|mirrors.tencent.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true \
  && apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/

# 国内镜像源加速；跳过 install 脚本，避免 prebuild-install 去 GitHub 拉预编译包（多数情况下不可达）
RUN npm ci --registry=https://registry.npmmirror.com --ignore-scripts \
  && npm rebuild better-sqlite3 --build-from-source \
  && npm rebuild esbuild

COPY . .
RUN npm run build && npm prune --omit=dev

# 收敛运行时产物：只保留生产依赖与构建输出（部分依赖会被 npm 嵌套安装到子包目录）
RUN mkdir -p /out/apps/server /out/apps/web /out/packages/shared \
  && cp -a /app/package.json /out/ \
  && cp -a /app/node_modules /out/node_modules \
  && cp -a /app/packages/shared/package.json /app/packages/shared/dist /out/packages/shared/ \
  && cp -a /app/apps/server/package.json /app/apps/server/dist /app/apps/server/migrations /out/apps/server/ \
  && cp -a /app/apps/web/dist /out/apps/web/ \
  && if [ -d /app/apps/server/node_modules ]; then cp -a /app/apps/server/node_modules /out/apps/server/node_modules; fi

# ── 运行阶段 ─────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3300 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data \
    DATABASE_PATH=/app/data/kaoshiya.db \
    MEDIA_DIR=/app/data/media \
    BACKUP_DIR=/app/data/backups \
    WEB_ROOT=/app/apps/web/dist

COPY --from=builder /out ./

# 非 root 运行；node 进程自身处理 SIGTERM 优雅退出，无需额外 init
RUN groupadd -g 10001 kaoshiya \
  && useradd -m -u 10001 -g kaoshiya kaoshiya \
  && mkdir -p /app/data/media /app/data/backups \
  && chown -R kaoshiya:kaoshiya /app/data

USER kaoshiya
EXPOSE 3300

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3300)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/server/dist/index.js"]
