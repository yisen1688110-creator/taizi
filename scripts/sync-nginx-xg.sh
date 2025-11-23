#!/usr/bin/env bash
set -euo pipefail

# Sync Nginx config for xg.kudafn.com & super.kudafn.com to a remote server and reload Nginx.
# Usage:
#   REMOTE="user@host" bash scripts/sync-nginx-xg.sh
# Optional envs:
#   REMOTE_CONF_DIR=/etc/nginx            # Nginx base dir on remote (default: /etc/nginx)
#   SITE_FILENAME_XG=xg.kudafn.com.conf   # Target site filename for xg
#   SITE_FILENAME_SUPER=super.kudafn.com.conf # Target site filename for super
#   CF_TOKEN=...                          # Cloudflare API Token (optional, for cache purge)
#   ZONE_ID=...                           # Cloudflare Zone ID (optional)
#   PASS=...                              # Remote user password (optional, if keyless login not set)
#   NOSUDO=true                           # If set, run remote commands without sudo
#
# This script will:
# 1) Copy server/nginx/*.conf to remote Nginx conf directories
# 2) Enable site via symlink if sites-enabled is present; also drop into conf.d for RHEL-based systems
# 3) Test and reload Nginx
# 4) Purge Cloudflare cache for index.html if CF_TOKEN and ZONE_ID provided
# 5) Verify headers and asset hashes from https://xg.kudafn.com/index.html

REMOTE="${REMOTE:-}"
if [[ -z "$REMOTE" ]]; then
  echo "[ERROR] REMOTE not provided. Set REMOTE=\"user@host\" and rerun." >&2
  exit 1
fi

REMOTE_CONF_DIR="${REMOTE_CONF_DIR:-/etc/nginx}"
SITE_FILENAME_XG="${SITE_FILENAME_XG:-xg.kudafn.com.conf}"
SITE_FILENAME_SUPER="${SITE_FILENAME_SUPER:-super.kudafn.com.conf}"
LOCAL_CONF_XG="server/nginx/xg.kudafn.com.conf"
LOCAL_CONF_SUPER="server/nginx/super.kudafn.com.conf"
LOCAL_CONF_XG_NOSSL="server/nginx/xg.kudafn.com.conf.nossl"
LOCAL_CONF_SUPER_NOSSL="server/nginx/super.kudafn.com.conf.nossl"

if [[ ! -f "$LOCAL_CONF_XG" || ! -f "$LOCAL_CONF_SUPER" ]]; then
  echo "[ERROR] Local config not found: $LOCAL_CONF_XG or $LOCAL_CONF_SUPER" >&2
  exit 1
fi

echo "[INFO] Remote: $REMOTE"
echo "[INFO] Nginx base dir: $REMOTE_CONF_DIR"
echo "[INFO] Copying $LOCAL_CONF_XG and $LOCAL_CONF_SUPER to remote..."

# Prepare helpers for password-based SSH/SCP if PASS provided
SSH_CMD=(ssh "$REMOTE")
SCP_CMD=(scp)
if [[ -n "${PASS:-}" ]]; then
  if ! command -v sshpass >/dev/null 2>&1; then
    echo "[INFO] sshpass not found; attempting to install (apt/yum)."
    if command -v apt-get >/dev/null 2>&1; then
      sudo apt-get update -y && sudo apt-get install -y sshpass || true
    elif command -v yum >/dev/null 2>&1; then
      sudo yum install -y sshpass || true
    fi
  fi
  if command -v sshpass >/dev/null 2>&1; then
    SSH_CMD=(sshpass -p "$PASS" ssh -o StrictHostKeyChecking=no "$REMOTE")
    SCP_CMD=(sshpass -p "$PASS" scp -o StrictHostKeyChecking=no)
  else
    echo "[WARN] sshpass still unavailable; proceeding with regular ssh/scp (may prompt)."
  fi
fi

# Remote sudo wrapper (disable if NOSUDO=true)
# Remote sudo wrapper (disable if NOSUDO=true)
SUDO="sudo"
if [[ -n "${NOSUDO:-}" ]]; then
  SUDO=""
fi

# Detect remote certificate existence and choose proper config (SSL or non-SSL)
DOMAIN_XG="${DOMAIN_XG:-xg.kudafn.com}"
DOMAIN_SUPER="${DOMAIN_SUPER:-super.kudafn.com}"
CERT_XG="/etc/letsencrypt/live/$DOMAIN_XG/fullchain.pem"
CERT_SUPER="/etc/letsencrypt/live/$DOMAIN_SUPER/fullchain.pem"
HAS_CERT_XG="$(${SSH_CMD[@]} "[ -f $CERT_XG ] && echo yes || echo no" 2>/dev/null || echo no)"
HAS_CERT_SUPER="$(${SSH_CMD[@]} "[ -f $CERT_SUPER ] && echo yes || echo no" 2>/dev/null || echo no)"

LOCAL_CONF_XG_COPY="$LOCAL_CONF_XG"
LOCAL_CONF_SUPER_COPY="$LOCAL_CONF_SUPER"
if [[ "$HAS_CERT_XG" != "yes" ]]; then
  echo "[WARN] $CERT_XG not found on remote. Using non-SSL config for $DOMAIN_XG."
  LOCAL_CONF_XG_COPY="$LOCAL_CONF_XG_NOSSL"
fi
if [[ "$HAS_CERT_SUPER" != "yes" ]]; then
  echo "[WARN] $CERT_SUPER not found on remote. Using non-SSL config for $DOMAIN_SUPER."
  LOCAL_CONF_SUPER_COPY="$LOCAL_CONF_SUPER_NOSSL"
fi

# Prepare remote directories
"${SSH_CMD[@]}" "$SUDO mkdir -p $REMOTE_CONF_DIR/sites-available $REMOTE_CONF_DIR/sites-enabled $REMOTE_CONF_DIR/conf.d"

# Copy to sites-available
"${SCP_CMD[@]}" "$LOCAL_CONF_XG_COPY" "$REMOTE:$REMOTE_CONF_DIR/sites-available/$SITE_FILENAME_XG"
"${SCP_CMD[@]}" "$LOCAL_CONF_SUPER_COPY" "$REMOTE:$REMOTE_CONF_DIR/sites-available/$SITE_FILENAME_SUPER"

# Optionally copy to conf.d (disabled by default). Enable with COPY_TO_CONFD=true
if [[ "${COPY_TO_CONFD:-}" == "true" ]]; then
  "${SCP_CMD[@]}" "$LOCAL_CONF_XG_COPY" "$REMOTE:$REMOTE_CONF_DIR/conf.d/$SITE_FILENAME_XG"
  "${SCP_CMD[@]}" "$LOCAL_CONF_SUPER_COPY" "$REMOTE:$REMOTE_CONF_DIR/conf.d/$SITE_FILENAME_SUPER"
fi

echo "[INFO] Enabling site (symlink to sites-enabled) if available..."
"${SSH_CMD[@]}" "if [ -d $REMOTE_CONF_DIR/sites-enabled ]; then $SUDO ln -sf $REMOTE_CONF_DIR/sites-available/$SITE_FILENAME_XG $REMOTE_CONF_DIR/sites-enabled/$SITE_FILENAME_XG; $SUDO ln -sf $REMOTE_CONF_DIR/sites-available/$SITE_FILENAME_SUPER $REMOTE_CONF_DIR/sites-enabled/$SITE_FILENAME_SUPER; fi"

echo "[INFO] Testing Nginx configuration..."
"${SSH_CMD[@]}" "$SUDO nginx -t"

echo "[INFO] Reloading Nginx..."
"${SSH_CMD[@]}" "$SUDO systemctl reload nginx || $SUDO nginx -s reload"

# Optional: purge Cloudflare cache for index.html and current hashed assets
CF_TOKEN="${CF_TOKEN:-}"
ZONE_ID="${ZONE_ID:-}"
if [[ -n "$CF_TOKEN" && -n "$ZONE_ID" ]]; then
  echo "[INFO] Fetching current asset hashes from backend inspector..."
  ASSETS_JSON="$(curl -s https://xg.kudafn.com/api/dev/assets || true)"
  JS_FILE="$(printf '%s' "$ASSETS_JSON" | sed -n 's/.*"js":{\"file\":\"\([^\"]*\)\".*/\1/p')"
  CSS_FILE="$(printf '%s' "$ASSETS_JSON" | sed -n 's/.*"css":{\"file\":\"\([^\"]*\)\".*/\1/p')"

  PURGE_LIST=("https://xg.kudafn.com/index.html")
  [[ -n "$JS_FILE" ]] && PURGE_LIST+=("https://xg.kudafn.com/assets/$JS_FILE")
  [[ -n "$CSS_FILE" ]] && PURGE_LIST+=("https://xg.kudafn.com/assets/$CSS_FILE")

  echo "[INFO] Purging Cloudflare cache for:"
  printf '  - %s\n' "${PURGE_LIST[@]}"

  CF_BODY=$(printf '{"files":['; printf '"%s",' "${PURGE_LIST[@]}" | sed 's/,$//'; printf ']}')
  curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/purge_cache" \
    -H "Authorization: Bearer ${CF_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "${CF_BODY}" | sed 's/.*/[CF] &/'
fi

echo "[INFO] Verifying headers (X-Origin, Cache-Control) for xg/super index.html..."
curl -I https://xg.kudafn.com/index.html | grep -i -E '^(HTTP/|cache-control|x-origin)' || curl -I http://xg.kudafn.com/index.html | grep -i -E '^(HTTP/|cache-control|x-origin)' || true
curl -I https://super.kudafn.com/index.html | grep -i -E '^(HTTP/|cache-control|x-origin)' || curl -I http://super.kudafn.com/index.html | grep -i -E '^(HTTP/|cache-control|x-origin)' || true

echo "[INFO] Verifying version endpoints..."
curl -s https://xg.kudafn.com/api/version | sed -E 's/.{0,512}$//' || true
curl -s https://super.kudafn.com/api/version | sed -E 's/.{0,512}$//' || true

echo "[DONE] If assets still show old hashes, ensure backend at 127.0.0.1:5210 is running and reachable by Nginx."