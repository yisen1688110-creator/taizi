import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useI18n } from "../i18n.jsx";
import { registerPhone } from "../services/auth.js";
import AuthShell, { authInputStyles as S } from "../components/auth/AuthShell.jsx";

export default function Register() {
  const { lang, t } = useI18n();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState(null);
  const [toast, setToast] = useState({ show: false, type: 'ok', text: '' });
  const navigate = useNavigate();

  // 多语言文本
  const texts = {
    title: lang === "zh" ? "创建账户" : lang === "en" ? "Create Account" : "Utwórz konto",
    subtitle: lang === "zh" 
      ? "注册以开始您的交易之旅" 
      : lang === "en" 
        ? "Sign up to start your trading journey"
        : "Zarejestruj się, aby rozpocząć handel",
    hasAccount: lang === "zh" ? "已有账户？" : lang === "en" ? "Already have an account?" : "Masz już konto?",
    login: lang === "zh" ? "立即登录" : lang === "en" ? "Sign in" : "Zaloguj się",
    successMsg: lang === "zh" ? "注册成功" : lang === "en" ? "Registration successful" : "Rejestracja zakończona pomyślnie",
    inviteCode: lang === "zh" ? "邀请码" : lang === "en" ? "Invite Code" : "Kod zaproszenia",
    inviteCodePlaceholder: lang === "zh" ? "请输入邀请码" : lang === "en" ? "Enter invite code" : "Wprowadź kod zaproszenia",
    inviteCodeRequired: lang === "zh" ? "请输入邀请码" : lang === "en" ? "Invite code is required" : "Kod zaproszenia jest wymagany",
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError("");

    if (!/^\d{10}$/.test(phone)) { setError(t("errorPhone")); return; }
    if (!name.trim()) { setError(t("placeholderName")); return; }
    if (!password || password.length < 6) { setError(t("errorPassword")); return; }
    if (password !== confirm) { setError(t("errorConfirmMismatch")); return; }
    if (!inviteCode.trim()) { setError(texts.inviteCodeRequired); return; }

    setLoading(true);
    try {
      await registerPhone({ phone, password, name, inviteCode: inviteCode.trim() || undefined });
    } catch (err) {
      setError(String(err?.message || t("errorRegistered")));
      setLoading(false);
      return;
    }
    
    setLoading(false);
    setToast({ show: true, type: 'ok', text: texts.successMsg });
    setTimeout(() => {
      setToast({ show: false, type: 'ok', text: '' });
      navigate('/login');
    }, 1000);
  };

  const getInputStyle = (field) => ({
    ...S.input,
    ...(focusedField === field ? S.inputFocus : {}),
  });

  return (
    <AuthShell title={texts.title} subtitle={texts.subtitle}>
      {/* Toast 通知 */}
      {toast.show && (
        <div style={toastStyles.container}>
          <div style={toastStyles.toast}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {toast.text}
          </div>
        </div>
      )}

      <form onSubmit={handleRegister} style={{ display: "flex", flexDirection: "column" }}>
        {/* 手机号 */}
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

        {/* 姓名 */}
        <div style={S.inputGroup}>
          <label style={S.label}>{t("name")}</label>
          <input
            type="text"
            style={getInputStyle("name")}
            placeholder={t("placeholderName")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={() => setFocusedField("name")}
            onBlur={() => setFocusedField(null)}
          />
        </div>

        {/* 密码 */}
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

        {/* 确认密码 */}
        <div style={S.inputGroup}>
          <label style={S.label}>{t("confirmPassword")}</label>
          <input
            type="password"
            style={getInputStyle("confirm")}
            placeholder={t("placeholderConfirm")}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onFocus={() => setFocusedField("confirm")}
            onBlur={() => setFocusedField(null)}
          />
        </div>

        {/* 邀请码（必填） */}
        <div style={S.inputGroup}>
          <label style={S.label}>{texts.inviteCode} <span style={{ color: '#ef4444' }}>*</span></label>
          <input
            type="text"
            style={getInputStyle("inviteCode")}
            placeholder={texts.inviteCodePlaceholder}
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
            onFocus={() => setFocusedField("inviteCode")}
            onBlur={() => setFocusedField(null)}
            required
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
          {loading ? "..." : t("submitRegister")}
        </button>
      </form>

      <p style={S.linkText}>
        {texts.hasAccount}
        <Link to="/login" style={S.link}>{texts.login}</Link>
      </p>
    </AuthShell>
  );
}

// Toast 样式
const toastStyles = {
  container: {
    position: "absolute",
    top: -60,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 100,
  },
  toast: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 18px",
    background: "rgba(16, 185, 129, 0.15)",
    border: "1px solid rgba(16, 185, 129, 0.3)",
    borderRadius: 8,
    color: "#10b981",
    fontSize: 13,
    fontWeight: 500,
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
    animation: "fadeInUp 0.3s ease",
  },
};
