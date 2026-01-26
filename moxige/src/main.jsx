import React from "react";
// Install global TradingView error guard as early as possible
import "./utils/tvGuard.js";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";

// 数据模型初始化：添加角色/归属字段，并内置一个超级管理员
function seedDefaultAndMigrate() {
  try {
    const users = JSON.parse(localStorage.getItem("users") || "[]");
    let changed = false;
    const ensure = (obj, key, value) => {
      if (!(key in obj)) { obj[key] = value; changed = true; }
    };
    users.forEach((u) => {
      ensure(u, "role", "customer");
      ensure(u, "id", "u_" + Math.random().toString(36).slice(2, 10));
      ensure(u, "assignedAdminId", null);
      ensure(u, "assignedOperatorId", null);
      ensure(u, "avatarUrl", null);
      ensure(u, "balancePLN", 0);
    });
    if (!users.find((u) => u.role === "super")) {
      users.push({ id: "super-1", phone: "0000000000", name: "Super Admin", password: "admin123", role: "super", avatarUrl: null, balancePLN: 0 });
      changed = true;
    }
    if (changed) localStorage.setItem("users", JSON.stringify(users));
    // 写入构建版本以确保入口 chunk 内容变化，触发新哈希
    try { localStorage.setItem("buildVersion", "2025-11-13-01"); } catch (_) {}
  } catch (_) {}
}
seedDefaultAndMigrate();

// 开发/预览便捷：仅在开发环境支持通过 URL 参数注入会话与 API 基础地址
// 用法示例（仅 DEV 有效）：/swap?autologin=1&apibase=http://127.0.0.1:5210/api
try {
  const params = new URLSearchParams(typeof window !== 'undefined' ? (window.location.search || '') : '');
  const autoLogin = params.get('autologin');
  const apiBase = params.get('apibase');
  const avKey = params.get('avkey');
  const tdKey = params.get('tdkey');
  const isDev = !!import.meta.env?.DEV;
  if (isDev && autoLogin === '1') {
    const existing = JSON.parse(localStorage.getItem('sessionUser') || 'null');
    if (!existing) {
      const demoUser = { id: 10001, phone: '0000000000', name: 'Preview User', role: 'customer' };
      try { localStorage.setItem('sessionUser', JSON.stringify(demoUser)); } catch {}
    }
  }
  if (isDev && apiBase) {
    try { localStorage.setItem('api:base', apiBase); } catch {}
    try { localStorage.setItem('api:base:override', apiBase); } catch {}
  }
  if (avKey) {
    try { localStorage.setItem('av:key', avKey); } catch {}
    try { localStorage.setItem('VITE_ALPHAVANTAGE_KEY', avKey); } catch {}
    try { localStorage.setItem('VITE_AV_KEY', avKey); } catch {}
  }
  if (tdKey) {
    try { localStorage.setItem('td:key', tdKey); } catch {}
    try { localStorage.setItem('VITE_TWELVEDATA_KEY', tdKey); } catch {}
    try { localStorage.setItem('VITE_TD_KEY', tdKey); } catch {}
  }
} catch {}
try { if (import.meta.env && import.meta.env.VITE_APP_TITLE) { document.title = import.meta.env.VITE_APP_TITLE; } } catch {}
import App from "./App.jsx";
import AdminApp from "./AdminApp.jsx";
const isAdmin = (() => { try { const p = window.location.pathname || ""; const port = String(window.location.port||""); const host = String(window.location.hostname || "").toLowerCase(); const isAdminDomain = host.startsWith("admin.") || host.includes("admin."); return port === "5174" || /^\/admin(\/.*)?$/.test(p) || isAdminDomain; } catch { return false; } })();
const AppComp = isAdmin ? AdminApp : App;
const rootElement = (
  <BrowserRouter>
    <AppComp />
  </BrowserRouter>
);
ReactDOM.createRoot(document.getElementById("root")).render(
  import.meta.env.DEV ? rootElement : <React.StrictMode>{rootElement}</React.StrictMode>
);
