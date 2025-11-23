# Moxige App (React + Vite)

本项目为演示性前后端端口隔离与登录流程的 React + Vite 单页应用，包含前台用户登录/注册与后台员工面板（内嵌登录）。默认语言为西班牙语（墨西哥），可在前台切换为英语。

## 端口与路由规则

- `5173`（前台）：
  - 根路径自动重定向到 `/login`。
  - 仅暴露 `/login` 与 `/register`。
  - `/admin` 以及其他未知路径返回 404（文案遵循 i18n）。
  - 顶部语言切换显示，默认 `es`，可切换到 `en`。

- `5174`（后台）：
  - 根路径自动重定向到 `/admin`。
  - 仅暴露 `/admin` 页面；未登录员工时该页面内置后台登录表单。
  - 其他路径（包括 `/login` 与 `/admin/login`）均返回 404。
  - 后台不显示语言切换入口，默认语言仍为西班牙语。

> 端口判断逻辑位于 `src/App.jsx`（`window.location.port === "5174"` 时进入后台环境）。

## 启动与预览

开发时建议同时启动两个端口：

- 前台：
  - 命令：`npm run dev`
  - 默认严格占用 `5173`（见 `vite.config.js`）。

- 后台：
  - 命令：`npm run dev:admin`
  - 运行在 `5174`，严格端口且自动打开 `/admin`。

构建与预览：

- 构建：`npm run build`
- 预览：`npm run preview`（固定在 `5173` 端口）

## 页面与行为概览

- 前台页：
  - `/login` 用户登录（支持西/英双语错误提示）。
  - `/register` 用户注册（校验 10 位手机号、最少 6 位密码、二次确认）。
  - 登录后：若角色为员工（`super|admin|operator`）会跳转 `/admin`；否则停留在前台。

- 后台页：
  - `/admin` 为员工面板。未登录时该页面显示后台登录表单，仅允许员工角色登录。
  - 登录后显示概览、用户管理、团队管理；受员工角色过滤可见性。

## 角色与登录限制

- 员工角色：`super`、`admin`、`operator`。
- 客户角色：`customer`。
- 后台登录限制：仅员工可登录并访问 `/admin`；客户账号在后台环境将收到错误提示。
- 会话：`localStorage.sessionUser` 存储当前登录用户。

## 数据模型（localStorage）

- `localStorage.users` 为用户数组，字段包括：
  - `id`、`phone`、`name`、`password`、`role`
  - `assignedAdminId`、`assignedOperatorId`（客户归属）
  - `adminId`（运营隶属管理员，仅运营账号使用）
- 首次运行会在 `src/main.jsx` 中进行数据迁移与种子：
  - 若不存在 `super`，自动创建一个：
    - `phone: "0000000000"`
    - `password: "admin123"`
    - `name: "Super Admin"`

## 国际化（i18n）

- 默认语言：西班牙语（墨西哥）。可在前台切换为英语。
- 语言存储：`localStorage.lang`（`es` 或 `en`）。
- 404 文案已国际化：
  - `notFoundTitle`: `404`
  - `notFoundDesc`: 西语 `Página no encontrada`，英语 `Page not found`
- 相关实现位于 `src/i18n.jsx`（`LanguageProvider` + `useI18n`）。

## 验证清单（快速自测）

1. 打开 `http://localhost:5173/` 自动跳到 `/login`，页面顶部显示语言切换为 `ES/EN`。
2. 访问 `http://localhost:5173/admin` 显示 404（西语）。
3. 打开 `http://localhost:5174/` 自动跳到 `/admin`，未登录时出现后台登录表单。
4. 用 `super` 账号（`0000000000`/`admin123`）登录 `/admin` 进入后台面板。
5. 在前台使用客户账号登录后不会访问后台；后台限制仅员工可登录。

## 技术栈与脚本

- React 19 + React Router 7
- Vite 5 + `@vitejs/plugin-react`
- ESLint（可选）

常用脚本：

- `npm run dev` 启动前台（5173）
- `npm run dev:admin` 启动后台（5174）
- `npm run build` 构建生产包
- `npm run preview` 预览构建结果（端口 5173）

---

如果你在其他端口运行前台（例如临时使用 5176），该端口将被视作前台环境，仍只暴露 `/login` 与 `/register`，`/admin` 返回 404。后台环境必须运行在 `5174` 以符合端口隔离规则。

## 市场数据提供者（精度优先顺序）

为提升行情精度，应用内新增统一数据服务，按以下优先级选择数据源，并在失败时自动回退：

- 首选：Twelve Data（需要密钥）— 设置环境变量 `VITE_TWELVEDATA_KEY` 启用。
- 可选：Finnhub（需要密钥，仅价格/涨跌幅，成交量可能受限）— 设置 `VITE_FINNHUB_TOKEN`。
- 回退：Yahoo Finance 公共 Quote API（免密钥）。

在项目根目录创建 `.env.local`（Vite 会自动加载）：

```
VITE_TWELVEDATA_KEY=你的TwelveData密钥
# VITE_FINNHUB_TOKEN=你的Finnhub密钥
```

说明：
- 墨西哥（BMV）REST 参数与回退（客服确认）：优先传 `exchange=BMV`，失败则尝试 `mic_code=XMEX`，最后作为兜底不传 `exchange`。符号不唯一时务必传 `exchange` 或 `mic_code`，以避免默认到主市场（如 `AAPL` 默认美国市场）；若符号唯一归属 BMV，可自行决定是否省略 `exchange`。
- BMV WebSocket 不可用（BMV 为 EOD 交易所，客服确认 Twelve Data WS 不支持 BMV）。本项目仅对美股/加密等使用 WS，墨西哥股票统一采用 REST 轮询。
- América Móvil 备注：客服说明 `AMX` 不在 BMV，但存在于其他交易所；BMV 可用 `AMXB`。本项目在 `AMXL.MX` 数据不可用时自动回退到 `AMXB` 并统一公司名为“América Móvil, S.A.B. de C.V.”，搜索别名支持 “AMX/AMXB/AMXL/AMÉRICA MÓVIL”等。
- 加密货币行情现已使用 Twelve Data（与墨/美股一致，需 `VITE_TWELVEDATA_KEY`）。同时保留极端网络情况下的 CoinGecko 兜底。

### 墨西哥（BMV）对接要点（便于查阅）

- REST 回退顺序：`exchange=BMV` → `mic_code=XMEX` → 无 `exchange`（始终优先传参）。
- WebSocket 范围：BMV 不支持 WS；Twelve Data WS 适用于美股、澳洲、加密、外汇、商品。项目内仅对美股/加密启用 WS。
- 非唯一符号防护：符号在多交易所存在时，传 `exchange` 或 `mic_code` 可避免默认到主市场。
- 唯一符号策略：若某符号仅存在于 BMV，可选择省略 `exchange`（可根据产品目标决定）。
- América Móvil：`AMX` 不在 BMV；BMV 上使用 `AMXB`。页面展示 `AMXL.MX` 时，如果 Twelve Data 不提供数据，将回退到 `AMXB` 获取价格与时序。

#### 客服最终确认要点

- 回退顺序确认：`BMV → XMEX → none` 的顺序可行；若在同时传 `exchange` 与 `mic_code` 时仍拿不到正确符号，通常“完全不传”也拿不到（针对非唯一符号）。
- 符号确认：`AMXB` 是 BMV 上的正确符号（用于 América Móvil）。
- WS 范围确认：BMV 的 WebSocket 不可用，我们仅对美股/加密等开 WS 的做法是正确的。
- 策略认可：当前实现（优先传参、针对非唯一符号总是传 `exchange/mic_code`、唯一符号可酌情省略）是最佳做法；按此可规避边界问题。

## 墨股数据源与后端代理（/api/yf）

为解决 Yahoo Finance 在生产/预览环境的 CORS 与限流问题，并提升墨西哥股市（BMV）页面稳定性，前端统一通过后端代理 `/api/yf` 访问 Yahoo。

- 代理目标与缓存：
  - 后端新增 `/api/yf` 代理端点，转发到 Yahoo Finance 公共接口，并做轻量级内存缓存（TTL≈15 秒）。
  - 代理不会转发敏感头（如 `Host`、`Cookie`），以降低 429 风险。

- 使用的 Yahoo 路径（通过代理调用）：
  - 历史/K线：`/api/yf/v8/finance/chart/:symbol?interval=...&range=...`
  - 批量报价：`/api/yf/v7/finance/quote?symbols=SYM1,SYM2`

- 前端服务封装：`src/services/yahooFinanceService.js`
  - `baseCandidates`：优先使用相对路径 `/api/yf/v8/finance/chart/`；在本地预览（静态服务器不带代理）时回退到 `http://127.0.0.1:5210/api/yf/v8/finance/chart/`。
  - `fetchBatchQuotesWithFallback()`：将 v8 `chart` 基址替换为 v7 `quote`，并同样走本地/远程回退序列。
  - 墨股符号转换：`convertToYahooSymbol()` 将显示符号（如 `AMX/L`）映射为 Yahoo 兼容格式（如 `AMXL.MX`）。

- 组件层：
  - `SmartTradingChart.jsx`：当符号以 `BMV:` 开头（墨股），初始渲染即选择数据源为 `yahoo`，避免 TradingView 初始化报错；其它市场保持原逻辑。
  - `YahooFinanceChart.jsx`：使用 Chart.js 金融 K 线；优先从历史数据末尾推导“当前价”，必要时再调用报价，减少请求次数。

- 运行与联调建议：
  - 后端（5210）：在 `server/` 目录运行 `npm run dev` 启动开发服务，保证 `/api/yf` 可用。
  - 前端预览（5173）：`npm run preview`。若仅启动前端预览（无后端），墨股页面仍可通过本地回退访问 `127.0.0.1:5210` 的代理；否则相关接口会报错但不影响非关键功能。

- 已知现象：
  - 预览页可能出现 `GET /api/me/orders` 失败（未登录或后端未启动）。该错误与墨股图表无关，图表功能正常时可忽略。
