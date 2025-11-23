#!/usr/bin/env python3
"""
Remote fix script for xg.kudafn.com

Actions:
- Detect Nginx server block for xg.kudafn.com and determine web root.
- Remove legacy static pages at /me and /me/institution that contain hardcoded assets.
- Upload fresh frontend build from local dist/ to the web root.
- Reload Nginx and validate.

Usage (env vars):
  REMOTE_HOST=192.243.127.26 REMOTE_PORT=22 REMOTE_USER=root REMOTE_PWD=... \
  python moxige/scripts/remote_fix.py

This script requires 'paramiko' installed.
"""
import os
import re
import sys
import time
from pathlib import Path

try:
    import paramiko
except Exception as e:
    print("[ERROR] paramiko not installed: ", e)
    sys.exit(2)


def getenv(key, default=None):
    v = os.environ.get(key)
    return v if v is not None else default


REMOTE_HOST = getenv("REMOTE_HOST")
REMOTE_PORT = int(getenv("REMOTE_PORT", "22"))
REMOTE_USER = getenv("REMOTE_USER", "root")
REMOTE_PWD = getenv("REMOTE_PWD")

if not (REMOTE_HOST and REMOTE_PWD):
    print("[FATAL] Missing REMOTE_HOST or REMOTE_PWD env.")
    sys.exit(2)

LOCAL_DIST = Path(__file__).resolve().parents[1] / "dist"
if not LOCAL_DIST.exists():
    print(f"[FATAL] Local dist not found: {LOCAL_DIST}")
    sys.exit(2)


def ssh_connect():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(REMOTE_HOST, port=REMOTE_PORT, username=REMOTE_USER, password=REMOTE_PWD, timeout=15)
    return client


def run(client, cmd):
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode("utf-8", "ignore")
    err = stderr.read().decode("utf-8", "ignore")
    code = stdout.channel.recv_exit_status()
    return code, out, err


def pick_web_root(client):
    # 1) Try to locate server block
    search_paths = [
        "/etc/nginx/sites-enabled",
        "/etc/nginx/conf.d",
        "/etc/nginx/nginx.conf",
    ]
    conf_hit_path = None
    for p in search_paths:
        code, out, _ = run(client, f"grep -R -n 'server_name.*xg.kudafn.com' {p} 2>/dev/null || true")
        if out.strip():
            line = out.strip().splitlines()[0]
            conf_hit_path = line.split(":", 1)[0]
            break
    candidate_roots = []
    if conf_hit_path:
        # Fetch file content to parse root within the matching server block
        code, out, _ = run(client, f"cat {conf_hit_path}")
        text = out
        # Roughly locate server block containing the hostname
        server_blocks = re.split(r"server\s*\{", text)
        for blk in server_blocks:
            if "xg.kudafn.com" in blk:
                # find root directive inside this block
                m = re.search(r"\n\s*root\s+([^;]+);", blk)
                if m:
                    root_dir = m.group(1).strip()
                    candidate_roots.append(root_dir)
        # Also try alias directives commonly used with location /assets
        if not candidate_roots:
            m2 = re.search(r"\n\s*root\s+([^;]+);", text)
            if m2:
                candidate_roots.append(m2.group(1).strip())

    # 2) Fallback common roots
    candidate_roots += [
        "/var/www/xg",
        "/var/www/xg.kudafn.com",
        "/var/www/html",
        "/usr/share/nginx/html",
        "/srv/www",
        "/data/www",
        "/data/nginx/html",
    ]

    # 3) Prefer a root that already has index.html
    for root in candidate_roots:
        code, out, _ = run(client, f"[ -f '{root}/index.html' ] && echo OK || echo NO")
        if out.strip() == "OK":
            return root

    # 4) As last resort, search for legacy asset filename to infer root
    legacy_asset = "index-TYfQc_0-.js"
    search_dirs = ["/var/www", "/usr/share/nginx", "/srv", "/data", "/home/www"]
    for d in search_dirs:
        code, out, _ = run(client, f"grep -R -n '{legacy_asset}' {d} 2>/dev/null | head -n 1")
        if out.strip():
            path = out.split(":", 1)[0]
            # ascend to directory containing index.html
            base = os.path.dirname(path)
            for i in range(4):
                code, out2, _ = run(client, f"[ -f '{base}/index.html' ] && echo OK || echo NO")
                if out2.strip() == "OK":
                    return base
                base = os.path.dirname(base)

    return None


def sftp_upload_dir(sftp, local_dir: Path, remote_dir: str):
    # Ensure remote_dir exists
    def ensure_dir(rdir):
        try:
            sftp.stat(rdir)
        except FileNotFoundError:
            # recursively create
            parts = rdir.strip("/").split("/")
            cur = "/"
            for p in parts:
                if not p:
                    continue
                cur = os.path.join(cur, p)
                try:
                    sftp.stat(cur)
                except FileNotFoundError:
                    sftp.mkdir(cur)

    ensure_dir(remote_dir)
    for root, dirs, files in os.walk(local_dir):
        rel = os.path.relpath(root, local_dir)
        target = remote_dir if rel == "." else os.path.join(remote_dir, rel)
        ensure_dir(target)
        for f in files:
            lpath = os.path.join(root, f)
            rpath = os.path.join(target, f)
            sftp.put(lpath, rpath)


def main():
    print("[INFO] Connecting to", REMOTE_HOST)
    client = ssh_connect()
    print("[INFO] Connected.")

    root = pick_web_root(client)
    if not root:
        print("[FATAL] Could not determine web root for xg.kudafn.com")
        client.close()
        sys.exit(3)
    print("[INFO] Web root:", root)

    # Backup current index and assets
    ts = time.strftime("%Y%m%d-%H%M%S")
    run(client, f"[ -f '{root}/index.html' ] && cp -a '{root}/index.html' '{root}/index.html.bak-{ts}' || true")
    run(client, f"[ -d '{root}/assets' ] && cp -a '{root}/assets' '{root}/assets.bak-{ts}' || true")

    # Remove legacy static pages
    print("[INFO] Removing legacy /me and /me/institution static pages if present...")
    run(client, f"rm -rf '{root}/me' '{root}/me/institution' || true")

    # Upload new dist
    print("[INFO] Uploading local dist to remote root...")
    sftp = client.open_sftp()
    try:
        sftp_upload_dir(sftp, LOCAL_DIST, root)
    finally:
        sftp.close()
    print("[INFO] Upload completed.")

    # Nginx test and reload
    print("[INFO] Testing Nginx config...")
    code, out, err = run(client, "nginx -t || true")
    print(out or err)
    print("[INFO] Reloading Nginx...")
    run(client, "nginx -s reload || systemctl reload nginx || true")

    # Validate index.html assets
    code, out, _ = run(client, f"head -n 40 '{root}/index.html'")
    print("[INFO] Remote index.html head:\n" + (out or ""))

    # Try HTTP validation from server side
    print("[INFO] HTTP check for /me and /me/institution...")
    code, out, err = run(client, "curl -sSI -L http://xg.kudafn.com/me | head -n 20 || true")
    print(out or err)
    code, out, err = run(client, "curl -sSI -L http://xg.kudafn.com/me/institution | head -n 20 || true")
    print(out or err)

    client.close()
    print("[DONE] Remote fix completed.")


if __name__ == "__main__":
    main()