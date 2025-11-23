import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import BottomNav from "../components/BottomNav.jsx";
import { useI18n } from "../i18n.jsx";
import { getQuotes, getCryptoQuotes, getUsdMxnRate } from "../services/marketData.js";
import "../styles/market-tabs.css";
import { formatMoney as fmMoney, formatNumber } from "../utils/money.js";

 

const MX_SYMBOLS = [
  "AMXL.MX","WALMEX.MX","FEMSAUBD.MX","BIMBOA.MX","GMEXICOB.MX","GFNORTEO.MX",
  "ALSEA.MX","GAPB.MX","KIMBERA.MX","TLEVISA.CPO.MX","OMAB.MX","MEXCHEM.MX",
  // 额外补充常见成分，确保 ≥20
  "CEMEXCPO.MX","GCARSOA1.MX","GENTERA.MX","BOLSAA.MX","AC.MX","ASURB.MX",
  "GRUMAB.MX","BBAJIOO.MX"
];
const US_SYMBOLS = [
  "AAPL","MSFT","AMZN","GOOGL","TSLA","META","NVDA","BRK-B","JPM","NFLX","ORCL","INTC",
  "V","UNH","JNJ","PG","MA","HD","COST","DIS","PEP","KO","CSCO","ADBE","CRM","PYPL",
  "NKE","PFE","ABBV","TMO","QCOM","IBM","AMD","CAT","BA","MCD","WMT","XOM","CVX","MRK",
  "HON","AMGN","AVGO","TXN","LLY","LIN","BKNG","SBUX","UPS","MS","GS","BLK","C","BAC",
  "WFC","SCHW","USB","AMAT","MU","GE","F","GM"
];

function formatVolume(n, lang) {
  const val = Number(n || 0);
  const locale = lang === "es" ? "es-MX" : "en-US";
  if (!Number.isFinite(val)) return String(n);
  if (val >= 1_000_000_000) {
    const v = val / 1_000_000_000;
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(v)} B`;
  }
  if (val >= 1_000_000) {
    const v = val / 1_000_000;
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(v)} M`;
  }
  return formatNumber(val, lang);
}

function formatPrice(n, currency, lang) {
  return fmMoney(n, currency, lang);
}

// Format time as YYYY-MM-DD HH:mm
 

export default function Market() {
  const { lang, t } = useI18n();
  const navigate = useNavigate();
  const [market, setMarket] = useState("mx"); // mx | us | crypto
  const [showMobileDropdown, setShowMobileDropdown] = useState(false); // 移动端下拉菜单控制
  const PAGE_SIZE = (() => {
    const v = Number(import.meta.env.VITE_PAGE_SIZE || 10);
    return Number.isFinite(v) && v > 0 ? v : 10;
  })(); // 每批次加载条数，可通过 VITE_PAGE_SIZE 配置
  const [marketView, setMarketView] = useState("overview"); // overview | gainers | losers | turnover
  const [cryptoCurrency, setCryptoCurrency] = useState(() => {
    try { return localStorage.getItem("marketCryptoCurrency") || "USD"; } catch { return "USD"; }
  });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadedCount, setLoadedCount] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState("");
  // 搜索框状态（按当前所选市场）
  const [search, setSearch] = useState({ mx: "", us: "", crypto: "" });
  const [searchRow, setSearchRow] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [showSug, setShowSug] = useState(false);
  const [favorites, setFavorites] = useState(() => {
    try {
      const o = JSON.parse(localStorage.getItem("market:favorites") || "{}");
      return { mx: o.mx || [], us: o.us || [], crypto: o.crypto || [] };
    } catch { return { mx: [], us: [], crypto: [] }; }
  });
  const [recents, setRecents] = useState(() => {
    try {
      const o = JSON.parse(localStorage.getItem("market:recents") || "{}");
      return { mx: o.mx || [], us: o.us || [], crypto: o.crypto || [] };
    } catch { return { mx: [], us: [], crypto: [] }; }
  });

  useEffect(() => {
    try { localStorage.setItem("marketCryptoCurrency", cryptoCurrency); } catch {}
  }, [cryptoCurrency]);
  useEffect(() => {
    try { localStorage.setItem("market:favorites", JSON.stringify(favorites)); } catch {}
  }, [favorites]);
  useEffect(() => {
    try { localStorage.setItem("market:recents", JSON.stringify(recents)); } catch {}
  }, [recents]);

  

  const sentinelRef = useRef(null);
  // 轮询使用当前 rows 的引用，避免因 rows 变化频繁重建定时器
  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  const getAllSymbols = useCallback(() => {
    if (market === "mx") return MX_SYMBOLS;
    if (market === "us") return US_SYMBOLS;
    return [];
  }, [market]);

  

  const loadNextBatch = useCallback(async (isInitial = false) => {
    if (!isInitial && (loadingMore || !hasMore)) return;
    const all = getAllSymbols();
    const start = isInitial ? 0 : loadedCount;
    const syms = all.slice(start, start + PAGE_SIZE);
    if (!syms.length) { setHasMore(false); return; }
    if (isInitial) setLoading(true); else setLoadingMore(true);
    try {
      const list = await getQuotes({ market, symbols: syms });
      if (!list.length && isInitial) {
        // 保底：首批为空时展示示例数据，但继续尝试下一批，避免“已到底”过早出现
        if (market === "mx") {
          setRows([
            { symbol: "AMXL.MX", name: "América Móvil", price: 17.2, changePct: 0.8, volume: 12000000 },
            { symbol: "WALMEX.MX", name: "Walmart de México", price: 65.1, changePct: -0.3, volume: 9000000 },
            { symbol: "BIMBOA.MX", name: "Grupo Bimbo", price: 77.8, changePct: 1.2, volume: 6000000 },
          ]);
        } else {
          setRows([
            { symbol: "AAPL", name: "Apple", price: 180.2, changePct: 0.5, volume: 80000000 },
            { symbol: "MSFT", name: "Microsoft", price: 410.8, changePct: -0.2, volume: 35000000 },
            { symbol: "TSLA", name: "Tesla", price: 230.3, changePct: 1.1, volume: 70000000 },
          ]);
        }
        const nextCount = start + syms.length;
        setLoadedCount(nextCount);
        setHasMore(nextCount < all.length);
      } else if (list.length) {
        setRows(prev => [...prev, ...list]);
        const nextCount = start + list.length;
        setLoadedCount(nextCount);
        if (nextCount >= all.length) setHasMore(false);
      } else {
        // 本批为空：跳过并继续尝试下一批
        const nextCount = start + syms.length;
        setLoadedCount(nextCount);
        setHasMore(nextCount < all.length);
      }
    } catch {
      // 忽略错误，保持当前已加载内容，尝试下一批
      const nextCount = start + syms.length;
      setLoadedCount(nextCount);
      setHasMore(nextCount < all.length);
    } finally {
      if (isInitial) setLoading(false); else setLoadingMore(false);
    }
  }, [loadingMore, hasMore, PAGE_SIZE, loadedCount, market, getAllSymbols]);

  // USD→MXN 汇率（10 分钟缓存）
  async function getUSDToMXNRate() {
    const k = "fx:USD:MXN";
    const raw = localStorage.getItem(k);
    if (raw) {
      try {
        const obj = JSON.parse(raw);
        if (Date.now() - (obj.ts || 0) < 10 * 60 * 1000 && obj.rate) return obj.rate;
      } catch {}
    }
    try {
      const j = await fetch("https://open.er-api.com/v6/latest/USD").then(r=>r.json());
      const rate = Number(j?.rates?.MXN || 18.0);
      localStorage.setItem(k, JSON.stringify({ ts: Date.now(), rate }));
      return rate;
    } catch {
      return 18.0;
    }
  }

  

  const firstLoadRef = useRef(true);
  const fetchMarket = useCallback(async () => {
    setError("");
    if (firstLoadRef.current) setLoading(true);
    setLoadedCount(0); setHasMore(true); setLoadingMore(false);
    try {
      if (market === "crypto") {
        const bases = ["BTC","ETH","BNB","SOL","XRP","ADA","DOGE","TON","LTC","TRX"];
        const nameMap = { BTC: "Bitcoin", ETH: "Ethereum", BNB: "BNB", SOL: "Solana", XRP: "XRP", ADA: "Cardano", DOGE: "Dogecoin", TON: "Toncoin", LTC: "Litecoin", TRX: "TRON" };
        const quotes = await getCryptoQuotes({ symbols: bases });
        const { rate } = await getUsdMxnRate();
        const list = quotes.map(q => ({
          symbol: q.symbol,
          name: nameMap[q.symbol] || q.name || q.symbol,
          priceUSD: Number(q.priceUSD || q.price || 0),
          priceMXN: Number(q.priceUSD || q.price || 0) * rate,
          changePct: Number(q.changePct || 0),
          volume: Number(q.volume || 0),
        }));
        setRows(list);
        setHasMore(false);
      } else {
        await loadNextBatch(true);
      }
    } catch (_e) {
      if (market === "mx") {
        setRows([
          { symbol: "AMXL.MX", name: "América Móvil", price: 17.2, changePct: 0.8, volume: 12000000 },
          { symbol: "WALMEX.MX", name: "Walmart de México", price: 65.1, changePct: -0.3, volume: 9000000 },
          { symbol: "BIMBOA.MX", name: "Grupo Bimbo", price: 77.8, changePct: 1.2, volume: 6000000 },
        ]);
        setHasMore(false);
      } else if (market === "us") {
        setRows([
          { symbol: "AAPL", name: "Apple", price: 180.2, changePct: 0.5, volume: 80000000 },
          { symbol: "MSFT", name: "Microsoft", price: 410.8, changePct: -0.2, volume: 35000000 },
          { symbol: "TSLA", name: "Tesla", price: 230.3, changePct: 1.1, volume: 70000000 },
        ]);
        setHasMore(false);
      } else {
        setRows([
          { symbol: "BTC", name: "Bitcoin", priceUSD: 65000, priceMXN: 65000 * 18, changePct: 0.8, volume: 1_200_000_000 },
          { symbol: "ETH", name: "Ethereum", priceUSD: 2500, priceMXN: 2500 * 18, changePct: -0.6, volume: 800_000_000 },
        ]);
        setHasMore(false);
      }
    } finally { setLoading(false); firstLoadRef.current = false; }
  }, [market, loadNextBatch]);

  useEffect(() => { fetchMarket(); }, [market]);

  // 加密市场定时刷新：每1秒更新一次（股票/美股仍按分页拉取）
  useEffect(() => {
    if (market !== "crypto") return;
    let STOPPED = false;
    const tick = async () => {
      try {
        if (document.hidden) return;
        const prevRows = rowsRef.current || [];
        const bases = prevRows.length ? prevRows.map(r => r.symbol) : ["BTC","ETH","BNB","SOL","XRP","ADA","DOGE","TON","LTC","TRX"];
        const quotes = await getCryptoQuotes({ symbols: bases });
        const { rate } = await getUsdMxnRate();
        const bySym = new Map(quotes.map(q => [q.symbol, q]));
        setRows(prev => prev.map(r => {
          const q = bySym.get(r.symbol) || {};
          const priceUSD = Number(q.priceUSD || q.price || r.priceUSD || 0);
          const next = {
            ...r,
            priceUSD,
            priceMXN: priceUSD * rate,
            changePct: Number(q.changePct || r.changePct || 0),
            volume: Number(q.volume || r.volume || 0),
          };
          const same = (
            Number(next.priceUSD) === Number(r.priceUSD) &&
            Number(next.priceMXN) === Number(r.priceMXN) &&
            Number(next.changePct) === Number(r.changePct) &&
            Number(next.volume) === Number(r.volume)
          );
          return same ? r : next;
        }));
      } catch {}
    };
    tick();
    const timer = setInterval(tick, 3_000);
    return () => { clearInterval(timer); };
  }, [market]);

  // 股票页（美股/墨股）自适应轻量轮询：默认 MX 5s、US 2s；页面不可见时暂停
  // 可通过环境变量或 localStorage 动态调整：
  // - VITE_MARKET_POLL_MS（通用）或 VITE_MARKET_POLL_MS_MX / VITE_MARKET_POLL_MS_US（细分）
  // - localStorage['poll:market:mx:ms'] / localStorage['poll:market:us:ms']
  useEffect(() => {
    if (market === "crypto") return; // 加密已单独轮询
    let cancelled = false;
    const readPollMs = () => {
      try {
        const envAll = Number(import.meta.env?.VITE_MARKET_POLL_MS || 0);
        const envMx = Number(import.meta.env?.VITE_MARKET_POLL_MS_MX || 0);
        const envUs = Number(import.meta.env?.VITE_MARKET_POLL_MS_US || 0);
        const ls = Number(localStorage.getItem(`poll:market:${market}:ms`) || 0);
        const def = market === "mx" ? 5000 : 2000;
        const envSpec = market === "mx" ? envMx : envUs;
        const pick = (n) => (Number.isFinite(n) && n > 0 ? n : 0);
        return pick(ls) || pick(envSpec) || pick(envAll) || def;
      } catch { return market === "mx" ? 5000 : 2000; }
    };
    let pollMs = readPollMs();
    const tick = async () => {
      if (cancelled) return;
      if (document.hidden) return;
      // 只刷新当前已展示的 symbols，避免无限增长请求
      const syms = (rowsRef.current || []).map(r => r.symbol);
      if (!syms.length) return;
      try {
        const list = await getQuotes({ market, symbols: syms });
        if (Array.isArray(list) && list.length) {
          const bySym = new Map(list.map(r => [r.symbol, r]));
          setRows(prev => prev.map(r => {
            const next = bySym.get(r.symbol) || r;
            const same = (
              Number(next.price) === Number(r.price) &&
              Number(next.changePct) === Number(r.changePct) &&
              Number(next.volume) === Number(r.volume)
            );
            return same ? r : next;
          }));
        }
      } catch {}
    };
    let id = setInterval(tick, pollMs);
    // 监听 storage 中轮询配置的变化，动态调整（便于线上调参）
    const onStorage = (e) => {
      if (e?.key === `poll:market:${market}:ms`) {
        try { const next = Number(e.newValue || 0); if (Number.isFinite(next) && next > 0) {
          clearInterval(id);
          pollMs = next;
          id = setInterval(tick, pollMs);
        }} catch {}
      }
    };
    window.addEventListener('storage', onStorage);
    return () => { cancelled = true; clearInterval(id); window.removeEventListener('storage', onStorage); };
  }, [market]);

  useEffect(() => {
    setSearchRow(null);
    setSearchError("");
  }, [market]);

  

  // 底部哨兵：视口靠近底部时加载下一批
  useEffect(() => {
    if (market === "crypto") return; // Crypto 不分页
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          loadNextBatch(false);
        }
      }
    }, { root: null, rootMargin: "200px" });
    io.observe(el);
    return () => { io.disconnect(); };
  }, [market, hasMore, loadedCount, loadNextBatch]);

  const currency = market === "mx" ? "MXN" : market === "us" ? "USD" : cryptoCurrency;
  const title = market === "mx" ? t("stocksTitle") : market === "us" ? t("stocksTitleUS") : t("marketCrypto");

  const rowsToShow = useMemo(() => {
    const base = rows.slice();
    if (marketView === "gainers") return base.sort((a,b)=> (Number(b.changePct||0)) - (Number(a.changePct||0)));
    if (marketView === "losers") return base.sort((a,b)=> (Number(a.changePct||0)) - (Number(b.changePct||0)));
    if (marketView === "turnover") {
      const calcTurn = (r) => {
        if (market === "crypto") {
          const p = cryptoCurrency === "USD" ? Number(r.priceUSD || r.price || 0) : Number(r.priceMXN || 0);
          return Number(r.volume || 0) * p;
        }
        return Number(r.volume || 0) * Number(r.price || 0);
      };
      return base.sort((a,b)=> calcTurn(b) - calcTurn(a));
    }
    return base; // overview
  }, [rows, marketView, market, cryptoCurrency]);

  async function doSearch() {
    try {
      setSearchLoading(true); setSearchError("");
      if (market === "mx") {
        let q = (search.mx || "").trim().toUpperCase();
        if (!q) { setSearchRow(null); return; }
        if (!q.endsWith(".MX")) q = `${q}.MX`;
        const list = await getQuotes({ market: "mx", symbols: [q] });
        const row = list[0] || null;
        setSearchRow(row);
        if (!row) setSearchError(t("noMatches"));
        if (row) addRecent(row.symbol);
      } else if (market === "us") {
        let q = (search.us || "").trim().toUpperCase();
        if (!q) { setSearchRow(null); return; }
        const list = await getQuotes({ market: "us", symbols: [q] });
        const row = list[0] || null;
        setSearchRow(row);
        if (!row) setSearchError(t("noMatches"));
        if (row) addRecent(row.symbol);
      } else {
        let q = (search.crypto || "").trim().toUpperCase();
        if (!q) { setSearchRow(null); return; }
        let base = q.replace(/USDT$/,"" ).replace(/\/USD$/,"" );
        const rate = await getUSDToMXNRate();
        try {
          const list = await getCryptoQuotes({ symbols: [base] });
          const row = list[0];
          if (row) {
            setSearchRow({
              symbol: row.symbol,
              name: row.name || row.symbol,
              priceUSD: Number(row.priceUSD || row.price || 0),
              priceMXN: Number(row.priceUSD || row.price || 0) * rate,
              changePct: Number(row.changePct || 0),
              volume: Number(row.volume || 0),
            });
            addRecent(row.symbol);
          } else {
            setSearchRow(null);
          }
        } catch {
          setSearchRow(null);
        }
      }
    } catch (_e) {
      setSearchError(t("fetchError"));
    } finally { setSearchLoading(false); }
  }

  function onSearchKey(e) { if (e.key === "Enter") doSearch(); }
  const searchLabel = market === "mx" ? t("searchMX") : market === "us" ? t("searchUS") : t("searchCrypto");
  const searchPh = market === "mx" ? t("placeholderMX") : market === "us" ? t("placeholderUS") : t("placeholderCrypto");

  function normalizeText(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  }
  const MX_NAMES = {
    "AMXL.MX": "América Móvil, S.A.B. de C.V.",
    "AMXB.MX": "América Móvil, S.A.B. de C.V.",
    "WALMEX.MX": "Walmart de Mexico",
    "FEMSAUBD.MX": "FEMSA",
    "BIMBOA.MX": "Grupo Bimbo",
    "GMEXICOB.MX": "Grupo Mexico",
    "GFNORTEO.MX": "Banorte",
    "ALSEA.MX": "Alsea",
    "GAPB.MX": "GAP",
    "KIMBERA.MX": "Kimberly-Clark de Mexico",
    "TLEVISA.CPO.MX": "Televisa",
    "OMAB.MX": "OMA",
    "MEXCHEM.MX": "Orbia",
  };
  const US_NAMES = {
    AAPL: "Apple",
    MSFT: "Microsoft",
    AMZN: "Amazon",
    GOOGL: "Alphabet",
    TSLA: "Tesla",
    META: "Meta",
    NVDA: "NVIDIA",
    "BRK-B": "Berkshire Hathaway",
    JPM: "JPMorgan",
    NFLX: "Netflix",
    ORCL: "Oracle",
    INTC: "Intel",
  };
  const ALIASES = {
    mx: {
      "MEXCHEM.MX": ["ORBIA", "MEXICHEM"],
      "GFNORTEO.MX": ["BANORTE"],
      "AMXL.MX": ["AMERICA MOVIL", "AMÉRICA MÓVIL", "AMX", "AMXB"],
      "AMXB.MX": ["AMERICA MOVIL", "AMÉRICA MÓVIL", "AMX", "AMXL"],
      "WALMEX.MX": ["WALMART"],
      "TLEVISA.CPO.MX": ["TELEVISA"],
    },
    us: {
      META: ["FACEBOOK", "FB"],
      GOOGL: ["GOOGLE", "ALPHABET"],
      "BRK-B": ["BERKSHIRE", "BERKSHIRE HATHAWAY"],
      JPM: ["JP MORGAN", "JPMORGAN"],
      NVDA: ["NVIDIA CORP"],
    },
    crypto: {
      BTC: ["BITCOIN"], ETH: ["ETHEREUM"], BNB: ["BNB"], SOL: ["SOLANA"], XRP: ["XRP"], ADA: ["CARDANO"], DOGE: ["DOGECOIN"], TON: ["TONCOIN"], LTC: ["LITECOIN"], TRX: ["TRON"],
    }
  };
  function computeSuggestions(val) {
    const nv = normalizeText(String(val || "").trim());
    if (!nv) return [];
    const nvBase = nv.replace(/USDT$/, "");
    if (market === "mx") {
      const candidates = MX_SYMBOLS.map(s => ({ symbol: s, name: MX_NAMES[s] || s.replace(/\.MX$/, "") }));
      return candidates.filter(c => {
        const ns = normalizeText(c.symbol.replace(/\.MX$/, ""));
        const nn = normalizeText(c.name);
        const aliases = (ALIASES.mx[c.symbol] || []).map(normalizeText);
        return ns.includes(nvBase) || nn.includes(nvBase) || aliases.some(a => a.includes(nvBase) || nvBase.includes(a));
      }).slice(0, 8);
    }
    if (market === "us") {
      const candidates = US_SYMBOLS.map(s => ({ symbol: s, name: US_NAMES[s] || s }));
      return candidates.filter(c => {
        const ns = normalizeText(c.symbol);
        const nn = normalizeText(c.name);
        const aliases = (ALIASES.us[c.symbol] || []).map(normalizeText);
        return ns.includes(nvBase) || nn.includes(nvBase) || aliases.some(a => a.includes(nvBase) || nvBase.includes(a));
      }).slice(0, 8);
    }
    const candidates = rows.map(r => ({ symbol: r.symbol, name: r.name || r.symbol }));
    return candidates.filter(c => {
      const ns = normalizeText(c.symbol);
      const nn = normalizeText(c.name);
      const aliases = (ALIASES.crypto[c.symbol] || []).map(normalizeText);
      return ns.includes(nvBase) || nn.includes(nvBase) || aliases.some(a => a.includes(nvBase) || nvBase.includes(a));
    }).slice(0, 8);
  }

  function pickSuggestion(sym) {
    const val = sym;
    setSearch(s => ({ ...s, [market]: val }));
    setShowSug(false);
    setTimeout(() => { doSearch(); }, 0);
  }
  function toggleFavorite(sym) {
    setFavorites(prev => {
      const arr = prev[market] || [];
      const exists = arr.includes(sym);
      const next = exists ? arr.filter(s => s !== sym) : [sym, ...arr].slice(0, 20);
      return { ...prev, [market]: next };
    });
  }
  function addRecent(sym) {
    setRecents(prev => {
      const arr = prev[market] || [];
      const next = [sym, ...arr.filter(s => s !== sym)].slice(0, 10);
      return { ...prev, [market]: next };
    });
  }
  function removeRecent(sym) {
    setRecents(prev => {
      const arr = prev[market] || [];
      const next = arr.filter(s => s !== sym);
      return { ...prev, [market]: next };
    });
  }
  function clearRecents() {
    setRecents(prev => ({ ...prev, [market]: [] }));
  }
  function currentSearchVal() {
    return market === "mx" ? search.mx : market === "us" ? search.us : search.crypto;
  }
  function highlightMatch(text) {
    const q = String(currentSearchVal() || "").trim();
    const base = q.replace(/USDT$/i, "");
    if (!base) return text;
    const t = String(text || "");
    const idx = t.toUpperCase().indexOf(base.toUpperCase());
    if (idx < 0) return t;
    const end = idx + base.length;
    return (
      <>
        {t.slice(0, idx)}
        <mark className="hl">{t.slice(idx, end)}</mark>
        {t.slice(end)}
      </>
    );
  }

  return (
    <div className="screen market-screen" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* 固定导航栏 */}
      <div className="market-navigation-fixed" style={{ position: 'fixed', width: '100%' }}>
        <div className="card" style={{ marginBottom: 0 }}>
          <h1 className="title">{t("marketPageTitle")}</h1>
          {/* 顶部切换：市场 */}
          <div className="market-tabs" role="tablist" aria-label="top-switch">
            <div className="dropdown-nav">
              <button 
                className={`pill dropdown-trigger active`} 
                onClick={() => {
                  // 移动端点击切换下拉菜单显示
                  if (window.innerWidth <= 767) {
                    setShowMobileDropdown(!showMobileDropdown);
                  }
                }}
              >
                {t("tabMarket")} ▼
              </button>
              <div className={`dropdown-menu ${showMobileDropdown && window.innerWidth <= 767 ? 'mobile-show' : ''}`}>
                <div className="dropdown-section">
                  <span className="dropdown-label">{t("labelMarket")}</span>
                  <button className={`dropdown-item ${market === "mx" ? "active" : ""}`} onClick={() => {
                    setMarket("mx");
                    setShowMobileDropdown(false);
                  }}>{t("marketMX")}</button>
                  <button className={`dropdown-item ${market === "us" ? "active" : ""}`} onClick={() => {
                    setMarket("us");
                    setShowMobileDropdown(false);
                  }}>{t("marketUS")}</button>
                  <button className={`dropdown-item ${market === "crypto" ? "active" : ""}`} onClick={() => {
                    setMarket("crypto");
                    setShowMobileDropdown(false);
                  }}>{t("marketCrypto")}</button>
                </div>
                <div className="dropdown-section">
                  <span className="dropdown-label">{t("labelView")}</span>
                  <button className={`dropdown-item ${marketView === "overview" ? "active" : ""}`} onClick={() => {
                    setMarketView("overview");
                    setShowMobileDropdown(false);
                  }}>{t("viewOverview")}</button>
                  <button className={`dropdown-item ${marketView === "gainers" ? "active" : ""}`} onClick={() => {
                    setMarketView("gainers");
                    setShowMobileDropdown(false);
                  }}>{t("viewTopGainers")}</button>
                  <button className={`dropdown-item ${marketView === "losers" ? "active" : ""}`} onClick={() => {
                    setMarketView("losers");
                    setShowMobileDropdown(false);
                  }}>{t("viewTopLosers")}</button>
                  <button className={`dropdown-item ${marketView === "turnover" ? "active" : ""}`} onClick={() => {
                    setMarketView("turnover");
                    setShowMobileDropdown(false);
                  }}>{t("viewTurnover")}</button>
                </div>
                {market === "crypto" && (
                  <div className="dropdown-section">
                    <span className="dropdown-label">{t("labelCurrency")}</span>
                    <button className={`dropdown-item ${cryptoCurrency === "USD" ? "active" : ""}`} onClick={() => {
                      setCryptoCurrency("USD");
                      setShowMobileDropdown(false);
                    }}>USD</button>
                    <button className={`dropdown-item ${cryptoCurrency === "MXN" ? "active" : ""}`} onClick={() => {
                      setCryptoCurrency("MXN");
                      setShowMobileDropdown(false);
                    }}>MXN</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 内容区域 */}
      <div className="market-content" style={{ position: 'relative' }}>
        <div className="card">
          <>
            <div className="search-row" style={{ marginTop: 8 }}>
              <label className="desc search-label" htmlFor="market-search">{searchLabel}</label>
              <input
                id="market-search"
                type="text"
                value={market === "mx" ? search.mx : market === "us" ? search.us : search.crypto}
                onChange={(e) => { const v = e.target.value; setSearch(s => ({ ...s, [market]: v })); setSuggestions(computeSuggestions(v)); setShowSug(true); }}
                onKeyDown={onSearchKey}
                onFocus={() => { setShowSug(true); setSuggestions(computeSuggestions(market === "mx" ? search.mx : market === "us" ? search.us : search.crypto)); }}
                onBlur={() => setTimeout(() => setShowSug(false), 120)}
                placeholder={searchPh}
                className="search-input"
                style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #263b5e", background: "rgba(21,32,53,0.6)", color: "#a8b3cf" }}
              />
              <button className="pill" onClick={doSearch} disabled={searchLoading} aria-busy={searchLoading}>
                {t("search")}
              </button>
              {showSug && (
                <div className="suggestion-list">
                  {suggestions.length ? suggestions.map((sug) => (
                    <div key={`sug-${sug.symbol}`} className="suggestion-item" onMouseDown={() => pickSuggestion(sug.symbol)}>
                      <span className="sug-symbol">{highlightMatch(sug.symbol)}</span>
                      <span className="sug-sep">·</span>
                      <span className="sug-name">{highlightMatch(sug.name)}</span>
                    </div>
                  )) : (
                    <div className="suggestion-item empty">{t("noMatches")}</div>
                  )}
                </div>
              )}
            </div>
            {/* 收藏与最近搜索 chips */}
            <div className="chips-row">
              <span className="desc" style={{ minWidth: 100 }}>{t("favorites")}</span>
              {(favorites[market] || []).map(sym => (
                <div key={`fav-${sym}`} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <button
                    className="pill chip"
                    onClick={() => { setSearch(s => ({ ...s, [market]: sym })); setTimeout(() => doSearch(), 0); }}
                    aria-label={`fav-${sym}`}
                  >
                    ★ {sym}
                  </button>
                  <button
                    className="pill pill-mini chip-remove"
                    onClick={() => toggleFavorite(sym)}
                    aria-label={`remove-fav-${sym}`}
                  >×</button>
                </div>
              ))}
            </div>
            <div className="chips-row">
              <span className="desc" style={{ minWidth: 100 }}>{t("recentSearches")}</span>
              <button className="pill pill-mini" onClick={clearRecents} aria-label="clear-recents" style={{ marginRight: 6 }}>{t("clear")}</button>
              {(recents[market] || []).map(sym => (
                <div key={`rec-${sym}`} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <button
                    className="pill chip"
                    onClick={() => { setSearch(s => ({ ...s, [market]: sym })); setTimeout(() => doSearch(), 0); }}
                    aria-label={`rec-${sym}`}
                  >
                    {sym}
                  </button>
                  <button className="pill pill-mini chip-remove" onClick={() => removeRecent(sym)} aria-label={`remove-rec-${sym}`}>×</button>
                </div>
              ))}
            </div>
            {searchError && <p className="error" style={{ marginTop: 6 }}>{searchError}</p>}
            {searchRow && (
              <table className="data-table" aria-label="search-result" style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th>{t('symbol')}</th>
                    <th>{t('name')}</th>
                    <th>{t("price")}</th>
                    <th>{t("change24h")}</th>
                    <th>{t("volume")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const r = searchRow;
                    const pct = Number(r?.changePct || 0);
                    const color = pct > 0 ? "#5cff9b" : pct < 0 ? "#ff5c7a" : "#a8b3cf";
                    const priceVal = market === "crypto" ? (cryptoCurrency === "USD" ? (r.priceUSD || r.price || 0) : (r.priceMXN || 0)) : r.price;
                    const detailsUrl = (() => {
                      if (market === "mx" || market === "us") return `https://finance.yahoo.com/quote/${encodeURIComponent(r.symbol)}`;
                      return `https://www.binance.com/en/trade/${encodeURIComponent(r.symbol)}_USDT?theme=dark`;
                    })();
                    return (
                      <tr key={`search-${r.symbol}`} style={{ background: "rgba(91,141,239,0.08)" }}>
                        <td>{r.symbol}</td>
                        <td>
                          {r.name || r.symbol}
                          {detailsUrl && (
                            <a className="link" href={detailsUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 8, fontSize: 12 }}>{t("viewDetails")}</a>
                          )}
                          <button
                            className="pill pill-mini"
                            onClick={() => navigate(`/market/${encodeURIComponent(r.symbol)}`)}
                            style={{ marginLeft: 6, fontSize: 12, padding: "2px 6px" }}
                            aria-label={`view-in-app-${r.symbol}`}
                          >
                            {t("viewInApp")}
                          </button>
                          <button
                            onClick={() => toggleFavorite(r.symbol)}
                            className="pill pill-mini"
                            style={{ marginLeft: 8, fontSize: 12, padding: "2px 6px" }}
                            aria-label="toggle-favorite"
                          >
                            {(favorites[market] || []).includes(r.symbol) ? `★ ${t("removeFav")}` : `☆ ${t("addFav")}`}
                          </button>
                        </td>
                        <td>{market === "crypto" ? formatPrice(priceVal, cryptoCurrency, lang) : formatPrice(priceVal, currency, lang)}</td>
                        <td style={{ color }}>{pct.toFixed(2)}%</td>
                        <td>{formatVolume(r.volume, lang)}</td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            )}

            <h2 className="title" style={{ marginTop: 8 }}>{title}</h2>
            {error && <p className="error">{error}</p>}
            <table className="data-table" aria-label="market-table">
                <thead>
                  <tr>
                    <th>{t('symbol')}</th>
                    <th>{t('name')}</th>
                    <th>{t("price")}</th>
                    <th>{t("change24h")}</th>
                    <th>{t("volume")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsToShow.map((r) => {
                    const pct = Number(r.changePct || 0);
                    const color = pct > 0 ? "#5cff9b" : pct < 0 ? "#ff5c7a" : "#a8b3cf";
                    return (
                      <tr key={r.symbol}>
                        <td>{r.symbol}</td>
                        <td>
                          {r.name || r.symbol}
                          <button
                            onClick={() => toggleFavorite(r.symbol)}
                            className="favorite-star"
                            style={{ marginLeft: 8, border: 'none', background: 'transparent', color: (favorites[market] || []).includes(r.symbol) ? '#ffd700' : '#a8b3cf', cursor: 'pointer' }}
                            aria-label={`fav-${r.symbol}`}
                          >
                            {(favorites[market] || []).includes(r.symbol) ? "★" : "☆"}
                          </button>
                        </td>
                        <td>{market === "crypto" ? formatPrice(
                          cryptoCurrency === "USD" ? (r.priceUSD || r.price || 0) : (r.priceMXN || 0),
                          cryptoCurrency,
                          lang
                        ) : formatPrice(r.price, currency, lang)}</td>
                        <td style={{ color }}>{pct.toFixed(2)}%</td>
                        <td>{formatVolume(r.volume, lang)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            {loading && <p className="desc" style={{ marginTop: 6 }}>{t('loadingMore') || 'Loading...'}</p>}
            {/* 加载更多状态与哨兵 */}
            {market !== "crypto" && (
              <div style={{ marginTop: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {loadingMore && <span className="desc">{t("loadingMore") || "Loading more..."}</span>}
                {!loadingMore && !hasMore && <span className="desc">{t("noMoreData") || "No more data"}</span>}
                <div ref={sentinelRef} style={{ width: 1, height: 1 }} aria-hidden="true" />
              </div>
            )}
          </>
        </div>
      </div>

      <BottomNav />
    </div>
  );
}