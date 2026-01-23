import { colors, radius, typography, animation } from "../../styles/tokens.js";

/**
 * SegmentedTabs - 分段选择器
 * 用于 "按成交量 / 按涨幅" 等切换
 */
export default function SegmentedTabs({ 
  options = [], // [{ key: string, label: string }]
  value,
  onChange,
  size = "md", // sm | md
  style = {},
}) {
  const sizeStyles = {
    sm: { 
      height: 28, 
      fontSize: 11, 
      padding: "0 10px",
      gap: 2,
      containerPadding: 2,
    },
    md: { 
      height: 32, 
      fontSize: 12, 
      padding: "0 14px",
      gap: 2,
      containerPadding: 3,
    },
  };

  const s = sizeStyles[size];

  return (
    <div style={{ ...styles.container, padding: s.containerPadding, gap: s.gap, ...style }}>
      {options.map((opt) => {
        const isActive = opt.key === value;
        return (
          <button
            key={opt.key}
            onClick={() => onChange?.(opt.key)}
            style={{
              ...styles.tab,
              height: s.height - s.containerPadding * 2,
              fontSize: s.fontSize,
              padding: s.padding,
              ...(isActive ? styles.tabActive : {}),
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.target.style.background = "rgba(255,255,255,0.06)";
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.target.style.background = "transparent";
              }
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

const styles = {
  container: {
    display: "inline-flex",
    alignItems: "center",
    background: "rgba(255,255,255,0.04)",
    border: `1px solid ${colors.border.default}`,
    borderRadius: radius.md,
  },
  tab: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "transparent",
    border: "none",
    borderRadius: radius.sm,
    fontFamily: typography.fontFamily,
    fontWeight: typography.weight.medium,
    color: colors.text.tertiary,
    cursor: "pointer",
    transition: `all ${animation.duration.fast} ${animation.easing.default}`,
    whiteSpace: "nowrap",
  },
  tabActive: {
    background: colors.accent.primary,
    color: "#ffffff",
    boxShadow: `0 2px 8px ${colors.accent.glow}`,
  },
};

export { styles as segmentedTabsStyles };
