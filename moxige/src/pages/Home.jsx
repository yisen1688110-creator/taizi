import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import "../styles/market-tabs.css";
import { useNavigate } from "react-router-dom";
import BottomNav from "../components/BottomNav.jsx";
import { IconLightning } from "../assets/icons.jsx";
import { useI18n } from "../i18n.jsx";
import { getQuotes, getCryptoQuotes, getCryptoSpark, getStockSpark, getUsdPlnRate } from "../services/marketData.js";
import { formatMoney, formatPLN, formatUSDT } from "../utils/money.js";
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
    if (mkt === "pl") {
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
  
  // 新闻轮播图状态
  const [newsCarousel, setNewsCarousel] = useState([]);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const carouselTimerRef = useRef(null);
  const carouselTouchStartRef = useRef(null);
  const carouselTouchXRef = useRef(0);
  const carouselMouseDownRef = useRef(false);
  const carouselMouseXRef = useRef(0);
  const [cryptoCurrency, setCryptoCurrency] = useState(() => {
    try { return localStorage.getItem("cryptoCurrency") || "USD"; } catch { return "USD"; }
  });
  
  // 闪兑功能状态
  const [swapModalOpen, setSwapModalOpen] = useState(false);
  const [swapFrom, setSwapFrom] = useState("PLN");
  const [swapTo, setSwapTo] = useState("USD");
  const [swapAmount, setSwapAmount] = useState("");
  const [swapLoading, setSwapLoading] = useState(false);
  const [swapError, setSwapError] = useState("");
  const [swapSuccess, setSwapSuccess] = useState("");
  const [swapRates, setSwapRates] = useState({ PLN_USD: 0.25, USD_PLN: 4.0, PLN_USDT: 0.25, USDT_PLN: 4.0, USD_USDT: 1.0, USDT_USD: 1.0 });
  // 实时汇率缓存（用于 WebSocket 推送的价格换算）
  const [usdToPlnRate, setUsdToPlnRate] = useState(18.0);
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
    const backendId = Number(session?.id ?? session?.backendId);
    const byBackend = users.find(u => Number(u.id) === backendId) || users.find(u => Number(u.backendId) === backendId);
    const byPhone = users.find(u => u.phone === session.phone);
    const base = byBackend || byPhone || session;
    // 始终以后端会话中的头像字段为准，避免本地镜像覆盖掉最新头像
    return {
      ...(base || {}),
      avatar: session?.avatar ?? base?.avatar ?? null,
      avatarUrl: session?.avatarUrl ?? base?.avatarUrl ?? null,
    };
  }, [session, users]);

  const avatarSrc = normalizeAvatar(session?.avatar || session?.avatarUrl || me?.avatarUrl || me?.avatar || (session?.profile && session.profile.avatarUrl) || "");
  const displayName = me?.name || me?.phone || "Usuario";
  // 余额状态：仅从后端数据库读取；初始化为 0
  const [balancePLN, setBalancePLN] = useState(0);
  const [balanceUSD, setBalanceUSD] = useState(0);
  const [balanceUSDT, setBalanceUSDT] = useState(0);
  const balance = balancePLN || 0;
  const BALANCE_TEXT = formatPLN(balance, lang);

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
      // 客户态接口
      const data = await api.get(`/me/balances`);
      const arr = Array.isArray(data?.balances) ? data.balances : [];
      const map = arr.reduce((m, r) => { m[String(r.currency).toUpperCase()] = Number(r.amount || 0); return m; }, {});
      setBalancePLN(Number.isFinite(map.PLN) ? map.PLN : 0);
      setBalanceUSD(Number.isFinite(map.USD) ? map.USD : 0);
      setBalanceUSDT(Number.isFinite(map.USDT) ? map.USDT : 0);
    } catch (_) {
      setBalancePLN(0);
      setBalanceUSD(0);
      setBalanceUSDT(0);
    }
  }, [me, session]);

  // 获取闪兑汇率
  const fetchSwapRates = useCallback(async () => {
    try {
      const data = await api.get('/swap/rates');
      if (data?.rates) {
        setSwapRates(data.rates);
      }
    } catch {
      // 使用默认汇率
    }
  }, []);

  // 执行闪兑
  const executeSwap = useCallback(async () => {
    const amount = Number(swapAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setSwapError(t('invalidAmount') || 'Invalid amount');
      return;
    }
    
    // 检查余额是否充足
    const fromBalance = swapFrom === 'PLN' ? balancePLN : (swapFrom === 'USD' ? balanceUSD : balanceUSDT);
    if (amount > fromBalance) {
      setSwapError(t('insufficientBalance') || 'Insufficient balance');
      return;
    }
    
    setSwapLoading(true);
    setSwapError("");
    setSwapSuccess("");
    
    try {
      const res = await api.post('/swap/execute', {
        from: swapFrom,
        to: swapTo,
        amount: amount
      });
      
      if (res?.success) {
        const received = Number(res.received || 0).toFixed(2);
        setSwapSuccess(`${t('swapSuccess') || 'Swap successful!'} ${t('received') || 'Received'}: ${received} ${swapTo}`);
        setSwapAmount("");
        await fetchBalances();
        setTimeout(() => {
          setSwapModalOpen(false);
          setSwapSuccess("");
        }, 2000);
      } else {
        setSwapError(res?.error || t('swapFailed') || 'Swap failed');
      }
    } catch (e) {
      setSwapError(String(e?.message || e || t('swapFailed') || 'Swap failed'));
    } finally {
      setSwapLoading(false);
    }
  }, [swapFrom, swapTo, swapAmount, balancePLN, balanceUSD, balanceUSDT, fetchBalances, t]);

  // 计算预估接收金额
  const estimatedReceive = useMemo(() => {
    const amount = Number(swapAmount);
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    const rateKey = `${swapFrom}_${swapTo}`;
    const rate = swapRates[rateKey] || 1;
    return (amount * rate).toFixed(2);
  }, [swapAmount, swapFrom, swapTo, swapRates]);

  // 切换闪兑方向
  const swapDirection = useCallback(() => {
    const temp = swapFrom;
    setSwapFrom(swapTo);
    setSwapTo(temp);
    setSwapAmount("");
    setSwapError("");
  }, [swapFrom, swapTo]);

  // 当登录用户变化或页面首次进入时拉取余额和汇率
  useEffect(() => { fetchBalances(); fetchSwapRates();
    const onHoldChanged = () => { fetchBalances(); };
    try { window.addEventListener('withdraw_hold_changed', onHoldChanged); } catch {}
    try { window.addEventListener('credit_debt_changed', onHoldChanged); } catch {}
    const onStorage = (e) => { try { const k = String(e?.key||''); if (!k) { fetchBalances(); return; } if (k.startsWith('withdraw:holds') || k === 'credit:debts') fetchBalances(); } catch {} };
    window.addEventListener('storage', onStorage);
    return () => { try { window.removeEventListener('withdraw_hold_changed', onHoldChanged); } catch {}; try { window.removeEventListener('credit_debt_changed', onHoldChanged); } catch {}; try { window.removeEventListener('storage', onStorage); } catch {} };
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
    if (DEBUG_LOG) LOG("[Home] fetch PL stocks start");
    const symbols = ["PKO.WA","PKN.WA","PZU.WA","KGH.WA","CDR.WA","ALR.WA"];
    // 先设置价格；spark 获取失败不应影响价格展示
    try {
      const list = await getQuotes({ market: "pl", symbols });
      if (DEBUG_LOG) LOG("[Home] fetch MX quotes done", { count: Array.isArray(list) ? list.length : 0, first: Array.isArray(list) ? list[0] : null });
      if (!list.length) throw new Error("empty");
      setStocks(list);
    } catch (_) {
      if (DEBUG_LOG) LOG("[Home] fetch MX quotes failed; try cache");
      // 失败时使用最近一次成功的缓存，避免页面全空
      try {
        const cached = [];
        for (const sym of symbols) {
          const raw = localStorage.getItem(`td:pl:${sym}`);
          if (raw) {
            const obj = JSON.parse(raw);
            if (obj?.data) cached.push(obj.data);
          }
        }
        if (cached.length) setStocks(cached);
        else {
          // 最后兜底：示例数据，避免首次加载为空
          setStocks([
            { symbol: "PKO.WA", name: "PKO Bank Polski", price: 88.3, changePct: -2.06, volume: 1630692 },
            { symbol: "PKN.WA", name: "PKN Orlen", price: 103.18, changePct: -1.71, volume: 1946357 },
            { symbol: "PZU.WA", name: "PZU S.A.", price: 68.84, changePct: -1.74, volume: 1125690 },
            { symbol: "KGH.WA", name: "KGHM Polska Miedź", price: 328.3, changePct: 4.72, volume: 1270872 },
            { symbol: "CDR.WA", name: "CD Projekt", price: 269.6, changePct: -0.15, volume: 175918 },
            { symbol: "ALR.WA", name: "Alior Bank", price: 113.6, changePct: -0.70, volume: 116793 },
          ]);
        }
      } catch {}
    }
    // sparkline 请求失败时忽略错误，避免影响价格
    try { await fetchSparkForStocks(symbols, "pl"); } catch (_) {}
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
      const list = await getQuotes({ market: "pl", symbols: ["^MXX"] });
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

  

  

  // 启动时预置 Crypto 列表，确保 WS 推送能立即体现在 UI 上
  useEffect(() => {
    if (!crypto.length) {
      const seed = TD_BASES.slice(0, 6).map(sym => ({
        id: sym.toLowerCase(), symbol: sym,
        name: CRYPTO_NAME_MAP[sym] || sym,
        priceUSD: 0, pricePLN: 0, changePct: 0,
        turnoverUSD: 0, turnoverPLN: 0,
      }));
      setCrypto(seed);
    }
  
  }, [crypto.length]);

  // 启动时预置股票列表，确保 TD/Finnhub WS 推送能立即体现在 UI 上
  useEffect(() => {
    if (!stocks.length) {
      setStocks([
        { symbol: "PKO.WA", name: "PKO Bank Polski", price: 88.3, changePct: -2.06, volume: 1630692 },
        { symbol: "PKN.WA", name: "PKN Orlen", price: 103.18, changePct: -1.71, volume: 1946357 },
        { symbol: "PZU.WA", name: "PZU S.A.", price: 68.84, changePct: -1.74, volume: 1125690 },
        { symbol: "KGH.WA", name: "KGHM Polska Miedź", price: 328.3, changePct: 4.72, volume: 1270872 },
        { symbol: "CDR.WA", name: "CD Projekt", price: 269.6, changePct: -0.15, volume: 175918 },
        { symbol: "ALR.WA", name: "Alior Bank", price: 113.6, changePct: -0.70, volume: 116793 },
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
    // 清理可能有问题的缓存
    try {
      TD_BASES.forEach(sym => {
        const k = `td:crypto:${sym}`;
        const raw = localStorage.getItem(k);
        if (raw) {
          try {
            const obj = JSON.parse(raw);
            if (obj?.data?.priceUSD === 0 || !obj?.data?.priceUSD) {
              localStorage.removeItem(k);
            }
          } catch { localStorage.removeItem(k); }
        }
      });
    } catch {}
    
    try {
      const { rate } = await getUsdPlnRate();
      setUsdToPlnRate(rate);
      const nameMap = CRYPTO_NAME_MAP;
      const quotes = await getCryptoQuotes({ symbols: TD_BASES });
      console.log('[Home] crypto quotes received:', quotes);
      const list = quotes.slice(0, 6).map(q => ({
        id: q.symbol.toLowerCase(),
        symbol: q.symbol,
        name: nameMap[q.symbol] || q.name || q.symbol,
        pricePLN: Number(q.priceUSD || q.price || 0) * rate,
        priceUSD: Number(q.priceUSD || q.price || 0),
        changePct: Number(q.changePct || 0),
        turnoverPLN: Number(q.volume || 0) * rate,
        turnoverUSD: Number(q.volume || 0),
      }));
      // 检查是否有有效数据（至少有一个价格大于0）
      const hasValidPrice = list.some(item => item.priceUSD > 0);
      if (!list.length || !hasValidPrice) throw new Error("empty or invalid");
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
        const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=pln&order=market_cap_desc&per_page=6&page=1&sparkline=true&price_change_percentage=24h`;
        const markets = await fetch(url).then(r=>r.json());
        const { rate } = await getUsdPlnRate();
        const list = markets.map(m => ({
          id: m.id,
          name: m.name,
          symbol: m.symbol.toUpperCase(),
          pricePLN: m.current_price,
          priceUSD: Number(m.current_price) / rate,
          changePct: m.price_change_percentage_24h,
          turnoverPLN: m.total_volume,
          turnoverUSD: Number(m.total_volume) / rate,
          spark: (m.sparkline_in_7d?.price || [])
        }));
        if (!list.length) throw new Error("empty");
        setCrypto(list);
        const sparkMap = {};
        list.forEach(m => { sparkMap[m.symbol] = m.spark; });
        setCryptoSpark(sparkMap);
      } catch {
        console.log('[Home] Using static crypto fallback');
        const fallback = [
          { id: "bitcoin", name: "Bitcoin", symbol: "BTC", pricePLN: 418000, priceUSD: 104500, changePct: 2.35, turnoverPLN: 128000000000, turnoverUSD: 32000000000, spark: [102000,103000,103500,104000,104200,104500] },
          { id: "ethereum", name: "Ethereum", symbol: "ETH", pricePLN: 13120, priceUSD: 3280, changePct: 1.85, turnoverPLN: 60000000000, turnoverUSD: 15000000000, spark: [3200,3220,3250,3260,3270,3280] },
          { id: "bnb", name: "BNB", symbol: "BNB", pricePLN: 2780, priceUSD: 695, changePct: 0.92, turnoverPLN: 7200000000, turnoverUSD: 1800000000, spark: [680,685,690,692,694,695] },
          { id: "solana", name: "Solana", symbol: "SOL", pricePLN: 1008, priceUSD: 252, changePct: 3.15, turnoverPLN: 18000000000, turnoverUSD: 4500000000, spark: [240,245,248,250,251,252] },
          { id: "xrp", name: "XRP", symbol: "XRP", pricePLN: 12.48, priceUSD: 3.12, changePct: -0.45, turnoverPLN: 20800000000, turnoverUSD: 5200000000, spark: [3.15,3.14,3.13,3.12,3.11,3.12] },
          { id: "cardano", name: "Cardano", symbol: "ADA", pricePLN: 4.08, priceUSD: 1.02, changePct: 1.28, turnoverPLN: 3800000000, turnoverUSD: 950000000, spark: [0.98,0.99,1.00,1.01,1.01,1.02] },
        ];
        setCrypto(fallback);
        const sparkMap = {};
        fallback.forEach(m => { sparkMap[m.symbol] = m.spark; });
        setCryptoSpark(sparkMap);
      }
    }
  };

  // 移除指数卡片后，无需维护 cryptoIndices

  // 每 10 分钟刷新一次 USD→PLN 汇率，供 WebSocket 推送换算
  useEffect(() => {
    let cancelled = false;
    const updateRate = async () => {
      try { const { rate } = await getUsdPlnRate(); if (!cancelled) setUsdToPlnRate(rate); } catch {}
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
              pricePLN: priceUSD * usdToPlnRate,
              changePct,
              turnoverUSD: quoteVolUSD > 0 ? quoteVolUSD : m.turnoverUSD,
              turnoverPLN: (quoteVolUSD > 0 ? quoteVolUSD : (m.turnoverUSD || 0)) * usdToPlnRate,
            };
          } else {
            // 若列表尚未包含该币种，直接插入
            arr.push({
              id: base.toLowerCase(),
              symbol: base,
              name: nameMap[base] || base,
              priceUSD,
              pricePLN: priceUSD * usdToPlnRate,
              changePct,
              turnoverUSD: quoteVolUSD > 0 ? quoteVolUSD : 0,
              turnoverPLN: (quoteVolUSD > 0 ? quoteVolUSD : 0) * usdToPlnRate,
            });
          }
          return arr;
        });
      } catch {}
    };
    ws.onclose = () => { binanceWsRef.current = null; };
    ws.onerror = () => { /* 忽略错误，依赖轮询兜底 */ };
    return () => { try { ws.close(); } catch {} binanceWsRef.current = null; };
  
  }, [usdToPlnRate]);

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

  // 接入 Twelve Data WebSocket 实时更新美股与波兰股（使用相同 apikey，无需单独 WS key）
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
    // 注意：BMV 为 EOD 交易所，Twelve Data 不提供 BMV WebSocket；波兰股票仅使用 REST 轮询
    // const MX_SYMBOLS = ["AMXL.WA","WALMEX.WA","FEMSAUBD.WA","BIMBOA.WA","GMEXICOB.WA","GFNORTEO.WA"];
    // 指数不通过 TD WS 订阅，避免 ETF 价格覆盖自定义指数数据

    const usToWs = (s) => (s === "BRK-B" ? "BRK.B" : s);
    // const mxToWs = (s) => {
    //   let base = String(s).replace(/\.WA$/,""");
    //   if (base === "TLEVISA.CPO") base = "TLEVISACPO";
    //   return `${base}:BMV`;
    // };
    const wsSymbols = [];
    if (!hasFinnhub) wsSymbols.push(...US_SYMBOLS.map(usToWs));
    // 不添加波兰股票到 WS 订阅（BMV WS 不可用）
    // 不订阅指数：指数价格由自定义 API/REST 获取

    const wsToLocal = (s) => {
      // 波兰 BMV 不支持 WS：保留兼容映射但不再触发
      // if (/:BMV$/.test(s)) {
      //   let base = s.replace(/:BMV$/,'');
      //   if (base === "TLEVISACPO") base = "TLEVISA.CPO";
      //   return `${base}.WA`;
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
          if (/\.WA$/.test(localSym)) {
            if (DEBUG_LOG) console.debug("[Home] TD WS MX price", { symbol: localSym, price });
            setStocks(prev => prev.map(row => row.symbol === localSym ? { ...row, price } : row));
            pushSpark("pl", localSym, price);
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
      if (which === "pl") setMxSpark(prev => ({ ...prev, ...map }));
      else setUsSpark(prev => ({ ...prev, ...map }));
    } catch (_) {
      // ignore
    }
  };

  const refreshingRef = useRef(false);
  const refreshDataRef = useRef(null);
  const isFirstLoadRef = useRef(true);
  
  const refreshData = async (isBackground = false) => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    if (!isBackground && isFirstLoadRef.current) {
      setLoading(true);
    }
    setError("");
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
      // 波兰股：始终使用 REST 轮询（TD WS 不支持 BMV/XMEX 推送）
      const mxWsSilent = true; // TD WS不含BMV，始终走REST
      if (DEBUG_LOG) LOG("[Home] mx refresh decision", { mxWsSilent, willFetch: true });
      await fetchStocks();
      // 波兰股：WS 活跃但趋势缺失时，回填 spark（使用缓存避免频繁请求）
      try {
        const plSymbolsForSpark = ["PKO.WA","PKN.WA","PZU.WA","KGH.WA","CDR.WA","ALR.WA"];
        const needPlSpark = plSymbolsForSpark.filter(sym => !Array.isArray(mxSpark[sym]) || mxSpark[sym].length < 10);
        if (needPlSpark.length) await fetchSparkForStocks(needPlSpark, "pl");
      } catch {}
      // 加密：若 WS 不活跃或列表为空，则进行 REST 刷新
      if (!hasBinance) {
        await fetchCrypto();
      } else if (!crypto.length) {
        await fetchCrypto();
      }
      setUpdatedAt(Date.now());
      isFirstLoadRef.current = false;
    }
    catch (_e) { if (!isBackground) setError(t("fetchError")); }
    finally { setLoading(false); refreshingRef.current = false; }
  };
  refreshDataRef.current = refreshData;
  // 首次加载
  useEffect(() => {
    const first = () => { try { refreshDataRef.current?.(false); } catch {} };
    first();
  }, []);

  // 获取新闻用于轮播图（最多3条）
  useEffect(() => {
    const fetchNewsCarousel = async () => {
      try {
        const cacheKey = 'home:news:carousel';
        const cached = (() => { try { return JSON.parse(localStorage.getItem(cacheKey)||'null')||null } catch { return null } })();
        // 缓存5分钟
        if (cached && Array.isArray(cached.items) && cached.items.length && Date.now() - (cached.ts||0) < 300000) {
          setNewsCarousel(cached.items.slice(0, 3));
          return;
        }
        const r = await fetch(`/api/news/feed?market=mx&lang=${encodeURIComponent(lang)}`);
        const j = await r.json().catch(()=>({ items: [] }));
        let list = Array.isArray(j?.items) ? j.items.slice(0, 3) : [];
        if (!list.length) {
          const r2 = await fetch(`/api/news/pl?lang=${encodeURIComponent(lang)}`).catch(()=>null);
          const j2 = r2 ? await r2.json().catch(()=>({ items: [] })) : { items: [] };
          list = Array.isArray(j2.items) ? j2.items.slice(0, 3) : [];
        }
        if (list.length) {
          setNewsCarousel(list);
          try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), items: list })) } catch {}
        } else if (cached && Array.isArray(cached.items)) {
          setNewsCarousel(cached.items.slice(0, 3));
        }
      } catch {
        // 使用缓存
        try {
          const cached = JSON.parse(localStorage.getItem('home:news:carousel')||'null');
          if (cached && Array.isArray(cached.items)) setNewsCarousel(cached.items.slice(0, 3));
        } catch {}
      }
    };
    fetchNewsCarousel();
  }, [lang]);

  // 轮播图自动切换（每5秒）
  useEffect(() => {
    if (newsCarousel.length <= 1) return;
    carouselTimerRef.current = setInterval(() => {
      setCarouselIndex(prev => (prev + 1) % newsCarousel.length);
    }, 5000);
    return () => { if (carouselTimerRef.current) clearInterval(carouselTimerRef.current); };
  }, [newsCarousel.length]);

  // 轮播图滑动处理函数（触摸事件）
  const handleCarouselTouchStart = (e) => {
    // 暂停自动切换
    if (carouselTimerRef.current) {
      clearInterval(carouselTimerRef.current);
      carouselTimerRef.current = null;
    }
    carouselTouchStartRef.current = Date.now();
    carouselTouchXRef.current = e.touches[0].clientX;
  };

  const handleCarouselTouchMove = (e) => {
    if (!carouselTouchStartRef.current) return;
    e.preventDefault(); // 防止页面滚动
  };

  const handleCarouselTouchEnd = (e) => {
    if (!carouselTouchStartRef.current) return;
    const touchEndX = e.changedTouches[0].clientX;
    const touchStartX = carouselTouchXRef.current;
    const deltaX = touchStartX - touchEndX;
    const deltaTime = Date.now() - carouselTouchStartRef.current;
    
    // 滑动距离超过50px或快速滑动（时间少于300ms且距离超过30px）时切换
    const minSwipeDistance = 50;
    const quickSwipeDistance = 30;
    const quickSwipeTime = 300;
    
    if (Math.abs(deltaX) > minSwipeDistance || (Math.abs(deltaX) > quickSwipeDistance && deltaTime < quickSwipeTime)) {
      if (deltaX > 0) {
        // 向左滑动，显示下一张
        setCarouselIndex(prev => (prev + 1) % newsCarousel.length);
      } else {
        // 向右滑动，显示上一张
        setCarouselIndex(prev => (prev - 1 + newsCarousel.length) % newsCarousel.length);
      }
    }
    
    // 重置触摸状态
    carouselTouchStartRef.current = null;
    carouselTouchXRef.current = 0;
    
    // 重新启动自动切换
    if (newsCarousel.length > 1) {
      carouselTimerRef.current = setInterval(() => {
        setCarouselIndex(prev => (prev + 1) % newsCarousel.length);
      }, 5000);
    }
  };

  // 轮播图滑动处理函数（鼠标事件，用于桌面端）
  const handleCarouselMouseDown = (e) => {
    // 暂停自动切换
    if (carouselTimerRef.current) {
      clearInterval(carouselTimerRef.current);
      carouselTimerRef.current = null;
    }
    carouselMouseDownRef.current = true;
    carouselMouseXRef.current = e.clientX;
    e.preventDefault();
  };

  const handleCarouselMouseMove = (e) => {
    if (!carouselMouseDownRef.current) return;
    e.preventDefault();
  };

  const handleCarouselMouseUp = (e) => {
    if (!carouselMouseDownRef.current) return;
    const mouseEndX = e.clientX;
    const mouseStartX = carouselMouseXRef.current;
    const deltaX = mouseStartX - mouseEndX;
    
    // 滑动距离超过50px时切换
    const minSwipeDistance = 50;
    
    if (Math.abs(deltaX) > minSwipeDistance) {
      if (deltaX > 0) {
        // 向左滑动，显示下一张
        setCarouselIndex(prev => (prev + 1) % newsCarousel.length);
      } else {
        // 向右滑动，显示上一张
        setCarouselIndex(prev => (prev - 1 + newsCarousel.length) % newsCarousel.length);
      }
    }
    
    // 重置鼠标状态
    carouselMouseDownRef.current = false;
    carouselMouseXRef.current = 0;
    
    // 重新启动自动切换
    if (newsCarousel.length > 1) {
      carouselTimerRef.current = setInterval(() => {
        setCarouselIndex(prev => (prev + 1) % newsCarousel.length);
      }, 5000);
    }
  };

  // 处理鼠标离开元素的情况
  const handleCarouselMouseLeave = () => {
    if (carouselMouseDownRef.current) {
      carouselMouseDownRef.current = false;
      carouselMouseXRef.current = 0;
      // 重新启动自动切换
      if (newsCarousel.length > 1) {
        carouselTimerRef.current = setInterval(() => {
          setCarouselIndex(prev => (prev + 1) % newsCarousel.length);
        }, 5000);
      }
    }
  };

  // 全局鼠标事件处理（确保在元素外释放鼠标时也能正确处理）
  useEffect(() => {
    const handleGlobalMouseUp = (e) => {
      if (carouselMouseDownRef.current) {
        const mouseEndX = e.clientX;
        const mouseStartX = carouselMouseXRef.current;
        const deltaX = mouseStartX - mouseEndX;
        
        // 滑动距离超过50px时切换
        const minSwipeDistance = 50;
        
        if (Math.abs(deltaX) > minSwipeDistance) {
          if (deltaX > 0) {
            // 向左滑动，显示下一张
            setCarouselIndex(prev => (prev + 1) % newsCarousel.length);
          } else {
            // 向右滑动，显示上一张
            setCarouselIndex(prev => (prev - 1 + newsCarousel.length) % newsCarousel.length);
          }
        }
        
        // 重置鼠标状态
        carouselMouseDownRef.current = false;
        carouselMouseXRef.current = 0;
        
        // 重新启动自动切换
        if (newsCarousel.length > 1) {
          carouselTimerRef.current = setInterval(() => {
            setCarouselIndex(prev => (prev + 1) % newsCarousel.length);
          }, 5000);
        }
      }
    };

    const handleGlobalMouseMove = (e) => {
      if (carouselMouseDownRef.current) {
        e.preventDefault();
      }
    };

    window.addEventListener('mouseup', handleGlobalMouseUp);
    window.addEventListener('mousemove', handleGlobalMouseMove);
    
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('mousemove', handleGlobalMouseMove);
    };
  }, [newsCarousel.length]);

  // 自动刷新 - 后台静默刷新，不显示 loading
  useEffect(() => {
    const tick = () => { 
      if (!document.hidden) { 
        try { refreshDataRef.current?.(true); } catch {}
      } 
    };
    const id = setInterval(tick, 60000); // 60 秒刷新一次
    return () => clearInterval(id);
  }, []);

  // 计算热门列表与是否显示成交金额（若无法计算则隐藏）
  const calcTurnover = useCallback((s) => {
    if (market === "crypto") return cryptoCurrency === "USD" ? Number(s.turnoverUSD || 0) : Number(s.turnoverPLN || 0);
    return Number(s.volume || 0) * Number(s.price || 0);
  }, [market, cryptoCurrency]);
  const getSpark = useCallback((s) => {
    if (market === "crypto") return cryptoSpark[s.symbol] || s.spark || [];
    return (market === "pl" ? mxSpark[s.symbol] : usSpark[s.symbol]) || [];
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
    const base = (market === "crypto" ? crypto : (market === "pl" ? stocks : usStocks));
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
                <img className="avatar" src={avatarSrc || "/logo.jpg"} alt="avatar" onError={(e)=>{ try { e.currentTarget.src = '/logo.jpg'; } catch {} }} />
              </div>
              <div className="user-name" style={{ fontSize: 14, color: '#e6f1ff' }}>{displayName}</div>
            </div>
            {/* 多币种余额显示 */}
            <div className="wallet-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 12 }}>
              <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: '10px 12px' }}>
                <div className="label" style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>🇵🇱 PLN</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#e6f1ff' }}>{formatPLN(balancePLN, lang)}</div>
                <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>{t('forPLStocks') || 'PL Stocks'}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: '10px 12px' }}>
                <div className="label" style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>🇺🇸 USD</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#e6f1ff' }}>{formatMoney(balanceUSD, 'USD', lang)}</div>
                <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>{t('forUSStocks') || 'US Stocks'}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: '10px 12px' }}>
                <div className="label" style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>₮ USDT</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#e6f1ff' }}>{formatUSDT(balanceUSDT, lang)}</div>
                <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>{t('forCrypto') || 'Crypto'}</div>
              </div>
            </div>
          </div>
          {/* 右侧不再显示用户名，避免重复 */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }} />
        </div>

        <div className="sub-actions" style={{ marginTop: 16, gap: 10 }}>
          <button className="btn primary" onClick={() => navigate('/me/support')}>
            {t("recharge")}
          </button>
          <button className="btn" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', border: 'none' }} onClick={() => setSwapModalOpen(true)}>
            <IconLightning style={{ width: 16, height: 16, marginRight: 6 }} />
            {t("flashSwap") || "Flash Swap"}
          </button>
        </div>
      </div>

      {/* 新闻轮播图 */}
      {newsCarousel.length > 0 && (
        <div className="card borderless-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div 
            className="news-carousel" 
            style={{ position: 'relative', borderRadius: 'var(--radius)', overflow: 'hidden', border: '1px solid var(--card-border)', boxShadow: 'var(--shadow)', touchAction: 'pan-y', cursor: 'grab', userSelect: 'none' }}
            onTouchStart={handleCarouselTouchStart}
            onTouchMove={handleCarouselTouchMove}
            onTouchEnd={handleCarouselTouchEnd}
            onMouseDown={handleCarouselMouseDown}
            onMouseMove={handleCarouselMouseMove}
            onMouseUp={handleCarouselMouseUp}
            onMouseLeave={handleCarouselMouseLeave}
          >
            {/* 轮播图片 */}
            <div 
              style={{ 
                display: 'flex', 
                transition: 'transform 0.5s ease',
                transform: `translateX(-${carouselIndex * 100}%)`,
              }}
            >
              {newsCarousel.map((news, idx) => (
                <div 
                  key={`carousel-${idx}`} 
                  style={{ 
                    minWidth: '100%', 
                    position: 'relative',
                  }}
                >
                  <img 
                    src={news.img} 
                    alt={news.title} 
                    style={{ 
                      width: '100%', 
                      height: 180, 
                      objectFit: 'cover',
                      display: 'block',
                    }} 
                    onError={(e) => { e.currentTarget.src = '/logo.jpg'; }}
                  />
                  {/* 标题遮罩 */}
                  <div style={{ 
                    position: 'absolute', 
                    bottom: 0, 
                    left: 0, 
                    right: 0, 
                    padding: '40px 16px 16px',
                    background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
                    color: '#fff',
                  }}>
                    <div style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.4 }}>{news.title}</div>
                  </div>
                </div>
              ))}
            </div>
            {/* 指示点 */}
            {newsCarousel.length > 1 && (
              <div style={{ 
                position: 'absolute', 
                bottom: 8, 
                left: '50%', 
                transform: 'translateX(-50%)',
                display: 'flex', 
                gap: 6,
              }}>
                {newsCarousel.map((_, idx) => (
                  <button 
                    key={`dot-${idx}`}
                    onClick={(e) => { e.stopPropagation(); setCarouselIndex(idx); }}
                    style={{ 
                      width: idx === carouselIndex ? 20 : 8, 
                      height: 8, 
                      borderRadius: 4,
                      background: idx === carouselIndex ? 'var(--accent)' : 'rgba(255,255,255,0.5)',
                      border: 'none',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease',
                    }}
                    aria-label={`Slide ${idx + 1}`}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2) 热门（当日成交量排序） */}
      <div className="card borderless-card">
        {/* 市场选择器 */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <button 
            className={`pill ${market === "us" ? "active" : ""}`} 
            onClick={() => setMarket("us")}
            style={{ 
              padding: "8px 16px", 
              fontSize: 14, 
              fontWeight: market === "us" ? 600 : 400,
              background: market === "us" ? "var(--accent)" : "rgba(255,255,255,0.06)",
              border: market === "us" ? "1px solid var(--accent)" : "1px solid rgba(255,255,255,0.1)",
              color: market === "us" ? "#fff" : "var(--text-secondary)",
              borderRadius: 20,
              cursor: "pointer",
              transition: "all 0.2s ease"
            }}
          >
            🇺🇸 {t("marketUS") || "US Stocks"}
          </button>
          <button 
            className={`pill ${market === "pl" ? "active" : ""}`} 
            onClick={() => setMarket("pl")}
            style={{ 
              padding: "8px 16px", 
              fontSize: 14, 
              fontWeight: market === "pl" ? 600 : 400,
              background: market === "pl" ? "var(--accent)" : "rgba(255,255,255,0.06)",
              border: market === "pl" ? "1px solid var(--accent)" : "1px solid rgba(255,255,255,0.1)",
              color: market === "pl" ? "#fff" : "var(--text-secondary)",
              borderRadius: 20,
              cursor: "pointer",
              transition: "all 0.2s ease"
            }}
          >
            🇵🇱 {t("marketPL") || "PL Stocks"}
          </button>
          <button 
            className={`pill ${market === "crypto" ? "active" : ""}`} 
            onClick={() => setMarket("crypto")}
            style={{ 
              padding: "8px 16px", 
              fontSize: 14, 
              fontWeight: market === "crypto" ? 600 : 400,
              background: market === "crypto" ? "var(--accent)" : "rgba(255,255,255,0.06)",
              border: market === "crypto" ? "1px solid var(--accent)" : "1px solid rgba(255,255,255,0.1)",
              color: market === "crypto" ? "#fff" : "var(--text-secondary)",
              borderRadius: 20,
              cursor: "pointer",
              transition: "all 0.2s ease"
            }}
          >
            ₿ {t("marketCrypto") || "Crypto"}
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 className="title" style={{ marginTop: 0 }}>{t("popularByVolumeTitle")}</h1>
          <span style={{ marginLeft: "auto" }} />
          <div className="pill-group" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <span className="desc">{t("sort")}{":"}</span>
            <button className={`pill ${popularSort === "turnover" ? "active" : ""}`} onClick={() => setPopularSort("turnover")}>{t("sortByTurnover")}</button>
            <button className={`pill ${popularSort === "momentum" ? "active" : ""}`} onClick={() => setPopularSort("momentum")}>{t("sortByMomentum")}</button>
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
                  market === "crypto" ? (cryptoCurrency === "USD" ? s.priceUSD : s.pricePLN) : s.price,
                  market === "crypto" ? cryptoCurrency : (market === "pl" ? "PLN" : "USD"),
                  lang
                )}</td>
                <td style={{ color: (s.changePct ?? 0) >= 0 ? "#5cff9b" : "#ff5c7a" }}>
                  {(s.changePct ?? 0).toFixed(2)}%
                </td>
                <td>
                  {market === "crypto" ? (
                    <Sparkline data={cryptoSpark[s.symbol] || s.spark || []} color={(s.changePct ?? 0) >= 0 ? "#5cff9b" : "#ff5c7a"} />
                  ) : (
                    <Sparkline data={(market === "pl" ? mxSpark[s.symbol] : usSpark[s.symbol]) || []} color={(s.changePct ?? 0) >= 0 ? "#5cff9b" : "#ff5c7a"} />
                  )}
                </td>
              </tr>
            ))}
            {(market === "crypto" ? crypto : (market === "pl" ? stocks : usStocks)).length === 0 && (
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
            {(market === "crypto" ? crypto.slice().sort((a,b)=> (b.changePct||0)-(a.changePct||0)) : (market === "pl" ? stocks : usStocks).slice().sort((a,b)=> (b.changePct||0)-(a.changePct||0))).map((s) => (
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
                    <Sparkline data={(market === "pl" ? mxSpark[s.symbol] : usSpark[s.symbol]) || []} color={(s.changePct ?? 0) >= 0 ? "#5cff9b" : "#ff5c7a"} />
                  )}
                </td>
                <td style={{ color: (s.changePct ?? 0) >= 0 ? "#5cff9b" : "#ff5c7a" }}>
                  {(s.changePct ?? 0).toFixed(2)}%
                </td>
              </tr>
            ))}
            {(market === "crypto" ? crypto : (market === "pl" ? stocks : usStocks)).length === 0 && (
              <tr>
                <td className="desc" colSpan={4}>--</td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
      {/* 闪兑模态框 */}
      {swapModalOpen && (
        <div className="modal" role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div className="modal-card" style={{ background: 'var(--card-bg)', borderRadius: 16, padding: 24, width: '90%', maxWidth: 400, boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: '#e6f1ff' }}>
                <IconLightning style={{ width: 20, height: 20, marginRight: 8, verticalAlign: 'middle' }} />
                {t('flashSwap') || 'Flash Swap'}
              </h2>
              <button onClick={() => { setSwapModalOpen(false); setSwapError(""); setSwapSuccess(""); }} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 24, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>
            
            {/* From 货币选择 */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>{t('from') || 'From'}</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select 
                  value={swapFrom} 
                  onChange={(e) => { setSwapFrom(e.target.value); setSwapError(""); }}
                  style={{ flex: '0 0 100px', padding: '12px', borderRadius: 8, background: '#1e293b', border: '1px solid rgba(255,255,255,0.2)', color: '#e6f1ff', fontSize: 14 }}
                >
                  <option value="PLN" style={{ background: '#1e293b', color: '#e6f1ff' }}>🇵🇱 PLN</option>
                  <option value="USD" style={{ background: '#1e293b', color: '#e6f1ff' }}>🇺🇸 USD</option>
                  <option value="USDT" style={{ background: '#1e293b', color: '#e6f1ff' }}>₮ USDT</option>
                </select>
                <input 
                  type="number" 
                  value={swapAmount}
                  onChange={(e) => { setSwapAmount(e.target.value); setSwapError(""); }}
                  placeholder="0.00"
                  style={{ flex: 1, padding: '12px', borderRadius: 8, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', color: '#e6f1ff', fontSize: 16 }}
                />
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                {t('available') || 'Available'}: {swapFrom === 'PLN' ? formatPLN(balancePLN, lang) : (swapFrom === 'USD' ? formatMoney(balanceUSD, 'USD', lang) : formatUSDT(balanceUSDT, lang))}
              </div>
            </div>
            
            {/* 切换方向按钮 */}
            <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
              <button 
                onClick={swapDirection}
                style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', border: 'none', borderRadius: '50%', width: 40, height: 40, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: '#fff' }}
              >
                ⇅
              </button>
            </div>
            
            {/* To 货币选择 */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>{t('to') || 'To'}</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select 
                  value={swapTo} 
                  onChange={(e) => { setSwapTo(e.target.value); setSwapError(""); }}
                  style={{ flex: '0 0 100px', padding: '12px', borderRadius: 8, background: '#1e293b', border: '1px solid rgba(255,255,255,0.2)', color: '#e6f1ff', fontSize: 14 }}
                >
                  <option value="PLN" style={{ background: '#1e293b', color: '#e6f1ff' }}>🇵🇱 PLN</option>
                  <option value="USD" style={{ background: '#1e293b', color: '#e6f1ff' }}>🇺🇸 USD</option>
                  <option value="USDT" style={{ background: '#1e293b', color: '#e6f1ff' }}>₮ USDT</option>
                </select>
                <div style={{ flex: 1, padding: '12px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.05)', color: '#5cff9b', fontSize: 16, fontWeight: 600 }}>
                  ≈ {estimatedReceive}
                </div>
              </div>
            </div>
            
            {/* 汇率显示 */}
            <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: 12, marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>{t('exchangeRate') || 'Exchange Rate'}</div>
              <div style={{ fontSize: 14, color: '#e6f1ff' }}>
                1 {swapFrom} = {swapRates[`${swapFrom}_${swapTo}`]?.toFixed(4) || '1.0000'} {swapTo}
              </div>
            </div>
            
            {/* 错误/成功提示 */}
            {swapError && (
              <div style={{ background: 'rgba(255,92,122,0.15)', border: '1px solid rgba(255,92,122,0.3)', borderRadius: 8, padding: 12, marginBottom: 16, color: '#ff5c7a', fontSize: 13 }}>
                {swapError}
              </div>
            )}
            {swapSuccess && (
              <div style={{ background: 'rgba(92,255,155,0.15)', border: '1px solid rgba(92,255,155,0.3)', borderRadius: 8, padding: 12, marginBottom: 16, color: '#5cff9b', fontSize: 13 }}>
                {swapSuccess}
              </div>
            )}
            
            {/* 确认按钮 */}
            <button 
              onClick={executeSwap}
              disabled={swapLoading || !swapAmount || swapFrom === swapTo}
              style={{ 
                width: '100%', 
                padding: '14px', 
                borderRadius: 10, 
                background: (swapLoading || !swapAmount || swapFrom === swapTo) ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg, #6366f1, #8b5cf6)', 
                border: 'none', 
                color: '#fff', 
                fontSize: 16, 
                fontWeight: 600, 
                cursor: (swapLoading || !swapAmount || swapFrom === swapTo) ? 'not-allowed' : 'pointer',
                opacity: (swapLoading || !swapAmount || swapFrom === swapTo) ? 0.5 : 1
              }}
            >
              {swapLoading ? (t('processing') || 'Processing...') : (t('confirmSwap') || 'Confirm Swap')}
            </button>
            
            {/* 说明 */}
            <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-secondary)', textAlign: 'center' }}>
              {t('swapNote') || 'Swap instantly between currencies for trading different markets'}
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
function normalizeAvatar(u) {
  try {
    const s = String(u || '').trim();
    if (!s) return '/logo.jpg';
    if (/^data:image\/(png|jpeg);base64,/i.test(s)) return s;
    if (/^https?:\/\//i.test(s)) return s;
    if (s.startsWith('/')) return s;
    if (/^[\w\-/.]+$/.test(s)) return `/uploads/${s.replace(/^\/+/, '')}`;
    return '/logo.jpg';
  } catch { return '/logo.jpg'; }
}
