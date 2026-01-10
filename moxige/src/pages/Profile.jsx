import BottomNav from "../components/BottomNav.jsx";
import { useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n.jsx";
import { api } from "../services/api.js";
import "../styles/profile.css";
import { formatMoney, formatMXN, formatUSDT } from "../utils/money.js";

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
  const [showInvite, setShowInvite] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [verifying, setVerifying] = useState(false);
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
      if (!s) return '/logo.png';
      if (/^data:image\/(png|jpeg);base64,/i.test(s)) return s;
      if (/^https?:\/\//i.test(s)) return s;
      if (s.startsWith('/')) return s;
      if (/^[\w\-/.]+$/.test(s)) return `/uploads/${s.replace(/^\/+/, '')}`;
      return '/logo.png';
    } catch { return '/logo.png'; }
  }
  const [avatarUrl, setAvatarUrl] = useState(() => normalizeAvatar(session?.avatar || session?.avatarUrl || (user?.avatar || user?.avatarUrl) || (JSON.parse(localStorage.getItem('avatarUrl') || 'null') || '')));
  const fileInputRef = useRef(null);

  // 资金（MXN / USD / USDT），从后端余额接口匹配真实数据（与 Home/Swap 同源逻辑）
  const [funds, setFunds] = useState({ mxn: 0, usd: 0, usdt: 0 });
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
            mxn: (Number.isFinite(map.MXN) ? map.MXN : 0) - sumHold('MXN'),
            usd: (Number.isFinite(map.USD) ? map.USD : 0),
            usdt: (Number.isFinite(map.USDT) ? map.USDT : 0),
          });
        } catch {
          setFunds({
            mxn: Number.isFinite(map.MXN) ? map.MXN : 0,
            usd: Number.isFinite(map.USD) ? map.USD : 0,
            usdt: Number.isFinite(map.USDT) ? map.USDT : 0,
          });
        }
      } catch (_) {
        if (stopped) return;
        setFunds({ mxn: 0, usd: 0, usdt: 0 });
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
    if (!validators.imageType(file)) { alert(lang === 'es' ? 'Formato inválido (JPG/PNG)' : 'Invalid format (JPG/PNG)'); return; }
    if (!validators.imageSize(file)) { alert(lang === 'es' ? 'Imagen > 2MB' : 'Image > 2MB'); return; }
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



  return (
    <div className="screen borderless profile-screen">
      <div className="profile-container">
        {/* 顶部：头像 + 账户资金 + 提现按钮 */}
        <div className="profile-top-card">
          <div className="top-left">
            <div className="avatar-wrap" onClick={onPickAvatar} role="button" aria-label="change-avatar" title={lang === 'es' ? 'Cambiar avatar' : 'Change avatar'}>
              <img className="avatar" src={avatarUrl || "/logo.png"} alt="avatar" />
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg" onChange={onAvatarSelected} style={{ display: 'none' }} />
            </div>
            <div className="top-name">{user?.name || user?.phone || (lang === 'es' ? 'Usuario' : 'User')}</div>
          </div>
          <div className="top-right">
            <div className="top-title">{lang === 'es' ? 'Cuenta de fondos:' : 'Account Funds:'}</div>
            <div className="funds-and-action">
              <div className="funds-list">
                <div className="fund-row"><span className="label">MX</span><span className="value">{formatMXN(funds.mxn, lang)}</span></div>
              </div>
              <button className="btn withdraw-btn" onClick={() => nav('/me/withdraw')}>{lang === 'es' ? 'Retirar' : 'Withdraw'}</button>
            </div>
          </div>
        </div>

        {/* 中部：功能入口网格 */}
        <div className="profile-menu-card">
          <div className="icon-grid">
            <div className="icon-item" onClick={() => nav('/me/settings')} aria-label="account-settings">
              <div className="icon-circle">✏️</div>
              <div className="icon-label">{lang === 'es' ? 'Configuración' : 'Settings'}</div>
            </div>
            <div className="icon-item" onClick={() => nav('/me/cards')} aria-label="linked-bank-cards">
              <div className="icon-circle">💳</div>
              <div className="icon-label">{lang === 'es' ? 'Tarjeta bancaria' : 'Bank Cards'}</div>
            </div>
            <div className="icon-item" onClick={() => nav('/trades')}>
              <div className="icon-circle">📜</div>
              <div className="icon-label">{lang === 'es' ? 'Historial' : 'History'}</div>
            </div>
            <div className="icon-item" onClick={() => {
              try { localStorage.setItem('im:unread_count', '0'); window.dispatchEvent(new Event('im:unread')); } catch { }
              nav('/me/support');
            }}>
              <div className="icon-circle" style={{ position: 'relative' }}>
                🛟
                {unreadCount > 0 && <div style={{ position: 'absolute', top: -5, right: -5, background: '#ef4444', color: '#fff', fontSize: 10, height: 16, minWidth: 16, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', border: '1px solid #fff' }}>{unreadCount > 99 ? '99+' : unreadCount}</div>}
              </div>
              <div className="icon-label">{lang === 'es' ? 'Soporte' : 'Support'}</div>
            </div>
            {/* 机构账户入口 */}
            <div className="icon-item" onClick={async () => {
              try {
                const sess = (() => { try { return JSON.parse(localStorage.getItem('sessionUser') || 'null'); } catch { return null; } })();
                const blocked = (() => { try { const key = (sess?.id || sess?.phone || 'guest'); return !!localStorage.getItem(`inst:blocked:${key}`); } catch { return false; } })();
                if (blocked) { alert(lang === 'zh' ? '你已丧失机构账户资格，如有疑问，请联系客服' : (lang === 'es' ? 'Has perdido la calificación institucional, contacta soporte' : 'You have lost institution qualification, please contact support')); return; }
                if (sess && sess.assigned_operator_id != null) return nav('/me/institution');
                const me = await api.get('/me');
                const assigned = me?.user?.assigned_operator_id ?? null;
                try { localStorage.setItem('sessionUser', JSON.stringify(me.user)); } catch { }
                if (assigned != null) return nav('/me/institution');
                setInviteCode("");
                setInviteError("");
                setShowInvite(true);
              } catch (e) { setError(String(e?.message || e)); }
            }} aria-label="institution-account">
              <div className="icon-circle">🏢</div>
              <div className="icon-label">{lang === 'es' ? 'Institución' : 'Institution'}</div>
            </div>
          </div>
        </div>

        {/* 底部：版本和退出 */}
        <div className="profile-footer">
          <div className="version-text">V1.0.1</div>
          <button className="btn logout-btn" onClick={async () => {
            try { await api.post('/auth/logout', {}); } catch { }
            try { localStorage.removeItem('sessionUser'); localStorage.removeItem('token'); localStorage.removeItem('csrf:token'); } catch { }
            try { nav('/login'); } catch { }
          }}>{lang === 'es' ? 'Cerrar sesión' : 'Log Out'}</button>
          {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
        </div>
      </div>
      <BottomNav />

      {showInvite && (
        <div className="modal" onClick={() => { if (!verifying) setShowInvite(false); }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">{t('inviteTitle') || '请输入你的机构邀请码'}</div>
            <div className="modal-body">
              <input className="input" placeholder={t('invitePlaceholder') || '请输入你的机构邀请码'} value={inviteCode} onChange={e => setInviteCode(e.target.value)} />
              {inviteError && <div className="error" style={{ marginTop: 8 }}>{inviteError}</div>}
            </div>
            <div className="sub-actions" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => { if (!verifying) setShowInvite(false); }}>{t('inviteCancel') || (lang === 'es' ? 'Cancelar' : 'Cancel')}</button>
              <button className="btn primary" disabled={verifying} onClick={async () => {
                setInviteError("");
                const code = String(inviteCode || '').trim();
                if (!code) { setInviteError(t('inviteInvalid') || '邀请码无效'); return; }
                setVerifying(true);
                try {
                  await api.post('/me/invite/verify', { code });
                  const me = await api.get('/me');
                  try { localStorage.setItem('sessionUser', JSON.stringify(me.user)); } catch { }
                  setShowInvite(false);
                  nav('/me/institution');
                } catch (err) {
                  const msg = String(err?.message || '').toLowerCase();
                  if (msg.includes('invalid')) setInviteError(t('inviteInvalid') || '邀请码错误');
                  else if (msg.includes('already')) setInviteError(t('inviteAlready') || '已解锁');
                  else setInviteError(String(err?.message || err));
                } finally { setVerifying(false); }
              }}>{t('inviteSubmit') || (lang === 'es' ? 'Confirmar' : 'Submit')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
