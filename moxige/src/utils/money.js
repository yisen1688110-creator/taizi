// 统一的货币与数字格式化工具，确保西语界面 MXN 显示为 MX$
export function localeFromLang(lang) {
  return lang === "es" ? "es-MX" : "en-US";
}

export function formatMXN(amount, lang = "en") {
  try {
    const locale = localeFromLang(lang);
    const formatted = new Intl.NumberFormat(locale, {
      style: "decimal",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(amount || 0));
    return `MX$${formatted}`;
  } catch (_) {
    return `MX$${Number(amount || 0).toFixed(2)}`;
  }
}

export function formatUSDT(amount, lang = "en") {
  // USDT 与 USD 1:1，按货币符号前置格式化，为西语显示为 "US$" 前缀
  try {
    return formatMoney(amount, "USD", lang);
  } catch (_) {
    const n = Number(amount || 0);
    return `US$${Number.isFinite(n) ? n.toFixed(2) : "0.00"}`;
  }
}

export function formatMoney(amount, currency = "USD", lang = "en") {
  const locale = localeFromLang(lang);
  try {
    if (String(currency).toUpperCase() === "MXN") {
      return formatMXN(amount, lang);
    }
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "symbol",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(amount || 0));
  } catch (_) {
    return `${amount} ${currency}`;
  }
}

export function formatNumber(n, lang = "en") {
  const locale = localeFromLang(lang);
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Number(n || 0));
  } catch (_) {
    return String(n);
  }
}