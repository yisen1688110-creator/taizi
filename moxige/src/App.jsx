import { Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import Admin from "./pages/Admin.jsx";
import AdminWithdraws from "./pages/admin/Withdraws.jsx";
import Home from "./pages/Home.jsx";
import Market from "./pages/Market.jsx";
import Symbol from "./pages/Symbol.jsx";
import Swap from "./pages/Swap.jsx";
import Exchange from "./pages/Exchange.jsx";
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
import InviteIntro from "./pages/invite/Intro.jsx";
import InviteDashboard from "./pages/invite/Dashboard.jsx";
import InstitutionBlocks from "./pages/institution/Blocks.jsx";
import InstitutionFunds from "./pages/institution/Funds.jsx";
import IpoRwaPage from "./pages/institution/IpoRwa.jsx";
import { LanguageProvider, useI18n } from "./i18n.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";

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
    } catch {}
    const byLS = (() => { try { return localStorage.getItem('force:admin') === '1' || localStorage.getItem('admin:env') === '1'; } catch { return false; } })();
    const byHost = host === "super.kudafn.com" || host.startsWith("super.");
    const byEnv = String(import.meta.env?.VITE_ADMIN_ENV || "").trim() === "1";
    // 仅将明确的后台开发端口识别为后台环境，避免普通预览端口被误判
    const byPort = port === "5174" || port === "5175"; // 移除 5176/5177 防止用户预览被误判为后台
    // 在本地开发/预览环境下，如果访问 /admin 路径，也启用后台路由（含子路径与结尾斜杠）
    const byPath = /^(\/admin)(\/.*)?$/.test(path) || path.startsWith("/admin");
    return byHost || byEnv || byPort || byPath || byQuery || byLS;
  } catch {
    return false;
  }
}

export default function App() {
  const isAdminEnv = detectAdminEnv();
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
        try { localStorage.setItem("td:key", tdkey); } catch {}
        try { localStorage.setItem("VITE_TWELVEDATA_KEY", tdkey); } catch {}
        try { localStorage.setItem("VITE_TWELVE_DATA_KEY", tdkey); } catch {}
        try { localStorage.setItem("VITE_TD_KEY", tdkey); } catch {}
        try { localStorage.setItem("VITE_TD_KEY_OVERRIDE", tdkey); } catch {}
      }
    } catch {}
  }, []);
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (stopped) return;
      try {
        const r = await fetch("/api/health");
        const j = await r.json();
        if (j && j.ok) { setHealthOk(true); return; }
      } catch {}
      setTimeout(check, 1000);
    };
    check();
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
    return (
      <LanguageProvider>
        <div className={isAdminEnv ? "app admin-app" : "app"} style={{ height:'100vh' }} />
      </LanguageProvider>
    );
  }
  return (
    <LanguageProvider>
      <div className={isAdminEnv ? "app admin-app" : "app"} style={isAdminEnv ? { display: 'block', padding: 0, alignItems: 'stretch', justifyContent: 'flex-start', overflow: 'visible' } : undefined }>
        <ErrorBoundary>
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
                <Route path="/exchange" element={<Exchange />} />
                <Route path="/trades" element={<Trades />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/me" element={<RequireAuth><Profile /></RequireAuth>} />
                <Route path="/me/settings" element={<RequireAuth><MeSettings /></RequireAuth>} />
                {/* 支持旧路径别名：/me/bank-cards */}
                <Route path="/me/cards" element={<RequireAuth><MeBankCards /></RequireAuth>} />
                <Route path="/me/bank-cards" element={<Navigate to="/me/cards" replace />} />
                <Route path="/me/wallets" element={<MeWallets />} />
              <Route path="/me/support" element={<MeSupport />} />
              {/* 已移除机构页，保留重定向到 /me 以避免 404 */}
              <Route path="/me/institution" element={<RequireAuth><MeInstitution /></RequireAuth>} />
              <Route path="/me/invite" element={<RequireAuth><InviteIntro /></RequireAuth>} />
              <Route path="/me/invite/dashboard" element={<RequireAuth><InviteDashboard /></RequireAuth>} />
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
