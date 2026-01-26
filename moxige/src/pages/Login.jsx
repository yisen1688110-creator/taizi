import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useI18n } from "../i18n.jsx";
import { loginPhone } from "../services/auth.js";
import { api } from "../services/api.js";
import AuthShell, { authInputStyles as S } from "../components/auth/AuthShell.jsx";

export default function Login() {
  const { lang, t } = useI18n();
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState(null);
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

  // 多语言标题
  const texts = {
    title: lang === "zh" ? "登录账户" : lang === "en" ? "Sign In" : "Zaloguj się",
    subtitle: lang === "zh" 
      ? "输入您的凭据以访问您的账户" 
      : lang === "en" 
        ? "Enter your credentials to access your account"
        : "Wprowadź swoje dane, aby uzyskać dostęp do konta",
    noAccount: lang === "zh" ? "还没有账户？" : lang === "en" ? "Don't have an account?" : "Nie masz konta?",
    register: lang === "zh" ? "立即注册" : lang === "en" ? "Sign up" : "Zarejestruj się",
  };

  // 通过 URL 参数注入后端 API Base
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

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");

    if (isAdminEnv) {
      setError("请在后台登录页使用管理员账号登录");
      return;
    }

    if (!/^\d{10}$/.test(phone)) { setError(t("errorPhone")); return; }
    if (!password || password.length < 6) { setError(t("errorPassword")); return; }

    setLoading(true);
    try {
      const res = await loginPhone({ phone, password });
      const user = res?.user || null;
      if (!user) throw new Error("Login failed");

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
        setError("登录失败：后端未返回 JSON");
      } else {
        setError(raw || (t("loginWrongPassword") || t("errorPassword")));
      }
    } finally {
      setLoading(false);
    }
  };

  const getInputStyle = (field) => ({
    ...S.input,
    ...(focusedField === field ? S.inputFocus : {}),
    ...(error && field === "phone" && !/^\d{9,11}$/.test(phone) ? S.inputError : {}),
  });

  return (
    <AuthShell title={texts.title} subtitle={texts.subtitle}>
      <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column" }}>
          {isAdminEnv ? (
          <div style={S.inputGroup}>
            <label style={S.label}>{t("email")}</label>
              <input
                type="email"
              style={getInputStyle("email")}
                placeholder={t("placeholderEmail")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              onFocus={() => setFocusedField("email")}
              onBlur={() => setFocusedField(null)}
              />
          </div>
          ) : (
          <div style={S.inputGroup}>
            <label style={S.label}>{t("phone")}</label>
              <input
                type="tel"
                inputMode="numeric"
                pattern="\d*"
              style={getInputStyle("phone")}
                placeholder={t("placeholderPhone")}
                value={phone}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "");
                  setPhone(v.slice(0, 11));
                }}
              onFocus={() => setFocusedField("phone")}
              onBlur={() => setFocusedField(null)}
              />
          </div>
          )}

        <div style={S.inputGroup}>
          <label style={S.label}>{t("password")}</label>
          <input
            type="password"
            style={getInputStyle("password")}
            placeholder={t("placeholderPassword")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onFocus={() => setFocusedField("password")}
            onBlur={() => setFocusedField(null)}
          />
        </div>

        {error && <div style={S.error}>{error}</div>}

        <button
          type="submit"
          disabled={loading}
          style={{
            ...S.primaryBtn,
            opacity: loading ? 0.7 : 1,
            cursor: loading ? "not-allowed" : "pointer",
          }}
          onMouseEnter={(e) => {
            if (!loading) Object.assign(e.target.style, S.primaryBtnHover);
          }}
          onMouseLeave={(e) => {
            Object.assign(e.target.style, { transform: "none", boxShadow: S.primaryBtn.boxShadow });
          }}
          onMouseDown={(e) => {
            if (!loading) Object.assign(e.target.style, S.primaryBtnActive);
          }}
          onMouseUp={(e) => {
            if (!loading) Object.assign(e.target.style, S.primaryBtnHover);
          }}
        >
          {loading ? "..." : t("submitLogin")}
        </button>
      </form>

      <p style={S.linkText}>
        {texts.noAccount}
        <Link to="/register" style={S.link}>{texts.register}</Link>
      </p>
    </AuthShell>
  );
}
