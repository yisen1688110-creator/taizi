import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { meWithdrawCreate, meWithdrawList, meWithdrawCancel, notificationsApi } from "../../services/api";
import { api } from "../../services/api.js";
import { useI18n } from "../../i18n.jsx";

export default function Withdraw() {
  const nav = useNavigate();
  const { t, lang } = useI18n();
  const [methodType, setMethodType] = useState('bank'); // 'bank' or 'crypto'
  const [amount, setAmount] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [cryptoAddress, setCryptoAddress] = useState('');
  const [cryptoNetwork, setCryptoNetwork] = useState('TRC20');
  const [records, setRecords] = useState([]);
  const [error, setError] = useState('');
  const [wallets, setWallets] = useState([]);
  const [bankCards, setBankCards] = useState([]);
  const [balances, setBalances] = useState({ pln: 0, usdt: 0 });
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
      setBalances({ pln: Number(map.PLN||0), usdt: Number(map.USDT||0) });
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

  async function submit() {
    setError('');
    try {
      const currency = methodType === 'crypto' ? 'USDT' : 'PLN';
      const curBal = methodType === 'crypto' ? Number(balances.usdt||0) : Number(balances.pln||0);
      const amt = Number(amount||0);
      if (!Number.isFinite(amt) || amt <= 0) { 
        setError(t('errorAmountInvalid') || 'Invalid amount'); 
        return; 
      }
      if (amt > curBal) { 
        setError(t('errorInsufficientBalance') || 'Insufficient balance'); 
        return; 
      }
      
      // 验证提现地址/账户
      if (methodType === 'bank' && !bankAccount) {
        setError(lang === 'zh' ? '请选择或输入银行卡' : (lang === 'pl' ? 'Wybierz lub wprowadź kartę bankową' : 'Please select or enter bank card'));
        return;
      }
      if (methodType === 'crypto' && !cryptoAddress) {
        setError(lang === 'zh' ? '请输入钱包地址' : (lang === 'pl' ? 'Wprowadź adres portfela' : 'Please enter wallet address'));
        return;
      }
      
      const payload = methodType === 'crypto' 
        ? { currency: 'USDT', amount: amt, method_type: 'crypto', usdt_address: cryptoAddress, usdt_network: cryptoNetwork }
        : { currency: 'PLN', amount: amt, method_type: 'bank', bank_account: bankAccount };
      
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
        try { window.dispatchEvent(new Event('withdraw_hold_changed')); } catch {}
      } catch {}
      
      await loadRecords();
      await loadBalances();
      setAmount('');
      setToast({ show: true, type: 'ok', text: (t('withdrawSubmitted') || '提现申请已提交') });
      setTimeout(() => setToast({ show: false, type: 'ok', text: '' }), 1500);
    } catch (e) { setError(e?.message || '提交失败'); }
  }

  // 方式切换标签样式
  const tabStyle = (active) => ({
    flex: 1,
    padding: '12px 16px',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: '14px',
    transition: 'all 0.2s',
    background: active ? 'linear-gradient(90deg, #3b82f6, #2563eb)' : 'rgba(255,255,255,0.08)',
    color: active ? '#fff' : '#9ca3af',
  });

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
        
        {/* 提现方式切换 */}
        <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', background: 'rgba(0,0,0,0.2)', padding: '6px', borderRadius: '10px' }}>
          <button style={tabStyle(methodType === 'bank')} onClick={() => setMethodType('bank')}>
            🏦 {lang === 'zh' ? '银行卡' : (lang === 'pl' ? 'Karta bankowa' : 'Bank Card')}
          </button>
          <button style={tabStyle(methodType === 'crypto')} onClick={() => setMethodType('crypto')}>
            💰 {lang === 'zh' ? '加密钱包' : (lang === 'pl' ? 'Portfel krypto' : 'Crypto Wallet')}
          </button>
        </div>
        
        <div className="form">
          {methodType === 'bank' ? (
            <>
              <label>{t('bankCardLabel')}</label>
              {bankCards.length > 0 ? (
                <select value={bankAccount} onChange={e=>setBankAccount(e.target.value)}>
                  <option value="">{lang === 'zh' ? '请选择银行卡' : (lang === 'pl' ? 'Wybierz kartę' : 'Select card')}</option>
                  {bankCards.map(it => {
                    const m = `${it.bank_name || 'Bank'} ${String(it.bin||'').slice(0,4)}****${String(it.last4||'').slice(-4)}`;
                    return (<option key={it.id} value={m}>{m}</option>);
                  })}
                </select>
              ) : (
                <input className="input" value={bankAccount} onChange={e=>setBankAccount(e.target.value)} placeholder={t('bankCardLabel')} />
              )}
            </>
          ) : (
            <>
              <label>{lang === 'zh' ? '网络' : (lang === 'pl' ? 'Sieć' : 'Network')}</label>
              <select value={cryptoNetwork} onChange={e=>setCryptoNetwork(e.target.value)} style={{ marginBottom: '12px' }}>
                <option value="TRC20">TRC20 (Tron)</option>
                <option value="ERC20">ERC20 (Ethereum)</option>
                <option value="BEP20">BEP20 (BSC)</option>
              </select>
              
              <label>{lang === 'zh' ? 'USDT 钱包地址' : (lang === 'pl' ? 'Adres portfela USDT' : 'USDT Wallet Address')}</label>
              {wallets.length > 0 ? (
                <select value={cryptoAddress} onChange={e=>setCryptoAddress(e.target.value)}>
                  <option value="">{lang === 'zh' ? '请选择钱包' : (lang === 'pl' ? 'Wybierz portfel' : 'Select wallet')}</option>
                  {wallets.filter(w => !w.network || w.network === cryptoNetwork).map(it => (
                    <option key={it.id || it.address} value={it.address}>
                      {String(it.address||'').slice(0,8)}...{String(it.address||'').slice(-8)}
                    </option>
                  ))}
                </select>
              ) : (
                <input 
                  className="input" 
                  value={cryptoAddress} 
                  onChange={e=>setCryptoAddress(e.target.value)} 
                  placeholder={lang === 'zh' ? '输入钱包地址' : (lang === 'pl' ? 'Wprowadź adres portfela' : 'Enter wallet address')} 
                />
              )}
            </>
          )}
          
          <label style={{ marginTop: '12px' }}>{t('amountLabel')}</label>
          <input className="input" type="number" value={amount} onChange={e=>setAmount(e.target.value)} placeholder={t('amountLabel')} />
          
          <div className="desc muted" style={{ marginTop: 6 }}>
            {t('balanceLabel') || '余额'}：{methodType === 'crypto' 
              ? `${Number(balances.usdt||0).toFixed(2)} USDT` 
              : `${Number(balances.pln||0).toFixed(2)} PLN`}
          </div>
          
          {error ? <div className="error">{error}</div> : null}
          
          <div className="sub-actions" style={{ justifyContent: 'space-between', marginTop: '16px' }}>
            <button className="btn" onClick={()=>nav('/me')}>{t('btnBackProfile')}</button>
            <button className="btn primary" onClick={submit}>{t('btnSubmitWithdraw')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
