import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import BottomNav from "../components/BottomNav.jsx";
import { useI18n } from "../i18n.jsx";
import { getQuotes, getCryptoQuotes, getUsdPlnRate } from "../services/marketData.js";
import "../styles/market-tabs.css";
import { formatMoney as fmMoney, formatNumber } from "../utils/money.js";
import { createPortal } from "react-dom";

 

// 波兰华沙证券交易所 (WSE) 主要股票
const PL_SYMBOLS = [
  "PKO.WA","PKN.WA","PZU.WA","KGH.WA","PEO.WA","LPP.WA",
  "DNP.WA","ALR.WA","CDR.WA","CCC.WA","OPL.WA","CPS.WA",
  // 额外补充常见成分，确保 ≥20
  "MBK.WA","SPL.WA","JSW.WA","TPE.WA","ENA.WA","LTS.WA",
  "KRU.WA","PCO.WA"
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
  const locale = lang === "pl" ? "pl-PL" : (lang === "zh" ? "zh-CN" : "en-US");
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
function formatDateText(s, lang) {
  try {
    const d = new Date(String(s||'').trim());
    if (isNaN(d.getTime())) return '';
    const locale = lang === 'pl' ? 'pl-PL' : (lang === 'zh' ? 'zh-CN' : 'en-US');
    return d.toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch { return ''; }
}

// Format time as YYYY-MM-DD HH:mm
 

export default function Market() {
  const { lang, t } = useI18n();
  const navigate = useNavigate();
  const [market, setMarket] = useState("us"); // pl | us | crypto
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
  const [search, setSearch] = useState({ pl: "", us: "", crypto: "" });
  const [searchRow, setSearchRow] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [showSug, setShowSug] = useState(false);
  const [favorites, setFavorites] = useState(() => {
    try {
      const o = JSON.parse(localStorage.getItem("market:favorites") || "{}");
      return { pl: o.pl || [], us: o.us || [], crypto: o.crypto || [] };
    } catch { return { pl: [], us: [], crypto: [] }; }
  });
  const [recents, setRecents] = useState(() => {
    try {
      const o = JSON.parse(localStorage.getItem("market:recents") || "{}");
      return { pl: o.pl || [], us: o.us || [], crypto: o.crypto || [] };
    } catch { return { pl: [], us: [], crypto: [] }; }
  });

  // News state
  const [news, setNews] = useState([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [showNews, setShowNews] = useState(false);
  const [newsIndex, setNewsIndex] = useState(0);
  const [showNewsList, setShowNewsList] = useState(false);
  const touchRef = useRef({ x: 0, y: 0 });
  useEffect(() => { try { if (showNews) document.body.classList.add('modal-open'); else document.body.classList.remove('modal-open'); } catch {} return () => { try { document.body.classList.remove('modal-open'); } catch {} }; }, [showNews]);

  async function ensureNewsContent(idx) {
    try {
      const it = (news || [])[idx] || {};
      if (!it) return;
      const hasContent = typeof it.content === 'string' && it.content.trim().length > 0;
      if (hasContent) return;
      if (Number.isFinite(Number(it.id))) {
        const r = await fetch(`/api/news/get?id=${encodeURIComponent(String(it.id))}`).then(res=>res.json()).catch(()=>null);
        const item = r && r.item ? r.item : null;
        if (item && item.content) {
          setNews(prev => prev.map((n, i) => i === idx ? { ...n, content: String(item.content||'') } : n));
        }
      }
    } catch {}
  }
  useEffect(() => { if (showNews) { try { ensureNewsContent(newsIndex); } catch {} } }, [showNews, newsIndex]);

  const fetchMxInvestNews = useCallback(async () => {
    try {
      setNewsLoading(true);
      setShowNewsList(true);
      setNews([]);
      const cacheKey = `market:news:${market}`;
      const cached = (() => { try { return JSON.parse(localStorage.getItem(cacheKey)||'null')||null } catch { return null } })();
      const r = await fetch(`/api/news/feed?market=${encodeURIComponent(market)}&lang=${encodeURIComponent(lang)}`);
      const j = await r.json().catch(()=>({ items: [] }));
      let list = Array.isArray(j?.items) ? j.items.slice(0, 30) : [];
      if (!list.length) {
        const r2 = await fetch(`/api/news/pl?lang=${encodeURIComponent(lang)}`).catch(()=>null);
        const j2 = r2 ? await r2.json().catch(()=>({ items: [] })) : { items: [] };
        list = Array.isArray(j2.items) ? j2.items.slice(0, 30) : [];
      }
      if (list.length) {
        setNews(list);
        setNewsIndex(0);
        try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), items: list })) } catch {}
      } else if (cached && Array.isArray(cached.items) && cached.items.length) {
        setNews(cached.items);
        setNewsIndex(0);
      } else {
        setNews([]);
      }
    } catch {
      const cacheKey = `market:news:${market}`;
      const cached = (() => { try { return JSON.parse(localStorage.getItem(cacheKey)||'null')||null } catch { return null } })();
      if (cached && Array.isArray(cached.items) && cached.items.length) {
        setNews(cached.items);
        setNewsIndex(0);
      } else {
        setNews([]);
      }
    } finally { setNewsLoading(false); }
  }, []);

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
    if (market === "pl") return PL_SYMBOLS;
    if (market === "us") return US_SYMBOLS;
    return [];
  }, [market]);

  

  // 波兰股票兜底数据（API失败时使用）
  const PL_FALLBACK = useMemo(() => [
    { symbol: "PKO.WA", name: "PKO Bank Polski", price: 52.80, changePct: 0.8, volume: 12000000 },
    { symbol: "PKN.WA", name: "PKN Orlen", price: 68.50, changePct: -0.3, volume: 9000000 },
    { symbol: "PZU.WA", name: "PZU SA", price: 45.20, changePct: 1.2, volume: 6000000 },
    { symbol: "KGH.WA", name: "KGHM Polska Miedź", price: 142.00, changePct: 0.1, volume: 3000000 },
    { symbol: "PEO.WA", name: "Bank Pekao", price: 165.80, changePct: -0.2, volume: 5000000 },
    { symbol: "LPP.WA", name: "LPP SA", price: 15850.00, changePct: 0.3, volume: 4000000 },
    { symbol: "DNP.WA", name: "Dino Polska", price: 428.50, changePct: 0.6, volume: 2500000 },
    { symbol: "ALR.WA", name: "Alior Bank", price: 82.40, changePct: -0.1, volume: 1800000 },
    { symbol: "CDR.WA", name: "CD Projekt", price: 185.60, changePct: 0.2, volume: 2100000 },
    { symbol: "CCC.WA", name: "CCC SA", price: 128.90, changePct: -0.4, volume: 3200000 },
    { symbol: "OPL.WA", name: "Orange Polska", price: 8.25, changePct: 0.5, volume: 2800000 },
    { symbol: "CPS.WA", name: "Cyfrowy Polsat", price: 14.60, changePct: -0.2, volume: 1500000 },
    { symbol: "MBK.WA", name: "mBank", price: 580.00, changePct: 0.4, volume: 900000 },
    { symbol: "SPL.WA", name: "Santander Bank Polska", price: 485.00, changePct: 0.1, volume: 750000 },
    { symbol: "JSW.WA", name: "JSW SA", price: 28.50, changePct: -1.2, volume: 4500000 },
    { symbol: "TPE.WA", name: "Tauron Polska Energia", price: 4.85, changePct: 0.3, volume: 6000000 },
    { symbol: "ENA.WA", name: "Enea SA", price: 9.20, changePct: -0.5, volume: 3200000 },
    { symbol: "LTS.WA", name: "Lotos SA", price: 72.40, changePct: 0.2, volume: 1100000 },
    { symbol: "KRU.WA", name: "Kruk SA", price: 425.00, changePct: 0.8, volume: 450000 },
    { symbol: "PCO.WA", name: "Pepco Group", price: 38.50, changePct: -0.3, volume: 680000 },
  ], []);

  // 美股兜底数据
  const US_FALLBACK = useMemo(() => [
            { symbol: "AAPL", name: "Apple", price: 180.2, changePct: 0.5, volume: 80000000 },
            { symbol: "MSFT", name: "Microsoft", price: 410.8, changePct: -0.2, volume: 35000000 },
            { symbol: "TSLA", name: "Tesla", price: 230.3, changePct: 1.1, volume: 70000000 },
            { symbol: "AMZN", name: "Amazon", price: 175.0, changePct: 0.4, volume: 60000000 },
            { symbol: "GOOGL", name: "Alphabet", price: 135.6, changePct: -0.1, volume: 28000000 },
            { symbol: "META", name: "Meta", price: 330.4, changePct: 0.3, volume: 22000000 },
            { symbol: "NVDA", name: "NVIDIA", price: 480.7, changePct: 0.9, volume: 50000000 },
            { symbol: "JPM", name: "JPMorgan", price: 150.2, changePct: -0.2, volume: 18000000 },
            { symbol: "ORCL", name: "Oracle", price: 110.9, changePct: 0.2, volume: 16000000 },
            { symbol: "INTC", name: "Intel", price: 38.5, changePct: 0.1, volume: 35000000 },
  ], []);

  const loadNextBatch = useCallback(async (isInitial = false, targetMarket = market) => {
    if (!isInitial && (loadingMore || !hasMore)) return;
    // 使用传入的目标市场，而不是闭包中的市场
    const all = targetMarket === "pl" ? PL_SYMBOLS : targetMarket === "us" ? US_SYMBOLS : [];
    const start = isInitial ? 0 : loadedCount;
    const syms = all.slice(start, start + PAGE_SIZE);
    if (!syms.length) { setHasMore(false); return; }
    if (isInitial) setLoading(true); else setLoadingMore(true);
    
    // 波兰股票：由于API限制，直接使用兜底数据
    if (targetMarket === "pl" && isInitial) {
      console.log("[Market] Using Polish stock fallback data directly");
      setRows(PL_FALLBACK);
      setHasMore(false);
      setLoading(false);
      return;
    }
    
    // 设置超时，如果API响应太慢则使用兜底数据
    const timeout = 8000; // 8秒超时
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error('API timeout'));
      }, timeout);
    });
    
    try {
      const list = await Promise.race([
        getQuotes({ market: targetMarket, symbols: syms }),
        timeoutPromise
      ]);
      
      // 过滤：确保只显示属于当前市场的股票
      const filteredList = (Array.isArray(list) ? list : []).filter(item => {
        if (targetMarket === "pl") {
          // 波兰股票必须包含 .WA 后缀
          return String(item.symbol || "").includes(".WA");
        } else if (targetMarket === "us") {
          // 美国股票不能包含 .WA 后缀
          return !String(item.symbol || "").includes(".WA");
        }
        return true;
      });
      
      // 验证数据质量：检查是否有有效价格
      const validList = filteredList.filter(item => {
        const price = Number(item.price || 0);
        return Number.isFinite(price) && price > 0;
      });
      
      // 关键修复：如果返回的数据不足请求数量的50%，视为API不可用，使用兜底数据
      const minRequired = Math.ceil(syms.length * 0.5);
      const hasEnoughData = validList.length >= minRequired;
      
      if (isInitial) {
        if (hasEnoughData) {
          // API返回了足够的数据，使用API数据
          setRows(validList);
          const nextCount = start + validList.length;
        setLoadedCount(nextCount);
          if (nextCount >= all.length) setHasMore(false);
        } else {
          // API数据不足，使用完整的兜底数据
          const fallback = targetMarket === "pl" ? PL_FALLBACK : US_FALLBACK;
          setRows(fallback);
          setHasMore(false);
        }
      } else {
        // 非初始加载：追加数据
        if (validList.length) {
          setRows(prev => [...prev, ...validList]);
          const nextCount = start + validList.length;
        setLoadedCount(nextCount);
        if (nextCount >= all.length) setHasMore(false);
      } else {
        const nextCount = start + syms.length;
        setLoadedCount(nextCount);
        setHasMore(nextCount < all.length);
        }
      }
    } catch {
      // API失败：使用兜底数据
      if (isInitial) {
        const fallback = targetMarket === "pl" ? PL_FALLBACK : US_FALLBACK;
        setRows(fallback);
        setHasMore(false);
      } else {
      const nextCount = start + syms.length;
      setLoadedCount(nextCount);
      setHasMore(nextCount < all.length);
      }
    } finally {
      if (isInitial) setLoading(false); else setLoadingMore(false);
    }
  }, [loadingMore, hasMore, PAGE_SIZE, loadedCount, market, PL_FALLBACK, US_FALLBACK]);

  

  

  const firstLoadRef = useRef(true);
  const fetchIdRef = useRef(0); // 使用递增 ID 追踪请求，防止竞态
  
  // 加密货币兜底数据
  const cryptoFallback = useMemo(() => [
    { symbol: "BTC", name: "Bitcoin", priceUSD: 98000, pricePLN: 392000, changePct: 1.2, volume: 45_000_000_000 },
    { symbol: "ETH", name: "Ethereum", priceUSD: 3400, pricePLN: 13600, changePct: 0.8, volume: 18_000_000_000 },
    { symbol: "BNB", name: "BNB", priceUSD: 680, pricePLN: 2720, changePct: -0.3, volume: 2_000_000_000 },
    { symbol: "SOL", name: "Solana", priceUSD: 190, pricePLN: 760, changePct: 2.5, volume: 4_500_000_000 },
    { symbol: "XRP", name: "XRP", priceUSD: 2.3, pricePLN: 9.2, changePct: 1.8, volume: 8_000_000_000 },
    { symbol: "ADA", name: "Cardano", priceUSD: 0.95, pricePLN: 3.8, changePct: 0.5, volume: 1_200_000_000 },
    { symbol: "DOGE", name: "Dogecoin", priceUSD: 0.38, pricePLN: 1.52, changePct: 3.2, volume: 3_500_000_000 },
    { symbol: "TON", name: "Toncoin", priceUSD: 5.8, pricePLN: 23.2, changePct: -1.1, volume: 500_000_000 },
    { symbol: "LTC", name: "Litecoin", priceUSD: 105, pricePLN: 420, changePct: 0.9, volume: 800_000_000 },
    { symbol: "TRX", name: "TRON", priceUSD: 0.25, pricePLN: 1, changePct: 0.3, volume: 600_000_000 },
  ], []);
  
  const fetchMarket = useCallback(async () => {
    const targetMarket = market;
    const myFetchId = ++fetchIdRef.current; // 分配唯一请求 ID
    
    setError("");
    if (firstLoadRef.current) setLoading(true);
    setLoadedCount(0); setHasMore(true); setLoadingMore(false);
    setRows([]); // 清空旧数据
    
    try {
      if (targetMarket === "crypto") {
        const bases = ["BTC","ETH","BNB","SOL","XRP","ADA","DOGE","TON","LTC","TRX"];
        const nameMap = { BTC: "Bitcoin", ETH: "Ethereum", BNB: "BNB", SOL: "Solana", XRP: "XRP", ADA: "Cardano", DOGE: "Dogecoin", TON: "Toncoin", LTC: "Litecoin", TRX: "TRON" };
        
        let quotes = [];
        let rate = 4;
        
        try {
          quotes = await getCryptoQuotes({ symbols: bases });
        } catch {
          quotes = [];
        }
        
        // 检查是否还是同一个请求
        if (fetchIdRef.current !== myFetchId) return;
        
        try {
          const rateRes = await getUsdPlnRate();
          rate = rateRes.rate || 4;
        } catch {
          rate = 4;
        }
        
        // 再次检查
        if (fetchIdRef.current !== myFetchId) return;
        
        // 如果获取到有效数据，使用 API 数据；否则使用兜底数据
        if (Array.isArray(quotes) && quotes.length > 0) {
        const list = quotes.map(q => ({
          symbol: q.symbol,
          name: nameMap[q.symbol] || q.name || q.symbol,
          priceUSD: Number(q.priceUSD || q.price || 0),
          pricePLN: Number(q.priceUSD || q.price || 0) * rate,
          changePct: Number(q.changePct || 0),
          volume: Number(q.volume || 0),
        }));
        setRows(list);
        } else {
          // 使用兜底数据
          setRows(cryptoFallback);
        }
        setHasMore(false);
      } else {
        // 非加密货币市场：加载股票数据，传入目标市场
        await loadNextBatch(true, targetMarket);
      }
    } catch (_e) {
      // 检查是否还是同一个请求
      if (fetchIdRef.current !== myFetchId) return;
      
      // 兜底数据
      if (targetMarket === "pl") {
        setRows(PL_FALLBACK);
        setHasMore(false);
      } else if (targetMarket === "us") {
        setRows(US_FALLBACK);
        setHasMore(false);
      } else {
        // crypto 兜底
        setRows(cryptoFallback);
        setHasMore(false);
      }
    } finally { setLoading(false); firstLoadRef.current = false; }
  }, [market, loadNextBatch, cryptoFallback, PL_FALLBACK, US_FALLBACK]);

  useEffect(() => { fetchMarket(); }, [market]);

  // 加密市场定时刷新：每3秒更新一次（股票/美股仍按分页拉取）
  useEffect(() => {
    if (market !== "crypto") return;
    let cancelled = false;
    const tick = async () => {
      try {
        if (cancelled) return;
        if (document.hidden) return;
        
        const prevRows = rowsRef.current || [];
        const bases = prevRows.length ? prevRows.map(r => r.symbol) : ["BTC","ETH","BNB","SOL","XRP","ADA","DOGE","TON","LTC","TRX"];
        const quotes = await getCryptoQuotes({ symbols: bases });
        
        if (cancelled) return;
        
        let rate = 4;
        try {
          const rateRes = await getUsdPlnRate();
          rate = rateRes.rate || 4;
        } catch {
          rate = 4;
        }
        
        if (cancelled) return;
        
        const bySym = new Map(quotes.map(q => [q.symbol, q]));
        setRows(prev => prev.map(r => {
          const q = bySym.get(r.symbol) || {};
          const priceUSD = Number(q.priceUSD || q.price || r.priceUSD || 0);
          const next = {
            ...r,
            priceUSD,
            pricePLN: priceUSD * rate,
            changePct: Number(q.changePct || r.changePct || 0),
            volume: Number(q.volume || r.volume || 0),
          };
          const same = (
            Number(next.priceUSD) === Number(r.priceUSD) &&
            Number(next.pricePLN) === Number(r.pricePLN) &&
            Number(next.changePct) === Number(r.changePct) &&
            Number(next.volume) === Number(r.volume)
          );
          return same ? r : next;
        }));
      } catch {}
    };
    tick();
    const timer = setInterval(tick, 3_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [market]);

  // 股票页（美股）自适应轻量轮询：默认 US 15s；页面不可见时暂停
  // 波兰股票由于API限制，使用静态兜底数据，不进行轮询
  // 可通过环境变量或 localStorage 动态调整：
  // - VITE_MARKET_POLL_MS（通用）或 VITE_MARKET_POLL_MS_US（细分）
  // - localStorage['poll:market:us:ms']
  useEffect(() => {
    // 加密货币和波兰股票不使用此轮询
    if (market === "crypto" || market === "pl") return;
    
    let cancelled = false;
    const readPollMs = () => {
      try {
        const envAll = Number(import.meta.env?.VITE_MARKET_POLL_MS || 0);
        const envUs = Number(import.meta.env?.VITE_MARKET_POLL_MS_US || 0);
        const ls = Number(localStorage.getItem(`poll:market:${market}:ms`) || 0);
        const def = 15000; // 美股15秒轮询
        const pick = (n) => (Number.isFinite(n) && n > 0 ? n : 0);
        return pick(ls) || pick(envUs) || pick(envAll) || def;
      } catch { return 15000; }
    };
    let pollMs = readPollMs();
    const tick = async () => {
      if (cancelled) return;
      if (document.hidden) return;
      // 只刷新当前已展示的 symbols，避免无限增长请求
      const currentRows = rowsRef.current || [];
      const syms = currentRows.map(r => r.symbol);
      if (!syms.length) return;
      try {
        const list = await getQuotes({ market, symbols: syms });
        // 关键修复：只有当返回数据数量足够时才更新
        // 如果返回的数据不足当前显示数据的50%，跳过本次更新
        const minRequired = Math.ceil(currentRows.length * 0.5);
        if (!Array.isArray(list) || list.length < minRequired) {
          return; // 数据不足，保持当前显示的数据
        }
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

  const currency = market === "pl" ? "PLN" : market === "us" ? "USD" : cryptoCurrency;
  const title = market === "pl" ? t("stocksTitle") : market === "us" ? t("stocksTitleUS") : t("marketCrypto");

  const rowsToShow = useMemo(() => {
    const base = rows.slice();
    if (marketView === "gainers") return base.sort((a,b)=> (Number(b.changePct||0)) - (Number(a.changePct||0)));
    if (marketView === "losers") return base.sort((a,b)=> (Number(a.changePct||0)) - (Number(b.changePct||0)));
    if (marketView === "turnover") {
      const calcTurn = (r) => {
        if (market === "crypto") {
          const p = cryptoCurrency === "USD" ? Number(r.priceUSD || r.price || 0) : Number(r.pricePLN || 0);
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
      if (market === "pl") {
        let q = (search.pl || "").trim().toUpperCase();
        if (!q) { setSearchRow(null); return; }
        if (!q.endsWith(".WA")) q = `${q}.WA`;
        const list = await getQuotes({ market: "pl", symbols: [q] });
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
        const { rate } = await getUsdPlnRate();
        try {
          const list = await getCryptoQuotes({ symbols: [base] });
          const row = list[0];
          if (row) {
            setSearchRow({
              symbol: row.symbol,
              name: row.name || row.symbol,
              priceUSD: Number(row.priceUSD || row.price || 0),
              pricePLN: Number(row.priceUSD || row.price || 0) * rate,
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
  const searchLabel = market === "pl" ? t("searchPL") : market === "us" ? t("searchUS") : t("searchCrypto");
  const searchPh = market === "pl" ? t("placeholderPL") : market === "us" ? t("placeholderUS") : t("placeholderCrypto");

  function normalizeText(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  }
  const PL_NAMES = {
    "PKO.WA": "PKO Bank Polski",
    "PKN.WA": "PKN Orlen",
    "PZU.WA": "PZU SA",
    "KGH.WA": "KGHM Polska Miedź",
    "PEO.WA": "Bank Pekao",
    "LPP.WA": "LPP SA",
    "DNP.WA": "Dino Polska",
    "ALR.WA": "Alior Bank",
    "CDR.WA": "CD Projekt",
    "CCC.WA": "CCC SA",
    "OPL.WA": "Orange Polska",
    "CPS.WA": "Cyfrowy Polsat",
    "MBK.WA": "mBank",
    "SPL.WA": "Santander Bank Polska",
    "JSW.WA": "JSW SA",
    "TPE.WA": "Tauron Polska Energia",
    "ENA.WA": "Enea SA",
    "LTS.WA": "Lotos SA",
    "KRU.WA": "Kruk SA",
    "PCO.WA": "Pepco Group",
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
    pl: {
      "PKO.WA": ["PKO BP", "PKO BANK"],
      "PKN.WA": ["ORLEN", "PKN ORLEN"],
      "PZU.WA": ["PZU"],
      "KGH.WA": ["KGHM", "MIEDZ"],
      "CDR.WA": ["CD PROJEKT", "CDPR", "CYBERPUNK"],
      "LPP.WA": ["LPP", "RESERVED"],
      "DNP.WA": ["DINO"],
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
    if (market === "pl") {
      const candidates = PL_SYMBOLS.map(s => ({ symbol: s, name: PL_NAMES[s] || s.replace(/\.WA$/, "") }));
      return candidates.filter(c => {
        const ns = normalizeText(c.symbol.replace(/\.WA$/, ""));
        const nn = normalizeText(c.name);
        const aliases = (ALIASES.pl[c.symbol] || []).map(normalizeText);
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
    return market === "pl" ? search.pl : market === "us" ? search.us : search.crypto;
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
                className={`pill dropdown-trigger ${!showNewsList ? 'active' : ''}`} 
                onClick={() => {
                  setShowNewsList(false);
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
                  <button className={`dropdown-item ${market === "pl" ? "active" : ""}`} onClick={() => {
                    setMarket("pl");
                    setShowNewsList(false);
                    setShowMobileDropdown(false);
                  }}>{t("marketPL")}</button>
                  <button className={`dropdown-item ${market === "us" ? "active" : ""}`} onClick={() => {
                    setMarket("us");
                    setShowNewsList(false);
                    setShowMobileDropdown(false);
                  }}>{t("marketUS")}</button>
                  <button className={`dropdown-item ${market === "crypto" ? "active" : ""}`} onClick={() => {
                    setMarket("crypto");
                    setShowNewsList(false);
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
                    <button className={`dropdown-item ${cryptoCurrency === "PLN" ? "active" : ""}`} onClick={() => {
                      setCryptoCurrency("PLN");
                      setShowMobileDropdown(false);
                    }}>PLN</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 内容区域 */}
      <div className="market-content" style={{ position: 'relative' }}>
        <div style={{ background: 'transparent' }}>
          <>
            <div className="search-row" style={{ marginTop: 8 }}>
              <label className="desc search-label" htmlFor="market-search">{searchLabel}</label>
              <input
                id="market-search"
                type="text"
                value={market === "pl" ? search.pl : market === "us" ? search.us : search.crypto}
                onChange={(e) => { const v = e.target.value; setSearch(s => ({ ...s, [market]: v })); setSuggestions(computeSuggestions(v)); setShowSug(true); }}
                onKeyDown={onSearchKey}
                onFocus={() => { setShowSug(true); setSuggestions(computeSuggestions(market === "pl" ? search.pl : market === "us" ? search.us : search.crypto)); }}
                onBlur={() => setTimeout(() => setShowSug(false), 120)}
                placeholder={searchPh}
                className="search-input"
                style={{ padding: "8px 10px", borderRadius: 8 }}
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
                    const priceVal = market === "crypto" ? (cryptoCurrency === "USD" ? (r.priceUSD || r.price || 0) : (r.pricePLN || 0)) : r.price;
                    const detailsUrl = (() => {
                      if (market === "pl" || market === "us") return `https://finance.yahoo.com/quote/${encodeURIComponent(r.symbol)}`;
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
                          cryptoCurrency === "USD" ? (r.priceUSD || r.price || 0) : (r.pricePLN || 0),
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
