import { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import BottomNav from "../../components/BottomNav.jsx";
import { useI18n } from "../../i18n.jsx";
import { api } from "../../services/api.js";
import { formatMoney, formatPLN, formatUSDT } from "../../utils/money.js";
import { formatMinute } from "../../utils/date.js";

import { getQuotes, getCryptoQuotes, getStockSpark, getUsdPlnRate } from "../../services/marketData.js";
import "../../styles/profile.css";

// 机构账户页（按原型布局实现，保留占位与接口钩子）
export default function Institution() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  // 会话（用于解析后端用户ID）
  const [session, setSession] = useState(() => {
    try { return JSON.parse(localStorage.getItem("sessionUser") || "null"); } catch { return null; }
  });

  // 顶部头像与资金（MX / USD / USDT）
  const [avatarUrl, setAvatarUrl] = useState("/logo.jpg");
  const [funds, setFunds] = useState({ pln: 0, usd: 0, usdt: 0 });
  const [tradeDisabled, setTradeDisabled] = useState(false);
  const [creditScore, setCreditScore] = useState(100);
  const [creditModal, setCreditModal] = useState(false);
  const [creditSubmitting, setCreditSubmitting] = useState(false);
  const [creditForm, setCreditForm] = useState({ name: '', phone: '', address: '', zip: '', city: '', state: '', amount: '', periodValue: '', periodUnit: 'month', images: [] });
  const [creditHistoryOpen, setCreditHistoryOpen] = useState(false);
  const [creditHistory, setCreditHistory] = useState([]);
  const fileInputRef = useRef(null);

  // 机构简介占位：头像+名称+文案（对接后台）
  const [org, setOrg] = useState({ avatar: "/logo.jpg", name: t("instOrgNameDefault"), desc: t("instOrgDescDefault") });
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("current"); // current | done
  const [orders, setOrders] = useState([]); // 用户认购的大宗订单（后端）
  const [selectedCurrency, setSelectedCurrency] = useState('PLN'); // 当前选择的币种
  const [currencyDropdownOpen, setCurrencyDropdownOpen] = useState(false); // 币种下拉菜单状态
  const [quotes, setQuotes] = useState({}); // 实时行情 { key: { price, changePct } }
  const [toast, setToast] = useState({ show: false, type: 'info', text: '' });
  const [isMobile, setIsMobile] = useState(() => {
    try { return typeof window !== 'undefined' ? (window.innerWidth <= 767) : false; } catch { return false; }
  });
  useEffect(() => {
    const onResize = () => { try { setIsMobile(window.innerWidth <= 767); } catch { } };
    try { window.addEventListener('resize', onResize); } catch { }
    return () => { try { window.removeEventListener('resize', onResize); } catch { } };
  }, []);
  const [usdToPlnRate, setUsdToPlnRate] = useState(18.0);

  // labels（国际化）
  const labels = useMemo(() => ({
    title: t("instTitle"),
    intro: t("instIntro"),
    btnFunds: t("instFunds"),
    btnBlocks: t("instBlocks"),
    btnIpoRwa: t("instIpoRwa"),
    tabCurrent: t("instPositionsCurrent"),
    tabDone: t("instPositionsDone"),
    emptyTip: t("instPositionsEmpty"),
  }), [t]);

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

  // 加载账户资金：与个人中心逻辑保持一致，从后端 /admin/users/:id/balances 获取
  useEffect(() => {
    let stopped = false;
    async function fetchBalances() {
      try {
        setLoading(true);
        // 解析后端用户ID（与 Home/Profile/Swap 保持一致）
        let uid = Number(session?.id ?? session?.backendId);
        if (!uid && session?.phone) {
          try {
            const res = await api.get(`/admin/users?q=${encodeURIComponent(session.phone)}`);
            const arr = Array.isArray(res?.users) ? res.users : [];
            const match = arr.find(u => String(u.phone) === String(session.phone));
            if (match && Number(match.id)) {
              uid = Number(match.id);
              // 回写本地镜像与会话，后续请求稳定使用数值ID
              try {
                const users = JSON.parse(localStorage.getItem('users') || '[]');
                const nextUsers = users.map(u => (u.phone === session.phone ? { ...u, id: uid, backendId: uid } : u));
                localStorage.setItem('users', JSON.stringify(nextUsers));
              } catch { }
              try { localStorage.setItem('sessionUser', JSON.stringify({ ...session, id: uid })); setSession({ ...session, id: uid }); } catch { }
            }
          } catch { }
        }
        if (!uid) { if (!stopped) setLoading(false); return; }
        let data;
        try {
          const meData = await api.get('/me');
          if (typeof meData === 'object' && meData?.user) {
            setTradeDisabled(!!meData.user.trade_disabled);
          }
        } catch { }
        data = await api.get(`/me/balances`);
        setTradeDisabled(!!data?.disabled);
        const arr = Array.isArray(data?.balances) ? data.balances : [];
        const map = arr.reduce((m, r) => { m[String(r.currency).toUpperCase()] = Number(r.amount || 0); return m; }, {});
        if (stopped) return;
        setFunds({
          pln: Number.isFinite(map.PLN) ? map.PLN : 0,
          usd: Number.isFinite(map.USD) ? map.USD : 0,
          usdt: Number.isFinite(map.USDT) ? map.USDT : 0,
        });
        // 前端兜底：到期自动扣款与机构资格限制
        try {
          const debts = JSON.parse(localStorage.getItem('credit:debts') || '[]');
          const uidKey = Number(session?.id) || String(session?.phone || '');
          const now = Date.now();
          let nextPln = Number.isFinite(map.PLN) ? map.PLN : 0;
          let changed = false;
          const nextDebts = debts.map(d => {
            if ((d.uid === uidKey || String(d.uid) === String(uidKey)) && d.status === 'active' && Number(d.dueAt || 0) <= now) {
              nextPln = Number(nextPln) - Number(d.amount || 0);
              changed = true;
              return { ...d, status: 'settled', settledAt: now };
            }
            return d;
          });
          if (changed) {
            setFunds(prev => ({ ...prev, pln: nextPln }));
            localStorage.setItem('credit:debts', JSON.stringify(nextDebts));
            if (nextPln < 0) {
              setTradeDisabled(true);
              try { localStorage.setItem(`inst:blocked:${uidKey}`, '1'); } catch { }
              setToast({ show: true, type: 'warn', text: lang === 'zh' ? '你已丧失机构账户资格，如有疑问，请联系客服' : (lang === 'pl' ? 'Straciłeś kwalifikację instytucjonalną, skontaktuj się z pomocą' : 'You have lost institution qualification, please contact support') });
              setTimeout(() => setToast({ show: false, type: 'warn', text: '' }), 4000);
            }
          }
        } catch { }
      } catch (_) {
        // 后端不可用时维持 0 值占位
      } finally { if (!stopped) setLoading(false); }

      try {
        const { rate } = await getUsdPlnRate();
        if (rate > 0 && !stopped) setUsdToPlnRate(rate);
      } catch { }
    }
    fetchBalances();
    return () => { stopped = true; };
  }, [session]);

  // 信用积分读取（默认100）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get('/me/credit/score');
        const s = Number(r?.score || r?.value || 100);
        if (!cancelled) setCreditScore(Number.isFinite(s) ? s : 100);
        try { localStorage.setItem('credit:score', String(s)); } catch { }
      } catch {
        try { const v = Number(localStorage.getItem('credit:score') || 100); setCreditScore(Number.isFinite(v) ? v : 100); } catch { setCreditScore(100); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 加载机构简介（后台运营可编辑），后端接口建议：GET /institution/profile
  useEffect(() => {
    let stopped = false;
    async function fetchOrg() {
      try {
        const data = await api.get("/institution/profile");
        if (stopped) return;
        const a = String(data?.avatar || org.avatar);
        const n = String(data?.name || org.name);
        const d = String(data?.desc || org.desc);
        setOrg({ avatar: normalizeAvatar(a), name: n, desc: d });
        setAvatarUrl(normalizeAvatar(session?.avatarUrl || session?.avatar));
      } catch (_) {
        // 保持默认占位，不报错
      }
    }
    fetchOrg();
    return () => { stopped = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const s = session;
    setAvatarUrl(normalizeAvatar(s?.avatar || s?.avatarUrl || avatarUrl));
  }, [session]);

  useEffect(() => {
    const onStorage = (e) => {
      try {
        if (!e || !e.key || e.key === 'sessionUser') {
          const u = JSON.parse(localStorage.getItem('sessionUser') || 'null');
          setSession(u);
          setAvatarUrl(normalizeAvatar(u?.avatar || u?.avatarUrl || ''));
        }
      } catch { }
    };
    try { window.addEventListener('storage', onStorage); } catch { }
    return () => { try { window.removeEventListener('storage', onStorage); } catch { } };
  }, []);

  // 加载用户的大宗订单卡片与状态
  useEffect(() => {
    let stopped = false;
    async function fetchOrders() {
      try {
        const data = await api.get('/me/trade/block/orders');
        const arr = Array.isArray(data?.items) ? data.items : [];
        const mapped = arr.map(r => {
          const s = String(r.symbol || '').toUpperCase();
          const base = s.replace(/USDT$/i, '').replace(/\/-?USDT$/i, '').replace(/\/-?USD$/i, '');
          const isCrypto = ['BTC', 'ETH', 'SOL', 'ADA', 'XRP', 'DOGE', 'LTC', 'BCH', 'BNB', 'AVAX', 'DOT', 'LINK', 'MATIC', 'XMR', 'TRX', 'ATOM', 'NEAR', 'ETC', 'UNI'].includes(base);
          const mk = isCrypto ? 'crypto' : 'us';
          const ts = Date.parse(r.submitted_at || '') || Date.now();
          const lu = r.lock_until_ts || r.lock_until || null;
          let finalPrice = Number(r.sell_price || r.final_price || r.filled_price || r.done_price || 0);
          if ((!Number.isFinite(finalPrice) || finalPrice <= 0) && r.notes && /^sold@/i.test(String(r.notes))) {
            const m = String(r.notes).match(/sold@([0-9.]+)/i);
            if (m) finalPrice = Number(m[1] || 0);
          }
          const profit = Number(r.profit || NaN);
          const profitPct = Number(r.profit_pct || NaN);
          return { id: r.id, symbol: base, market: mk, blockPrice: Number(r.price || 0), price: Number(r.price || 0), qty: Number(r.qty || 0), status: String(r.status || 'submitted'), lockUntil: lu, ts, finalPrice, profit, profitPct, locked: r.locked };
        });
        if (!stopped) setOrders(mapped);
      } catch {
        // 后端不可用时不使用本地镜像，保持为空
        if (!stopped) setOrders([]);
      }
    }
    fetchOrders();
    const iv = setInterval(fetchOrders, 5000);
    return () => { stopped = true; clearInterval(iv); };
  }, []);

  // 根据订单列表刷新行情（2s），用于实时盈亏显示
  useEffect(() => {
    let stopped = false;
    async function refreshQuotes() {
      const cryptoBases = orders.filter(o => o.market === 'crypto').map(o => String(o.symbol).toUpperCase());
      const usSymbols = orders.filter(o => o.market === 'us').map(o => String(o.symbol).toUpperCase());
      const next = {};
      try {
        if (cryptoBases.length) {
          const q = await getCryptoQuotes({ symbols: cryptoBases });
          for (const r of q) next[`crypto:${String(r.symbol).toUpperCase()}`] = { price: Number(r.priceUSD || r.price || 0), changePct: Number(r.changePct || 0) };
        }
      } catch { }
      try {
        if (usSymbols.length) {
          const q = await getQuotes({ market: 'us', symbols: usSymbols });
          for (const r of q) next[`us:${String(r.symbol).toUpperCase()}`] = { price: Number(r.price || 0), changePct: Number(r.changePct || 0) };

          // Fallback for missing US quotes (e.g. invalid key or rate limit)
          const missingUs = usSymbols.filter(s => !(next[`us:${s}`]?.price > 0));

          for (const s of missingUs) {
            try {
              // Try to get last close from sparkline data
              const closes = await getStockSpark(s, 'us', { interval: '1day', points: 1 });
              const prevClose = Array.isArray(closes) && closes.length ? Number(closes[closes.length - 1] || 0) : 0;
              if (Number.isFinite(prevClose) && prevClose > 0) {
                next[`us:${s}`] = { price: prevClose, changePct: 0 };
              } else {
                // Fallback: try localStorage cache from previous successful fetches
                try {
                  const raw = JSON.parse(localStorage.getItem(`td:us:${s}`) || 'null');
                  const d = raw?.data;
                  const p = Number(d?.price ?? d?.close ?? d?.previous_close ?? 0);
                  if (p > 0) next[`us:${s}`] = { price: p, changePct: Number(d?.changePct ?? d?.percent_change ?? 0) };
                } catch { }
              }
            } catch { }
          }
        }
      } catch { }
      if (!stopped) setQuotes(next);
    }
    refreshQuotes();
    const iv = setInterval(refreshQuotes, 30000);
    return () => { stopped = true; clearInterval(iv); };
  }, [orders]);

  function quoteKeyFor(o) { return `${o.market}:${String(o.symbol).toUpperCase()}`; }
  function currentPriceFor(o) {
    const p = o && o.status === 'done' ? Number(o.finalPrice || 0) : Number(quotes[quoteKeyFor(o)]?.price || 0);
    if (!Number.isFinite(p) || p <= 0) return Number(o?.blockPrice || o?.price || 0);
    return p;
  }
  function pnlValue(o) {
    const buy = Number(o.blockPrice || o.price || 0);
    const cur = o && o.status === 'done' ? Number((Number.isFinite(o.finalPrice) && o.finalPrice > 0) ? o.finalPrice : (Number.isFinite(o.profit) && Number.isFinite(o.qty) && o.qty > 0 ? (o.profit / o.qty + buy) : buy)) : currentPriceFor(o);
    const qty = Number(o.qty || 0);
    if (!Number.isFinite(buy) || !Number.isFinite(cur) || !Number.isFinite(qty) || qty <= 0) return 0;
    return Number(((cur - buy) * qty).toFixed(2));
  }
  function pnlPct(o) {
    const buy = Number(o.blockPrice || o.price || 0);
    const cur = o && o.status === 'done' ? Number((Number.isFinite(o.finalPrice) && o.finalPrice > 0) ? o.finalPrice : (Number.isFinite(o.profitPct) ? ((o.profitPct / 100) * buy + buy) : buy)) : currentPriceFor(o);
    if (!Number.isFinite(buy) || buy <= 0 || !Number.isFinite(cur) || cur <= 0) return 0;
    return Number((((cur - buy) / buy) * 100).toFixed(2));
  }
  function profitColor(o) {
    const v = pnlValue(o);
    if (v > 0) return '#16a34a';
    if (v < 0) return '#dc2626';
    return '#64748b';
  }
  function statusColor(s) {
    const v = String(s || 'submitted');
    if (v === 'rejected') return '#ef4444';
    if (v === 'done') return '#64748b';
    return '#10b981';
  }
  function tabBtnStyle(active) {
    return active
      ? { background: 'linear-gradient(90deg, #4a9cff, #7d6bff)', color: '#fff', border: '1px solid #6fa8ff' }
      : { background: 'transparent', color: '#aeb8c7', border: '1px solid #2a3b56' };
  }
  function statusLabel(s) {
    const v = String(s || 'pending');
    if (v === 'done') return (lang === 'zh' ? '已完成' : (lang === 'pl' ? 'Zakończone' : 'Completed'));
    if (v === 'approved') return (lang === 'zh' ? '已批准' : (lang === 'pl' ? 'Zatwierdzone' : 'Approved'));
    if (v === 'rejected') return (lang === 'zh' ? '已拒绝' : (lang === 'pl' ? 'Odrzucone' : 'Rejected'));
    return (lang === 'zh' ? '待审核' : (lang === 'pl' ? 'Oczekujące' : 'Pending'));
  }
  function isLocked(o) {
    if (o.locked === false) return false;
    const lu = o.lockUntil || o.lock_until;
    const ts = typeof lu === 'number' ? lu : Date.parse(lu || '');
    return Number.isFinite(ts) && Date.now() < ts;
  }
  async function sell(o) {
    try {
      if (o.status !== 'approved') { setToast({ show: true, type: 'error', text: lang === 'zh' ? '仅已批准订单可卖出' : (lang === 'pl' ? 'Tylko zatwierdzone zlecenia' : 'Only approved orders') }); setTimeout(() => setToast({ show: false, type: 'error', text: '' }), 1000); return; }
      if (isLocked(o)) {
        const until = o.lockUntil || o.lock_until;
        setToast({ show: true, type: 'error', text: (lang === 'zh' ? '目前订单锁定中，解锁时间: ' : (lang === 'pl' ? 'Zlecenie zablokowane do: ' : 'Order locked until: ')) + formatMinute(until) });
        setTimeout(() => setToast({ show: false, type: 'error', text: '' }), 1000);
        return;
      }
      const cur = await (async () => {
        // Fast price snapshot with multi-source race and short timeouts
        const base = String(o.symbol).toUpperCase();
        if (o.market === 'crypto') {
          const tryTD = new Promise(async (resolve) => {
            try {
              const list = await getCryptoQuotes({ symbols: [base] });
              const q = list && list[0];
              const p = Number(q?.priceUSD || q?.price || 0);
              resolve(Number.isFinite(p) && p > 0 ? p : NaN);
            } catch { resolve(NaN); }
          });
          const tryBinance = new Promise(async (resolve) => {
            try {
              const pair = `${base}USDT`;
              const j = await fetch(`/binance-api/api/v3/ticker/24hr?symbol=${encodeURIComponent(pair)}`).then(r => r.json()).catch(() => null);
              const p = Number(j?.lastPrice ?? j?.weightedAvgPrice ?? j?.prevClosePrice ?? 0);
              resolve(Number.isFinite(p) && p > 0 ? p : NaN);
            } catch { resolve(NaN); }
          });
          const timeout = new Promise((resolve) => setTimeout(() => resolve(NaN), 1400));
          const candidate = await Promise.race([tryTD, tryBinance, timeout]);
          if (Number.isFinite(candidate) && candidate > 0) return candidate;
          const fallback = currentPriceFor(o);
          return Number.isFinite(fallback) && fallback > 0 ? fallback : Number(o.blockPrice || o.price || 0);
        }
        // US stocks
        const tryTD = new Promise(async (resolve) => {
          try {
            const list = await getQuotes({ market: 'us', symbols: [base] });
            const q = list && list[0];
            const p = Number(q?.price || 0);
            resolve(Number.isFinite(p) && p > 0 ? p : NaN);
          } catch { resolve(NaN); }
        });
        const tryPrevClose = new Promise(async (resolve) => {
          try {
            const closes = await getStockSpark(base, 'us', { interval: '1day', points: 1 });
            const prevClose = Array.isArray(closes) && closes.length ? Number(closes[closes.length - 1] || 0) : 0;
            resolve(Number.isFinite(prevClose) && prevClose > 0 ? prevClose : NaN);
          } catch { resolve(NaN); }
        });
        const timeout = new Promise((resolve) => setTimeout(() => resolve(NaN), 1400));
        const candidate = await Promise.race([tryTD, tryPrevClose, timeout]);
        if (Number.isFinite(candidate) && candidate > 0) return candidate;
        const fallback = currentPriceFor(o);
        return Number.isFinite(fallback) && fallback > 0 ? fallback : Number(o.blockPrice || o.price || 0);
      })();
      if (!Number.isFinite(cur) || cur <= 0) { setToast({ show: true, type: 'error', text: lang === 'zh' ? '当前价格不可用' : (lang === 'pl' ? 'Aktualna cena niedostępna' : 'Current price unavailable') }); setTimeout(() => setToast({ show: false, type: 'error', text: '' }), 1000); return; }
      await api.post(`/me/institution/block/orders/${o.id}/sell`, { currentPrice: cur });
      setToast({ show: true, type: 'ok', text: lang === 'zh' ? '卖出成功，订单已完成' : (lang === 'pl' ? 'Sprzedano pomyślnie, zlecenie zakończone' : 'Sold successfully, order completed') });
      setTimeout(() => setToast({ show: false, type: 'ok', text: '' }), 1000);
      // Freeze local order PnL immediately
      setOrders(prev => prev.map(x => x.id === o.id ? { ...x, status: 'done', finalPrice: cur } : x));
    } catch (e) {
      const msg = (e && (e.message || (e.response && (e.response.data?.error || e.response.data?.message)))) || String(e);
      setToast({ show: true, type: 'error', text: (lang === 'zh' ? '卖出失败: ' : (lang === 'pl' ? 'Sprzedaż nie powiodła się: ' : 'Sell failed: ')) + msg });
      setTimeout(() => setToast({ show: false, type: 'error', text: '' }), 1000);
    }
  }

  return (
    <div className="screen top-align inst-screen" style={{ padding: 0 }}>
      {toast?.show && (
        <div style={{ position: 'fixed', top: 10, left: 0, right: 0, display: 'grid', placeItems: 'center', zIndex: 1000 }}>
          <div style={{ padding: '8px 12px', borderRadius: 10, background: toast.type === 'error' ? '#7a2a2a' : '#274a36', color: '#fff', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast.text}</div>
        </div>
      )}
      {/* 返回按钮 */}
      <div className="inst-back-bar">
        <button
          onClick={() => nav(-1)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 20, padding: '8px 14px', cursor: 'pointer', color: '#e5e7eb', fontSize: 13
          }}
        >
          <span style={{ fontSize: 16 }}>←</span>
          <span>{lang === 'zh' ? '返回' : (lang === 'pl' ? 'Wstecz' : 'Back')}</span>
        </button>
      </div>
      <div className="inst-container">
        {/* 顶部：头像 + 用户资金 */}
        <div className="inst-card">
          <div className="profile-top-card" style={{ marginTop: 0 }}>
            <div className="top-left" style={{ minWidth: 90 }}>
              <div className="avatar-wrap">
                <img className="avatar" src={avatarUrl || "/logo.jpg"} alt="avatar" onError={(e) => { try { e.currentTarget.src = '/logo.jpg'; } catch { } }} />
              </div>
              <div className="top-name" style={{ fontSize: 11, maxWidth: 90, wordBreak: 'normal', hyphens: 'none' }}>{labels.title}</div>
            </div>
            <div className="top-right" style={{ position: 'relative' }}>
              <div style={{ position: 'relative', marginBottom: 8 }}>
                <button 
                  onClick={() => setCurrencyDropdownOpen(!currencyDropdownOpen)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--muted)',
                    fontSize: 12,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: 0
                  }}
                >
                  {lang === 'zh' ? '资产' : (lang === 'pl' ? 'Fundusze' : 'Funds')}
                  <span style={{ color: '#3b82f6', fontWeight: 600 }}>{selectedCurrency}</span>
                  <span style={{ fontSize: 10, opacity: 0.7 }}>▼</span>
                </button>

                {currencyDropdownOpen && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: 4,
                    background: 'var(--card-bg, #1e293b)',
                    border: '1px solid var(--card-border, #334155)',
                    borderRadius: 8,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    zIndex: 100,
                    minWidth: 100,
                    overflow: 'hidden'
                  }}>
                    {['PLN', 'USD', 'USDT'].map(cur => (
                      <div
                        key={cur}
                        onClick={() => { setSelectedCurrency(cur); setCurrencyDropdownOpen(false); }}
                        style={{
                          padding: '10px 16px',
                          cursor: 'pointer',
                          fontSize: 13,
                          fontWeight: selectedCurrency === cur ? 600 : 400,
                          color: selectedCurrency === cur ? '#3b82f6' : 'var(--text)',
                          background: selectedCurrency === cur ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                          transition: 'background 0.15s'
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.15)'}
                        onMouseLeave={e => e.currentTarget.style.background = selectedCurrency === cur ? 'rgba(59, 130, 246, 0.1)' : 'transparent'}
                      >
                        {cur}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="funds-list">
                <div className="fund-row">
                  <span className="label">{selectedCurrency}</span>
                  <span className="value">
                    {selectedCurrency === 'PLN' && formatPLN(funds.pln, lang)}
                    {selectedCurrency === 'USD' && formatMoney(funds.usd, 'USD', lang)}
                    {selectedCurrency === 'USDT' && formatUSDT(funds.usdt, lang)}
                  </span>
                </div>
                <div className="fund-row"><span className="label">{lang === 'zh' ? '信用积分' : (lang === 'pl' ? 'Punktacja kredytowa' : 'Credit Score')}</span><span className="value">{creditScore}</span></div>
              </div>
              {tradeDisabled && <div className="desc" style={{ marginTop: 6, color: '#ff6b6b' }}>{lang === 'zh' ? '交易已禁用' : (lang === 'pl' ? 'Handel wyłączony' : 'Trading disabled')}</div>}
            </div>
          </div>
        </div>

        {/* 机构简介占位：头像 + 名称 + 文案介绍 */}
        <div className="inst-card">
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <img src={normalizeAvatar(org.avatar)} alt="org-avatar" style={{ width: 64, height: 64, minWidth: 64, borderRadius: 12, border: '2px solid var(--card-border)', objectFit: 'cover', background: 'var(--card-bg)' }} onError={(e) => { try { e.currentTarget.src = '/logo.jpg'; } catch { } }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)', marginBottom: 6 }}>{org.name}</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, wordBreak: 'break-word' }}>{org.desc}</div>
            </div>
          </div>
        </div>

        {/* 三个圆形按钮入口：基金 / 大宗交易 / IPO-RWA */}
        <div className="inst-card">
          <div className="icon-grid">
            <div className="icon-item" onClick={() => nav('/institution/funds')}>
              <div className="icon-circle">💼</div>
              <div className="icon-label">{labels.btnFunds}</div>
            </div>
            <div className="icon-item" onClick={() => nav('/institution/blocks')}>
              <div className="icon-circle">📦</div>
              <div className="icon-label">{labels.btnBlocks}</div>
            </div>
            <div className="icon-item" onClick={() => nav('/institution/ipo-rwa')}>
              <div className="icon-circle">🏛️</div>
              <div className="icon-label">{labels.btnIpoRwa}</div>
            </div>
            <div className="icon-item" onClick={() => setCreditModal(true)}>
              <div className="icon-circle">💳</div>
              <div className="icon-label">{lang === 'zh' ? '信用金' : (lang === 'pl' ? 'Kredyt' : 'Credit')}</div>
            </div>
          </div>
        </div>

        {/* 持仓板块（仅机构订单，不与外部交易混合） */}
        <div className="inst-card">
          <div style={{ display: 'flex', gap: 8 }}>
            <button className={`btn slim`} style={tabBtnStyle(tab === 'current')} onClick={() => setTab('current')}>{labels.tabCurrent}</button>
            <button className={`btn slim`} style={tabBtnStyle(tab === 'done')} onClick={() => setTab('done')}>{labels.tabDone}</button>
          </div>
          <div className="sub-card" style={{ display: 'grid', gap: 8 }}>
            {(orders || []).filter(o => (tab === 'current' ? o.status !== 'done' : o.status === 'done')).length === 0 && (
              <div className="desc">{labels.emptyTip}</div>
            )}
            {(orders || []).filter(o => (tab === 'current' ? o.status !== 'done' : o.status === 'done')).map(o => (
              <div key={o.id} className="card flat order-row" style={{ display: 'grid', gridTemplateColumns: (isMobile ? '1fr' : '1fr 180px'), gap: 8, alignItems: (isMobile ? 'start' : 'center'), border: '1px solid #e2e8f0', borderRadius: 14, padding: '12px 14px', background: '#ffffff', boxShadow: '0 2px 5px rgba(0,0,0,0.05)', overflow: 'hidden', boxSizing: 'border-box', color: '#1e293b' }}>
                <div style={{ display: 'grid', gap: 4, minWidth: 0, wordBreak: 'break-word' }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{String(o.market).toUpperCase()} · {String(o.symbol).toUpperCase()}</div>
                  <div className="desc" style={{ color: '#64748b' }}>
                    {lang === 'zh' ? '价格' : (lang === 'pl' ? 'Cena' : 'Price')}: {o.market === 'crypto' ? formatUSDT(Number(o.blockPrice || o.price || 0), lang) : formatMoney(Number(o.blockPrice || o.price || 0) * usdToPlnRate, 'PLN', lang)}
                    {' · '}
                    {lang === 'zh' ? '数量' : (lang === 'pl' ? 'Ilość' : 'Qty')}: {Number(o.qty || 0)}
                    {' · '}
                    {lang === 'zh' ? '总额' : (lang === 'pl' ? 'Razem' : 'Total')}: {o.market === 'crypto' ? formatUSDT(Number((o.blockPrice || o.price || 0) * Number(o.qty || 0)), lang) : formatMoney(Number((o.blockPrice || o.price || 0) * Number(o.qty || 0)) * usdToPlnRate, 'PLN', lang)}
                  </div>
                  <div className="desc" style={{ color: '#64748b' }}>
                    {lang === 'zh' ? '锁定至' : (lang === 'pl' ? 'Zablokowane do' : 'Lock Until')}: {o.locked === false ? (lang === 'zh' ? '已解锁' : (lang === 'pl' ? 'Odblokowane' : 'Unlocked')) : formatMinute(o.lockUntil || o.lock_until)}
                    {tab === 'current' ? (
                      <> {' · '} {lang === 'zh' ? '当前价' : (lang === 'pl' ? 'Aktualna cena' : 'Current')}: {o.market === 'crypto' ? formatUSDT(currentPriceFor(o) || 0, lang) : formatMoney((currentPriceFor(o) || 0) * usdToPlnRate, 'PLN', lang)} </>
                    ) : null}
                  </div>
                  <div className="desc" style={{ color: '#64748b' }}>
                    {lang === 'zh' ? '提交于' : (lang === 'pl' ? 'Przesłano' : 'Submitted')}: {formatMinute(Number(o.ts || Date.now()))}
                  </div>
                </div>
                <div style={{ display: 'grid', justifyItems: (isMobile ? 'start' : 'end'), alignContent: 'start', gap: 6, minWidth: 0, paddingRight: (isMobile ? 0 : 6), paddingTop: (isMobile ? 8 : 0) }}>
                  <span className="tag" style={{ background: statusColor(o.status), color: '#fff' }}>{statusLabel(o.status)}</span>
                  <div style={{ fontSize: 18, fontWeight: 700, color: profitColor(o) }}>{pnlPct(o)}%</div>
                  <div style={{ fontSize: 14, color: profitColor(o) }}>{o.market === 'crypto' ? formatUSDT(pnlValue(o), lang) : formatMoney(Number(pnlValue(o)) * usdToPlnRate, 'PLN', lang)}</div>
                  {tab === 'current' && (
                    <button className="btn primary slim" disabled={tradeDisabled || o.status !== 'approved'} onClick={() => sell(o)}>
                      {lang === 'zh' ? '卖出' : (lang === 'pl' ? 'Sprzedaj' : 'Sell')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>


      </div>
      {creditModal && (
        <div className="modal" role="dialog" aria-modal="true" onClick={() => setCreditModal(false)}>
          <div className="modal-card" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="title" style={{ marginTop: 0 }}>{lang === 'zh' ? '信用贷款申请' : (lang === 'pl' ? 'Wniosek kredytowy' : 'Credit Application')}</h2>
            <div className="desc" style={{ marginTop: 6 }}>{lang === 'zh' ? `你当前的信用积分为：${creditScore}` : (lang === 'pl' ? `Twój wynik kredytowy: ${creditScore}` : `Your credit score: ${creditScore}`)}</div>
            <div style={{ position: 'absolute', right: 12, top: 12 }}>
              <button className="pill" onClick={async () => { try { const r = await api.get('/me/credit/apps'); const arr = Array.isArray(r?.items) ? r.items : (Array.isArray(r) ? r : []); const list = arr.length ? arr : JSON.parse(localStorage.getItem('credit:apps') || '[]'); setCreditHistory(Array.isArray(list) ? list : []); } catch { try { const list = JSON.parse(localStorage.getItem('credit:apps') || '[]'); setCreditHistory(Array.isArray(list) ? list : []); } catch { setCreditHistory([]); } } setCreditHistoryOpen(true); }}>
                {lang === 'zh' ? '申请记录' : (lang === 'pl' ? 'Historia' : 'Records')}
              </button>
            </div>
            <div className="form" style={{ marginTop: 10 }}>
              <label className="label">{lang === 'zh' ? '姓名' : (lang === 'pl' ? 'Imię' : 'Name')}</label>
              <input className="input" value={creditForm.name} onChange={e => setCreditForm(p => ({ ...p, name: e.target.value }))} />
              <label className="label">{lang === 'zh' ? '电话号码' : (lang === 'pl' ? 'Telefon' : 'Phone')}</label>
              <input className="input" value={creditForm.phone} onChange={e => setCreditForm(p => ({ ...p, phone: e.target.value }))} />
              <label className="label">{lang === 'zh' ? '街道 + 门牌号' : (lang === 'pl' ? 'Ulica + numer' : 'Street + No.')}</label>
              <input className="input" value={creditForm.address} onChange={e => setCreditForm(p => ({ ...p, address: e.target.value }))} />
              <label className="label">{lang === 'zh' ? '邮编' : (lang === 'pl' ? 'Kod pocztowy' : 'ZIP')}</label>
              <input className="input" value={creditForm.zip} onChange={e => setCreditForm(p => ({ ...p, zip: e.target.value }))} />
              <label className="label">{lang === 'zh' ? '城市/市镇' : (lang === 'pl' ? 'Miasto' : 'City/Town')}</label>
              <input className="input" value={creditForm.city} onChange={e => setCreditForm(p => ({ ...p, city: e.target.value }))} />
              <label className="label">{lang === 'zh' ? '州' : (lang === 'pl' ? 'Województwo' : 'State')}</label>
              <input className="input" value={creditForm.state} onChange={e => setCreditForm(p => ({ ...p, state: e.target.value }))} />
              <label className="label">{lang === 'zh' ? '借款金额（比索）' : (lang === 'pl' ? 'Kwota (PLN)' : 'Amount (PLN)')}</label>
              <input className="input" type="number" value={creditForm.amount} onChange={e => setCreditForm(p => ({ ...p, amount: e.target.value }))} />
              <label className="label">{lang === 'zh' ? '资金使用周期' : (lang === 'pl' ? 'Okres użytkowania' : 'Usage period')}</label>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8 }}>
                <input className="input" type="number" min={1} step={1} placeholder={lang === 'zh' ? '数值' : (lang === 'pl' ? 'Wartość' : 'Value')} value={creditForm.periodValue} onChange={e => setCreditForm(p => ({ ...p, periodValue: e.target.value }))} onBlur={e => { const v = Math.max(1, Number(e.target.value || 1)); setCreditForm(p => ({ ...p, periodValue: String(v) })); }} />
                <select className="input" value={creditForm.periodUnit} onChange={e => setCreditForm(p => ({ ...p, periodUnit: e.target.value }))}>
                  <option value="year">{lang === 'zh' ? '年' : (lang === 'pl' ? 'Rok' : 'Year')}</option>
                  <option value="month">{lang === 'zh' ? '月' : (lang === 'pl' ? 'Miesiąc' : 'Month')}</option>
                  <option value="day">{lang === 'zh' ? '日' : (lang === 'pl' ? 'Dzień' : 'Day')}</option>
                </select>
              </div>
              <div className="desc" style={{ marginTop: 8 }}>{lang === 'zh' ? '可以提供你的资产证明，有助于提升你的实际审批金额' : (lang === 'pl' ? 'Podaj dowód aktywów, aby poprawić zatwierdzenie' : 'Provide asset proof to improve approval')}</div>
              <input ref={fileInputRef} style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} type="file" accept="image/*" multiple onChange={async (e) => {
                try {
                  const files = Array.from(e.target.files || []);
                  const encoded = await Promise.all(files.map(f => new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve({ name: f.name, data: String(r.result) }); r.readAsDataURL(f); })));
                  setCreditForm(p => ({ ...p, images: [...(Array.isArray(p.images) ? p.images : []), ...encoded].slice(0, 5) }));
                } catch { }
                try { e.target.value = ''; } catch { }
              }} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginTop: 8 }}>
                {Array.isArray(creditForm.images) && creditForm.images.map((im, idx) => (
                  <div key={`im-${idx}`} style={{ position: 'relative', height: 80, border: '1px dashed var(--card-border)', borderRadius: 8, overflow: 'hidden', background: 'var(--card-bg)' }}>
                    <img src={im.data || im} alt={im.name || `img-${idx}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onClick={() => { const w = window.open('', '_blank', 'noopener'); if (w) { w.document.write(`<img src='${im.data || im}' style='max-width:100%' />`); } }} />
                    <button className="pill" style={{ position: 'absolute', top: 4, right: 4 }} onClick={() => { setCreditForm(p => ({ ...p, images: p.images.filter((_, i) => i !== idx) })); }}>×</button>
                  </div>
                ))}
                {Array.isArray(creditForm.images) && creditForm.images.length < 5 && (
                  <div onClick={() => fileInputRef.current?.click?.()} style={{ display: 'grid', placeItems: 'center', height: 80, border: '1px dashed var(--card-border)', borderRadius: 8, cursor: 'pointer', background: 'var(--card-bg)', color: 'var(--muted)', fontSize: 24, lineHeight: 1 }}>+
                  </div>
                )}
              </div>
              <div className="desc" style={{ marginTop: 6 }}>{lang === 'zh' ? '最多5张' : (lang === 'pl' ? 'Do 5 zdjęć' : 'Up to 5 images')}</div>
              <div className="sub-actions" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                <button className="btn" onClick={() => setCreditModal(false)}>{lang === 'zh' ? '取消' : (lang === 'pl' ? 'Anuluj' : 'Cancel')}</button>
                <button className="btn primary" disabled={creditSubmitting} onClick={async () => {
                  try {
                    setCreditSubmitting(true);
                    const payload = { score: creditScore, ...creditForm };
                    await api.post('/me/credit/apply', payload);
                    setCreditModal(false);
                    setToast({ show: true, type: 'ok', text: lang === 'zh' ? '提交成功，请等待审核' : (lang === 'pl' ? 'Przesłano, oczekuj na zatwierdzenie' : 'Submitted, wait for approval') });
                    setTimeout(() => setToast({ show: false, type: 'ok', text: '' }), 2000);
                  } catch (e) {
                    const msg = String(e?.message || e);
                    setToast({ show: true, type: 'error', text: (lang === 'zh' ? '提交失败: ' : (lang === 'pl' ? 'Nie powiodło się: ' : 'Failed: ')) + msg });
                    setTimeout(() => setToast({ show: false, type: 'error', text: '' }), 3000);
                  } finally {
                    setCreditSubmitting(false);
                  }
                }}>{creditSubmitting ? (lang === 'zh' ? '提交中...' : (lang === 'pl' ? 'Przesyłanie...' : 'Submitting...')) : (lang === 'zh' ? '提交' : (lang === 'pl' ? 'Prześlij' : 'Submit'))}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {creditHistoryOpen && (
        <div className="modal" role="dialog" aria-modal="true" onClick={() => setCreditHistoryOpen(false)}>
          <div className="modal-card" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="title" style={{ marginTop: 0 }}>{lang === 'zh' ? '申请记录' : (lang === 'pl' ? 'Historia kredytowa' : 'Credit records')}</h2>
            <div style={{ display: 'grid', gap: 8 }}>
              {(creditHistory || []).map((it) => (
                <div key={it.id} className="card flat" style={{ padding: '8px 10px' }}>
                  <div className="desc">{lang === 'zh' ? '姓名' : (lang === 'pl' ? 'Imię' : 'Name')}: {it.name}</div>
                  <div className="desc">{lang === 'zh' ? '金额' : (lang === 'pl' ? 'Kwota' : 'Amount')}: {Number(it.amount || 0)}</div>
                  <div className="desc">{lang === 'zh' ? '状态' : (lang === 'pl' ? 'Status' : 'Status')}: {String(it.status || 'pending')}</div>
                  <div className="desc">{lang === 'zh' ? '时间' : (lang === 'pl' ? 'Czas' : 'Time')}: {new Date(it.ts || Date.now()).toLocaleString(lang === 'pl' ? 'pl-PL' : (lang === 'zh' ? 'zh-CN' : 'en-US'))}</div>
                </div>
              ))}
              {(creditHistory || []).length === 0 && (<div className="desc">{lang === 'zh' ? '暂无记录' : (lang === 'pl' ? 'Brak rekordów' : 'No records')}</div>)}
            </div>
            <div className="sub-actions" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
              <button className="btn" onClick={() => setCreditHistoryOpen(false)}>{lang === 'zh' ? '关闭' : (lang === 'pl' ? 'Zamknij' : 'Close')}</button>
            </div>
          </div>
        </div>
      )}
      <BottomNav />
    </div>
  );
}
