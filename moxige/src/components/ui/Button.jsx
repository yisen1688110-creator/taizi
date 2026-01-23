import { colors, radius, typography, animation, shadows } from "../../styles/tokens.js";

/**
 * PrimaryButton - 主要操作按钮
 * 蓝色渐变 + 发光效果
 */
export function PrimaryButton({ 
  children, 
  onClick, 
  disabled = false,
  loading = false,
  fullWidth = false,
  size = "md", // sm | md | lg
  style = {},
  ...props 
}) {
  const sizeStyles = {
    sm: { height: 36, fontSize: 13, padding: "0 16px" },
    md: { height: 44, fontSize: 14, padding: "0 20px" },
    lg: { height: 50, fontSize: 15, padding: "0 28px" },
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        ...styles.primary,
        ...sizeStyles[size],
        width: fullWidth ? "100%" : "auto",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.target.style.transform = "translateY(-1px)";
          e.target.style.boxShadow = `0 6px 28px ${colors.accent.glowStrong}, inset 0 1px 0 rgba(255,255,255,0.15)`;
        }
      }}
      onMouseLeave={(e) => {
        e.target.style.transform = "translateY(0)";
        e.target.style.boxShadow = styles.primary.boxShadow;
      }}
      onMouseDown={(e) => {
        if (!disabled) {
          e.target.style.transform = "translateY(0) scale(0.98)";
        }
      }}
      onMouseUp={(e) => {
        if (!disabled) {
          e.target.style.transform = "translateY(-1px)";
        }
      }}
      {...props}
    >
      {loading ? (
        <span style={styles.spinner} />
      ) : (
        children
      )}
    </button>
  );
}

/**
 * SecondaryButton - 次要操作按钮
 * Glass 风格边框按钮
 */
export function SecondaryButton({ 
  children, 
  onClick, 
  disabled = false,
  loading = false,
  fullWidth = false,
  size = "md",
  style = {},
  ...props 
}) {
  const sizeStyles = {
    sm: { height: 34, fontSize: 12, padding: "0 14px" },
    md: { height: 42, fontSize: 13, padding: "0 18px" },
    lg: { height: 48, fontSize: 14, padding: "0 24px" },
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        ...styles.secondary,
        ...sizeStyles[size],
        width: fullWidth ? "100%" : "auto",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.target.style.background = "rgba(255,255,255,0.08)";
          e.target.style.borderColor = colors.border.active;
        }
      }}
      onMouseLeave={(e) => {
        e.target.style.background = styles.secondary.background;
        e.target.style.borderColor = colors.border.hover;
      }}
      {...props}
    >
      {loading ? (
        <span style={styles.spinner} />
      ) : (
        children
      )}
    </button>
  );
}

/**
 * GhostButton - 幽灵按钮
 * 无背景，仅文字
 */
export function GhostButton({ 
  children, 
  onClick, 
  disabled = false,
  color = colors.accent.primary,
  size = "md",
  style = {},
  ...props 
}) {
  const sizeStyles = {
    sm: { height: 32, fontSize: 12, padding: "0 12px" },
    md: { height: 38, fontSize: 13, padding: "0 16px" },
    lg: { height: 44, fontSize: 14, padding: "0 20px" },
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...styles.ghost,
        ...sizeStyles[size],
        color,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.target.style.background = "rgba(255,255,255,0.05)";
        }
      }}
      onMouseLeave={(e) => {
        e.target.style.background = "transparent";
      }}
      {...props}
    >
      {children}
    </button>
  );
}

const styles = {
  primary: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    border: "none",
    borderRadius: radius.md,
    fontFamily: typography.fontFamily,
    fontWeight: typography.weight.semibold,
    color: "#ffffff",
    background: `linear-gradient(135deg, ${colors.accent.primary} 0%, ${colors.accent.hover} 100%)`,
    boxShadow: `0 4px 24px ${colors.accent.glow}, inset 0 1px 0 rgba(255,255,255,0.1)`,
    transition: `all ${animation.duration.fast} ${animation.easing.default}`,
    position: "relative",
    overflow: "hidden",
  },
  secondary: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    background: "rgba(255,255,255,0.04)",
    border: `1px solid ${colors.border.hover}`,
    borderRadius: radius.md,
    fontFamily: typography.fontFamily,
    fontWeight: typography.weight.medium,
    color: colors.text.secondary,
    transition: `all ${animation.duration.fast} ${animation.easing.default}`,
  },
  ghost: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    background: "transparent",
    border: "none",
    borderRadius: radius.sm,
    fontFamily: typography.fontFamily,
    fontWeight: typography.weight.medium,
    transition: `all ${animation.duration.fast} ${animation.easing.default}`,
  },
  spinner: {
    width: 16,
    height: 16,
    border: "2px solid rgba(255,255,255,0.3)",
    borderTopColor: "#fff",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
};

// 导出默认组件
export default { PrimaryButton, SecondaryButton, GhostButton };
