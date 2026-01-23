import { colors, radius, shadows, animation, glassCard } from "../../styles/tokens.js";

/**
 * PanelCard - 统一的 Glass 卡片组件
 * TradingView / Bloomberg Terminal Style
 */
export default function PanelCard({ 
  children, 
  title, 
  subtitle,
  action,
  padding = 20,
  glow = false,
  glowColor = colors.accent.glow,
  style = {},
  className = "",
  ...props 
}) {
  return (
    <div 
      style={{
        ...styles.card,
        padding,
        ...(glow ? { boxShadow: `${shadows.md}, 0 0 40px ${glowColor}` } : {}),
        ...style,
      }}
      className={className}
      {...props}
    >
      {/* 顶部发光边 */}
      <div style={styles.topGlow} />
      
      {/* 头部区域 */}
      {(title || action) && (
        <div style={styles.header}>
          <div style={styles.headerText}>
            {title && <h3 style={styles.title}>{title}</h3>}
            {subtitle && <p style={styles.subtitle}>{subtitle}</p>}
          </div>
          {action && <div style={styles.action}>{action}</div>}
        </div>
      )}
      
      {/* 内容区域 */}
      <div style={styles.content}>
        {children}
      </div>
    </div>
  );
}

const styles = {
  card: {
    position: "relative",
    background: "rgba(15, 23, 42, 0.6)",
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    border: `1px solid ${colors.border.default}`,
    borderRadius: radius.lg,
    overflow: "hidden",
    boxShadow: shadows.md,
    transition: `all ${animation.duration.normal} ${animation.easing.default}`,
  },
  topGlow: {
    position: "absolute",
    top: 0,
    left: "15%",
    right: "15%",
    height: 1,
    background: `linear-gradient(90deg, transparent 0%, ${colors.accent.primary}40 50%, transparent 100%)`,
    opacity: 0.6,
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 12,
    gap: 10,
    flexWrap: "wrap", // 移动端允许换行
  },
  headerText: {
    flex: 1,
  },
  title: {
    margin: 0,
    fontSize: 16,
    fontWeight: 600,
    color: colors.text.primary,
    letterSpacing: "-0.01em",
  },
  subtitle: {
    margin: "4px 0 0",
    fontSize: 12,
    color: colors.text.tertiary,
  },
  action: {
    flexShrink: 0,
  },
  content: {
    position: "relative",
  },
};

// 导出样式供外部使用
export { styles as panelCardStyles };
