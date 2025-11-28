import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { meWithdrawCreate, meWithdrawList, meWithdrawCancel, notificationsApi } from "../../services/api";
import { api } from "../../services/api.js";
import { useI18n } from "../../i18n.jsx";

export default function Withdraw() {
  const nav = useNavigate();
  const { t } = useI18n();
  const [currency, setCurrency] = useState('MXN');
  const [amount, setAmount] = useState('');
  const [methodType, setMethodType] = useState('bank');
  const [bankAccount, setBankAccount] = useState('');
  const [usdtAddress, setUsdtAddress] = useState('');
  const [usdtNetwork, setUsdtNetwork] = useState('');
  const [records, setRecords] = useState([]);
  const [error, setError] = useState('');
  const [wallets, setWallets] = useState([]);
  const [bankCards, setBankCards] = useState([]);
  const [balances, setBalances] = useState({ mxn: 0 });
  const [toast, setToast] = useState({ show: false, text: '', type: 'ok' });

  useEffect(() => { loadRecords(); loadBindings(); loadBalances(); }, []);
  async function loadRecords() {
    try {
      const r = await meWithdrawList();
      const items = r.items || [];
      setRecords(items);
      try {
        const sess = JSON.parse(localStorage.getItem('sessionUser')||'null');
        const uid = sess?.id || sess?.phone || 'guest';
        const holds = JSON.parse(localStorage.getItem(`withdraw:holds:${uid}`)||'[]');
        const idsDone = new Set(items.filter(x=>x.status==='completed' || x.status==='rejected').map(x=>x.id));
        const next = Array.isArray(holds)?holds.map(h=> idsDone.has(h.id) ? { ...h, status: 'settled' } : h ):[];
        localStorage.setItem(`withdraw:holds:${uid}`, JSON.stringify(next));
      } catch {}
    } catch {}
  }
  async function loadBalances() {
    try {
      const r = await api.get('/me/balances');
      const arr = Array.isArray(r?.balances) ? r.balances : [];
      const map = arr.reduce((m, it) => { m[String(it.currency || '').toUpperCase()] = Number(it.amount || 0); return m; }, {});
      setBalances({ mxn: Number(map.MXN||0) });
    } catch { /* 保持现值，避免误显示 */ }
  }
  async function loadBindings() {
    try {
      const w = await api.get('/me/wallets');
      setWallets(Array.isArray(w?.wallets) ? w.wallets : []);
    } catch {
      try {
        const uid = (typeof localStorage !== 'undefined') ? (JSON.parse(localStorage.getItem('sessionUser')||'null')?.id || JSON.parse(localStorage.getItem('sessionUser')||'null')?.phone || 'guest') : 'guest';
        const arr = JSON.parse(localStorage.getItem(`wallets:${uid}`) || '[]');
        setWallets(Array.isArray(arr) ? arr : []);
      } catch {}
    }
    try {
      const c = await api.get('/me/bank-cards');
      setBankCards(Array.isArray(c?.cards) ? c.cards : []);
    } catch {
      try {
        const s = (typeof localStorage !== 'undefined') ? JSON.parse(localStorage.getItem('sessionUser')||'null') : null;
        const id = s?.id || s?.phone || 'guest';
        const cached = JSON.parse(localStorage.getItem(`bankcards:${id}`) || '[]');
        setBankCards(Array.isArray(cached) ? cached : []);
      } catch {}
    }
  }

  function onCurrencyChange() {}

  async function submit() {
    setError('');
    try {
      const curBal = Number(balances.mxn||0);
      const amt = Number(amount||0);
      if (!Number.isFinite(amt) || amt <= 0) { setError(t('errorAmountInvalid') || 'Invalid amount'); return; }
      if (amt > curBal) { setError(t('errorInsufficientBalance') || 'Insufficient balance'); return; }
      const payload = { currency: 'MXN', amount: Number(amount||0), method_type: 'bank', bank_account: bankAccount };
      const res = await meWithdrawCreate(payload);
      const createdId = res?.id || res?.withdraw_id || `wd_${Date.now()}`;
      // hold funds immediately (frontend fallback)
      try {
        const sess = JSON.parse(localStorage.getItem('sessionUser')||'null');
        const uid = sess?.id || sess?.phone || 'guest';
        const holds = JSON.parse(localStorage.getItem(`withdraw:holds:${uid}`)||'[]');
        const holdItem = { id: createdId, currency, amount: amt, status: 'active', ts: Date.now() };
        holds.unshift(holdItem);
        localStorage.setItem(`withdraw:holds:${uid}`, JSON.stringify(holds));
        // try to link to real server id by fetching latest records
        try {
          const list = await meWithdrawList();
          const items = Array.isArray(list?.items) ? list.items : [];
          const pending = items.filter(x => String(x.status||'') === 'pending' && String(x.currency||'') === currency && Number(x.amount||0) === amt);
          const newest = pending.sort((a,b)=> new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
          if (newest && newest.id) {
            const updated = (JSON.parse(localStorage.getItem(`withdraw:holds:${uid}`)||'[]')||[]).map(h => (h === holdItem || h.id === createdId) ? { ...h, id: newest.id } : h);
            localStorage.setItem(`withdraw:holds:${uid}`, JSON.stringify(updated));
          }
        } catch {}
        try { window.dispatchEvent(new Event('withdraw_hold_changed')); } catch {}
      } catch {}
      await loadRecords();
      await loadBalances();
      setAmount('');
      setToast({ show: true, type: 'ok', text: (t('withdrawSubmitted') || '提现申请已提交') });
      setTimeout(() => setToast({ show: false, type: 'ok', text: '' }), 1000);
    } catch (e) { setError(e?.message || '提交失败'); }
  }
  async function cancel(id) {
    try {
      await meWithdrawCancel(id);
      // refund hold
      try {
        const sess = JSON.parse(localStorage.getItem('sessionUser')||'null');
        const uid = sess?.id || sess?.phone || 'guest';
        const holds = JSON.parse(localStorage.getItem(`withdraw:holds:${uid}`)||'[]');
        let matched = false;
        let next = Array.isArray(holds)?holds.map(h=>{ if (h.id===id) { matched = true; return { ...h, status:'cancelled' }; } return h; }):[];
        if (!matched) {
          // fallback: cancel first active hold
          next = Array.isArray(holds)?holds.map(h=> (h.status==='active' && !matched ? (matched=true, { ...h, status:'cancelled' }) : h)) : [];
        }
        localStorage.setItem(`withdraw:holds:${uid}`, JSON.stringify(next));
        try { window.dispatchEvent(new Event('withdraw_hold_changed')); } catch {}
      } catch {}
      await loadRecords();
      await loadBalances();
      setToast({ show:true, type:'ok', text: t('withdrawCancelled') || '已取消并返还资金' });
      setTimeout(()=>setToast({ show:false, type:'ok', text:'' }), 1000);
    } catch {}
  }

  return (
    <div className="screen withdraw-screen">
      {toast.show && (
        <div style={{ position:'fixed', top:10, left:0, right:0, display:'grid', placeItems:'center', zIndex:1000 }}>
          <div className={`top-toast ${toast.type}`}>{toast.text}</div>
        </div>
      )}
      <div className="card">
        <div className="title" style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span>{t('withdrawTitle')}</span>
          <button className="btn primary withdraw-records-btn" onClick={()=>nav('/me/withdraw/records')}>{t('withdrawRecordsLink')}</button>
        </div>
        <div className="form">
          <label>{t('bankCardLabel')}</label>
          {bankCards.length > 0 ? (
            <select value={bankAccount} onChange={e=>setBankAccount(e.target.value)}>
              {bankCards.map(it => {
                const m = `${it.bank_name || 'Bank'} ${String(it.bin||'').slice(0,4)}****${String(it.last4||'').slice(-4)}`;
                return (<option key={it.id} value={m}>{m}</option>);
              })}
            </select>
          ) : (
            <input className="input" value={bankAccount} onChange={e=>setBankAccount(e.target.value)} placeholder={t('bankCardLabel')} />
          )}
          <label>{t('amountLabel')}</label>
          <input className="input" type="number" value={amount} onChange={e=>setAmount(e.target.value)} placeholder={t('amountLabel')} />
          <div className="desc muted" style={{ marginTop: 6 }}>
            {t('balanceLabel') || '余额'}：{Number(balances.mxn||0).toFixed(2)} MXN
          </div>
          {error ? <div className="error">{error}</div> : null}
          <div className="sub-actions" style={{ justifyContent: 'space-between' }}>
            <button className="btn" onClick={()=>nav('/me')}>{t('btnBackProfile')}</button>
            <button className="btn primary" onClick={submit}>{t('btnSubmitWithdraw')}</button>
          </div>
        </div>
        {/* 记录独立页面展示，当前页不再显示 */}
      </div>
    </div>
  );
}
