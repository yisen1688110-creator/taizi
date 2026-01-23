import { colors, radius, typography, animation, table as tableTokens } from "../../styles/tokens.js";

/**
 * DataTable - 终端风格数据表格
 * 细分隔线、对齐、tabular-nums、红绿涨跌
 */
export default function DataTable({ 
  columns = [], // [{ key, label, align?, width?, render? }]
  data = [],
  onRowClick,
  loading = false,
  emptyText = "--",
  compact = false,
  style = {},
}) {
  const cellPadding = compact ? "8px 12px" : "12px 16px";

  return (
    <div style={{ ...styles.wrapper, ...style }}>
      <table style={styles.table}>
        <thead>
          <tr style={styles.headerRow}>
            {columns.map((col) => (
              <th 
                key={col.key} 
                style={{
                  ...styles.th,
                  textAlign: col.align || "left",
                  width: col.width || "auto",
                  padding: cellPadding,
                }}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length} style={{ ...styles.td, textAlign: "center", padding: "32px 16px" }}>
                <span style={styles.spinner} />
              </td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} style={{ ...styles.td, textAlign: "center", padding: "32px 16px", color: colors.text.muted }}>
                {emptyText}
              </td>
            </tr>
          ) : (
            data.map((row, idx) => (
              <tr 
                key={row.id || row.key || idx}
                style={styles.row}
                onClick={() => onRowClick?.(row)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = tableTokens.rowHoverBg;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                {columns.map((col) => (
                  <td 
                    key={col.key}
                    style={{
                      ...styles.td,
                      textAlign: col.align || "left",
                      padding: cellPadding,
                      ...(col.numeric ? styles.numeric : {}),
                    }}
                  >
                    {col.render ? col.render(row[col.key], row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 涨跌幅单元格渲染器
 */
export function ChangeCell({ value, suffix = "%" }) {
  const num = Number(value) || 0;
  const isPositive = num >= 0;
  const color = isPositive ? colors.success : colors.danger;
  const sign = isPositive ? "+" : "";
  
  return (
    <span style={{ 
      color, 
      fontFamily: typography.fontMono,
      fontFeatureSettings: "'tnum' on, 'lnum' on",
      fontWeight: typography.weight.medium,
    }}>
      {sign}{num.toFixed(2)}{suffix}
    </span>
  );
}

/**
 * 价格单元格渲染器
 */
export function PriceCell({ value, currency = "USD", decimals = 2 }) {
  const num = Number(value) || 0;
  const formatted = num.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  
  const symbols = { USD: "$", PLN: "zł", USDT: "₮" };
  const symbol = symbols[currency] || "";
  
  return (
    <span style={{ 
      fontFamily: typography.fontMono,
      fontFeatureSettings: "'tnum' on, 'lnum' on",
      color: colors.text.primary,
    }}>
      {currency === "PLN" ? `${formatted} ${symbol}` : `${symbol}${formatted}`}
    </span>
  );
}

/**
 * Symbol 单元格渲染器
 */
export function SymbolCell({ symbol, name }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ 
        fontWeight: typography.weight.semibold, 
        color: colors.text.primary,
        fontSize: typography.size.sm,
      }}>
        {symbol}
      </span>
      {name && (
        <span style={{ 
          fontSize: typography.size.xs, 
          color: colors.text.tertiary,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: 120,
        }}>
          {name}
        </span>
      )}
    </div>
  );
}

const styles = {
  wrapper: {
    width: "100%",
    overflowX: "auto",
    WebkitOverflowScrolling: "touch",
    // 移动端隐藏滚动条但保留功能
    scrollbarWidth: "none",
    msOverflowStyle: "none",
  },
  table: {
    width: "100%",
    minWidth: "100%", // 移动端不强制最小宽度
    borderCollapse: "collapse",
    borderSpacing: 0,
    fontFamily: typography.fontFamily,
    fontSize: tableTokens.cellFontSize,
    tableLayout: "fixed", // 固定布局，防止溢出
  },
  headerRow: {
    background: tableTokens.headerBg,
  },
  th: {
    fontWeight: tableTokens.headerFontWeight,
    fontSize: tableTokens.headerFontSize,
    color: tableTokens.headerColor,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    borderBottom: `1px solid ${colors.border.default}`,
    whiteSpace: "nowrap",
  },
  row: {
    borderBottom: `1px solid ${colors.border.subtle}`,
    cursor: "pointer",
    transition: `background ${animation.duration.fast} ${animation.easing.default}`,
  },
  td: {
    color: colors.text.secondary,
    verticalAlign: "middle",
  },
  numeric: {
    fontFamily: tableTokens.numericFont,
    fontFeatureSettings: tableTokens.numericFontFeature,
  },
  spinner: {
    display: "inline-block",
    width: 20,
    height: 20,
    border: `2px solid ${colors.border.default}`,
    borderTopColor: colors.accent.primary,
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
};

export { styles as dataTableStyles };
