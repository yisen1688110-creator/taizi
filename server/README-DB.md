# 后端数据库与接口规则

## 概览
- 类型：SQLite（文件）
- 主库路径：`server/data/app.db`（容器内为 `/app/data/app.db`）
- 卷绑定：开发/部署统一绑定到项目目录 `server/data`
- 端口：后端监听 `PORT`（默认 `5210`），Nginx 反代同域 `/api/*`

## 环境变量
- `PORT`：后端监听端口，默认 `5210`
- `DB_PATH`：数据库文件路径（容器内默认 `/app/data/app.db`）
- `DB_BACKUP_BEFORE_MIGRATION`：迁移前自动快照开关（默认开启 `1`）
- `NODE_ENV`：运行环境字符串（用于版本输出）

## 迁移与备份策略
- 运行时迁移：启动时创建缺失表并补齐缺列（通过 `PRAGMA table_info` 检测），仅进行幂等、非破坏性变更
- 备份：每次迁移前自动复制当前库为 `app.bak.<时间戳>.db`，与主库同目录 `server/data`，便于项目整体迁移时不遗漏
- 一致性：启用 `journal_mode=WAL` 与 `synchronous=NORMAL` 降低意外损坏风险
- 参考代码：`mxg-main/server/index.js:269-288`（迁移入口与工具函数）、`mxg-main/server/index.js:277-280`（`sha256`）

## 表结构速览
- `users`
  - `id`, `email`, `password_hash`, `name`, `phone`(唯一), `role`(`customer|admin|super`), `account`(可选), `last_login_ip`, `last_login_country`, `assigned_admin_id`, `assigned_operator_id`, `avatar*`, `disallow_trading`
  - 登录与角色管控基于此表
- `tokens`
  - `token`(主键), `user_id`, `exp`, `created_at`；登录签发的 Bearer Token 存储与过期判定
- `balances`
  - `user_id`, `currency`, `amount`, `updated_at`（`user_id + currency` 唯一）；用户资产余额
- `positions`
  - `id`, `user_id`, `symbol`, `market`, `long_qty`, `short_qty`, `avg_price`, `long_avg`, `short_avg`, `locked`, `created_at`, `updated_at`
  - `locked` 用于禁用卖出等操作联动
- `orders`
  - 普通交易订单：`id`, `user_id`, `symbol`, `market`, `side`, `type`, `price`, `qty`, `status`, `created_at`, `updated_at`
- `payment_methods`
  - 用户资金方式：`user_id`, `type`, `label`, `data`, `uniq_key`, `created_at`, `updated_at`（三者唯一）
- `fund_audit`
  - 资金审计记录：`user_id`, `operator_id`, `operator_role`, `request_id`, `reason`, `currency`, `amount`, `created_at`
- `block_trades`
  - 大宗交易：`market`, `symbol`, `price`, `min_qty`, `time_window`, `start_at`, `end_at`, `lock_until`, `subscribe_key`, `status`, `created_at`, `updated_at`
- `block_trade_orders`
  - 大宗交易订单：`block_trade_id`, `user_id`, `price`, `qty`, `amount`, `status`, `submitted_at`, `approved_at`, `lock_until`, `notes`
- `funds`
  - 基金定义：`code`(唯一), `name_es|en`, `desc_es|en`, `tiers`, `dividend`, `redeem_days`, `status`, 时间戳
- `fund_orders`
  - 基金订单：`user_id`, `fund_id`, `code`, `price`, `percent`, `qty`, `status`, `submitted_at`, `approved_at`, `notes`, `next_payout_at`, `last_payout_at`
- `notifications`
  - 用户通知：`user_id`, `title`, `message`, `created_at`, `read`, `pinned`
- `ipo_items`
  - IPO/RWA 标的：`kind`, `name`, `code`(唯一), `subscribe_price`, `list_price`, `issue_at`, `subscribe_at`, `list_at`, `can_sell_on_listing_day`, `released`, `status`, 时间戳
- `ipo_orders`
  - IPO/RWA 订单：`user_id`, `item_id`, `code`, `qty`, `price`, `status`, `submitted_at`, `approved_at`, `notes`

## 身份认证与令牌
- 密码哈希：`sha256(password)`（`mxg-main/server/index.js:277-280`）
- 登录签发：`issueTokenForUser(userId)` 写入 `tokens` 表并返回 Bearer Token（`mxg-main/server/index.js:282-288`）
- 认证中间件：
  - `Authorization: Bearer <token>`（`authOptional` 挂载到 `req.user`，`requireAuth`/`requireRoles`做保护）
  - 参考：`mxg-main/server/index.js:290-317`

## 主要接口
- 健康与版本
  - `GET /api/health`：状态与数据库连通
  - `GET /api/version`：名称、版本、端口、环境
  - `GET /api/dev/assets`：静态构建校验
- 认证
  - `POST /api/auth/register_phone`
  - `POST /api/auth/login_phone`
  - `POST /api/auth/login_account`
  - `POST /api/auth/logout`
- 我的
  - `GET /api/me`：含 `trade_disabled` 与 `reason`
  - `GET /api/me/balances`
  - `GET /api/me/positions`：返回 `locked`
- 普通交易
  - `POST /api/trade/execute`、`POST /api/trade/orders`、`POST /api/trade/orders/:id/fill`
- 大宗交易
  - 公开：`GET /api/trade/block/list`（仅 `status=active`）
  - 用户：`POST /api/trade/block/subscribe`、`GET /api/me/trade/block/orders`
  - 管理：`GET /api/admin/trade/block/list`、`POST /api/admin/trade/block/create`、`DELETE /api/admin/trade/block/:id`、`POST /api/admin/trade/block/:id/activate|deactivate`、订单审批与驳回
- 基金
  - 管理：`GET /api/admin/trade/fund/list|create|orders|approve|reject`
  - 用户：`GET /api/me/funds`、`POST /api/me/fund/subscribe`、`GET /api/me/fund/orders`（含 `lock_until_ts`）、`POST /api/me/fund/redeem`
- IPO/RWA
  - 管理：`GET /api/admin/trade/ipo/list|release|create|orders`、`POST /api/admin/trade/ipo/orders/:id/approve|reject`
  - 用户：`POST /api/me/ipo/subscribe`
- 通知
  - `GET /api/me/notifications`
- 管理与聚合
  - `GET /api/admin/users`（含 `last_login_country`）
  - `GET/POST/DELETE /api/admin/staffs`
  - `GET /api/admin/positions`（分页/排序/过滤）

## 常用示例
- 管理员登录
  - `curl -sS -H 'Content-Type: application/json' -d '{"account":"admin","password":"xxxxxx"}' http://127.0.0.1:5210/api/auth/login_account`
- 客户登录
  - `curl -sS -H 'Content-Type: application/json' -d '{"phone":"1999999999","password":"xxxxxx"}' http://127.0.0.1:5210/api/auth/login_phone`
- 我的余额
  - `curl -sS -H 'Authorization: Bearer $TOKEN' http://127.0.0.1:5210/api/me/balances`
- 我的持仓（含 `locked`）
  - `curl -sS -H 'Authorization: Bearer $TOKEN' http://127.0.0.1:5210/api/me/positions`
- 大宗交易公开列表
  - `curl -sS http://127.0.0.1:5210/api/trade/block/list`
- 基金订阅
  - `curl -sS -H 'Authorization: Bearer $TOKEN' -H 'Content-Type: application/json' -d '{"code":"FUND1","price":100}' http://127.0.0.1:5210/api/me/fund/subscribe`

## 数据恢复与回滚
- 恢复：将正确备份 `app.db` 覆盖到 `server/data/app.db`，重启后端，验证健康与计数
- 回滚：从同目录 `.bak` 文件中挑选最近时间戳覆盖为 `app.db`，重启并验证
- 发布前快照（项目内）：建议在 `server/data/backups/` 下创建 `app_<yyyyMMdd_HHmmss>.db`

## 发布前检查清单
- `GET /api/health` 返回 `ok=true` 且 `db.connected=true`，`db.path` 指向 `server/data/app.db`
- 计数对齐：`users`、`positions`、`orders`、`balances` 与预期一致
- 管理端“用户列表”“用户持仓”可正常分页
- 关键接口（登录、我的、基金/IPO、大宗交易）抽样 200 OK

## 安全与一致性
- 不记录明文密码，登录仅比对 `sha256(password)`
- Token 存储于 `tokens` 表，过期判定在服务端完成
- 迁移仅做缺列补齐；一旦失败可直接使用自动备份 `.bak` 文件回滚