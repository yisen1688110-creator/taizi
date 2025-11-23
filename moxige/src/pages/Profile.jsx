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
  const [session] = useState(() => readSession());
  const [users] = useState(() => readUsers());
  const [, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [verifying, setVerifying] = useState(false);

  // 用户信息
  const user = useMemo(() => {
    if (!session) return null;
    const byId = users.find(u => u.id && u.id === session.id);
    const byPhone = users.find(u => u.phone === session.phone);
    return byId || byPhone || session;
  }, [session, users]);
  const [avatarUrl, setAvatarUrl] = useState(() => {
    try { return JSON.parse(localStorage.getItem("avatarUrl") || "null") || (user?.avatarUrl) || "/logo.png"; } catch { return "/logo.png"; }
  });
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
          } catch {}
        }
        if (!uid) { setLoading(false); return; }
        let data;
        try { data = await api.get(`/admin/users/${uid}/balances`); }
        catch { data = await api.get(`/me/balances`); }
        const arr = Array.isArray(data?.balances) ? data.balances : [];
        const map = arr.reduce((m, r) => { m[String(r.currency).toUpperCase()] = Number(r.amount || 0); return m; }, {});
        if (stopped) return;
        setFunds({
          mxn: Number.isFinite(map.MXN) ? map.MXN : 0,
          usd: Number.isFinite(map.USD) ? map.USD : 0,
          usdt: Number.isFinite(map.USDT) ? map.USDT : 0,
        });
      } catch (_) {
        if (stopped) return;
        setFunds({ mxn: 0, usd: 0, usdt: 0 });
      } finally { if (!stopped) setLoading(false); }
    }
    fetchBalances();
    return () => { stopped = true; };
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
      } catch (_) { /* 后端不可用则本地保存 */ }
      finally {
        setLoading(false);
        try { localStorage.setItem('avatarUrl', JSON.stringify(base64)); } catch {}
        setAvatarUrl(base64);
      }
    };
    reader.readAsDataURL(file);
  };

  // 姓名编辑入口已移除，顶部仅展示用户名称/电话

  

  return (
    <div className="screen borderless profile-screen">
      <div className="card borderless-card profile-card">
        {/* 顶部：头像 + 账户资金 + 提现按钮（去掉外边框可用 flat） */}
        <div className="profile-top-card">
          <div className="top-left">
            <div className="avatar-wrap" onClick={onPickAvatar} role="button" aria-label="change-avatar" title={lang === 'es' ? 'Cambiar avatar' : 'Change avatar'}>
              <img className="avatar" src={avatarUrl || "/logo.png"} alt="avatar" />
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg" onChange={onAvatarSelected} style={{ display: 'none' }} />
            </div>
            <div className="top-name">{user?.name || user?.phone || (lang==='es'?'Usuario':'User')}</div>
          </div>
          <div className="top-right">
            <div className="top-title">{lang==='es'?'Cuenta de fondos:':'Account Funds:'}</div>
            <div className="funds-and-action">
              <div className="funds-list">
                <div className="fund-row"><span className="label">MX:</span><span className="value">{formatMXN(funds.mxn, lang)}</span></div>
                <div className="fund-row"><span className="label">USD:</span><span className="value">{formatMoney(funds.usd, 'USD', lang)}</span></div>
                <div className="fund-row"><span className="label">USDT:</span><span className="value">{formatUSDT(funds.usdt, lang)}</span></div>
              </div>
              <button className="btn withdraw-btn" onClick={()=>nav('/me/withdraw')}>{lang==='es'?'Retirar':'Withdraw'}</button>
            </div>
          </div>
        </div>

        {/* 中部：两行三列圆形图标入口 */}
        <div className="card borderless-card section-card">
          <div className="icon-grid">
            <div className="icon-item" onClick={()=>nav('/me/settings')} aria-label="account-settings">
              <div className="icon-circle">✏️</div>
              <div className="icon-label">{lang==='es'?'Configuración':'Account Settings'}</div>
            </div>
            <div className="icon-item" onClick={()=>nav('/me/cards')} aria-label="linked-bank-cards">
              <div className="icon-circle">💳</div>
              <div className="icon-label">{lang==='es'?'Tarjeta bancaria':'Linked Bank Cards'}</div>
            </div>
            <div className="icon-item" onClick={()=>nav('/me/wallets')}>
              <div className="icon-circle">🔗</div>
              <div className="icon-label">{lang==='es'?'Dirección de billetera':'Wallet Address'}</div>
            </div>
            <div className="icon-item" onClick={()=>nav('/trades')}>
              <div className="icon-circle">📜</div>
              <div className="icon-label">{lang==='es'?'Historial de operaciones':'Trades History'}</div>
            </div>
            <div className="icon-item" onClick={()=>nav('/me/support')}>
              <div className="icon-circle">🛟</div>
              <div className="icon-label">{lang==='es'?'Contacto soporte':'Support'}</div>
            </div>
            {/* 机构账户入口（未解锁需邀请码） */}
            <div className="icon-item" onClick={async ()=>{
              try {
                const sess = (()=>{ try { return JSON.parse(localStorage.getItem('sessionUser')||'null'); } catch { return null; } })();
                if (sess && sess.assigned_operator_id != null) return nav('/me/institution');
                const me = await api.get('/me');
                const assigned = me?.user?.assigned_operator_id ?? null;
                try { localStorage.setItem('sessionUser', JSON.stringify(me.user)); } catch {}
                if (assigned != null) return nav('/me/institution');
                setInviteCode("");
                setInviteError("");
                setShowInvite(true);
              } catch (e) { setError(String(e?.message||e)); }
            }} aria-label="institution-account">
              <div className="icon-circle">🏢</div>
              <div className="icon-label">{lang==='es'?'Institución':'Institution'}</div>
            </div>
          </div>
        </div>

        {/* 底部：广告位 + 退出登录 */}
        <div className="card borderless-card section-card">
          <div className="promo-block">{lang==='es'?'Espacio publicitario':'Promo Space'}</div>
          <div className="logout-area">
            <button className="btn logout-btn" onClick={() => { try { localStorage.removeItem('sessionUser'); } catch {} }}>{lang==='es'?'Cerrar sesión':'Log Out'}</button>
          </div>
          {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
        </div>
      </div>
      <BottomNav />

      {showInvite && (
        <div className="modal" onClick={()=>{ if (!verifying) setShowInvite(false); }}>
          <div className="modal-card" onClick={(e)=>e.stopPropagation()}>
            <div className="modal-title">{t('inviteTitle') || '请输入你的机构邀请码'}</div>
            <div className="modal-body">
              <input className="input" placeholder={t('invitePlaceholder') || '请输入你的机构邀请码'} value={inviteCode} onChange={e=>setInviteCode(e.target.value)} />
              {inviteError && <div className="error" style={{ marginTop: 8 }}>{inviteError}</div>}
            </div>
            <div className="sub-actions" style={{ justifyContent:'flex-end', gap:8 }}>
              <button className="btn" onClick={()=>{ if (!verifying) setShowInvite(false); }}>{t('inviteCancel') || (lang==='es'?'Cancelar':'Cancel')}</button>
              <button className="btn primary" disabled={verifying} onClick={async ()=>{
                setInviteError("");
                const code = String(inviteCode||'').trim();
                if (!code) { setInviteError(t('inviteInvalid') || '邀请码无效'); return; }
                setVerifying(true);
                try {
                  await api.post('/me/invite/verify', { code });
                  const me = await api.get('/me');
                  try { localStorage.setItem('sessionUser', JSON.stringify(me.user)); } catch {}
                  setShowInvite(false);
                  nav('/me/institution');
                } catch (err) {
                  const msg = String(err?.message||'').toLowerCase();
                  if (msg.includes('invalid')) setInviteError(t('inviteInvalid') || '邀请码错误');
                  else if (msg.includes('already')) setInviteError(t('inviteAlready') || '已解锁');
                  else setInviteError(String(err?.message||err));
                } finally { setVerifying(false); }
              }}>{t('inviteSubmit') || (lang==='es'?'Confirmar':'Submit')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}