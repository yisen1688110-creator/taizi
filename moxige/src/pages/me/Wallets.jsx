import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../services/api.js";
import { useI18n } from "../../i18n.jsx";
import Modal from "../../components/Modal.jsx";

export default function Wallets() {
  const nav = useNavigate();
  const { t } = useI18n();
  const [network, setNetwork] = useState('ERC20');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState({ show: false, type: 'info', text: '' });
  const showToast = (text, type='info') => { setToast({ show: true, type, text }); setTimeout(()=>setToast({ show: false, type, text: '' }), 1200); };
  const [items, setItems] = useState([]);
  const storageKey = (uid) => `wallets:${uid || 'guest'}`;
  const readLocal = () => { try { return JSON.parse(localStorage.getItem(storageKey('self')) || '[]'); } catch { return []; } };
  const writeLocal = (arr) => { try { localStorage.setItem(storageKey('self'), JSON.stringify(arr || [])); } catch {} };
  // modal states
  const [editItem, setEditItem] = useState(null); // {id, network, address}
  const [delItem, setDelItem] = useState(null); // {id}
  const [editNet, setEditNet] = useState('ERC20');
  const [editAddr, setEditAddr] = useState('');

  const load = async () => {
    try {
      const res = await api.get('/me/wallets');
      setItems(Array.isArray(res?.wallets) ? res.wallets : []);
    } catch (_) {}
    try {
      const uid = (typeof localStorage !== 'undefined') ? (JSON.parse(localStorage.getItem('sessionUser')||'null')?.id || JSON.parse(localStorage.getItem('sessionUser')||'null')?.phone || 'guest') : 'guest';
      const arr = JSON.parse(localStorage.getItem(`wallets:${uid}`) || '[]');
      if (Array.isArray(arr) && arr.length && (!items || items.length===0)) setItems(arr);
    } catch {}
  };
  useEffect(()=>{ load(); }, []);

  // Relax client-side validation: allow any non-empty address; users can correct later.
  const validate = (net, addr) => {
    const a = String(addr || '').trim();
    return ['ERC20','TRC20'].includes(String(net || '').toUpperCase()) && a.length > 0;
  };

  const onSave = async () => {
    const net = String(network || '').toUpperCase();
    const addr = String(address || '').trim();
    if (!['ERC20','TRC20'].includes(net)) { showToast('Invalid network','error'); return; }
    if (!validate(net, addr)) { showToast(t('errorInvalidAddress') || 'Invalid address','error'); return; }
    try {
      setSaving(true); setError('');
      await api.post('/me/wallets', { network: net, address: addr });
      showToast('Saved','ok');
      setAddress('');
      load();
    } catch (e) {
      const msg = String(e?.message || 'Failed');
      if (/404|Not\s*Found/i.test(msg)) {
        try {
          const uid = (typeof localStorage !== 'undefined') ? (JSON.parse(localStorage.getItem('sessionUser')||'null')?.id || JSON.parse(localStorage.getItem('sessionUser')||'null')?.phone || 'guest') : 'guest';
          const k = `wallets:${uid}`;
          const cur = JSON.parse(localStorage.getItem(k) || '[]');
          const next = [{ id: Date.now(), network: net, address: addr, created_at: new Date().toISOString() }, ...cur];
          localStorage.setItem(k, JSON.stringify(next));
          showToast('Saved locally','ok');
          setAddress('');
          setItems(next);
          return;
        } catch {}
      }
      showToast(msg,'error');
      setError(msg);
    } finally { setSaving(false); }
  };

  const openEdit = (id, net, addr) => {
    setEditItem({ id, network: net, address: addr });
    setEditNet(net);
    setEditAddr(addr);
  };
  const submitEdit = async () => {
    const newNet = String(editNet || '').toUpperCase();
    const newAddr = String(editAddr || '').trim();
    if (!validate(newNet, newAddr)) { showToast(t('errorInvalidAddress') || 'Invalid address','error'); return; }
    try {
      await api.put(`/me/wallets/${editItem.id}`, { network: newNet, address: newAddr });
      showToast('Updated','ok');
      setEditItem(null);
      load();
    } catch (e) {
      const msg = String(e?.message || 'Failed');
      if (/404|Not\s*Found/i.test(msg)) {
        try {
          const uid = (typeof localStorage !== 'undefined') ? (JSON.parse(localStorage.getItem('sessionUser')||'null')?.id || JSON.parse(localStorage.getItem('sessionUser')||'null')?.phone || 'guest') : 'guest';
          const k = `wallets:${uid}`;
          const cur = JSON.parse(localStorage.getItem(k) || '[]');
          const next = cur.map(x => x.id === editItem.id ? { ...x, network: newNet, address: newAddr } : x);
          localStorage.setItem(k, JSON.stringify(next));
          showToast('Updated locally','ok');
          setEditItem(null);
          setItems(next);
          return;
        } catch {}
      }
      showToast(msg,'error');
    }
  };

  const openDelete = (id) => { setDelItem({ id }); };
  const submitDelete = async () => {
    try { await api.delete(`/me/wallets/${delItem.id}`); showToast('Deleted','ok'); setDelItem(null); load(); }
    catch (e) {
      const msg = String(e?.message || 'Failed');
      if (/404|Not\s*Found/i.test(msg)) {
        try {
          const uid = (typeof localStorage !== 'undefined') ? (JSON.parse(localStorage.getItem('sessionUser')||'null')?.id || JSON.parse(localStorage.getItem('sessionUser')||'null')?.phone || 'guest') : 'guest';
          const k = `wallets:${uid}`;
          const cur = JSON.parse(localStorage.getItem(k) || '[]');
          const next = cur.filter(x => x.id !== delItem.id);
          localStorage.setItem(k, JSON.stringify(next));
          showToast('Deleted locally','ok');
          setDelItem(null);
          setItems(next);
          return;
        } catch {}
      }
      showToast(msg,'error');
    }
  };

  return (
    <div className="screen top-align" style={{ padding: 0, width: '100%', maxWidth: '100%' }}>
      <div style={{ padding: '16px', width: '100%', boxSizing: 'border-box', paddingBottom: 100 }}>
        <h1 className="title" style={{ marginTop: 0 }}>{t('walletsTitle') || 'Dirección de billetera'}</h1>
        <div className="desc muted" style={{ marginTop: 4 }}>{t('walletsDesc') || 'Vincule su dirección para retiros'}</div>

        {/* 网络切换按钮 */}
        <div className="sub-actions" style={{ justifyContent:'flex-start', gap:10, marginTop:12 }}>
          <button className={network==='ERC20'? 'btn primary':'btn'} onClick={()=>setNetwork('ERC20')}>ERC-20</button>
          <button className={network==='TRC20'? 'btn primary':'btn'} onClick={()=>setNetwork('TRC20')}>TRC-20</button>
        </div>

        {/* 地址输入 */}
        <div className="form" style={{ marginTop: 12 }}>
          <div className="label">{t('walletAddressLabel') || 'Dirección'}</div>
          <input className="input" placeholder={network==='ERC20'?'0x...':'T...'} value={address} onChange={e=>setAddress(e.target.value)} />
          {error && (<div className="error" style={{ marginTop:8 }}>{error}</div>)}
          <div className="sub-actions" style={{ justifyContent:'flex-end', gap:10 }}>
            <button className="btn" onClick={()=>nav('/me')}>{t('btnBackProfile')}</button>
            <button className="btn primary" disabled={saving} onClick={onSave}>{saving ? t('saving') : t('confirm')}</button>
          </div>
        </div>

        {/* 列表 */}
        <div className="desc muted" style={{ marginTop: 20, marginBottom: 10, fontSize: 13 }}>{t('walletsListTitle') || 'Direcciones guardadas'}</div>
        <div style={{ display:'grid', gap:12 }}>
          {items.length === 0 ? (<div className="desc" style={{ color: '#64748b' }}>—</div>) : items.map(it => (
            <div key={it.id} style={{ 
              background: 'rgba(255,255,255,0.04)', 
              borderRadius: 12, 
              padding: '14px 16px',
              border: '1px solid rgba(255,255,255,0.08)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ 
                  background: it.network === 'ERC20' ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'linear-gradient(135deg, #10b981, #059669)',
                  color: '#fff',
                  padding: '4px 10px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600
                }}>{it.network}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button 
                    onClick={()=>openEdit(it.id, it.network, it.address)}
                    style={{ 
                      background: 'rgba(59, 130, 246, 0.15)', 
                      color: '#3b82f6', 
                      border: 'none',
                      padding: '6px 14px',
                      borderRadius: 6,
                      fontSize: 12,
                      cursor: 'pointer'
                    }}
                  >{t('edit')}</button>
                  <button 
                    onClick={()=>openDelete(it.id)}
                    style={{ 
                      background: 'rgba(239, 68, 68, 0.15)', 
                      color: '#ef4444', 
                      border: 'none',
                      padding: '6px 14px',
                      borderRadius: 6,
                      fontSize: 12,
                      cursor: 'pointer'
                    }}
                  >{t('delete')}</button>
                </div>
              </div>
              <div style={{ 
                background: 'rgba(0,0,0,0.2)', 
                borderRadius: 8, 
                padding: '10px 12px',
                fontFamily: 'monospace',
                fontSize: 12,
                color: '#94a3b8',
                wordBreak: 'break-all',
                lineHeight: 1.5
              }}>{it.address}</div>
            </div>
          ))}
        </div>

        {/* 轻提示 */}
        {toast?.show && (<div className={`toast ${toast?.type || 'info'}`}>{toast?.text}</div>)}

        {/* 编辑弹窗 */}
        <Modal
          open={!!editItem}
          title={t('editAddressPrompt') || 'Editar dirección'}
          onClose={()=>setEditItem(null)}
          actions={[
            { label: t('cancel') || 'Cancelar', onClick: ()=>setEditItem(null) },
            { label: t('confirm') || 'Confirmar', primary: true, onClick: submitEdit },
          ]}
        >
          <div className="sub-actions" style={{ justifyContent:'flex-start', gap:10 }}>
            <button className={editNet==='ERC20'? 'btn primary':'btn'} onClick={()=>setEditNet('ERC20')}>ERC-20</button>
            <button className={editNet==='TRC20'? 'btn primary':'btn'} onClick={()=>setEditNet('TRC20')}>TRC-20</button>
          </div>
          <div className="form" style={{ marginTop: 12 }}>
            <div className="label">{t('walletAddressLabel') || 'Dirección'}</div>
            <input className="input" value={editAddr} onChange={e=>setEditAddr(e.target.value)} />
          </div>
        </Modal>

        {/* 删除确认弹窗 */}
        <Modal
          open={!!delItem}
          title={t('confirmDeleteAddress') || '¿Eliminar esta dirección?'}
          onClose={()=>setDelItem(null)}
          actions={[
            { label: t('cancel') || 'Cancelar', onClick: ()=>setDelItem(null) },
            { label: t('confirm') || 'Confirmar', primary: true, onClick: submitDelete },
          ]}
        >
          <div className="desc muted">{t('deleteHint') || 'Esta acción no se puede deshacer.'}</div>
        </Modal>
      </div>
    </div>
  );
}