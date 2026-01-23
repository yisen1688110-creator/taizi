// Unified market data service with provider selection and graceful fallback.
// Supports: Twelve Data (VITE_TWELVEDATA_KEY), FMP (optional, free demo), Finnhub (VITE_FINNHUB_TOKEN, partial), Custom Index API (VITE_INDEX_API_BASE).
// Behavior: show real-time when market is open; show last close when closed.

const TD_BASE = "https://api.twelvedata.com";
const AV_BASE = "https://www.alphavantage.co/query";
import yahooFinance from "./yahooFinanceService.js";
// const YF_BASE = "https://query1.finance.yahoo.com"; // via yahooFinance service as last resort
const TD_SYM_MAP_US = { "BRK-B": "BRK.B", "BRK-A": "BRK.A" };
const TD_SYM_MAP_PL = { "PKO": "PKO", "PKN": "PKN", "PZU": "PZU", "KGH": "KGH", "CDR": "CDR" };
// Common index symbol mapping to Twelve Data equivalents (best-effort)
// Warning: Mapping ^GSPC->SPX on Twelve Data returns ETF, not the index.
// Keep mappings here for sparkline-only use; getQuotes will avoid TD for indices.
const TD_SYM_MAP_INDEX = { "^DJI": "DJI", "^IXIC": "IXIC", "^WIG20": "WIG20" };
// Canonical index names to display (override provider name when ambiguous)
const INDEX_NAME_MAP = {
  "^GSPC": "S&P 500",
  "^DJI": "Dow Jones Industrial Average",
  "^IXIC": "Nasdaq Composite",
  "^WIG20": "WIG20",
};
const TD_CACHE_TTL_MS = (() => {
  const env = Number(import.meta.env?.VITE_TD_CACHE_TTL_MS || "");
  // Default 15s cache to avoid 8 req/min limit on free tier
  return Number.isFinite(env) && env > 0 ? env : 15 * 1000;
})();
const TD_CACHE_TTL_PL_MS = (() => {
  const env = Number(import.meta.env?.VITE_TD_CACHE_TTL_PL_MS || "");
  // Default 15s cache for PL as well
  return Number.isFinite(env) && env > 0 ? env : 15 * 1000;
})();
const TD_BATCH_SIZE = (() => {
  const v = Number(import.meta.env.VITE_TD_BATCH_SIZE || 10);
  return Number.isFinite(v) && v > 0 ? v : 10;
})();
const TD_GROUP_DELAY_MS = (() => {
  const v = Number(import.meta.env.VITE_TD_GROUP_DELAY_MS || 0);
  return Number.isFinite(v) && v >= 0 ? v : 0;
})();
// Controlled debug logging (enable via VITE_DEBUG_LOG=1 or localStorage 'debug:market'='1')
const DEBUG_LOG = (() => {
  try {
    const env = String(import.meta.env?.VITE_DEBUG_LOG || "").trim();
    const ls = String(localStorage.getItem("debug:market") || "").trim();
    return env === "1" || ls === "1";
  } catch { return false; }
})();
const LOG = (...args) => { try { console.log(...args); } catch { } };
// Yahoo/AlphaVantage 回退关闭：统一 TwelveData
const ENABLE_YF = false;
const PREFER_YF_MX = false;
// Optional: force XWAR for MX quotes (test path for intraday reliability)
const FORCE_XWAR = (() => {
  try {
    const env = String(import.meta.env?.VITE_FORCE_XWAR || "").trim();
    const ls = String(localStorage.getItem("force:xmex") || "").trim();
    return env === "1" || ls === "1";
  } catch { return false; }
})();

function has(key) {
  try { return typeof import.meta.env[key] !== "undefined" && !!import.meta.env[key]; } catch { return false; }
}

function getTDKey() {
  // Hardcoded override from user request
  const hardcoded = "030bb2a756eb4c9892ff99a1482ca77d";
  if (hardcoded) return hardcoded;

  // Env candidates
  try {
    const envKey =
      import.meta.env.VITE_TWELVEDATA_KEY ||
      import.meta.env.VITE_TWELVE_DATA_KEY ||
      import.meta.env.VITE_TD_KEY ||
      import.meta.env.VITE_TD_KEY_OVERRIDE;
    if (envKey) return envKey;
  } catch { }
  // Server-injected window variable
  try {
    const w = typeof window !== 'undefined' ? window : undefined;
    const k = w && w.__TD_KEY__ ? String(w.__TD_KEY__).trim() : '';
    if (k) return k;
  } catch { }
  // Server-injected meta tag
  try {
    const m = typeof document !== 'undefined' ? document.querySelector('meta[name="td-key"]') : null;
    const c = m && m.getAttribute('content') ? String(m.getAttribute('content')).trim() : '';
    if (c) return c;
  } catch { }
  // Cookie
  try {
    const m = (typeof document !== 'undefined' ? document.cookie : '') || '';
    const match = m.match(/(?:^|; )td_key=([^;]+)/);
    const v = match ? decodeURIComponent(match[1]) : '';
    if (v) return v;
  } catch { }
  // URL query param
  try {
    const loc = typeof window !== 'undefined' ? window.location : undefined;
    const qs = loc && loc.search ? String(loc.search) : '';
    if (qs) {
      const p = new URLSearchParams(qs);
      const v = String(p.get('tdkey') || '').trim();
      if (v) {
        try { localStorage.setItem('td:key', v); } catch { }
        return v;
      }
    }
  } catch { }
  // LocalStorage candidates
  try {
    const lsKey =
      localStorage.getItem("td:key") ||
      localStorage.getItem("VITE_TWELVEDATA_KEY") ||
      localStorage.getItem("VITE_TWELVE_DATA_KEY") ||
      localStorage.getItem("VITE_TD_KEY") ||
      localStorage.getItem("VITE_TD_KEY_OVERRIDE");
    if (lsKey) return lsKey;
  } catch { }
  return undefined;
}

function getAVKey() {
  // Env candidates
  try {
    const envKey =
      import.meta.env.VITE_ALPHAVANTAGE_KEY ||
      import.meta.env.VITE_AV_KEY;
    if (envKey) return envKey;
  } catch { }
  // LocalStorage candidates
  try {
    const lsKey =
      localStorage.getItem("av:key") ||
      localStorage.getItem("VITE_ALPHAVANTAGE_KEY") ||
      localStorage.getItem("VITE_AV_KEY");
    if (lsKey) return lsKey;
  } catch { }
  return undefined;
}

function toNumber(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

function normalizeResult(r) {
  return {
    symbol: r.symbol,
    name: INDEX_NAME_MAP && INDEX_NAME_MAP[r.symbol] ? INDEX_NAME_MAP[r.symbol] : (r.name || r.shortName || r.symbol),
    // Prefer computed price passed by provider-specific adapters
    price: toNumber(r.price ?? r.regularMarketPrice ?? r.c ?? r.last ?? r.close ?? r.previous_close),
    changePct: toNumber(
      r.changePct ?? r.regularMarketChangePercent ?? r.dp ?? r.percent_change ?? r.changes_percentage
    ),
    volume: toNumber(r.volume ?? r.regularMarketVolume ?? r.total_volume ?? r.average_volume ?? r.v),
    // Optional metadata for UI/debugging
    provider: r.provider,
    exchange: r.exchange,
  };
}

function isIndexSymbol(s) { return String(s).startsWith("^"); }

// Custom Index API: prefer this for index symbols to avoid ETF mispricing from TD
// Expected base: VITE_INDEX_API_BASE (e.g. https://your-api.example.com)
// It should support either:
// - GET /quotes?symbols=^GSPC,^DJI,^IXIC returning array of quote objects
// - or GET /quote?symbol=^GSPC returning a single quote object
async function fetchCustomIndexQuotes(symbols) {
  const base = (() => {
    try { return import.meta.env.VITE_INDEX_API_BASE || localStorage.getItem("index:base"); } catch { return undefined; }
  })();
  if (!base) return [];
  const b = String(base).replace(/\/$/, "");
  // Try batch endpoint first
  try {
    const url = `${b}/quotes?symbols=${encodeURIComponent(symbols.join(','))}`;
    const res = await fetch(url);
    const json = await res.json();
    const arr = Array.isArray(json?.data) ? json.data : (Array.isArray(json?.quotes) ? json.quotes : (Array.isArray(json) ? json : []));
    if (Array.isArray(arr) && arr.length) {
      return arr.map((j) => normalizeResult({
        symbol: j.symbol || j.ticker || j.code,
        name: j.name || j.longName || j.shortName || INDEX_NAME_MAP[j.symbol] || j.symbol,
        price: j.price ?? j.last ?? j.close ?? j.regularMarketPrice,
        changePct: j.changePct ?? j.change_percent ?? j.changePercent ?? j.regularMarketChangePercent,
        volume: j.volume ?? j.regularMarketVolume,
      })).filter(Boolean);
    }
  } catch { }
  // Fallback: per-symbol endpoint
  const out = [];
  for (const sym of symbols) {
    try {
      const url = `${b}/quote?symbol=${encodeURIComponent(sym)}`;
      const res = await fetch(url);
      const j = await res.json();
      if (j && (typeof j === 'object')) {
        out.push(normalizeResult({
          symbol: j.symbol || sym,
          name: j.name || INDEX_NAME_MAP[sym] || sym,
          price: j.price ?? j.last ?? j.close ?? j.regularMarketPrice,
          changePct: j.changePct ?? j.change_percent ?? j.changePercent ?? j.regularMarketChangePercent,
          volume: j.volume ?? j.regularMarketVolume,
        }));
      }
    } catch { }
  }
  return out;
}

// Yahoo fallback removed due to reliability concerns and CORS issues.
// Note: Re-enable Yahoo as a last-resort fallback to avoid empty lists when
// other providers fail or have incomplete coverage, especially for MX tickers.

async function fetchTwelveDataQuotes(symbols, market) {
  const key = getTDKey();
  if (!key) throw new Error("TwelveData key missing");

  const isPL = market === "pl";
  const cacheTtl = isPL ? TD_CACHE_TTL_MX_MS : TD_CACHE_TTL_MS;
  const toTdSym = (s) => {
    let base = isPL ? s.replace(/\.WA$/, "") : s;
    // Avoid mapping index symbols here; indices handled by custom provider in getQuotes
    if (!isIndexSymbol(base) && TD_SYM_MAP_INDEX[base]) base = TD_SYM_MAP_INDEX[base];
    if (isPL && TD_SYM_MAP_PL[base]) base = TD_SYM_MAP_PL[base];
    if (!isPL && TD_SYM_MAP_US[base]) base = TD_SYM_MAP_US[base];
    return base;
  };
  const toBatchKey = (sym) => String(sym || "").toUpperCase();

  const now = Date.now();
  const cachedResults = [];
  const symbolsToQuery = [];
  const staleCache = new Map();
  for (const s of symbols) {
    try {
      const raw = localStorage.getItem(`td:${market}:${s}`);
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj?.data) staleCache.set(s, obj.data);
        if (now - (obj.ts || 0) < cacheTtl && obj.data) {
          cachedResults.push(obj.data);
          continue;
        }
      }
    } catch { }
    symbolsToQuery.push(s);
  }

  const buildBatchMap = async (group) => {
    if (!group.length) return null;
    const tdSymbols = group.map(toTdSym);
    const params = new URLSearchParams({ apikey: key, symbol: tdSymbols.join(",") });
    if (isPL) params.set("exchange", "WSE");
    const url = `${TD_BASE}/quote?${params.toString()}`;
    try {
      const res = await fetch(url);
      const json = await res.json();
      if (json?.code || json?.status === "error") {
        if (DEBUG_LOG) LOG("[TD] batch quote error", { market, code: json?.code, status: json?.status, message: json?.message });
        return { error: json };
      }
      let arr = [];
      if (Array.isArray(json?.data)) {
        arr = json.data;
      } else if (json && typeof json === 'object') {
        // Handle /quote batch response (Map of symbol -> quote) or single quote
        if (json.symbol) arr = [json];
        else arr = Object.values(json);
      }
      const map = new Map();
      for (const item of arr) {
        const k = toBatchKey(item?.symbol);
        if (k) map.set(k, item);
      }
      if (DEBUG_LOG) LOG("[TD] batch quote success", { market, size: map.size });
      return { map };
    } catch (err) {
      if (DEBUG_LOG) LOG("[TD] batch quote fetch fail", { market, err: String(err) });
      return { error: { message: String(err) } };
    }
  };

  let fetchedResults = [];
  if (symbolsToQuery.length) {
    const chunks = [];
    for (let i = 0; i < symbolsToQuery.length; i += TD_BATCH_SIZE) {
      chunks.push(symbolsToQuery.slice(i, i + TD_BATCH_SIZE));
    }
    for (const group of chunks) {
      const shouldBatchPrimary = !(isPL && FORCE_XWAR);
      const batch = shouldBatchPrimary ? await buildBatchMap(group) : null;

      const results = await Promise.all(group.map(async (orig) => {
        try {
          const tdSymbol = toTdSym(orig);
          const tdKey = toBatchKey(tdSymbol);
          if (DEBUG_LOG) LOG("[TD] quote start", { market, orig, tdSymbol });

          const validPrice = (obj) => {
            const p = toNumber(obj?.price ?? obj?.close ?? obj?.previous_close);
            return Number.isFinite(p) && p > 0;
          };
          const fetchQuoteWithParams = async (paramsInit = {}, symbolOverride) => {
            const params = new URLSearchParams({ apikey: key, symbol: symbolOverride || tdSymbol });
            Object.entries(paramsInit || {}).forEach(([k, v]) => {
              if (typeof v === "undefined" || v === null || v === "") return;
              params.set(k, v);
            });
            const url = `${TD_BASE}/quote?${params.toString()}`;
            const res = await fetch(url);
            return await res.json();
          };

          let j = null;
          let usedAltSymbol = false;

          if (isPL && FORCE_XWAR) {
            try {
              const jX = await fetchQuoteWithParams({ mic_code: "XWAR" });
              if (!!jX && !jX.code) j = jX;
              if (DEBUG_LOG) LOG("[TD] FORCE_XWAR attempt", { orig, tdSymbol, ok: !!j });
            } catch { }
          }

          if (!j) {
            if (batch?.map && batch.map.has(tdKey)) {
              j = batch.map.get(tdKey);
            } else if (!batch?.error && shouldBatchPrimary) {
              try {
                const params = isPL ? { exchange: "WSE" } : {};
                const jPrimary = await fetchQuoteWithParams(params);
                j = jPrimary;
              } catch (e) {
                if (DEBUG_LOG) LOG("[TD] primary fetch error", { market, orig, tdSymbol, err: String(e) });
              }
            } else if (!shouldBatchPrimary) {
              try {
                const params = isPL ? { exchange: "WSE" } : {};
                const jPrimary = await fetchQuoteWithParams(params);
                j = jPrimary;
              } catch (e) {
                if (DEBUG_LOG) LOG("[TD] primary fetch error", { market, orig, tdSymbol, err: String(e) });
              }
            }
          }

          const sourceCode = String(j?.mic_code || j?.exchange || "");
          const sourceUpper = sourceCode.toUpperCase();
          const isXmex = sourceUpper === "XWAR";

          // Helper: treat undefined/unknown as not-open to encourage XWAR fallback
          const isOpenTrue = (v) => String(v).toLowerCase() === "true" || v === true;
          const priceNum = toNumber(j?.price ?? j?.close ?? j?.previous_close);
          const prevNum = toNumber(j?.previous_close);
          const looksStale = (!Number.isFinite(priceNum) || priceNum <= 0 || (Number.isFinite(prevNum) && Math.abs(priceNum - prevNum) < 1e-9));

          if (j && isPL && !isXmex) {
            const isOpen = j?.is_market_open;
            const closedOrUnknown = !isOpenTrue(isOpen);
            // If WSE reports closed/unknown OR price equals previous_close, try XWAR for intraday
            if (closedOrUnknown || looksStale) {
              if (DEBUG_LOG) LOG("[TD] WSE closed/unknown or stale price, try XWAR", { orig, tdSymbol, is_open: j?.is_market_open, price: j?.price, previous_close: j?.previous_close });
              try {
                const j3 = await fetchQuoteWithParams({ mic_code: "XWAR" });
                if (validPrice(j3)) j = j3;
              } catch { }
            }
          }

          if ((!j || j.code || j.status === "error" || !validPrice(j)) && isPL) {
            if (DEBUG_LOG) LOG("[TD] WSE invalid, fallback XWAR", { orig, tdSymbol });
            try {
              const j3 = await fetchQuoteWithParams({ mic_code: "XWAR" });
              if (!!j3 && !j3.code) j = j3;
            } catch { }
          }
          if ((!j || j.code || j.status === "error" || !validPrice(j)) && isPL) {
            if (DEBUG_LOG) LOG("[TD] XWAR invalid, try no exchange", { orig, tdSymbol });
            try {
              const j2 = await fetchQuoteWithParams();
              if (!!j2 && !j2.code) j = j2;
            } catch { }
          }
          if ((!j || j.code || j.status === "error" || !validPrice(j)) && isPL && tdSymbol === "AMXL") {
            if (DEBUG_LOG) LOG("[TD] AMXL fallback -> AMXB", { orig });
            const tryAlt = async (params) => {
              try { return await fetchQuoteWithParams(params, "AMXB"); }
              catch { return null; }
            };
            let jj = await tryAlt({ exchange: "WSE" });
            if (!validPrice(jj)) jj = await tryAlt({ mic_code: "XWAR" });
            if (!validPrice(jj)) jj = await tryAlt({});
            if (jj && !jj.code) {
              usedAltSymbol = true;
              j = jj;
            }
          }

          if (!j || j.code || j.status === "error" || !validPrice(j)) {
            const fallback = staleCache.get(orig);
            if (fallback) return fallback;
            return null;
          }

          const finalSource = String(j?.mic_code || j?.exchange || "");
          const finalUpper = finalSource.toUpperCase();
          const finalXmex = finalUpper === "XWAR";
          const isOpen = j?.is_market_open;
          const closed = isOpen === false || String(isOpen).toLowerCase() === "false";
          const price = (isPL && finalXmex)
            ? (j.price ?? j.close ?? j.previous_close)
            : (closed ? (j.close ?? j.price ?? j.previous_close) : (j.price ?? j.close ?? j.previous_close));

          if (DEBUG_LOG) LOG("[TD] quote done", { market, orig, tdSymbol, exchange: finalSource, is_open: j?.is_market_open, price, usedAltSymbol });

          const norm = normalizeResult({
            symbol: orig,
            name: INDEX_NAME_MAP[orig] || j.name || j.symbol || (usedAltSymbol ? "América Móvil, S.A.B. de C.V." : orig),
            price,
            changePct: j.percent_change ?? j.changes_percentage,
            volume: j.volume ?? j.average_volume,
            provider: "twelve",
            exchange: finalSource,
          });
          if (isIndexSymbol(orig)) return null;
          try { localStorage.setItem(`td:${market}:${orig}`, JSON.stringify({ ts: now, data: norm })); } catch { }
          return norm;
        } catch (err) {
          if (DEBUG_LOG) LOG("[TD] quote exception", { market, symbol: orig, err: String(err) });
          const fallback = staleCache.get(orig);
          if (fallback) return fallback;
          return null;
        }
      }));

      fetchedResults.push(...results.filter(Boolean));
      if (TD_GROUP_DELAY_MS > 0) {
        await new Promise(r => setTimeout(r, TD_GROUP_DELAY_MS));
      }
    }
  }

  // Combine cache + fetched, preserving input order
  const bySymbol = new Map();
  for (const r of [...cachedResults, ...fetchedResults]) bySymbol.set(r.symbol, r);
  const out = symbols.map(s => bySymbol.get(s)).filter(Boolean);
  return out;
}

// Twelve Data price-only fallback for missing symbols (final resort without Yahoo)
async function fetchTwelveDataPrices(symbols, market) {
  const key = getTDKey();
  if (!key) throw new Error("TwelveData key missing");
  const isPL = market === "pl";
  const toTdSym = (s) => {
    let base = isPL ? s.replace(/\.WA$/, "") : s;
    if (TD_SYM_MAP_INDEX[base]) base = TD_SYM_MAP_INDEX[base];
    if (isPL && TD_SYM_MAP_PL[base]) base = TD_SYM_MAP_PL[base];
    if (!isPL && TD_SYM_MAP_US[base]) base = TD_SYM_MAP_US[base];
    return base;
  };

  const out = [];
  for (const orig of symbols) {
    try {
      const tdSymbol = toTdSym(orig);
      let j = null;
      // Try exchange=WSE first
      try {
        const params = new URLSearchParams({ apikey: key, symbol: tdSymbol });
        if (isPL) params.set("exchange", "WSE");
        const url = `${TD_BASE}/price?${params.toString()}`;
        const res = await fetch(url);
        j = await res.json();
      } catch (e) {
        if (DEBUG_LOG) LOG("[TD] WSE price fetch error", { orig, tdSymbol, err: String(e) });
        j = null;
      }
      const validPrice = (obj) => {
        const p = toNumber(obj?.price ?? obj?.close ?? obj?.previous_close);
        return Number.isFinite(p) && p > 0;
      };
      if ((!j || j.code || j.status === "error" || !validPrice(j)) && isPL) {
        // Retry with mic_code=XWAR
        try {
          const params3 = new URLSearchParams({ apikey: key, symbol: tdSymbol });
          params3.set("mic_code", "XWAR");
          const url3 = `${TD_BASE}/price?${params3.toString()}`;
          const res3 = await fetch(url3);
          const j3 = await res3.json();
          j = j3;
        } catch { }
      }
      if ((!j || j.code || j.status === "error" || !validPrice(j)) && isPL) {
        // Final retry without exchange
        try {
          const params2 = new URLSearchParams({ apikey: key, symbol: tdSymbol });
          const url2 = `${TD_BASE}/price?${params2.toString()}`;
          const res2 = await fetch(url2);
          const j2 = await res2.json();
          j = j2;
        } catch { }
      }
      // Symbol-level fallback: AMXL -> AMXB
      if ((!j || j.code || j.status === "error" || !validPrice(j)) && isPL && tdSymbol === "AMXL") {
        try {
          const tryFetch = async (paramsInit) => {
            const params = new URLSearchParams(paramsInit);
            const url = `${TD_BASE}/price?${params.toString()}`;
            const res = await fetch(url);
            return await res.json();
          };
          let jj = await tryFetch({ apikey: key, symbol: "AMXB", exchange: "WSE" });
          if (!validPrice(jj)) jj = await tryFetch({ apikey: key, symbol: "AMXB", mic_code: "XWAR" });
          if (!validPrice(jj)) jj = await tryFetch({ apikey: key, symbol: "AMXB" });
          j = jj;
        } catch { }
      }
      const price = toNumber(j?.price ?? j?.close ?? j?.previous_close);
      if (Number.isFinite(price) && price > 0) {
        out.push(normalizeResult({ symbol: orig, name: orig, price, changePct: 0, volume: 0 }));
      }
    } catch { }
  }
  return out;
}

// Crypto quotes via Twelve Data. Symbols are bases like ["BTC","ETH"].
async function fetchTwelveDataCryptoQuotes(symbols) {
  const key = getTDKey();
  const DISABLE_TD_CRYPTO = (() => {
    try {
      const env = String(import.meta.env?.VITE_DISABLE_TD_CRYPTO || "").trim();
      const ls = String(localStorage.getItem("disable:td:crypto") || "").trim();
      if (env === "1" || ls === "1") return true;
      if (!key) return true;
      const fail = JSON.parse(localStorage.getItem("td:crypto:fail") || "null");
      if (fail && Number(fail.count || 0) >= 3 && Date.now() - Number(fail.ts || 0) < 10 * 60 * 1000) return true;
      return false;
    } catch { return false; }
  })();
  if (DISABLE_TD_CRYPTO) return [];
  if (!key) throw new Error("TwelveData key missing");

  // Per-symbol cache (USD price)
  const now = Date.now();
  const cached = [];
  const toQuery = [];
  for (const s of symbols) {
    try {
      const raw = localStorage.getItem(`td:crypto:${s}`);
      if (raw) {
        const obj = JSON.parse(raw);
        if (now - (obj.ts || 0) < TD_CACHE_TTL_MS && obj.data) {
          cached.push(obj.data);
          continue;
        }
      }
    } catch { }
    toQuery.push(s);
  }

  let fetched = [];
  if (toQuery.length) {
    const chunks = [];
    for (let i = 0; i < toQuery.length; i += TD_BATCH_SIZE) {
      chunks.push(toQuery.slice(i, i + TD_BATCH_SIZE));
    }
    for (const group of chunks) {
      const tdSymbols = group.map(b => `${b}/USD`);
      const params = new URLSearchParams({ apikey: key });
      params.set("symbol", tdSymbols.join(","));
      const url = `${TD_BASE}/quote?${params.toString()}`;
      let groupResults = [];
      try {
        const res = await fetch(url);
        const json = await res.json();
        let arr = [];
        if (Array.isArray(json?.data)) {
          arr = json.data;
        } else if (json && typeof json === 'object') {
          if (json.symbol) arr = [json];
          else arr = Object.values(json);
        }
        for (const j of arr) {
          if (!j || j.code) continue;
          const base = String(j.symbol || "").replace(/\/USD$/i, "");
          const priceUSD = toNumber(j.price ?? j.close ?? j.previous_close);
          const changePct = toNumber(j.percent_change ?? j.changes_percentage);
          let volume = toNumber(j.volume ?? j.average_volume);
          // 若 TD 未提供有效成交量，则回退至 Binance 24h quoteVolume（以 USDT 计价）
          if (!(Number.isFinite(volume) && volume > 0)) {
            try {
              const pair = `${String(base).toUpperCase()}USDT`;
              const url = `/binance-api/api/v3/ticker/24hr?symbol=${encodeURIComponent(pair)}`;
              const bj = await fetch(url).then(r => r.json()).catch(() => null);
              const volQuote = toNumber(bj?.quoteVolume);
              if (Number.isFinite(volQuote) && volQuote > 0) volume = volQuote;
            } catch { }
          }
          const row = { symbol: base, name: j.name || base, priceUSD, changePct, volume };
          groupResults.push(row);
          fetched.push(row);
          try { localStorage.setItem(`td:crypto:${base}`, JSON.stringify({ ts: now, data: row })); } catch { }
        }
      } catch (_) {
        try { localStorage.setItem("td:crypto:fail", JSON.stringify({ ts: Date.now(), count: ((JSON.parse(localStorage.getItem("td:crypto:fail") || "null")?.count || 0) + 1) })) } catch { }
        groupResults = [];
      }
      // Fallback for missing bases in this group via single-quote endpoint
      const missing = group.filter(b => !groupResults.find(r => r.symbol === b));
      for (const base of missing) {
        try {
          const p = new URLSearchParams({ apikey: key, symbol: `${base}/USD` });
          const u = `${TD_BASE}/quote?${p.toString()}`;
          const r = await fetch(u);
          const j = await r.json();
          if (j && !j.code) {
            const priceUSD = toNumber(j.price ?? j.close ?? j.previous_close);
            const changePct = toNumber(j.percent_change ?? j.changes_percentage);
            let volume = toNumber(j.volume ?? j.average_volume);
            if (!(Number.isFinite(volume) && volume > 0)) {
              try {
                const pair = `${String(base).toUpperCase()}USDT`;
                const url = `/binance-api/api/v3/ticker/24hr?symbol=${encodeURIComponent(pair)}`;
                const bj = await fetch(url).then(r => r.json()).catch(() => null);
                const volQuote = toNumber(bj?.quoteVolume);
                if (Number.isFinite(volQuote) && volQuote > 0) volume = volQuote;
              } catch { }
            }
            const row = { symbol: base, name: j.name || base, priceUSD, changePct, volume };
            fetched.push(row);
            try { localStorage.setItem(`td:crypto:${base}`, JSON.stringify({ ts: now, data: row })); } catch { }
          }
        } catch {
          try { localStorage.setItem("td:crypto:fail", JSON.stringify({ ts: Date.now(), count: ((JSON.parse(localStorage.getItem("td:crypto:fail") || "null")?.count || 0) + 1) })) } catch { }
        }
      }
      if (TD_GROUP_DELAY_MS > 0) await new Promise(r => setTimeout(r, TD_GROUP_DELAY_MS));
    }
  }

  const bySym = new Map();
  for (const r of [...cached, ...fetched]) bySym.set(r.symbol, r);
  return symbols.map(s => bySym.get(s)).filter(Boolean);
}

// Crypto sparkline via Twelve Data time_series (returns close array)
async function fetchTwelveDataCryptoSpark(base, { interval = "5min", points = 60 } = {}) {
  const key = getTDKey();
  if (!key) throw new Error("TwelveData key missing");
  const k = `spark:crypto:${base}:${interval}:${points}`;
  try {
    const raw = localStorage.getItem(k);
    if (raw) {
      const obj = JSON.parse(raw);
      // 加密货币统一使用 TD_CACHE_TTL_MS；不区分市场
      if (Date.now() - (obj.ts || 0) < TD_CACHE_TTL_MS && Array.isArray(obj.data)) return obj.data;
    }
  } catch { }
  const params = new URLSearchParams({ apikey: key, symbol: `${base}/USD`, interval, outputsize: String(points) });
  const url = `${TD_BASE}/time_series?${params.toString()}`;
  const res = await fetch(url);
  const json = await res.json();
  const values = Array.isArray(json?.values) ? json.values : [];
  const closes = values.map(v => toNumber(v?.close)).filter(n => Number.isFinite(n));
  try { localStorage.setItem(k, JSON.stringify({ ts: Date.now(), data: closes })); } catch { }
  return closes;
}

async function fetchFinnhubQuotes(symbols) {
  const token = import.meta.env.VITE_FINNHUB_TOKEN;
  if (!token) throw new Error("Finnhub token missing");
  const out = [];
  for (const s of symbols) {
    // Finnhub often supports US tickers directly; international symbols coverage varies.
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(s)}&token=${token}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json && typeof json.c !== "undefined") {
      const price = Number(json.c || 0) > 0 ? json.c : (json.pc ?? 0);
      out.push(normalizeResult({ symbol: s, price, changePct: json.dp, volume: json.v }));
    }
  }
  return out;
}

// Free fallback (U.S. focus): FinancialModelingPrep batch quotes
async function fetchFmpQuotes(symbols, market) {
  if (market !== "us") return [];
  const key = String(import.meta.env.VITE_FMP_KEY || "").trim();
  if (!key || key.toLowerCase() === "demo") return [];
  const syms = symbols.join(",");
  const url = `https://financialmodelingprep.com/api/v3/quote/${encodeURIComponent(syms)}?apikey=${key}`;
  const res = await fetch(url);
  const json = await res.json();
  const list = (Array.isArray(json) ? json : []).map(j => normalizeResult({
    symbol: j.symbol,
    name: j.name || j.symbol,
    price: j.price,
    changePct: j.changesPercentage,
    volume: j.volume,
    provider: "fmp",
  }));
  return list;
}

// Alpha Vantage single-quote adapter (GLOBAL_QUOTE)
async function fetchAlphaVantageQuotes(symbols, market) {
  const key = getAVKey();
  if (!key) return [];
  const isPL = market === "pl";
  const toAvSym = (s) => {
    const base = String(s || "");
    // Use Yahoo-style .WA suffix for Poland tickers
    if (isPL && !/\.WA$/i.test(base)) return `${base}.WA`;
    return base;
  };
  const now = Date.now();
  const out = [];
  for (const orig of symbols) {
    try {
      const cacheKey = `av:${market}:${orig}`;
      try {
        const raw = localStorage.getItem(cacheKey);
        if (raw) {
          const obj = JSON.parse(raw);
          if (now - (obj.ts || 0) < TD_CACHE_TTL_MS && obj.data) { out.push(obj.data); continue; }
        }
      } catch { }
      const avSymbol = toAvSym(orig);
      const params = new URLSearchParams({ function: "GLOBAL_QUOTE", symbol: avSymbol, apikey: key });
      const url = `${AV_BASE}?${params.toString()}`;
      const res = await fetch(url);
      const j = await res.json();
      const g = j?.["Global Quote"] || j?.GlobalQuote || j?.globalQuote;
      const price = toNumber(g?.["05. price"] ?? g?.price);
      const changePctStr = String(g?.["10. change percent"] || "");
      const changePct = toNumber(changePctStr.replace(/%$/, ""));
      const vol = toNumber(g?.["06. volume"] ?? g?.volume);
      if (Number.isFinite(price) && price > 0) {
        const row = normalizeResult({ symbol: orig, name: orig, price, changePct, volume: vol, provider: "alphavantage" });
        out.push(row);
        try { localStorage.setItem(cacheKey, JSON.stringify({ ts: now, data: row })); } catch { }
      }
      if (TD_GROUP_DELAY_MS > 0) await new Promise(r => setTimeout(r, TD_GROUP_DELAY_MS));
    } catch { }
  }
  return out;
}

export async function getQuotes({ market, symbols }) {
  const syms = Array.isArray(symbols) ? symbols : String(symbols || "").split(",").filter(Boolean);
  if (!syms.length) return [];

  const isPL = market === 'pl';

  // Partition indices vs non-index to avoid TD ETF mispricing
  const indexSyms = syms.filter(isIndexSymbol);
  const nonIndexSyms = syms.filter(s => !isIndexSymbol(s));

  const results = [];

  // 1) Indices: prefer custom API → Finnhub → FMP → none
  try {
    if (indexSyms.length) {
      const idx = await fetchCustomIndexQuotes(indexSyms);
      if (idx.length) {
        try { localStorage.setItem("provider:last:index", "custom"); } catch { }
        results.push(...idx);
      } else if (has("VITE_FINNHUB_TOKEN")) {
        const fh = await fetchFinnhubQuotes(indexSyms);
        if (fh.length) {
          try { localStorage.setItem("provider:last:index", "finnhub"); } catch { }
          results.push(...fh);
        }
      } else {
        // Try FMP for index quotes (supports major indices with demo key)
        const fmpIdx = await fetchFmpQuotes(indexSyms, "us");
        if (fmpIdx.length) {
          try { localStorage.setItem("provider:last:index", "fmp"); } catch { }
          results.push(...fmpIdx);
        } else {
          // Skip Yahoo by default; let page-level static fallback handle indices when providers unavailable.
          try { localStorage.setItem("provider:last:index", "none-yf-disabled"); } catch { }
        }
      }
    }
  } catch (_) { }

  // 2) 波兰股票：优先使用 Yahoo Finance
  if (isPL && nonIndexSyms.length) {
    try {
      const yahoo = await fetchYahooMxQuotes(nonIndexSyms);
      if (yahoo.length) {
        try { localStorage.setItem("provider:last", "yahoo"); } catch { }
        results.push(...yahoo);
        // 检查是否有遗漏的符号，用 TD 补充
        const missing = nonIndexSyms.filter(s => !yahoo.find(r => r.symbol === s));
        if (missing.length) {
          try {
            const td = await fetchTwelveDataQuotes(missing, market);
            if (td.length) results.push(...td);
          } catch { }
        }
        return results;
      }
    } catch { }
    // Yahoo 失败，回退到 Twelve Data
    try {
      const td = await fetchTwelveDataQuotes(nonIndexSyms, market);
      if (td.length) {
        try { localStorage.setItem("provider:last", "twelve"); } catch { }
        results.push(...td);
        return results;
      }
    } catch { }
  }

  // 3) 美股：TD → FMP (US) → Finnhub → TD price-only
  try {
    if (!isPL && nonIndexSyms.length) {
      let td = [];
      try { td = await fetchTwelveDataQuotes(nonIndexSyms, market); } catch { td = []; }
      if (td.length) {
        try { localStorage.setItem("provider:last", "twelve"); } catch { }
        results.push(...td);
        const missing = nonIndexSyms.filter(s => !td.find(r => r.symbol === s));
        if (missing.length) {
          try {
            const fmpMissing = await fetchFmpQuotes(missing, market);
            if (fmpMissing.length) { results.push(...fmpMissing); }
            else if (has("VITE_FINNHUB_TOKEN")) {
              const fhMissing = await fetchFinnhubQuotes(missing);
              if (fhMissing.length) { results.push(...fhMissing); }
            }
          } catch { }
        }
      } else {
        // TD failed entirely; try FMP/Finnhub batch for non-index
        try {
          const fmp = await fetchFmpQuotes(nonIndexSyms, market);
          if (fmp.length) {
            try { localStorage.setItem("provider:last", "fmp"); } catch { }
            results.push(...fmp);
          } else if (has("VITE_FINNHUB_TOKEN")) {
            const fh = await fetchFinnhubQuotes(nonIndexSyms);
            if (fh.length) {
              try { localStorage.setItem("provider:last", "finnhub"); } catch { }
              results.push(...fh);
            }
          }
        } catch { }
      }
    }
  } catch (_) { }

  // 3) Last-resort for any remaining non-index: TD price-only
  const missingAll = syms.filter(s => !results.find(r => r.symbol === s));
  try {
    const nonIdxMissing = missingAll.filter(s => !isIndexSymbol(s));
    if (nonIdxMissing.length) {
      const tdPrices = await fetchTwelveDataPrices(nonIdxMissing, market);
      if (tdPrices.length) {
        try { localStorage.setItem("provider:last", "twelve_price"); } catch { }
        results.push(...tdPrices);
      }
    }
  } catch (_) { }

  // Return in input order
  const bySymbol = new Map(results.map(r => [r.symbol, r]));
  const ordered = syms.map(s => bySymbol.get(s)).filter(Boolean);
  if (!ordered.length) {
    try { localStorage.setItem("provider:last", "none"); } catch { }
  }
  // Persist per-symbol cache for UI fallback when providers hiccup
  try {
    const mk = market === "pl" ? "pl" : (market === "us" ? "us" : String(market || ""));
    const now = Date.now();
    ordered.forEach(r => {
      if (!r || !r.symbol) return;
      localStorage.setItem(`td:${mk}:${r.symbol}`, JSON.stringify({ ts: now, data: r }));
    });
  } catch { }
  return ordered;
}

// --- FX: USD/PLN 实时汇率 ---
// 优先使用 TwelveData 的 forex/quote；失败则回退至 open.er-api；带本地缓存与TTL
export async function getUsdPlnRate() {
  const cacheKey = "fx:USD:PLN";
  const ttlMs = (() => {
    const v = Number(import.meta.env?.VITE_FX_CACHE_TTL_MS || 60_000);
    return Number.isFinite(v) && v > 1000 ? v : 60_000;
  })();
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) {
      const obj = JSON.parse(raw);
      if (Date.now() - (obj.ts || 0) < ttlMs && Number.isFinite(obj.rate) && obj.rate > 0) {
        return { rate: obj.rate, source: obj.source || "cache" };
      }
    }
  } catch { }

  const key = getTDKey();
  const save = (rate, source) => {
    try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), rate, source })); } catch { }
    return { rate, source };
  };

  // Primary: TwelveData forex quote
  if (key) {
    try {
      const params = new URLSearchParams({ symbol: "USD/PLN", apikey: key });
      const url = `${TD_BASE}/forex/quote?${params.toString()}`;
      const res = await fetch(url);
      const j = await res.json();
      const price = Number(j?.price ?? j?.close ?? j?.previous_close);
      if (Number.isFinite(price) && price > 0) return save(price, "twelvedata");
    } catch { }
  }

  // Fallback: open.er-api
  try {
    const j = await fetch("https://open.er-api.com/v6/latest/USD").then(r => r.json());
    const rate = Number(j?.rates?.WAN || NaN);
    if (Number.isFinite(rate) && rate > 0) return save(rate, "er-api");
  } catch { }

  // Secondary fallback: exchangerate.host (free, no key, real-time-ish)
  try {
    const res = await fetch("https://api.exchangerate.host/latest?base=USD&symbols=PLN");
    const j = await res.json();
    const rate = Number(j?.rates?.WAN || NaN);
    if (Number.isFinite(rate) && rate > 0) return save(rate, "exchangerate.host");
  } catch { }

  // Final fallback constant
  return save(4.0, "constant");
}

// 加密货币名称映射
const CRYPTO_NAME_MAP = {
  BTC: "Bitcoin", ETH: "Ethereum", BNB: "BNB", SOL: "Solana", XRP: "XRP",
  ADA: "Cardano", DOGE: "Dogecoin", TON: "Toncoin", LTC: "Litecoin", TRX: "TRON",
  AVAX: "Avalanche", DOT: "Polkadot", LINK: "Chainlink", MATIC: "Polygon", SHIB: "Shiba Inu",
  UNI: "Uniswap", ATOM: "Cosmos", XMR: "Monero", ETC: "Ethereum Classic", BCH: "Bitcoin Cash",
  APT: "Aptos", NEAR: "NEAR Protocol", FIL: "Filecoin", ARB: "Arbitrum", OP: "Optimism",
};

// CoinGecko ID 映射
const COINGECKO_ID_MAP = {
  BTC: "bitcoin", ETH: "ethereum", BNB: "binancecoin", SOL: "solana", XRP: "ripple",
  ADA: "cardano", DOGE: "dogecoin", TON: "the-open-network", LTC: "litecoin", TRX: "tron",
  AVAX: "avalanche-2", DOT: "polkadot", LINK: "chainlink", MATIC: "matic-network", SHIB: "shiba-inu",
  UNI: "uniswap", ATOM: "cosmos", XMR: "monero", ETC: "ethereum-classic", BCH: "bitcoin-cash",
};

// Exported helpers for crypto (USD pricing; pages compute PLN)
// 多数据源策略：Binance -> CoinGecko -> Twelve Data -> 静态数据
export async function getCryptoQuotes({ symbols }) {
  const syms = Array.isArray(symbols) ? symbols : String(symbols || "").split(",").filter(Boolean);
  if (!syms.length) return [];
  
  // 1. 尝试 Binance API
  try {
    const out = [];
      await Promise.all(syms.map(async (base) => {
        try {
          const pair = `${String(base).toUpperCase()}USDT`;
          const url = `/binance-api/api/v3/ticker/24hr?symbol=${encodeURIComponent(pair)}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超时
        const j = await fetch(url, { signal: controller.signal }).then(r => r.json()).catch(() => null);
        clearTimeout(timeoutId);
          if (!j || j.code) return;
          const priceUSD = toNumber(j.lastPrice ?? j.weightedAvgPrice ?? j.prevClosePrice);
          const changePct = toNumber(j.priceChangePercent);
        const volumeQuote = toNumber(j.quoteVolume);
        const symbol = String(base).toUpperCase();
        if (Number.isFinite(priceUSD) && priceUSD > 0) {
          out.push({ 
            symbol, 
            priceUSD, 
            changePct, 
            volume: volumeQuote, 
            name: CRYPTO_NAME_MAP[symbol] || symbol 
          });
          }
        } catch { }
      }));
    if (out.length >= syms.length * 0.5) return out; // 至少获取到一半数据才认为成功
  } catch (_) { }
  
  // 2. 尝试 CoinGecko API（免费，无需代理）
  try {
    const ids = syms.map(s => COINGECKO_ID_MAP[String(s).toUpperCase()]).filter(Boolean);
    if (ids.length) {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_vol=true&include_24hr_change=true`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const data = await fetch(url, { signal: controller.signal }).then(r => r.json()).catch(() => null);
      clearTimeout(timeoutId);
      if (data && typeof data === 'object') {
        const out = [];
        for (const sym of syms) {
          const id = COINGECKO_ID_MAP[String(sym).toUpperCase()];
          const d = data[id];
          if (d && d.usd > 0) {
            out.push({
              symbol: String(sym).toUpperCase(),
              priceUSD: toNumber(d.usd),
              changePct: toNumber(d.usd_24h_change),
              volume: toNumber(d.usd_24h_vol),
              name: CRYPTO_NAME_MAP[String(sym).toUpperCase()] || sym
            });
          }
        }
        if (out.length) return out;
      }
    }
  } catch (_) { }
  
  // 3. 尝试 OKX API（通过代理绕过CORS）
  try {
    const out = [];
    await Promise.all(syms.map(async (base) => {
      try {
        const instId = `${String(base).toUpperCase()}-USDT`;
        const url = `/okx-api/api/v5/market/ticker?instId=${encodeURIComponent(instId)}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok) return;
        const j = await res.json();
        if (j.code !== '0' || !j.data || !j.data[0]) return;
        const ticker = j.data[0];
        const priceUSD = toNumber(ticker.last);
        const open24h = toNumber(ticker.open24h);
        const changePct = open24h > 0 ? ((priceUSD - open24h) / open24h * 100) : 0;
        const volume = toNumber(ticker.vol24h);
        const symbol = String(base).toUpperCase();
      if (Number.isFinite(priceUSD) && priceUSD > 0) {
          out.push({ 
            symbol, 
            priceUSD, 
            changePct, 
            volume, 
            name: CRYPTO_NAME_MAP[symbol] || symbol 
          });
        }
      } catch { }
    }));
    if (out.length >= syms.length * 0.5) return out;
  } catch (_) { }
  
  // 4. 尝试 Twelve Data
  try {
    const td = await fetchTwelveDataCryptoQuotes(syms);
    if (Array.isArray(td) && td.length) {
      return td.map(q => ({
        ...q,
        name: CRYPTO_NAME_MAP[String(q.symbol).toUpperCase()] || q.name || q.symbol
      }));
    }
  } catch (_) { }
  
  // 5. 返回静态兜底数据（2026年1月数据）
  const fallbackData = {
    BTC: { priceUSD: 104500, changePct: 2.35, volume: 32000000000 },
    ETH: { priceUSD: 3280, changePct: 1.85, volume: 15000000000 },
    BNB: { priceUSD: 695, changePct: 0.92, volume: 1800000000 },
    SOL: { priceUSD: 252, changePct: 3.15, volume: 4500000000 },
    XRP: { priceUSD: 3.12, changePct: -0.45, volume: 5200000000 },
    ADA: { priceUSD: 1.02, changePct: 1.28, volume: 950000000 },
    DOGE: { priceUSD: 0.38, changePct: 4.52, volume: 2800000000 },
    TON: { priceUSD: 5.45, changePct: 0.68, volume: 380000000 },
    LTC: { priceUSD: 118, changePct: 1.42, volume: 620000000 },
    TRX: { priceUSD: 0.26, changePct: -0.35, volume: 720000000 },
  };
  console.log('[Crypto] 使用静态备用数据');
  return syms.map(sym => {
    const s = String(sym).toUpperCase();
    const fb = fallbackData[s] || { priceUSD: 100, changePct: 0, volume: 1000000 };
    return {
      symbol: s,
      priceUSD: fb.priceUSD,
      changePct: fb.changePct,
      volume: fb.volume,
      name: CRYPTO_NAME_MAP[s] || s
    };
  });
      }

export async function getCryptoSpark(base, opts = {}) {
  const { interval = "5min", points = 60 } = opts;
  // 将 Twelve Data 的间隔映射到 Binance K线间隔
  const binanceIntervalMap = {
    "1min": "1m", "5min": "5m", "15min": "15m", "30min": "30m",
    "1h": "1h", "4h": "4h", "1day": "1d", "1week": "1w"
  };
  const binanceInterval = binanceIntervalMap[interval] || "5m";
  
  // 1. 优先使用 Binance Kline API
  try {
    const pair = `${String(base).toUpperCase()}USDT`;
    const url = `/binance-api/api/v3/klines?symbol=${encodeURIComponent(pair)}&interval=${binanceInterval}&limit=${points}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const j = await fetch(url, { signal: controller.signal }).then(r => r.json()).catch(() => null);
    clearTimeout(timeoutId);
    if (Array.isArray(j) && j.length) {
      return j.map(k => toNumber(k[4])).filter(v => Number.isFinite(v) && v > 0);
  }
  } catch (_) { }
  
  // 2. 尝试 CoinGecko 7天历史数据
  try {
    const id = COINGECKO_ID_MAP[String(base).toUpperCase()];
    if (id) {
      const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=1`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const data = await fetch(url, { signal: controller.signal }).then(r => r.json()).catch(() => null);
      clearTimeout(timeoutId);
      if (data && Array.isArray(data.prices) && data.prices.length) {
        // 每隔几个点取一个，确保数据点数量合适
        const prices = data.prices.map(p => p[1]);
        const step = Math.max(1, Math.floor(prices.length / points));
        const result = [];
        for (let i = 0; i < prices.length && result.length < points; i += step) {
          result.push(prices[i]);
        }
        if (result.length >= 10) return result;
      }
    }
  } catch (_) { }
  
  // 3. Fallback: Twelve Data
  try {
    return await fetchTwelveDataCryptoSpark(base, opts);
  } catch (_) {
    return [];
  }
}

// Exported helper for stock sparkline
export async function getStockSpark(symbol, market, opts) {
  try {
    return await fetchTwelveDataStockSpark(symbol, market, opts);
  } catch {
    return [];
  }
}
// Stock sparkline via Twelve Data time_series (returns close array)
async function fetchTwelveDataStockSpark(symbol, market, { interval = "1min", points = 60 } = {}) {
  const key = getTDKey();
  if (!key) throw new Error("TwelveData key missing");
  const isPL = market === "pl";
  const tdSymbol = (() => {
    let s = isPL ? symbol.replace(/\.WA$/, "") : symbol;
    if (TD_SYM_MAP_US[s]) s = TD_SYM_MAP_US[s];
    if (TD_SYM_MAP_PL[s]) s = TD_SYM_MAP_PL[s];
    if (TD_SYM_MAP_INDEX[s]) s = TD_SYM_MAP_INDEX[s];
    return s;
  })();
  let json = null;
  {
    const params = new URLSearchParams({ apikey: key, symbol: tdSymbol, interval, outputsize: String(points) });
    if (isPL) params.set("exchange", "WSE");
    const url = `${TD_BASE}/time_series?${params.toString()}`;
    const res = await fetch(url);
    json = await res.json();
  }
  const hasValues = (obj) => Array.isArray(obj?.values) && obj.values.length > 0;
  // For MX minute-level sparkline, reject daily/EOD series to force XWAR fallback
  const isMinuteInterval = /min$/i.test(String(interval));
  const looksDailySeries = (obj) => {
    const arr = Array.isArray(obj?.values) ? obj.values : [];
    // Twelve Data minute series contain time component "YYYY-MM-DD HH:MM:SS"; daily is "YYYY-MM-DD"
    const sample = arr[0]?.datetime || arr[0]?.time || "";
    return typeof sample === "string" && !sample.includes(":");
  };
  if (isPL && isMinuteInterval && hasValues(json) && looksDailySeries(json)) {
    // Treat WSE minute request returning daily data as invalid to trigger XWAR
    json = { status: "error", code: "EOD_SERIES_FOR_MINUTE" };
  }
  if ((!json || json.code || json.status === "error" || !hasValues(json)) && isPL) {
    // Retry with mic_code=XWAR
    try {
      const params3 = new URLSearchParams({ apikey: key, symbol: tdSymbol, interval, outputsize: String(points) });
      params3.set("mic_code", "XWAR");
      const url3 = `${TD_BASE}/time_series?${params3.toString()}`;
      const res3 = await fetch(url3);
      const j3 = await res3.json();
      json = j3;
    } catch { }
  }
  if ((!json || json.code || json.status === "error" || !hasValues(json)) && isPL) {
    // Final retry without exchange
    try {
      const params2 = new URLSearchParams({ apikey: key, symbol: tdSymbol, interval, outputsize: String(points) });
      const url2 = `${TD_BASE}/time_series?${params2.toString()}`;
      const res2 = await fetch(url2);
      const j2 = await res2.json();
      json = j2;
    } catch { }
  }
  // Symbol-level fallback: AMXL -> AMXB for sparkline
  if ((!json || json.code || json.status === "error" || !hasValues(json)) && isPL && tdSymbol === "AMXL") {
    try {
      const tryFetch = async (paramsInit) => {
        const params = new URLSearchParams(paramsInit);
        const url = `${TD_BASE}/time_series?${params.toString()}`;
        const res = await fetch(url);
        return await res.json();
      };
      let jj = await tryFetch({ apikey: key, symbol: "AMXB", interval, outputsize: String(points), exchange: "WSE" });
      if (!hasValues(jj)) jj = await tryFetch({ apikey: key, symbol: "AMXB", interval, outputsize: String(points), mic_code: "XWAR" });
      if (!hasValues(jj)) jj = await tryFetch({ apikey: key, symbol: "AMXB", interval, outputsize: String(points) });
      json = jj;
    } catch { }
  }
  const values = Array.isArray(json?.values) ? json.values : [];
  const closes = values.map(v => toNumber(v?.close)).filter(n => Number.isFinite(n));
  return closes;
}

// Yahoo Finance index quotes (robust naming and values for ^GSPC,^DJI,^IXIC,^MXX)
async function fetchYahooIndexQuotes(symbols) {
  try {
    // Use Yahoo v7 batch quote via service to reduce rate-limit issues
    const dataList = await yahooFinance.getMultipleStocks(symbols);
    const out = dataList
      .filter(d => d && typeof d.price !== "undefined")
      .map(d => normalizeResult({
        symbol: d.symbol,
        name: INDEX_NAME_MAP[d.symbol] || d.symbol,
        price: d.price,
        changePct: d.changePercent,
        volume: d.volume,
      }));
    return out;
  } catch {
    return [];
  }
}

// Yahoo batch quotes for Mexican equities (maps to .WA tickers)
async function fetchYahooMxQuotes(symbols) {
  try {
    const origList = Array.isArray(symbols) ? symbols : [];
    const mapYf = new Map();
    const yfSymbols = origList.map((orig) => {
      const base = String(orig).replace(/\.WA$/i, "");
      const yf = yahooFinance.convertToYahooSymbol(base);
      mapYf.set(yf, orig);
      return yf;
    });
    const dataList = await yahooFinance.getMultipleStocks(yfSymbols);
    const out = dataList
      .filter(d => d && typeof d.price !== "undefined")
      .map(d => normalizeResult({
        symbol: mapYf.get(d.symbol) || d.symbol,
        name: d.symbol,
        price: d.price,
        changePct: d.changePercent,
        volume: d.volume,
      }));
    return out;
  } catch {
    return [];
  }
}
