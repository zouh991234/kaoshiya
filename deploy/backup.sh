#!/usr/bin/env bash
# 考试鸭备份脚本：在容器内执行 SQLite 在线备份 + 媒体归档，保留最近 7 份。
# 用法：./deploy/backup.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! docker compose version >/dev/null 2>&1; then
  echo "未找到 docker compose，请先安装 Docker Compose v2" >&2
  exit 1
fi

if ! docker compose ps --status running --services | grep -q '^kaoshiya$'; then
  echo "容器 kaoshiya 未在运行，无法执行在线备份" >&2
  exit 1
fi

echo "[$(date '+%F %T')] 开始备份"
docker compose exec -T kaoshiya node apps/server/dist/backup-cli.js
echo "[$(date '+%F %T')] 备份结束，备份位于 ${SCRIPT_DIR}/data/backups/"

# crontab 示例（每天 03:20）：
# 20 3 * * * /path/to/kaoshiya/deploy/backup.sh >> /path/to/kaoshiya/data/backup.log 2>&1
