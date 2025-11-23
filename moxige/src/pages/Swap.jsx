import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import BottomNav from "../components/BottomNav.jsx";
import SmartTradingChart from "../components/SmartTradingChart.jsx";
import MarketSelector from "../components/MarketSelector.jsx";
import { useI18n } from "../i18n.jsx";
import "../styles/trading.css";
import { getQuotes, getCryptoQuotes } from "../services/marketData.js";
import { api, notificationsApi } from "../services/api.js";
import { formatMoney, formatMXN, formatUSDT } from "../utils/money.js";

function readSession() {
  try { return JSON.parse(localStorage.getItem("sessionUser") || "null"); } catch { return null; }
}

export default function Swap() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [session] = useState(() => readSession());
  // 全局 TV 错误护栏：在进入 /swap 时最先注册，避免旧版 tv.js 报错触发顶层 ErrorBoundary
  const tvErrorGuardRef = useRef(false);
  useEffect(() => {
    const onGlobalError = (evt) => {
      try {
        const raw = evt?.message || evt?.error?.message || evt?.error || '';
        const msg = String(raw).toLowerCase();
        const isTvInitTDZ = msg.includes('cannot access tv before initialization') || /cannot\s+access\s+tv\b/i.test(msg);
        const isTvRelated = isTvInitTDZ || msg.includes('tradingview') || msg.includes('tv.js') || msg.includes('widget') || msg.includes('bento');
        if (isTvRelated && !tvErrorGuardRef.current) {
          tvErrorGuardRef.current = true;
          if (evt?.preventDefault) evt.preventDefault();
          if (evt?.stopPropagation) evt.stopPropagation();
          return true;
        }
      } catch {}
      return false;
    };
    const onGlobalRejection = (evt) => {
      try {
        const raw = evt?.reason?.message || evt?.reason || '';
        const msg = String(raw).toLowerCase();
        const isTvInitTDZ = msg.includes('cannot access tv before initialization') || /cannot\s+access\s+tv\b/i.test(msg);
        const isTvRelated = isTvInitTDZ || msg.includes('tradingview') || msg.includes('tv.js') || msg.includes('widget') || msg.includes('bento');
        if (isTvRelated && !tvErrorGuardRef.current) {
          tvErrorGuardRef.current = true;
          if (evt?.preventDefault) evt.preventDefault();
          if (evt?.stopPropagation) evt.stopPropagation();
          return true;
        }
      } catch {}
      return false;
    };
    try {
      window.addEventListener('error', onGlobalError, true);
      window.addEventListener('unhandledrejection', onGlobalRejection, true);
    } catch {}
    return () => {
      try {
        window.removeEventListener('error', onGlobalError, true);
        window.removeEventListener('unhandledrejection', onGlobalRejection, true);
      } catch {}
    };
  }, []);
  // 登录态标识需在首次使用之前声明，避免 TDZ 报错
  const isAuthed = !!session;
  // 账户余额（用于下单资金匹配）
  const [balanceMXN, setBalanceMXN] = useState(0);
  const [balanceUSD, setBalanceUSD] = useState(0);
  const [balanceUSDT, setBalanceUSDT] = useState(0);
  const [tradingDisabled, setTradingDisabled] = useState(false);
  const [kycStatus, setKycStatus] = useState('none');
  const [kycModal, setKycModal] = useState(false);
  // 金额格式化：改为统一工具，确保西语 MXN 使用 MX$
  
  // 交易状态
  const [orderType, setOrderType] = useState("buy"); // buy or sell
  const [priceType, setPriceType] = useState("market"); // market or limit
  const [quantity, setQuantity] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  
  // 订单队列（本地存储）
  const ordersKey = useMemo(() => {
    const id = session?.id || session?.phone || "guest";
    return `orders:${id}`;
  }, [session]);
  function readOrders() {
    try {
      const arr = JSON.parse(localStorage.getItem(ordersKey) || "[]");
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }
  function writeOrders(list) {
    try { localStorage.setItem(ordersKey, JSON.stringify(list || [])); } catch {}
  }
  void writeOrders;
  const [orders, setOrders] = useState(() => readOrders());

  const writeOrdersRef = useRef(() => {});
  useEffect(() => {
    writeOrdersRef.current = (list) => {
      try { localStorage.setItem(ordersKey, JSON.stringify(list || [])); } catch {}
    };
  }, [ordersKey]);

  // 交易记录（本地存储）
  const tradesKey = useMemo(() => {
    const id = session?.id || session?.phone || "guest";
    return `trades:${id}`;
  }, [session]);
  function readTrades() {
    try {
      const arr = JSON.parse(localStorage.getItem(tradesKey) || "[]");
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }
  function writeTrades(list) {
    try { localStorage.setItem(tradesKey, JSON.stringify(list || [])); } catch {}
  }
  void writeTrades;
  const [, setTrades] = useState(() => readTrades());
  const appendTrade = useCallback((tr) => {
    setTrades(prev => {
      const next = [tr, ...prev];
      try { localStorage.setItem(tradesKey, JSON.stringify(next || [])); } catch {}
      return next;
    });
  }, [tradesKey]);
  
  // TradingView 符号状态：从 URL 参数派生初始值，避免初始渲染误触发加密默认符号
  const [tradingViewSymbol, setTradingViewSymbol] = useState(() => {
    try {
      const sym = searchParams.get('symbol');
      const market = searchParams.get('market');
      if (sym) {
        const s = String(sym).toUpperCase();
        if (market === 'crypto') {
          const hasQuote = /(USDT|USD|BUSD)$/i.test(s);
          const basePair = hasQuote ? s : `${s}USDT`;
          return `BINANCE:${basePair}`;
        }
        if (market === 'us') return `NASDAQ:${s}`;
        if (market === 'mx') return `BMV:${s}`;
      }
    } catch {}
    return "BINANCE:ETHUSDT";
  });
  
  // 模拟股票数据
  const [stockPrice, setStockPrice] = useState(817.20);
  const [priceChange, setPriceChange] = useState(0.80);
  const [priceChangePercent, setPriceChangePercent] = useState(0.80);

  // 实时价格（用于顶部红框显示）
  const [livePrice, setLivePrice] = useState(null);
  const lastPriceRef = useRef(null);
  const [priceTrend, setPriceTrend] = useState(null); // up | down | null

  // 当前用户标识与持仓存储键
  const userKey = useMemo(() => {
    const id = session?.id || session?.phone || "guest";
    return `positions:${id}`;
  }, [session]);

  function readPositions() {
    try {
      const arr = JSON.parse(localStorage.getItem(userKey) || "[]");
      const list = Array.isArray(arr) ? arr : [];
      // 迁移旧结构 { symbol, quantity, avgPrice } -> 新结构 { longQty, longAvg, shortQty, shortAvg }
      return list.map(p => {
        if (p && ("longQty" in p || "shortQty" in p)) return p;
        return {
          symbol: p.symbol,
          longQty: Number(p.quantity || 0),
          longAvg: Number(p.avgPrice || 0),
          shortQty: 0,
          shortAvg: 0,
        };
      });
    } catch { return []; }
  }
  function writePositions(list) {
    try { localStorage.setItem(userKey, JSON.stringify(list || [])); } catch {}
  }
  void writePositions;
  const [positions, setPositions] = useState(() => readPositions());
  const [ipoConstraints, setIpoConstraints] = useState({});
  const [toast, setToast] = useState({ msg: '', kind: 'info', ts: 0 });
  function showToast(message, kind = 'info', ttlMs = 1200) {
    const ts = Date.now();
    setToast({ msg: String(message), kind, ts });
    setTimeout(() => { setToast(p => (p.ts === ts ? { msg: '', kind: 'info', ts: 0 } : p)); }, ttlMs);
  }

  const writePositionsRef = useRef(() => {});
  useEffect(() => {
    writePositionsRef.current = (list) => {
      try { localStorage.setItem(userKey, JSON.stringify(list || [])); } catch {}
    };
  }, [userKey]);

  

  // 资金与余额辅助：解析后端用户ID、刷新余额、提交资金操作
  const resolveUid = useCallback(async () => {
    let uid = Number(session?.id ?? session?.backendId);
    if (!uid && session?.phone) {
      try {
        const res = await api.get(`/admin/users?q=${encodeURIComponent(session.phone)}`);
        const arr = Array.isArray(res?.users) ? res.users : [];
        const match = arr.find(u => String(u.phone) === String(session.phone));
        if (match && Number(match.id)) uid = Number(match.id);
      } catch {}
    }
    return uid || null;
  }, [session]);

  const refreshBalancesFromServer = useCallback(async () => {
    try {
      const uid = await resolveUid();
      if (!uid) return;
      let data;
      try { data = await api.get(`/admin/users/${uid}/balances`); }
      catch { data = await api.get(`/me/balances`); }
      try { setTradingDisabled(!!data?.disabled); } catch {}
      const arr = Array.isArray(data?.balances) ? data.balances : [];
      const map = arr.reduce((m, r) => { m[String(r.currency).toUpperCase()] = Number(r.amount || 0); return m; }, {});
      setBalanceMXN(Number.isFinite(map.MXN) ? map.MXN : 0);
      setBalanceUSD(Number.isFinite(map.USD) ? map.USD : 0);
      setBalanceUSDT(Number.isFinite(map.USDT) ? map.USDT : 0);
    } catch {}
  }, [resolveUid]);

  useEffect(() => {
    (async () => {
      try {
        if (!isAuthed) return;
        const s = await api.get('/me/kyc/status');
        const status = String(s?.status || 'none');
        setKycStatus(status);
        try { localStorage.setItem('kyc:status', status); } catch {}
      } catch {}
    })();
  }, [isAuthed]);

  // 从服务端同步持仓与订单（上移以避免 TDZ 被依赖时未初始化）
  const refreshPositionsFromServer = useCallback(async () => {
    try {
      const data = await api.get(`/me/positions`);
      const arr = Array.isArray(data?.positions) ? data.positions : [];
      const next = arr.map(p => ({
        symbol: p.symbol,
        longQty: Number(p.long_qty || 0),
        longAvg: Number(p.long_avg || p.avg_price || 0),
        shortQty: Number(p.short_qty || 0),
        shortAvg: Number(p.short_avg || 0),
        locked: !!p.locked,
      }));
      setPositions(next);
      writePositionsRef.current(next);
    } catch {}
  }, []);

  const refreshOrdersFromServer = useCallback(async () => {
    try {
      const data = await api.get(`/me/orders`);
      const arr = Array.isArray(data?.orders) ? data.orders : [];
      const next = arr.map(o => ({ id: String(o.id), symbol: o.symbol, side: o.side, type: o.type, quantity: Number(o.qty), limitPrice: Number(o.price), status: o.status, createdAt: new Date(o.created_at).getTime(), fillPrice: Number(o.price) }));
      setOrders(next);
      writeOrdersRef.current(next);
    } catch {}
  }, []);

  // 统一通过后端交易端点执行与结算
  const postTradeExecute = useCallback(async ({ symbol, side, qty, price }) => {
    try {
      await api.post(`/trade/execute`, { symbol, side, qty, price });
      await refreshBalancesFromServer();
      await refreshPositionsFromServer();
      await refreshOrdersFromServer();
      return true;
    } catch (e) {
      const msg = String(e?.message || e || '').toLowerCase();
      if (msg.includes('market_time_closed')) {
        showToast(lang==='zh'?'当前不在交易时间':(lang==='es'?'Fuera del horario de mercado':'Market time closed'), 'warn');
      } else {
        showToast(String(e?.message || e), 'error');
      }
      return false;
    }
  }, [refreshBalancesFromServer, refreshPositionsFromServer, refreshOrdersFromServer, lang]);

  const postCreateLimitOrder = useCallback(async ({ symbol, side, qty, limitPrice }) => {
    try {
      const res = await api.post(`/trade/orders`, { symbol, side, qty, limitPrice });
      await refreshOrdersFromServer();
      return res;
    } catch (e) {
      const msg = String(e?.message || e || '').toLowerCase();
      if (msg.includes('market_time_closed')) {
        showToast(lang==='zh'?'当前不在交易时间':(lang==='es'?'Fuera del horario de mercado':'Market time closed'), 'warn');
      } else {
        showToast(String(e?.message || e), 'error');
      }
      return null;
    }
  }, [refreshOrdersFromServer, lang]);

  const postFillLimitOrder = useCallback(async (id, fillPrice) => {
    try {
      await api.post(`/trade/orders/${id}/fill`, { fillPrice });
      await refreshBalancesFromServer();
      await refreshPositionsFromServer();
      await refreshOrdersFromServer();
    } catch (e) {
      const msg = String(e?.message || e || '').toLowerCase();
      if (msg.includes('market_time_closed')) {
        showToast(lang==='zh'?'当前不在交易时间':(lang==='es'?'Fuera del horario de mercado':'Market time closed'), 'warn');
      } else {
        showToast(String(e?.message || e), 'error');
      }
    }
  }, [refreshPositionsFromServer, refreshBalancesFromServer, refreshOrdersFromServer, lang]);

  

  // 初始化时拉取服务端持仓与订单，保证与后端一致
  useEffect(() => {
    if (!isAuthed) return;
    const run = async () => {
      try {
        await refreshPositionsFromServer();
        await refreshOrdersFromServer();
      } catch {}
    };
    run();
  }, [isAuthed, refreshPositionsFromServer, refreshOrdersFromServer]);

  // 公开 IPO 信息查询：根据当前显示符号在进入股票市场时拉取约束
  useEffect(() => {
    const disp = parseDisplaySymbol(tradingViewSymbol);
    const mk = detectMarket(tradingViewSymbol);
    const isStock = mk === 'mx' || mk === 'us';
    if (!isStock) return;
    (async () => {
      try {
        const data = await api.get(`/api/trade/ipo/lookup?code=${encodeURIComponent(disp)}`);
        const it = data?.item || data;
        if (it && (it.code || it.list_at || it.listAt)) {
          setIpoConstraints(p => ({
            ...p,
            [disp]: {
              listAt: it.list_at || it.listAt || '',
              canSellOnListingDay: !!(it.can_sell_on_listing_day || it.canSellOnListingDay),
            }
          }));
        }
      } catch {}
    })();
  }, [tradingViewSymbol]);

  const listingRestricted = (() => {
    const disp = parseDisplaySymbol(tradingViewSymbol);
    const info = ipoConstraints[disp];
    if (!info || !info.listAt) return false;
    const ts = new Date(info.listAt).getTime();
    if (!Number.isFinite(ts)) return false;
    return Date.now() < ts && !info.canSellOnListingDay;
  })();

  async function addTradeNotification({ side, symbol, qty, price, currency, total, type }) {
    try {
      const uid = await resolveUid();
      const isBuy = side === 'buy';
      const verb = isBuy ? (lang === 'es' ? 'Has comprado' : 'You purchased') : (lang === 'es' ? 'Has vendido' : 'You sold');
      const title = lang === 'es' ? 'Operación ejecutada' : 'Trade Executed';
      const body = `${verb} ${symbol} · ${qty} @ ${Number(price).toFixed(2)} · ${isBuy ? (lang === 'es' ? 'Gastaste' : 'Spent') : (lang === 'es' ? 'Recibiste' : 'Received')} ${total} ${currency} (${type})`;
      notificationsApi.add(uid, { title, body, pinned: false });
    } catch {}
  }

  // 不再强制重定向未登录用户，允许浏览图表与行情；仅禁止下单

  

  // 根据符号前缀判断市场类型
  function detectMarket(sym) {
    if (!sym) return "unknown";
    if (sym.includes("BINANCE:")) return "crypto";
    if (sym.includes("NASDAQ:")) return "us";
    if (sym.includes("BMV:")) return "mx";
    return "unknown";
  }
  // 解析显示用符号
  function parseDisplaySymbol(sym) {
    return String(sym || "").replace(/^.*:/, "");
  }

  // 提取加密交易对的基础币种（如 BTCUSDT -> BTC）
  function baseFromDisp(disp) {
    const s = String(disp || "").toUpperCase();
    const m = s.match(/^([A-Z0-9]+)(USDT|USD|BUSD)$/);
    return m ? m[1] : s;
  }

  // 根据市场与标的选择价格小数位：主流币两位，小币种更多；股票两位
  function priceDecimalsFor(disp, price) {
    const mk = /\.MX$/i.test(disp) ? 'mx' : (/^(?:[A-Z0-9]+)(USDT|USD|BUSD)$/i.test(disp) ? 'crypto' : 'us');
    if (mk === 'mx' || mk === 'us') return 2;
    const base = baseFromDisp(disp);
    const major = new Set(["BTC","ETH","BNB","SOL"]);
    if (major.has(base)) return 2;
    const p = Number(price);
    if (!Number.isFinite(p)) return 4;
    if (p < 1) return 6;
    return 4;
  }

  // 读取缓存的价格信息（用于持仓盈亏）
  function readPriceInfo(symbol) {
    try { return JSON.parse(localStorage.getItem(`price:${symbol}`) || "null"); } catch { return null; }
  }

  const [, setPnlTick] = useState(0);
  const lastFetchRef = useRef({}); // 每符号最近一次Yahoo拉取时间戳，避免过度请求

  // 将墨股显示符号转换为 Yahoo Finance 符号（示例：AMX/L -> AMXL.MX）
  function toYahooMexicoSymbol(disp) {
    if (!disp) return "";
    const base = String(disp).toUpperCase().replace(/\/+/g, "").replace(/\.MX$/i, "");
    return `${base}.MX`;
  }

  function isCryptoDisp(disp) {
    const s = String(disp || "").toUpperCase();
    // 仅识别标准加密交易对（避免将 BTC/ETH 这样的基础币误判为可用于行情接口的交易对）
    return s.endsWith("USDT") || s.endsWith("BUSD") || s.endsWith("USD");
  }

  // 允许取消正在进行的请求，避免组件卸载后仍持有回调
  const abortRef = useRef({});

  const refreshPriceForSymbol = useCallback(async (disp) => {
    try {
      // 如果此前该符号有未完成请求，先中止
      const prevAbort = abortRef.current[disp];
      if (prevAbort) { try { prevAbort.abort(); } catch {} }
      const controller = new AbortController();
      abortRef.current[disp] = controller;

      // 统一节流：≥2s才重新拉取，避免并发导致页面卡顿
      const last = Number(lastFetchRef.current[disp] || 0);
      if (Date.now() - last < 2000) {
        return;
      }
      lastFetchRef.current[disp] = Date.now();

      let price = NaN, change = 0, changePct = 0;
      if (isCryptoDisp(disp)) {
        const base = String(disp).toUpperCase().replace(/(USDT|USD|BUSD)$/,'');
        const list = await getCryptoQuotes({ symbols: [base] });
        const q = list[0];
        price = Number(q?.priceUSD || q?.price || NaN);
        changePct = Number(q?.changePct || 0);
        change = Number.isFinite(price) ? price * (changePct/100) : 0;
      } else {
        let symbol = disp;
        let market = /\.MX$/i.test(disp) ? 'mx' : 'us';
        if (market === 'us' && !/^[A-Z][A-Z0-9.-]{0,6}$/i.test(disp)) {
          symbol = toYahooMexicoSymbol(disp);
          market = 'mx';
        }
        const list = await getQuotes({ market, symbols: [symbol] });
        const q = list[0];
        price = Number(q?.price ?? NaN);
        if (market==='us' && Number.isFinite(price) && price > 1000) {
          try {
            const closes = await getStockSpark(symbol, 'us', { interval: '1day', points: 1 });
            const prevClose = Array.isArray(closes) && closes.length ? Number(closes[closes.length - 1] || 0) : 0;
            if (Number.isFinite(prevClose) && prevClose > 0) price = prevClose;
          } catch {}
        }
        if (market==='mx' && Number.isFinite(price) && price > 1000) {
          try {
            const closes = await getStockSpark(symbol, 'mx', { interval: '1day', points: 1 });
            const prevClose = Array.isArray(closes) && closes.length ? Number(closes[closes.length - 1] || 0) : 0;
            if (Number.isFinite(prevClose) && prevClose > 0) price = prevClose;
          } catch {}
        }
        changePct = Number(q?.changePct ?? 0);
        change = Number.isFinite(price) ? price * (changePct/100) : 0;
      }
      if (Number.isFinite(price) && price > 0) {
        localStorage.setItem(`price:${disp}`, JSON.stringify({ price, change, changePct, ts: Date.now() }));
      }
    } catch {
      // 忽略错误；保持上次缓存即可
    }
  }, []);

  // 每2.4秒刷新一次（Yahoo做2s节流）所有持仓符号和当前选中符号的最新价缓存，不影响K线
  useEffect(() => {
    if (!positions.length && !tradingViewSymbol) return;
    let stopped = false;
    const selectedDisp = parseDisplaySymbol(tradingViewSymbol);
    const symbols = Array.from(new Set([
      ...positions.map(p => String(p.symbol)),
      selectedDisp
    ].filter(Boolean)));
    async function run() {
      await Promise.all(symbols.map(s => refreshPriceForSymbol(s)));
      if (!stopped) setPnlTick(t => t + 1); // 触发界面重渲染
    }
    run();
    const timer = setInterval(run, 2400);
    return () => {
      stopped = true; 
      clearInterval(timer);
      // 终止所有符号的进行中请求
      try {
        Object.values(abortRef.current || {}).forEach(ctrl => ctrl?.abort?.());
        abortRef.current = {};
      } catch {}
    };
  }, [positions, tradingViewSymbol, refreshPriceForSymbol]);

  // 抓取当前价（仅在符号变更时执行一次，避免持续刷新影响K线查看）
  useEffect(() => {
    let aborted = false;
    async function fetchOnce() {
      const market = detectMarket(tradingViewSymbol);
      const disp = parseDisplaySymbol(tradingViewSymbol);
      try {
        let p = NaN;
        let ch = 0;
        let pct = 0;
        if (market === "crypto") {
          const base = String(disp).toUpperCase().replace(/(USDT|USD|BUSD)$/,'');
          const list = await getCryptoQuotes({ symbols: [base] });
          const q = list[0];
          p = Number(q?.priceUSD || q?.price || NaN);
          pct = Number(q?.changePct || 0);
          ch = Number.isFinite(p) ? p * (pct/100) : 0;
        } else {
          let symbol = disp;
          let mk = /\.MX$/i.test(disp) ? 'mx' : 'us';
          if (mk === 'us' && !/^[A-Z][A-Z0-9.-]{0,6}$/i.test(disp)) {
            symbol = toYahooMexicoSymbol(disp);
            mk = 'mx';
          }
          const list = await getQuotes({ market: mk, symbols: [symbol] });
          const q = list[0];
          p = Number(q?.price ?? NaN);
          if (mk==='us' && Number.isFinite(p) && p > 1000) {
            try {
              const closes = await getStockSpark(symbol, 'us', { interval: '1day', points: 1 });
              const prevClose = Array.isArray(closes) && closes.length ? Number(closes[closes.length - 1] || 0) : 0;
              if (Number.isFinite(prevClose) && prevClose > 0) p = prevClose;
            } catch {}
          }
          if (mk==='mx' && Number.isFinite(p) && p > 1000) {
            try {
              const closes = await getStockSpark(symbol, 'mx', { interval: '1day', points: 1 });
              const prevClose = Array.isArray(closes) && closes.length ? Number(closes[closes.length - 1] || 0) : 0;
              if (Number.isFinite(prevClose) && prevClose > 0) p = prevClose;
            } catch {}
          }
          pct = Number(q?.changePct ?? 0);
          ch = Number.isFinite(p) ? p * (pct/100) : 0;
        }
        if (!aborted) {
          if (Number.isFinite(p) && p > 0) {
            setLivePrice(p);
            setStockPrice(p); // 与下单价格联动（一次性）
            setPriceChange(ch);
            setPriceChangePercent(pct);
            const prev = Number(lastPriceRef.current ?? p);
            if (Number.isFinite(prev)) {
              if (p > prev) setPriceTrend('up');
              else if (p < prev) setPriceTrend('down');
            }
            lastPriceRef.current = p;
            // 缓存当前标的的价格信息，用于持仓盈亏计算
            try { localStorage.setItem(`price:${disp}`, JSON.stringify({ price: p, change: ch, changePct: pct, ts: Date.now() })); } catch {}
          } else {
            // 一次性回退为轻度波动模拟
            setLivePrice(prev => {
              const base = Number(prev ?? 817.2);
              const next = Math.max(0, base + (Math.random() - 0.5) * base * 0.002);
              const last = lastPriceRef.current ?? base;
              const ch = next - last;
              const pct = last > 0 ? (ch / last) * 100 : 0;
              setPriceChange(ch);
              setPriceChangePercent(pct);
              if (next > last) setPriceTrend('up');
              else if (next < last) setPriceTrend('down');
              lastPriceRef.current = next;
              setStockPrice(next);
              try { localStorage.setItem(`price:${disp}`, JSON.stringify({ price: next, change: ch, changePct: pct, ts: Date.now() })); } catch {}
              return next;
            });
          }
        }
      } catch (_) {
        if (!aborted) {
          // 一次性回退为模拟值
          setLivePrice(prev => {
            const base = Number(prev ?? 817.2);
            const next = Math.max(0, base + (Math.random() - 0.5) * base * 0.002);
            const last = lastPriceRef.current ?? base;
            const ch = next - last;
            const pct = last > 0 ? (ch / last) * 100 : 0;
            setPriceChange(ch);
            setPriceChangePercent(pct);
            if (next > last) setPriceTrend('up');
            else if (next < last) setPriceTrend('down');
            lastPriceRef.current = next;
            setStockPrice(next);
            try {
              const disp = parseDisplaySymbol(tradingViewSymbol);
              localStorage.setItem(`price:${disp}`, JSON.stringify({ price: next, change: ch, changePct: pct, ts: Date.now() }));
            } catch {}
            return next;
          });
        }
      }
    }
    fetchOnce();
    return () => { aborted = true; };
  }, [tradingViewSymbol]);

  // 顶部价格条：每0.5s从缓存读取更新（不触发网络，也不影响图表）
  useEffect(() => {
    const disp = parseDisplaySymbol(tradingViewSymbol);
    const readFromCache = () => {
      const info = readPriceInfo(disp);
      if (info) {
        if (Number.isFinite(info.price)) {
          const prev = Number(lastPriceRef.current ?? livePrice ?? info.price);
          setLivePrice(info.price);
          if (Number.isFinite(prev)) {
            if (info.price > prev) setPriceTrend('up');
            else if (info.price < prev) setPriceTrend('down');
          }
          lastPriceRef.current = info.price;
        }
        if (Number.isFinite(info.change)) setPriceChange(info.change);
        if (Number.isFinite(info.changePct)) setPriceChangePercent(info.changePct);
      }
    };
    const timer = setInterval(readFromCache, 500);
    return () => clearInterval(timer);
  }, [tradingViewSymbol, livePrice]);

  // 抓取后端余额（与 Home 相同接口）
  useEffect(() => {
    let stopped = false;
    const fetchBalances = async () => {
      try {
        let uid = Number(session?.id ?? session?.backendId);
        if (!uid && session?.phone) {
          try {
            const res = await api.get(`/admin/users?q=${encodeURIComponent(session.phone)}`);
            const arr = Array.isArray(res?.users) ? res.users : [];
            const match = arr.find(u => String(u.phone) === String(session.phone));
            if (match && Number(match.id)) {
              uid = Number(match.id);
            }
          } catch {}
        }
        if (!uid) return;
        const data = await api.get(`/admin/users/${uid}/balances`);
        const arr = Array.isArray(data?.balances) ? data.balances : [];
        const map = arr.reduce((m, r) => { m[String(r.currency).toUpperCase()] = Number(r.amount || 0); return m; }, {});
        if (stopped) return;
        setBalanceMXN(Number.isFinite(map.MXN) ? map.MXN : 0);
        setBalanceUSD(Number.isFinite(map.USD) ? map.USD : 0);
        setBalanceUSDT(Number.isFinite(map.USDT) ? map.USDT : 0);
      } catch {}
    };
    if (session) fetchBalances();
    return () => { stopped = true; };
  }, [session]);

  // ---- 限价单成交检查（服务端持久化）：每2s刷新订单并根据触发条件调用后端成交（未登录不轮询） ----
  const ordersRef = useRef([]);
  useEffect(() => { ordersRef.current = orders; }, [orders]);
  useEffect(() => {
    let stopped = false;
    function shouldFill(order, currentPrice) {
      if (!Number.isFinite(currentPrice)) return false;
      if (order.side === "buy") return currentPrice <= order.limitPrice;
      return currentPrice >= order.limitPrice;
    }
    const tick = async () => {
      if (stopped) return;
      if (!isAuthed) return; // 未登录不拉取订单，避免后端401与资源消耗
      await refreshOrdersFromServer();
      const current = Number(livePrice ?? stockPrice);
      const pending = (ordersRef.current || []).filter(o => o.status === 'pending');
      for (const o of pending) {
        if (shouldFill(o, current)) {
          try {
            await postFillLimitOrder(o.id, current);
            appendTrade({ id: `tr_${Date.now()}`, symbol: o.symbol, side: o.side, type: 'limit', quantity: Number(o.quantity||0), price: current, ts: Date.now() });
            const uid = await resolveUid();
            const title = lang === 'es' ? 'Límite ejecutado' : 'Limit Filled';
            const body = lang === 'es' ? `Orden ${o.side === 'buy' ? 'de compra' : 'de venta'} ejecutada @ ${current}` : `Order ${o.side} filled @ ${current}`;
            notificationsApi.add(uid, { title, body, pinned: false });
          } catch {}
        }
      }
    };
    const timer = setInterval(tick, 2000);
    return () => { stopped = true; clearInterval(timer); };
  }, [tradingViewSymbol, livePrice, stockPrice, isAuthed, lang, refreshOrdersFromServer, postFillLimitOrder, appendTrade, resolveUid]);

  const handleSubmitOrder = async () => {
    if (kycStatus !== 'approved') { setKycModal(true); return; }
    if (tradingDisabled) { showToast(lang==='es'?'Operación deshabilitada (USD negativo)':'Trading disabled (USD negative)', 'warn'); return; }
    const qty = Number(quantity || 0);
    if (!Number.isFinite(qty) || qty <= 0) return;
    const dispSymbol = parseDisplaySymbol(tradingViewSymbol);
    if (orderType === 'sell') {
      if (listingRestricted) { showToast(t('sellRestrictedBeforeListing') || 'Sell restricted before listing', 'warn'); return; }
      if (positions.some(p => p.symbol === dispSymbol && p.locked)) { showToast('已锁仓', 'warn'); return; }
    }
    const market = detectMarket(tradingViewSymbol);
    // 下单所需资金币种
    const needCurrency = (market === 'crypto') ? 'USDT' : (/\.MX$/i.test(dispSymbol) ? 'MXN' : 'USD');
    const currentPrice = Number(livePrice ?? stockPrice);
    const execOrLimit = priceType === 'market' ? currentPrice : Number(limitPrice);
    const cost = Number.isFinite(execOrLimit) ? qty * execOrLimit : NaN;
    const funds = {
      MXN: Number(balanceMXN || 0),
      USD: Number(balanceUSD || 0),
      USDT: Number(balanceUSDT || 0),
    };
    const insuffMsg = needCurrency === 'MXN' ? t('errorBalanceInsufficientMXN')
                      : needCurrency === 'USD' ? t('errorBalanceInsufficientUSD')
                      : t('errorBalanceInsufficientUSDT');
    if (orderType === 'buy') {
      if (!Number.isFinite(cost) || cost <= 0) return;
      if (funds[needCurrency] < cost) { showToast(insuffMsg, 'warn'); return; }
    }
    if (priceType === 'market') {
      const execPrice = Number(livePrice ?? stockPrice);
      const orderTypeText = orderType === 'buy' ? t('buy') : t('sell');
      showToast(`${t('orderSubmitted')}: ${orderTypeText} ${quantity} ${t('shares')}`, 'success');
      const ok = await postTradeExecute({ symbol: dispSymbol, side: orderType, qty, price: execPrice });
      if (ok) {
        appendTrade({ id: `tr_${Date.now()}`, symbol: dispSymbol, side: orderType, type: 'market', quantity: qty, price: execPrice, ts: Date.now() });
        await addTradeNotification({ side: orderType, symbol: dispSymbol, qty, price: execPrice, currency: needCurrency, total: Number((qty * execPrice).toFixed(2)), type: 'market' });
        showToast(t('successBuy') || (lang==='es'? 'Compra realizada' : 'Buy successful'), 'success');
      }
      // 市价单不进入挂单队列（由服务端直接记录到 orders/positions/fund_logs）
    } else {
      const lp = Number(limitPrice);
      if (!Number.isFinite(lp) || lp <= 0) return;
      // 校验：买入限价不得高于当前价；卖出限价不得低于当前价
      const current = Number(livePrice ?? stockPrice);
      if (orderType === 'buy' && lp > current) {
        showToast(t('limitTooHigh') || 'Limit price cannot be higher than current price', 'warn');
        return;
      }
      if (orderType === 'sell' && lp < current) {
        showToast(t('limitTooLow') || 'Limit price cannot be lower than current price', 'warn');
        return;
      }
      
      await postCreateLimitOrder({ symbol: dispSymbol, side: orderType, qty, limitPrice: lp });
      const orderTypeText = orderType === 'buy' ? t('buy') : t('sell');
      showToast(`${t('orderSubmitted')}: ${orderTypeText} ${quantity} ${t('shares')} @ ${lp}`, 'success');
    }
  };

  // 处理符号变化
  const handleSymbolChange = (newSymbol) => {
    setTradingViewSymbol(newSymbol);
  };

  return (
    <div className="screen trading-screen">
      {toast.msg ? (
        <div aria-live="polite" style={{ position:'fixed', top:10, left:'50%', transform:'translateX(-50%)', padding:'8px 12px', borderRadius:8, background: toast.kind==='success' ? '#1f6f43' : (toast.kind==='warn' ? '#6f5f1f' : '#6f1f2a'), color:'#fff', boxShadow:'0 2px 8px rgba(0,0,0,0.3)', zIndex:9999 }}>
          {toast.msg}
        </div>
      ) : null}
      {/* 主要内容区域 */}
      <div className="trading-main">
        {/* 市场选择器（与交易记录图标同行，靠右）*/}
        <div className="market-selector-section selector-toolbar">
          <MarketSelector 
            onSymbolChange={handleSymbolChange}
            selectedSymbol={tradingViewSymbol}
          />
          <button
            className="trades-icon"
            title={t('trades') || 'Trades'}
            aria-label="open-trades"
            onClick={() => navigate('/trades')}
          >🧾</button>
        </div>

        {/* K线图区域 */}
        <div className="chart-section">
          <SmartTradingChart 
            symbol={tradingViewSymbol}
            height={400}
            period="1mo"
            interval="1d"
          />
        </div>

        {/* 实时价格显示条 */}
        <div className="price-ticker" aria-live="polite">
          <div className="ticker-left">
            <span className="ticker-symbol">{parseDisplaySymbol(tradingViewSymbol)}</span>
          </div>
          <div className="ticker-right">
            {(() => {
              const disp = parseDisplaySymbol(tradingViewSymbol);
              const dec = priceDecimalsFor(disp, Number(livePrice ?? stockPrice));
              const p = Number(livePrice ?? stockPrice);
              return (
                <span className={`ticker-price ${priceTrend || ''}`}>{Number(p).toFixed(dec)}
                  <span className={`ticker-arrow ${priceTrend || ''}`}>{priceTrend === 'up' ? '▲' : priceTrend === 'down' ? '▼' : ''}</span>
                </span>
              );
            })()}
            <span className={`ticker-change ${Number(priceChange) >= 0 ? 'up' : 'down'}`}>
              {Number(priceChange) >= 0 ? '+' : ''}{Number(priceChange).toFixed(2)} ({Number(priceChangePercent).toFixed(2)}%)
            </span>
          </div>
        </div>

        {/* 交易表单与持仓区域 */}
        <div className="trading-forms">
          {/* 左侧：下单表单 */}
          <div className="trading-card portfolio-card">
            <div className="portfolio-content">
              {/* 市场对应的小方框余额：加密显示 USDT；美股显示 USD；墨股显示 MXN */}
              {(() => {
                const mk = detectMarket(tradingViewSymbol);
                // 墨股页面使用“MX”标签；加密用 USDT；美股用 USD
                const currencyLabel = mk === 'crypto' ? 'USDT' : (mk === 'mx' ? 'MX' : 'USD');
                const value = currencyLabel === 'USDT' ? balanceUSDT : currencyLabel === 'MX' ? balanceMXN : balanceUSD;
                const formatted = currencyLabel === 'USDT'
                  ? formatUSDT(value)
                  : currencyLabel === 'MX'
                    ? formatMXN(value)
                    : formatMoney(value, 'USD');
                return (
                  <div className="balance-chip" aria-label="balance-chip">
                    <span className="chip-label">{currencyLabel}</span>
                    <span className="chip-value">{formatted}</span>
                  </div>
                );
              })()}
              <div className="trading-form">
                <div className="order-type-tabs">
                  <button 
                    className={`tab-btn ${orderType === 'buy' ? 'active buy' : ''}`}
                    onClick={() => setOrderType('buy')}
                  >
                    {t('buy')}
                  </button>
                <button 
                  className={`tab-btn ${orderType === 'sell' ? 'active sell' : ''}`}
                  onClick={() => setOrderType('sell')}
                  disabled={listingRestricted}
                >
                  {t('sell')}
                </button>
                </div>

                <div className="price-type-tabs">
                  <button 
                    className={`price-tab ${priceType === 'market' ? 'active' : ''}`}
                    onClick={() => setPriceType('market')}
                  >
                    {t('marketPrice')}
                  </button>
                  <button 
                    className={`price-tab ${priceType === 'limit' ? 'active' : ''}`}
                    onClick={() => setPriceType('limit')}
                  >
                    {t('limitPrice')}
                  </button>
                </div>

                <div className="form-group">
                  <label>{t('shares')}</label>
                  <input 
                    type="number" 
                    className="form-input"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    placeholder={t('placeholderShares')}
                  />
                </div>

                {priceType === 'limit' && (
                  <div className="form-group">
                    <label>{t('price')}</label>
                    <input 
                      type="number" 
                      className="form-input"
                      value={limitPrice}
                      onChange={(e) => setLimitPrice(e.target.value)}
                      placeholder={t('placeholderLimitPrice')}
                      step={( () => {
                        const dec = priceDecimalsFor(parseDisplaySymbol(tradingViewSymbol), Number(livePrice ?? stockPrice));
                        return dec >= 1 ? `0.${'0'.repeat(dec-1)}1` : '1';
                      })()}
                    />
                  </div>
                )}

                {/* 路由已拦截未登录访问，此处不再显示登录提示 */}

                <button 
                  className={`submit-btn ${orderType}`}
                  onClick={handleSubmitOrder}
                  disabled={tradingDisabled || !isAuthed || !quantity || (priceType === 'limit' && !limitPrice)}
                >
                  {orderType === 'buy' ? t('buy') : t('sell')}
                </button>
              </div>
            </div>
          </div>

          {/* 右侧：持仓列表（仅当有持仓时显示） */}
          {(() => {
            const hasPos = positions.some(p => Number(p.longQty||0) > 0 || Number(p.shortQty||0) > 0);
            if (!hasPos) return null;
            return (
          <div className="trading-card positions-card">
              <div className="positions-list" aria-label="positions-list">
                <div className="pos-header">
                  <span>{t('symbol')}</span>
                  <span>{t('qty')}</span>
                  <span>{t('avgPrice')}</span>
                  <span>{t('pnl')}</span>
                  <span>{t('pnlPct')}</span>
                  <span>{t('close')}</span>
                </div>
                {positions.flatMap((p) => {
                  const info = readPriceInfo(p.symbol);
                  const current = Number(info?.price ?? (parseDisplaySymbol(tradingViewSymbol) === p.symbol ? (livePrice ?? stockPrice) : NaN));
                  const rows = [];
                  const lQty = Number(p.longQty || 0);
                  const lAvg = Number(p.longAvg || 0);
                  if (lQty > 0) {
                    const pnlAmt = Number.isFinite(current) ? (current - lAvg) * lQty : 0;
                    const pnlPct = Number.isFinite(current) && lAvg > 0 ? ((current - lAvg) / lAvg) * 100 : 0;
                    const cls = pnlAmt >= 0 ? 'up' : 'down';
                    const dec = priceDecimalsFor(p.symbol, current);
                    rows.push(
                      <div className="pos-row" key={`pos-${p.symbol}-long`}>
                        <span className="pos-symbol">{p.symbol} <span className="pos-badge long">{t('long') || 'Long'}</span>{p.locked ? <span className="pos-badge short">{t('locked') || 'Locked'}</span> : null}</span>
                        <span className="pos-qty">{lQty}</span>
                        <span className="pos-avg">{lAvg.toFixed(dec)}</span>
                        <span className={`pos-pnl ${cls}`}>{pnlAmt.toFixed(2)}</span>
                        <span className={`pos-pnlpct ${cls}`}>{pnlPct.toFixed(2)}%</span>
                        <span>
                          <button className="btn" disabled={!!p.locked} onClick={async () => {
                            if (kycStatus !== 'approved') { setKycModal(true); return; }
                            // 平多：触发后端卖出成交并结算
                            if (tradingDisabled) { showToast(lang==='es'?'Operación deshabilitada (USD negativo)':'Trading disabled (USD negative)', 'warn'); return; }
                            const sellPrice = Number(current);
                            await postTradeExecute({ symbol: p.symbol, side: 'sell', qty: lQty, price: sellPrice });
                            appendTrade({ id: `tr_${Date.now()}`, symbol: p.symbol, side: 'sell', type: 'close', quantity: lQty, price: sellPrice, ts: Date.now() });
                            const cur = (/\.MX$/i.test(p.symbol) ? 'MXN' : /USDT$|USD$|BUSD$/i.test(p.symbol) ? 'USDT' : 'USD');
                            const total = Number((lQty * sellPrice).toFixed(2));
                            await addTradeNotification({ side: 'sell', symbol: p.symbol, qty: lQty, price: sellPrice, currency: cur, total, type: 'close' });
                          }}>{t('close')}</button>
                        </span>
                      </div>
                    );
                  }
                  const sQty = Number(p.shortQty || 0);
                  const sAvg = Number(p.shortAvg || 0);
                  if (sQty > 0) {
                    const pnlAmt = Number.isFinite(current) ? (sAvg - current) * sQty : 0; // 空头盈亏
                    const pnlPct = Number.isFinite(current) && sAvg > 0 ? ((sAvg - current) / sAvg) * 100 : 0;
                    const cls = pnlAmt >= 0 ? 'up' : 'down';
                    const dec = priceDecimalsFor(p.symbol, current);
                    rows.push(
                      <div className="pos-row" key={`pos-${p.symbol}-short`}>
                        <span className="pos-symbol">{p.symbol} <span className="pos-badge short">{t('short') || 'Short'}</span>{p.locked ? <span className="pos-badge short">{t('locked') || 'Locked'}</span> : null}</span>
                        <span className="pos-qty">{sQty}</span>
                        <span className="pos-avg">{sAvg.toFixed(dec)}</span>
                        <span className={`pos-pnl ${cls}`}>{pnlAmt.toFixed(2)}</span>
                        <span className={`pos-pnlpct ${cls}`}>{pnlPct.toFixed(2)}%</span>
                        <span>
                          <button className="btn" disabled={!!p.locked} onClick={async () => {
                            if (kycStatus !== 'approved') { setKycModal(true); return; }
                            // 平空：触发后端买入成交并结算
                            if (tradingDisabled) { showToast(lang==='es'?'Operación deshabilitada (USD negativo)':'Trading disabled (USD negative)', 'warn'); return; }
                            const buyPrice = Number(current);
                            await postTradeExecute({ symbol: p.symbol, side: 'buy', qty: sQty, price: buyPrice });
                            appendTrade({ id: `tr_${Date.now()}`, symbol: p.symbol, side: 'buy', type: 'close', quantity: sQty, price: buyPrice, ts: Date.now() });
                            const cur = (/\.MX$/i.test(p.symbol) ? 'MXN' : /USDT$|USD$|BUSD$/i.test(p.symbol) ? 'USDT' : 'USD');
                            const total = Number((sQty * buyPrice).toFixed(2));
                            await addTradeNotification({ side: 'buy', symbol: p.symbol, qty: sQty, price: buyPrice, currency: cur, total, type: 'close' });
                          }}>{t('close')}</button>
                        </span>
                      </div>
                    );
                  }
                  return rows;
                })}
              </div>
          </div>
            );
          })()}

          {/* 订单状态列表已取消显示，以减少信息干扰 */}

          {/* 交易记录改为独立页面 /trades，不再在此处显示 */}
        </div>
      </div>

      {kycModal && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal-card" style={{ maxWidth: 380 }}>
            <h2 className="title" style={{ marginTop: 0 }}>{lang==='zh'?'提示':(lang==='es'?'Aviso':'Notice')}</h2>
            <div className="desc" style={{ marginTop: 8 }}>
              {lang==='zh'?'你需要先完成实名认证':(lang==='es'?'Necesitas completar la verificación KYC primero':'You need to complete identity verification first')}
            </div>
            <div className="sub-actions" style={{ justifyContent:'flex-end', gap: 10, marginTop: 14 }}>
              <button className="btn" onClick={() => setKycModal(false)}>{lang==='zh'?'取消':(lang==='es'?'Cancelar':'Cancel')}</button>
              <button className="btn primary" onClick={() => { setKycModal(false); navigate('/me/settings'); }}>
                {lang==='zh'?'确认':(lang==='es'?'Confirmar':'Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
      <BottomNav />
    </div>
  );
}