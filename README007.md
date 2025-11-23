# 代码迁移与快速上线指引（README007）

本文件梳理前端、运营后台与数据库对应的容器/运行环境、它们之间的关联关系，以及迁移部署所需依赖与步骤，帮助你在新环境快速上线。

**适用范围**
- 仓库路径：`/root/mxg`
- 主要目录：`moxige/`（前端）、`server/`（后端 API 与数据初始化）、`server/nginx/`（Nginx 站点配置）
- 编排文件：`docker-compose.yml`

---

## 服务与容器环境

**后端（API）**
- 代码位置：`server/`
- 容器镜像：`node:20-alpine`
- 启动命令：`node index.js`
- 监听端口：容器内 `5210`
- 对外端口（compose 映射）：
  - `5210:5210`（本地/远程通用），Nginx 站点默认反代到该端口。
  - `5174:5210`（备用给管理域名使用；当前 Nginx 配置同样反代到 `5210`）。
  - `5173:5210`（用于本地统一访问，兼容历史前端端口约定）。
- 数据卷：
  - `mxg-data:/app/data`（SQLite 数据文件 `app.db` 存放位置）。
  - `./moxige/dist:/app/moxige/dist:ro`（前端构建产物挂载到后端容器，便于校验与脚本使用）。
- 环境变量：
  - `PORT=5210`
  - `NODE_ENV=production`
  - `CORS_ORIGIN`（可选；当前代码启用了 `cors({ origin: '*' })`，如需收敛可在代码中改为读取该变量）
  - `DB_PATH`（可选；默认 `/app/data/app.db`）

**数据库（SQLite）**
- 形态：嵌入式 SQLite，由后端容器挂载卷 `mxg-data` 持久化。
- 位置：容器内路径 `
/app/data/app.db`（在宿主机的 Docker 卷 `mxg-data` 下）。
- 初始数据：首次启动时在 `users` 表创建演示用「超级管理员」账号：
  - 账号（手机号）：`0000000000`
  - 密码：`admin123`
  - 角色：`super`
 迁移后建议立刻修改该密码或替换种子逻辑。
- Compose 中的 `database` 服务是占位（`alpine:3.20`），用于共享卷与备份，不运行真实数据库进程。

**前端（客户站与运营后台 UI）**
- 代码位置：`moxige/`
- 开发预览：`npm run dev`（默认 `5173`）与 `npm run dev:admin`（默认 `5174`，打开 `/admin`）
- 构建：`npm run build`，产物输出到 `moxige/dist/`
- 容器镜像（可选）：`moxige/Dockerfile` 基于 `node:20-alpine`，使用 `serve -s dist -l 5173` 运行；当前 Compose 默认不启用独立前端容器，线上由 Nginx 直接提供静态资源。
- 前端到后端的 API 基址：通过环境变量 `VITE_API_BASE` 注入，推荐使用同源相对路径 `
/api`（由 Nginx 统一反代）。本地联调可设为 `http://127.0.0.1:5210/api`。

---

## 关联关系与域名拓扑

**统一反向代理（Nginx）**
- 配置文件：`server/nginx/xg.kudafn.com.conf`、`server/nginx/super.kudafn.com.conf`
- 静态根：`/var/www/xg`（发布脚本会同步 `moxige/dist/` 到该目录）
- 路径规则：
  - `
/assets/` 走静态文件，设置长期缓存。
  - `
/index.html` 强制 `no-cache`，避免页面缓存陈旧。
  - 其余路径 `
/` 走单页应用回退（`try_files ... /index.html`）。
  - `
/api/` 统一反代到后端容器 `http://127.0.0.1:5210`。
- 可选代理：`super.kudafn.com.conf` 内含 `
/yf/` 到 Yahoo Finance 的反代段，前端如使用 `/yf/*` 可直接穿透。

**多站点约定**
- 客户站（xg）：`https://xg.kudafn.com`，仅开放前台功能（登录/行情/交易等）。
- 运营后台（super）：`https://super.kudafn.com`，进入 `/admin` 路由进行员工/管理员登录与管理操作。
- 两个站点的静态资源实际来自同一构建包；是否展示后台入口由应用逻辑与端口/域名约定控制。

**服务之间的调用关系**
- 前端通过 `/api/*` 调用后端 API（同源），减少 CORS 与跨域复杂度。
- 后端仅与 SQLite 文件交互（无独立 DB 进程），所有管理、交易、持仓、余额等均存储在 `app.db` 中。

---

## 依赖清单

**平台依赖**
- `Docker` 与 `Docker Compose v2`
- `Nginx`（生产环境提供静态与反代；需安装 SSL 证书）
- `Node.js 20`（本地构建前端与后端开发）

**后端依赖**（`server/package.json`）
- `express`
- `cors`
- `body-parser`
- `better-sqlite3`（原生模块，容器镜像已适配；如在宿主机运行需确保系统具备编译/运行环境）

**前端依赖**（`moxige/package.json`）
- `react`、`react-dom`、`react-router-dom`
- `vite`、`@vitejs/plugin-react`
- `chart.js`、`chartjs-chart-financial`、`lightweight-charts` 等（图表功能）

**常用环境变量**
- 前端：`VITE_API_BASE`、`VITE_ALPHAVANTAGE_KEY`（或其它行情密钥，如 `VITE_TWELVEDATA_KEY`、`VITE_FINNHUB_TOKEN`，视你的数据源策略而定）
- 后端：`PORT`、`DB_PATH`、`CORS_ORIGIN`（如需收敛跨域）

---

## 迁移与部署步骤

**一、拉取代码并准备环境**
- 在目标主机安装 `docker`、`docker compose`、`nginx`、`nodejs`。
- 将项目目录同步到目标路径（例如 `/root/mxg`），检查 `docker-compose.yml` 与 `server/nginx/*.conf`。
- 准备 SSL 证书并替换 Nginx 配置中的证书路径。

**二、启动后端容器**
- 在项目根执行：
  - `docker compose up -d --build`
  - `docker compose ps`
  - 健康检查：`curl -s http://127.0.0.1:5210/api/health`
  - 版本信息：`curl -s http://127.0.0.1:5210/api/version`

**三、构建并发布前端静态**
- 本地构建：`cd moxige && npm ci && npm run build`
- 将 `moxige/dist/` 同步到远程 `/var/www/xg/`（或你的自定义静态根）。
- 可使用脚本：`scripts/deploy-frontend.sh`（需设置远程主机相关环境变量）。
- 前端资产校验：访问 `https://xg.kudafn.com/api/dev/assets`（或你的域名同源 `/api/dev/assets`），确保返回的 `status[].exists` 均为 `true`。

**四、配置并重载 Nginx**
- 将 `server/nginx/xg.kudafn.com.conf` 与 `server/nginx/super.kudafn.com.conf` 部署到远程：
  - `scp server/nginx/*.conf <remote>:/etc/nginx/conf.d/`
  - `nginx -t && systemctl reload nginx`（或 `nginx -s reload`）
- 验证：
  - `curl -I https://xg.kudafn.com/index.html | grep -i -E '^(HTTP/|cache-control|last-modified|x-origin)'`
  - `curl -I https://super.kudafn.com/index.html | grep -i -E '^(HTTP/|cache-control|last-modified|x-origin)'`

**五、首登与校验**
- 运营后台登录入口：`https://super.kudafn.com/admin`
- 默认超级管理员：`0000000000 / admin123`（迁移后请立刻修改密码）
- 成功后再进行用户管理、资金调整与持仓/订单校验。

---

## 数据持久化与备份

- SQLite 文件位于卷：`mxg-data:/app/data/app.db`
- 快速备份示例：
  - `docker run --rm -v mxg-data:/data alpine:3.20 tar -czf - -C /data . > mxg-data-backup-$(date +%F).tar.gz`
- 恢复方案：将备份的 `app.db` 放回卷路径（或在新主机挂载后端容器时恢复到 `/app/data/app.db`）。

---

## 常见问题与排查

- `401 Unauthorized`：
  - 确认已在后台使用员工/管理员账号通过 `
/api/auth/login_account` 登录，并写入了 `Authorization: Bearer <token>`。
  - 检查浏览器 `localStorage.token` 是否更新为最新令牌。
  - 运营后台域名访问时，确保 `VITE_API_BASE` 指向同源 `
/api`。

- 静态资源未更新：
  - 清理 CDN/浏览器缓存，至少清理 `index.html` 与当前哈希文件。
  - 使用上文的 `curl -I` 检查 `Cache-Control` 与 `X-Origin` 标头。

- `CORS` 报错：
  - 生产建议使用同源访问（前端走 Nginx，API 走 `
/api`），无需跨域配置。
  - 如需跨域，调整后端 `cors` 策略并设置 `CORS_ORIGIN`。

- 端口/域名错配：
  - 当前两份 Nginx 站点均将 `
/api/` 反代到 `127.0.0.1:5210`；Compose 也暴露了 `5174->5210` 的映射，便于未来独立分流。若实际希望 super 站点走 `5174`，请在 Nginx 中将 `proxy_pass` 改为 `http://127.0.0.1:5174`。

---

## 迁移快速清单（Checklist）

- `docker compose up -d --build` 启动后端容器
- 本地构建并同步 `moxige/dist` 到远程静态根
- 部署/重载 Nginx 站点配置与证书
- 校验 `/api/health`、`/api/version` 与两域名的 `index.html`
- 资产校验 `/api/dev/assets`
- 管理后台登录并验证用户列表/资金调整/持仓查询
- 备份卷 `mxg-data` 并记录备份位置

如需我进一步将 `README-Docker.md` 的细节整合到 CI/CD 或一键脚本，请告诉我目标主机与目录约定，我可以补充对应的自动化。