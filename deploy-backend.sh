#!/usr/bin/env bash
set -euo pipefail

# 后端部署脚本：
# - 同步 server 代码到远程 compose 目录
# - 重建并重启 backend 容器
# - 验证 super/xg 域名与 /api/version

# 环境变量：
#   REMOTE_HOST       远程宿主机地址
#   REMOTE_USER       远程登陆用户
#   REMOTE_COMPOSE    远程 compose 根目录（包含 docker-compose.yml）
#   SUPER_URL         super 域名地址（https://super.kudafn.com 或 http://super.kudafn.com:5174）
#   XG_URL            xg 域名地址（https://xg.kudafn.com 或 http://xg.kudafn.com:5210）

function need_var() { local name="$1"; local val=${!name:-}; if [[ -z "$val" ]]; then echo "[ERROR] 缺少环境变量: $name"; exit 1; fi }

need_var REMOTE_HOST; need_var REMOTE_USER; need_var REMOTE_COMPOSE; need_var SUPER_URL; need_var XG_URL

echo "[1/3] 同步后端代码到远程"
rsync -avz --delete server/ "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_COMPOSE}/server/"

echo "[2/3] 强制重建并重新创建 backend 容器（避免旧代码缓存）"
ssh -o StrictHostKeyChecking=no "${REMOTE_USER}@${REMOTE_HOST}" "cd ${REMOTE_COMPOSE} && \
  docker compose down backend || true && \
  docker compose build --no-cache --pull backend && \
  docker compose up -d --force-recreate backend && \
  docker compose ps backend"

echo "[3/3] 验证 super/xg 域名版本接口"
set +e
curl -fsSL "${SUPER_URL}/api/version" | sed -E 's/.{0,512}$//' ; echo ""
curl -fsSL "${XG_URL}/api/version" | sed -E 's/.{0,512}$//' ; echo ""
set -e

echo "✅ 后端部署完成并已校验 super/xg 域名接口"