import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useI18n } from "../i18n.jsx";
import { registerPhone } from "../services/auth.js";

export default function Register() {
  const { t } = useI18n();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleRegister = async (e) => {
    e.preventDefault();
    setError("");
    if (!/^\d{10}$/.test(phone)) { setError(t("errorPhone")); return; }
    if (!name.trim()) {
      setError(t("placeholderName"));
      return;
    }
    if (!password || password.length < 6) {
      setError(t("errorPassword"));
      return;
    }
    if (password !== confirm) {
      setError(t("errorConfirmMismatch"));
      return;
    }
    try {
      // 仅调用后端注册，用户数据保存在数据库，不写入本地镜像
      await registerPhone({ phone, password, name });
    } catch (err) {
      setError(String(err?.message || t("errorRegistered")));
      return;
    }
    alert(t("successRegister"));
    navigate("/login");
  };

  return (
    <div className="screen">
      <div className="card">
        <h1 className="title">{t("registerTitle")}</h1>
        <form onSubmit={handleRegister} className="form">
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

          <label className="label">{t("name")}</label>
          <input
            type="text"
            className="input"
            placeholder={t("placeholderName")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <label className="label">{t("password")}</label>
          <input
            type="password"
            className="input"
            placeholder={t("placeholderPassword")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <label className="label">{t("confirmPassword")}</label>
          <input
            type="password"
            className="input"
            placeholder={t("placeholderConfirm")}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />

          {error && <div className="error">{error}</div>}

          <button className="btn primary" type="submit">{t("submitRegister")}</button>
        </form>
        <div className="sub-actions">
          <Link className="link" to="/login">{t("loginLink")}</Link>
        </div>
      </div>
    </div>
  );
}