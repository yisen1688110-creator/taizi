import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../../i18n.jsx";
import { api, getToken } from "../../services/api.js";
import { getQuotes, getStockSpark } from "../../services/marketData.js";
import { formatMoney } from "../../utils/money.js";
import { formatMinute, getMexicoTimestamp } from "../../utils/date.js";
// ...

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
  const [modalOpen, setModalOpen] = useState(false);
  const [modalItem, setModalItem] = useState(null);
  const [modalQty, setModalQty] = useState('');
  const [toast, setToast] = useState({ show: false, type: 'info', text: '' });
  const [orderDetails, setOrderDetails] = useState({}); // code -> { name, listAt, canSellOnListingDay }
  const [orderPrices, setOrderPrices] = useState({}); // code -> current price
  const [hasNegativeFunds, setHasNegativeFunds] = useState(false);
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
      if (!Number.isFinite(qty) || qty <= 0) { alert(lang === 'es' ? 'Ingrese cantidad' : 'Enter quantity'); return; }
      const now = Date.now();
      const sAt = getMexicoTimestamp(it?.subscribeAt);
      const eAt = getMexicoTimestamp(it?.subscribeEndAt);
      if (sAt && eAt && (now < sAt || now > eAt)) { alert(lang === 'es' ? 'Fuera de ventana de suscripción' : 'Out of subscription window'); return; }
      setSubmittingId(code);
      await api.post('/me/ipo/subscribe', { code, qty });
      setToast({ show: true, type: 'ok', text: lang === 'es' ? 'Solicitud enviada' : 'Submitted' });
      setTimeout(() => setToast({ show: false, type: 'ok', text: '' }), 1000);
      setQtyMap(p => ({ ...p, [code]: '' }));
    } catch (e) {
      const msg = String(e?.message || e);
      setToast({ show: true, type: 'error', text: msg });
      setTimeout(() => setToast({ show: false, type: 'error', text: '' }), 1000);
    } finally { setSubmittingId(null); }
  };

  const openModal = (it) => { setModalItem(it); setModalQty(''); setModalOpen(true); };
  const closeModal = () => { setModalOpen(false); setModalItem(null); setModalQty(''); };
  const submitModal = async () => {
    if (!modalItem) return;
    const qv = Number(modalQty || 0);
    if (!Number.isFinite(qv) || qv <= 0) { setToast({ show: true, type: 'error', text: lang === 'es' ? 'Ingrese cantidad' : 'Enter quantity' }); setTimeout(() => setToast({ show: false, type: 'error', text: '' }), 1000); return; }
    try {
      setSubmittingId(modalItem.code);
      await api.post('/me/ipo/subscribe', { code: modalItem.code, qty: qv, currentPrice: Number(modalItem.current || 0) });
      setToast({ show: true, type: 'ok', text: lang === 'es' ? 'Solicitud enviada' : 'Submitted' });
      setTimeout(() => setToast({ show: false, type: 'ok', text: '' }), 1000);
      closeModal();
      try { const od = await api.get('/me/ipo/orders'); const arr = Array.isArray(od?.items) ? od.items : []; setOrders(arr); } catch { }
    } catch (e) {
      const raw = String(e?.message || e);
      const ended = /ended|window\s*closed/i.test(raw);
      const txt = ended ? (lang === 'es' ? 'Suscripción finalizada' : 'Subscribe ended') : raw;
      setToast({ show: true, type: 'error', text: txt });
      setTimeout(() => setToast({ show: false, type: 'error', text: '' }), 1000);
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
        if (!stopped) setOrders(arr);
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
            const d = await api.get(`/trade/ipo/lookup?code=${encodeURIComponent(code)}`);
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
        // Use backend 'disabled' flag (MXN < 0) or fallback to finding MXN manually
        let isNeg = !!data?.disabled;
        if (data?.disabled === undefined) {
          const mxn = arr.find(r => String(r.currency || '').toUpperCase() === 'MXN');
          isNeg = mxn ? Number(mxn.amount || 0) < 0 : false;
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
    if (String(o.status || '').toLowerCase() === 'done' || String(o.status || '').toLowerCase() === 'sold' || String(o.status || '').toLowerCase() === 'filled' || String(o.status || '').toLowerCase() === 'completed') {
      const fp = Number(o.finalPrice || o.sellPrice || o.filledPrice || o.closePrice || 0);
      return Number.isFinite(fp) && fp > 0 ? fp : 0;
    }
    const p = orderPrices[code];
    return Number.isFinite(p) && p > 0 ? p : 0;
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
    if (hasNegativeFunds) { setToast({ show: true, type: 'error', text: lang === 'zh' ? '当前账户异常，无法卖出' : (lang === 'es' ? 'Cuenta anormal, no se puede vender' : 'Account abnormal, cannot sell') }); setTimeout(() => setToast({ show: false, type: 'error', text: '' }), 1000); return; }
    const { listed, listingDay, allowedToday } = canSellOrder(o);
    if (!listed) { setToast({ show: true, type: 'error', text: lang === 'zh' ? '未上市，暂不可卖出' : (lang === 'es' ? 'No listado, no se puede vender' : 'Not listed, cannot sell') }); setTimeout(() => setToast({ show: false, type: 'error', text: '' }), 1000); return; }
    if (listingDay && !allowedToday) { setToast({ show: true, type: 'error', text: lang === 'zh' ? '上市当日不可卖出' : (lang === 'es' ? 'No vender en día de listado' : 'Cannot sell on listing day') }); setTimeout(() => setToast({ show: false, type: 'error', text: '' }), 1000); return; }
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
    setToast({ show: true, type: 'ok', text: lang === 'zh' ? '卖出成功' : (lang === 'es' ? 'Venta exitosa' : 'Sold') }); setTimeout(() => setToast({ show: false, type: 'ok', text: '' }), 1000);
    // Freeze locally
    setOrders(prev => prev.map(x => x.id === o.id ? { ...x, status: 'done', finalPrice: Number(cp || 0) } : x));
  }

  return (
    <div className="screen" style={{ padding: '0 6px', paddingBottom: 100, alignItems: 'stretch', justifyContent: 'flex-start', width: '100%', boxSizing: 'border-box' }}>
      {toast?.show && (
        <div style={{ position: 'fixed', top: 10, left: 0, right: 0, display: 'grid', placeItems: 'center', zIndex: 1000 }}>
          <div style={{ padding: '8px 12px', borderRadius: 10, background: toast.type === 'error' ? '#7a2a2a' : '#274a36', color: '#fff', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast.text}</div>
        </div>
      )}
      <div style={{ paddingTop: 16, width: '100%', boxSizing: 'border-box', padding: '16px 6px 10px 6px' }}>
        <div style={{ width: '100%', marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="back-btn" onClick={() => navigate(-1)} aria-label="back" style={{ position: 'relative', top: 'auto', left: 'auto', marginRight: 8 }}><span className="back-icon"></span></button>
            <button className={`pill ${tab === 'ipo' ? 'active' : ''}`} onClick={() => setTab('ipo')}>IPO</button>
            <button className={`pill ${tab === 'rwa' ? 'active' : ''}`} onClick={() => setTab('rwa')}>RWA</button>
          </div>
        </div>
        <div style={{ width: '100%' }}>
        <h1 className="title" style={{ marginTop: 0 }}>{tab === 'ipo' ? 'IPO' : 'RWA'}</h1>
        {loading && <div className="desc">Loading...</div>}
        {!loading && list.length === 0 && <div className="desc">--</div>}
        {!loading && list.length > 0 && (
          <div style={{ display: 'grid', gap: 12 }}>
            {list.map(it => {
              const code = fixSymbol(it.code);
              const ncode = code;
              const current = (() => { const p = priceMap[ncode]; const sp = Number(it.subscribePrice || 0); return Number.isFinite(p) && p > 0 ? p : (Number.isFinite(sp) ? sp : 0); })();
              const displayCurrent = current;
              const subPrice = Number(it.subscribePrice || 0);
              const unitProfit = Number((current - subPrice).toFixed(6));
              const unitPct = Number(subPrice > 0 ? (((current - subPrice) / subPrice) * 100).toFixed(2) : 0);
              return (
                <div key={it.id || code} className="inst-card" style={{ padding: '12px', marginBottom: 8 }}>
                  <div style={{ padding: 0 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ display: 'grid', gap: 6 }}>
                        <div style={{ fontWeight: 700 }}>{it.name} · {code}</div>
                        <div className="desc">{lang === 'zh' ? '当前价格' : (lang === 'es' ? 'Precio actual' : 'Current Price')}: {formatRwaPrice((displayCurrent > 0 ? displayCurrent : Number(it.subscribePrice || 0)) || 0, lang)}</div>
                        <div className="desc">{lang === 'zh' ? '申购价格' : (lang === 'es' ? 'Precio institucional' : 'Institutional Price')}: {formatRwaPrice(subPrice, lang)}</div>
                        <div className="desc">{lang === 'zh' ? '上市日期' : (lang === 'es' ? 'Fecha de listado' : 'Listing Date')}: {it.listAt ? formatYMD(it.listAt) : '-'}</div>
                        <div className="desc">{lang === 'zh' ? '申购截止' : (lang === 'es' ? 'Fin de suscripción' : 'Subscribe End')}: {it.subscribeEndAt ? formatMinute(it.subscribeEndAt) : '-'}</div>
                      </div>
                      <div style={{ display: 'grid', justifyItems: 'end', gap: 6 }}>
                        <div style={{ fontSize: 18, fontWeight: 700, color: unitProfit > 0 ? '#5cff9b' : (unitProfit < 0 ? '#ff5c7a' : '#9aa3ad') }}>{unitPct}%</div>
                        <div style={{ fontSize: 14, color: unitProfit > 0 ? '#5cff9b' : (unitProfit < 0 ? '#ff5c7a' : '#9aa3ad') }}>{unitProfit.toFixed(4)}</div>
                        <button className="btn primary" onClick={() => openModal({ ...it, code, current, subPrice })}>{lang === 'es' ? 'Suscribir' : 'Subscribe'}</button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {modalOpen && modalItem && (
        <div className="modal">
          <div className="modal-card">
            <h2 className="title" style={{ marginTop: 0 }}>{lang === 'es' ? 'Solicitud de suscripción' : 'Subscribe Request'}</h2>
            <div className="form" style={{ display: 'grid', gap: 8 }}>
              <div className="desc">{lang === 'es' ? 'Mercado' : 'Market'}: US Stocks</div>
              <div className="desc">{lang === 'es' ? 'Código' : 'Code'}: {modalItem.code}</div>
              <div className="desc">{lang === 'es' ? 'Precio actual' : 'Current Price'}: {modalItem.current ? formatRwaPrice(modalItem.current, lang) : '-'}</div>
              <div className="desc">{lang === 'es' ? 'Precio institucional' : 'Institutional Price'}: {formatRwaPrice(modalItem.subPrice, lang)}</div>
              <input className="input" type="number" min="1" placeholder={lang === 'es' ? 'Cantidad' : 'Quantity'} value={modalQty} onChange={e => setModalQty(e.target.value)} />
              <div className="sub-actions" style={{ justifyContent: 'flex-end', gap: 10 }}>
                <button className="btn" onClick={closeModal}>{lang === 'es' ? 'Cancelar' : 'Cancel'}</button>
                <button className="btn primary" disabled={submittingId === modalItem.code} onClick={submitModal}>{lang === 'es' ? 'Enviar' : 'Submit'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

        <div style={{ marginTop: 16, width: '100%' }}>
          <h2 className="title" style={{ marginTop: 0 }}>{lang === 'es' ? 'Órdenes IPO' : 'IPO Orders'}</h2>
        {ordersUnsupported && (<div className="desc" style={{ marginTop: 6 }}>{lang === 'es' ? 'Órdenes no disponibles' : 'Orders API unavailable'}</div>)}
        <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
          {(orders || []).map(o => {
            const code = String(o.code || '').toUpperCase();
            const det = orderDetails[code] || {};
            const cur = orderCurrentPrice(o);
            const price = Number(o.price || 0);
            const qty = Number(o.qty || 0);
            const { amount, pct } = orderProfit(o);
            const color = profitColorBy(o);
            return (
              <div key={o.id} className="inst-card" style={{ padding: '12px' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ display: 'grid', gap: 6 }}>
                    <div style={{ fontWeight: 700 }}>{String(o.kind || '').toLowerCase() === 'rwa' ? 'RWA' : (String(o.kind || '').toLowerCase() === 'ipo' ? 'IPO' : 'Global Stocks')} · {det.name || code}</div>
                    <div className="desc">{lang === 'es' ? 'Fecha de listado' : 'Listing Date'}: {det.listAt ? formatYMD(det.listAt) : '-'}</div>
                    {!(String(o.status || '').toLowerCase() === 'done' || String(o.status || '').toLowerCase() === 'sold' || String(o.status || '').toLowerCase() === 'filled' || String(o.status || '').toLowerCase() === 'completed') && (
                      <div className="desc">{lang === 'es' ? 'Precio actual' : 'Current Price'}: {formatRwaPrice(Number(cur || 0), lang)}</div>
                    )}
                    <div className="desc">{lang === 'es' ? 'Precio de subscripción' : 'Subscribe Price'}: {formatRwaPrice(price, lang)}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color }}>{pct}%</div>
                    <div style={{ fontSize: 13, color }}>{formatRwaPrice(amount, lang).replace('US$', '$')}</div>
                    {!(String(o.status || '').toLowerCase() === 'done' || String(o.status || '').toLowerCase() === 'sold' || String(o.status || '').toLowerCase() === 'filled' || String(o.status || '').toLowerCase() === 'completed') ? (
                      <button className="btn primary" style={{ fontSize: 12, padding: '6px 12px', height: 'auto' }} onClick={() => onSell(o)}>{lang === 'es' ? 'Vender' : 'Sell'}</button>
                    ) : (
                      <span className="tag" style={{ background: '#16a34a', color: '#fff', padding: '4px 8px', borderRadius: 6, fontSize: 11 }}>{lang === 'es' ? 'Completado' : 'Completed'}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {(orders || []).length === 0 && (<div className="desc">--</div>)}
        </div>
        </div>
      </div>
    </div>
  );
}
