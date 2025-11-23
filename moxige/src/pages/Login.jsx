import { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useI18n } from "../i18n.jsx";
import { loginPhone } from "../services/auth.js";
import { api } from "../services/api.js";

export default function Login() {
  const { t } = useI18n();
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const cardRef = useRef(null);
  const navigate = useNavigate();
  const isAdminEnv = (() => {
    try {
      const host = (typeof window !== "undefined" && window.location.hostname) || "";
      const byHost = host === "super.kudafn.com" || host.startsWith("super.");
      const byEnv = String(import.meta.env?.VITE_ADMIN_ENV || "").trim() === "1";
      return byHost || byEnv;
    } catch {
      return false;
    }
  })();

  // 通过 URL 参数注入后端 API Base，避免登录请求命中前端路由并返回整页 HTML
  // 用法示例：/login?apibase=https://api.example.com/api
  // 同时持久化到 localStorage，便于后续页面复用
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search || "");
      const apibase = (params.get("apibase") || "").trim();
      if (apibase) {
        try { localStorage.setItem("api:base", apibase); } catch {}
        try { localStorage.setItem("api:base:override", apibase); } catch {}
        api.setBase(apibase);
      }
    } catch {}
  }, []);

  const handleMove = (e) => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.setProperty("--rx", `${(-y * 6).toFixed(2)}deg`);
    el.style.setProperty("--ry", `${(x * 8).toFixed(2)}deg`);
    el.style.setProperty("--tx", `${(x * 8).toFixed(2)}px`);
    el.style.setProperty("--ty", `${(y * 8).toFixed(2)}px`);
  };
  const handleLeave = () => {
    const el = cardRef.current;
    if (!el) return;
    el.style.setProperty("--rx", `0deg`);
    el.style.setProperty("--ry", `0deg`);
    el.style.setProperty("--tx", `0px`);
    el.style.setProperty("--ty", `0px`);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    // 后台环境：暂时不在此页处理（管理员端端口专用页面）
    if (isAdminEnv) {
      setError("请在后台登录页使用管理员账号登录");
      return;
    }

    // 客户环境：使用本地手机号登录
    if (!/^\d{10}$/.test(phone)) { setError(t("errorPhone")); return; }
    if (!password || password.length < 6) { setError(t("errorPassword")); return; }
    try {
      const res = await loginPhone({ phone, password });
      const user = res?.user || null;
      if (!user) throw new Error("Login failed");
      // 更新本地镜像用户表：使用后端数值 ID，避免前端生成的 u_* ID
      const users = JSON.parse(localStorage.getItem("users") || "[]");
      const idx = users.findIndex((u) => u.phone === phone);
      const backendId = Number(user.id);
      const newEntry = {
        ...(idx !== -1 ? users[idx] : {}),
        phone,
        name: user.name || users[idx]?.name || '',
        role: "customer",
        id: backendId,
        backendId,
        lastLoginIp: user.last_login_ip || null,
      };
      if (idx !== -1) users[idx] = newEntry; else users.push(newEntry);
      localStorage.setItem("users", JSON.stringify(users));
      // 会话直接使用后端返回的用户对象，确保 id 为数值 ID
      localStorage.setItem("sessionUser", JSON.stringify({ ...user }));
      navigate("/home");
    } catch (err) {
      const code = String(err?.code || '').trim();
      if (code === 'rate_limited') {
        setError('请求过于频繁，请稍后再试');
        return;
      }
      if (code === 'login_locked') {
        const ms = Number(err?.remainMs || 0);
        const mm = Math.max(1, Math.round(ms / 60000));
        setError(`密码错误次数过多，账号已临时锁定（约 ${mm} 分钟）`);
        return;
      }
      const raw = String(err?.message || "");
      const looksHtml = /<html[\s>]/i.test(raw) || /<!DOCTYPE html>/i.test(raw);
      if (looksHtml || raw.length > 500) {
        console.error("Login error (HTML or long message)", err);
        setError("登录失败：后端未返回 JSON（可能是反向代理未配置或 API 地址错误）。请设置 apibase 或联系管理员。");
      } else {
        setError(raw || (t("loginWrongPassword") || t("errorPassword")));
      }
    }
  };

  return (
    <div className="screen">
      {/* logo 区域 */}
      <div className="logo-area enter">
        <img className="logo-img" alt="logo" src="/logo.png" />
      </div>

      <div ref={cardRef} className="card cyber-tilt" onMouseMove={handleMove} onMouseLeave={handleLeave}>
        <h1 className="title">{t("loginTitle")}</h1>

        <form onSubmit={handleLogin} className="form">
          {isAdminEnv ? (
            <>
              <label className="label">{t("email")}</label>
              <input
                type="email"
                className="input"
                placeholder={t("placeholderEmail")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </>
          ) : (
            <>
              <label className="label">{t("phone")}</label>
              <input
                type="tel"
                inputMode="numeric"
                pattern="\d*"
                className="input"
                placeholder={t("placeholderPhone")}
                value={phone}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "");
                  setPhone(v.slice(0, 10));
                }}
              />
            </>
          )}

          <label className="label">{t("password")}</label>
          <input
            type="password"
            className="input"
            placeholder={t("placeholderPassword")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {error && <div className="error">{error}</div>}

          <button className="btn primary" type="submit">{t("submitLogin")}</button>
        </form>

        <div className="sub-actions">
          <Link className="link" to="/register">{t("registerLink")}</Link>
        </div>
      </div>
    </div>
  );
}