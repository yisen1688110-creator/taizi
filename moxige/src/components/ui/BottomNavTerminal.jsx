import { useLocation, useNavigate } from "react-router-dom";
import { useI18n } from "../../i18n.jsx";
import { colors, radius, typography, animation, shadows } from "../../styles/tokens.js";

/**
 * BottomNavTerminal - 终端风格底部导航
 * Glass bar + 选中态蓝色 glow + 线性图标
 */
export default function BottomNavTerminal() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const items = [
    { key: "/home", label: t("bottomHome"), icon: IconHome },
    { key: "/market", label: t("bottomMarket"), icon: IconMarket },
    { key: "/swap", label: t("bottomTrade"), icon: IconTrade, special: true },
    { key: "/notifications", label: t("bottomNotify"), icon: IconBell },
    { key: "/me", label: t("bottomMe"), icon: IconUser },
  ];

  return (
    <nav style={styles.nav} role="navigation" aria-label="bottom-nav">
      {/* 顶部发光边 */}
      <div style={styles.topGlow} />
      
      {items.map((item) => {
        const isActive = pathname === item.key;
        const Icon = item.icon;
        
        return (
          <button
            key={item.key}
            onClick={() => navigate(item.key)}
            style={{
              ...styles.item,
              ...(item.special ? styles.itemSpecial : {}),
              ...(isActive && !item.special ? styles.itemActive : {}),
              ...(isActive && item.special ? styles.itemSpecialActive : {}),
            }}
            aria-label={item.label}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon 
              size={item.special ? 22 : 24} 
              color={
                item.special 
                  ? "#ffffff" 
                  : isActive 
                    ? colors.accent.primary 
                    : colors.text.tertiary
              }
            />
            {/* 选中态发光指示器 */}
            {isActive && !item.special && (
              <div style={styles.activeIndicator} />
            )}
          </button>
        );
      })}
    </nav>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 线性图标组件
// ═══════════════════════════════════════════════════════════════════════════

function IconHome({ size = 24, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function IconMarket({ size = 24, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="20" x2="12" y2="10" />
      <line x1="18" y1="20" x2="18" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

function IconTrade({ size = 24, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function IconBell({ size = 24, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function IconUser({ size = 24, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════════════════════

const styles = {
  nav: {
    position: "fixed",
    bottom: 0,
    left: 0,
    right: 0,
    height: 64,
    // iOS 安全区域适配
    paddingBottom: "max(8px, env(safe-area-inset-bottom))",
    paddingLeft: "env(safe-area-inset-left)",
    paddingRight: "env(safe-area-inset-right)",
    background: "rgba(7, 10, 18, 0.92)",
    backdropFilter: "blur(24px)",
    WebkitBackdropFilter: "blur(24px)",
    borderTop: `1px solid ${colors.border.default}`,
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr)",
    alignItems: "center",
    justifyItems: "center",
    zIndex: 100,
    boxSizing: "content-box",
  },
  topGlow: {
    position: "absolute",
    top: 0,
    left: "20%",
    right: "20%",
    height: 1,
    background: `linear-gradient(90deg, transparent 0%, ${colors.accent.primary}30 50%, transparent 100%)`,
  },
  item: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 48,
    height: 48,
    background: "transparent",
    border: "none",
    borderRadius: radius.md,
    cursor: "pointer",
    transition: `all ${animation.duration.fast} ${animation.easing.default}`,
  },
  itemActive: {
    background: "rgba(59, 130, 246, 0.1)",
  },
  itemSpecial: {
    width: 52,
    height: 52,
    marginTop: -16,
    background: `linear-gradient(135deg, ${colors.accent.primary} 0%, ${colors.accent.hover} 100%)`,
    borderRadius: radius.lg,
    boxShadow: `0 4px 20px ${colors.accent.glow}`,
    border: `2px solid rgba(255,255,255,0.1)`,
  },
  itemSpecialActive: {
    width: 52,
    height: 52,
    marginTop: -16,
    background: `linear-gradient(135deg, ${colors.accent.hover} 0%, ${colors.accent.active} 100%)`,
    borderRadius: radius.lg,
    boxShadow: `0 6px 28px ${colors.accent.glowStrong}`,
    border: `2px solid rgba(255,255,255,0.15)`,
  },
  activeIndicator: {
    position: "absolute",
    bottom: 4,
    left: "50%",
    transform: "translateX(-50%)",
    width: 4,
    height: 4,
    borderRadius: "50%",
    background: colors.accent.primary,
    boxShadow: `0 0 8px ${colors.accent.primary}`,
  },
};

export { styles as bottomNavStyles };
