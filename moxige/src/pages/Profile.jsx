import BottomNav from "../components/BottomNav.jsx";
import { useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n.jsx";
import { api } from "../services/api.js";
import "../styles/profile.css";
import { formatMoney, formatPLN, formatUSDT } from "../utils/money.js";

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

export default function Profile() {
  const nav = useNavigate();
  const { lang, t } = useI18n();
  const [session, setSession] = useState(() => readSession());
  const [users, setUsers] = useState(() => readUsers());
  const [, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);

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
      window.removeEventListener('storage', updateUnread); // Note: storage event listener needs exact function reference or careful handling, simplified here
    };
  }, []);

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

  // 资金（PLN / USD / USDT），从后端余额接口匹配真实数据（与 Home/Swap 同源逻辑）
  const [funds, setFunds] = useState({ pln: 0, usd: 0, usdt: 0 });
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
            usdt: (Number.isFinite(map.USDT) ? map.USDT : 0),
          });
        } catch {
          setFunds({
            pln: Number.isFinite(map.PLN) ? map.PLN : 0,
            usd: Number.isFinite(map.USD) ? map.USD : 0,
            usdt: Number.isFinite(map.USDT) ? map.USDT : 0,
          });
        }
      } catch (_) {
        if (stopped) return;
        setFunds({ pln: 0, usd: 0, usdt: 0 });
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

  // 姓名编辑入口已移除，顶部仅展示用户名称/电话



  // 功能菜单项 - 6个保持两行3列对称
  const menuItems = [
    { icon: '✏️', label: t('profileSettings'), path: '/me/settings' },
    { icon: '💳', label: t('profileBankCards'), path: '/me/cards' },
    { icon: '📜', label: t('profileHistory'), path: '/trades' },
    { icon: '🛟', label: t('profileSupport'), path: '/me/support', badge: unreadCount },
    { icon: '🏢', label: t('profileInstitution'), path: '/me/institution' },
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
        <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8, textAlign: 'center' }}>
          {t('profileAccountFunds')}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 14, color: '#3b82f6', fontWeight: 600 }}>PLN</span>
          <span style={{ fontSize: 24, fontWeight: 700, color: '#e5e7eb' }}>{formatPLN(funds.pln, lang)}</span>
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

      {/* 功能菜单 - 铺满宽度 */}
      <div style={{ 
        background: 'rgba(17,24,39,0.6)', borderRadius: 0, padding: '16px',
        borderBottom: '1px solid rgba(255,255,255,0.06)', width: '100%', boxSizing: 'border-box'
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
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
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                padding: '16px 8px', borderRadius: 10, cursor: 'pointer',
                background: 'rgba(30, 41, 59, 0.5)', border: '1px solid rgba(255,255,255,0.06)'
              }}
            >
              <div style={{ 
                width: 44, height: 44, borderRadius: 12, 
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 22, background: 'rgba(59,130,246,0.12)', 
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
              <div style={{ fontSize: 12, fontWeight: 500, color: '#e5e7eb', textAlign: 'center' }}>{item.label}</div>
            </div>
          ))}
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
      <BottomNav />
    </div>
  );
}
