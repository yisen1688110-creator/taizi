import { useLocation, useNavigate } from "react-router-dom";
import { useI18n } from "../i18n.jsx";
import { IconHome, IconMarket, IconLightning, IconBell, IconUser } from "../assets/icons.jsx";

export default function BottomNav() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const items = [
    { key: "/home", label: t("bottomHome"), Icon: IconHome, size: 26 },
    { key: "/market", label: t("bottomMarket"), Icon: IconMarket, size: 26 },
    { key: "/swap", label: t("bottomTrade"), Icon: IconLightning, special: "lightning", size: 30 },
    { key: "/notifications", label: t("bottomNotify"), Icon: IconBell, size: 26 },
    { key: "/me", label: t("bottomMe"), Icon: IconUser, size: 26 },
  ];

  return (
    <div className="bottom-nav" role="navigation" aria-label="bottom-nav">
      {items.map((it) => (
        <button
          key={it.key}
          className={`pill ${pathname === it.key ? "active" : ""} ${it.special === "lightning" ? "lightning" : ""}`}
          onClick={() => navigate(it.key)}
          aria-label={it.label}
        >
          <it.Icon className={`pill-icon ${it.special === "lightning" ? "lightning-icon" : ""}`} size={it.size || 26} />
          <span className="pill-label" aria-hidden="true">{it.label}</span>
        </button>
      ))}
    </div>
  );
}