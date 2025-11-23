import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { meWithdrawCreate, meWithdrawList, meWithdrawCancel } from "../../services/api";
import { useI18n } from "../../i18n.jsx";

export default function Withdraw() {
  const nav = useNavigate();
  const { t } = useI18n();
  const [currency, setCurrency] = useState('USD');
  const [amount, setAmount] = useState('');
  const [methodType, setMethodType] = useState('bank');
  const [bankAccount, setBankAccount] = useState('');
  const [usdtAddress, setUsdtAddress] = useState('');
  const [usdtNetwork, setUsdtNetwork] = useState('');
  const [records, setRecords] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => { loadRecords(); }, []);
  async function loadRecords() { try { const r = await meWithdrawList(); setRecords(r.items || []); } catch {} }

  function onCurrencyChange(e) {
    const c = e.target.value;
    setCurrency(c);
    setMethodType(c === 'USDT' ? 'usdt' : 'bank');
  }

  async function submit() {
    setError('');
    try {
      const payload = { currency, amount: Number(amount||0), method_type: methodType, bank_account: bankAccount, usdt_address: usdtAddress, usdt_network: usdtNetwork };
      await meWithdrawCreate(payload);
      await loadRecords();
      setAmount('');
    } catch (e) { setError(e?.message || '提交失败'); }
  }
  async function cancel(id) { try { await meWithdrawCancel(id); await loadRecords(); } catch {} }

  return (
    <div className="screen">
      <div className="card">
        <div className="title" style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span>{t('withdrawTitle')}</span>
          <button className="btn" onClick={()=>nav('/me/withdraw/records')}>{t('withdrawRecordsLink')}</button>
        </div>
        <div className="form">
          <label>{t('currencyLabel')}</label>
          <select value={currency} onChange={onCurrencyChange}>
            <option value="USD">USD</option>
            <option value="MXN">MXN</option>
            <option value="USDT">USDT</option>
          </select>
          {currency !== 'USDT' ? (
            <>
              <label>{t('bankCardLabel')}</label>
              <input className="input" value={bankAccount} onChange={e=>setBankAccount(e.target.value)} placeholder={t('bankCardLabel')} />
            </>
          ) : (
            <>
              <label>{t('usdtAddressLabel')}</label>
              <input className="input" value={usdtAddress} onChange={e=>setUsdtAddress(e.target.value)} placeholder={t('usdtAddressLabel')} />
              <label>{t('networkLabel')}</label>
              <input className="input" value={usdtNetwork} onChange={e=>setUsdtNetwork(e.target.value)} placeholder={t('networkLabel')} />
            </>
          )}
          <label>{t('amountLabel')}</label>
          <input className="input" type="number" value={amount} onChange={e=>setAmount(e.target.value)} placeholder={t('amountLabel')} />
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