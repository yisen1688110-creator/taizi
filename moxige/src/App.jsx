import { Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import Admin from "./pages/Admin.jsx";
import Home from "./pages/Home.jsx";
import Market from "./pages/Market.jsx";
import Symbol from "./pages/Symbol.jsx";
import Swap from "./pages/Swap.jsx";
import Trades from "./pages/Trades.jsx";
import Notifications from "./pages/Notifications.jsx";
import Profile from "./pages/Profile.jsx";
import MeSettings from "./pages/me/Settings.jsx";
import MeBankCards from "./pages/me/BankCards.jsx";
import MeWallets from "./pages/me/Wallets.jsx";
import MeSupport from "./pages/me/Support.jsx";
import MeWithdraw from "./pages/me/Withdraw.jsx";
import MeWithdrawRecords from "./pages/me/WithdrawRecords.jsx";
import MeInstitution from "./pages/me/Institution.jsx";
import InstitutionBlocks from "./pages/institution/Blocks.jsx";
import InstitutionFunds from "./pages/institution/Funds.jsx";
import IpoRwaPage from "./pages/institution/IpoRwa.jsx";
import Bridge from "./pages/Bridge.jsx";
import { LanguageProvider, useI18n } from "./i18n.jsx";
import { waitForHealth, setToken } from "./services/api.js";
import { me } from "./services/auth.js";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import ChatNotification from "./components/ChatNotification.jsx";

// 语言切换移至账户设置页，此处移除顶部语言切换组件

function NotFound() {
  const { t } = useI18n();
  return (
    <div className="screen">
      <div className="card">
        <h1 className="title">{t("notFoundTitle")}</h1>
        <p className="desc">{t("notFoundDesc")}</p>
      </div>
    </div>
  );
}

function detectAdminEnv() {
  try {
    const host = (typeof window !== "undefined" && window.location.hostname) || "";
    const port = (typeof window !== "undefined" && window.location.port) || "";
    const path = (typeof window !== "undefined" && window.location.pathname) || "";
    const search = (typeof window !== "undefined" && window.location.search) || "";
    let byQuery = false;
    try {
      const params = new URLSearchParams(search || "");
      const adminParam = params.get('admin');
      if (adminParam === '0') return false; // 显式关闭后台环境
      byQuery = adminParam === '1';
    } catch { }
    const byLS = (() => { try { return localStorage.getItem('force:admin') === '1' || localStorage.getItem('admin:env') === '1'; } catch { return false; } })();
    const byHost = host === "super.kudafn.com" || host.startsWith("super.") || host === "decim.org" || host.endsWith(".decim.org");
    const byEnv = String(import.meta.env?.VITE_ADMIN_ENV || "").trim() === "1";
    // 仅将明确的后台开发端口识别为后台环境，避免普通预览端口被误判
    const byPort = port === "5174" || port === "5175" || port === "5211"; // 移除 5176/5177 防止用户预览被误判为后台
    // 在本地开发/预览环境下，如果访问 /admin 路径，也启用后台路由（含子路径与结尾斜杠）
    const byPath = /^(\/admin)(\/.*)?$/.test(path) || path.startsWith("/admin");
    return byHost || byEnv || byPort || byPath || byQuery || byLS;
  } catch {
    return false;
  }
}

export default function App() {
  const isAdminEnv = detectAdminEnv();
  const { t } = useI18n();
  const [retrying, setRetrying] = useState(false);
  const [healthOk, setHealthOk] = useState(false);
  // 便捷调试：支持通过 URL 参数配置本地开关
  // 示例：?xmex=1&debug=1&prefer_yf_mx=1&enable_yf=1&tdkey=YOUR_TWELVE_DATA_KEY
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search || "");
      const setFlag = (lsKey, qKey) => {
        const v = params.get(qKey);
        if (v === "1") localStorage.setItem(lsKey, "1");
        if (v === "0") localStorage.removeItem(lsKey);
      };
      setFlag("force:xmex", "xmex");
      setFlag("debug:market", "debug");
      setFlag("prefer:yf:mx", "prefer_yf_mx");
      setFlag("enable:yf", "enable_yf");
      // 允许通过 ?admin=1/0 打开或关闭后台环境标记
      setFlag("admin:env", "admin");
      setFlag("force:admin", "admin");
      const tdkey = params.get("tdkey");
      if (tdkey) {
        // 支持多种 localStorage 键名，便于 getTDKey() 读取
        try { localStorage.setItem("td:key", tdkey); } catch { }
        try { localStorage.setItem("VITE_TWELVEDATA_KEY", tdkey); } catch { }
        try { localStorage.setItem("VITE_TWELVE_DATA_KEY", tdkey); } catch { }
        try { localStorage.setItem("VITE_TD_KEY", tdkey); } catch { }
        try { localStorage.setItem("VITE_TD_KEY_OVERRIDE", tdkey); } catch { }
      }
      // 部署环境：如已在构建时注入 env，则同步到本地存储，保障运行时取值
      try {
        const envKey = import.meta.env?.VITE_TWELVEDATA_KEY || import.meta.env?.VITE_TWELVE_DATA_KEY || import.meta.env?.VITE_TD_KEY || import.meta.env?.VITE_TD_KEY_OVERRIDE;
        const hasLs = localStorage.getItem('td:key');
        if (envKey && !hasLs) { localStorage.setItem('td:key', String(envKey)); }
      } catch { }
    } catch { }
  }, []);

  // Cross-domain login support: detect ?token=...
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('token');
      if (token) {
        setToken(token);
        // Verify token and get user session
        me().then(res => {
          if (res?.user) {
            try { localStorage.setItem('sessionUser', JSON.stringify(res.user)); } catch { }
            // Remove token from URL to prevent leakage and re-processing
            const newUrl = window.location.pathname + window.location.hash;
            window.history.replaceState({}, document.title, newUrl);
            // Reload to ensure fresh state with new token
            window.location.reload();
          }
        }).catch(() => {
          // Token invalid, maybe clear it?
          // setToken('');
        });
      }
    } catch { }
  }, []);
  useEffect(() => {
    let stopped = false;
    (async () => {
      try {
        await waitForHealth(9000);
        if (!stopped) setHealthOk(true);
      } catch {
        if (!stopped) setHealthOk(true);
      }
    })();
    return () => { stopped = true; };
  }, []);
  // 简易登录保护：未登录不允许访问交易页
  function RequireAuth({ children }) {
    let authed = false;
    try { authed = !!String(localStorage.getItem('token') || '').trim(); } catch { authed = false; }
    if (!authed) return <Navigate to="/login" replace />;
    return children;
  }
  if (!healthOk) {
    const retry = async () => {
      if (retrying) return;
      setRetrying(true);
      try { await waitForHealth(6000); setHealthOk(true); }
      catch { setHealthOk(true); }
      setRetrying(false);
    };
    return (
      <LanguageProvider>
        <div className={isAdminEnv ? "app admin-app" : "app"} style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center', color: '#9eb0c7' }}>
            <div style={{ fontSize: 18, marginBottom: 8 }}>{t('loading') || '正在连接服务…'}</div>
            <button onClick={retry} disabled={retrying} style={{ padding: '8px 14px', borderRadius: 6, background: '#1e2a3a', color: '#cfe1ff', border: '1px solid #2f3e52' }}>{retrying ? (t('loading') || '正在连接…') : (t('retry') || '重试连接')}</button>
          </div>
        </div>
      </LanguageProvider>
    );
  }
  return (
    <LanguageProvider>
      <div className={isAdminEnv ? "app admin-app" : "app"} style={isAdminEnv ? { display: 'block', padding: 0, alignItems: 'stretch', justifyContent: 'flex-start', overflow: 'visible' } : undefined}>
        <ErrorBoundary>
          {!isAdminEnv && <ChatNotification />}
          <Routes>
            {isAdminEnv ? (
              <>
                <Route path="/" element={<Navigate to="/admin" replace />} />
                {/* 后台入口与子路径 */}
                <Route path="/admin" element={<Admin />} />
                <Route path="/admin/withdraws" element={<Admin />} />
                <Route path="/admin/chognzhi" element={<Admin />} />
                <Route path="/admin/zijin" element={<Admin />} />
                {/* 兼容外部误跳转到 /login 的情况：统一回到后台入口 */}
                <Route path="/login" element={<Navigate to="/admin" replace />} />
                <Route path="*" element={<NotFound />} />
              </>
            ) : (
              <>
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/home" element={<Home />} />
                <Route path="/market" element={<Market />} />
                {/* 股票/加密详情页（从市场页点击“在App中查看”进入） */}
                <Route path="/market/:symbol" element={<Symbol />} />
                {/* 交易页允许未登录访问（仅前端展示；服务端仍校验下单权限） */}
                <Route path="/swap" element={<Swap />} />
                <Route path="/trades" element={<Trades />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/bridge" element={<Bridge />} />
                <Route path="/me" element={<RequireAuth><Profile /></RequireAuth>} />
                <Route path="/me/settings" element={<RequireAuth><MeSettings /></RequireAuth>} />
                {/* 支持旧路径别名：/me/bank-cards */}
                <Route path="/me/cards" element={<RequireAuth><MeBankCards /></RequireAuth>} />
                <Route path="/me/bank-cards" element={<Navigate to="/me/cards" replace />} />
                <Route path="/me/wallets" element={<MeWallets />} />
                <Route path="/me/support" element={<MeSupport />} />
                {/* 已移除机构页，保留重定向到 /me 以避免 404 */}
                <Route path="/me/institution" element={<RequireAuth><MeInstitution /></RequireAuth>} />

                {/* 机构 - 大宗交易列表页 */}
                <Route path="/institution/blocks" element={<RequireAuth><InstitutionBlocks /></RequireAuth>} />
                {/* 机构 - 基金列表页 */}
                <Route path="/institution/funds" element={<RequireAuth><InstitutionFunds /></RequireAuth>} />
                {/* 机构 - IPO/RWA 列表页 */}
                <Route path="/institution/ipo-rwa" element={<RequireAuth><IpoRwaPage /></RequireAuth>} />
                {/* 机构页别名：/my-institution 重定向到 /me/institution */}
                <Route path="/my-institution" element={<Navigate to="/me/institution" replace />} />
                <Route path="/me/withdraw" element={<RequireAuth><MeWithdraw /></RequireAuth>} />
                <Route path="/me/withdraw/records" element={<RequireAuth><MeWithdrawRecords /></RequireAuth>} />
                <Route path="/" element={<Navigate to="/home" replace />} />
                {/* 前端端口不存在 /admin */}
                <Route path="/admin" element={<NotFound />} />
                <Route path="*" element={<NotFound />} />
              </>
            )}
          </Routes>
        </ErrorBoundary>
      </div>
    </LanguageProvider>
  );
}
