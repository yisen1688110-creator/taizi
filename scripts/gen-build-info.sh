#!/usr/bin/env bash
set -euo pipefail

# 生成构建信息 JSON 文件：build-info.json
# 用法： scripts/gen-build-info.sh <dist_dir>

DIST_DIR="${1:-}"
if [[ -z "${DIST_DIR}" ]]; then
  echo "Usage: $0 <dist_dir>" >&2
  exit 1
fi

if [[ ! -d "${DIST_DIR}" ]]; then
  echo "[ERROR] dist dir not found: ${DIST_DIR}" >&2
  exit 2
fi

# 读取版本号与 Git 信息（无需 jq）
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

read_json_version() {
  local file="$1";
  if [[ -f "$file" ]]; then
    node -e "console.log(JSON.parse(require('fs').readFileSync('$file','utf8')).version||'0.0.0')" 2>/dev/null || echo "0.0.0"
  else
    echo "0.0.0"
  fi
}

FRONT_VER=$(read_json_version "${ROOT_DIR}/moxige/package.json")
API_VER=$(read_json_version "${ROOT_DIR}/server/package.json")

GIT_COMMIT=$(git -C "${ROOT_DIR}" rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cat > "${DIST_DIR}/build-info.json" <<JSON
{
  "frontendVersion": "${FRONT_VER}",
  "backendVersion": "${API_VER}",
  "commit": "${GIT_COMMIT}",
  "builtAt": "${BUILD_TIME}"
}
JSON

echo "[OK] build-info.json generated at ${DIST_DIR}/build-info.json"