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
  const [showHoldings, setShowHoldings] = useState(false);
  const [fundQty, setFundQty] = useState({}); // 每个基金的购买数量
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
      // 过滤掉已完成的订单（redeemed/done/completed/sold）
      const active = arr.filter(o => {
        const status = String(o.status || '').toLowerCase();
        return !['redeemed', 'done', 'completed', 'sold'].includes(status);
      });
      setOrders(active);
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
      setTimeout(() => setToast({ show: false, type: 'ok', text: '' }), 2000);
      // 重置该基金的数量
      setFundQty(prev => ({ ...prev, [fund.code]: 1 }));
      // 刷新订单列表
      fetchOrders();
    } catch (e) {
      setToast({ show: true, type: 'error', text: String(e?.message || e) });
      setTimeout(() => setToast({ show: false, type: 'error', text: '' }), 2000);
    } finally { setSubmitting(false); }
  };

  const redeem = async (order) => {
    try {
      const orderId = order?.id;
      await api.post('/me/fund/redeem', { orderId });
      setToast({ show: true, type: 'ok', text: lang==='es'?'Redención completada':'Redeemed successfully' });
      setTimeout(() => setToast({ show: false, type: 'ok', text: '' }), 1000);
      // 赎回后从列表中移除该订单
      setOrders(prev => prev.filter(it => it.id !== orderId));
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

  // 获取状态显示信息
  const getStatusInfo = (status, locked) => {
    if (status === 'rejected') return { text: lang === 'zh' ? '已拒绝' : 'Rejected', color: '#ef4444', bg: 'rgba(239,68,68,0.15)' };
    if (status === 'submitted' || status === 'pending') return { text: lang === 'zh' ? '待审核' : 'Pending', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' };
    if (status === 'redeemed' || status === 'done' || status === 'completed' || status === 'sold') return { text: lang === 'zh' ? '已完成' : 'Completed', color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)' };
    if (status === 'approved' && locked) return { text: lang === 'zh' ? '锁定中' : 'Locked', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' };
    if (status === 'approved') return { text: lang === 'zh' ? '可赎回' : 'Available', color: '#10b981', bg: 'rgba(16,185,129,0.15)' };
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
            {/* 弹窗标题 */}
            <div style={{
              padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center'
            }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#f1f5f9' }}>
                📊 {lang === 'zh' ? '我的基金持仓' : (lang === 'pl' ? 'Moje fundusze' : 'My Fund Holdings')}
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
                    const lockUntil = o.lockUntil || o.lock_until || o.lock_until_ts;
                    const ts = typeof lockUntil === 'number' ? lockUntil : Date.parse(lockUntil || '');
                    const forcedUnlocked = o.forced_unlocked || o.forcedUnlocked;
                    const locked = !forcedUnlocked && Number.isFinite(ts) && Date.now() < ts;
                    const status = String(o.status || 'submitted');
                    const statusInfo = getStatusInfo(status, locked);
                    const buyPrice = Number(o.price || 0);
                    const qtyVal = Number(o.qty || 1);
                    const fundInfo = list.find(f => f.code === o.code);
                    const marketPrice = Number(fundInfo?.marketPrice || fundInfo?.subscribePrice || buyPrice);
                    const profitAmount = (marketPrice - buyPrice) * qtyVal;
                    const profitPct = buyPrice > 0 ? ((marketPrice - buyPrice) / buyPrice * 100) : 0;
                    const totalBuy = buyPrice * qtyVal;
                    
                    return (
                      <div key={o.id} style={{
                        background: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 14,
                        border: '1px solid rgba(255,255,255,0.06)'
                      }}>
                        {/* 头部：代码 + 状态 */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 16, fontWeight: 600, color: '#f1f5f9' }}>{o.code}</span>
                            <span style={{
                              fontSize: 11, padding: '2px 8px', borderRadius: 10,
                              background: '#2a3b56', color: '#e5e7eb'
                            }}>×{qtyVal}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {locked && (
                              <span style={{
                                fontSize: 11, padding: '2px 8px', borderRadius: 10,
                                background: 'rgba(251,191,36,0.15)', color: '#fbbf24'
                              }}>🔒</span>
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
                            {lang === 'zh' ? '投资金额' : 'Investment'}: <span style={{ color: '#e5e7eb' }}>
                              {formatPlainMoney(totalBuy, String(o.currency || 'PLN'))}
                            </span>
                          </div>
                          <div style={{ color: '#94a3b8' }}>
                            {lang === 'zh' ? '单价' : 'Price'}: <span style={{ color: '#e5e7eb' }}>
                              {formatPlainMoney(buyPrice, String(o.currency || 'PLN'))}
                            </span>
                          </div>
                          <div style={{ color: '#94a3b8' }}>
                            {lang === 'zh' ? '收益' : 'Profit'}: <span style={{ color: profitAmount >= 0 ? '#10b981' : '#ef4444' }}>
                              {profitAmount >= 0 ? '+' : ''}{formatPlainMoney(profitAmount, String(o.currency || 'PLN'))}
                              ({profitPct >= 0 ? '+' : ''}{profitPct.toFixed(2)}%)
                            </span>
                          </div>
                          <div style={{ color: '#94a3b8' }}>
                            {lang === 'zh' ? '分红' : 'Dividend'}: <span style={{ color: '#22c55e' }}>
                              {Number(o.percent || fundInfo?.dividendPercent || 0).toFixed(1)}%
                            </span>
                          </div>
                        </div>
                        
                        {/* 操作按钮 */}
                        {status === 'approved' && !locked && (
                          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                            <button 
                              className="btn primary" 
                              style={{ width: '100%', padding: '8px 0', fontSize: 13, borderRadius: 8 }}
                              onClick={() => { redeem(o); setShowHoldings(false); }}
                            >
                              {lang === 'zh' ? '赎回' : 'Redeem'}
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
        <button
          onClick={() => { fetchOrders(); setShowHoldings(true); }}
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
                    
                    {/* 数量和订阅 */}
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{lang==='zh'?'数量':'Qty'}</div>
                        <input 
                          type="number" 
                          min="1" 
                          value={fundQty[f.code] || 1}
                          onChange={e => setFundQty(prev => ({ ...prev, [f.code]: Math.max(1, parseInt(e.target.value) || 1) }))}
                          style={{ 
                            width: '100%', padding: '8px 10px', borderRadius: 8, 
                            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                            color: '#fff', fontSize: 14, textAlign: 'center'
                          }}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{lang==='zh'?'总价':'Total'}</div>
                        <div style={{ padding: '8px 10px', borderRadius: 8, background: 'rgba(59,130,246,0.2)', textAlign: 'center', fontSize: 14, fontWeight: 600, color: '#3b82f6' }}>
                          {formatPlainMoney(Number(f.subscribePrice || f.price || 0) * (fundQty[f.code] || 1), String(f.currency||'PLN'))}
                        </div>
                      </div>
                    </div>
                    
                    {/* 订阅按钮 */}
                    <button 
                      className="btn primary" 
                      disabled={submitting} 
                      onClick={() => submitSubscribe(f, fundQty[f.code] || 1)}
                      style={{ width: '100%', padding: '10px 0', fontSize: 14, marginTop: 10 }}
                    >
                      {submitting ? '...' : (lang==='es'?'Suscribir':'Subscribe')}
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
