容器化部署指南

1. 目录结构
```
/root/mxg
├── moxige/        # 前端
│   └── Dockerfile
├── server/        # 后端
│   └── Dockerfile
├── database/      # 数据库占位（当前使用SQLite，通过后端挂载卷）
│   └── Dockerfile
└── docker-compose.yml
```

2. 构建与启动
- 构建镜像并启动：
```
docker compose up -d --build
```
- 查看运行状态：
```
docker compose ps
```
- 访问：
  - 前端：http://localhost:5173/
  - 后端API：http://localhost:5174/api/

3. 环境变量
- 前端：VITE_API_BASE 通过 compose 设置为 http://backend:5210/api
- 后端：PORT、JWT_SECRET、CORS_ORIGIN 可在 compose 或 .env 中设置

4. 数据持久化
- SQLite 数据库文件位于后端容器挂载卷 mxg-data:/app/data/app.db
- 备份示例：
```
docker run --rm -v mxg-data:/data alpine:3.20 tar -czf - -C /data . > mxg-data-backup-$(date +%F).tar.gz
```

5. 健康检查与日志
- 后端健康检查：`GET /api/health`（容器探针与联调）
- 版本接口：`GET /api/version`
- 前端资产校验：`GET /api/dev/assets`（读取容器内挂载的 `moxige/dist/`，校验 `index.html` 引用的 js/css 是否存在）
- 查看日志：
```
docker compose logs -f backend
```

6. 迭代建议
- 若后续迁移到 Postgres/MySQL，可替换 database 服务为对应官方镜像，后端改用连接字符串连接。

7. 前端发布流程（含校验）
- 前端构建产物通过 compose 挂载：`./moxige/dist -> /app/moxige/dist:ro`
- 发布步骤：
  - 本地构建：`cd moxige && npm ci && npm run build`
  - 远程同步：将本地 `moxige/dist/` 同步到线上静态根 `/var/www/xg/`（或你自定义目录）
  - 校验接口：访问 `https://xg.kudafn.com/api/dev/assets` 或其他域名同源 `/api/dev/assets`，确保 `index.html` 中引用的 `assets/*.js/*.css` 在容器挂载的 `dist/assets/` 中均存在（`exists: true`）
  - 如线上仍看到旧版，请清理 CDN（Cloudflare）缓存，至少清理 `index.html` 与当前哈希资产文件

8. 一键发布脚本
- 使用 `scripts/deploy-frontend.sh <remote> [remote_project_path]`
- 示例：`scripts/deploy-frontend.sh user@server "/root/mxg"`
- 该脚本会：
  - 构建前端
  - 远程备份旧 `dist` 到 `backups/dist-日期时间`
  - 通过 `rsync` 同步到远程 `moxige/dist`
  - 调用 `https://xg.kudafn.com/api/dev/assets` 验证引用与文件存在性

9. Nginx 上线与验证（推荐统一由反向代理交付）

- 站点配置文件：
  - `server/nginx/xg.kudafn.com.conf`（代理到主机 `127.0.0.1:5210`）
  - `server/nginx/super.kudafn.com.conf`（代理到主机 `127.0.0.1:5174`）
  - `/index.html` 与 `/assets/`、`/` 统一代理到后端（保持哈希一致）
  - `/api/` 统一代理到后端
  - `index.html` 设置 `Cache-Control: no-cache, must-revalidate`，避免缓存旧页
  - 所有关键路径添加 `X-Origin` 响应头，便于定位来源

- 一键同步与重载：
  - 设置环境变量并执行：
    - `REMOTE="user@host" CF_TOKEN=你的Cloudflare令牌 ZONE_ID=你的ZoneID bash scripts/sync-nginx-xg.sh`
    - `scp server/nginx/super.kudafn.com.conf "$REMOTE:/etc/nginx/sites-available/super.kudafn.com.conf" && \
       scp server/nginx/super.kudafn.com.conf "$REMOTE:/etc/nginx/conf.d/super.kudafn.com.conf" && \
       ssh "$REMOTE" "[ -d /etc/nginx/sites-enabled ] && sudo ln -sf /etc/nginx/sites-available/super.kudafn.com.conf /etc/nginx/sites-enabled/super.kudafn.com.conf; sudo nginx -t && sudo systemctl reload nginx || sudo nginx -s reload"`

- 验证：
  - `curl -I https://xg.kudafn.com/index.html | grep -i -E '^(HTTP/|cache-control|last-modified|x-origin)'`
  - `curl -s https://xg.kudafn.com/index.html | grep -E 'index-.*(js|css)'`
  - `curl -I https://super.kudafn.com/index.html | grep -i -E '^(HTTP/|cache-control|last-modified|x-origin)'`
  - `curl -s https://super.kudafn.com/index.html | grep -E 'index-.*(js|css)'`
  - 预期引用为最新哈希（示例：`index-DSidRpcQ.js`），并看到 `X-Origin: xg-frontend-index-5210` 或 `X-Origin: super-frontend-index-5174`。