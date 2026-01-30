import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import BottomNav from "../../components/BottomNav.jsx";
import { useI18n } from "../../i18n.jsx";
import { api, getToken } from "../../services/api.js";
import { getQuotes, getStockSpark } from "../../services/marketData.js";
import { formatMoney } from "../../utils/money.js";
import { formatMinute, getPolandTimestamp } from "../../utils/date.js";
import "../../styles/profile.css";

export default function IpoRwaPage() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [tab, setTab] = useState('ipo'); // ipo | rwa
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [list, setList] = useState([]);
  const [qtyMap, setQtyMap] = useState({});
  const [priceMap, setPriceMap] = useState({});
  const [orders, setOrders] = useState([]);
  const [ordersUnsupported, setOrdersUnsupported] = useState(false);
  const [submittingId, setSubmittingId] = useState(null);
  const [toast, setToast] = useState({ show: false, type: 'info', text: '' });
  const [ipoQtyMap, setIpoQtyMap] = useState({}); // 每个IPO/RWA的购买数量
  const [orderDetails, setOrderDetails] = useState({}); // code -> { name, listAt, canSellOnListingDay }
  const [orderPrices, setOrderPrices] = useState({}); // code -> current price
  const [hasNegativeFunds, setHasNegativeFunds] = useState(false);
  const [showHoldings, setShowHoldings] = useState(false);
  function fixSymbol(s) {
    const u = String(s || '').toUpperCase().trim();
    if (!u) return '';
    if (u === 'APPL') return 'AAPL';
    return u;
  }

  useEffect(() => {
    try {
      const qs = new URLSearchParams(typeof location !== 'undefined' ? (location.search || '') : '');
      const td = (qs.get('tdkey') || '').trim();
      if (td && !localStorage.getItem('td:key')) localStorage.setItem('td:key', td);
    } catch { }
  }, []);

  useEffect(() => {
    const fetchList = async () => {
      try {
        setLoading(true); setError('');
        const q = new URLSearchParams({ q: '', page: '1', pageSize: '50' }).toString();
        let data;
        try {
          data = await api.get(`/trade/ipo/list`, { timeoutMs: 15000 });
        } catch (e) {
          setError('');
          data = { items: [] };
        }
        const items = Array.isArray(data?.items) ? data.items : [];
        const filtered = items.filter(it => {
          const k = String(it.kind || '').toLowerCase();
          if (!k) return tab === 'ipo';
          return k === String(tab).toLowerCase();
        });
        setList(filtered);
        const codes = filtered
          .filter(it => String(it.kind || '').toLowerCase() !== 'rwa')
          .filter(it => !(Number.isFinite(Number(it.listPrice))))
          .map(it => fixSymbol(it.code));
        const map = {};
        if (codes.length) {
          try {
            const quotes = await getQuotes({ market: 'us', symbols: codes });
            for (const q of quotes) { if (q && q.symbol) map[fixSymbol(q.symbol)] = Number(q.price || 0); }
          } catch { }
          try {
            const missing = codes.filter(c => !(map[c] > 0));
            for (const s of missing) {
              try {
                const closes = await getStockSpark(s, 'us', { interval: '1day', points: 1 });
                const prevClose = Array.isArray(closes) && closes.length ? Number(closes[closes.length - 1] || 0) : 0;
                if (Number.isFinite(prevClose) && prevClose > 0) map[s] = prevClose;
              } catch { }
            }
          } catch { }
        }
        setPriceMap(prev => {
          const next = { ...prev };
          for (const k of Object.keys(map)) {
            const v = Number(map[k]);
            if (Number.isFinite(v) && v > 0) next[k] = v;
          }
          return next;
        });
      } catch (e) { setError(String(e?.message || e)); }
      finally { setLoading(false); }
    };
    fetchList();
  }, [tab]);

  // Periodic refresh IPO quotes with sticky update
  useEffect(() => {
    if (tab !== 'ipo') return;
    let stopped = false;
    const tick = async () => {
      try {
        const codes = (Array.isArray(list) ? list : [])
          .filter(it => String(it.kind || '').toLowerCase() === 'ipo')
          .map(it => fixSymbol(it.code));
        if (!codes.length) return;
        const map = {};
        try {
          const qs = await getQuotes({ market: 'us', symbols: codes });
          for (const q of qs) { if (q && q.symbol) map[fixSymbol(q.symbol)] = Number(q.price || 0); }
        } catch { }
        try {
          const missing = codes.filter(c => !(map[c] > 0));
          for (const s of missing) {
            try {
              const closes = await getStockSpark(s, 'us', { interval: '1day', points: 1 });
              const prevClose = Array.isArray(closes) && closes.length ? Number(closes[closes.length - 1] || 0) : 0;
              if (Number.isFinite(prevClose) && prevClose > 0) map[s] = prevClose;
            } catch { }
          }
        } catch { }
        if (!stopped) {
          setPriceMap(prev => {
            const next = { ...prev };
            for (const k of Object.keys(map)) {
              const v = Number(map[k]);
              if (Number.isFinite(v) && v > 0) next[k] = v;
            }
            return next;
          });
        }
      } catch { }
    };
    tick();
    const iv = setInterval(tick, 12000);
    return () => { stopped = true; clearInterval(iv); };
  }, [tab, list]);

  // Fetch RWA current prices via backend proxy when list changes
  useEffect(() => {
    let stopped = false;
    const run = async () => {
      if (tab !== 'rwa') return;
      try {
        const items = Array.isArray(list) ? list : [];
        const pairs = items
          .filter(it => String(it.kind || '').toLowerCase() === 'rwa')
          .map(it => {
            const pair = String(it.pairAddress || it.pair || it.pair_address || '').trim();
            const token = String(it.tokenAddress || it.token || it.token_address || '').trim();
            const chain = String(it.chain || 'base');
            return { code: String(it.code || '').toUpperCase(), pair, token, chain };
          })
          .filter(x => x.pair || x.token);
        const next = {};
        for (const { code, pair, token, chain } of pairs) {
          try {
            const qs = token ? `token=${encodeURIComponent(token)}&chain=${encodeURIComponent(chain)}` : `pair=${encodeURIComponent(pair)}&chain=${encodeURIComponent(chain)}`;
            const r = await api.get(`/trade/rwa/price?${qs}`, { timeoutMs: 9000 });
            const p = Number(r?.price || 0);
            if (Number.isFinite(p) && p > 0) next[code] = p;
          } catch { }
        }
        if (!stopped && Object.keys(next).length) {
          setPriceMap(prev => {
            const merged = { ...prev };
            for (const k of Object.keys(next)) {
              const v = Number(next[k]);
              if (Number.isFinite(v) && v > 0) merged[k] = v;
            }
            return merged;
          });
        }
      } catch { }
    };
    run();
    return () => { stopped = true; };
  }, [list, tab]);

  const submitSubscribe = async (code, price, it) => {
    try {
      const qty = Number(qtyMap[code] || 0);
      if (!Number.isFinite(qty) || qty <= 0) { alert(lang === 'zh' ? '请输入数量' : (lang === 'pl' ? 'Wprowadź ilość' : 'Enter quantity')); return; }
      const now = Date.now();
      const sAt = getPolandTimestamp(it?.subscribeAt);
      const eAt = getPolandTimestamp(it?.subscribeEndAt);
      if (sAt && eAt && (now < sAt || now > eAt)) { alert(lang === 'zh' ? '不在申购时间窗内' : (lang === 'pl' ? 'Poza oknem subskrypcji' : 'Out of subscription window')); return; }
      setSubmittingId(code);
      await api.post('/me/ipo/subscribe', { code, qty });
      setToast({ show: true, type: 'ok', text: lang === 'zh' ? '已提交' : (lang === 'pl' ? 'Wysłano' : 'Submitted') });
      setTimeout(() => setToast({ show: false, type: 'ok', text: '' }), 1000);
      setQtyMap(p => ({ ...p, [code]: '' }));
    } catch (e) {
      const msg = String(e?.message || e);
      setToast({ show: true, type: 'error', text: msg });
      setTimeout(() => setToast({ show: false, type: 'error', text: '' }), 1000);
    } finally { setSubmittingId(null); }
  };

  const submitIpoSubscribe = async (item, qty) => {
    const qv = Number(qty || 0);
    if (!Number.isFinite(qv) || qv <= 0) { 
      setToast({ show: true, type: 'error', text: lang === 'zh' ? '请输入数量' : (lang === 'pl' ? 'Wprowadź ilość' : 'Enter quantity') }); 
      setTimeout(() => setToast({ show: false, type: 'error', text: '' }), 2000); 
      return; 
    }
    try {
      setSubmittingId(item.code);
      await api.post('/me/ipo/subscribe', { code: item.code, qty: qv, currentPrice: Number(item.current || 0) });
      setToast({ show: true, type: 'ok', text: lang === 'zh' ? '已提交' : (lang === 'pl' ? 'Wysłano' : 'Submitted') });
      setTimeout(() => setToast({ show: false, type: 'ok', text: '' }), 2000);
      setIpoQtyMap(prev => ({ ...prev, [item.code]: 1 }));
      try { const od = await api.get('/me/ipo/orders'); const arr = Array.isArray(od?.items) ? od.items : []; const active = arr.filter(o => { const s = String(o.status || '').toLowerCase(); return !['done', 'sold', 'filled', 'completed'].includes(s); }); setOrders(active); } catch { }
    } catch (e) {
      const raw = String(e?.message || e);
      const ended = /ended|window\s*closed/i.test(raw);
      const txt = ended ? (lang === 'pl' ? 'Suscripción finalizada' : 'Subscribe ended') : raw;
      setToast({ show: true, type: 'error', text: txt });
      setTimeout(() => setToast({ show: false, type: 'error', text: '' }), 2000);
    } finally { setSubmittingId(null); }
  };

  useEffect(() => {
    let stopped = false;
    const loadOrders = async () => {
      try {
        const tok = getToken();
        if (!tok) { if (!stopped) setOrders([]); return; }
        const od = await api.get('/me/ipo/orders');
        const arr = Array.isArray(od?.items) ? od.items : [];
        // 过滤掉已完成的订单（done/sold/filled/completed）
        const active = arr.filter(o => {
          const status = String(o.status || '').toLowerCase();
          return !['done', 'sold', 'filled', 'completed'].includes(status);
        });
        if (!stopped) setOrders(active);
      } catch (e) {
        const msg = String(e?.message || e);
        if (/404|Not\s*Found/i.test(msg)) { setOrdersUnsupported(true); }
      }
    };
    loadOrders();
    const iv = setInterval(() => { if (!ordersUnsupported) loadOrders(); }, 5000);
    return () => { stopped = true; clearInterval(iv); };
  }, []);

  // Fetch details (name, listAt, canSellOnListingDay) for order codes
  useEffect(() => {
    let stopped = false;
    const codes = Array.from(new Set((orders || []).map(o => fixSymbol(o.code))));
    const fetchDetails = async () => {
      try {
        const map = {};
        // 优先按 lookup 获取单个详情
        for (const code of codes) {
          try {
            const res = await api.get(`/trade/ipo/lookup?code=${encodeURIComponent(code)}`);
            const d = res?.item || res; // API 返回 { item: {...} }
            map[code] = {
              name: String(d?.name || ''),
              listAt: d?.listAt || d?.list_at || null,
              canSellOnListingDay: Boolean(d?.canSellOnListingDay || d?.can_sell_on_listing_day),
              pairAddress: d?.pairAddress || d?.pair_address || null,
              tokenAddress: d?.tokenAddress || d?.token_address || null,
              chain: d?.chain || null
            };
          } catch { }
        }
        // 对缺失的条目，用公开列表进行兜底
        try {
          const lst = await api.get('/trade/ipo/list');
          const items = Array.isArray(lst?.items) ? lst.items : [];
          for (const it of items) {
            const c = String(it.code || '').toUpperCase();
            if (!c) continue;
            const existing = map[c] || {};
            map[c] = {
              name: existing.name || String(it.name || ''),
              listAt: existing.listAt || it.listAt || it.list_at || null,
              canSellOnListingDay: typeof existing.canSellOnListingDay === 'boolean' ? existing.canSellOnListingDay : Boolean(it.canSellOnListingDay || it.can_sell_on_listing_day),
              pairAddress: existing.pairAddress || it.pairAddress || it.pair_address || null,
              tokenAddress: existing.tokenAddress || it.tokenAddress || it.token_address || null,
              chain: existing.chain || it.chain || null
            };
          }
        } catch { }
        if (!stopped) setOrderDetails(map);
      } catch { }
    };
    fetchDetails();
    return () => { stopped = true; };
  }, [orders]);

  // Fetch current prices for order codes via TwelveData or RWA proxy
  useEffect(() => {
    let stopped = false;
    const codes = Array.from(new Set((orders || []).map(o => String(o.code || '').toUpperCase())));
    const fetchPrices = async () => {
      const map = {};
      const usCodes = [];
      const rwaItems = [];

      for (const c of codes) {
        const det = orderDetails[fixSymbol(c)];
        // If we have details and it looks like RWA (has pair/token or kind is rwa), treat as RWA
        // Note: orderDetails doesn't store 'kind' explicitly from lookup, but we can infer or add it.
        // Better: check the order 'kind' from the order list itself.
        const order = orders.find(o => String(o.code || '').toUpperCase() === c);
        const kind = String(order?.kind || '').toLowerCase();

        if (kind === 'rwa') {
          rwaItems.push({ code: c, ...det });
        } else {
          usCodes.push(c);
        }
      }

      // 1. Fetch US Stocks
      if (usCodes.length) {
        try {
          const qs = await getQuotes({ market: 'us', symbols: usCodes });
          for (const q of qs) { if (q && q.symbol) map[fixSymbol(q.symbol)] = Number(q.price || 0); }
        } catch { }
        try {
          const missing = usCodes.filter(c => !(map[c] > 0));
          for (const s of missing) {
            try {
              const closes = await getStockSpark(s, 'us', { interval: '1day', points: 1 });
              const prevClose = Array.isArray(closes) && closes.length ? Number(closes[closes.length - 1] || 0) : 0;
              if (Number.isFinite(prevClose) && prevClose > 0) map[s] = prevClose;
            } catch { }
          }
        } catch { }
      }

      // 2. Fetch RWA
      for (const item of rwaItems) {
        try {
          const pair = String(item.pairAddress || item.pair || '').trim();
          const token = String(item.tokenAddress || item.token || '').trim();
          const chain = String(item.chain || 'base');
          if (!pair && !token) continue;

          const qs = token ? `token=${encodeURIComponent(token)}&chain=${encodeURIComponent(chain)}` : `pair=${encodeURIComponent(pair)}&chain=${encodeURIComponent(chain)}`;
          const r = await api.get(`/trade/rwa/price?${qs}`, { timeoutMs: 9000 });
          const p = Number(r?.price || 0);
          if (Number.isFinite(p) && p > 0) map[item.code] = p;
        } catch { }
      }

      if (!stopped) setOrderPrices(prev => {
        const next = { ...prev };
        for (const k of Object.keys(map)) {
          const v = Number(map[k]);
          if (Number.isFinite(v) && v > 0) next[k] = v;
        }
        return next;
      });
    };
    if (Object.keys(orderDetails).length > 0) fetchPrices(); // Only fetch when details are ready
    return () => { stopped = true; };
  }, [orders, orderDetails]);

  // Check negative balances
  useEffect(() => {
    let stopped = false;
    const checkBalances = async () => {
      try {
        const tok = getToken();
        if (!tok) { setHasNegativeFunds(false); return; }
        const data = await api.get('/me/balances');
        const arr = Array.isArray(data?.balances) ? data.balances : [];
        // Use backend 'disabled' flag (PLN < 0) or fallback to finding PLN manually
        let isNeg = !!data?.disabled;
        if (data?.disabled === undefined) {
          const pln = arr.find(r => String(r.currency || '').toUpperCase() === 'PLN');
          isNeg = pln ? Number(pln.amount || 0) < 0 : false;
        }
        if (!stopped) setHasNegativeFunds(isNeg);
      } catch { setHasNegativeFunds(false); }
    };
    checkBalances();
    const iv = setInterval(checkBalances, 8000);
    return () => { stopped = true; clearInterval(iv); };
  }, []);

  function sameDayLocal(a, b) {
    try {
      const da = new Date(Number(a) || Date.parse(a));
      const db = new Date(Number(b) || Date.parse(b));
      return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
    } catch { return false; }
  }
  function formatYMD(v) {
    try {
      const d = new Date(Number(v) || Date.parse(v));
      if (isNaN(d.getTime())) return '-';
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}/${mm}/${dd}`;
    } catch { return '-'; }
  }
  function formatRwaPrice(v, lang) {
    const n = Number(v || 0);
    if (!Number.isFinite(n)) return formatMoney(0, 'USD', lang);
    if (Math.abs(n) < 1 && Math.abs(n) > 0) {
      // For small numbers, show 4 decimal places
      return `US$${n.toFixed(4)}`;
    }
    return formatMoney(n, 'USD', lang);
  }
  function canSellOrder(o) {
    const code = fixSymbol(o.code);
    const d = orderDetails[code] || {};
    const listAt = d.listAt ? new Date(d.listAt).getTime() : NaN;
    const now = Date.now();
    const listed = Number.isFinite(listAt) && now >= listAt;
    const listingDay = Number.isFinite(listAt) && sameDayLocal(now, listAt);
    const allowedToday = Boolean(d.canSellOnListingDay);
    return { listed, listingDay, allowedToday };
  }
  function orderCurrentPrice(o) {
    const code = fixSymbol(o.code);
    const status = String(o.status || '').toLowerCase();
    if (status === 'done' || status === 'sold' || status === 'filled' || status === 'completed') {
      // 尝试从多个字段获取卖出价格
      let fp = Number(o.finalPrice || o.sellPrice || o.filledPrice || o.closePrice || 0);
      // 解析 notes 字段 (格式: sold@256.44)
      if ((!Number.isFinite(fp) || fp <= 0) && o.notes) {
        const match = String(o.notes).match(/sold@([\d.]+)/);
        if (match) fp = Number(match[1]);
      }
      return Number.isFinite(fp) && fp > 0 ? fp : 0;
    }
    // First try external price from API
    const p = orderPrices[code];
    if (Number.isFinite(p) && p > 0) return p;
    // Fallback to listPrice from backend (for IPO not yet on exchange)
    const lp = Number(o.listPrice || 0);
    if (Number.isFinite(lp) && lp > 0) return lp;
    // Fallback to subscribe price
    const sp = Number(o.subscribePrice || o.price || 0);
    return Number.isFinite(sp) && sp > 0 ? sp : 0;
  }
  function orderProfit(o) {
    const cur = orderCurrentPrice(o);
    const price = Number(o.price || 0);
    const qty = Number(o.qty || 0);
    if (!Number.isFinite(cur) || !Number.isFinite(price) || !Number.isFinite(qty) || qty <= 0 || price <= 0) return { amount: 0, pct: 0 };
    const amount = Number(((cur - price) * qty).toFixed(4));
    const pct = Number((((cur - price) / price) * 100).toFixed(2));
    return { amount, pct };
  }
  function profitColorBy(o) {
    const { amount } = orderProfit(o);
    if (amount > 0) return '#5cff9b';
    if (amount < 0) return '#ff5c7a';
    return '#9aa3ad';
  }
  async function onSell(o) {
    if (hasNegativeFunds) { setToast({ show: true, type: 'error', text: lang === 'zh' ? '当前账户异常，无法卖出' : (lang === 'pl' ? 'Cuenta anormal, no se puede vender' : 'Account abnormal, cannot sell') }); setTimeout(() => setToast({ show: false, type: 'error', text: '' }), 1000); return; }
    const { listed, listingDay, allowedToday } = canSellOrder(o);
    if (!listed) { setToast({ show: true, type: 'error', text: lang === 'zh' ? '未上市，暂不可卖出' : (lang === 'pl' ? 'No listado, no se puede vender' : 'Not listed, cannot sell') }); setTimeout(() => setToast({ show: false, type: 'error', text: '' }), 1000); return; }
    if (listingDay && !allowedToday) { setToast({ show: true, type: 'error', text: lang === 'zh' ? '上市当日不可卖出' : (lang === 'pl' ? 'No vender en día de listado' : 'Cannot sell on listing day') }); setTimeout(() => setToast({ show: false, type: 'error', text: '' }), 1000); return; }
    // Snapshot latest price quickly (US)
    const symbol = fixSymbol(o.code);
    const tryTD = new Promise(async (resolve) => {
      try {
        const qs = await getQuotes({ market: 'us', symbols: [symbol] });
        const p = Number(qs?.[0]?.price || 0);
        resolve(Number.isFinite(p) && p > 0 ? p : NaN);
      } catch { resolve(NaN); }
    });
    const tryPrevClose = new Promise(async (resolve) => {
      try {
        const closes = await getStockSpark(symbol, 'us', { interval: '1day', points: 1 });
        const prevClose = Array.isArray(closes) && closes.length ? Number(closes[closes.length - 1] || 0) : 0;
        resolve(Number.isFinite(prevClose) && prevClose > 0 ? prevClose : NaN);
      } catch { resolve(NaN); }
    });
    const timeout = new Promise((resolve) => setTimeout(() => resolve(NaN), 1400));
    let cp = await Promise.race([tryTD, tryPrevClose, timeout]);
    if (!Number.isFinite(cp) || cp <= 0) cp = orderCurrentPrice(o);
    // 调用后端 API 卖出
    try {
      const res = await api.post(`/me/ipo/orders/${o.id}/sell`, { currentPrice: cp });
      if (res?.error) {
        setToast({ show: true, type: 'error', text: lang === 'zh' ? `卖出失败: ${res.error}` : `Sell failed: ${res.error}` });
        setTimeout(() => setToast({ show: false, type: 'error', text: '' }), 2000);
        return;
      }
      setToast({ show: true, type: 'ok', text: lang === 'zh' ? '卖出成功' : (lang === 'pl' ? 'Venta exitosa' : 'Sold') });
      setTimeout(() => setToast({ show: false, type: 'ok', text: '' }), 1000);
      // 卖出后从列表中移除该订单
      setOrders(prev => prev.filter(x => x.id !== o.id));
    } catch (e) {
      setToast({ show: true, type: 'error', text: lang === 'zh' ? `卖出失败: ${e?.message || e}` : `Sell failed: ${e?.message || e}` });
      setTimeout(() => setToast({ show: false, type: 'error', text: '' }), 2000);
    }
  }

  // 获取订单状态显示信息
  const getOrderStatusInfo = (o) => {
    const status = String(o.status || '').toLowerCase();
    if (status === 'done' || status === 'sold' || status === 'filled' || status === 'completed') {
      return { text: lang === 'zh' ? '已完成' : 'Completed', color: '#10b981', bg: 'rgba(16,185,129,0.15)' };
    }
    if (status === 'approved') {
      return { text: lang === 'zh' ? '已通过' : 'Approved', color: '#10b981', bg: 'rgba(16,185,129,0.15)' };
    }
    if (status === 'rejected') {
      return { text: lang === 'zh' ? '已拒绝' : 'Rejected', color: '#ef4444', bg: 'rgba(239,68,68,0.15)' };
    }
    return { text: lang === 'zh' ? '待审核' : 'Pending', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' };
  };

  return (
    <div className="screen top-align inst-screen" style={{ padding: 0 }}>
      {toast?.show && (
        <div style={{ position: 'fixed', top: 10, left: 0, right: 0, display: 'grid', placeItems: 'center', zIndex: 1000 }}>
          <div style={{ padding: '8px 12px', borderRadius: 10, background: toast.type === 'error' ? '#7a2a2a' : '#274a36', color: '#fff', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast.text}</div>
        </div>
      )}
      
      {/* 我的持仓弹窗 */}
      {showHoldings && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99999,
          background: 'rgba(0,0,0,0.95)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16
        }} onClick={() => setShowHoldings(false)}>
          <div style={{
            background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
            borderRadius: 16, width: '100%', maxWidth: 480, maxHeight: '80vh',
            overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)'
          }} onClick={e => e.stopPropagation()}>
            {/* 弹窗标题 */}
            <div style={{
              padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center'
            }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#f1f5f9' }}>
                📊 {lang === 'zh' ? '我的IPO/RWA持仓' : (lang === 'pl' ? 'Moje IPO/RWA' : 'My IPO/RWA Holdings')}
              </h3>
              <button
                onClick={() => setShowHoldings(false)}
                style={{
                  background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 8,
                  padding: '6px 12px', cursor: 'pointer', color: '#94a3b8', fontSize: 13
                }}
              >{lang === 'zh' ? '关闭' : 'Close'}</button>
            </div>
            
            {/* 持仓列表 */}
            <div style={{ padding: 16, overflowY: 'auto', maxHeight: 'calc(80vh - 70px)' }}>
              {orders.length === 0 && (
                <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>
                  {lang === 'zh' ? '暂无持仓记录' : 'No holdings'}
                </div>
              )}
              {orders.length > 0 && (
                <div style={{ display: 'grid', gap: 12 }}>
                  {orders.map(o => {
                    const code = String(o.code || '').toUpperCase();
                    const det = orderDetails[code] || {};
                    const cur = orderCurrentPrice(o);
                    const price = Number(o.price || 0);
                    const qty = Number(o.qty || 0);
                    const { amount, pct } = orderProfit(o);
                    const statusInfo = getOrderStatusInfo(o);
                    const kind = String(o.kind || '').toLowerCase();
                    const status = String(o.status || '').toLowerCase();
                    const isDone = ['done', 'sold', 'filled', 'completed'].includes(status);
                    const isRejected = status === 'rejected';
                    const { listed, listingDay, allowedToday } = canSellOrder(o);
                    const canSell = listed && !(listingDay && !allowedToday) && !isDone && !isRejected && !hasNegativeFunds;
                    
                    return (
                      <div key={o.id} style={{
                        background: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 14,
                        border: '1px solid rgba(255,255,255,0.06)'
                      }}>
                        {/* 头部：代码 + 状态 */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 16, fontWeight: 600, color: '#f1f5f9' }}>{det.name || code}</span>
                            <span style={{
                              fontSize: 11, padding: '2px 8px', borderRadius: 10,
                              background: kind === 'rwa' ? '#3b2a56' : '#2a5640', color: '#e5e7eb'
                            }}>{kind === 'rwa' ? 'RWA' : 'IPO'}</span>
                          </div>
                          <span style={{
                            fontSize: 12, padding: '3px 10px', borderRadius: 10,
                            background: statusInfo.bg, color: statusInfo.color
                          }}>{statusInfo.text}</span>
                        </div>
                        
                        {/* 详细信息 */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
                          <div style={{ color: '#94a3b8' }}>
                            {lang === 'zh' ? '数量' : 'Qty'}: <span style={{ color: '#e5e7eb' }}>{qty}</span>
                          </div>
                          <div style={{ color: '#94a3b8' }}>
                            {lang === 'zh' ? '申购价' : 'Sub Price'}: <span style={{ color: '#e5e7eb' }}>
                              {formatRwaPrice(price, lang)}
                            </span>
                          </div>
                          {!isDone && (
                            <div style={{ color: '#94a3b8' }}>
                              {lang === 'zh' ? '现价' : 'Current'}: <span style={{ color: '#e5e7eb' }}>
                                {formatRwaPrice(cur, lang)}
                              </span>
                            </div>
                          )}
                          <div style={{ color: '#94a3b8' }}>
                            {lang === 'zh' ? '收益' : 'Profit'}: <span style={{ color: amount >= 0 ? '#10b981' : '#ef4444' }}>
                              {amount >= 0 ? '+' : ''}{formatRwaPrice(amount, lang).replace('US$', '$')} ({pct >= 0 ? '+' : ''}{pct}%)
                            </span>
                          </div>
                        </div>
                        
                        {/* 上市日期 */}
                        {det.listAt && (
                          <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
                            {lang === 'zh' ? '上市日期' : 'Listing'}: {formatYMD(det.listAt)}
                          </div>
                        )}
                        
                        {/* 操作按钮 */}
                        {canSell && (
                          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                            <button 
                              className="btn primary" 
                              style={{ width: '100%', padding: '8px 0', fontSize: 13, borderRadius: 8 }}
                              onClick={() => { onSell(o); setShowHoldings(false); }}
                            >
                              {lang === 'zh' ? '卖出' : 'Sell'}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* 返回按钮 + 标签切换 + 我的持仓 */}
      <div className="inst-back-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => navigate(-1)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 20, padding: '8px 14px', cursor: 'pointer', color: '#e5e7eb', fontSize: 13
            }}
          >
            <span style={{ fontSize: 16 }}>←</span>
            <span>{lang === 'zh' ? '返回' : (lang === 'pl' ? 'Wstecz' : 'Back')}</span>
          </button>
          <button className={`pill ${tab === 'ipo' ? 'active' : ''}`} onClick={() => setTab('ipo')}>IPO</button>
          <button className={`pill ${tab === 'rwa' ? 'active' : ''}`} onClick={() => setTab('rwa')}>RWA</button>
        </div>
        <button
          onClick={() => setShowHoldings(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'linear-gradient(135deg, #3b82f6, #2563eb)', border: 'none',
            borderRadius: 20, padding: '8px 16px', cursor: 'pointer', color: '#fff', fontSize: 13, fontWeight: 500,
            boxShadow: '0 2px 8px rgba(59, 130, 246, 0.3)'
          }}
        >
          <span style={{ fontSize: 14 }}>📊</span>
          <span>{lang === 'zh' ? '我的持仓' : (lang === 'pl' ? 'Moje pozycje' : 'My Holdings')}</span>
        </button>
      </div>
      <div className="inst-container">
        <div style={{ width: '100%' }}>
        <h1 className="title" style={{ marginTop: 0 }}>{tab === 'ipo' ? 'IPO' : 'RWA'}</h1>
        {loading && <div className="desc">Loading...</div>}
        {!loading && list.length === 0 && <div className="desc">--</div>}
        {!loading && list.length > 0 && (
          <div style={{ display: 'grid', gap: 12 }}>
            {list.filter(it => {
              const eAt = getPolandTimestamp(it?.subscribeEndAt);
              const nowTs = Date.now();
              return !(eAt && nowTs > eAt); // 过滤掉已截止的
            }).map(it => {
              const code = fixSymbol(it.code);
              const ncode = code;
              const current = (() => { const p = priceMap[ncode]; const sp = Number(it.subscribePrice || 0); return Number.isFinite(p) && p > 0 ? p : (Number.isFinite(sp) ? sp : 0); })();
              const displayCurrent = current;
              const subPrice = Number(it.subscribePrice || 0);
              const unitProfit = Number((current - subPrice).toFixed(6));
              const unitPct = Number(subPrice > 0 ? (((current - subPrice) / subPrice) * 100).toFixed(2) : 0);
              // 检查申购时间窗口
              const nowTs = Date.now();
              const sAt = getPolandTimestamp(it?.subscribeAt);
              const eAt = getPolandTimestamp(it?.subscribeEndAt);
              const notStarted = sAt && nowTs < sAt;
              const expired = eAt && nowTs > eAt;
              const canSubscribe = !notStarted && !expired;
              return (
                <div key={it.id || code} className="inst-card" style={{ padding: '12px', marginBottom: 8 }}>
                  <div style={{ padding: 0 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ display: 'grid', gap: 6 }}>
                        <div style={{ fontWeight: 700 }}>{it.name} · {code}</div>
                        <div className="desc">{lang === 'zh' ? '当前价格' : (lang === 'pl' ? 'Precio actual' : 'Current Price')}: {formatRwaPrice((displayCurrent > 0 ? displayCurrent : Number(it.subscribePrice || 0)) || 0, lang)}</div>
                        <div className="desc">{lang === 'zh' ? '申购价格' : (lang === 'pl' ? 'Precio institucional' : 'Institutional Price')}: {formatRwaPrice(subPrice, lang)}</div>
                        <div className="desc">{lang === 'zh' ? '上市日期' : (lang === 'pl' ? 'Fecha de listado' : 'Listing Date')}: {it.listAt ? formatYMD(it.listAt) : '-'}</div>
                        <div className="desc" style={{ color: expired ? '#ef4444' : undefined }}>{lang === 'zh' ? '申购截止' : (lang === 'pl' ? 'Fin de suscripción' : 'Subscribe End')}: {it.subscribeEndAt ? formatMinute(it.subscribeEndAt) : '-'}{expired ? (lang === 'zh' ? ' (已截止)' : ' (Ended)') : ''}</div>
                      </div>
                      <div style={{ display: 'grid', justifyItems: 'end', gap: 6 }}>
                        <div style={{ fontSize: 18, fontWeight: 700, color: unitProfit > 0 ? '#5cff9b' : (unitProfit < 0 ? '#ff5c7a' : '#9aa3ad') }}>{unitPct}%</div>
                        <div style={{ fontSize: 14, color: unitProfit > 0 ? '#5cff9b' : (unitProfit < 0 ? '#ff5c7a' : '#9aa3ad') }}>{unitProfit.toFixed(4)}</div>
                      </div>
                    </div>
                    {/* 数量和订阅 */}
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{lang==='zh'?'数量':'Qty'}</div>
                        <input 
                          type="number" 
                          min="1" 
                          value={ipoQtyMap[code] || 1}
                          onChange={e => setIpoQtyMap(prev => ({ ...prev, [code]: Math.max(1, parseInt(e.target.value) || 1) }))}
                          disabled={!canSubscribe}
                          style={{ 
                            width: '100%', padding: '8px 10px', borderRadius: 8, 
                            background: canSubscribe ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)', 
                            border: '1px solid rgba(255,255,255,0.1)',
                            color: canSubscribe ? '#fff' : '#666', fontSize: 14, textAlign: 'center',
                            opacity: canSubscribe ? 1 : 0.5
                          }}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{lang==='zh'?'总价':'Total'}</div>
                        {(() => {
                          const total = subPrice * (ipoQtyMap[code] || 1);
                          const fee = Number((total * 0.001).toFixed(6));
                          const totalWithFee = total + fee;
                          return (
                            <>
                              <div style={{ padding: '8px 10px', borderRadius: 8, background: canSubscribe ? 'rgba(59,130,246,0.2)' : 'rgba(59,130,246,0.1)', textAlign: 'center', fontSize: 14, fontWeight: 600, color: canSubscribe ? '#3b82f6' : '#666', opacity: canSubscribe ? 1 : 0.5 }}>
                                {formatRwaPrice(totalWithFee, lang)}
                              </div>
                              {fee > 0 && <div style={{ fontSize: 10, color: '#f59e0b', textAlign: 'center', marginTop: 2 }}>{lang==='zh'?'含手续费':'Fee'}: {formatRwaPrice(fee, lang)}</div>}
                            </>
                          );
                        })()}
                      </div>
                      <button 
                        className="btn primary" 
                        disabled={!canSubscribe || submittingId === code}
                        onClick={() => submitIpoSubscribe({ ...it, code, current, subPrice }, ipoQtyMap[code] || 1)}
                        style={{ 
                          padding: '8px 16px', height: 'auto', alignSelf: 'flex-end',
                          opacity: canSubscribe ? 1 : 0.4,
                          cursor: canSubscribe ? 'pointer' : 'not-allowed',
                          background: canSubscribe ? undefined : '#555'
                        }}
                      >
                        {submittingId === code ? '...' : (expired ? (lang === 'zh' ? '已截止' : 'Ended') : (notStarted ? (lang === 'zh' ? '未开始' : 'Not Started') : (lang === 'zh' ? '申购' : (lang === 'pl' ? 'Subskrybuj' : 'Subscribe'))))}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      </div>
      <BottomNav />
    </div>
  );
}
