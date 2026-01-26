import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import BottomNav from "../../components/BottomNav.jsx";
import { useI18n } from "../../i18n.jsx";
import { api, notificationsApi } from "../../services/api.js";
import { formatMoney } from "../../utils/money.js";
import { formatMinute } from "../../utils/date.js";
import "../../styles/profile.css";

export default function FundsPage() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [list, setList] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [orders, setOrders] = useState([]);
  const [toast, setToast] = useState({ show: false, type: 'info', text: '' });
  const [modalOpen, setModalOpen] = useState(false);
  const [modalFund, setModalFund] = useState(null);
  const [qty, setQty] = useState(1);
  const dividendLabel = (d) => {
    const v = String(d || '').toLowerCase();
    if (lang === 'pl') {
      if (v === 'day') return 'diaria';
      if (v === 'week') return 'semanal';
      if (v === 'month') return 'mensual';
      return v || '-';
    }
    if (v === 'day') return 'daily';
    if (v === 'week') return 'weekly';
    if (v === 'month') return 'monthly';
    return v || '-';
  };

  const currencySymbol = (cur) => {
    const c = String(cur || 'PLN').toUpperCase();
    return c === 'PLN' ? 'zł' : '$';
  };
  const formatPlainMoney = (v, cur) => {
    const num = Number(v || 0);
    const sym = currencySymbol(cur);
    return `${sym} ${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  useEffect(() => {
    const fetchList = async () => {
      try {
        setLoading(true); setError("");
        const data = await api.get('/me/funds');
        const arr = Array.isArray(data?.items) ? data.items : [];
        setList(arr);
      } catch (e) {
        setError(String(e?.message || 'Failed'));
      } finally { setLoading(false); }
    };
    fetchList();
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    try {
      const data = await api.get('/me/fund/orders');
      const arr = Array.isArray(data?.items)
        ? data.items
        : (Array.isArray(data?.orders)
          ? data.orders
          : (Array.isArray(data) ? data : []));
      setOrders(arr);
    } catch {}
  };

  const submitSubscribe = async (fund, quantity) => {
    try {
      setSubmitting(true);
      const price = Number(fund.subscribePrice || fund.price || 0);
      const qtyNum = Math.max(1, Math.floor(Number(quantity) || 1));
      await api.post('/me/fund/subscribe', { code: fund.code, price, qty: qtyNum });
      // 本地通知兜底
      try {
        const uid = (() => { try { const s = JSON.parse(localStorage.getItem('sessionUser')||'null'); return s?.id || s?.phone || 'guest'; } catch { return 'guest'; } })();
        const totalAmount = price * qtyNum;
        notificationsApi.add(uid, { title: (lang==='es'?'Solicitud de suscripción':'Subscription requested'), body: `${fund.code} x${qtyNum} @ ${totalAmount}` });
      } catch {}
      setToast({ show: true, type: 'ok', text: lang==='es'?'Solicitud enviada':'Request submitted' });
      setTimeout(() => setToast({ show: false, type: 'ok', text: '' }), 1200);
      setModalOpen(false); setModalFund(null); setQty(1);
      // 刷新订单列表
      fetchOrders();
    } catch (e) {
      setToast({ show: true, type: 'error', text: String(e?.message || e) });
      setTimeout(() => setToast({ show: false, type: 'error', text: '' }), 1200);
    } finally { setSubmitting(false); }
  };

  const redeem = async (order) => {
    try {
      const orderId = order?.id;
      await api.post('/me/fund/redeem', { orderId });
      setToast({ show: true, type: 'ok', text: lang==='es'?'Redención completada':'Redeemed successfully' });
      setTimeout(() => setToast({ show: false, type: 'ok', text: '' }), 1000);
      setOrders(prev => prev.map(it => it.id === orderId ? { ...it, status: 'redeemed', lock_until_ts: Date.now(), lock_until: new Date().toISOString() } : it));
      try {
        const uid = (() => { try { const s = JSON.parse(localStorage.getItem('sessionUser')||'null'); return s?.id || s?.phone || 'guest'; } catch { return 'guest'; } })();
        notificationsApi.add(uid, { title: (lang==='es'?'Redención':'Redeem'), body: `${order.code} ${currencySymbol(order.currency)} ${Number(order.price||0).toFixed(2)}` });
      } catch {}
    } catch (e) {
      const msg = String(e?.message || e);
      setToast({ show: true, type: 'error', text: msg==='locked' ? (lang==='es'?'Aún en período de bloqueo':'Still in lock period') : msg });
      setTimeout(() => setToast({ show: false, type: 'error', text: '' }), 1000);
    }
  };

  return (
    <div className="screen top-align inst-screen" style={{ padding: 0 }}>
      {toast.show && (<div className={`top-toast ${toast.type}`}>{toast.text}</div>)}
      {/* 返回按钮 */}
      <div className="inst-back-bar">
        <button
          onClick={()=>navigate(-1)}
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
        <div style={{ width: '100%' }}>
          <h1 className="title" style={{ marginTop: 0, marginBottom: 8 }}>{lang==='zh'?'基金':(lang==='pl'?'Fundusze':'Funds')}</h1>
          {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
          {loading ? (
            <div className="desc">Loading...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 10 }}>
              {list.map(f => {
                const dividendText = f.dividend === 'day' ? (lang==='es'?'Diario':'Daily') 
                  : f.dividend === 'week' ? (lang==='es'?'Semanal':'Weekly') 
                  : f.dividend === 'month' ? (lang==='es'?'Mensual':'Monthly') : f.dividend;
                return (
                  <div key={f.code} style={{ 
                    background: 'var(--card-bg)', 
                    border: '1px solid var(--card-border)', 
                    borderRadius: 'var(--radius)', 
                    padding: 14,
                    boxShadow: 'var(--shadow-light)'
                  }}>
                    {/* 头部：代码 + 名称 */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>
                          {lang==='es' ? (f.nameEs || f.name || f.code) : (f.nameEn || f.name || f.code)}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{f.code}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{lang==='es'?'Precio':'Price'}</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent)' }}>
                          {formatPlainMoney(Number(f.subscribePrice || f.price || 0), String(f.currency||'PLN'))}
                        </div>
                      </div>
                    </div>
                    
                    {/* 信息行 */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12, background: 'rgba(59, 130, 246, 0.15)', padding: 10, borderRadius: 8 }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{lang==='es'?'Distribución':'Distribution'}</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#22c55e' }}>{Number(f.dividendPercent || 0).toFixed(1)}%</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{lang==='es'?'Frecuencia':'Frequency'}</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#e5e7eb' }}>{dividendText}</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{lang==='es'?'Bloqueo':'Lock'}</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#e5e7eb' }}>{f.redeemDays || f.redeem_days || 7}d</div>
                      </div>
                    </div>
                    
                    {/* 订阅按钮 */}
                    <button 
                      className="btn primary" 
                      disabled={submitting} 
                      onClick={() => { setModalFund(f); setModalOpen(true); }}
                      style={{ width: '100%', padding: '10px 0', fontSize: 14 }}
                    >
                      {lang==='es'?'Suscribir':'Subscribe'}
                    </button>
                  </div>
                );
              })}
              {list.length === 0 && (
                <div style={{ textAlign: 'center', padding: 20, color: 'var(--muted)' }}>--</div>
              )}
            </div>
          )}
        </div>
      {modalOpen && modalFund && (
        <div className="modal">
          <div className="modal-card">
            <h2 className="title" style={{ marginTop: 0 }}>{lang==='es' ? (modalFund.nameEs || modalFund.name || modalFund.code) : (modalFund.nameEn || modalFund.name || modalFund.code)}</h2>
            <div className="desc" style={{ display:'flex', justifyContent:'space-between', gap:10, marginTop:4 }}>
              <span className="muted">{lang==='es'?'Código':'Code'}: {modalFund.code}</span>
              <span className="muted">{lang==='es'?'Moneda':'Currency'}: {currencySymbol(modalFund.currency)}</span>
            </div>
            <div className="desc" style={{ whiteSpace:'pre-wrap', marginTop: 8 }}>{lang==='es' ? (modalFund.descEs || '') : (modalFund.descEn || '')}</div>
            <div className="form" style={{ marginTop: 12 }}>
              <div style={{ display: 'grid', gap: 8, background: 'var(--accent-light)', padding: 12, borderRadius: 'var(--radius)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="muted">{lang==='es'?'Precio unitario':'Unit Price'}</span>
                  <span style={{ fontWeight: 600 }}>{formatPlainMoney(Number(modalFund.subscribePrice || modalFund.price || 0), String(modalFund.currency||'PLN'))}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="muted">{lang==='es'?'Distribución':'Distribution'}</span>
                  <span style={{ fontWeight: 600, color: 'var(--success)' }}>{Number(modalFund.dividendPercent || 0).toFixed(2)}%</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="muted">{lang==='es'?'Frecuencia':'Frequency'}</span>
                  <span style={{ fontWeight: 600 }}>{dividendLabel(modalFund.dividend)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="muted">{lang==='es'?'Período de bloqueo':'Lock Period'}</span>
                  <span style={{ fontWeight: 600 }}>{modalFund.redeemDays || modalFund.redeem_days || 7} {lang==='es'?'días':'days'}</span>
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <label className="label">{lang==='es'?'Cantidad de acciones':'Number of shares'}</label>
                <input 
                  className="input" 
                  type="number" 
                  min="1" 
                  value={qty} 
                  onChange={e => setQty(Math.max(1, parseInt(e.target.value) || 1))}
                  style={{ width: '100%' }}
                />
              </div>
              <div style={{ marginTop: 10, padding: 10, background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--card-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="muted">{lang==='es'?'Total a pagar':'Total to pay'}</span>
                  <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)' }}>
                    {formatPlainMoney(Number(modalFund.subscribePrice || modalFund.price || 0) * qty, String(modalFund.currency||'PLN'))}
                  </span>
                </div>
              </div>
              <div className="sub-actions" style={{ justifyContent:'flex-end', gap:10, marginTop:14 }}>
                <button className="btn" onClick={()=>{ setModalOpen(false); setModalFund(null); setQty(1); }}>{lang==='es'?'Cancelar':'Cancel'}</button>
                <button className="btn primary" disabled={submitting || qty < 1} onClick={()=> submitSubscribe(modalFund, qty)}>{lang==='es'?'Confirmar suscripción':'Confirm Subscribe'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
        <div style={{ marginTop: 16, width: '100%' }}>
          <h2 className="title" style={{ marginTop: 0 }}>{lang==='es'?'Órdenes de fondos':'Fund Orders'}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 10 }}>
            {(orders || []).map(o => {
              const lockUntil = o.lockUntil || o.lock_until || o.lock_until_ts;
              const ts = typeof lockUntil === 'number' ? lockUntil : Date.parse(lockUntil || '');
              const forcedUnlocked = o.forced_unlocked || o.forcedUnlocked;
              // 如果强制解锁则不锁定，否则检查时间
              const locked = !forcedUnlocked && Number.isFinite(ts) && Date.now() < ts;
              const status = String(o.status || 'submitted');
              const daysLeft = Number.isFinite(ts) ? Math.max(0, Math.ceil((ts - Date.now()) / 86400000)) : null;
              const buyPrice = Number(o.price || 0);
              const qty = Number(o.qty || 1);
              const fundInfo = list.find(f => f.code === o.code);
              const marketPrice = Number(fundInfo?.marketPrice || fundInfo?.subscribePrice || buyPrice);
              const profitAmount = (marketPrice - buyPrice) * qty;
              const profitPct = buyPrice > 0 ? ((marketPrice - buyPrice) / buyPrice * 100).toFixed(2) : 0;
              const profitColor = Number(profitPct) >= 0 ? '#22c55e' : '#ef4444';
              const totalBuy = buyPrice * qty;
              const currentTotal = marketPrice * qty;
              
              const formatTimeLeft = () => {
                if (!Number.isFinite(ts)) return '';
                const diff = ts - Date.now();
                if (diff <= 0) return '';
                const days = Math.floor(diff / 86400000);
                const hours = Math.floor((diff % 86400000) / 3600000);
                const mins = Math.floor((diff % 3600000) / 60000);
                if (days > 0) return lang === 'pl' ? `Quedan ${days}d ${hours}h` : `${days}d ${hours}h left`;
                if (hours > 0) return lang === 'pl' ? `Quedan ${hours}h ${mins}m` : `${hours}h ${mins}m left`;
                return lang === 'pl' ? `Quedan ${mins}m` : `${mins}m left`;
              };
              
              return (
                <div key={o.id} style={{ 
                  background: 'var(--card-bg)', 
                  border: '1px solid var(--card-border)', 
                  borderRadius: 'var(--radius)', 
                  padding: 14,
                  boxShadow: 'var(--shadow-light)'
                }}>
                  {/* 头部：代码 + 状态 */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>{o.code}</span>
                      <span style={{ fontSize: 12, color: 'var(--muted)', background: 'var(--primary-light)', padding: '2px 8px', borderRadius: 4 }}>
                        ×{qty}
                      </span>
                    </div>
                    {status === 'rejected' ? (
                      <span style={{ fontSize: 12, color: '#ef4444', fontWeight: 600, background: '#fee2e2', padding: '4px 10px', borderRadius: 6 }}>
                        {lang==='es'?'Rechazado':'Rejected'}
                      </span>
                    ) : status === 'submitted' ? (
                      <span style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600, background: '#fef3c7', padding: '4px 10px', borderRadius: 6 }}>
                        {lang==='es'?'Pendiente':'Pending'}
                      </span>
                    ) : status === 'approved' && locked ? (
                      <span style={{ fontSize: 12, color: '#f59e0b', fontWeight: 500 }}>
                        {daysLeft != null ? `${daysLeft}d` : '-'}
                      </span>
                    ) : status === 'approved' ? (
                      <span style={{ fontSize: 12, color: '#22c55e', fontWeight: 600 }}>
                        {lang==='es'?'Disponible':'Available'}
                      </span>
                    ) : status === 'redeemed' ? (
                      <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 600, background: '#e5e7eb', padding: '4px 10px', borderRadius: 6 }}>
                        {lang==='es'?'Vendido':'Sold'}
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600, background: '#fef3c7', padding: '4px 10px', borderRadius: 6 }}>
                        {lang==='es'?'Pendiente':'Pending'}
                      </span>
                    )}
                  </div>
                  
                  {/* 金额信息 */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>{lang==='es'?'Inversión':'Investment'}</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{formatPlainMoney(totalBuy, String(o.currency||'PLN'))}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>{lang==='es'?'Valor Actual':'Current Value'}</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{formatPlainMoney(currentTotal, String(o.currency||'PLN'))}</div>
                    </div>
                  </div>
                  
                  {/* 获利 + 操作按钮 */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, borderTop: '1px solid var(--card-border)' }}>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{lang==='es'?'Ganancia':'Profit'}</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: profitColor }}>
                        {Number(profitPct) >= 0 ? '+' : ''}{formatPlainMoney(profitAmount, String(o.currency||'PLN'))}
                        <span style={{ fontSize: 12, marginLeft: 4 }}>({Number(profitPct) >= 0 ? '+' : ''}{profitPct}%)</span>
                      </div>
                    </div>
                    {status !== 'approved' ? null : locked ? (
                      <button className="btn" style={{ fontSize: 13, padding: '8px 16px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 8 }} onClick={() => {
                        setToast({ show: true, type: 'info', text: formatTimeLeft() });
                        setTimeout(() => setToast({ show: false, type: 'info', text: '' }), 3000);
                      }}>{lang==='es'?'Bloqueado':'Locked'}</button>
                    ) : (
                      <button className="btn primary" style={{ fontSize: 13, padding: '8px 20px', borderRadius: 8 }} onClick={() => redeem(o)}>
                        {lang==='es'?'Vender':'Sell'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {(orders || []).length === 0 && (
              <div style={{ textAlign: 'center', padding: 20, color: 'var(--muted)' }}>--</div>
            )}
          </div>
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
