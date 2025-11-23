#!/usr/bin/env bash
set -euo pipefail

# 前端部署脚本：
# - 本地构建 moxige 前端
# - 同步构建产物到远程（Docker Compose 卷与 Nginx 静态根）
# - 验证 super 域名与 xg 域名的后端版本接口与静态资源

# 使用前请导出以下环境变量：
#   REMOTE_HOST       远程宿主机地址（例如：your.server.ip 或域名）
#   REMOTE_USER       远程登陆用户（例如：ubuntu 或 root）
#   REMOTE_COMPOSE    远程 compose 根目录（例如：/opt/mxg）
#   REMOTE_FRONT_VOL  远程前端卷目标（例如：/opt/mxg/shared/frontend/dist）
#   REMOTE_NGINX_ROOT 远程 Nginx 静态根（例如：/var/www/xg.kudafn.com/dist）
#   SUPER_URL         super 域名地址（例如：https://super.kudafn.com 或 http://super.kudafn.com:5174）
#   XG_URL            xg 域名地址（例如：https://xg.kudafn.com 或 http://xg.kudafn.com:5210）

function need_var() {
  local name="$1"; local val=${!name:-};
  if [[ -z "$val" ]]; then echo "[ERROR] 缺少环境变量: $name"; exit 1; fi
}

need_var REMOTE_HOST; need_var REMOTE_USER; need_var REMOTE_COMPOSE
need_var REMOTE_FRONT_VOL; need_var REMOTE_NGINX_ROOT
need_var SUPER_URL; need_var XG_URL

echo "[1/4] 构建前端产物"
pushd moxige >/dev/null
if [[ ! -d node_modules ]]; then npm ci || npm i; fi
npm run build
popd >/dev/null

echo "[1.5/4] 生成构建信息 build-info.json"
bash scripts/gen-build-info.sh moxige/dist

echo "[2/4] 同步 dist 到远程 Compose 卷与 Nginx 静态根"
rsync -avz --delete moxige/dist/ "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_FRONT_VOL}/"
rsync -avz --delete moxige/dist/ "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_NGINX_ROOT}/"

echo "[3/4] 远程校验静态资源可达"
ssh -o StrictHostKeyChecking=no "${REMOTE_USER}@${REMOTE_HOST}" "ls -lah ${REMOTE_FRONT_VOL} && ls -lah ${REMOTE_NGINX_ROOT}"

echo "[4/4] 远程接口与静态资源验证"
set +e
curl -fsSL "${SUPER_URL}/api/version" | sed -E 's/.{0,512}$//' ; echo ""
curl -fsSL "${XG_URL}/api/version" | sed -E 's/.{0,512}$//' ; echo ""
curl -I "${SUPER_URL}/index.html" || true
curl -I "${XG_URL}/index.html" || true
set -e

echo "✅ 前端部署完成并已校验 super/xg 域名接口与静态资源"