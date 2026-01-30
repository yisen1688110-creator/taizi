import BottomNav from "../components/BottomNav.jsx";
import { useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n.jsx";
import { api } from "../services/api.js";
import "../styles/profile.css";
import { formatMoney, formatPLN, formatUSDT } from "../utils/money.js";
import { loginPhone } from "../services/auth.js";

function readSession() {
  try { return JSON.parse(localStorage.getItem("sessionUser") || "null"); } catch { return null; }
}
function readUsers() {
  try { return JSON.parse(localStorage.getItem("users") || "[]"); } catch { return []; }
}

// 使用统一工具函数格式化金额

// 校验工具
const validators = {
  name: (v) => typeof v === "string" && v.trim().length >= 2 && v.trim().length <= 20,
  phone: (v) => /\d{10,20}/.test(String(v || "")),
  cardNumber: (v) => /^\d{12,19}$/.test(String(v || "")),
  cvv: (v) => /^\d{3,4}$/.test(String(v || "")),
  exp: (v) => /^(0[1-9]|1[0-2])\/(\d{2})$/.test(String(v || "")),
  eth: (addr) => /^0x[0-9a-fA-F]{40}$/.test(String(addr || "")),
  tron: (addr) => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(String(addr || "")), // 简化版 Base58 校验
  imageType: (file) => ["image/jpeg", "image/png"].includes(file?.type || ""),
  imageSize: (file) => (file?.size || 0) <= 2 * 1024 * 1024,
};

function saveUsers(list) {
  try { localStorage.setItem("users", JSON.stringify(list)); } catch { }
}

export default function Profile() {
  const nav = useNavigate();
  const { lang, setLang, t } = useI18n();
  const [session, setSession] = useState(() => readSession());
  const [users, setUsers] = useState(() => readUsers());
  const [, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);

  // 设置相关状态
  const [modal, setModal] = useState({ type: null });
  const [name, setName] = useState("");
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [pwdSaving, setPwdSaving] = useState(false);
  const [loginPwdForTrade, setLoginPwdForTrade] = useState("");
  const [newTradePwd, setNewTradePwd] = useState("");
  const [tradeSaving, setTradeSaving] = useState(false);
  const [toast, setToast] = useState({ show: false, type: "info", text: "" });
  const [kycStatus, setKycStatus] = useState(() => { try { return localStorage.getItem('kyc:status') || 'unverified'; } catch { return 'unverified'; } });
  
  // KYC 相关状态
  const [kycName, setKycName] = useState("");
  const [kycDocType, setKycDocType] = useState('passport');
  const [kycDocNo, setKycDocNo] = useState('');
  const [kycImages, setKycImages] = useState([]);
  const [kycSubmitting, setKycSubmitting] = useState(false);
  const kycFileRefs = [useRef(null), useRef(null)];
  
  const showToast = (text, type = "info") => {
    setToast({ show: true, type, text });
    setTimeout(() => setToast({ show: false, type, text: "" }), 1500);
  };

  useEffect(() => {
    const updateUnread = () => {
      try {
        const c = parseInt(localStorage.getItem('im:unread_count') || '0', 10);
        setUnreadCount(Number.isFinite(c) ? c : 0);
      } catch { setUnreadCount(0); }
    };
    updateUnread();
    window.addEventListener('im:unread', updateUnread);
    window.addEventListener('storage', (e) => { if (e.key === 'im:unread_count') updateUnread(); });
    return () => {
      window.removeEventListener('im:unread', updateUnread);
      window.removeEventListener('storage', updateUnread);
    };
  }, []);

  // 获取 KYC 状态
  useEffect(() => {
    (async () => {
      try {
        const data = await api.get('/me/kyc/status');
        let s = String((data?.status || '')).toLowerCase();
        if (!s) s = 'none';
        if (s === 'none') s = 'unverified';
        setKycStatus(s);
        try { localStorage.setItem('kyc:status', s); } catch { }
      } catch { }
    })();
  }, []);

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

  // 用户信息
  const user = useMemo(() => {
    if (!session) return null;
    const byId = users.find(u => u.id && u.id === session.id);
    const byPhone = users.find(u => u.phone === session.phone);
    return byId || byPhone || session;
  }, [session, users]);
  function normalizeAvatar(u) {
    try {
      const s = String(u || '').trim();
      if (!s) return '/logo.jpg';
      if (/^data:image\/(png|jpeg);base64,/i.test(s)) return s;
      if (/^https?:\/\//i.test(s)) return s;
      if (s.startsWith('/')) return s;
      if (/^[\w\-/.]+$/.test(s)) return `/uploads/${s.replace(/^\/+/, '')}`;
      return '/logo.jpg';
    } catch { return '/logo.jpg'; }
  }
  const [avatarUrl, setAvatarUrl] = useState(() => normalizeAvatar(session?.avatar || session?.avatarUrl || (user?.avatar || user?.avatarUrl) || (JSON.parse(localStorage.getItem('avatarUrl') || 'null') || '')));
  const fileInputRef = useRef(null);

  // 资金（PLN / USD / EUR / USDT），从后端余额接口匹配真实数据（与 Home/Swap 同源逻辑）
  const [funds, setFunds] = useState({ pln: 0, usd: 0, eur: 0, usdt: 0 });
  const [selectedCurrency, setSelectedCurrency] = useState('PLN'); // 当前选择的货币
  const [currencyDropdownOpen, setCurrencyDropdownOpen] = useState(false);
  useEffect(() => {
    let stopped = false;
    async function fetchBalances() {
      setError("");
      try {
        setLoading(true);
        // 解析后端用户ID（与 Home/Swap 保持一致）
        let uid = Number(session?.id ?? session?.backendId);
        if (!uid && session?.phone) {
          try {
            const res = await api.get(`/admin/users?q=${encodeURIComponent(session.phone)}`);
            const arr = Array.isArray(res?.users) ? res.users : [];
            const match = arr.find(u => String(u.phone) === String(session.phone));
            if (match && Number(match.id)) uid = Number(match.id);
          } catch { }
        }
        if (!uid) { setLoading(false); return; }
        let data;
        try { data = await api.get(`/me/balances`); }
        catch { data = await api.get(`/admin/users/${uid}/balances`); }
        const arr = Array.isArray(data?.balances) ? data.balances : [];
        const map = arr.reduce((m, r) => { m[String(r.currency).toUpperCase()] = Number(r.amount || 0); return m; }, {});
        if (stopped) return;
        try {
          const sess = JSON.parse(localStorage.getItem('sessionUser') || 'null');
          const uid = sess?.id || sess?.phone || 'guest';
          const holds = JSON.parse(localStorage.getItem(`withdraw:holds:${uid}`) || '[]');
          const activeHolds = Array.isArray(holds) ? holds.filter(h => h.status === 'active') : [];
          const sumHold = (cur) => activeHolds.filter(h => String(h.currency) === cur).reduce((s, h) => s + Number(h.amount || 0), 0);
          setFunds({
            pln: (Number.isFinite(map.PLN) ? map.PLN : 0) - sumHold('PLN'),
            usd: (Number.isFinite(map.USD) ? map.USD : 0),
            eur: (Number.isFinite(map.EUR) ? map.EUR : 0),
            usdt: (Number.isFinite(map.USDT) ? map.USDT : 0),
          });
        } catch {
          setFunds({
            pln: Number.isFinite(map.PLN) ? map.PLN : 0,
            usd: Number.isFinite(map.USD) ? map.USD : 0,
            eur: Number.isFinite(map.EUR) ? map.EUR : 0,
            usdt: Number.isFinite(map.USDT) ? map.USDT : 0,
          });
        }
      } catch (_) {
        if (stopped) return;
        setFunds({ pln: 0, usd: 0, eur: 0, usdt: 0 });
      } finally { if (!stopped) setLoading(false); }
    }
    fetchBalances();
    const onHoldChanged = () => { fetchBalances(); };
    try { window.addEventListener('withdraw_hold_changed', onHoldChanged); } catch { }
    try { window.addEventListener('credit_debt_changed', onHoldChanged); } catch { }
    const onStorage = (e) => { try { const k = String(e?.key || ''); if (!k) { fetchBalances(); return; } if (k.startsWith('withdraw:holds') || k === 'credit:debts') fetchBalances(); } catch { } };
    window.addEventListener('storage', onStorage);
    return () => { stopped = true; try { window.removeEventListener('withdraw_hold_changed', onHoldChanged); } catch { }; try { window.removeEventListener('credit_debt_changed', onHoldChanged); } catch { }; try { window.removeEventListener('storage', onStorage); } catch { } };
  }, [session?.id, session?.backendId, session?.phone]);

  // 头像上传
  const onPickAvatar = () => fileInputRef.current?.click();
  const onAvatarSelected = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!validators.imageType(file)) { alert(lang === 'pl' ? 'Formato inválido (JPG/PNG)' : 'Invalid format (JPG/PNG)'); return; }
    if (!validators.imageSize(file)) { alert(lang === 'pl' ? 'Imagen > 2MB' : 'Image > 2MB'); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result;
      try {
        setLoading(true);
        await api.post('/me/avatar', { data: base64 });
        try {
          const meData = await api.get('/me');
          const u = (meData && (meData.user || meData)) || null;
          if (u) {
            try { localStorage.setItem('sessionUser', JSON.stringify(u)); } catch { }
            setSession(u);
            try {
              const users = JSON.parse(localStorage.getItem('users') || '[]');
              const next = users.map(m => (m.id === u.id ? { ...m, avatarUrl: u.avatar || base64 } : m));
              localStorage.setItem('users', JSON.stringify(next));
              setUsers(next);
            } catch { }
          }
        } catch { }
      } catch (_) { /* 后端不可用则本地保存 */ }
      finally {
        setLoading(false);
        try { localStorage.setItem('avatarUrl', JSON.stringify(base64)); } catch { }
        setAvatarUrl(normalizeAvatar(base64));
      }
    };
    reader.readAsDataURL(file);
  };

  // 会话/存储变化时刷新头像（避免使用旧本地缓存）
  useEffect(() => {
    const applyFromSession = () => {
      try {
        const s = JSON.parse(localStorage.getItem('sessionUser') || 'null');
        if (s) { setSession(s); setAvatarUrl(normalizeAvatar(s.avatar || s.avatarUrl || '')); }
      } catch { }
    };
    applyFromSession();
    const onStorage = (e) => { if (!e || !e.key || e.key === 'sessionUser') applyFromSession(); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // 页面进入时从后端读取最新用户信息，确保头像为最新路径
  useEffect(() => {
    (async () => {
      try {
        const me = await api.get('/me');
        const u = (me && (me.user || me)) || null;
        if (u) {
          try { localStorage.setItem('sessionUser', JSON.stringify(u)); } catch { }
          setSession(u);
          setAvatarUrl(normalizeAvatar(u.avatar || u.avatarUrl || ''));
        }
      } catch { }
    })();
  }, []);

  // 设置名称同步
  useEffect(() => { setName(user?.name || ""); }, [user?.name]);

  // 保存姓名
  const onSaveName = async () => {
    const v = String(name || '').trim();
    if (v.length < 2 || v.length > 20) { showToast(t('errorNameLength'), 'error'); return false; }
    try {
      await api.post('/me/name', { name: v });
      const next = readUsers().map(u => u.id === user?.id ? { ...u, name: v } : u);
      saveUsers(next); setUsers(next);
      const s = { ...session, name: v };
      try { localStorage.setItem('sessionUser', JSON.stringify(s)); } catch { }
      setSession(s);
      showToast(t('successNameUpdated'), 'ok');
      return true;
    } catch (_e) {
      showToast(t('errorNameSaveFailed'), 'error');
      return false;
    }
  };

  // 修改登录密码
  const onChangeLoginPassword = async () => {
    if (!oldPwd) { showToast(t('errorOldPasswordWrong'), 'error'); return false; }
    if (!newPwd || newPwd.length < 6) { showToast(t('errorNewPasswordLength'), 'error'); return false; }
    if (newPwd !== confirmPwd) { showToast(t('errorConfirmMismatch'), 'error'); return false; }
    try {
      setPwdSaving(true);
      await api.post(`/me/password`, { old: oldPwd, password: newPwd });
      const next = readUsers().map(u => u.id === user?.id ? { ...u, password: newPwd } : u);
      saveUsers(next); setUsers(next);
      const s = { ...session, password: newPwd };
      try { localStorage.setItem('sessionUser', JSON.stringify(s)); } catch { }
      setSession(s);
      showToast(t('successLoginPasswordUpdated'), 'ok');
      setOldPwd(''); setNewPwd(''); setConfirmPwd('');
      return true;
    } catch (_e) {
      showToast(_e?.message || t('errorLoginPasswordUpdate'), 'error');
      return false;
    } finally { setPwdSaving(false); }
  };

  // 修改交易密码
  const onChangeTradePassword = async () => {
    if (!loginPwdForTrade) { showToast(t('errorLoginVerifyFailed'), 'error'); return false; }
    const pin = String(newTradePwd || '').replace(/\D/g, '');
    if (pin.length !== 6) { showToast(t('errorTradePinLength'), 'error'); return false; }
    try {
      setTradeSaving(true);
      await api.post('/me/trade-password', { password: newTradePwd, login: loginPwdForTrade });
      const next = readUsers().map(u => u.id === user?.id ? { ...u, tradePassword: pin } : u);
      saveUsers(next); setUsers(next);
      setLoginPwdForTrade(''); setNewTradePwd('');
      showToast(t('successTradePinUpdated'), 'ok');
      return true;
    } catch (_e) {
      showToast(_e?.message || t('errorTradePinUpdate'), 'error');
      return false;
    } finally { setTradeSaving(false); }
  };

  const openModal = (type) => {
    if (type === 'loginPwd') { setOldPwd(''); setNewPwd(''); setConfirmPwd(''); }
    if (type === 'tradePwd') { setLoginPwdForTrade(''); setNewTradePwd(''); setConfirmPwd(''); }
    setModal({ type });
  };
  const closeModal = () => {
    if (modal.type === 'loginPwd') { setOldPwd(''); setNewPwd(''); setConfirmPwd(''); }
    if (modal.type === 'tradePwd') { setLoginPwdForTrade(''); setNewTradePwd(''); setConfirmPwd(''); }
    if (modal.type === 'kyc') { setKycName(''); setKycDocType('passport'); setKycDocNo(''); setKycImages([]); }
    setModal({ type: null });
  };

  // KYC 相关函数
  const openKycModal = () => {
    if (String(kycStatus).toLowerCase() === 'submitted') {
      showToast(lang === 'zh' ? '正在审核中' : (lang === 'pl' ? 'W trakcie przeglądu' : 'Under review'), 'info');
      return;
    }
    if (String(kycStatus).toLowerCase() === 'approved') {
      showToast(lang === 'zh' ? '已通过验证' : (lang === 'pl' ? 'Już zweryfikowany' : 'Already verified'), 'ok');
      return;
    }
    setKycName(me?.name || ''); setKycDocType('passport'); setKycDocNo(''); setKycImages([]);
    setModal({ type: 'kyc' });
  };

  async function compressImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const maxW = 1200, maxH = 1200;
          let w = img.width, h = img.height;
          if (w > maxW || h > maxH) {
            const ratio = Math.min(maxW / w, maxH / h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  const onKycFileAt = async (idx, e) => {
    try {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!validators.imageType(file)) { showToast(lang === 'zh' ? '仅支持 JPG/PNG' : 'Only JPG/PNG', 'error'); return; }
      const dataUrl = await compressImageFile(file);
      setKycImages(prev => { const arr = [...prev]; arr[idx] = dataUrl; return arr; });
    } catch { showToast(lang === 'zh' ? '图片处理失败' : 'Image processing failed', 'error'); }
  };

  const submitKyc = async () => {
    const nm = String(kycName || '').trim();
    const dt = String(kycDocType || '').trim();
    const dn = String(kycDocNo || '').trim();
    if (nm.length < 2) { showToast(t('errorNameLength'), 'error'); return; }
    if (!dt) { showToast(lang === 'zh' ? '请选择证件类型' : 'Please select document type', 'error'); return; }
    if (!dn) { showToast(lang === 'zh' ? '请输入证件号码' : 'Please enter document number', 'error'); return; }
    const photos = (Array.isArray(kycImages) ? kycImages.filter(Boolean).slice(0, 2) : []).map(u => ({ url: u, thumbUrl: u }));
    if (photos.length === 0) { showToast(lang === 'zh' ? '请上传证件照片' : 'Please upload document photo', 'error'); return; }
    try {
      setKycSubmitting(true);
      await api.post('/me/kyc/submit', { fields: { name: nm, idType: dt, idNumber: dn }, photos });
      setKycStatus('submitted');
      try { localStorage.setItem('kyc:status', 'submitted'); } catch { }
      showToast(lang === 'zh' ? '已提交审核' : 'Submitted for review', 'ok');
      setModal({ type: null });
    } catch (e) {
      const raw = String(e?.message || '');
      if (/pending\s*review|submitted/i.test(raw)) {
        setKycStatus('submitted');
        try { localStorage.setItem('kyc:status', 'submitted'); } catch { }
        showToast(lang === 'zh' ? '已提交审核，请等待' : 'Already submitted, pending review', 'warn');
        setModal({ type: null });
        return;
      }
      if (/already\s*approved/i.test(raw)) {
        setKycStatus('approved');
        try { localStorage.setItem('kyc:status', 'approved'); } catch { }
        showToast(lang === 'zh' ? '已通过，无需重复提交' : 'Already approved', 'ok');
        setModal({ type: null });
        return;
      }
      showToast(raw || (lang === 'zh' ? '提交失败' : 'Submit failed'), 'error');
    } finally { setKycSubmitting(false); }
  };

  // 功能菜单项 - 移除设置，保留其他功能
  const menuItems = [
    { icon: '💳', label: t('profileBankCards'), path: '/me/cards' },
    { icon: '📜', label: t('profileHistory'), path: '/trades' },
    { icon: '🛟', label: t('profileSupport'), path: '/me/support', badge: unreadCount },
    { icon: '💼', label: t('profileWallets') || (lang === 'zh' ? '钱包' : 'Wallets'), path: '/me/wallets' },
  ];

  return (
    <div className="screen profile-screen" style={{ 
      width: '100%', boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', alignItems: 'stretch',
      minHeight: '100vh', padding: 0, paddingBottom: 80, background: 'transparent',
      margin: 0
    }}>
      {/* 内容容器 - 铺满宽度 */}
      <div style={{ 
        width: '100%', 
        margin: 0,
        padding: 0,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        flex: 1
      }}>
      {/* 顶部：头像居中 + 用户名 - 铺满宽度 */}
      <div style={{ 
        display: 'flex', flexDirection: 'column', alignItems: 'center', 
        padding: '20px 16px', width: '100%', boxSizing: 'border-box',
        background: 'rgba(17,24,39,0.4)', borderBottom: '1px solid rgba(255,255,255,0.06)'
      }}>
        <div 
          onClick={onPickAvatar} 
          style={{ 
            width: 72, height: 72, borderRadius: '50%', overflow: 'hidden',
            border: '3px solid rgba(59,130,246,0.4)', cursor: 'pointer',
            boxShadow: '0 0 16px rgba(59,130,246,0.2)'
          }}
        >
          <img src={avatarUrl || "/logo.jpg"} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg" onChange={onAvatarSelected} style={{ display: 'none' }} />
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, color: '#e5e7eb', marginTop: 10 }}>
          {user?.name || user?.phone || t('profileUser')}
        </div>
      </div>

      {/* 资金卡片 - 铺满宽度无圆角 */}
      <div style={{ 
        background: 'rgba(17,24,39,0.6)', borderRadius: 0, padding: '16px',
        borderBottom: '1px solid rgba(255,255,255,0.06)', width: '100%', boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', alignItems: 'center'
      }}>
        {/* 货币选择下拉菜单 */}
        <div style={{ position: 'relative', marginBottom: 8 }}>
          <button 
            onClick={() => setCurrencyDropdownOpen(!currencyDropdownOpen)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)',
              borderRadius: 16, padding: '6px 14px', cursor: 'pointer',
              color: '#9ca3af', fontSize: 12
            }}
          >
            {t('profileAccountFunds')}
            <span style={{ color: '#3b82f6', fontWeight: 600 }}>{selectedCurrency}</span>
            <span style={{ fontSize: 10, opacity: 0.7 }}>▼</span>
          </button>
          
          {currencyDropdownOpen && (
            <div style={{
              position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
              marginTop: 4, background: 'rgba(30,41,59,0.98)', border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 10, overflow: 'hidden', zIndex: 100, minWidth: 120,
              boxShadow: '0 4px 20px rgba(0,0,0,0.4)'
            }}>
              {['PLN', 'USD', 'EUR', 'USDT'].map(cur => (
                <div 
                  key={cur}
                  onClick={() => { setSelectedCurrency(cur); setCurrencyDropdownOpen(false); }}
                  style={{
                    padding: '10px 16px', cursor: 'pointer',
                    background: selectedCurrency === cur ? 'rgba(59,130,246,0.2)' : 'transparent',
                    color: selectedCurrency === cur ? '#3b82f6' : '#e5e7eb',
                    fontWeight: selectedCurrency === cur ? 600 : 400,
                    fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
                    borderBottom: '1px solid rgba(255,255,255,0.06)'
                  }}
                >
                  <span>{cur === 'PLN' ? '🇵🇱' : cur === 'USD' ? '🇺🇸' : cur === 'EUR' ? '🇪🇺' : '💰'}</span>
                  <span>{cur}</span>
                  {cur === 'PLN' && <span style={{ fontSize: 10, color: '#6b7280' }}>{lang === 'zh' ? '波兰股' : 'PL'}</span>}
                  {cur === 'USD' && <span style={{ fontSize: 10, color: '#6b7280' }}>{lang === 'zh' ? '美股' : 'US'}</span>}
                  {cur === 'EUR' && <span style={{ fontSize: 10, color: '#6b7280' }}>{lang === 'zh' ? '欧元' : 'Euro'}</span>}
                  {cur === 'USDT' && <span style={{ fontSize: 10, color: '#6b7280' }}>{lang === 'zh' ? '加密' : 'Crypto'}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* 余额显示 */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 14, color: '#3b82f6', fontWeight: 600 }}>{selectedCurrency}</span>
          <span style={{ fontSize: 24, fontWeight: 700, color: '#e5e7eb' }}>
            {selectedCurrency === 'PLN' && formatPLN(funds.pln, lang)}
            {selectedCurrency === 'USD' && formatMoney(funds.usd, 'USD', lang)}
            {selectedCurrency === 'EUR' && `€${(funds.eur || 0).toFixed(2)}`}
            {selectedCurrency === 'USDT' && formatUSDT(funds.usdt, lang)}
          </span>
        </div>
        <button 
          onClick={() => nav('/me/withdraw')}
          style={{
            background: 'rgba(59,130,246,0.15)', color: '#3b82f6',
            border: '1px solid rgba(59,130,246,0.3)', padding: '10px 24px',
            borderRadius: 20, fontWeight: 500, fontSize: 13, cursor: 'pointer'
          }}
        >{t('profileWithdraw')}</button>
      </div>

      {/* 功能菜单 - 横向排列 */}
      <div style={{ 
        background: 'rgba(17,24,39,0.6)', borderRadius: 0, padding: '16px',
        borderBottom: '1px solid rgba(255,255,255,0.06)', width: '100%', boxSizing: 'border-box'
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {menuItems.map((item, idx) => (
            <div 
              key={idx} 
              onClick={() => {
                if (item.path === '/me/support') {
                  try { localStorage.setItem('im:unread_count', '0'); window.dispatchEvent(new Event('im:unread')); } catch { }
                }
                nav(item.path);
              }}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                padding: '12px 4px', borderRadius: 10, cursor: 'pointer',
                background: 'rgba(30, 41, 59, 0.5)', border: '1px solid rgba(255,255,255,0.06)'
              }}
            >
              <div style={{ 
                width: 40, height: 40, borderRadius: 10, 
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 20, background: 'rgba(59,130,246,0.12)', 
                border: '1px solid rgba(59,130,246,0.2)', position: 'relative'
              }}>
                {item.icon}
                {item.badge > 0 && (
                  <div style={{ 
                    position: 'absolute', top: -4, right: -4, 
                    background: '#ef4444', color: '#fff', fontSize: 9, 
                    height: 16, minWidth: 16, borderRadius: 8, 
                    display: 'flex', alignItems: 'center', justifyContent: 'center', 
                    padding: '0 4px', border: '2px solid #0d1220', fontWeight: 600
                  }}>{item.badge > 99 ? '99+' : item.badge}</div>
                )}
              </div>
              <div style={{ fontSize: 11, fontWeight: 500, color: '#e5e7eb', textAlign: 'center' }}>{item.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 账户设置 - 直接显示 */}
      <div style={{ 
        background: 'rgba(17,24,39,0.6)', borderRadius: 0, padding: '16px',
        borderBottom: '1px solid rgba(255,255,255,0.06)', width: '100%', boxSizing: 'border-box'
      }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#9ca3af', marginBottom: 12 }}>
          {lang === 'zh' ? '账户设置' : (lang === 'pl' ? 'Ustawienia konta' : 'Account Settings')}
        </div>
        
        {/* 姓名 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <span style={{ color: '#9ca3af', fontSize: 14 }}>{t('nameLabel')}</span>
          <span onClick={() => openModal('name')} style={{ color: '#3b82f6', fontSize: 14, cursor: 'pointer' }}>
            {user?.name || (lang === 'zh' ? '未设置' : 'Not set')}
          </span>
        </div>
        
        {/* 手机号 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <span style={{ color: '#9ca3af', fontSize: 14 }}>{t('phoneLabel')}</span>
          <span style={{ color: '#e5e7eb', fontSize: 14 }}>{user?.phone || '—'}</span>
        </div>
        
        {/* 登录密码 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <span style={{ color: '#9ca3af', fontSize: 14 }}>{t('loginPwdLabel')}</span>
          <span onClick={() => openModal('loginPwd')} style={{ color: '#3b82f6', fontSize: 14, cursor: 'pointer' }}>{t('changeLabel')}</span>
        </div>
        
        {/* 交易密码 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <span style={{ color: '#9ca3af', fontSize: 14 }}>{t('tradePwdLabel')}</span>
          <span onClick={() => openModal('tradePwd')} style={{ color: '#3b82f6', fontSize: 14, cursor: 'pointer' }}>{t('changeLabel')}</span>
        </div>
        
        {/* 身份验证 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <span style={{ color: '#9ca3af', fontSize: 14 }}>{t('kycTitle')}</span>
          <span 
            onClick={openKycModal}
            style={{ 
              color: kycStatus === 'approved' ? '#10b981' : (kycStatus === 'submitted' ? '#f59e0b' : '#ef4444'), 
              fontSize: 14, 
              cursor: 'pointer' 
            }}
          >
            {kycStatus === 'approved' ? (lang === 'zh' ? '已验证' : 'Verified') : 
             kycStatus === 'submitted' ? (lang === 'zh' ? '审核中' : 'Under review') : 
             (lang === 'zh' ? '未验证' : 'Not verified')}
          </span>
        </div>
        
        {/* 语言 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0' }}>
          <span style={{ color: '#9ca3af', fontSize: 14 }}>{t('languageLabel')}</span>
          <span onClick={() => openModal('lang')} style={{ color: '#3b82f6', fontSize: 14, cursor: 'pointer' }}>
            {lang === 'zh' ? '中文' : (lang === 'en' ? 'English' : 'Polski')} ▾
          </span>
        </div>
      </div>

      {/* 底部：版本和退出 */}
      <div style={{ 
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        padding: '20px 16px', marginTop: 'auto', width: '100%', boxSizing: 'border-box'
      }}>
        <div style={{ fontSize: 11, color: '#6b7280' }}>V1.0.1</div>
        <button 
          onClick={async () => {
            try { await api.post('/auth/logout', {}); } catch { }
            try { localStorage.removeItem('sessionUser'); localStorage.removeItem('token'); localStorage.removeItem('csrf:token'); } catch { }
            try { nav('/login'); } catch { }
          }}
          style={{
            background: 'rgba(255,255,255,0.05)', color: '#9ca3af',
            border: '1px solid rgba(255,255,255,0.08)', padding: '10px 32px',
            borderRadius: 20, fontWeight: 500, fontSize: 13, cursor: 'pointer'
          }}
        >{t('profileLogout')}</button>
        {error && <div style={{ color: '#ef4444', marginTop: 8 }}>{error}</div>}
      </div>
      </div>

      {/* Toast 提示 */}
      {toast.show && (
        <div style={{
          position: 'fixed', top: 60, left: '50%', transform: 'translateX(-50%)',
          background: toast.type === 'ok' ? 'rgba(16,185,129,0.95)' : toast.type === 'error' ? 'rgba(239,68,68,0.95)' : 'rgba(59,130,246,0.95)',
          color: '#fff', padding: '10px 20px', borderRadius: 8, fontSize: 14, fontWeight: 500, zIndex: 9999
        }}>{toast.text}</div>
      )}

      {/* 弹窗：姓名修改 */}
      {modal.type === 'name' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div style={{ background: '#1e293b', borderRadius: 12, padding: 20, width: '100%', maxWidth: 340 }}>
            <h3 style={{ margin: '0 0 16px', color: '#e5e7eb', fontSize: 16 }}>{t('changeNameTitle')}</h3>
            <input 
              value={name} onChange={e => setName(e.target.value)} 
              placeholder={t('placeholderName')}
              style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: 14, boxSizing: 'border-box', marginBottom: 16 }}
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={closeModal} style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#9ca3af', cursor: 'pointer' }}>{t('cancel')}</button>
              <button onClick={async () => { const ok = await onSaveName(); if (ok) closeModal(); }} style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer' }}>{t('confirm')}</button>
            </div>
          </div>
        </div>
      )}

      {/* 弹窗：登录密码 */}
      {modal.type === 'loginPwd' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div style={{ background: '#1e293b', borderRadius: 12, padding: 20, width: '100%', maxWidth: 340 }}>
            <h3 style={{ margin: '0 0 16px', color: '#e5e7eb', fontSize: 16 }}>{t('changePassword')}</h3>
            <input type="password" value={oldPwd} onChange={e => setOldPwd(e.target.value)} placeholder={t('currentPassword')} style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: 14, boxSizing: 'border-box', marginBottom: 10 }} />
            <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder={t('placeholderNewPassword')} style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: 14, boxSizing: 'border-box', marginBottom: 10 }} />
            <input type="password" value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)} placeholder={t('placeholderConfirm')} style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: 14, boxSizing: 'border-box', marginBottom: 16 }} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={closeModal} style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#9ca3af', cursor: 'pointer' }}>{t('cancel')}</button>
              <button disabled={pwdSaving} onClick={async () => { const ok = await onChangeLoginPassword(); if (ok) closeModal(); }} style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer', opacity: pwdSaving ? 0.6 : 1 }}>{pwdSaving ? '...' : t('confirm')}</button>
            </div>
          </div>
        </div>
      )}

      {/* 弹窗：交易密码 */}
      {modal.type === 'tradePwd' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div style={{ background: '#1e293b', borderRadius: 12, padding: 20, width: '100%', maxWidth: 340 }}>
            <h3 style={{ margin: '0 0 16px', color: '#e5e7eb', fontSize: 16 }}>{t('changeTradePinTitle')}</h3>
            <input type="password" value={loginPwdForTrade} onChange={e => setLoginPwdForTrade(e.target.value)} placeholder={t('verifyWithLoginPassword')} style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: 14, boxSizing: 'border-box', marginBottom: 10 }} />
            <input type="password" inputMode="numeric" maxLength={6} value={newTradePwd} onChange={e => setNewTradePwd(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder={t('placeholderNewPin')} style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: 14, boxSizing: 'border-box', marginBottom: 10 }} />
            <input type="password" inputMode="numeric" maxLength={6} value={confirmPwd} onChange={e => setConfirmPwd(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder={t('placeholderConfirm')} style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: 14, boxSizing: 'border-box', marginBottom: 16 }} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={closeModal} style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#9ca3af', cursor: 'pointer' }}>{t('cancel')}</button>
              <button disabled={tradeSaving} onClick={async () => { if (newTradePwd.replace(/\D/g, '') !== confirmPwd.replace(/\D/g, '')) { showToast(t('errorConfirmMismatch'), 'error'); return; } const ok = await onChangeTradePassword(); if (ok) closeModal(); }} style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer', opacity: tradeSaving ? 0.6 : 1 }}>{tradeSaving ? '...' : t('confirm')}</button>
            </div>
          </div>
        </div>
      )}

      {/* 弹窗：语言选择 */}
      {modal.type === 'lang' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div style={{ background: '#1e293b', borderRadius: 12, padding: 20, width: '100%', maxWidth: 340 }}>
            <h3 style={{ margin: '0 0 16px', color: '#e5e7eb', fontSize: 16 }}>{t('chooseLanguage')}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { code: 'en', label: '🇬🇧 English' },
                { code: 'zh', label: '🇨🇳 简体中文' },
                { code: 'pl', label: '🇵🇱 Polski' }
              ].map(item => (
                <button 
                  key={item.code}
                  onClick={async () => { try { await api.post('/me/lang', { lang: item.code }); } catch { } setLang(item.code); closeModal(); }}
                  style={{
                    padding: '14px 20px', fontSize: 16, fontWeight: 600, borderRadius: 10, cursor: 'pointer',
                    border: lang === item.code ? '2px solid #3b82f6' : '2px solid rgba(255,255,255,0.2)',
                    background: lang === item.code ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.05)',
                    color: lang === item.code ? '#60a5fa' : '#e5e7eb'
                  }}
                >{item.label}</button>
              ))}
            </div>
            <div style={{ textAlign: 'center', marginTop: 12, color: '#6b7280', fontSize: 12 }}>{t('langSwitchInstant')}</div>
          </div>
        </div>
      )}

      {/* 弹窗：KYC 身份验证 */}
      {modal.type === 'kyc' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div style={{ background: '#1e293b', borderRadius: 12, padding: 20, width: '100%', maxWidth: 360, maxHeight: '80vh', overflow: 'auto' }}>
            <h3 style={{ margin: '0 0 16px', color: '#e5e7eb', fontSize: 16 }}>{t('kycTitle')}</h3>
            
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', marginBottom: 6, color: '#9ca3af', fontSize: 13 }}>{t('nameLabel')}</label>
              <input 
                type="text" value={kycName} onChange={e => setKycName(e.target.value)}
                placeholder={t('placeholderName')}
                style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: 14, boxSizing: 'border-box' }}
              />
            </div>
            
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', marginBottom: 6, color: '#9ca3af', fontSize: 13 }}>{lang === 'zh' ? '证件类型' : (lang === 'pl' ? 'Typ dokumentu' : 'Document Type')}</label>
              <select 
                value={kycDocType} onChange={e => setKycDocType(e.target.value)}
                style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: '#1e293b', color: '#fff', fontSize: 14, boxSizing: 'border-box' }}
              >
                <option value="passport">{lang === 'zh' ? '护照' : (lang === 'pl' ? 'Paszport' : 'Passport')}</option>
                <option value="dni">{lang === 'zh' ? '身份证' : (lang === 'pl' ? 'Dowód osobisty' : 'ID Card')}</option>
                <option value="dl">{lang === 'zh' ? '驾驶证' : (lang === 'pl' ? 'Prawo jazdy' : 'Driver License')}</option>
              </select>
            </div>
            
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', marginBottom: 6, color: '#9ca3af', fontSize: 13 }}>{lang === 'zh' ? '证件号码' : (lang === 'pl' ? 'Numer dokumentu' : 'Document Number')}</label>
              <input 
                type="text" value={kycDocNo} onChange={e => setKycDocNo(e.target.value)}
                placeholder={lang === 'zh' ? '请输入证件号码' : 'Enter document number'}
                style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: 14, boxSizing: 'border-box' }}
              />
            </div>
            
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 6, color: '#9ca3af', fontSize: 13 }}>{lang === 'zh' ? '上传证件照片' : (lang === 'pl' ? 'Prześlij zdjęcie dokumentu' : 'Upload Document Photos')}</label>
              <div style={{ display: 'flex', gap: 12 }}>
                {[0, 1].map((i) => (
                  <div 
                    key={i}
                    onClick={() => kycFileRefs[i].current?.click()}
                    style={{ 
                      width: 80, height: 80, border: '2px dashed rgba(255,255,255,0.2)', borderRadius: 10, 
                      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                      background: 'rgba(255,255,255,0.03)', overflow: 'hidden'
                    }}
                  >
                    {kycImages[i] ? (
                      <img src={kycImages[i]} alt="doc" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ color: '#6b7280', fontSize: 24 }}>+</span>
                    )}
                    <input ref={kycFileRefs[i]} type="file" accept="image/*" onChange={(e) => onKycFileAt(i, e)} style={{ display: 'none' }} />
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 6 }}>{lang === 'zh' ? '正面 + 反面（或个人信息页）' : 'Front + Back (or info page)'}</div>
            </div>
            
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={closeModal} style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#9ca3af', cursor: 'pointer' }}>{t('cancel')}</button>
              <button disabled={kycSubmitting} onClick={submitKyc} style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer', opacity: kycSubmitting ? 0.6 : 1 }}>{kycSubmitting ? '...' : t('confirm')}</button>
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
