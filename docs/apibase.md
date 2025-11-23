# 前端 API 基础地址（apibase）与远程调试说明

本文介绍如何在不改动代码的情况下，为前端指定后端 API 基础地址，并进行本地/远程调试。

## 基本概念

- 前端内置一个轻量 API 客户端（`moxige/src/services/api.js`）。
- API Base 的优先级：
  1. URL 参数 `apibase`
  2. `localStorage['api:base:override']` 或 `localStorage['api:base']`
  3. 环境变量 `VITE_API_BASE`
  4. 相对路径 `'/api'`（由前端服务器的代理或反向代理转发）

> 在非本地环境（HTTPS 域名）默认不允许跨域的绝对地址，避免混合内容与 CORS 问题。本地 `localhost/127.0.0.1/192.* /172.*` 环境允许。

## 快速使用

- 预览或开发模式下，在地址后追加 `?apibase=...` 即可：

```
http://localhost:5173/login?apibase=http://127.0.0.1:5284/api
```

- 搭配自动登录演示用户（仅 DEV）：

```
http://localhost:5173/?autologin=1&apibase=http://127.0.0.1:5284/api
```

这会将值写入 `localStorage`，后续页面刷新会持续使用该 Base。

## 后端接口自测

后端示例端口：`5284`，对应路由：

- 版本与连通性：
  - `GET /api/version`
- 注册/登录（手机号）：
  - `POST /api/auth/register_phone { phone, password, name }`
  - `POST /api/auth/login_phone { phone, password }` → 返回 `token`
- 我的余额/持仓/订单：
  - `GET /api/me/balances`（需 `Authorization: Bearer <token>`）
  - `GET /api/me/positions`
  - `GET /api/me/orders`
- 管理端：
  - `GET /api/admin/users[?q=...]`
  - `GET /api/admin/users/:uid/balances`

示例：

```bash
# 版本
curl -s http://localhost:5284/api/version | jq .

# 登录并读取我的余额
TOKEN=$(curl -s http://localhost:5284/api/auth/login_phone \
  -H 'Content-Type: application/json' \
  -d '{"phone":"0000000000","password":"admin123"}' | jq -r .token)

curl -s -H "Authorization: Bearer ${TOKEN}" \
  http://localhost:5284/api/me/balances | jq .
```

## 常见问题

- 访问返回 HTML：说明使用了错误的 Base（实际上访问到了前端页面），请设置 `apibase` 或反向代理到后端。
- 401 未授权：前端会尝试静默登录一次（从本地会话中读取手机号与密码）。若仍失败，请手动登录并确认 `Authorization` 头是否携带令牌。

## 远程域名与端口映射

详见 `docs/remote-access.md`：

- `xg.kudafn.com` → 主机端口 `5210`（反代到后端容器）
- `super.kudafn.com` → 主机端口 `5174`（反代到后端容器）

若仅在本地运行后端，请使用 `apibase=http://127.0.0.1:<port>/api` 注入到前端。