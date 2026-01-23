// ═══════════════════════════════════════════════════════════════════════════
// Design Tokens - TradingView / Bloomberg Style
// ═══════════════════════════════════════════════════════════════════════════

// 基础色板
export const colors = {
  // 背景系统 - 深蓝黑
  bg: {
    primary: "#0b0e14",
    secondary: "#0d1117", 
    tertiary: "#161b22",
    elevated: "#1c2128",
  },
  
  // 文字系统
  text: {
    primary: "#e6edf3",
    secondary: "#8b949e",
    tertiary: "#6e7681",
    muted: "#484f58",
  },
  
  // 边框系统
  border: {
    default: "rgba(255,255,255,0.06)",
    subtle: "rgba(255,255,255,0.04)",
    hover: "rgba(255,255,255,0.12)",
    active: "rgba(255,255,255,0.16)",
  },
  
  // Glass 系统
  glass: {
    bg: "rgba(255,255,255,0.03)",
    bgHover: "rgba(255,255,255,0.05)",
    bgActive: "rgba(255,255,255,0.07)",
    border: "rgba(255,255,255,0.06)",
    borderHover: "rgba(255,255,255,0.10)",
  },
};

// 市场主题 Accent 色 - 仅用于点缀和发光
export const marketThemes = {
  poland: {
    id: "poland",
    accent: "#f43f5e",        // Rose 红
    accentRgb: "244, 63, 94",
    accentMuted: "#be123c",
    glow: "rgba(244, 63, 94, 0.25)",
    glowStrong: "rgba(244, 63, 94, 0.4)",
  },
  usa: {
    id: "usa",
    accent: "#3b82f6",        // Blue 蓝
    accentRgb: "59, 130, 246",
    accentMuted: "#2563eb",
    glow: "rgba(59, 130, 246, 0.25)",
    glowStrong: "rgba(59, 130, 246, 0.4)",
  },
  crypto: {
    id: "crypto",
    accent: "#a78bfa",        // Violet 紫
    accentRgb: "167, 139, 250",
    accentMuted: "#8b5cf6",
    glow: "rgba(167, 139, 250, 0.25)",
    glowStrong: "rgba(167, 139, 250, 0.4)",
  },
  cta: {
    id: "cta",
    accent: "#10b981",        // Emerald 绿
    accentRgb: "16, 185, 129",
    accentMuted: "#059669",
    glow: "rgba(16, 185, 129, 0.25)",
    glowStrong: "rgba(16, 185, 129, 0.4)",
  },
};

// 间距系统
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

// 圆角系统
export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 18,
  full: 9999,
};

// 字体系统
export const typography = {
  fontFamily: "'SF Pro Display', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  fontMono: "'SF Mono', 'Fira Code', monospace",
  
  // 字重
  weight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
    heavy: 800,
  },
  
  // 字号
  size: {
    xs: 11,
    sm: 12,
    base: 13,
    md: 14,
    lg: 16,
    xl: 20,
    xxl: 28,
    display: 36,
  },
};

// 动画系统
export const animation = {
  duration: {
    fast: "150ms",
    normal: "250ms",
    slow: "350ms",
    slower: "500ms",
  },
  easing: {
    default: "cubic-bezier(0.4, 0, 0.2, 1)",
    spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
    smooth: "cubic-bezier(0.4, 0, 0.6, 1)",
  },
};

// 阴影系统
export const shadows = {
  sm: "0 2px 8px rgba(0,0,0,0.3)",
  md: "0 4px 16px rgba(0,0,0,0.4)",
  lg: "0 8px 32px rgba(0,0,0,0.5)",
  glow: (color) => `0 0 24px ${color}`,
  glowStrong: (color) => `0 0 48px ${color}`,
};

// Glass Card 预设
export const glassCard = {
  background: colors.glass.bg,
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  border: `1px solid ${colors.glass.border}`,
  borderRadius: radius.lg,
};

// Badge 预设
export const badge = {
  background: "rgba(255,255,255,0.04)",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: radius.full,
  padding: "6px 14px",
};

// 按钮预设
export const buttons = {
  primary: {
    height: 48,
    borderRadius: radius.md,
    fontWeight: typography.weight.semibold,
    fontSize: typography.size.md,
  },
  secondary: {
    height: 44,
    borderRadius: radius.md,
    fontWeight: typography.weight.medium,
    fontSize: typography.size.base,
  },
};

export default {
  colors,
  marketThemes,
  spacing,
  radius,
  typography,
  animation,
  shadows,
  glassCard,
  badge,
  buttons,
};
