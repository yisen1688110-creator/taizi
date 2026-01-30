import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import BottomNav from "../../components/BottomNav.jsx";
import { useI18n } from "../../i18n.jsx";
import { api } from "../../services/api.js";
import { formatMoney, formatUSDT } from "../../utils/money.js";
import { formatMinute, getPolandTimestamp } from "../../utils/date.js";
// ...
import { toMs } from "../../utils/time.js";
import { getQuotes, getCryptoQuotes, getStockSpark, getUsdPlnRate } from "../../services/marketData.js";
import "../../styles/settings.css";
import "../../styles/settings.css";

// 机构 - 日内交易列表页
export default function InstitutionBlocks() {
  const nav = useNavigate();
  const { t, lang } = useI18n();
  const [items, setItems] = useState([]); // 后端配置的大宗交易
  const [loading, setLoading] = useState(false);
  const [quotes, setQuotes] = useState({}); // { key: { price, changePct } }
  const [qtyMap, setQtyMap] = useState({}); // { id: qty }
  const [sliderMap, setSliderMap] = useState({}); // { id: 0-100 }
  const [keyMap, setKeyMap] = useState({}); // { id: subscribeKey }
  const [balances, setBalances] = useState({ PLN: 0, USD: 0, USDT: 0, EUR: 0 });
  const [usdToPlnRate, setUsdToPlnRate] = useState(18.0);
  const [submittingId, setSubmittingId] = useState(null);
  const [toast, setToast] = useState({ show: false, type: 'ok', text: '' });
  const showToast = (text, type = 'ok') => { setToast({ show: true, type, text }); setTimeout(() => setToast({ show: false, type, text: '' }), 1000); };
  
  // 我的持仓弹窗状态
  const [showHoldings, setShowHoldings] = useState(false);
  const [holdings, setHoldings] = useState([]);
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  useEffect(() => {
    try {
      const qs = new URLSearchParams(typeof location !== 'undefined' ? (location.search || '') : '');
      const td = (qs.get('tdkey') || qs.get('twelvedata') || '').trim();
      if (td && !localStorage.getItem('td:key')) localStorage.setItem('td:key', td);
    } catch { }
  }, []);

  const labels = useMemo(() => ({
    pageTitle: lang === 'zh' ? '日内交易' : (lang === 'pl' ? 'Day Trade' : 'Day Trade'),
    type: lang === 'zh' ? '类型' : (lang === 'pl' ? 'Tipo' : 'Type'),
    typeCrypto: lang === 'zh' ? '加密货币' : (lang === 'pl' ? 'Krypto' : 'Crypto'),
    typeUS: lang === 'zh' ? '美股' : (lang === 'pl' ? 'Akcje USA' : 'US Stocks'),
    typePL: lang === 'zh' ? '波兰股' : (lang === 'pl' ? 'Akcje PL' : 'PL Stocks'),
    symbol: lang === 'zh' ? '编码' : (lang === 'pl' ? 'Código' : 'Symbol'),
    currentPrice: lang === 'zh' ? '现价' : (lang === 'pl' ? 'Precio actual' : 'Current Price'),
    blockPrice: lang === 'zh' ? '日内交易价格' : (lang === 'pl' ? 'Day Trade Price' : 'Day Trade Price'),
    minQty: lang === 'zh' ? '最小购买' : (lang === 'pl' ? 'Mínimo' : 'Min Qty'),
    qty: lang === 'zh' ? '申购数量' : (lang === 'pl' ? 'Cantidad' : 'Quantity'),
    subscribeKey: lang === 'zh' ? '认购密钥' : (lang === 'pl' ? 'Clave de suscripción' : 'Subscription Key'),
    window: lang === 'zh' ? '申购时间窗' : (lang === 'pl' ? 'Ventana de suscripción' : 'Subscription Window'),
    lockedUntil: lang === 'zh' ? '锁定至' : (lang === 'pl' ? 'Bloqueado hasta' : 'Lock Until'),
    btnSubmit: lang === 'zh' ? '提交' : (lang === 'pl' ? 'Enviar' : 'Submit'),
    submitting: lang === 'zh' ? '提交中...' : (lang === 'pl' ? 'Enviando...' : 'Submitting...'),
    closed: lang === 'zh' ? '已关闭' : (lang === 'pl' ? 'Cerrado' : 'Closed'),
    consume: lang === 'zh' ? '消耗资金' : (lang === 'pl' ? 'Consumir fondos' : 'Consume'),
    notStarted: lang === 'zh' ? '未开始' : (lang === 'pl' ? 'No empezado' : 'Not Started'),
    ended: lang === 'zh' ? '已结束' : (lang === 'pl' ? 'Terminado' : 'Ended'),
    myHoldings: lang === 'zh' ? '我的持仓' : (lang === 'pl' ? 'Moje pozycje' : 'My Holdings'),
    pending: lang === 'zh' ? '待审核' : (lang === 'pl' ? 'Oczekujące' : 'Pending'),
    approved: lang === 'zh' ? '已通过' : (lang === 'pl' ? 'Zatwierdzone' : 'Approved'),
    rejected: lang === 'zh' ? '已拒绝' : (lang === 'pl' ? 'Odrzucone' : 'Rejected'),
    sold: lang === 'zh' ? '已卖出' : (lang === 'pl' ? 'Sprzedane' : 'Sold'),
    locked: lang === 'zh' ? '锁定中' : (lang === 'pl' ? 'Zablokowane' : 'Locked'),
    noHoldings: lang === 'zh' ? '暂无持仓记录' : (lang === 'pl' ? 'Brak pozycji' : 'No holdings'),
    buyTime: lang === 'zh' ? '购买时间' : (lang === 'pl' ? 'Czas zakupu' : 'Buy Time'),
    buyPrice: lang === 'zh' ? '购买价格' : (lang === 'pl' ? 'Cena zakupu' : 'Buy Price'),
    amount: lang === 'zh' ? '金额' : (lang === 'pl' ? 'Kwota' : 'Amount'),
    profit: lang === 'zh' ? '收益' : (lang === 'pl' ? 'Zysk' : 'Profit'),
    close: lang === 'zh' ? '关闭' : (lang === 'pl' ? 'Zamknij' : 'Close'),
    completed: lang === 'zh' ? '已完成' : (lang === 'pl' ? 'Zakończone' : 'Completed'),
    submitted: lang === 'zh' ? '待审核' : (lang === 'pl' ? 'Oczekujące' : 'Pending'),
  }), [t, lang]);

  useEffect(() => {
    fetchList();
    fetchBalances();
  }, []);

  // 获取我的持仓记录
  async function fetchHoldings() {
    try {
      setHoldingsLoading(true);
      const res = await api.get('/me/trade/block/orders');
      const arr = Array.isArray(res?.items) ? res.items : [];
      setHoldings(arr);
    } catch (e) {
      console.warn('fetch holdings failed', e);
      setHoldings([]);
    } finally {
      setHoldingsLoading(false);
    }
  }

  // 打开持仓弹窗时加载数据
  const openHoldings = () => {
    setShowHoldings(true);
    fetchHoldings();
  };

  // 卖出持仓
  async function sellHolding(h) {
    const market = String(h.market || '');
    const baseSymbol = market === 'crypto' ? toCryptoBase(h.symbol) : String(h.symbol).toUpperCase();
    const qk = `${market}:${baseSymbol}`;
    const quote = quotes[qk];
    const currentPrice = Number(quote?.price || h.price || 0);
    
    if (!currentPrice || currentPrice <= 0) {
      alert(lang === 'zh' ? '无法获取当前价格，请稍后再试' : 'Cannot get current price');
      return;
    }
    
    const buyPrice = Number(h.price || 0);
    const qty = Number(h.qty || 0);
    const profit = (currentPrice - buyPrice) * qty;
    const profitPct = buyPrice > 0 ? ((currentPrice - buyPrice) / buyPrice * 100) : 0;
    const { currency } = getMarketCurrency(market);
    const profitStr = currency === 'USDT' ? formatUSDT(profit, lang) : (currency === 'USD' ? formatMoney(profit, 'USD', lang) : formatMoney(profit, 'PLN', lang));
    
    const confirmMsg = lang === 'zh' 
      ? `确认卖出 ${h.symbol}？\n数量: ${qty}\n卖出价: ${currentPrice.toFixed(4)}\n预计${profit >= 0 ? '盈利' : '亏损'}: ${profitStr} (${profitPct >= 0 ? '+' : ''}${profitPct.toFixed(2)}%)`
      : `Confirm sell ${h.symbol}?\nQty: ${qty}\nSell price: ${currentPrice.toFixed(4)}\nExpected ${profit >= 0 ? 'profit' : 'loss'}: ${profitStr} (${profitPct >= 0 ? '+' : ''}${profitPct.toFixed(2)}%)`;
    
    if (!confirm(confirmMsg)) return;
    
    try {
      await api.post(`/me/institution/block/orders/${h.id}/sell`, { currentPrice });
      showToast(lang === 'zh' ? `卖出成功！${profit >= 0 ? '盈利' : '亏损'} ${profitStr}` : `Sold! ${profit >= 0 ? 'Profit' : 'Loss'}: ${profitStr}`, profit >= 0 ? 'ok' : 'warn');
      fetchHoldings();
      fetchBalances();
    } catch (e) {
      alert((lang === 'zh' ? '卖出失败: ' : 'Sell failed: ') + (e?.message || e));
    }
  }

  // 当 items 或 balances 更新时，自动计算每个项目的最大可购买数量（100%资金，含手续费）
  useEffect(() => {
    if (!items.length) return;
    const newQtyMap = {};
    items.forEach(it => {
      const market = String(it.market);
      const { balance } = getMarketCurrency(market);
      const price = Number(it.price || 0);
      if (price > 0) {
        // 考虑 0.1% 手续费：实际花费 = price * qty * 1.001
        const maxQty = Math.floor(balance / (price * 1.001));
        newQtyMap[it.id] = maxQty > 0 ? maxQty : 0;
      } else {
        newQtyMap[it.id] = 0;
      }
    });
    setQtyMap(prev => ({ ...prev, ...newQtyMap }));
  }, [items, balances]);

  async function fetchBalances() {
    try {
      const res = await api.get('/me/balances');
      const arr = Array.isArray(res?.balances) ? res.balances : [];
      const map = { PLN: 0, USD: 0, USDT: 0, EUR: 0 };
      arr.forEach(b => { map[String(b.currency).toUpperCase()] = Number(b.amount || 0); });
      setBalances(map);

      const { rate } = await getUsdPlnRate();
      if (rate > 0) setUsdToPlnRate(rate);
    } catch (e) { console.warn('fetch balances/rate failed', e); }
  }

  function toCryptoBase(s) {
    const u = String(s || '').toUpperCase();
    return u.replace(/USDT$/i, '').replace(/\/USDT$/i, '').replace(/\/USD$/i, '');
  }

  async function fetchList() {
    try {
      setLoading(true);
      const data = await api.get('/trade/block/list');
      const arr = Array.isArray(data?.items) ? data.items : [];
      const active = arr.filter(it => String(it.status || 'active') === 'active');
      setItems(active);
    } catch (e) {
      console.warn('fetch block list failed', e);
      setItems([]);
    } finally { setLoading(false); }
  }

  // 行情刷新（30s）
  useEffect(() => {
    let stopped = false;
    async function refreshQuotes() {
      const cryptoSymbols = items
        .filter(it => it.market === 'crypto')
        .map(it => toCryptoBase(it.symbol));
      const usSymbols = items.filter(it => it.market === 'us').map(it => String(it.symbol).toUpperCase());
      const plSymbols = items.filter(it => it.market === 'pl').map(it => String(it.symbol).toUpperCase());
      const next = {};
      
      // 加密货币行情
      try {
        if (cryptoSymbols.length) {
          const q = await getCryptoQuotes({ symbols: cryptoSymbols });
          for (const r of q) {
            next[`crypto:${r.symbol}`] = { price: Number(r.priceUSD || r.price || 0), changePct: Number(r.changePct || 0) };
          }
          const missingCrypto = cryptoSymbols.filter(s => !(next[`crypto:${s}`]?.price > 0));
          for (const base of missingCrypto) {
            try {
              const pair = `${String(base).toUpperCase()}USDT`;
              const url = `/binance-api/api/v3/ticker/24hr?symbol=${encodeURIComponent(pair)}`;
              const j = await fetch(url).then(r => r.json()).catch(() => null);
              const p = Number(j?.lastPrice ?? j?.weightedAvgPrice ?? j?.prevClosePrice ?? 0);
              const ch = Number(j?.priceChangePercent ?? 0);
              if (p > 0) next[`crypto:${String(base).toUpperCase()}`] = { price: p, changePct: ch };
            } catch { }
          }
        }
      } catch { }
      
      // 美股行情
      try {
        if (usSymbols.length) {
          const q = await getQuotes({ market: 'us', symbols: usSymbols });
          for (const r of q) {
            next[`us:${r.symbol}`] = { price: Number(r.price || 0), changePct: Number(r.changePct || 0) };
          }
          const missingUs = usSymbols.filter(s => !(next[`us:${s}`]?.price > 0));
          for (const s of missingUs) {
            try {
              const closes = await getStockSpark(s, 'us', { interval: '1day', points: 1 });
              const prevClose = Array.isArray(closes) && closes.length ? Number(closes[closes.length - 1] || 0) : 0;
              if (Number.isFinite(prevClose) && prevClose > 0) {
                next[`us:${s}`] = { price: prevClose, changePct: 0 };
              }
            } catch { }
          }
        }
      } catch { }
      
      // 波兰股行情
      try {
        if (plSymbols.length) {
          const q = await getQuotes({ market: 'pl', symbols: plSymbols });
          for (const r of q) {
            next[`pl:${r.symbol}`] = { price: Number(r.price || 0), changePct: Number(r.changePct || 0) };
          }
          const missingPl = plSymbols.filter(s => !(next[`pl:${s}`]?.price > 0));
          for (const s of missingPl) {
            try {
              const closes = await getStockSpark(s, 'pl', { interval: '1day', points: 1 });
              const prevClose = Array.isArray(closes) && closes.length ? Number(closes[closes.length - 1] || 0) : 0;
              if (Number.isFinite(prevClose) && prevClose > 0) {
                next[`pl:${s}`] = { price: prevClose, changePct: 0 };
              }
            } catch { }
          }
        }
      } catch { }
      
      if (!stopped) setQuotes(prev => ({ ...prev, ...next }));
    }
    refreshQuotes();
    const iv = setInterval(refreshQuotes, 30000);
    return () => { stopped = true; clearInterval(iv); };
  }, [items]);

  function nowMs() { return Date.now(); }
  function inWindow(it) {
    const s = getPolandTimestamp(it.start_at || it.startAt || '');
    const e = getPolandTimestamp(it.end_at || it.endAt || '');
    const n = nowMs();
    return Number.isFinite(s) && Number.isFinite(e) && n >= s && n <= e;
  }
  
  // 获取时间状态: 'not_started' | 'open' | 'ended'
  function getTimeStatus(it) {
    const s = getPolandTimestamp(it.start_at || it.startAt || '');
    const e = getPolandTimestamp(it.end_at || it.endAt || '');
    const n = nowMs();
    if (!Number.isFinite(s) || !Number.isFinite(e)) return 'ended';
    if (n < s) return 'not_started';
    if (n > e) return 'ended';
    return 'open';
  }

  // 预览/开发环境下允许跳过时间窗限制，便于测试提交流程
  function canSubmitNow(it) {
    const open = inWindow(it);
    let override = false;
    try {
      const qs = new URLSearchParams(typeof location !== 'undefined' ? (location.search || '') : '');
      const v = (qs.get('submitAny') || qs.get('force') || qs.get('allow') || '').trim();
      if (v) override = /^(1|true|yes|y)$/i.test(v);
    } catch { }
    try {
      const ls = (localStorage.getItem('inst:block:submit_anytime') || '').trim();
      if (ls) override = /^(1|true|yes|y)$/i.test(ls);
    } catch { }
    const isDev = !!(import.meta.env && import.meta.env.DEV);
    return open || override || isDev;
  }

  async function submit(it) {
    const id = Number(it.id);
    const market = String(it.market);
    const symbol = String(it.symbol).toUpperCase();
    const q = Number(qtyMap[id] || 0);
    const minQ = Number(it.min_qty || it.minQty || 1);
    const key = String(keyMap[id] || '').trim();
    if (!q || !Number.isFinite(q) || q < minQ) { alert(lang === 'zh' ? '数量不合法或低于最小购买' : 'Invalid qty or below minimum'); return; }
    if (!key || key.length < 6) { alert(lang === 'zh' ? '请输入有效认购密钥' : 'Enter valid subscription key'); return; }
    const can = canSubmitNow(it);
    if (!can) { alert(lang === 'zh' ? '不在申购时间窗内' : 'Out of subscription window'); return; }
    const quoteKey = `${market}:${symbol}`;
    // Use the block price (discounted price) for the subscription, not the market price
    const cp = Number(it.price || 0);
    try {
      setSubmittingId(id);
      await api.post('/trade/block/subscribe', { blockId: id, qty: q, currentPrice: cp, key });
      showToast(lang === 'zh' ? '购买成功！' : (lang === 'pl' ? '¡Compra exitosa!' : 'Purchase successful!'), 'ok');
      setQtyMap(prev => ({ ...prev, [id]: '' }));
      setKeyMap(prev => ({ ...prev, [id]: '' }));
      // 购买成功后刷新余额
      fetchBalances();
    } catch (e) {
      const msg = (e && (e.message || (e.response && (e.response.data?.error || e.response.data?.message)))) || String(e);
      alert((lang === 'zh' ? '购买失败: ' : 'Purchase failed: ') + msg);
    } finally { setSubmittingId(null); }
  }

  // 根据市场类型获取对应货币和余额
  const getMarketCurrency = (market) => {
    if (market === 'crypto') return { currency: 'USDT', balance: balances.USDT || 0 };
    if (market === 'us') return { currency: 'USD', balance: balances.USD || 0 };
    if (market === 'pl') return { currency: 'PLN', balance: balances.PLN || 0 };
    return { currency: 'PLN', balance: balances.PLN || 0 };
  };

  const handleSliderChange = (it, percent, currentPrice) => {
    const id = it.id;
    setSliderMap(prev => ({ ...prev, [id]: percent }));

    const market = String(it.market);
    const { balance } = getMarketCurrency(market);
    const price = Number(it.price || 0); // Block price

    if (price <= 0) return;

    // 计算可购买的最大数量（整股，含0.1%手续费）
    // 实际花费 = price * qty * 1.001
    const maxQty = Math.floor(balance / (price * 1.001));

    // 如果资金不足一股，显示0（余额保留在钱包）
    if (maxQty <= 0) {
      setQtyMap(prev => ({ ...prev, [id]: 0 }));
      return;
    }

    const targetQty = Math.floor(maxQty * (percent / 100));
    setQtyMap(prev => ({ ...prev, [id]: targetQty > 0 ? targetQty : 0 }));
  };

  // 获取状态显示文本和颜色
  const getStatusInfo = (status) => {
    switch (status) {
      case 'pending': 
      case 'submitted': return { text: labels.submitted, color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' };
      case 'approved': return { text: labels.approved, color: '#10b981', bg: 'rgba(16,185,129,0.15)' };
      case 'rejected': return { text: labels.rejected, color: '#ef4444', bg: 'rgba(239,68,68,0.15)' };
      case 'sold': return { text: labels.sold, color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)' };
      case 'done': 
      case 'completed': return { text: labels.completed, color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)' };
      default: return { text: status, color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' };
    }
  };

  return (
    <div className="screen top-align inst-screen" style={{ padding: 0 }}>
      {toast.show && (<div className={`top-toast ${toast.type}`}>{toast.text}</div>)}
      
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
                📊 {labels.myHoldings}
              </h3>
              <button
                onClick={() => setShowHoldings(false)}
                style={{
                  background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 8,
                  padding: '6px 12px', cursor: 'pointer', color: '#94a3b8', fontSize: 13
                }}
              >{labels.close}</button>
            </div>
            
            {/* 持仓列表 */}
            <div style={{ padding: 16, overflowY: 'auto', maxHeight: 'calc(80vh - 70px)' }}>
              {holdingsLoading && (
                <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>
                  {lang === 'zh' ? '加载中...' : 'Loading...'}
                </div>
              )}
              {!holdingsLoading && holdings.length === 0 && (
                <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>
                  {labels.noHoldings}
                </div>
              )}
              {!holdingsLoading && holdings.length > 0 && (
                <div style={{ display: 'grid', gap: 12 }}>
                  {holdings.map(h => {
                    const statusInfo = getStatusInfo(h.status);
                    const market = String(h.market || '');
                    const { currency } = getMarketCurrency(market);
                    const isLocked = h.locked && h.status === 'approved' && h.lock_until && new Date(h.lock_until).getTime() > Date.now();
                    return (
                      <div key={h.id} style={{
                        background: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 14,
                        border: '1px solid rgba(255,255,255,0.06)'
                      }}>
                        {/* 头部：符号 + 状态 */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 16, fontWeight: 600, color: '#f1f5f9' }}>{h.symbol}</span>
                            <span style={{
                              fontSize: 11, padding: '2px 8px', borderRadius: 10,
                              background: market === 'crypto' ? '#2a3b56' : (market === 'pl' ? '#3b2a56' : '#2a5640'),
                              color: '#e5e7eb'
                            }}>
                              {market === 'crypto' ? labels.typeCrypto : (market === 'pl' ? labels.typePL : labels.typeUS)}
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {isLocked && (
                              <span style={{
                                fontSize: 11, padding: '2px 8px', borderRadius: 10,
                                background: 'rgba(251,191,36,0.15)', color: '#fbbf24'
                              }}>🔒 {labels.locked}</span>
                            )}
                            <span style={{
                              fontSize: 12, padding: '3px 10px', borderRadius: 10,
                              background: statusInfo.bg, color: statusInfo.color
                            }}>{statusInfo.text}</span>
                          </div>
                        </div>
                        
                        {/* 详细信息 */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
                          <div style={{ color: '#94a3b8' }}>
                            {labels.qty}: <span style={{ color: '#e5e7eb' }}>{h.qty}</span>
                          </div>
                          <div style={{ color: '#94a3b8' }}>
                            {labels.buyPrice}: <span style={{ color: '#e5e7eb' }}>
                              {currency === 'USDT' ? formatUSDT(h.price, lang) : (currency === 'USD' ? formatMoney(h.price, 'USD', lang) : formatMoney(h.price, 'PLN', lang))}
                            </span>
                          </div>
                          <div style={{ color: '#94a3b8' }}>
                            {labels.amount}: <span style={{ color: '#e5e7eb' }}>
                              {currency === 'USDT' ? formatUSDT(h.amount, lang) : (currency === 'USD' ? formatMoney(h.amount, 'USD', lang) : formatMoney(h.amount, 'PLN', lang))}
                            </span>
                          </div>
                          {h.status === 'sold' && h.profit !== undefined && (
                            <div style={{ color: '#94a3b8' }}>
                              {labels.profit}: <span style={{ color: h.profit >= 0 ? '#10b981' : '#ef4444' }}>
                                {currency === 'USDT' ? formatUSDT(h.profit, lang) : (currency === 'USD' ? formatMoney(h.profit, 'USD', lang) : formatMoney(h.profit, 'PLN', lang))}
                                {h.profit_pct !== undefined && ` (${Number(h.profit_pct).toFixed(2)}%)`}
                              </span>
                            </div>
                          )}
                        </div>
                        
                        {/* 时间信息 */}
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: 12, color: '#64748b' }}>
                          <div>{labels.buyTime}: {h.submitted_at ? formatMinute(h.submitted_at) : (h.approved_at ? formatMinute(h.approved_at) : '—')}</div>
                          {h.lock_until && (
                            <div style={{ color: isLocked ? '#fbbf24' : '#64748b' }}>{labels.lockedUntil}: {formatMinute(h.lock_until)}</div>
                          )}
                          {h.profit !== null && h.profit !== undefined && (
                            <div style={{ color: Number(h.profit) >= 0 ? '#22c55e' : '#ef4444' }}>
                              {labels.profit}: {Number(h.profit) >= 0 ? '+' : ''}{Number(h.profit).toFixed(2)}
                              {h.profit_pct !== null && h.profit_pct !== undefined && ` (${Number(h.profit_pct) >= 0 ? '+' : ''}${Number(h.profit_pct).toFixed(2)}%)`}
                            </div>
                          )}
                          {h.sold_at && <div>{lang === 'zh' ? '卖出时间' : 'Sold at'}: {formatMinute(h.sold_at)}</div>}
                        </div>
                        
                        {/* 卖出按钮 */}
                        {h.status === 'approved' && !isLocked && (
                          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                            <button 
                              className="btn primary" 
                              style={{ width: '100%', padding: '8px 0', fontSize: 13, borderRadius: 8 }}
                              onClick={() => sellHolding(h)}
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
      {/* 返回按钮 + 我的持仓 */}
      <div className="inst-back-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
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
        <button
          onClick={openHoldings}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'linear-gradient(135deg, #3b82f6, #2563eb)', border: 'none',
            borderRadius: 20, padding: '8px 16px', cursor: 'pointer', color: '#fff', fontSize: 13, fontWeight: 500,
            boxShadow: '0 2px 8px rgba(59, 130, 246, 0.3)'
          }}
        >
          <span style={{ fontSize: 14 }}>📊</span>
          <span>{labels.myHoldings}</span>
        </button>
      </div>
      <div className="inst-container">
        <div>
          <h1 className="title" style={{ marginTop: 0, marginBottom: 8 }}>{labels.pageTitle}</h1>
        </div>

        <div className="inst-card">
          {loading && (<div className="desc">{lang === 'zh' ? '加载中...' : (lang === 'pl' ? 'Cargando...' : 'Loading...')}</div>)}
          {!loading && items.length === 0 && (<div className="desc">{lang === 'zh' ? '暂无数据' : (lang === 'pl' ? 'Sin datos' : 'No data')}</div>)}
          {!loading && items.length > 0 && (
            <div style={{ display: 'grid', gap: 12 }}>
              {items.filter(it => getTimeStatus(it) !== 'ended').map(it => {
                const market = String(it.market);
                const origSymbol = String(it.symbol).toUpperCase();
                const baseSymbol = market === 'crypto' ? toCryptoBase(origSymbol) : origSymbol;
                const blockPrice = Number(it.price || 0);
                const minQty = Number(it.min_qty || it.minQty || 1);
                const qk = `${market}:${baseSymbol}`;
                const quote = quotes[qk];
                const currentPriceRaw = Number(quote?.price || 0);
                const currentPrice = currentPriceRaw > 0 ? currentPriceRaw : blockPrice;
                const { currency, balance: availableBalance } = getMarketCurrency(market);
                const total = (blockPrice * Number(qtyMap[it.id] || 0)) || 0;
                const fee = Number((total * 0.001).toFixed(6)); // 手续费：千分之一
                const totalWithFee = total + fee;
                const unitProfit = currentPrice && blockPrice ? (currentPrice - blockPrice) : 0;
                const unitPct = currentPrice && blockPrice ? ((currentPrice - blockPrice) / blockPrice * 100) : 0;
                const qty = Number(qtyMap[it.id] || 0);
                const totalProfit = qty ? unitProfit * qty : unitProfit;
                const isOpen = inWindow(it);
                return (
                  <div key={it.id} className="card" style={{ display: 'grid', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 700 }}>{labels.symbol}: {baseSymbol}</div>
                      <div className="tag" style={{ background: market === 'crypto' ? '#2a3b56' : (market === 'pl' ? '#3b2a56' : '#2a5640'), transform: 'scale(0.92)', whiteSpace: 'normal', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '60%' }}>{labels.type}: {market === 'crypto' ? labels.typeCrypto : (market === 'pl' ? labels.typePL : labels.typeUS)}</div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div className="desc">{labels.currentPrice}: {currency === 'USDT' ? formatUSDT(currentPrice, lang) : (currency === 'USD' ? formatMoney(currentPrice, 'USD', lang) : formatMoney(currentPrice, 'PLN', lang))}</div>
                      <div className="desc">{labels.blockPrice}: {currency === 'USDT' ? formatUSDT(blockPrice, lang) : (currency === 'USD' ? formatMoney(blockPrice, 'USD', lang) : formatMoney(blockPrice, 'PLN', lang))}</div>
                      <div className="desc">{labels.window}: {formatMinute(it.start_at || it.startAt)} ~ {formatMinute(it.end_at || it.endAt)}</div>
                      <div className="desc">{lang === 'zh' ? '截至购买' : 'Deadline'}: {formatMinute(it.end_at || it.endAt)}</div>
                      <div className="desc">{labels.lockedUntil}: {formatMinute(it.lock_until || it.lockUntil)}</div>
                      <div className="desc">{labels.minQty}: {minQty}</div>
                      <div className="desc">{labels.consume}: {currency === 'USDT' ? formatUSDT(totalWithFee, lang) : (currency === 'USD' ? formatMoney(totalWithFee, 'USD', lang) : formatMoney(totalWithFee, 'PLN', lang))}</div>
                      {fee > 0 && <div className="desc" style={{ color: '#f59e0b' }}>{lang === 'zh' ? '手续费' : 'Fee'}: {currency === 'USDT' ? formatUSDT(fee, lang) : (currency === 'USD' ? formatMoney(fee, 'USD', lang) : formatMoney(fee, 'PLN', lang))} (0.1%)</div>}
                      <div className="desc" style={{ color: unitProfit >= 0 ? '#5cff9b' : '#ff5c7a' }}>
                        {(lang === 'zh' ? '预计收益' : 'Est. Profit')}: {currency === 'USDT' ? formatUSDT(totalProfit || unitProfit, lang) : (currency === 'USD' ? formatMoney(totalProfit || unitProfit, 'USD', lang) : formatMoney(totalProfit || unitProfit, 'PLN', lang))} ({unitPct.toFixed(2)}%)
                      </div>
                    </div>
                    <div className="form admin-form-compact" style={{ marginTop: 4 }}>
                      <label className="label">{labels.subscribeKey}</label>
                      <input
                        className="input"
                        type="password"
                        autoComplete="off"
                        placeholder={lang === 'zh' ? '请输入认购密钥' : 'Enter subscription key'}
                        value={keyMap[it.id] || ''}
                        onChange={e => setKeyMap(p => ({ ...p, [it.id]: e.target.value }))}
                        style={{ WebkitTextSecurity: 'disc', maxWidth: 320 }}
                      />
                      <label className="label">{labels.qty}</label>
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#8aa0bd', marginBottom: 4 }}>
                          <span>{lang === 'zh' ? '可用余额' : (lang === 'pl' ? 'Saldo disponible' : 'Available Balance')}: {currency === 'USDT' ? formatUSDT(availableBalance, lang) : (currency === 'USD' ? formatMoney(availableBalance, 'USD', lang) : formatMoney(availableBalance, 'PLN', lang))}</span>
                          <span>100%</span>
                        </div>
                        <div style={{ 
                          width: '100%', 
                          height: 6, 
                          background: 'linear-gradient(90deg, #3b82f6, #60a5fa)', 
                          borderRadius: 3,
                          position: 'relative'
                        }}>
                          <div style={{
                            position: 'absolute',
                            right: -6,
                            top: -5,
                            width: 16,
                            height: 16,
                            background: '#3b82f6',
                            borderRadius: '50%',
                            border: '2px solid #fff'
                          }} />
                        </div>
                      </div>
                      <input 
                        className="input" 
                        type="number" 
                        readOnly
                        value={qtyMap[it.id] || 0} 
                        style={{ maxWidth: 240, background: 'rgba(255,255,255,0.05)', cursor: 'not-allowed' }} 
                      />
                      <div className="desc" style={{ marginTop: 4, fontSize: 11 }}>
                        {lang === 'zh' ? '默认使用全部可用资金购买' : (lang === 'pl' ? 'Domyślnie używa wszystkich dostępnych środków' : 'Uses all available funds by default')}
                      </div>
                      <div className="sub-actions" style={{ justifyContent: 'flex-end' }}>
                        {(() => {
                          const status = getTimeStatus(it);
                          if (status === 'not_started') {
                            return <button className="btn" disabled style={{ opacity: 0.5 }}>{labels.notStarted}</button>;
                          }
                          if (status === 'ended') {
                            return <button className="btn" disabled style={{ opacity: 0.5 }}>{labels.ended}</button>;
                          }
                          return (
                            <button className="btn primary" disabled={submittingId === it.id} onClick={() => submit(it)}>
                              {submittingId === it.id ? labels.submitting : labels.btnSubmit}
                            </button>
                          );
                        })()}
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
