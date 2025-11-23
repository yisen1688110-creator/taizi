#!/usr/bin/env bash
set -euo pipefail

# Deploy backend code to remote and rebuild container, then verify version
# Usage:
#   scripts/deploy-backend.sh <remote> [remote_project_path]
# Example:
#   scripts/deploy-backend.sh user@server "/root/mxg"

REMOTE="${1:-}"
PROJECT_PATH_REMOTE="${2:-/root/mxg}"

if [[ -z "$REMOTE" ]]; then
  echo "Usage: $0 <remote> [remote_project_path]" >&2
  exit 1
fi

REMOTE_PASSWORD="${REMOTE_PASSWORD:-}"
use_ssh() {
  local cmd="$1"
  if [[ -n "$REMOTE_PASSWORD" ]] && command -v sshpass >/dev/null 2>&1; then
    sshpass -p "$REMOTE_PASSWORD" ssh -o StrictHostKeyChecking=no "$REMOTE" "$cmd"
  else
    ssh "$REMOTE" "$cmd"
  fi
}

LOCAL_PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "[1/3] Sync server code to remote"
if command -v rsync >/dev/null 2>&1 && { [[ -z "$REMOTE_PASSWORD" ]] || ! command -v sshpass >/dev/null 2>&1; }; then
  rsync -ah --delete "$LOCAL_PROJECT_DIR/server/" "$REMOTE:$PROJECT_PATH_REMOTE/server/"
else
  echo "[WARN] rsync not available or password auth requested, using tar+ssh"
  use_ssh "mkdir -p $PROJECT_PATH_REMOTE/server && rm -rf $PROJECT_PATH_REMOTE/server/*"
  if [[ -n "$REMOTE_PASSWORD" ]] && command -v sshpass >/dev/null 2>&1; then
    tar -C "$LOCAL_PROJECT_DIR/server" -czf - . | sshpass -p "$REMOTE_PASSWORD" ssh -o StrictHostKeyChecking=no "$REMOTE" "tar -xz -C $PROJECT_PATH_REMOTE/server"
  else
    tar -C "$LOCAL_PROJECT_DIR/server" -czf - . | ssh "$REMOTE" "tar -xz -C $PROJECT_PATH_REMOTE/server"
  fi
fi

echo "[2/3] Force rebuild & recreate backend container"
use_ssh "cd $PROJECT_PATH_REMOTE && \
  docker compose down backend || true && \
  docker compose build --no-cache --pull backend && \
  docker compose up -d --force-recreate backend && \
  docker compose ps backend"

echo "[3/3] Verify version"
curl -s "https://xg.kudafn.com/api/version" || true

echo "Done. If version未更新，检查远程 compose 映射与 nginx upstream 指向。"