import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import BottomNav from "../../components/BottomNav.jsx";
import { useI18n } from "../../i18n.jsx";
import { api } from "../../services/api.js";
import { formatMoney, formatUSDT } from "../../utils/money.js";
import { formatMinute, getPolandTimestamp } from "../../utils/date.js";
import { getQuotes, getCryptoQuotes, getStockSpark, getUsdPlnRate } from "../../services/marketData.js";
import "../../styles/settings.css";

// 红利股页面
export default function DividendPage() {
  const nav = useNavigate();
  const { t, lang } = useI18n();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [quotes, setQuotes] = useState({});
  const [qtyMap, setQtyMap] = useState({});
  const [keyMap, setKeyMap] = useState({});
  const [balances, setBalances] = useState({ PLN: 0, USD: 0, USDT: 0, EUR: 0 });
  const [submittingId, setSubmittingId] = useState(null);
  const [toast, setToast] = useState({ show: false, type: 'ok', text: '' });
  const showToast = (text, type = 'ok') => { setToast({ show: true, type, text }); setTimeout(() => setToast({ show: false, type, text: '' }), 1500); };
  
  // 我的持仓弹窗状态
  const [showHoldings, setShowHoldings] = useState(false);
  const [holdings, setHoldings] = useState([]);
  const [holdingsLoading, setHoldingsLoading] = useState(false);

  const labels = useMemo(() => ({
    pageTitle: lang === 'zh' ? '红利股' : (lang === 'pl' ? 'Dividend Stocks' : 'Dividend Stocks'),
    type: lang === 'zh' ? '类型' : (lang === 'pl' ? 'Tipo' : 'Type'),
    typeCrypto: lang === 'zh' ? '加密货币' : (lang === 'pl' ? 'Krypto' : 'Crypto'),
    typeUS: lang === 'zh' ? '美股' : (lang === 'pl' ? 'Akcje USA' : 'US Stocks'),
    typePL: lang === 'zh' ? '波兰股' : (lang === 'pl' ? 'Akcje PL' : 'PL Stocks'),
    symbol: lang === 'zh' ? '编码' : (lang === 'pl' ? 'Código' : 'Symbol'),
    currentPrice: lang === 'zh' ? '现价' : (lang === 'pl' ? 'Precio actual' : 'Current Price'),
    stockPrice: lang === 'zh' ? '购买价格' : (lang === 'pl' ? 'Cena zakupu' : 'Buy Price'),
    minQty: lang === 'zh' ? '最小购买' : (lang === 'pl' ? 'Mínimo' : 'Min Qty'),
    maxQty: lang === 'zh' ? '最大购买' : (lang === 'pl' ? 'Máximo' : 'Max Qty'),
    qty: lang === 'zh' ? '购买数量' : (lang === 'pl' ? 'Cantidad' : 'Quantity'),
    subscribeKey: lang === 'zh' ? '认购密钥' : (lang === 'pl' ? 'Clave de suscripción' : 'Subscription Key'),
    window: lang === 'zh' ? '购买时间窗' : (lang === 'pl' ? 'Ventana de compra' : 'Buy Window'),
    btnSubmit: lang === 'zh' ? '购买' : (lang === 'pl' ? 'Comprar' : 'Buy'),
    submitting: lang === 'zh' ? '提交中...' : (lang === 'pl' ? 'Enviando...' : 'Submitting...'),
    consume: lang === 'zh' ? '消耗资金' : (lang === 'pl' ? 'Consumir fondos' : 'Consume'),
    notStarted: lang === 'zh' ? '未开始' : (lang === 'pl' ? 'No empezado' : 'Not Started'),
    ended: lang === 'zh' ? '已结束' : (lang === 'pl' ? 'Terminado' : 'Ended'),
    myHoldings: lang === 'zh' ? '我的持仓' : (lang === 'pl' ? 'Moje pozycje' : 'My Holdings'),
    pending: lang === 'zh' ? '待审核' : (lang === 'pl' ? 'Oczekujące' : 'Pending'),
    approved: lang === 'zh' ? '持有中' : (lang === 'pl' ? 'Posiadane' : 'Holding'),
    rejected: lang === 'zh' ? '已拒绝' : (lang === 'pl' ? 'Odrzucone' : 'Rejected'),
    sold: lang === 'zh' ? '已卖出' : (lang === 'pl' ? 'Sprzedane' : 'Sold'),
    locked: lang === 'zh' ? '锁定中' : (lang === 'pl' ? 'Zablokowane' : 'Locked'),
    unlocked: lang === 'zh' ? '可卖出' : (lang === 'pl' ? 'Dostępne' : 'Available'),
    noHoldings: lang === 'zh' ? '暂无持仓记录' : (lang === 'pl' ? 'Brak pozycji' : 'No holdings'),
    close: lang === 'zh' ? '关闭' : (lang === 'pl' ? 'Zamknij' : 'Close'),
    lockedNote: lang === 'zh' ? '红利股购买后锁定，需等待后台解锁才能出售' : (lang === 'pl' ? 'Locked until admin unlocks' : 'Locked until admin unlocks'),
    sellBtn: lang === 'zh' ? '卖出' : (lang === 'pl' ? 'Sprzedaj' : 'Sell'),
    completed: lang === 'zh' ? '已完成' : (lang === 'pl' ? 'Zakończone' : 'Completed'),
  }), [lang]);

  useEffect(() => {
    fetchList();
    fetchBalances();
  }, []);

  // 获取我的持仓记录
  async function fetchHoldings() {
    try {
      setHoldingsLoading(true);
      const res = await api.get('/me/trade/dividend/orders');
      const arr = Array.isArray(res?.items) ? res.items : [];
      // 过滤掉已完成的订单（done/sold/completed）
      const active = arr.filter(o => {
        const status = String(o.status || '').toLowerCase();
        return !['done', 'sold', 'completed'].includes(status);
      });
      setHoldings(active);
    } catch (e) {
      console.warn('fetch holdings failed', e);
      setHoldings([]);
    } finally {
      setHoldingsLoading(false);
    }
  }

  const openHoldings = () => {
    setShowHoldings(true);
    fetchHoldings();
  };

  async function fetchBalances() {
    try {
      const res = await api.get('/me/balances');
      const arr = Array.isArray(res?.balances) ? res.balances : [];
      const map = { PLN: 0, USD: 0, USDT: 0, EUR: 0 };
      arr.forEach(b => { map[String(b.currency).toUpperCase()] = Number(b.amount || 0); });
      setBalances(map);
    } catch (e) { console.warn('fetch balances failed', e); }
  }

  function toCryptoBase(s) {
    const u = String(s || '').toUpperCase();
    return u.replace(/USDT$/i, '').replace(/\/USDT$/i, '').replace(/\/USD$/i, '');
  }

  async function fetchList() {
    try {
      setLoading(true);
      const data = await api.get('/trade/dividend/list');
      const arr = Array.isArray(data?.items) ? data.items : [];
      const active = arr.filter(it => String(it.status || 'active') === 'active');
      setItems(active);
    } catch (e) {
      console.warn('fetch dividend list failed', e);
      setItems([]);
    } finally { setLoading(false); }
  }

  // 行情刷新
  useEffect(() => {
    let stopped = false;
    async function refreshQuotes() {
      const cryptoSymbols = items.filter(it => it.market === 'crypto').map(it => toCryptoBase(it.symbol));
      const usSymbols = items.filter(it => it.market === 'us').map(it => String(it.symbol).toUpperCase());
      const next = {};
      try {
        if (cryptoSymbols.length) {
          const q = await getCryptoQuotes({ symbols: cryptoSymbols });
          for (const r of q) {
            next[`crypto:${r.symbol}`] = { price: Number(r.priceUSD || r.price || 0), changePct: Number(r.changePct || 0) };
          }
        }
      } catch { }
      try {
        if (usSymbols.length) {
          const q = await getQuotes({ market: 'us', symbols: usSymbols });
          for (const r of q) {
            next[`us:${r.symbol}`] = { price: Number(r.price || 0), changePct: Number(r.changePct || 0) };
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
  
  function getTimeStatus(it) {
    const s = getPolandTimestamp(it.start_at || it.startAt || '');
    const e = getPolandTimestamp(it.end_at || it.endAt || '');
    const n = nowMs();
    if (!Number.isFinite(s) || !Number.isFinite(e)) return 'open'; // 无时间限制则默认开放
    if (n < s) return 'not_started';
    if (n > e) return 'ended';
    return 'open';
  }

  const getMarketCurrency = (market) => {
    if (market === 'crypto') return { currency: 'USDT', balance: balances.USDT || 0 };
    if (market === 'us') return { currency: 'USD', balance: balances.USD || 0 };
    if (market === 'pl') return { currency: 'PLN', balance: balances.PLN || 0 };
    return { currency: 'PLN', balance: balances.PLN || 0 };
  };

  async function submit(it) {
    const id = Number(it.id);
    const q = Number(qtyMap[id] || 0);
    const minQ = Number(it.min_qty || it.minQty || 1);
    const maxQ = Number(it.max_qty || it.maxQty || 0);
    const key = String(keyMap[id] || '').trim();
    
    if (!q || !Number.isFinite(q) || q < minQ) { 
      alert(lang === 'zh' ? '数量不合法或低于最小购买' : 'Invalid qty or below minimum'); 
      return; 
    }
    if (maxQ && q > maxQ) {
      alert(lang === 'zh' ? '数量超过最大限制' : 'Qty exceeds maximum');
      return;
    }
    if (it.subscribe_key && !key) { 
      alert(lang === 'zh' ? '请输入认购密钥' : 'Enter subscription key'); 
      return; 
    }
    
    try {
      setSubmittingId(id);
      await api.post('/trade/dividend/subscribe', { stockId: id, qty: q, key });
      showToast(lang === 'zh' ? '已提交购买申请，待后台审核' : 'Purchase submitted, pending approval', 'ok');
      setQtyMap(prev => ({ ...prev, [id]: '' }));
      setKeyMap(prev => ({ ...prev, [id]: '' }));
    } catch (e) {
      const msg = (e && (e.message || (e.response && (e.response.data?.error || e.response.data?.message)))) || String(e);
      alert((lang === 'zh' ? '购买失败: ' : 'Purchase failed: ') + msg);
    } finally { setSubmittingId(null); }
  }

  // 卖出功能
  async function sellOrder(o) {
    if (o.locked) {
      alert(lang === 'zh' ? '该红利股尚未解锁，无法卖出' : 'This stock is still locked');
      return;
    }
    const sellPrice = prompt(lang === 'zh' ? '请输入卖出价格:' : 'Enter sell price:');
    if (!sellPrice) return;
    const sp = Number(sellPrice);
    if (!Number.isFinite(sp) || sp <= 0) {
      alert(lang === 'zh' ? '请输入有效价格' : 'Invalid price');
      return;
    }
    try {
      await api.post(`/me/trade/dividend/orders/${o.id}/sell`, { sellPrice: sp });
      showToast(lang === 'zh' ? '卖出成功' : 'Sold successfully', 'ok');
      fetchHoldings();
    } catch (e) {
      alert((lang === 'zh' ? '卖出失败: ' : 'Sell failed: ') + (e?.message || e));
    }
  }

  // 获取状态显示
  const getStatusInfo = (status, locked) => {
    if (status === 'sold' || status === 'done' || status === 'completed') return { text: labels.completed, color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)' };
    if (status === 'rejected') return { text: labels.rejected, color: '#ef4444', bg: 'rgba(239,68,68,0.15)' };
    if (status === 'pending') return { text: labels.pending, color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' };
    if (status === 'approved') {
      if (locked) return { text: labels.locked, color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' };
      return { text: labels.unlocked, color: '#10b981', bg: 'rgba(16,185,129,0.15)' };
    }
    return { text: status, color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' };
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
            <div style={{
              padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center'
            }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#f1f5f9' }}>
                🎁 {labels.myHoldings}
              </h3>
              <button onClick={() => setShowHoldings(false)} style={{
                background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 8,
                padding: '6px 12px', cursor: 'pointer', color: '#94a3b8', fontSize: 13
              }}>{labels.close}</button>
            </div>
            
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
                    const statusInfo = getStatusInfo(h.status, h.locked);
                    const market = String(h.market || '');
                    const { currency } = getMarketCurrency(market);
                    const canSell = h.status === 'approved' && !h.locked;
                    return (
                      <div key={h.id} style={{
                        background: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 14,
                        border: '1px solid rgba(255,255,255,0.06)'
                      }}>
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
                            {h.locked && h.status === 'approved' && (
                              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'rgba(251,191,36,0.15)', color: '#fbbf24' }}>🔒</span>
                            )}
                            <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 10, background: statusInfo.bg, color: statusInfo.color }}>{statusInfo.text}</span>
                          </div>
                        </div>
                        
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
                          <div style={{ color: '#94a3b8' }}>
                            {labels.qty}: <span style={{ color: '#e5e7eb' }}>{h.qty}</span>
                          </div>
                          <div style={{ color: '#94a3b8' }}>
                            {labels.stockPrice}: <span style={{ color: '#e5e7eb' }}>
                              {currency === 'USDT' ? formatUSDT(h.price, lang) : (currency === 'USD' ? formatMoney(h.price, 'USD', lang) : formatMoney(h.price, 'PLN', lang))}
                            </span>
                          </div>
                          <div style={{ color: '#94a3b8' }}>
                            {lang === 'zh' ? '总金额' : 'Total'}: <span style={{ color: '#e5e7eb' }}>
                              {currency === 'USDT' ? formatUSDT(h.amount, lang) : (currency === 'USD' ? formatMoney(h.amount, 'USD', lang) : formatMoney(h.amount, 'PLN', lang))}
                            </span>
                          </div>
                          {h.profit !== undefined && h.profit !== null && (
                            <div style={{ color: '#94a3b8' }}>
                              {lang === 'zh' ? '收益' : 'Profit'}: <span style={{ color: Number(h.profit) >= 0 ? '#10b981' : '#ef4444' }}>
                                {Number(h.profit) >= 0 ? '+' : ''}{currency === 'USDT' ? formatUSDT(h.profit, lang) : (currency === 'USD' ? formatMoney(h.profit, 'USD', lang) : formatMoney(h.profit, 'PLN', lang))}
                                {h.profit_pct !== undefined && h.profit_pct !== null && ` (${Number(h.profit_pct) >= 0 ? '+' : ''}${Number(h.profit_pct).toFixed(2)}%)`}
                              </span>
                            </div>
                          )}
                        </div>
                        
                        {/* 时间信息 */}
                        <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
                          {h.submitted_at && <div>{lang === 'zh' ? '购买时间' : 'Buy Time'}: {formatMinute(h.submitted_at)}</div>}
                          {h.approved_at && <div>{lang === 'zh' ? '审核时间' : 'Approved'}: {formatMinute(h.approved_at)}</div>}
                          {h.sold_at && <div>{lang === 'zh' ? '卖出时间' : 'Sold'}: {formatMinute(h.sold_at)}</div>}
                        </div>
                        
                        {h.status === 'approved' && h.locked && (
                          <div style={{ marginTop: 10, padding: 8, background: 'rgba(251,191,36,0.1)', borderRadius: 8, fontSize: 12, color: '#fbbf24' }}>
                            🔒 {labels.lockedNote}
                          </div>
                        )}
                        
                        {canSell && (
                          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                            <button 
                              className="btn primary" 
                              style={{ width: '100%', padding: '8px 0', fontSize: 13, borderRadius: 8 }}
                              onClick={() => sellOrder(h)}
                            >
                              {labels.sellBtn}
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
            background: 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none',
            borderRadius: 20, padding: '8px 16px', cursor: 'pointer', color: '#fff', fontSize: 13, fontWeight: 500,
            boxShadow: '0 2px 8px rgba(245, 158, 11, 0.3)'
          }}
        >
          <span style={{ fontSize: 14 }}>🎁</span>
          <span>{labels.myHoldings}</span>
        </button>
      </div>

      <div className="inst-container">
        <div>
          <h1 className="title" style={{ marginTop: 0, marginBottom: 8 }}>{labels.pageTitle}</h1>
          <div className="desc" style={{ color: '#f59e0b' }}>{lang === 'zh' ? '红利股购买后锁定，需等待后台解锁才能出售' : 'Dividend stocks are locked after purchase until admin unlocks'}</div>
        </div>

        <div className="inst-card">
          {loading && (<div className="desc">{lang === 'zh' ? '加载中...' : 'Loading...'}</div>)}
          {!loading && items.length === 0 && (<div className="desc">{lang === 'zh' ? '暂无红利股' : 'No dividend stocks available'}</div>)}
          {!loading && items.length > 0 && (
            <div style={{ display: 'grid', gap: 12 }}>
              {items.filter(it => getTimeStatus(it) !== 'ended').map(it => {
                const market = String(it.market);
                const symbol = String(it.symbol).toUpperCase();
                const baseSymbol = market === 'crypto' ? toCryptoBase(symbol) : symbol;
                const stockPrice = Number(it.price || 0);
                const minQty = Number(it.min_qty || it.minQty || 1);
                const maxQty = Number(it.max_qty || it.maxQty || 0);
                const qk = `${market}:${baseSymbol}`;
                const quote = quotes[qk];
                const currentPrice = Number(quote?.price || 0) || stockPrice;
                const { currency, balance: availableBalance } = getMarketCurrency(market);
                const qty = Number(qtyMap[it.id] || 0);
                const total = stockPrice * qty;
                const fee = Number((total * 0.001).toFixed(6)); // 手续费：千分之一
                const totalWithFee = total + fee;
                const timeStatus = getTimeStatus(it);
                const hasKey = !!it.subscribe_key;
                
                return (
                  <div key={it.id} className="card" style={{ display: 'grid', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 16 }}>{it.name || baseSymbol}</div>
                        <div style={{ fontSize: 12, color: '#8aa0bd' }}>{labels.symbol}: {baseSymbol}</div>
                      </div>
                      <div className="tag" style={{ background: market === 'crypto' ? '#2a3b56' : (market === 'pl' ? '#3b2a56' : '#2a5640') }}>
                        {market === 'crypto' ? labels.typeCrypto : (market === 'pl' ? labels.typePL : labels.typeUS)}
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div className="desc">{labels.currentPrice}: {currency === 'USDT' ? formatUSDT(currentPrice, lang) : (currency === 'USD' ? formatMoney(currentPrice, 'USD', lang) : formatMoney(currentPrice, 'PLN', lang))}</div>
                      <div className="desc">{labels.stockPrice}: {currency === 'USDT' ? formatUSDT(stockPrice, lang) : (currency === 'USD' ? formatMoney(stockPrice, 'USD', lang) : formatMoney(stockPrice, 'PLN', lang))}</div>
                      <div className="desc">{labels.minQty}: {minQty}</div>
                      {maxQty > 0 && <div className="desc">{labels.maxQty}: {maxQty}</div>}
                      {(it.start_at || it.end_at) && (
                        <div className="desc">{labels.window}: {it.start_at ? formatMinute(it.start_at) : '-'} ~ {it.end_at ? formatMinute(it.end_at) : '-'}</div>
                      )}
                      <div className="desc">{labels.consume}: {currency === 'USDT' ? formatUSDT(totalWithFee, lang) : (currency === 'USD' ? formatMoney(totalWithFee, 'USD', lang) : formatMoney(totalWithFee, 'PLN', lang))}</div>
                      {fee > 0 && <div className="desc" style={{ color: '#f59e0b' }}>{lang === 'zh' ? '手续费' : 'Fee'}: {currency === 'USDT' ? formatUSDT(fee, lang) : (currency === 'USD' ? formatMoney(fee, 'USD', lang) : formatMoney(fee, 'PLN', lang))} (0.1%)</div>}
                    </div>
                    <div className="form admin-form-compact" style={{ marginTop: 4 }}>
                      {hasKey && (
                        <>
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
                        </>
                      )}
                      <label className="label">{labels.qty}</label>
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#8aa0bd', marginBottom: 4 }}>
                          <span>{lang === 'zh' ? '可用余额' : 'Available'}: {currency === 'USDT' ? formatUSDT(availableBalance, lang) : (currency === 'USD' ? formatMoney(availableBalance, 'USD', lang) : formatMoney(availableBalance, 'PLN', lang))}</span>
                        </div>
                      </div>
                      <input 
                        className="input" 
                        type="number" 
                        min={minQty}
                        max={maxQty || undefined}
                        placeholder={`${minQty}${maxQty ? ' ~ ' + maxQty : '+'}`}
                        value={qtyMap[it.id] || ''} 
                        onChange={e => setQtyMap(p => ({ ...p, [it.id]: e.target.value }))}
                        style={{ maxWidth: 240 }} 
                      />
                      <div className="sub-actions" style={{ justifyContent: 'flex-end' }}>
                        {(() => {
                          if (timeStatus === 'not_started') {
                            return <button className="btn" disabled style={{ opacity: 0.5 }}>{labels.notStarted}</button>;
                          }
                          if (timeStatus === 'ended') {
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
