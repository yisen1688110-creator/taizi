import { colors, typography, radius, animation } from "../../styles/tokens.js";
import { useI18n } from "../../i18n.jsx";

// ═══════════════════════════════════════════════════════════════════════════
// AuthShell - 登录/注册共用外壳组件
// TradingView / Bloomberg Terminal Style
// ═══════════════════════════════════════════════════════════════════════════

export default function AuthShell({ children, title, subtitle }) {
  const { lang } = useI18n();

  const t = {
    tagline: lang === "zh" ? "专业交易平台" : lang === "en" ? "Professional Trading" : "Profesjonalny Trading",
    security: lang === "zh" 
      ? "🔒 256位加密 · 资金安全保障 · 受监管平台" 
      : lang === "en" 
        ? "🔒 256-bit Encryption · Secure Funds · Regulated Platform"
        : "🔒 Szyfrowanie 256-bit · Bezpieczne Środki · Regulowana Platforma",
  };

  return (
    <div style={styles.container}>
      {/* 背景层 */}
      <div style={styles.bgBase} />
      <div style={styles.bgNoise} />
      <div style={styles.bgGlow} />
      <div style={styles.bgGrid} />

      {/* 主内容 */}
      <div style={styles.content}>
        {/* 品牌区域 */}
        <header style={styles.header}>
          <div style={styles.logoWrapper}>
            <div style={styles.logo}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                <polyline points="16 7 22 7 22 13" />
              </svg>
            </div>
            <div style={styles.brandText}>
              <span style={styles.brandName}>GQ Trade</span>
              <span style={styles.brandTagline}>{t.tagline}</span>
            </div>
          </div>
        </header>

        {/* Glass 卡片 */}
        <main style={styles.card}>
          {/* 卡片顶部发光边 */}
          <div style={styles.cardGlow} />
          
          {/* 卡片头部 */}
          {(title || subtitle) && (
            <div style={styles.cardHeader}>
              {title && <h1 style={styles.cardTitle}>{title}</h1>}
              {subtitle && <p style={styles.cardSubtitle}>{subtitle}</p>}
            </div>
          )}

          {/* 表单内容 */}
          <div style={styles.cardBody}>
            {children}
          </div>
        </main>

        {/* 底部安全提示 */}
        <footer style={styles.footer}>
          <p style={styles.securityText}>{t.security}</p>
        </footer>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════════════════════
const styles = {
  container: {
    position: "fixed",
    inset: 0,
    overflow: "auto",
    fontFamily: typography.fontFamily,
  },
  // 背景系统
  bgBase: {
    position: "fixed",
    inset: 0,
    background: `linear-gradient(160deg, ${colors.bg.primary} 0%, ${colors.bg.secondary} 40%, #0a1628 100%)`,
  },
  bgNoise: {
    position: "fixed",
    inset: 0,
    opacity: 0.018,
    backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
    pointerEvents: "none",
  },
  bgGlow: {
    position: "fixed",
    top: "-30%",
    left: "50%",
    transform: "translateX(-50%)",
    width: "140%",
    height: "60%",
    background: "radial-gradient(ellipse 50% 80% at 50% 20%, rgba(59, 130, 246, 0.08) 0%, transparent 70%)",
    pointerEvents: "none",
  },
  bgGrid: {
    position: "fixed",
    inset: 0,
    backgroundImage: `
      linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)
    `,
    backgroundSize: "48px 48px",
    pointerEvents: "none",
    maskImage: "radial-gradient(ellipse 80% 60% at 50% 30%, black 20%, transparent 70%)",
    WebkitMaskImage: "radial-gradient(ellipse 80% 60% at 50% 30%, black 20%, transparent 70%)",
  },
  // 内容区
  content: {
    position: "relative",
    zIndex: 1,
    minHeight: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "40px 20px",
    gap: 24,
  },
  // 品牌头部
  header: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  logoWrapper: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  logo: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    background: "linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(59, 130, 246, 0.05) 100%)",
    border: "1px solid rgba(59, 130, 246, 0.2)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#3b82f6",
    boxShadow: "0 0 24px rgba(59, 130, 246, 0.15)",
  },
  brandText: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  brandName: {
    fontSize: 22,
    fontWeight: typography.weight.bold,
    color: colors.text.primary,
    letterSpacing: "-0.02em",
  },
  brandTagline: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.normal,
    color: colors.text.tertiary,
    letterSpacing: "0.5px",
  },
  // Glass 卡片
  card: {
    position: "relative",
    width: "100%",
    maxWidth: 400,
    background: "rgba(13, 17, 23, 0.7)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    border: "1px solid rgba(255, 255, 255, 0.06)",
    borderRadius: radius.xl,
    overflow: "hidden",
    boxShadow: `
      0 0 0 1px rgba(255,255,255,0.03),
      0 20px 50px -12px rgba(0, 0, 0, 0.5),
      0 0 80px -20px rgba(59, 130, 246, 0.1)
    `,
  },
  cardGlow: {
    position: "absolute",
    top: 0,
    left: "10%",
    right: "10%",
    height: 1,
    background: "linear-gradient(90deg, transparent 0%, rgba(59, 130, 246, 0.4) 50%, transparent 100%)",
  },
  cardHeader: {
    padding: "28px 28px 0",
    textAlign: "center",
  },
  cardTitle: {
    fontSize: 24,
    fontWeight: typography.weight.bold,
    color: colors.text.primary,
    margin: 0,
    letterSpacing: "-0.02em",
  },
  cardSubtitle: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.normal,
    color: colors.text.tertiary,
    margin: "8px 0 0",
  },
  cardBody: {
    padding: 28,
  },
  // 底部
  footer: {
    textAlign: "center",
    maxWidth: 360,
  },
  securityText: {
    fontSize: typography.size.xs,
    color: colors.text.muted,
    margin: 0,
    lineHeight: 1.5,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// 导出输入框和按钮样式供子组件使用
// ═══════════════════════════════════════════════════════════════════════════
export const authInputStyles = {
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    display: "block",
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
    color: colors.text.secondary,
    marginBottom: 8,
  },
  input: {
    width: "100%",
    height: 48,
    padding: "0 16px",
    fontSize: typography.size.md,
    fontFamily: typography.fontFamily,
    color: colors.text.primary,
    background: "rgba(255, 255, 255, 0.03)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: radius.md,
    outline: "none",
    boxSizing: "border-box",
    transition: `all ${animation.duration.fast} ease`,
  },
  inputFocus: {
    borderColor: "rgba(59, 130, 246, 0.5)",
    background: "rgba(255, 255, 255, 0.05)",
    boxShadow: "0 0 0 3px rgba(59, 130, 246, 0.1)",
  },
  inputError: {
    borderColor: "rgba(239, 68, 68, 0.5)",
    boxShadow: "0 0 0 3px rgba(239, 68, 68, 0.1)",
  },
  error: {
    fontSize: typography.size.xs,
    color: "#f87171",
    marginTop: 6,
    marginBottom: 12,
  },
  primaryBtn: {
    width: "100%",
    height: 50,
    marginTop: 8,
    padding: "0 24px",
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
    fontFamily: typography.fontFamily,
    color: "#ffffff",
    background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
    border: "none",
    borderRadius: radius.md,
    cursor: "pointer",
    boxShadow: "0 4px 24px rgba(59, 130, 246, 0.25), inset 0 1px 0 rgba(255,255,255,0.1)",
    transition: `all ${animation.duration.fast} ease`,
    position: "relative",
    overflow: "hidden",
  },
  primaryBtnHover: {
    transform: "translateY(-1px)",
    boxShadow: "0 6px 28px rgba(59, 130, 246, 0.35), inset 0 1px 0 rgba(255,255,255,0.1)",
  },
  primaryBtnActive: {
    transform: "translateY(0)",
    boxShadow: "0 2px 16px rgba(59, 130, 246, 0.2), inset 0 1px 0 rgba(255,255,255,0.1)",
  },
  secondaryBtn: {
    width: "100%",
    height: 46,
    marginTop: 12,
    padding: "0 24px",
    fontSize: typography.size.base,
    fontWeight: typography.weight.medium,
    fontFamily: typography.fontFamily,
    color: colors.text.secondary,
    background: "transparent",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: radius.md,
    cursor: "pointer",
    transition: `all ${animation.duration.fast} ease`,
  },
  linkText: {
    display: "block",
    textAlign: "center",
    marginTop: 20,
    fontSize: typography.size.sm,
    color: colors.text.tertiary,
  },
  link: {
    color: "#60a5fa",
    textDecoration: "none",
    fontWeight: typography.weight.medium,
    marginLeft: 4,
    cursor: "pointer",
  },
  divider: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    margin: "20px 0",
  },
  dividerLine: {
    flex: 1,
    height: 1,
    background: "rgba(255, 255, 255, 0.06)",
  },
  dividerText: {
    fontSize: typography.size.xs,
    color: colors.text.muted,
    textTransform: "uppercase",
    letterSpacing: "1px",
  },
};
