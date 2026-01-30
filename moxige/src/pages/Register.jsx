import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useI18n } from "../i18n.jsx";
import { registerPhone, sendEmailCode } from "../services/auth.js";
import AuthShell, { authInputStyles as S } from "../components/auth/AuthShell.jsx";

export default function Register() {
  const { lang, t } = useI18n();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [email, setEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [sendingCode, setSendingCode] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState(null);
  const [toast, setToast] = useState({ show: false, type: 'ok', text: '' });
  const navigate = useNavigate();

  // 倒计时
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

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
    email: lang === "zh" ? "邮箱" : lang === "en" ? "Email" : "E-mail",
    emailPlaceholder: lang === "zh" ? "请输入邮箱地址" : lang === "en" ? "Enter your email" : "Wpisz swój e-mail",
    emailCode: lang === "zh" ? "验证码" : lang === "en" ? "Verification Code" : "Kod weryfikacyjny",
    emailCodePlaceholder: lang === "zh" ? "请输入验证码" : lang === "en" ? "Enter verification code" : "Wpisz kod",
    sendCode: lang === "zh" ? "发送验证码" : lang === "en" ? "Send Code" : "Wyślij kod",
    resend: lang === "zh" ? "重新发送" : lang === "en" ? "Resend" : "Wyślij ponownie",
    codeSent: lang === "zh" ? "验证码已发送" : lang === "en" ? "Code sent" : "Kod wysłany",
    invalidEmail: lang === "zh" ? "请输入有效的邮箱地址" : lang === "en" ? "Please enter a valid email" : "Wprowadź prawidłowy e-mail",
    emailRequired: lang === "zh" ? "请输入邮箱" : lang === "en" ? "Email is required" : "E-mail jest wymagany",
    codeRequired: lang === "zh" ? "请输入验证码" : lang === "en" ? "Verification code is required" : "Kod weryfikacyjny jest wymagany",
    emailExists: lang === "zh" ? "该邮箱已被注册" : lang === "en" ? "Email already exists" : "E-mail już istnieje",
    invalidCode: lang === "zh" ? "验证码错误" : lang === "en" ? "Invalid verification code" : "Nieprawidłowy kod",
    codeExpired: lang === "zh" ? "验证码已过期" : lang === "en" ? "Code expired" : "Kod wygasł",
  };

  // 发送验证码
  const handleSendCode = async () => {
    setError("");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(texts.invalidEmail);
      return;
    }
    setSendingCode(true);
    try {
      await sendEmailCode(email);
      setCountdown(60);
      setToast({ show: true, type: 'ok', text: texts.codeSent });
      setTimeout(() => setToast({ show: false, type: 'ok', text: '' }), 2000);
    } catch (err) {
      const errMsg = err?.message || '';
      if (errMsg.includes('email_exists')) {
        setError(texts.emailExists);
      } else if (errMsg.includes('too_frequent')) {
        setError(lang === "zh" ? "发送太频繁，请稍后再试" : "Too frequent, please try later");
      } else {
        setError(lang === "zh" ? "发送失败，请重试" : "Failed to send, please retry");
      }
    } finally {
      setSendingCode(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError("");

    // 验证邮箱和验证码
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { 
      setError(texts.invalidEmail); 
      return; 
    }
    if (!emailCode.trim()) { 
      setError(texts.codeRequired); 
      return; 
    }
    
    if (!/^\d{9}$/.test(phone)) { setError(t("errorPhone")); return; }
    if (!name.trim()) { setError(t("placeholderName")); return; }
    if (!password || password.length < 6) { setError(t("errorPassword")); return; }
    if (password !== confirm) { setError(t("errorConfirmMismatch")); return; }
    if (!inviteCode.trim()) { setError(texts.inviteCodeRequired); return; }

    setLoading(true);
    try {
      await registerPhone({ 
        phone, 
        password, 
        name, 
        inviteCode: inviteCode.trim() || undefined,
        email: email.trim(),
        emailCode: emailCode.trim()
      });
    } catch (err) {
      const errMsg = String(err?.message || '');
      if (errMsg.includes('invalid_code') || errMsg.includes('code_not_found')) {
        setError(texts.invalidCode);
      } else if (errMsg.includes('code_expired')) {
        setError(texts.codeExpired);
      } else if (errMsg.includes('email_exists')) {
        setError(texts.emailExists);
      } else {
        setError(errMsg || t("errorRegistered"));
      }
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
        {/* 邮箱 */}
        <div style={S.inputGroup}>
          <label style={S.label}>{texts.email} <span style={{ color: '#ef4444' }}>*</span></label>
          <input
            type="email"
            style={getInputStyle("email")}
            placeholder={texts.emailPlaceholder}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onFocus={() => setFocusedField("email")}
            onBlur={() => setFocusedField(null)}
          />
        </div>

        {/* 验证码 */}
        <div style={S.inputGroup}>
          <label style={S.label}>{texts.emailCode} <span style={{ color: '#ef4444' }}>*</span></label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              inputMode="numeric"
              style={{ ...getInputStyle("emailCode"), flex: 1 }}
              placeholder={texts.emailCodePlaceholder}
              value={emailCode}
              onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onFocus={() => setFocusedField("emailCode")}
              onBlur={() => setFocusedField(null)}
            />
            <button
              type="button"
              disabled={countdown > 0 || sendingCode}
              onClick={handleSendCode}
              style={{
                padding: "0 16px",
                borderRadius: 8,
                border: "none",
                background: countdown > 0 ? "rgba(100,116,139,0.3)" : "linear-gradient(135deg, #3b82f6, #2563eb)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 500,
                cursor: countdown > 0 || sendingCode ? "not-allowed" : "pointer",
                whiteSpace: "nowrap",
                minWidth: 100,
              }}
            >
              {sendingCode ? "..." : countdown > 0 ? `${countdown}s` : texts.sendCode}
            </button>
          </div>
        </div>

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
              setPhone(v.slice(0, 9));
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
