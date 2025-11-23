import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import "../styles/market-tabs.css";
import { useNavigate } from "react-router-dom";
import BottomNav from "../components/BottomNav.jsx";
import { IconLightning } from "../assets/icons.jsx";
import { useI18n } from "../i18n.jsx";
import { getQuotes, getCryptoQuotes, getCryptoSpark, getStockSpark } from "../services/marketData.js";
import { formatMoney, formatMXN, formatUSDT } from "../utils/money.js";
import { api } from "../services/api.js";

const TD_BASES = ["BTC","ETH","BNB","SOL","XRP","ADA","DOGE","TON","LTC","TRX"];
const CRYPTO_NAME_MAP = { BTC: "Bitcoin", ETH: "Ethereum", BNB: "BNB", SOL: "Solana", XRP: "XRP", ADA: "Cardano", DOGE: "Dogecoin", TON: "Toncoin", LTC: "Litecoin", TRX: "TRON" };

// Controlled debug logging for homepage refresh/fetch
// Enable via env `VITE_DEBUG_LOG=1` or localStorage key `debug:home` = '1'
const DEBUG_LOG = (() => {
  try {
    const env = String(import.meta.env?.VITE_DEBUG_LOG || "").trim();
    const ls = String(localStorage.getItem("debug:home") || "").trim();
    const dev = !!import.meta.env?.DEV;
    return dev || env === "1" || ls === "1";
  } catch { return true; }
})();
const LOG = (...args) => { try { console.log(...args); } catch {} };

function readSession() {
  try { return JSON.parse(localStorage.getItem("sessionUser") || "null"); } catch { return null; }
}
function readUsers() {
  try { return JSON.parse(localStorage.getItem("users") || "[]"); } catch { return []; }
}
// 货币格式化统一到 utils/money

 

function Sparkline({ data = [], color = "#5cff9b" }) {
  const points = (Array.isArray(data) ? data.filter(v => Number.isFinite(Number(v))) : []).slice(-60); // last 60 points
  if (points.length < 2) return <span className="desc">--</span>;
  const w = 100, h = 26;
  const min = Math.min(...points), max = Math.max(...points);
  const range = max - min || 1;
  const stepX = w / (points.length - 1);
  const path = points.map((v, i) => {
    const x = i * stepX;
    const y = h - ((v - min) / range) * h; // invert y-axis
    return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
  const minIndex = points.indexOf(min);
  const maxIndex = points.indexOf(max);
  const minX = minIndex * stepX, minY = h - ((min - min) / range) * h;
  const maxX = maxIndex * stepX, maxY = h - ((max - min) / range) * h;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-label="sparkline">
      <path d={path} stroke={color} fill="none" strokeWidth={2} />
      <circle cx={minX} cy={minY} r={2.5} fill="#888" />
      <circle cx={maxX} cy={maxY} r={2.5} fill="#888" />
    </svg>
  );
}

export default function Home() {
  const { lang, t } = useI18n();
  const navigate = useNavigate();
  const [session, setSession] = useState(() => readSession());
  const [users, setUsers] = useState(() => readUsers());
  const [stocks, setStocks] = useState([]);
  const [usStocks, setUsStocks] = useState([]);
  const [crypto, setCrypto] = useState([]);
  const [MX_INDICES, setMxIndices] = useState([]);
  const [US_INDICES, _setUsIndices] = useState([]);
  const [mxSpark, setMxSpark] = useState({});
  const [usSpark, setUsSpark] = useState({});
  const [cryptoSpark, setCryptoSpark] = useState({});
  const pushSpark = (mkt, symbol, price) => {
    const n = Number(price || 0);
    if (!Number.isFinite(n) || n <= 0) return;
    if (mkt === "mx") {
      setMxSpark(prev => {
        const arr = Array.isArray(prev[symbol]) ? prev[symbol] : [];
        const next = [...arr, n].slice(-60);
        return { ...prev, [symbol]: next };
      });
    } else if (mkt === "us") {
      setUsSpark(prev => {
        const arr = Array.isArray(prev[symbol]) ? prev[symbol] : [];
        const next = [...arr, n].slice(-60);
        return { ...prev, [symbol]: next };
      });
    } else if (mkt === "crypto") {
      setCryptoSpark(prev => {
        const arr = Array.isArray(prev[symbol]) ? prev[symbol] : [];
        const next = [...arr, n].slice(-60);
        return { ...prev, [symbol]: next };
      });
    }
  };
  const [popularSort, setPopularSort] = useState(() => localStorage.getItem("popularSort") || "turnover"); // turnover | momentum
  const [LOADING, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [UPDATED_AT, setUpdatedAt] = useState(0);
  const [market, setMarket] = useState("us"); // mx | us | crypto
  const [cryptoCurrency, setCryptoCurrency] = useState(() => {
    try { return localStorage.getItem("cryptoCurrency") || "USD"; } catch { return "USD"; }
  });
  // 实时汇率缓存（用于 WebSocket 推送的价格换算）
  const [usdToMxnRate, setUsdToMxnRate] = useState(18.0);
  const binanceWsRef = useRef(null);
  const finnhubWsRef = useRef(null);
  const twelveWsRef = useRef(null);
  const tdMxLastTickRef = useRef(0); // 最近一次收到 MX WS 价格的时间戳
  const tdUsLastTickRef = useRef(0); // 最近一次收到 US WS 价格的时间戳

  useEffect(() => {
    try {
      const envKey = import.meta.env?.VITE_TWELVEDATA_KEY || import.meta.env?.VITE_TWELVE_DATA_KEY || import.meta.env?.VITE_TD_KEY || import.meta.env?.VITE_TD_KEY_OVERRIDE;
      const lsKey = localStorage.getItem("td:key") || localStorage.getItem("VITE_TWELVEDATA_KEY") || localStorage.getItem("VITE_TWELVE_DATA_KEY") || localStorage.getItem("VITE_TD_KEY") || localStorage.getItem("VITE_TD_KEY_OVERRIDE");
      if (envKey && !lsKey) localStorage.setItem("td:key", envKey);
      const avEnv = import.meta.env?.VITE_ALPHAVANTAGE_KEY || import.meta.env?.VITE_AV_KEY;
      const avLs = localStorage.getItem("av:key") || localStorage.getItem("VITE_ALPHAVANTAGE_KEY") || localStorage.getItem("VITE_AV_KEY");
      if (avEnv && !avLs) localStorage.setItem("av:key", avEnv);
    } catch {}
    const tk = String(localStorage.getItem('token') || '').trim();
    if (!tk) {
      navigate('/login', { replace: true });
    } else {
      try {
        api.get('/me').then((data) => {
          const user = (data && (data.user || data)) || null;
          if (user) {
            try { localStorage.setItem('sessionUser', JSON.stringify(user)); } catch {}
            setSession(user);
          }
        }).catch(() => { /* 401 将由客户端统一处理 */ });
      } catch {}
    }
    const onStorage = () => {
      setSession(readSession());
      setUsers(readUsers());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [navigate]);

  // 排序偏好持久化
  useEffect(() => {
    try { localStorage.setItem("popularSort", popularSort); } catch {}
  }, [popularSort]);
  useEffect(() => {
    try { localStorage.setItem("cryptoCurrency", cryptoCurrency); } catch {}
  }, [cryptoCurrency]);

  const me = useMemo(() => {
    if (!session) return null;
    // 优先后端数值ID，其次本地镜像表匹配
    const backendId = Number(session?.id ?? session?.backendId);
    const byBackend = users.find(u => Number(u.id) === backendId) || users.find(u => Number(u.backendId) === backendId);
    const byPhone = users.find(u => u.phone === session.phone);
    return byBackend || byPhone || session;
  }, [session, users]);

  const avatarSrc = normalizeAvatar(me?.avatarUrl || me?.avatar || (session?.profile && session.profile.avatarUrl) || ""); // 默认系统 logo
  const displayName = me?.name || me?.phone || "Usuario";
  // 余额状态：仅从后端数据库读取；初始化为 0
  const [balanceMXN, setBalanceMXN] = useState(0);
  const [balanceUSD, setBalanceUSD] = useState(0);
  const [balanceUSDT, setBalanceUSDT] = useState(0);
  const balance = balanceMXN || 0;
  const BALANCE_TEXT = formatMXN(balance, lang);

  // 从后端获取余额；失败时保持为 0，避免使用本地镜像
  const fetchBalances = useCallback(async () => {
    try {
      // 使用后端数值ID
      let uid = Number(me?.id ?? me?.backendId);
      // 若本地为 u_* 或缺失ID，尝试通过手机号查询后端用户ID
      if (!uid && me?.phone) {
        try {
          const res = await api.get(`/admin/users?q=${encodeURIComponent(me.phone)}`);
          const arr = Array.isArray(res?.users) ? res.users : [];
          const match = arr.find(u => String(u.phone) === String(me.phone));
          if (match && Number(match.id)) {
            uid = Number(match.id);
            // 回写本地镜像与会话，后续请求稳定使用数值ID
            const nextUsers = readUsers().map(u => (u.phone === me.phone ? { ...u, id: uid, backendId: uid } : u));
            try { localStorage.setItem('users', JSON.stringify(nextUsers)); } catch {}
            setUsers(nextUsers);
            try { localStorage.setItem('sessionUser', JSON.stringify({ ...session, id: uid })); } catch {}
            setSession({ ...session, id: uid });
          }
        } catch (_) { /* 忽略回退失败 */ }
      }
      if (!uid) return; // 未登录或依旧无ID时跳过
      // 先尝试用户态接口；若返回 401/404/HTML 则回退到管理员接口
      let data;
      try {
        data = await api.get(`/me/balances`);
        const arr = Array.isArray(data?.balances) ? data.balances : [];
        if (arr.length === 0) throw new Error('empty balances');
      } catch (_) {
        data = await api.get(`/admin/users/${uid}/balances`);
      }
      const arr = Array.isArray(data?.balances) ? data.balances : [];
      const map = arr.reduce((m, r) => { m[String(r.currency).toUpperCase()] = Number(r.amount || 0); return m; }, {});
      setBalanceMXN(Number.isFinite(map.MXN) ? map.MXN : 0);
      setBalanceUSD(Number.isFinite(map.USD) ? map.USD : 0);
      setBalanceUSDT(Number.isFinite(map.USDT) ? map.USDT : 0);
    } catch (_) {
      setBalanceMXN(0);
      setBalanceUSD(0);
      setBalanceUSDT(0);
    }
  }, [me, session]);

  // 当登录用户变化或页面首次进入时拉取余额
  useEffect(() => { fetchBalances();
  }, [fetchBalances]);

  const _onChangeAvatar = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !me) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const next = readUsers().map(u => u.id === me.id ? { ...u, avatarUrl: dataUrl } : u);
      localStorage.setItem("users", JSON.stringify(next));
      setUsers(next);
    };
    reader.readAsDataURL(file);
  };

  // 允许未登录状态继续运行行情刷新与日志（配合 localStorage('disable:auth')='1' 测试）

  const fetchStocks = async () => {
    if (DEBUG_LOG) LOG("[Home] fetch MX stocks start");
    const symbols = ["AMXL.MX","WALMEX.MX","FEMSAUBD.MX","BIMBOA.MX","GMEXICOB.MX","GFNORTEO.MX"];
    // 先设置价格；spark 获取失败不应影响价格展示
    try {
      const list = await getQuotes({ market: "mx", symbols });
      if (DEBUG_LOG) LOG("[Home] fetch MX quotes done", { count: Array.isArray(list) ? list.length : 0, first: Array.isArray(list) ? list[0] : null });
      if (!list.length) throw new Error("empty");
      setStocks(list);
    } catch (_) {
      if (DEBUG_LOG) LOG("[Home] fetch MX quotes failed; try cache");
      // 失败时使用最近一次成功的缓存，避免页面全空
      try {
        const cached = [];
        for (const sym of symbols) {
          const raw = localStorage.getItem(`td:mx:${sym}`);
          if (raw) {
            const obj = JSON.parse(raw);
            if (obj?.data) cached.push(obj.data);
          }
        }
        if (cached.length) setStocks(cached);
        else {
          // 最后兜底：示例数据，避免首次加载为空
          setStocks([
            { symbol: "AMXL.MX", name: "América Móvil", price: 17.2, changePct: 0.8, volume: 12000000 },
            { symbol: "WALMEX.MX", name: "Walmart de México", price: 65.1, changePct: -0.3, volume: 9000000 },
            { symbol: "FEMSAUBD.MX", name: "FEMSA", price: 130.4, changePct: 1.1, volume: 7000000 },
            { symbol: "BIMBOA.MX", name: "Grupo Bimbo", price: 75.2, changePct: 0.5, volume: 6000000 },
            { symbol: "GMEXICOB.MX", name: "Grupo México", price: 95.7, changePct: 2.3, volume: 8000000 },
            { symbol: "GFNORTEO.MX", name: "Banorte", price: 160.9, changePct: -0.6, volume: 5000000 },
          ]);
        }
      } catch {}
    }
    // sparkline 请求失败时忽略错误，避免影响价格
    try { await fetchSparkForStocks(symbols, "mx"); } catch (_) {}
  };

  const fetchUSStocks = async () => {
    const symbols = ["AAPL","MSFT","AMZN","GOOGL","TSLA","META"];
    // 先设置价格；spark 获取失败不应覆盖价格
    try {
      const list = await getQuotes({ market: "us", symbols });
      if (!list.length) throw new Error("empty");
      setUsStocks(list);
    } catch (_) {
      // 失败时使用最近一次成功的缓存，避免页面全空
      try {
        const cached = [];
        for (const sym of symbols) {
          const raw = localStorage.getItem(`td:us:${sym}`);
          if (raw) {
            const obj = JSON.parse(raw);
            if (obj?.data) cached.push(obj.data);
          }
        }
        if (cached.length) setUsStocks(cached);
        else {
          // 最后兜底：示例数据，避免首次加载为空
          setUsStocks([
            { symbol: "AAPL", name: "Apple", price: 180.3, changePct: 0.9, volume: 50000000 },
            { symbol: "MSFT", name: "Microsoft", price: 410.2, changePct: 0.6, volume: 30000000 },
            { symbol: "AMZN", name: "Amazon", price: 175.8, changePct: -0.4, volume: 40000000 },
            { symbol: "GOOGL", name: "Alphabet", price: 140.7, changePct: 1.2, volume: 25000000 },
            { symbol: "TSLA", name: "Tesla", price: 240.5, changePct: 2.0, volume: 60000000 },
            { symbol: "META", name: "Meta", price: 320.1, changePct: -0.7, volume: 20000000 },
          ]);
        }
      } catch {}
    }
    // sparkline 请求失败时忽略错误，避免影响价格展示
    try { await fetchSparkForStocks(symbols, "us"); } catch (_) {}
  };

  const fetchMXIndices = async () => {
    try {
      const list = await getQuotes({ market: "mx", symbols: ["^MXX"] });
      if (Array.isArray(list) && list.length) {
        setMxIndices(list);
        return;
      }
    } catch {}
    // 兜底：静态值（网络失败时）
    setMxIndices([{ symbol: "^MXX", name: "S&P/BMV IPC", price: 55000, changePct: 0.3 }]);
  };

  const fetchUSIndices = async () => {
    try {
      const list = await getQuotes({ market: "us", symbols: ["^GSPC","^DJI","^IXIC"] });
      if (Array.isArray(list) && list.length) {
        _setUsIndices(list);
        return;
      }
    } catch {}
    // 兜底：静态值（网络失败时）
    _setUsIndices([
      { symbol: "^GSPC", name: "S&P 500", price: 5300, changePct: 0.2 },
      { symbol: "^DJI", name: "Dow Jones", price: 39000, changePct: -0.1 },
      { symbol: "^IXIC", name: "Nasdaq", price: 17000, changePct: 0.6 },
    ]);
  };

  // USD→MXN 汇率（10 分钟缓存）
  const getUSDToMXNRate = async () => {
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
      return 18.0; // 兜底汇率
    }
  };

  

  // 启动时预置 Crypto 列表，确保 WS 推送能立即体现在 UI 上
  useEffect(() => {
    if (!crypto.length) {
      const seed = TD_BASES.slice(0, 6).map(sym => ({
        id: sym.toLowerCase(), symbol: sym,
        name: CRYPTO_NAME_MAP[sym] || sym,
        priceUSD: 0, priceMXN: 0, changePct: 0,
        turnoverUSD: 0, turnoverMXN: 0,
      }));
      setCrypto(seed);
    }
  
  }, [crypto.length]);

  // 启动时预置股票列表，确保 TD/Finnhub WS 推送能立即体现在 UI 上
  useEffect(() => {
    if (!stocks.length) {
      setStocks([
        { symbol: "AMXL.MX", name: "América Móvil", price: 17.2, changePct: 0.8, volume: 12000000 },
        { symbol: "WALMEX.MX", name: "Walmart de México", price: 65.1, changePct: -0.3, volume: 9000000 },
        { symbol: "FEMSAUBD.MX", name: "FEMSA", price: 130.4, changePct: 1.1, volume: 7000000 },
        { symbol: "BIMBOA.MX", name: "Grupo Bimbo", price: 75.2, changePct: 0.5, volume: 6000000 },
        { symbol: "GMEXICOB.MX", name: "Grupo México", price: 95.7, changePct: 2.3, volume: 8000000 },
        { symbol: "GFNORTEO.MX", name: "Banorte", price: 160.9, changePct: -0.6, volume: 5000000 },
      ]);
    }
    if (!usStocks.length) {
      setUsStocks([
        { symbol: "AAPL", name: "Apple", price: 180.3, changePct: 0.9, volume: 50000000 },
        { symbol: "MSFT", name: "Microsoft", price: 410.2, changePct: 0.6, volume: 30000000 },
        { symbol: "AMZN", name: "Amazon", price: 175.8, changePct: -0.4, volume: 40000000 },
        { symbol: "GOOGL", name: "Alphabet", price: 140.7, changePct: 1.2, volume: 25000000 },
        { symbol: "TSLA", name: "Tesla", price: 240.5, changePct: 2.0, volume: 60000000 },
        { symbol: "META", name: "Meta", price: 320.1, changePct: -0.7, volume: 20000000 },
      ]);
    }
  
  }, [stocks.length, usStocks.length]);
  const fetchCrypto = async () => {
    try {
      const rate = await getUSDToMXNRate();
      setUsdToMxnRate(rate);
      const nameMap = CRYPTO_NAME_MAP;
      const quotes = await getCryptoQuotes({ symbols: TD_BASES });
      const list = quotes.slice(0, 6).map(q => ({
        id: q.symbol.toLowerCase(),
        symbol: q.symbol,
        name: nameMap[q.symbol] || q.name || q.symbol,
        priceMXN: Number(q.priceUSD || q.price || 0) * rate,
        priceUSD: Number(q.priceUSD || q.price || 0),
        changePct: Number(q.changePct || 0),
        turnoverMXN: Number(q.volume || 0) * rate,
        turnoverUSD: Number(q.volume || 0),
      }));
      if (!list.length) throw new Error("empty");
      setCrypto(list);
      // 获取 5m × 60 根 K 线作为波形图（90 秒缓存）
      const sparkMap = {};
      const toFetch = [];
      for (const m of list) {
        const k = `spark:crypto:${m.symbol}:1d5m`;
        const raw = localStorage.getItem(k);
        if (raw) {
          try {
            const obj = JSON.parse(raw);
            if (Date.now() - (obj.ts || 0) < CACHE_TTL_MS && Array.isArray(obj.data)) {
              sparkMap[m.symbol] = obj.data;
              continue;
            }
          } catch {}
        }
        toFetch.push(m.symbol);
      }
      if (toFetch.length) {
        await Promise.all(toFetch.map(async (sym) => {
          try {
            const closes = await getCryptoSpark(sym, { interval: "5min", points: 60 });
            sparkMap[sym] = closes;
            localStorage.setItem(`spark:crypto:${sym}:1d5m`, JSON.stringify({ ts: Date.now(), data: closes }));
          } catch {}
        }));
      }
      setCryptoSpark(sparkMap);
    } catch (_) {
      // 兜底 CoinGecko（极端情况）
      try {
        const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=mxn&order=market_cap_desc&per_page=6&page=1&sparkline=true&price_change_percentage=24h`;
        const markets = await fetch(url).then(r=>r.json());
        const rate = await getUSDToMXNRate();
        const list = markets.map(m => ({
          id: m.id,
          name: m.name,
          symbol: m.symbol.toUpperCase(),
          priceMXN: m.current_price,
          priceUSD: Number(m.current_price) / rate,
          changePct: m.price_change_percentage_24h,
          turnoverMXN: m.total_volume,
          turnoverUSD: Number(m.total_volume) / rate,
          spark: (m.sparkline_in_7d?.price || [])
        }));
        if (!list.length) throw new Error("empty");
        setCrypto(list);
        const sparkMap = {};
        list.forEach(m => { sparkMap[m.symbol] = m.spark; });
        setCryptoSpark(sparkMap);
      } catch {
        const fallback = [
          { id: "bitcoin", name: "Bitcoin", symbol: "BTC", priceMXN: 1200000, priceUSD: 65000, changePct: 2.1, turnoverMXN: 50000000000, turnoverUSD: 2700000000, spark: [1100000,1120000,1150000,1140000,1160000,1200000] },
          { id: "ethereum", name: "Ethereum", symbol: "ETH", priceMXN: 40000, priceUSD: 2200, changePct: -1.3, turnoverMXN: 20000000000, turnoverUSD: 1100000000, spark: [42000,41000,40500,40000,39800,40200] },
        ];
        setCrypto(fallback);
        const sparkMap = {};
        fallback.forEach(m => { sparkMap[m.symbol] = m.spark; });
        setCryptoSpark(sparkMap);
      }
    }
  };

  // 移除指数卡片后，无需维护 cryptoIndices

  // 每 10 分钟刷新一次 USD→MXN 汇率，供 WebSocket 推送换算
  useEffect(() => {
    let cancelled = false;
    const updateRate = async () => {
      try { const r = await getUSDToMXNRate(); if (!cancelled) setUsdToMxnRate(r); } catch {}
    };
    updateRate();
    const id = setInterval(updateRate, 10 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // 接入 Binance WebSocket 实时更新加密货币行情（无需密钥）
  useEffect(() => {
    // 若已存在连接则不重复建立
    if (binanceWsRef.current) return;
    const streams = TD_BASES.map(b => `${b.toLowerCase()}usdt@ticker`).join('/');
    const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;
    const ws = new WebSocket(url);
    binanceWsRef.current = ws;
    const nameMap = CRYPTO_NAME_MAP;
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        const d = msg?.data;
        if (!d || !d.s) return;
        const pair = String(d.s).toUpperCase(); // e.g. BTCUSDT
        const base = pair.replace(/USDT$/,'');
        const priceUSD = Number(d.c || 0);
        const changePct = Number(d.P || 0);
        const quoteVolUSD = Number(d.q || 0); // 24h USDT 成交额
        setCrypto(prev => {
          const arr = prev.slice();
          const idx = arr.findIndex(m => String(m.symbol).toUpperCase() === base);
          if (idx >= 0) {
            const m = arr[idx];
            arr[idx] = {
              ...m,
              name: nameMap[base] || m.name || base,
              symbol: base,
              priceUSD,
              priceMXN: priceUSD * usdToMxnRate,
              changePct,
              turnoverUSD: quoteVolUSD > 0 ? quoteVolUSD : m.turnoverUSD,
              turnoverMXN: (quoteVolUSD > 0 ? quoteVolUSD : (m.turnoverUSD || 0)) * usdToMxnRate,
            };
          } else {
            // 若列表尚未包含该币种，直接插入
            arr.push({
              id: base.toLowerCase(),
              symbol: base,
              name: nameMap[base] || base,
              priceUSD,
              priceMXN: priceUSD * usdToMxnRate,
              changePct,
              turnoverUSD: quoteVolUSD > 0 ? quoteVolUSD : 0,
              turnoverMXN: (quoteVolUSD > 0 ? quoteVolUSD : 0) * usdToMxnRate,
            });
          }
          return arr;
        });
      } catch {}
    };
    ws.onclose = () => { binanceWsRef.current = null; };
    ws.onerror = () => { /* 忽略错误，依赖轮询兜底 */ };
    return () => { try { ws.close(); } catch {} binanceWsRef.current = null; };
  
  }, [usdToMxnRate]);

  // 可选：接入 Finnhub WebSocket 更新美股（需要 VITE_FINNHUB_TOKEN）
  useEffect(() => {
    if (finnhubWsRef.current) return;
    const token = import.meta.env?.VITE_FINNHUB_TOKEN;
    if (!token) return; // 未配置则跳过
    const ws = new WebSocket(`wss://ws.finnhub.io?token=${encodeURIComponent(token)}`);
    finnhubWsRef.current = ws;
    const US_SYMBOLS = ["AAPL","MSFT","AMZN","GOOGL","TSLA","META"];
    ws.onopen = () => {
      try {
        US_SYMBOLS.forEach(sym => ws.send(JSON.stringify({ type: "subscribe", symbol: sym })));
      } catch {}
    };
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type !== "trade" || !Array.isArray(msg.data)) return;
        const updates = new Map();
        for (const tr of msg.data) {
          const sym = String(tr.s);
          const price = Number(tr.p || 0);
          if (price > 0) updates.set(sym, price);
        }
        if (updates.size) {
          setUsStocks(prev => prev.map(row => updates.has(row.symbol) ? { ...row, price: updates.get(row.symbol) } : row));
        }
      } catch {}
    };
    ws.onclose = () => { finnhubWsRef.current = null; };
    ws.onerror = () => { /* 忽略错误，依赖轮询兜底 */ };
    return () => { try { ws.close(); } catch {} finnhubWsRef.current = null; };
  }, []);

  // 接入 Twelve Data WebSocket 实时更新美股与墨西哥股（使用相同 apikey，无需单独 WS key）
  useEffect(() => {
    // 若已存在连接则不重复建立；若已配置 Finnhub 则不重复对美股建立 TD WS，避免双源重复
    if (twelveWsRef.current) return;
    const hasFinnhub = !!import.meta.env?.VITE_FINNHUB_TOKEN;
    const tdKey = (import.meta.env?.VITE_TWELVEDATA_KEY || import.meta.env?.VITE_TWELVE_DATA_KEY || localStorage.getItem("td:key"));
    if (!tdKey) return;
    const endpoint = `wss://ws.twelvedata.com/v1/quotes/price?apikey=${encodeURIComponent(tdKey)}`;
    const ws = new WebSocket(endpoint);
    twelveWsRef.current = ws;

    // 订阅列表（与页面展示保持一致）
    const US_SYMBOLS = ["AAPL","MSFT","AMZN","GOOGL","TSLA","META"];
    // 注意：BMV 为 EOD 交易所，Twelve Data 不提供 BMV WebSocket；墨西哥股票仅使用 REST 轮询
    // const MX_SYMBOLS = ["AMXL.MX","WALMEX.MX","FEMSAUBD.MX","BIMBOA.MX","GMEXICOB.MX","GFNORTEO.MX"];
    // 指数不通过 TD WS 订阅，避免 ETF 价格覆盖自定义指数数据

    const usToWs = (s) => (s === "BRK-B" ? "BRK.B" : s);
    // const mxToWs = (s) => {
    //   let base = String(s).replace(/\.MX$/,""");
    //   if (base === "TLEVISA.CPO") base = "TLEVISACPO";
    //   return `${base}:BMV`;
    // };
    const wsSymbols = [];
    if (!hasFinnhub) wsSymbols.push(...US_SYMBOLS.map(usToWs));
    // 不添加墨西哥股票到 WS 订阅（BMV WS 不可用）
    // 不订阅指数：指数价格由自定义 API/REST 获取

    const wsToLocal = (s) => {
      // 墨西哥 BMV 不支持 WS：保留兼容映射但不再触发
      // if (/:BMV$/.test(s)) {
      //   let base = s.replace(/:BMV$/,'');
      //   if (base === "TLEVISACPO") base = "TLEVISA.CPO";
      //   return `${base}.MX`;
      // }
      // BRK.B -> BRK-B（如后续需要）
      if (s === "BRK.B") return "BRK-B";
      return s;
    };

    ws.onopen = () => {
      try {
        if (wsSymbols.length) {
          ws.send(JSON.stringify({ action: "subscribe", params: { symbols: wsSymbols.join(',') } }));
        }
      } catch {}
    };
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg?.event === "price") {
          const sym = String(msg.symbol || "");
          const price = Number(msg.price || 0);
          if (!price) return;
          const localSym = wsToLocal(sym);
          // 不处理指数的 WS 更新（避免 ETF 价格覆盖）
          if (/\.MX$/.test(localSym)) {
            if (DEBUG_LOG) console.debug("[Home] TD WS MX price", { symbol: localSym, price });
            setStocks(prev => prev.map(row => row.symbol === localSym ? { ...row, price } : row));
            pushSpark("mx", localSym, price);
            tdMxLastTickRef.current = Date.now();
          } else if (!hasFinnhub) {
            // 若未启用 Finnhub，则用 TD WS 更新美股
            setUsStocks(prev => prev.map(row => row.symbol === localSym ? { ...row, price } : row));
            pushSpark("us", localSym, price);
            tdUsLastTickRef.current = Date.now();
          }
        }
        // 可选处理订阅状态与错误事件
        // if (msg?.event === 'subscribe-status') { /* 可在控制台记录成功/失败 */ }
      } catch {}
    };
    ws.onclose = () => { twelveWsRef.current = null; };
    ws.onerror = () => { /* 忽略错误，依赖轮询兜底 */ };
    return () => { try { ws.close(); } catch {} twelveWsRef.current = null; };
  
  }, []);

  const CACHE_TTL_MS = 90000;
  const fetchSparkForStocks = async (symbols, which) => {
    try {
      // cache by symbol
      const toFetch = [];
      const map = {};
      for (const sym of symbols) {
        const k = `spark:${sym}:1d5m`;
        const raw = localStorage.getItem(k);
        if (raw) {
          try {
            const obj = JSON.parse(raw);
            if (Date.now() - (obj.ts || 0) < CACHE_TTL_MS && Array.isArray(obj.data)) {
              map[sym] = obj.data;
              continue;
            }
          } catch {}
        }
        toFetch.push(sym);
      }
      if (toFetch.length) {
        await Promise.all(toFetch.map(async (sym) => {
          try {
            const data = await getStockSpark(sym, which, { interval: "5min", points: 60 });
            if (Array.isArray(data)) {
              map[sym] = data;
              localStorage.setItem(`spark:${sym}:1d5m`, JSON.stringify({ ts: Date.now(), data }));
            }
          } catch (_) {}
        }));
      }
      if (which === "mx") setMxSpark(prev => ({ ...prev, ...map }));
      else setUsSpark(prev => ({ ...prev, ...map }));
    } catch (_) {
      // ignore
    }
  };

  const refreshingRef = useRef(false);
  const refreshDataRef = useRef(null);
  const refreshData = async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setLoading(true); setError("");
    try {
      // 顺序执行，避免并发导致网络请求被浏览器中断
      await fetchMXIndices();
      await fetchUSIndices();
      const hasBinance = !!binanceWsRef.current;
      const hasTDWS = !!twelveWsRef.current;
      const hasFinnhub = !!finnhubWsRef.current;
      const NOW = Date.now();
      if (DEBUG_LOG) LOG("[Home] refresh tick", { hasBinance, hasTDWS, hasFinnhub, tdMxLastTick: tdMxLastTickRef.current, tdUsLastTick: tdUsLastTickRef.current });
      // 美股：无论 WS 活跃与否均进行 REST 刷新（保证 1s 更新）；WS 推送仅作为附加实时更新
      await fetchUSStocks();
      // 美股：WS 活跃但趋势缺失时，回填 spark（使用缓存避免频繁请求）
      try {
        const usSymbolsForSpark = ["AAPL","MSFT","AMZN","GOOGL","TSLA","META"];
        const needUsSpark = usSymbolsForSpark.filter(sym => !Array.isArray(usSpark[sym]) || usSpark[sym].length < 10);
        if (needUsSpark.length) await fetchSparkForStocks(needUsSpark, "us");
      } catch {}
      // 墨西哥股：始终使用 REST 轮询（TD WS 不支持 BMV/XMEX 推送）
      const mxWsSilent = true; // TD WS不含BMV，始终走REST
      if (DEBUG_LOG) LOG("[Home] mx refresh decision", { mxWsSilent, willFetch: true });
      await fetchStocks();
      // 墨西哥股：WS 活跃但趋势缺失时，回填 spark（使用缓存避免频繁请求）
      try {
        const mxSymbolsForSpark = ["AMXL.MX","WALMEX.MX","FEMSAUBD.MX","BIMBOA.MX","GMEXICOB.MX","GFNORTEO.MX"];
        const needMxSpark = mxSymbolsForSpark.filter(sym => !Array.isArray(mxSpark[sym]) || mxSpark[sym].length < 10);
        if (needMxSpark.length) await fetchSparkForStocks(needMxSpark, "mx");
      } catch {}
      // 加密：若 WS 不活跃或列表为空，则进行 REST 刷新
      if (!hasBinance) {
        await fetchCrypto();
      } else if (!crypto.length) {
        await fetchCrypto();
      }
      setUpdatedAt(Date.now());
    }
    catch (_e) { setError(t("fetchError")); }
    finally { setLoading(false); refreshingRef.current = false; }
  };
  refreshDataRef.current = refreshData;
  // 首次加载
  useEffect(() => {
    const first = () => { try { refreshDataRef.current?.(); } catch {} };
    first();
  }, []);

  // 自动刷新：自适应轮询，页面不可见时暂停
  // 说明：墨股（BMV/XMEX）仅支持 REST；为避免 Twelve Data 出现 429，我们将首页默认轮询下调到 5s。
  // 可通过环境变量或 localStorage 调整：
  // - VITE_HOME_POLL_MS（毫秒）或 localStorage['poll:home:ms']
  useEffect(() => {
    const readPollMs = () => {
      try {
        const envMs = Number(import.meta.env?.VITE_HOME_POLL_MS || 0);
        const lsMs = Number(localStorage.getItem('poll:home:ms') || 0);
        const val = Number.isFinite(envMs) && envMs > 0 ? envMs : (Number.isFinite(lsMs) && lsMs > 0 ? lsMs : 5000);
        return val;
      } catch { return 5000; }
    };
    let pollMs = readPollMs();
    const tick = () => { if (!document.hidden) { try { refreshDataRef.current?.(); } catch {} } };
    let id = setInterval(tick, pollMs);
    // 监听 storage 中轮询配置的变化，动态调整（便于线上调参）
    const onStorage = (e) => {
      if (e?.key === 'poll:home:ms') {
        try { const next = Number(e.newValue || 0); if (Number.isFinite(next) && next > 0) {
          clearInterval(id);
          pollMs = next;
          id = setInterval(tick, pollMs);
        }} catch {}
      }
    };
    window.addEventListener('storage', onStorage);
    return () => { clearInterval(id); window.removeEventListener('storage', onStorage); };
  }, []);

  // 计算热门列表与是否显示成交金额（若无法计算则隐藏）
  const calcTurnover = useCallback((s) => {
    if (market === "crypto") return cryptoCurrency === "USD" ? Number(s.turnoverUSD || 0) : Number(s.turnoverMXN || 0);
    return Number(s.volume || 0) * Number(s.price || 0);
  }, [market, cryptoCurrency]);
  const getSpark = useCallback((s) => {
    if (market === "crypto") return cryptoSpark[s.symbol] || s.spark || [];
    return (market === "mx" ? mxSpark[s.symbol] : usSpark[s.symbol]) || [];
  }, [market, mxSpark, usSpark, cryptoSpark]);
  const calcMomentum = useCallback((s) => {
    const pts = getSpark(s).slice(-24);
    if (pts.length < 2) return 0;
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) return 0;
    return (last - first) / Math.abs(first);
  }, [getSpark]);
  const currentPopular = useMemo(() => {
    const base = (market === "crypto" ? crypto : (market === "mx" ? stocks : usStocks));
    const arr = base.slice();
    if (popularSort === "momentum") {
      return arr.sort((a, b) => calcMomentum(b) - calcMomentum(a));
    }
    return arr.sort((a, b) => calcTurnover(b) - calcTurnover(a));
  }, [market, crypto, stocks, usStocks, popularSort, calcMomentum, calcTurnover]);

  return (
    <div className="screen borderless">
      {/* 广告位位置调整：不置顶，移至钱包卡片之后 */}

      <div className="card borderless-card">
        <div className="wallet-wrap" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
          <div className="wallet-section" style={{ flex: 1, minWidth: 260 }}>
            <h1 className="title" style={{ marginTop: 0 }}>{t('walletBalanceTitle')}</h1>
            {/* 头像 + 用户名并排：用户名置于头像右侧 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, marginBottom: 10 }}>
              <div className="avatar-wrap" style={{ alignSelf: 'flex-start' }}>
                <img className="avatar" src={avatarSrc || "/logo.png"} alt="avatar" onError={(e)=>{ try { e.currentTarget.src = '/logo.png'; } catch {} }} />
              </div>
              <div className="user-name" style={{ fontSize: 14, color: '#e6f1ff' }}>{displayName}</div>
            </div>
            <div className="wallet-grid">
              <div>
                <div className="label">MXN</div>
                <div className="big-amount">{formatMXN(balanceMXN, lang)}</div>
              </div>
              <div>
                <div className="label">USD</div>
                <div className="big-amount">{formatMoney(balanceUSD, "USD", lang)}</div>
              </div>
              <div>
                <div className="label">USDT</div>
                <div className="big-amount">{formatUSDT(balanceUSDT, lang)}</div>
              </div>
            </div>
            <p className="desc">{t('assetsLabel')}</p>
          </div>
          {/* 右侧不再显示用户名，避免重复 */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }} />
        </div>

        <div className="sub-actions" style={{ marginTop: 16 }}>
          <button className="btn primary" disabled title="Próximamente">
            {t("recharge")}
          </button>
          <button className="btn primary" onClick={() => navigate("/exchange")}>{t("swap")}</button>
        </div>
      </div>

      {/* 市场概览卡片已移除 */}

      {/* 广告占位移除 */}

      {/* 市场切换 Tabs */}
      <div className="market-tabs" role="tablist" aria-label="Markets">
        <button className={`pill ${market === "us" ? "active" : ""}`} role="tab" aria-selected={market === "us"} onClick={() => setMarket("us")}>{t("marketUS")}</button>
        <button className={`pill ${market === "crypto" ? "active" : ""}`} role="tab" aria-selected={market === "crypto"} onClick={() => setMarket("crypto")}>{t("marketCrypto")}</button>
        <button className={`pill ${market === "mx" ? "active" : ""}`} role="tab" aria-selected={market === "mx"} onClick={() => setMarket("mx")}>{t("marketMX")}</button>
      </div>

      {/* 1) 各项指数卡片已移除 */}

      {/* 2) 热门（当日成交量排序） */}
      <div className="card borderless-card">
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 className="title" style={{ marginTop: 0 }}>{t("popularByVolumeTitle")}</h1>
          <span style={{ marginLeft: "auto" }} />
          <div className="pill-group" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <span className="desc">{t("sort")}{":"}</span>
            <button className={`pill ${popularSort === "turnover" ? "active" : ""}`} onClick={() => setPopularSort("turnover")}>{t("sortByTurnover")}</button>
            <button className={`pill ${popularSort === "momentum" ? "active" : ""}`} onClick={() => setPopularSort("momentum")}>{t("sortByMomentum")}</button>
          {market === "crypto" && (
            <div style={{ display: "flex", gap: 8, marginLeft: 10 }}>
              <button className={`pill ${cryptoCurrency === "USD" ? "active" : ""}`} onClick={() => setCryptoCurrency("USD")} aria-pressed={cryptoCurrency === "USD"}>USD</button>
              <button className={`pill ${cryptoCurrency === "MXN" ? "active" : ""}`} onClick={() => setCryptoCurrency("MXN")} aria-pressed={cryptoCurrency === "MXN"}>MXN</button>
            </div>
          )}
          </div>
        </div>
        {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
        <div className="table-scroll">
        <table className="data-table" style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>{t('symbol')}</th>
              <th>{t('name')}</th>
              <th>{t("price")}</th>
              <th>{t("change24h")}</th>
              <th>{t("trend")}</th>
            </tr>
          </thead>
          <tbody>
            {currentPopular.map((s) => (
              <tr
                key={s.symbol || s.id}
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  let sym = s.symbol || s.id;
                  // 加密市场统一传递为交易对（USDT），避免在交易页再推断
                  if (market === 'crypto') {
                    const base = String(sym).toUpperCase().replace(/USDT$/,'');
                    sym = `${base}USDT`;
                  }
                  navigate(`/swap?symbol=${encodeURIComponent(sym)}&market=${market}`);
                }}
              >
                <td className="desc">{s.symbol}</td>
                <td>{s.name}</td>
                <td>{formatMoney(
                  market === "crypto" ? (cryptoCurrency === "USD" ? s.priceUSD : s.priceMXN) : s.price,
                  market === "crypto" ? cryptoCurrency : (market === "mx" ? "MXN" : "USD"),
                  lang
                )}</td>
                <td style={{ color: (s.changePct ?? 0) >= 0 ? "#5cff9b" : "#ff5c7a" }}>
                  {(s.changePct ?? 0).toFixed(2)}%
                </td>
                <td>
                  {market === "crypto" ? (
                    <Sparkline data={cryptoSpark[s.symbol] || s.spark || []} color={(s.changePct ?? 0) >= 0 ? "#5cff9b" : "#ff5c7a"} />
                  ) : (
                    <Sparkline data={(market === "mx" ? mxSpark[s.symbol] : usSpark[s.symbol]) || []} color={(s.changePct ?? 0) >= 0 ? "#5cff9b" : "#ff5c7a"} />
                  )}
                </td>
              </tr>
            ))}
            {(market === "crypto" ? crypto : (market === "mx" ? stocks : usStocks)).length === 0 && (
              <tr>
                <td className="desc" colSpan={5}>--</td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* 3) 上涨空间最大（按 24h 涨幅排序） */}
      <div className="card borderless-card">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 className="title" style={{ marginTop: 0 }}>{t("biggestUpsideTitle")}</h1>
          <span style={{ marginLeft: "auto" }} />
        </div>
        {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
        <div className="table-scroll">
        <table className="data-table" style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>{t('symbol')}</th>
              <th>{t('name')}</th>
              <th>{t("trend")}</th>
              <th>{t("change24h")}</th>
            </tr>
          </thead>
          <tbody>
            {(market === "crypto" ? crypto.slice().sort((a,b)=> (b.changePct||0)-(a.changePct||0)) : (market === "mx" ? stocks : usStocks).slice().sort((a,b)=> (b.changePct||0)-(a.changePct||0))).map((s) => (
              <tr
                key={s.symbol || s.id}
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  let sym = s.symbol || s.id;
                  if (market === 'crypto') {
                    const base = String(sym).toUpperCase().replace(/USDT$/,'');
                    sym = `${base}USDT`;
                  }
                  navigate(`/swap?symbol=${encodeURIComponent(sym)}&market=${market}`);
                }}
              >
                <td className="desc">{s.symbol}</td>
                <td>{s.name}</td>
                <td>
                  {market === "crypto" ? (
                    <Sparkline data={cryptoSpark[s.symbol] || s.spark || []} color={(s.changePct ?? 0) >= 0 ? "#5cff9b" : "#ff5c7a"} />
                  ) : (
                    <Sparkline data={(market === "mx" ? mxSpark[s.symbol] : usSpark[s.symbol]) || []} color={(s.changePct ?? 0) >= 0 ? "#5cff9b" : "#ff5c7a"} />
                  )}
                </td>
                <td style={{ color: (s.changePct ?? 0) >= 0 ? "#5cff9b" : "#ff5c7a" }}>
                  {(s.changePct ?? 0).toFixed(2)}%
                </td>
              </tr>
            ))}
            {(market === "crypto" ? crypto : (market === "mx" ? stocks : usStocks)).length === 0 && (
              <tr>
                <td className="desc" colSpan={4}>--</td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
function normalizeAvatar(u) {
  try {
    const s = String(u || '').trim();
    if (!s) return '/logo.png';
    if (/^data:image\/(png|jpeg);base64,/i.test(s)) return s;
    if (/^https?:\/\//i.test(s)) return s;
    if (s.startsWith('/')) return s;
    if (/^[\w\-/.]+$/.test(s)) return `/uploads/${s.replace(/^\/+/, '')}`;
    return '/logo.png';
  } catch { return '/logo.png'; }
}
