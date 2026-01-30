import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../../i18n.jsx";
import "../../styles/settings.css";
import { api } from "../../services/api.js";
import { loginPhone } from "../../services/auth.js";

function readSession() {
  try { return JSON.parse(localStorage.getItem("sessionUser") || "null"); } catch { return null; }
}
function readUsers() {
  try { return JSON.parse(localStorage.getItem("users") || "[]"); } catch { return []; }
}
function saveUsers(list) {
  try { localStorage.setItem("users", JSON.stringify(list)); } catch { }
}

export default function Settings() {
  const nav = useNavigate();
  const { lang, setLang, t } = useI18n();
  const [session, setSession] = useState(() => readSession());
  const [users, setUsers] = useState(() => readUsers());
  const user = useMemo(() => {
    if (!session) return null;
    const byId = users.find(u => u.id && u.id === session.id);
    const byPhone = users.find(u => u.phone === session.phone);
    return byId || byPhone || session;
  }, [session, users]);

  const [name, setName] = useState(user?.name || "");
  const phone = user?.phone || "";
  const [avatarUrl, setAvatarUrl] = useState(() => {
    try { return JSON.parse(localStorage.getItem("avatarUrl") || "null") || (user?.avatarUrl) || "/logo.jpg"; } catch { return "/logo.jpg"; }
  });
  const fileRef = useRef(null);

  // 登录密码修改
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [pwdSaving, setPwdSaving] = useState(false);

  // 提现密码（PIN）修改：通过登录密码校验
  const [loginPwdForTrade, setLoginPwdForTrade] = useState("");
  const [newTradePwd, setNewTradePwd] = useState("");
  const [tradeSaving, setTradeSaving] = useState(false);
  const [error, setError] = useState("");
  // 顶部 1 秒自动消失提示
  const [toast, setToast] = useState({ show: false, type: "info", text: "" });
  const showToast = (text, type = "info") => {
    setToast({ show: true, type, text });
    setTimeout(() => setToast({ show: false, type, text: "" }), 1000);
  };

  useEffect(() => { setName(user?.name || ""); }, [user?.name]);

  // 若存在会话但缺少后端令牌，自动用本地凭据静默获取令牌
  useEffect(() => {
    const hasSession = !!session?.phone;
    const hasToken = !!localStorage.getItem('token');
    if (hasSession && !hasToken) {
      try {
        const mirror = readUsers().find(u => u.phone === session.phone);
        if (mirror?.password && /^\d{10}$/.test(String(session.phone))) {
          loginPhone({ phone: session.phone, password: mirror.password }).catch(() => { });
        }
      } catch { }
    }
  }, [session]);

  const onPickAvatar = () => fileRef.current?.click();
  const onAvatarSelected = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result;
      try { await api.post('/me/avatar', { data: base64 }); } catch { }
      setAvatarUrl(base64);
      try {
        const meData = await api.get('/me');
        const u = (meData && (meData.user || meData)) || null;
        if (u) {
          localStorage.setItem('sessionUser', JSON.stringify(u));
          setSession(u);
          const next = readUsers().map(m => (m.id === u.id ? { ...m, avatarUrl: u.avatar || base64 } : m));
          saveUsers(next);
          setUsers(next);
        }
      } catch { }
    };
    reader.readAsDataURL(file);
  };

  const onSaveName = async () => {
    const v = String(name || '').trim();
    if (v.length < 2 || v.length > 20) { showToast(t('errorNameLength'), 'error'); return false; }
    try {
      setError("");
      await api.post('/me/name', { name: v });
      // 仅成功时更新本地映射与会话
      const next = readUsers().map(u => u.id === user?.id ? { ...u, name: v } : u);
      saveUsers(next);
      setUsers(next);
      const s = { ...session, name: v };
      try { localStorage.setItem('sessionUser', JSON.stringify(s)); } catch { }
      setSession(s);
      showToast(t('successNameUpdated'), 'ok');
      return true;
    } catch (_e) {
      setError(t('errorNameSaveFailed'));
      showToast(t('errorNameSaveFailed'), 'error');
      return false;
    }
  };

  const onChangeLoginPassword = async () => {
    if (!oldPwd) { showToast(t('errorOldPasswordWrong'), 'error'); return false; }
    if (!newPwd || newPwd.length < 6) { showToast(t('errorNewPasswordLength'), 'error'); return false; }
    if (newPwd !== confirmPwd) { showToast(t('errorConfirmMismatch'), 'error'); return false; }
    try {
      setPwdSaving(true);
      await api.post(`/me/password`, { old: oldPwd, password: newPwd });
      // 仅成功时更新本地
      const next = readUsers().map(u => u.id === user?.id ? { ...u, password: newPwd } : u);
      saveUsers(next);
      setUsers(next);
      const s = { ...session, password: newPwd };
      try { localStorage.setItem('sessionUser', JSON.stringify(s)); } catch { }
      setSession(s);
      showToast(t('successLoginPasswordUpdated'), 'ok');
      setOldPwd(''); setNewPwd(''); setConfirmPwd('');
      return true;
    } catch (_e) {
      showToast(_e?.message || t('errorLoginPasswordUpdate'), 'error');
      return false;
    } finally {
      setPwdSaving(false);
    }
  };

  const onChangeTradePassword = async () => {
    if (!loginPwdForTrade) { showToast(t('errorLoginVerifyFailed'), 'error'); return false; }
    const pin = String(newTradePwd || '').replace(/\D/g, '');
    if (pin.length !== 6) { showToast(t('errorTradePinLength'), 'error'); return false; }
    try {
      setTradeSaving(true);
      await api.post('/me/trade-password', { password: newTradePwd, login: loginPwdForTrade });
      // 成功后更新本地
      const next = readUsers().map(u => u.id === user?.id ? { ...u, tradePassword: pin } : u);
      saveUsers(next);
      setUsers(next);
      setLoginPwdForTrade(''); setNewTradePwd('');
      showToast(t('successTradePinUpdated'), 'ok');
      return true;
    } catch (_e) {
      showToast(_e?.message || t('errorTradePinUpdate'), 'error');
      return false;
    } finally {
      setTradeSaving(false);
    }
  };

  // 两列布局 + 弹窗修改交互
  const [modal, setModal] = useState({ type: null });
  const openModal = (type) => {
    // 打开弹窗时清空相关输入，避免浏览器自动填充造成误判
    if (type === 'loginPwd') { setOldPwd(''); setNewPwd(''); setConfirmPwd(''); }
    if (type === 'tradePwd') { setLoginPwdForTrade(''); setNewTradePwd(''); setConfirmPwd(''); }
    setModal({ type });
  };
  const closeModal = () => {
    if (modal.type === 'loginPwd') { setOldPwd(''); setNewPwd(''); setConfirmPwd(''); }
    if (modal.type === 'tradePwd') { setLoginPwdForTrade(''); setNewTradePwd(''); setConfirmPwd(''); }
    setModal({ type: null });
  };
  const [kycStatus, setKycStatus] = useState(() => { try { return localStorage.getItem('kyc:status') || 'unverified'; } catch { return 'unverified'; } });
  const [kycName, setKycName] = useState(() => (user?.name || ''));
  const [kycDocType, setKycDocType] = useState('passport');
  const [kycDocNo, setKycDocNo] = useState('');
  const [kycImages, setKycImages] = useState([]);
  const [kycSubmitting, setKycSubmitting] = useState(false);
  const kycFileRefs = [useRef(null), useRef(null)];
  useEffect(() => { setKycName(user?.name || ''); }, [user?.name]);
  useEffect(() => { (async () => { try { const data = await api.get('/me/kyc/status'); let s = String((data?.status || '')).toLowerCase(); if (!s) s = 'none'; if (s === 'none') s = 'unverified'; setKycStatus(s); try { localStorage.setItem('kyc:status', s); } catch { } } catch { } })(); }, []);
  const openKycModal = () => {
    if (String(kycStatus).toLowerCase() === 'submitted') {
      showToast(lang === 'zh' ? '正在审核中' : (lang === 'pl' ? 'W trakcie przeglądu' : 'Under review'), 'info');
      return;
    }
    setKycName(user?.name || ''); setKycDocType('passport'); setKycDocNo(''); setKycImages([]); setModal({ type: 'kyc' });
  };
  async function compressImageFile(file) {
    return new Promise((resolve, reject) => {
      try {
        const img = new Image();
        img.onload = () => {
          const maxDim = 1400;
          let w = img.width;
          let h = img.height;
          const scale = Math.min(1, maxDim / Math.max(w, h));
          w = Math.max(1, Math.round(w * scale));
          h = Math.max(1, Math.round(h * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          const quality = 0.85;
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(dataUrl);
        };
        img.onerror = () => reject(new Error('image_load_failed'));
        const reader = new FileReader();
        reader.onload = () => { img.src = String(reader.result || ''); };
        reader.onerror = () => reject(new Error('file_read_failed'));
        reader.readAsDataURL(file);
      } catch (err) { reject(err); }
    });
  }
  const onKycFileAt = async (i, e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const dataUrl = await compressImageFile(f);
      const approxBytes = Math.ceil((dataUrl.length || 0) * 3 / 4);
      if (approxBytes > 18 * 1024 * 1024) { showToast(lang === 'zh' ? '图片过大' : (lang === 'pl' ? 'Obraz zbyt duży' : 'Image too large'), 'error'); return; }
      setKycImages(prev => { const arr = [...prev]; arr[i] = dataUrl; return arr.slice(0, 2); });
    } catch { showToast(lang === 'zh' ? '图片处理失败' : (lang === 'pl' ? 'Przetwarzanie obrazu nie powiodło się' : 'Image processing failed'), 'error'); }
  };
  const submitKyc = async () => {
    const nm = String(kycName || '').trim();
    const dt = String(kycDocType || '').trim();
    const dn = String(kycDocNo || '').trim();
    if (nm.length < 2) { showToast(t('errorNameLength'), 'error'); return; }
    if (!dt) { showToast(t('fetchError'), 'error'); return; }
    if (!dn) { showToast(t('fetchError'), 'error'); return; }
    const photos = (Array.isArray(kycImages) ? kycImages.filter(Boolean).slice(0, 2) : []).map(u => ({ url: u, thumbUrl: u }));
    if (photos.length === 0) { showToast(t('fetchError'), 'error'); return; }
    try {
      setKycSubmitting(true);
      await api.post('/me/kyc/submit', { fields: { name: nm, idType: dt, idNumber: dn }, photos });
      setKycStatus('submitted');
      try { localStorage.setItem('kyc:status', 'submitted'); } catch { }
      showToast(lang === 'zh' ? '已提交审核' : (lang === 'pl' ? 'Przesłano do przeglądu' : 'Submitted for review'), 'ok');
      setModal({ type: null });
    } catch (e) {
      const raw = String(e?.message || 'Failed');
      const msg = raw.toLowerCase().includes('payload_too_large') ? (lang === 'zh' ? '图片过大' : (lang === 'pl' ? 'Obraz zbyt duży' : 'Image too large')) : String(e?.message || 'Failed');
      if (/pending\s*review|submitted/i.test(msg)) {
        setKycStatus('submitted');
        try { localStorage.setItem('kyc:status', 'submitted'); } catch { }
        showToast(lang === 'zh' ? '已提交审核，请等待' : (lang === 'pl' ? 'Już przesłane, oczekuje na przegląd' : 'Already submitted, pending review'), 'warn');
        setModal({ type: null });
        return;
      }
      if (/already\s*approved/i.test(msg)) {
        setKycStatus('approved');
        try { localStorage.setItem('kyc:status', 'approved'); } catch { }
        showToast(lang === 'zh' ? '已通过，无需重复提交' : (lang === 'pl' ? 'Już zatwierdzone' : 'Already approved'), 'ok');
        setModal({ type: null });
        return;
      }
      showToast(msg, 'error');
    } finally {
      setKycSubmitting(false);
    }
  };

  // 客服入口：打开 IM 系统的 customer.html，并传入当前用户手机号/昵称/头像
  const openCustomerSupport = () => {
    const base = (() => {
      try { const v = String(localStorage.getItem('im:base') || '').trim(); if (v) return v; } catch { }
      try { const v = String(import.meta.env?.VITE_IM_BASE || '').trim(); if (v) return v; } catch { }
      return '/im-api';
    })();
    try { localStorage.setItem('im:base', base); } catch { }
    const ver = (() => { try { return String(localStorage.getItem('buildVersion') || '') } catch { return '' } })() || String(Date.now())
    const url = `${String(base).replace(/\/$/, '')}/customer.html?phone=${encodeURIComponent(phone || '')}&name=${encodeURIComponent(name || '')}&avatar=${encodeURIComponent(avatarUrl || '')}&v=${encodeURIComponent(ver)}`;
    window.open(url, 'customer_chat', 'width=460,height=720');
  };

  return (
    <div className="screen borderless">
      {toast.show && (
        <div className={`top-toast ${toast.type}`}>{toast.text}</div>
      )}
      <div className="card borderless-card" style={{ width: '100%' }}>
        <h1 className="title">{t('settingsTitle')}</h1>
        <div className="settings-grid">
          {/* 左列：头像与基础信息（按规范左右布局） */}
          <div className="settings-col">
            {/* 头像：移除标签与按钮，点击头像触发上传 */}
            <div className="avatar-inline">
              <img src={avatarUrl || "/logo.jpg"} alt="avatar" className="settings-avatar clickable" onClick={onPickAvatar} />
              <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onAvatarSelected} style={{ display: 'none' }} />
            </div>

            {/* 姓名：左右布局，点击右侧弹出修改弹窗 */}
            <div className="settings-item">
              <div className="item-label">{t('nameLabel')}</div>
              <button className="item-value-btn" onClick={() => openModal('name')}>{name || (lang === 'zh' ? '未设置' : (lang === 'pl' ? 'Nie ustawiono' : 'Not set'))}</button>
            </div>

            {/* 手机号码：只读显示 */}
            <div className="settings-item">
              <div className="item-label">{t('phoneLabel')}</div>
              <div className="item-value-text muted">{phone || '—'}</div>
            </div>
          </div>

          {/* 右列：密码与语言（左右布局，按钮触发弹窗） */}
          <div className="settings-col">
            <div className="settings-item">
              <div className="item-label">{t('loginPwdLabel')}</div>
              <button className="item-value-btn" onClick={() => openModal('loginPwd')}>{t('changeLabel')}</button>
            </div>
            <div className="settings-item">
              <div className="item-label">{t('tradePwdLabel')}</div>
              <button className="item-value-btn" onClick={() => openModal('tradePwd')}>{t('changeLabel')}</button>
            </div>
            <div className="settings-item">
              <div className="item-label">{t('kycTitle')}</div>
              {kycStatus === 'approved' ? (
                <div className="item-value-btn" style={{ cursor: 'default' }}>{lang === 'zh' ? '已验证' : (lang === 'pl' ? 'Zweryfikowany' : 'Verified')}</div>
              ) : (
                <button className="item-value-btn" onClick={openKycModal}>
                  {kycStatus === 'submitted' ? (lang === 'zh' ? '审核中' : (lang === 'pl' ? 'W trakcie przeglądu' : 'Under review')) : (lang === 'zh' ? '未验证' : (lang === 'pl' ? 'Niezweryfikowany' : 'Not verified'))}
                </button>
              )}
            </div>
            <div className="settings-item">
              <div className="item-label">{t('languageLabel')}</div>
              <button className="item-value-btn" onClick={() => openModal('lang')}>
                {lang === 'zh' ? t('langChinese') : (lang === 'en' ? t('langEnglish') : t('langPolish'))} <span className="chevron">▾</span>
              </button>
            </div>
            <div className="sub-actions" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => nav('/me')}>{t('btnBackProfile')}</button>
            </div>
          </div>
        </div>
        {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
      </div>

      {/* 弹窗：姓名修改 */}
      {modal.type === 'name' && (
        <div className="modal">
          <div className="modal-card">
            <h2 className="title" style={{ marginTop: 0 }}>{t('changeNameTitle')}</h2>
            <div className="form">
              <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder={t('placeholderName')} />
              <div className="sub-actions" style={{ justifyContent: 'flex-end', gap: 10 }}>
                <button className="btn" onClick={closeModal}>{t('cancel')}</button>
                <button className="btn primary" onClick={async () => { const ok = await onSaveName(); if (ok) closeModal(); }}>{t('confirm')}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 弹窗：登录密码 */}
      {modal.type === 'loginPwd' && (
        <div className="modal">
          <div className="modal-card">
            <h2 className="title" style={{ marginTop: 0 }}>{t('changePassword')}</h2>
            <div className="form">
              <div className="label">{t('currentPassword')}</div>
              <input className="input" type="password" placeholder={t('currentPassword')} value={oldPwd} onChange={e => setOldPwd(e.target.value)} />
              <div className="label">{t('placeholderNewPassword')}</div>
              <input className="input" type="password" placeholder={t('placeholderNewPassword')} value={newPwd} onChange={e => setNewPwd(e.target.value)} />
              <div className="label">{t('placeholderConfirm')}</div>
              <input className="input" type="password" placeholder={t('placeholderConfirm')} value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)} />
              <div className="sub-actions" style={{ justifyContent: 'flex-end', gap: 10 }}>
                <button className="btn" onClick={closeModal}>{t('cancel')}</button>
                <button className="btn primary" disabled={pwdSaving} onClick={async () => { const ok = await onChangeLoginPassword(); if (ok) closeModal(); }}>{pwdSaving ? t('saving') : t('confirm')}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 弹窗：提现密码 */}
      {modal.type === 'tradePwd' && (
        <div className="modal">
          <div className="modal-card">
            <h2 className="title" style={{ marginTop: 0 }}>{t('changeTradePinTitle')}</h2>
            <div className="form">
              <div className="label">{t('verifyWithLoginPassword')}</div>
              <input className="input" type="password" placeholder={t('verifyWithLoginPassword')} value={loginPwdForTrade} onChange={e => setLoginPwdForTrade(e.target.value)} />
              <div className="label">{t('placeholderNewPin')}</div>
              <input className="input" inputMode="numeric" pattern="\\d{6}" maxLength={6} type="password" placeholder={t('placeholderNewPin')} value={newTradePwd} onChange={e => setNewTradePwd(e.target.value.replace(/\D/g, '').slice(0, 6))} />
              <div className="label">{t('placeholderConfirm')}</div>
              <input className="input" inputMode="numeric" pattern="\\d{6}" maxLength={6} type="password" placeholder={t('placeholderConfirm')} value={confirmPwd} onChange={e => setConfirmPwd(e.target.value.replace(/\D/g, '').slice(0, 6))} />
              <div className="sub-actions" style={{ justifyContent: 'flex-end', gap: 10 }}>
                <button className="btn" onClick={closeModal}>{t('cancel')}</button>
                <button className="btn primary" disabled={tradeSaving} onClick={async () => { if (newTradePwd.replace(/\D/g, '') !== confirmPwd.replace(/\D/g, '')) { showToast(t('errorConfirmMismatch'), 'error'); return; } const ok = await onChangeTradePassword(); if (ok) closeModal(); }}>{tradeSaving ? t('saving') : t('confirm')}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 弹窗：语言选择 */}
      {modal.type === 'lang' && (
        <div className="modal">
          <div className="modal-card">
            <h2 className="title" style={{ marginTop: 0 }}>{t('chooseLanguage')}</h2>
            <div className="form" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button 
                onClick={async () => { try { await api.post('/me/lang', { lang: 'en' }); } catch { } setLang('en'); closeModal(); }}
                style={{
                  padding: '14px 20px',
                  fontSize: 16,
                  fontWeight: 600,
                  borderRadius: 10,
                  cursor: 'pointer',
                  border: lang === 'en' ? '2px solid #3b82f6' : '2px solid rgba(255,255,255,0.2)',
                  background: lang === 'en' ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.05)',
                  color: lang === 'en' ? '#60a5fa' : '#e5e7eb',
                  transition: 'all 0.2s'
                }}
              >
                🇬🇧 English
              </button>
              <button 
                onClick={async () => { try { await api.post('/me/lang', { lang: 'zh' }); } catch { } setLang('zh'); closeModal(); }}
                style={{
                  padding: '14px 20px',
                  fontSize: 16,
                  fontWeight: 600,
                  borderRadius: 10,
                  cursor: 'pointer',
                  border: lang === 'zh' ? '2px solid #3b82f6' : '2px solid rgba(255,255,255,0.2)',
                  background: lang === 'zh' ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.05)',
                  color: lang === 'zh' ? '#60a5fa' : '#e5e7eb',
                  transition: 'all 0.2s'
                }}
              >
                🇨🇳 简体中文
              </button>
              <button 
                onClick={async () => { try { await api.post('/me/lang', { lang: 'pl' }); } catch { } setLang('pl'); closeModal(); }}
                style={{
                  padding: '14px 20px',
                  fontSize: 16,
                  fontWeight: 600,
                  borderRadius: 10,
                  cursor: 'pointer',
                  border: lang === 'pl' ? '2px solid #3b82f6' : '2px solid rgba(255,255,255,0.2)',
                  background: lang === 'pl' ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.05)',
                  color: lang === 'pl' ? '#60a5fa' : '#e5e7eb',
                  transition: 'all 0.2s'
                }}
              >
                🇵🇱 Polski
              </button>
            </div>
            <div className="desc" style={{ marginTop: 12, textAlign: 'center' }}>{t('langSwitchInstant')}</div>
          </div>
        </div>
      )}
      {modal.type === 'kyc' && (
        <div className="modal">
          <div className="modal-card">
            <h2 className="title" style={{ marginTop: 0 }}>{t('kycTitle')}</h2>
            <div className="form">
              <div className="label">{t('nameLabel')}</div>
              <input className="input" value={kycName} onChange={e => setKycName(e.target.value)} />
              <div className="label">{lang === 'zh' ? '证件类型' : (lang === 'pl' ? 'Typ dokumentu' : 'Document Type')}</div>
              <select className="input" value={kycDocType} onChange={e => setKycDocType(e.target.value)}>
                <option value="passport">{lang === 'zh' ? '护照' : (lang === 'pl' ? 'Paszport' : 'Passport')}</option>
                <option value="dni">{lang === 'zh' ? '身份证' : (lang === 'pl' ? 'Dowód osobisty' : 'ID')}</option>
                <option value="dl">{lang === 'zh' ? '驾驶证' : (lang === 'pl' ? 'Prawo jazdy' : 'Driver License')}</option>
              </select>
              <div className="label">{lang === 'zh' ? '证件号码' : (lang === 'pl' ? 'Numer dokumentu' : 'Document Number')}</div>
              <input className="input" value={kycDocNo} onChange={e => setKycDocNo(e.target.value)} />
              <div className="desc" style={{ marginTop: 8 }}>{lang === 'zh' ? '请上传相应的证件照片' : (lang === 'pl' ? 'Prześlij odpowiednie zdjęcie dokumentu' : 'Please upload the corresponding document photo')}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                {[0, 1].map((i) => (
                  <div key={i} style={{ width: 80, height: 80, border: '1px dashed #263b5e', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} onClick={() => { if (String(kycStatus).toLowerCase() === 'submitted') { showToast(lang === 'zh' ? '正在审核中' : (lang === 'pl' ? 'W trakcie przeglądu' : 'Under review'), 'info'); return; } kycFileRefs[i].current?.click(); }}>
                    {kycImages[i] ? (<img src={kycImages[i]} alt="doc" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 10, border: '1px solid #263b5e' }} />) : '+'}
                    <input ref={kycFileRefs[i]} type="file" accept="image/*" onChange={(e) => onKycFileAt(i, e)} style={{ display: 'none' }} />
                  </div>
                ))}
              </div>
              <div className="sub-actions" style={{ justifyContent: 'space-between' }}>
                <button className="btn" onClick={closeModal}>{t('cancel')}</button>
                <button className="btn primary" disabled={kycSubmitting} onClick={submitKyc}>{kycSubmitting ? t('saving') : t('confirm')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}