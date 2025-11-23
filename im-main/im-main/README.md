# 嵌入式客服聊天系统部署与接口说明

## 概览
- 技术栈：`Node.js` + `Express` + `Socket.IO` + `SQLite3` + 原生前端
- 前端入口：
  - 客户端页面：`/customer.html`
  - 客服端页面：`/agent.html`
- 数据库：`data/chat.db`（首次启动自动创建与迁移）

## 环境与依赖
- 安装 `Node.js >= 18` 与 `npm`
- 必须允许服务器出站访问 `https://ipapi.co/`（用于解析客户 IP 对应国家）
- 反向代理需透传真实客户端 IP 到后端：设置 `X-Forwarded-For`
- 项目依赖（已在 `package.json` 声明）：
  - `express`、`cors`、`socket.io`、`sqlite3`、`multer`

## 启动与端口
- 安装依赖：`npm install`
- 启动开发：`node server/index.js` 或 `npm start`
- 端口环境变量：`PORT`，默认 `3000`
- 静态资源目录：`public/`
- 上传目录：`public/uploads/`（自动创建）

## 反向代理（Nginx）
- 关键设置：
  - 透传真实 IP：`X-Forwarded-For`
  - WebSocket 升级：`Upgrade/Connection`
- 示例：
```
server {
  listen 80;
  server_name your-domain.com;

  location /socket.io/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "Upgrade";
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## 进程守护（systemd）
- 创建 `/etc/systemd/system/embedded-chat.service`：
```
[Unit]
Description=Embedded Chat Service
After=network.target

[Service]
Environment=PORT=3000
ExecStart=/usr/bin/node /path/to/project/server/index.js
WorkingDirectory=/path/to/project
Restart=always
RestartSec=3
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```
- 启动与自启：
  - `sudo systemctl daemon-reload`
  - `sudo systemctl enable --now embedded-chat`
  - 查看日志：`journalctl -u embedded-chat -f`

## 前端入口与参数
- 客户端页：
  - `http://your-domain/customer.html?phone=16666666666&name=张三&avatar=https://...`
  - 首次进入会调用 `POST /api/user` 建档（并解析国家）
- 客服端页：
  - `http://your-domain/agent.html`

## 数据库结构（核心）
- `users(phone TEXT PRIMARY KEY, name TEXT, avatar TEXT, country TEXT)`
- `messages(id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, sender TEXT, content TEXT, ts INTEGER, type TEXT, reply_to INTEGER, ip TEXT, country TEXT)`
- `reads(phone TEXT PRIMARY KEY, last_read_ts INTEGER)`
- `seen(phone TEXT PRIMARY KEY, last_seen_ts INTEGER)`
- `user_notes(phone TEXT PRIMARY KEY, note TEXT)`
- `notes(id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, content TEXT, ts INTEGER, pinned INTEGER)`
- 迁移策略：服务启动时自动检测缺失列并 `ALTER TABLE` 增补

## REST 接口
- `POST /api/user`
  - 说明：建档或更新用户资料，并尝试解析请求 IP 对应国家
  - 请求体：`{ phone, name?, avatar? }`
  - 响应：`{ ok: true }`
- `GET /api/user/:phone`
  - 说明：查询用户资料（如无 `country`，将尝试从最近客户消息的 `ip/country` 回填）
  - 响应：`{ phone, name, avatar, country }`
- `GET /api/messages/:phone`
  - 说明：拉取会话消息记录（包含客户消息的 `ip/country`）
  - 响应：`[{ id, phone, sender, content, ts, type, reply_to, ip, country }]`
- `GET /api/message/:id`
  - 说明：查询单条消息（用于引用回退）
  - 响应：`{ id, phone, sender, content, ts, type, reply_to }`
- `POST /api/read`
  - 说明：更新该会话的已读时间戳
  - 请求体：`{ phone, ts? }`
  - 响应：`{ ok: true }`
- `GET /api/note/:phone`
  - 响应：`{ phone, note }`
- `POST /api/note`
  - 说明：更新当前备注，同时写一条流水到 `notes`
  - 请求体：`{ phone, note }`
  - 响应：`{ ok: true, ts }`
- `GET /api/notes/:phone`
  - 响应：备注流水数组
- `PATCH /api/notes/:id`（编辑流水）
- `POST /api/notes/:id/pin`（置顶/取消）
- `DELETE /api/notes/:id`（删除流水）
- `POST /api/upload`
  - 说明：图片上传（字段名 `file`，最大 5MB，类型 `image/*`）
  - 响应：`{ url }`

## Socket.IO 事件（实时）
- 客户端/客服端连接：`io()`（默认路径 `/socket.io/`）
- 加入会话：`socket.emit('join', { phone, role: 'customer'|'agent' })`
- 发送消息：`socket.emit('message', { phone, sender, content, type?, reply_to? })`
  - 服务端落库并广播 `message`
- 撤回消息：`socket.emit('recall', { phone, id, by: 'customer'|'agent' })`
  - 客户撤回：改消息类型为 `recall` 并广播 `recalled`
  - 客服撤回：删除并广播 `recalled`
- 在线状态广播：`presence`
- 已读状态广播：`read-status`

## 快速测试
- 建档：
```
curl -X POST http://your-domain/api/user \
  -H 'Content-Type: application/json' \
  -d '{"phone":"16666666666","name":"张三"}'
```
- 查询用户：
```
curl http://your-domain/api/user/16666666666
```
- 拉取消息：
```
curl http://your-domain/api/messages/16666666666
```

## 部署建议与注意
- 真实 IP：务必在反向代理层设置 `X-Forwarded-For`；后端已启用 `trust proxy`
- 出站访问：若服务器无法访问 `ipapi.co`，国家可能为空；本地回环地址展示为“本地”
- 资源限制：图片最大 5MB；`uploads/` 路径位于 `public/`
- 备份迁移：数据库文件在 `data/chat.db`；迁移只需复制该文件
- 安全建议：
  - 不在日志或响应中暴露敏感信息
  - 上传文件仅限图片类型，超出大小拒绝
  - 跨域默认允许，如需限制可在 `server/index.js` 调整 `cors` 策略

## 常见问题
- 客户端不在最新消息：
  - 确保 `#messages` 是唯一滚动容器，`html/body` 设置 `overflow: hidden`
- Sticky 输入栏挡住最后一条：
  - 已采用 `sticky`，滚动逻辑仅滚动，不增加额外 `padding-bottom`
- 国家不显示：
  - 检查代理是否透传 IP；检查服务器能否访问 `ipapi.co`

---
如需将接口扩展到会话列表显示国家或记录原始 IP 字段，请说明需求，我可以追加接口与 UI。