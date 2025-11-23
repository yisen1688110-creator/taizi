import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../../i18n.jsx";
import { api, notificationsApi } from "../../services/api.js";
import { formatMoney } from "../../utils/money.js";
import { formatMinute } from "../../utils/date.js";

export default function FundsPage() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [list, setList] = useState([]);
  const [dist, setDist] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [orders, setOrders] = useState([]);
  const [toast, setToast] = useState({ show: false, type: 'info', text: '' });
  const [modalOpen, setModalOpen] = useState(false);
  const [modalFund, setModalFund] = useState(null);
  const [selectedTier, setSelectedTier] = useState(null);
  const dividendLabel = (d) => {
    const v = String(d || '').toLowerCase();
    if (lang === 'es') {
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
    const c = String(cur || 'MXN').toUpperCase();
    return c === 'MXN' ? 'MX$' : '$';
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
    (async () => {
      try {
        const data = await api.get('/me/fund/orders');
        const arr = Array.isArray(data?.items)
          ? data.items
          : (Array.isArray(data?.orders)
            ? data.orders
            : (Array.isArray(data) ? data : []));
        setOrders(arr);
      } catch {}
    })();
  }, []);

  const showDist = (code, p) => {
    setDist(prev => ({ ...prev, [code]: Number(p || 0) }));
  };

  const submitSubscribe = async (code, price) => {
    try {
      setSubmitting(true);
      await api.post('/me/fund/subscribe', { code, price });
      // 本地通知兜底
      try {
        const uid = (() => { try { const s = JSON.parse(localStorage.getItem('sessionUser')||'null'); return s?.id || s?.phone || 'guest'; } catch { return 'guest'; } })();
        notificationsApi.add(uid, { title: (lang==='es'?'Solicitud de suscripción':'Subscription requested'), body: `${code} @ ${price}` });
      } catch {}
      setToast({ show: true, type: 'ok', text: lang==='es'?'Solicitud enviada':'Request submitted' });
      setTimeout(() => setToast({ show: false, type: 'ok', text: '' }), 1200);
      setModalOpen(false); setModalFund(null); setSelectedTier(null);
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
    <div className="screen top-align">
      <button className="back-btn" onClick={()=>navigate(-1)} aria-label="back"><span className="back-icon"></span></button>
      {toast.show && (<div className={`top-toast ${toast.type}`}>{toast.text}</div>)}
      <div className="card">
        <h1 className="title" style={{ marginTop: 0 }}>{lang==='es'?'Fondos':'Funds'}</h1>
        {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
        {loading ? (
          <div className="desc">Loading...</div>
        ) : (
          <table className="data-table" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>{lang==='es'?'Código':'Code'}</th>
                <th>{lang==='es'?'Nombre':'Name'}</th>
                <th>{lang==='es'?'Precio':'Price'}</th>
                <th>{lang==='es'?'Acción':'Action'}</th>
              </tr>
            </thead>
            <tbody>
              {list.map(f => (
                <tr key={f.code}>
                  <td>{f.code}</td>
                  <td>{lang==='es' ? (f.nameEs || f.name || f.code) : (f.nameEn || f.name || f.code)}</td>
                  <td>{formatMoney(Number(f.price || 0), String(f.currency||'MXN'), lang)}</td>
                  <td>
                    <button className="btn primary" disabled={submitting} onClick={() => { setModalFund(f); setSelectedTier(null); setModalOpen(true); }}>{lang==='es'?'Suscribir':'Subscribe'}</button>
                  </td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr><td className="desc" colSpan={4}>--</td></tr>
              )}
            </tbody>
          </table>
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
            <div className="desc" style={{ whiteSpace:'pre-wrap' }}>{lang==='es' ? (modalFund.descEs || '') : (modalFund.descEn || '')}</div>
            <div className="form" style={{ marginTop: 10 }}>
              <div className="label">{lang==='es'?'Seleccione precio':'Select price'}</div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                {(() => {
                  const tiers = Array.isArray(modalFund.tiers) && modalFund.tiers.length === 4
                    ? modalFund.tiers
                    : [
                        { price: Number(modalFund.price || 0), percent: Number(modalFund.p1 || 0) },
                        { price: Number(modalFund.price2 || modalFund.price || 0), percent: Number(modalFund.p2 || 0) },
                        { price: Number(modalFund.price3 || modalFund.price || 0), percent: Number(modalFund.p3 || 0) },
                        { price: Number(modalFund.price4 || modalFund.price || 0), percent: Number(modalFund.p4 || 0) },
                      ];
                  return tiers.map((tObj, idx) => (
                    <button key={idx} className={`pill ${selectedTier===idx?'primary':''}`} onClick={()=>setSelectedTier(idx)}>
                      {formatPlainMoney(Number(tObj.price||0), String(modalFund.currency||'MXN'))}
                    </button>
                  ));
                })()}
              </div>
              {Number.isInteger(selectedTier) && (
                <div className="desc" style={{ marginTop: 6 }}>
                  {(lang==='es'?'Distribución: ':'Distribution: ')}{(() => {
                    const tiers = Array.isArray(modalFund.tiers) && modalFund.tiers.length === 4
                      ? modalFund.tiers
                      : [
                          { price: Number(modalFund.price || 0), percent: Number(modalFund.p1 || 0) },
                          { price: Number(modalFund.price2 || modalFund.price || 0), percent: Number(modalFund.p2 || 0) },
                          { price: Number(modalFund.price3 || modalFund.price || 0), percent: Number(modalFund.p3 || 0) },
                          { price: Number(modalFund.price4 || modalFund.price || 0), percent: Number(modalFund.p4 || 0) },
                        ];
                    const p = Number(tiers[selectedTier]?.percent || 0);
                    return `${p.toFixed(2)}%`;
                  })()}
                </div>
              )}
              <div className="sub-actions" style={{ justifyContent:'flex-end', gap:10, marginTop:10 }}>
                <button className="btn" onClick={()=>{ setModalOpen(false); setModalFund(null); setSelectedTier(null); }}>{lang==='es'?'Cancelar':'Cancel'}</button>
                <button className="btn primary" disabled={!Number.isInteger(selectedTier) || submitting} onClick={()=>{
                  const tiers = Array.isArray(modalFund.tiers) && modalFund.tiers.length === 4
                    ? modalFund.tiers
                    : [
                        { price: Number(modalFund.price || 0), percent: Number(modalFund.p1 || 0) },
                        { price: Number(modalFund.price2 || modalFund.price || 0), percent: Number(modalFund.p2 || 0) },
                        { price: Number(modalFund.price3 || modalFund.price || 0), percent: Number(modalFund.p3 || 0) },
                        { price: Number(modalFund.price4 || modalFund.price || 0), percent: Number(modalFund.p4 || 0) },
                      ];
                  const sel = tiers[selectedTier];
                  submitSubscribe(modalFund.code, Number(sel?.price || modalFund.price || 0));
                }}>{lang==='es'?'Enviar':'Submit'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="card" style={{ marginTop: 16 }}>
        <h2 className="title" style={{ marginTop: 0 }}>{lang==='es'?'Órdenes de fondos':'Fund Orders'}</h2>
        <table className="data-table" style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>{lang==='es'?'Código':'Code'}</th>
              <th>{lang==='es'?'Dividendo':'Dividend'}</th>
              <th>{lang==='es'?'Monto':'Amount'}</th>
              <th>{lang==='es'?'Desbloqueo en':'Unlock In'}</th>
              <th>{lang==='es'?'Acción':'Action'}</th>
            </tr>
          </thead>
          <tbody>
            {(orders || []).map(o => {
              const lockUntil = o.lockUntil || o.lock_until || o.lock_until_ts;
              const ts = typeof lockUntil === 'number' ? lockUntil : Date.parse(lockUntil || '');
              const locked = Number.isFinite(ts) && Date.now() < ts;
              const status = String(o.status || 'submitted');
              const daysLeft = Number.isFinite(ts) ? Math.max(0, Math.ceil((ts - Date.now()) / 86400000)) : null;
              const amountTotal = Number(o.price || 0) * Number(o.qty || 0);
              const dividend = o.dividend || (list.find(f => f.code === o.code)?.dividend) || '-';
              return (
                <tr key={o.id}>
                  <td style={{ textAlign:'center' }}>{o.code}</td>
                  <td style={{ textAlign:'center' }}>{dividendLabel(dividend)}</td>
                  <td style={{ textAlign:'center' }}>{formatPlainMoney(amountTotal, String(o.currency||'MXN'))}</td>
                  <td style={{ textAlign:'center' }}>{daysLeft != null ? `${daysLeft} ${lang==='es'?'días':'days'}` : '-'}</td>
                  <td>
                    <button className="btn primary" disabled={status!=='approved'} onClick={() => {
                      if (locked) {
                        setToast({ show: true, type: 'error', text: lang==='es'?'Aún en período de bloqueo':'Still in lock period' });
                        setTimeout(() => setToast({ show: false, type: 'error', text: '' }), 1000);
                        return;
                      }
                      redeem(o);
                    }}>{lang==='es'?'Redimir':'Redeem'}</button>
                  </td>
                </tr>
              );
            })}
            {(orders || []).length === 0 && (<tr><td className="desc" colSpan={5}>--</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
