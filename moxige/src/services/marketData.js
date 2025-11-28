// Unified market data service with provider selection and graceful fallback.
// Supports: Twelve Data (VITE_TWELVEDATA_KEY), FMP (optional, free demo), Finnhub (VITE_FINNHUB_TOKEN, partial), Custom Index API (VITE_INDEX_API_BASE).
// Behavior: show real-time when market is open; show last close when closed.

const TD_BASE = "https://api.twelvedata.com";
const AV_BASE = "https://www.alphavantage.co/query";
import yahooFinance from "./yahooFinanceService.js";
// const YF_BASE = "https://query1.finance.yahoo.com"; // via yahooFinance service as last resort
const TD_SYM_MAP_US = { "BRK-B": "BRK.B", "BRK-A": "BRK.A" };
const TD_SYM_MAP_MX = { "TLEVISA.CPO": "TLEVISACPO", "AMXL": "AMXB" };
// Common index symbol mapping to Twelve Data equivalents (best-effort)
// Warning: Mapping ^GSPC->SPX on Twelve Data returns ETF, not the index.
// Keep mappings here for sparkline-only use; getQuotes will avoid TD for indices.
const TD_SYM_MAP_INDEX = { "^DJI": "DJI", "^IXIC": "IXIC", "^MXX": "MXX" };
// Canonical index names to display (override provider name when ambiguous)
const INDEX_NAME_MAP = {
  "^GSPC": "S&P 500",
  "^DJI": "Dow Jones Industrial Average",
  "^IXIC": "Nasdaq Composite",
  "^MXX": "S&P/BMV IPC",
};
const TD_CACHE_TTL_MS = (() => {
  const env = Number(import.meta.env?.VITE_TD_CACHE_TTL_MS || "");
  // 默认 1 秒缓存，以匹配 Market 页 1 秒刷新需求
  return Number.isFinite(env) && env > 0 ? env : 1 * 1000;
})();
const TD_CACHE_TTL_MX_MS = (() => {
  const env = Number(import.meta.env?.VITE_TD_CACHE_TTL_MX_MS || "");
  // 缩短墨股缓存TTL到1秒，以配合前端1秒轮询，避免静止
  return Number.isFinite(env) && env > 0 ? env : 1 * 1000;
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
const LOG = (...args) => { try { console.log(...args); } catch {} };
// Yahoo/AlphaVantage 回退关闭：统一 TwelveData
const ENABLE_YF = false;
const PREFER_YF_MX = false;
// Optional: force XMEX for MX quotes (test path for intraday reliability)
const FORCE_XMEX = (() => {
  try {
    const env = String(import.meta.env?.VITE_FORCE_XMEX || "").trim();
    const ls = String(localStorage.getItem("force:xmex") || "").trim();
    return env === "1" || ls === "1";
  } catch { return false; }
})();

function has(key) {
  try { return typeof import.meta.env[key] !== "undefined" && !!import.meta.env[key]; } catch { return false; }
}

function getTDKey() {
  // Env candidates
  try {
    const envKey =
      import.meta.env.VITE_TWELVEDATA_KEY ||
      import.meta.env.VITE_TWELVE_DATA_KEY ||
      import.meta.env.VITE_TD_KEY ||
      import.meta.env.VITE_TD_KEY_OVERRIDE;
    if (envKey) return envKey;
  } catch {}
  // Server-injected window variable
  try {
    const w = typeof window !== 'undefined' ? window : undefined;
    const k = w && w.__TD_KEY__ ? String(w.__TD_KEY__).trim() : '';
    if (k) return k;
  } catch {}
  // Server-injected meta tag
  try {
    const m = typeof document !== 'undefined' ? document.querySelector('meta[name="td-key"]') : null;
    const c = m && m.getAttribute('content') ? String(m.getAttribute('content')).trim() : '';
    if (c) return c;
  } catch {}
  // Cookie
  try {
    const m = (typeof document !== 'undefined' ? document.cookie : '') || '';
    const match = m.match(/(?:^|; )td_key=([^;]+)/);
    const v = match ? decodeURIComponent(match[1]) : '';
    if (v) return v;
  } catch {}
  // URL query param
  try {
    const loc = typeof window !== 'undefined' ? window.location : undefined;
    const qs = loc && loc.search ? String(loc.search) : '';
    if (qs) {
      const p = new URLSearchParams(qs);
      const v = String(p.get('tdkey') || '').trim();
      if (v) {
        try { localStorage.setItem('td:key', v); } catch {}
        return v;
      }
    }
  } catch {}
  // LocalStorage candidates
  try {
    const lsKey =
      localStorage.getItem("td:key") ||
      localStorage.getItem("VITE_TWELVEDATA_KEY") ||
      localStorage.getItem("VITE_TWELVE_DATA_KEY") ||
      localStorage.getItem("VITE_TD_KEY") ||
      localStorage.getItem("VITE_TD_KEY_OVERRIDE");
    if (lsKey) return lsKey;
  } catch {}
  return undefined;
}

function getAVKey() {
  // Env candidates
  try {
    const envKey =
      import.meta.env.VITE_ALPHAVANTAGE_KEY ||
      import.meta.env.VITE_AV_KEY;
    if (envKey) return envKey;
  } catch {}
  // LocalStorage candidates
  try {
    const lsKey =
      localStorage.getItem("av:key") ||
      localStorage.getItem("VITE_ALPHAVANTAGE_KEY") ||
      localStorage.getItem("VITE_AV_KEY");
    if (lsKey) return lsKey;
  } catch {}
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
  } catch {}
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
    } catch {}
  }
  return out;
}

// Yahoo fallback removed due to reliability concerns and CORS issues.
// Note: Re-enable Yahoo as a last-resort fallback to avoid empty lists when
// other providers fail or have incomplete coverage, especially for MX tickers.

async function fetchTwelveDataQuotes(symbols, market) {
  const key = getTDKey();
  if (!key) throw new Error("TwelveData key missing");

  const isMX = market === "mx";
  const cacheTtl = isMX ? TD_CACHE_TTL_MX_MS : TD_CACHE_TTL_MS;
  const toTdSym = (s) => {
    let base = isMX ? s.replace(/\.MX$/, "") : s;
    // Avoid mapping index symbols here; indices handled by custom provider in getQuotes
    if (!isIndexSymbol(base) && TD_SYM_MAP_INDEX[base]) base = TD_SYM_MAP_INDEX[base];
    if (isMX && TD_SYM_MAP_MX[base]) base = TD_SYM_MAP_MX[base];
    if (!isMX && TD_SYM_MAP_US[base]) base = TD_SYM_MAP_US[base];
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
    } catch {}
    symbolsToQuery.push(s);
  }

  const buildBatchMap = async (group) => {
    if (!group.length) return null;
    const tdSymbols = group.map(toTdSym);
    const params = new URLSearchParams({ apikey: key, symbol: tdSymbols.join(",") });
    if (isMX) params.set("exchange", "BMV");
    const url = `${TD_BASE}/quote?${params.toString()}`;
    try {
      const res = await fetch(url);
      const json = await res.json();
      if (json?.code || json?.status === "error") {
        if (DEBUG_LOG) LOG("[TD] batch quote error", { market, code: json?.code, status: json?.status, message: json?.message });
        return { error: json };
      }
      const arr = Array.isArray(json?.data) ? json.data : (json ? [json] : []);
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
      const shouldBatchPrimary = !(isMX && FORCE_XMEX);
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

          if (isMX && FORCE_XMEX) {
            try {
              const jX = await fetchQuoteWithParams({ mic_code: "XMEX" });
              if (!!jX && !jX.code) j = jX;
              if (DEBUG_LOG) LOG("[TD] FORCE_XMEX attempt", { orig, tdSymbol, ok: !!j });
            } catch {}
          }

          if (!j) {
            if (batch?.map && batch.map.has(tdKey)) {
              j = batch.map.get(tdKey);
            } else if (!batch?.error && shouldBatchPrimary) {
              try {
                const params = isMX ? { exchange: "BMV" } : {};
                const jPrimary = await fetchQuoteWithParams(params);
                j = jPrimary;
              } catch (e) {
                if (DEBUG_LOG) LOG("[TD] primary fetch error", { market, orig, tdSymbol, err: String(e) });
              }
            } else if (!shouldBatchPrimary) {
              try {
                const params = isMX ? { exchange: "BMV" } : {};
                const jPrimary = await fetchQuoteWithParams(params);
                j = jPrimary;
              } catch (e) {
                if (DEBUG_LOG) LOG("[TD] primary fetch error", { market, orig, tdSymbol, err: String(e) });
              }
            }
          }

          const sourceCode = String(j?.mic_code || j?.exchange || "");
          const sourceUpper = sourceCode.toUpperCase();
          const isXmex = sourceUpper === "XMEX";

          // Helper: treat undefined/unknown as not-open to encourage XMEX fallback
          const isOpenTrue = (v) => String(v).toLowerCase() === "true" || v === true;
          const priceNum = toNumber(j?.price ?? j?.close ?? j?.previous_close);
          const prevNum = toNumber(j?.previous_close);
          const looksStale = (!Number.isFinite(priceNum) || priceNum <= 0 || (Number.isFinite(prevNum) && Math.abs(priceNum - prevNum) < 1e-9));

          if (j && isMX && !isXmex) {
            const isOpen = j?.is_market_open;
            const closedOrUnknown = !isOpenTrue(isOpen);
            // If BMV reports closed/unknown OR price equals previous_close, try XMEX for intraday
            if (closedOrUnknown || looksStale) {
              if (DEBUG_LOG) LOG("[TD] BMV closed/unknown or stale price, try XMEX", { orig, tdSymbol, is_open: j?.is_market_open, price: j?.price, previous_close: j?.previous_close });
              try {
                const j3 = await fetchQuoteWithParams({ mic_code: "XMEX" });
                if (validPrice(j3)) j = j3;
              } catch {}
            }
          }

          if ((!j || j.code || j.status === "error" || !validPrice(j)) && isMX) {
            if (DEBUG_LOG) LOG("[TD] BMV invalid, fallback XMEX", { orig, tdSymbol });
            try {
              const j3 = await fetchQuoteWithParams({ mic_code: "XMEX" });
              if (!!j3 && !j3.code) j = j3;
            } catch {}
          }
          if ((!j || j.code || j.status === "error" || !validPrice(j)) && isMX) {
            if (DEBUG_LOG) LOG("[TD] XMEX invalid, try no exchange", { orig, tdSymbol });
            try {
              const j2 = await fetchQuoteWithParams();
              if (!!j2 && !j2.code) j = j2;
            } catch {}
          }
          if ((!j || j.code || j.status === "error" || !validPrice(j)) && isMX && tdSymbol === "AMXL") {
            if (DEBUG_LOG) LOG("[TD] AMXL fallback -> AMXB", { orig });
            const tryAlt = async (params) => {
              try { return await fetchQuoteWithParams(params, "AMXB"); }
              catch { return null; }
            };
            let jj = await tryAlt({ exchange: "BMV" });
            if (!validPrice(jj)) jj = await tryAlt({ mic_code: "XMEX" });
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
          const finalXmex = finalUpper === "XMEX";
          const isOpen = j?.is_market_open;
          const closed = isOpen === false || String(isOpen).toLowerCase() === "false";
          const price = (isMX && finalXmex)
            ? (j.price ?? j.close ?? j.previous_close)
            : (closed ? (j.previous_close ?? j.close ?? j.price) : (j.price ?? j.close ?? j.previous_close));

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
          try { localStorage.setItem(`td:${market}:${orig}`, JSON.stringify({ ts: now, data: norm })); } catch {}
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
  const isMX = market === "mx";
  const toTdSym = (s) => {
    let base = isMX ? s.replace(/\.MX$/, "") : s;
    if (TD_SYM_MAP_INDEX[base]) base = TD_SYM_MAP_INDEX[base];
    if (isMX && TD_SYM_MAP_MX[base]) base = TD_SYM_MAP_MX[base];
    if (!isMX && TD_SYM_MAP_US[base]) base = TD_SYM_MAP_US[base];
    return base;
  };

  const out = [];
  for (const orig of symbols) {
    try {
      const tdSymbol = toTdSym(orig);
      let j = null;
      // Try exchange=BMV first
      try {
        const params = new URLSearchParams({ apikey: key, symbol: tdSymbol });
        if (isMX) params.set("exchange", "BMV");
        const url = `${TD_BASE}/price?${params.toString()}`;
        const res = await fetch(url);
        j = await res.json();
      } catch (e) {
      if (DEBUG_LOG) LOG("[TD] BMV price fetch error", { orig, tdSymbol, err: String(e) });
        j = null;
      }
      const validPrice = (obj) => {
        const p = toNumber(obj?.price ?? obj?.close ?? obj?.previous_close);
        return Number.isFinite(p) && p > 0;
      };
      if ((!j || j.code || j.status === "error" || !validPrice(j)) && isMX) {
        // Retry with mic_code=XMEX
        try {
          const params3 = new URLSearchParams({ apikey: key, symbol: tdSymbol });
          params3.set("mic_code", "XMEX");
          const url3 = `${TD_BASE}/price?${params3.toString()}`;
          const res3 = await fetch(url3);
          const j3 = await res3.json();
          j = j3;
        } catch {}
      }
      if ((!j || j.code || j.status === "error" || !validPrice(j)) && isMX) {
        // Final retry without exchange
        try {
          const params2 = new URLSearchParams({ apikey: key, symbol: tdSymbol });
          const url2 = `${TD_BASE}/price?${params2.toString()}`;
          const res2 = await fetch(url2);
          const j2 = await res2.json();
          j = j2;
        } catch {}
      }
      // Symbol-level fallback: AMXL -> AMXB
      if ((!j || j.code || j.status === "error" || !validPrice(j)) && isMX && tdSymbol === "AMXL") {
        try {
          const tryFetch = async (paramsInit) => {
            const params = new URLSearchParams(paramsInit);
            const url = `${TD_BASE}/price?${params.toString()}`;
            const res = await fetch(url);
            return await res.json();
          };
          let jj = await tryFetch({ apikey: key, symbol: "AMXB", exchange: "BMV" });
          if (!validPrice(jj)) jj = await tryFetch({ apikey: key, symbol: "AMXB", mic_code: "XMEX" });
          if (!validPrice(jj)) jj = await tryFetch({ apikey: key, symbol: "AMXB" });
          j = jj;
        } catch {}
      }
      const price = toNumber(j?.price ?? j?.close ?? j?.previous_close);
      if (Number.isFinite(price) && price > 0) {
        out.push(normalizeResult({ symbol: orig, name: orig, price, changePct: 0, volume: 0 }));
      }
    } catch {}
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
    } catch {}
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
      params.set("symbols", tdSymbols.join(","));
      const url = `${TD_BASE}/quotes?${params.toString()}`;
      let groupResults = [];
      try {
        const res = await fetch(url);
        const json = await res.json();
        const arr = Array.isArray(json?.data) ? json.data : [];
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
              const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(pair)}`;
              const bj = await fetch(url).then(r=>r.json()).catch(()=>null);
              const volQuote = toNumber(bj?.quoteVolume);
              if (Number.isFinite(volQuote) && volQuote > 0) volume = volQuote;
            } catch {}
          }
          const row = { symbol: base, name: j.name || base, priceUSD, changePct, volume };
          groupResults.push(row);
          fetched.push(row);
          try { localStorage.setItem(`td:crypto:${base}`, JSON.stringify({ ts: now, data: row })); } catch {}
        }
      } catch (_) {
        try { localStorage.setItem("td:crypto:fail", JSON.stringify({ ts: Date.now(), count: ((JSON.parse(localStorage.getItem("td:crypto:fail")||"null")?.count||0)+1) })) } catch {}
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
                const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(pair)}`;
                const bj = await fetch(url).then(r=>r.json()).catch(()=>null);
                const volQuote = toNumber(bj?.quoteVolume);
                if (Number.isFinite(volQuote) && volQuote > 0) volume = volQuote;
              } catch {}
            }
            const row = { symbol: base, name: j.name || base, priceUSD, changePct, volume };
            fetched.push(row);
            try { localStorage.setItem(`td:crypto:${base}`, JSON.stringify({ ts: now, data: row })); } catch {}
          }
        } catch {
          try { localStorage.setItem("td:crypto:fail", JSON.stringify({ ts: Date.now(), count: ((JSON.parse(localStorage.getItem("td:crypto:fail")||"null")?.count||0)+1) })) } catch {}
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
  } catch {}
  const params = new URLSearchParams({ apikey: key, symbol: `${base}/USD`, interval, outputsize: String(points) });
  const url = `${TD_BASE}/time_series?${params.toString()}`;
  const res = await fetch(url);
  const json = await res.json();
  const values = Array.isArray(json?.values) ? json.values : [];
  const closes = values.map(v => toNumber(v?.close)).filter(n => Number.isFinite(n));
  try { localStorage.setItem(k, JSON.stringify({ ts: Date.now(), data: closes })); } catch {}
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
  const isMX = market === "mx";
  const toAvSym = (s) => {
    const base = String(s || "");
    // Use Yahoo-style .MX suffix for Mexico tickers
    if (isMX && !/\.MX$/i.test(base)) return `${base}.MX`;
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
      } catch {}
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
        try { localStorage.setItem(cacheKey, JSON.stringify({ ts: now, data: row })); } catch {}
      }
      if (TD_GROUP_DELAY_MS > 0) await new Promise(r => setTimeout(r, TD_GROUP_DELAY_MS));
    } catch {}
  }
  return out;
}

export async function getQuotes({ market, symbols }) {
  const syms = Array.isArray(symbols) ? symbols : String(symbols || "").split(",").filter(Boolean);
  if (!syms.length) return [];

  // Partition indices vs non-index to avoid TD ETF mispricing
  const indexSyms = syms.filter(isIndexSymbol);
  const nonIndexSyms = syms.filter(s => !isIndexSymbol(s));

  const results = [];

  // 1) Indices: prefer custom API → Finnhub → FMP → none
  try {
    if (indexSyms.length) {
      const idx = await fetchCustomIndexQuotes(indexSyms);
      if (idx.length) {
        try { localStorage.setItem("provider:last:index", "custom"); } catch {}
        results.push(...idx);
      } else if (has("VITE_FINNHUB_TOKEN")) {
        const fh = await fetchFinnhubQuotes(indexSyms);
        if (fh.length) {
          try { localStorage.setItem("provider:last:index", "finnhub"); } catch {}
          results.push(...fh);
        }
      } else {
        // Try FMP for index quotes (supports major indices with demo key)
        const fmpIdx = await fetchFmpQuotes(indexSyms, "us");
        if (fmpIdx.length) {
          try { localStorage.setItem("provider:last:index", "fmp"); } catch {}
          results.push(...fmpIdx);
        } else {
          // Skip Yahoo by default; let page-level static fallback handle indices when providers unavailable.
          try { localStorage.setItem("provider:last:index", "none-yf-disabled"); } catch {}
        }
      }
    }
  } catch (_) {}

  // 2) Non-index: TD → FMP (US) → Finnhub → TD price-only
  try {
    if (nonIndexSyms.length) {
      let td = [];
      try { td = await fetchTwelveDataQuotes(nonIndexSyms, market); } catch { td = []; }
      if (td.length) {
        try { localStorage.setItem("provider:last", "twelve"); } catch {}
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
          } catch {}
        }
      } else {
        // TD failed entirely; try FMP/Finnhub batch for non-index
        try {
          const fmp = await fetchFmpQuotes(nonIndexSyms, market);
          if (fmp.length) {
            try { localStorage.setItem("provider:last", "fmp"); } catch {}
            results.push(...fmp);
          } else if (has("VITE_FINNHUB_TOKEN")) {
            const fh = await fetchFinnhubQuotes(nonIndexSyms);
            if (fh.length) {
              try { localStorage.setItem("provider:last", "finnhub"); } catch {}
              results.push(...fh);
            }
          }
        } catch {}
      }
    }
  } catch (_) {}

  // 3) Last-resort for any remaining non-index: TD price-only
  const missingAll = syms.filter(s => !results.find(r => r.symbol === s));
  try {
    const nonIdxMissing = missingAll.filter(s => !isIndexSymbol(s));
    if (nonIdxMissing.length) {
      const tdPrices = await fetchTwelveDataPrices(nonIdxMissing, market);
      if (tdPrices.length) {
        try { localStorage.setItem("provider:last", "twelve_price"); } catch {}
        results.push(...tdPrices);
      }
    }
  } catch (_) {}

  // Return in input order
  const bySymbol = new Map(results.map(r => [r.symbol, r]));
  const ordered = syms.map(s => bySymbol.get(s)).filter(Boolean);
  if (!ordered.length) {
    try { localStorage.setItem("provider:last", "none"); } catch {}
  }
  // Persist per-symbol cache for UI fallback when providers hiccup
  try {
    const mk = market === "mx" ? "mx" : (market === "us" ? "us" : String(market || ""));
    const now = Date.now();
    ordered.forEach(r => {
      if (!r || !r.symbol) return;
      localStorage.setItem(`td:${mk}:${r.symbol}`, JSON.stringify({ ts: now, data: r }));
    });
  } catch {}
  return ordered;
}

// --- FX: USD/MXN 实时汇率 ---
// 优先使用 TwelveData 的 forex/quote；失败则回退至 open.er-api；带本地缓存与TTL
export async function getUsdMxnRate() {
  const cacheKey = "fx:USD:MXN";
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
  } catch {}

  const key = getTDKey();
  const save = (rate, source) => {
    try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), rate, source })); } catch {}
    return { rate, source };
  };

  // Primary: TwelveData forex quote
  if (key) {
    try {
      const params = new URLSearchParams({ symbol: "USD/MXN", apikey: key });
      const url = `${TD_BASE}/forex/quote?${params.toString()}`;
      const res = await fetch(url);
      const j = await res.json();
      const price = Number(j?.price ?? j?.close ?? j?.previous_close);
      if (Number.isFinite(price) && price > 0) return save(price, "twelvedata");
    } catch {}
  }

  // Fallback: open.er-api
  try {
    const j = await fetch("https://open.er-api.com/v6/latest/USD").then(r=>r.json());
    const rate = Number(j?.rates?.MXN || NaN);
    if (Number.isFinite(rate) && rate > 0) return save(rate, "er-api");
  } catch {}

  // Secondary fallback: exchangerate.host (free, no key, real-time-ish)
  try {
    const res = await fetch("https://api.exchangerate.host/latest?base=USD&symbols=MXN");
    const j = await res.json();
    const rate = Number(j?.rates?.MXN || NaN);
    if (Number.isFinite(rate) && rate > 0) return save(rate, "exchangerate.host");
  } catch {}

  // Final fallback constant
  return save(18.0, "constant");
}

// Exported helpers for crypto (USD pricing; pages compute MXN)
export async function getCryptoQuotes({ symbols }) {
  const syms = Array.isArray(symbols) ? symbols : String(symbols || "").split(",").filter(Boolean);
  if (!syms.length) return [];
  try {
    const td = await fetchTwelveDataCryptoQuotes(syms);
    if (Array.isArray(td) && td.length) {
      // 叠加 Binance 的 24h 数据，以提升价格与涨跌百分比的实时性
      const bySym = new Map(td.map(q => [String(q.symbol).toUpperCase(), { ...q }]));
      await Promise.all(syms.map(async (base) => {
        try {
          const pair = `${String(base).toUpperCase()}USDT`;
          const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(pair)}`;
          const j = await fetch(url).then(r=>r.json()).catch(()=>null);
          if (!j || j.code) return;
          const priceUSD = toNumber(j.lastPrice ?? j.weightedAvgPrice ?? j.prevClosePrice);
          const changePct = toNumber(j.priceChangePercent);
          const volQuote = toNumber(j.quoteVolume);
          const row = bySym.get(String(base).toUpperCase());
          if (row) {
            if (Number.isFinite(priceUSD) && priceUSD > 0) row.priceUSD = priceUSD;
            if (Number.isFinite(changePct)) row.changePct = changePct;
            // 若 TD 成交量为 0，则也叠加 Binance 的 quoteVolume
            if (!(Number.isFinite(row.volume) && row.volume > 0) && Number.isFinite(volQuote) && volQuote > 0) {
              row.volume = volQuote;
            }
          }
        } catch {}
      }));
      return Array.from(bySym.values());
    }
  } catch (_) {
    // fallthrough to Binance
  }
  // Fallback: Binance 24hr ticker for base/USDT pairs
  try {
    const out = [];
    for (const base of syms) {
      const pair = `${String(base).toUpperCase()}USDT`;
      const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(pair)}`;
      const j = await fetch(url).then(r=>r.json()).catch(()=>null);
      if (!j || j.code) continue;
      const priceUSD = toNumber(j.lastPrice ?? j.weightedAvgPrice ?? j.prevClosePrice);
      const changePct = toNumber(j.priceChangePercent);
      const volumeQuote = toNumber(j.quoteVolume);
      if (Number.isFinite(priceUSD) && priceUSD > 0) {
        out.push({ symbol: String(base).toUpperCase(), priceUSD, changePct, volume: volumeQuote, name: undefined });
      }
    }
    return out;
  } catch (_) {
    return [];
  }
}

export async function getCryptoSpark(base, opts) {
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
  const isMX = market === "mx";
  const tdSymbol = (() => {
    let s = isMX ? symbol.replace(/\.MX$/, "") : symbol;
    if (TD_SYM_MAP_US[s]) s = TD_SYM_MAP_US[s];
    if (TD_SYM_MAP_MX[s]) s = TD_SYM_MAP_MX[s];
    if (TD_SYM_MAP_INDEX[s]) s = TD_SYM_MAP_INDEX[s];
    return s;
  })();
  let json = null;
  {
    const params = new URLSearchParams({ apikey: key, symbol: tdSymbol, interval, outputsize: String(points) });
    if (isMX) params.set("exchange", "BMV");
    const url = `${TD_BASE}/time_series?${params.toString()}`;
    const res = await fetch(url);
    json = await res.json();
  }
  const hasValues = (obj) => Array.isArray(obj?.values) && obj.values.length > 0;
  // For MX minute-level sparkline, reject daily/EOD series to force XMEX fallback
  const isMinuteInterval = /min$/i.test(String(interval));
  const looksDailySeries = (obj) => {
    const arr = Array.isArray(obj?.values) ? obj.values : [];
    // Twelve Data minute series contain time component "YYYY-MM-DD HH:MM:SS"; daily is "YYYY-MM-DD"
    const sample = arr[0]?.datetime || arr[0]?.time || "";
    return typeof sample === "string" && !sample.includes(":");
  };
  if (isMX && isMinuteInterval && hasValues(json) && looksDailySeries(json)) {
    // Treat BMV minute request returning daily data as invalid to trigger XMEX
    json = { status: "error", code: "EOD_SERIES_FOR_MINUTE" };
  }
  if ((!json || json.code || json.status === "error" || !hasValues(json)) && isMX) {
    // Retry with mic_code=XMEX
    try {
      const params3 = new URLSearchParams({ apikey: key, symbol: tdSymbol, interval, outputsize: String(points) });
      params3.set("mic_code", "XMEX");
      const url3 = `${TD_BASE}/time_series?${params3.toString()}`;
      const res3 = await fetch(url3);
      const j3 = await res3.json();
      json = j3;
    } catch {}
  }
  if ((!json || json.code || json.status === "error" || !hasValues(json)) && isMX) {
    // Final retry without exchange
    try {
      const params2 = new URLSearchParams({ apikey: key, symbol: tdSymbol, interval, outputsize: String(points) });
      const url2 = `${TD_BASE}/time_series?${params2.toString()}`;
      const res2 = await fetch(url2);
      const j2 = await res2.json();
      json = j2;
    } catch {}
  }
  // Symbol-level fallback: AMXL -> AMXB for sparkline
  if ((!json || json.code || json.status === "error" || !hasValues(json)) && isMX && tdSymbol === "AMXL") {
    try {
      const tryFetch = async (paramsInit) => {
        const params = new URLSearchParams(paramsInit);
        const url = `${TD_BASE}/time_series?${params.toString()}`;
        const res = await fetch(url);
        return await res.json();
      };
      let jj = await tryFetch({ apikey: key, symbol: "AMXB", interval, outputsize: String(points), exchange: "BMV" });
      if (!hasValues(jj)) jj = await tryFetch({ apikey: key, symbol: "AMXB", interval, outputsize: String(points), mic_code: "XMEX" });
      if (!hasValues(jj)) jj = await tryFetch({ apikey: key, symbol: "AMXB", interval, outputsize: String(points) });
      json = jj;
    } catch {}
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

// Yahoo batch quotes for Mexican equities (maps to .MX tickers)
async function fetchYahooMxQuotes(symbols) {
  try {
    const origList = Array.isArray(symbols) ? symbols : [];
    const mapYf = new Map();
    const yfSymbols = origList.map((orig) => {
      const base = String(orig).replace(/\.MX$/i, "");
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
