#!/usr/bin/env bash
set -euo pipefail

# Deploy frontend build to remote host and verify assets
# Usage:
#   scripts/deploy-frontend.sh <remote> [remote_project_path]
# Example:
#   scripts/deploy-frontend.sh user@server "/root/mxg"

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
LOCAL_DIST="$LOCAL_PROJECT_DIR/moxige/dist"

echo "[1/4] Build frontend locally"
pushd "$LOCAL_PROJECT_DIR/moxige" >/dev/null
npm ci
npm run build
popd >/dev/null

echo "[1.5/4] Generate build-info.json"
bash "$LOCAL_PROJECT_DIR/scripts/gen-build-info.sh" "$LOCAL_DIST"

echo "[2/4] Backup remote dist"
use_ssh "mkdir -p $PROJECT_PATH_REMOTE/backups && cp -a $PROJECT_PATH_REMOTE/moxige/dist $PROJECT_PATH_REMOTE/backups/dist-\$(date +%F-%H%M%S) || true"

echo "[3/4] Sync dist to remote (compose volume target)"
if command -v rsync >/dev/null 2>&1 && { [[ -z "$REMOTE_PASSWORD" ]] || ! command -v sshpass >/dev/null 2>&1; }; then
  rsync -ah --delete "$LOCAL_DIST/" "$REMOTE:$PROJECT_PATH_REMOTE/moxige/dist/"
else
  echo "[WARN] rsync not available or password auth requested, using tar+ssh"
  use_ssh "mkdir -p $PROJECT_PATH_REMOTE/moxige/dist && rm -rf $PROJECT_PATH_REMOTE/moxige/dist/*"
  if [[ -n "$REMOTE_PASSWORD" ]] && command -v sshpass >/dev/null 2>&1; then
    tar -C "$LOCAL_DIST" -czf - . | sshpass -p "$REMOTE_PASSWORD" ssh -o StrictHostKeyChecking=no "$REMOTE" "tar -xzf - -C $PROJECT_PATH_REMOTE/moxige/dist"
  else
    tar -C "$LOCAL_DIST" -czf - . | ssh "$REMOTE" "tar -xzf - -C $PROJECT_PATH_REMOTE/moxige/dist"
  fi
fi

echo "[3b/4] Also sync dist to Nginx static root (/var/www/xg)"
# Escape $ts so it is expanded on remote, not locally under -u
use_ssh "ts=\$(date +%F-%H%M%S); if [ -d /var/www/xg ]; then mv /var/www/xg /var/www/xg.bak-\$ts; fi; mkdir -p /var/www/xg;"
if command -v rsync >/dev/null 2>&1 && { [[ -z "$REMOTE_PASSWORD" ]] || ! command -v sshpass >/dev/null 2>&1; }; then
  rsync -ah --delete "$LOCAL_DIST/" "$REMOTE:/var/www/xg/"
else
  if [[ -n "$REMOTE_PASSWORD" ]] && command -v sshpass >/dev/null 2>&1; then
    tar -C "$LOCAL_DIST" -czf - . | sshpass -p "$REMOTE_PASSWORD" ssh -o StrictHostKeyChecking=no "$REMOTE" "tar -xzf - -C /var/www/xg"
  else
    tar -C "$LOCAL_DIST" -czf - . | ssh "$REMOTE" "tar -xzf - -C /var/www/xg"
  fi
fi

echo "[4/4] Verify via backend dev assets endpoint"
curl -s "https://xg.kudafn.com/api/dev/assets" || true

echo "Done. If hashes mismatch, purge CDN cache for index.html and assets."

echo "[4b/4] Verify version (backend+frontend)"
curl -s "https://xg.kudafn.com/api/version" || true
