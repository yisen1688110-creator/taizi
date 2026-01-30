import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../../i18n.jsx";
import { api } from "../../services/api.js";
import { loginPhone } from "../../services/auth.js";

function readSession() {
  try { return JSON.parse(localStorage.getItem("sessionUser") || "null"); } catch { return null; }
}
function readUsers() {
  try { return JSON.parse(localStorage.getItem("users") || "[]"); } catch { return []; }
}

const BANK_OPTIONS = [
  { code: 'ICBC', name: 'ICBC' },
  { code: 'ABC', name: 'ABC' },
  { code: 'CCB', name: 'CCB' },
  { code: 'BOC', name: 'BOC' },
  { code: 'CMB', name: 'CMB' },
  { code: 'Bank', name: 'Bank' },
];

export default function BankCards() {
  const nav = useNavigate();
  const { t } = useI18n();
  const [cards, setCards] = useState([]);

  const masked = (bin, last4) => `${String(bin || '').slice(0,4)}****${String(last4 || '').slice(-4)}`;

  const storageKey = (() => {
    try {
      const s = readSession();
      const id = s?.id || s?.phone || 'guest';
      return `bankcards:${id}`;
    } catch { return 'bankcards:guest'; }
  })();
  const loadCards = async () => {
    try {
      const res = await api.get('/me/bank-cards');
      const list = Array.isArray(res?.cards) ? res.cards : [];
      setCards(list);
      try { localStorage.setItem(storageKey, JSON.stringify(list)); } catch {}
    } catch (_) {
      try {
        const cached = JSON.parse(localStorage.getItem(storageKey) || '[]');
        setCards(Array.isArray(cached) ? cached : []);
      } catch { setCards([]); }
    }
  };

  useEffect(() => { loadCards(); }, []);

  // 若缺少令牌，使用本地账户静默登录后再加载银行卡列表（确保每次访问读取后端最新数据）
  useEffect(() => {
    const ensureToken = async () => {
      try {
        const hasToken = !!localStorage.getItem('token');
        const s = readSession();
        if (!hasToken && s?.phone) {
          const mirror = readUsers().find(u => String(u.phone) === String(s.phone));
          if (mirror?.password && /^\d{10}$/.test(String(s.phone))) {
            await loginPhone({ phone: s.phone, password: mirror.password });
            await loadCards();
          }
        }
      } catch (_) {}
    };
    ensureToken();
  }, []);

  // Add card modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [currentMasked, setCurrentMasked] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [holderName, setHolderName] = useState("");
  const [bankName, setBankName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState({ show: false, type: 'info', text: '' });
  const [confirmDelete, setConfirmDelete] = useState({ show: false, id: null });
  const showToast = (text, type='info') => { setToast({ show: true, type, text }); setTimeout(()=>setToast({ show: false, type, text: '' }), 1200); };


  const onSubmit = async () => {
    const num = String(cardNumber || '').replace(/\s+/g,'').toUpperCase();
    const holder = String(holderName || '').trim();
    const bank = String(bankName || '').trim();
    // 波兰银行账号验证：26位数字（本地格式）或 PL + 26位数字 = 28位（IBAN格式）
    if (num.length > 0) {
      const numOnly = num.replace(/^PL/i, '');
      const lenOk = numOnly.length === 26 && /^\d+$/.test(numOnly);
      if (!lenOk) { showToast(t('errorCardNumber'), 'error'); return; }
    }
    if (!holder || holder.length < 2) { showToast(t('errorHolderName'), 'error'); return; }
    if (!bank) { showToast(t('errorBankName'), 'error'); return; }
    try {
      setSaving(true); setError("");
      if (editId) {
        const body = { holderName: holder, bankName: bank };
        if (num.length) body.cardNumber = num;
        await api.put(`/me/bank-cards/${editId}`, body);
        showToast(t('successCardUpdated'), 'ok');
      } else {
        await api.post('/me/bank-cards', { cardNumber: num, holderName: holder, bankName: bank });
        showToast(t('successCardAdded'), 'ok');
      }
      setModalOpen(false); setCardNumber(''); setHolderName(''); setBankName('');
      setEditId(null); setCurrentMasked('');
      loadCards();
    } catch (e) {
      // 后端未实现时，使用本地存储降级保存
      try {
        const cached = JSON.parse(localStorage.getItem(storageKey) || '[]');
        const base = Array.isArray(cached) ? cached : [];
        if (editId) {
          const next = base.map(c => c.id === editId ? { ...c, holder_name: holder, bank_name: bank } : c);
          localStorage.setItem(storageKey, JSON.stringify(next));
          showToast(t('successCardUpdated'), 'ok');
        } else {
          const id = Date.now();
          const bin = String(num).slice(0,6);
          const last4 = String(num).slice(-4);
          const next = [{ id, holder_name: holder, bank_name: bank, bin, last4 }, ...base];
          localStorage.setItem(storageKey, JSON.stringify(next));
          showToast(t('successCardAdded'), 'ok');
        }
        setModalOpen(false); setCardNumber(''); setHolderName(''); setBankName(''); setEditId(null); setCurrentMasked('');
        loadCards();
      } catch (_) {
        showToast(String(e?.message || 'Failed'), 'error');
        setError(String(e?.message || 'Failed'));
      }
    } finally { setSaving(false); }
  };

  const Card = ({ item }) => (
    <div
      className="card"
      style={{
        display:'flex',
        alignItems:'stretch',
        gap:14,
        padding:'14px 16px',
        border:'1px solid rgba(91,141,239,0.32)',
        borderRadius:12,
        boxShadow:'0 0 0 2px rgba(91,141,239,0.18), inset 0 0 0 2px rgba(91,141,239,0.12)',
        minHeight:110
      }}
    >
      <div style={{ flex:1, display:'flex', flexDirection:'column' }}>
        <div className="title" style={{ margin:0, fontSize:18 }}>{item.bank_name || 'Bank'}</div>
        <div className="desc" style={{ marginTop:10, textAlign:'center', width:'100%', fontSize:16 }}>{masked(item.bin, item.last4)}</div>
        <div className="desc" style={{ marginTop:10, fontSize:14 }}>{item.holder_name || ''}</div>
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:10 }}>
          <button
            className="btn"
            style={{ background:'linear-gradient(90deg, #5ba1ff, #8b67ff)', color:'#fff', border:'1px solid rgba(255,255,255,0.35)', padding:'6px 12px', borderRadius:10, filter:'brightness(1.05)' }}
            onClick={() => { setEditId(item.id); setCardNumber(''); setHolderName(item.holder_name || ''); setBankName(item.bank_name || ''); setCurrentMasked(masked(item.bin, item.last4)); setModalOpen(true); }}
          >{t('edit')}</button>
          <button
            className="btn"
            style={{ background:'linear-gradient(90deg, #ff8aa1, #ff5c7a)', color:'#0c1529', border:'1px solid rgba(255,255,255,0.35)', padding:'6px 12px', borderRadius:10, filter:'brightness(1.05)' }}
            onClick={() => setConfirmDelete({ show:true, id:item.id })}
          >{t('delete')}</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="screen borderless">
      {toast.show && (<div className={`top-toast ${toast.type}`}>{toast.text}</div>)}
      <div className="card borderless-card">
        <h1 className="title">{t('bankCardsTitle')}</h1>
        <p className="desc">{t('bankCardsDesc')}</p>
        <div className="desc muted" style={{ marginTop: 4 }}>{t('bankCardsHint')}</div>
        <div style={{ display:'grid', gap:12 }}>
          {cards.length === 0 ? (<div className="desc">—</div>) : cards.map(c => (<Card key={c.id} item={c} />))}
        </div>
        <div className="sub-actions" style={{ justifyContent: 'space-between', marginTop: 12 }}>
          <button className="btn" onClick={()=>nav('/me')}>{t('btnBackProfile')}</button>
          <button className="btn primary" onClick={()=>{ setModalOpen(true); setEditId(null); setCurrentMasked(''); setError(''); setCardNumber(''); setHolderName(''); setBankName(''); }}>{t('addBankCard')}</button>
        </div>
      </div>

      {modalOpen && (
        <div className="modal">
          <div className="modal-card">
            <h2 className="title" style={{ marginTop:0 }}>{editId ? t('edit') : t('addBankCard')}</h2>
            <div className="form">
              <div className="label">{t('cardNumber')}</div>
              {editId && currentMasked ? (<div className="desc muted" style={{ marginTop: 4 }}>{currentMasked}</div>) : null}
              <input className="input" inputMode="numeric" placeholder={t('placeholderCardNumber')} value={cardNumber} onChange={e=>setCardNumber(e.target.value.replace(/[^\d\s]/g,''))} />
              <div className="label">{t('holderName')}</div>
              <input className="input" placeholder={t('placeholderHolderName')} value={holderName} onChange={e=>setHolderName(e.target.value)} />
              <div className="label">{t('bankName')}</div>
              <input className="input" placeholder={t('placeholderBankName')} value={bankName} onChange={e=>setBankName(e.target.value)} />
              <div className="desc muted" style={{ marginTop: 6 }}>{t('addCardHint')}</div>
              {error && (<div className="error" style={{ marginTop:8 }}>{error}</div>)}
              <div className="sub-actions" style={{ justifyContent: 'flex-end', gap:10 }}>
                <button className="btn" onClick={()=>{ setModalOpen(false); setEditId(null); setCurrentMasked(''); }}>{t('cancel')}</button>
                <button className="btn primary" disabled={saving} onClick={onSubmit}>{saving ? t('saving') : t('confirm')}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认弹窗 */}
      {confirmDelete?.show && (
        <div className="modal">
          <div className="modal-card">
            <h2 className="title" style={{ marginTop:0 }}>{t('confirmDeleteTitle')}</h2>
            <p className="desc">{t('confirmDeleteDesc')}</p>
            <div className="sub-actions" style={{ justifyContent:'flex-end', gap:12 }}>
              <button className="btn" style={{ padding:'10px 16px', fontSize:16 }} onClick={()=>setConfirmDelete({ show:false, id:null })}>{t('confirmNo')}</button>
              <button className="btn primary" style={{ padding:'10px 18px', fontSize:16 }} onClick={async ()=>{ try { await api.delete(`/me/bank-cards/${confirmDelete.id}`); showToast(t('successCardDeleted'), 'ok'); } catch (_) { showToast(t('errorDeleteFailed'), 'error'); } finally { setConfirmDelete({ show:false, id:null }); loadCards(); } }}>{t('confirmYes')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}