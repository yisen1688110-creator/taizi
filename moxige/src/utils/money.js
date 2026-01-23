// 统一的货币与数字格式化工具，确保波兰语界面 PLN 显示为 zł
export function localeFromLang(lang) {
  return lang === "pl" ? "pl-PL" : (lang === "zh" ? "zh-CN" : "en-US");
}

export function formatPLN(amount, lang = "en") {
  try {
    const locale = localeFromLang(lang);
    const formatted = new Intl.NumberFormat(locale, {
      style: "decimal",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(amount || 0));
    return `${formatted} zł`;
  } catch (_) {
    return `${Number(amount || 0).toFixed(2)} zł`;
  }
}

export function formatUSDT(amount, lang = "en") {
  // USDT 与 USD 1:1，按货币符号前置格式化
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
    if (String(currency).toUpperCase() === "PLN") {
      return formatPLN(amount, lang);
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
