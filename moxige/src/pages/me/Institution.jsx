import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import BottomNav from "../../components/BottomNav.jsx";
import { useI18n } from "../../i18n.jsx";
import { api } from "../../services/api.js";
import { formatMoney, formatMXN, formatUSDT } from "../../utils/money.js";
import { formatMinute } from "../../utils/date.js";
import { getQuotes, getCryptoQuotes } from "../../services/marketData.js";
import "../../styles/profile.css";

// 机构账户页（按原型布局实现，保留占位与接口钩子）
export default function Institution() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  // 会话（用于解析后端用户ID）
  const [session, setSession] = useState(() => {
    try { return JSON.parse(localStorage.getItem("sessionUser") || "null"); } catch { return null; }
  });

  // 顶部头像与资金（MX / USD / USDT）
  const [avatarUrl, setAvatarUrl] = useState("/logo.png");
  const [funds, setFunds] = useState({ mxn: 0, usd: 0, usdt: 0 });
  const [tradeDisabled, setTradeDisabled] = useState(false);

  // 机构简介占位：头像+名称+文案（对接后台）
  const [org, setOrg] = useState({ avatar: "/logo.png", name: t("instOrgNameDefault"), desc: t("instOrgDescDefault") });
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("current"); // current | done
  const [orders, setOrders] = useState([]); // 用户认购的大宗订单（后端）
  const [quotes, setQuotes] = useState({}); // 实时行情 { key: { price, changePct } }
  const [toast, setToast] = useState({ show: false, type: 'info', text: '' });
  const [locked, setLocked] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [refCode, setRefCode] = useState('');

  // labels（国际化）
  const labels = useMemo(() => ({
    title: t("instTitle"),
    intro: t("instIntro"),
    btnFunds: t("instFunds"),
    btnBlocks: t("instBlocks"),
    btnIpoRwa: t("instIpoRwa"),
    tabCurrent: t("instPositionsCurrent"),
    tabDone: t("instPositionsDone"),
    emptyTip: t("instPositionsEmpty"),
  }), [t]);

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

  // 加载账户资金：与个人中心逻辑保持一致，从后端 /admin/users/:id/balances 获取
  useEffect(() => {
    let stopped = false;
    async function fetchBalances() {
      try {
        setLoading(true);
        // 解析后端用户ID（与 Home/Profile/Swap 保持一致）
        let uid = Number(session?.id ?? session?.backendId);
        if (!uid && session?.phone) {
          try {
            const res = await api.get(`/admin/users?q=${encodeURIComponent(session.phone)}`);
            const arr = Array.isArray(res?.users) ? res.users : [];
            const match = arr.find(u => String(u.phone) === String(session.phone));
            if (match && Number(match.id)) {
              uid = Number(match.id);
              // 回写本地镜像与会话，后续请求稳定使用数值ID
              try {
                const users = JSON.parse(localStorage.getItem('users') || '[]');
                const nextUsers = users.map(u => (u.phone === session.phone ? { ...u, id: uid, backendId: uid } : u));
                localStorage.setItem('users', JSON.stringify(nextUsers));
              } catch {}
              try { localStorage.setItem('sessionUser', JSON.stringify({ ...session, id: uid })); setSession({ ...session, id: uid }); } catch {}
            }
          } catch {}
        }
        if (!uid) { if (!stopped) setLoading(false); return; }
        let data;
        try {
          const meData = await api.get('/me');
          if (typeof meData === 'object' && meData?.user) {
            setTradeDisabled(!!meData.user.trade_disabled);
          }
        } catch {}
        try {
          data = await api.get(`/me/balances`);
          setTradeDisabled(!!data?.disabled);
        } catch {
          data = await api.get(`/admin/users/${uid}/balances`);
        }
        const arr = Array.isArray(data?.balances) ? data.balances : [];
        const map = arr.reduce((m, r) => { m[String(r.currency).toUpperCase()] = Number(r.amount || 0); return m; }, {});
        if (stopped) return;
        setFunds({
          mxn: Number.isFinite(map.MXN) ? map.MXN : 0,
          usd: Number.isFinite(map.USD) ? map.USD : 0,
          usdt: Number.isFinite(map.USDT) ? map.USDT : 0,
        });
      } catch (_) {
        // 后端不可用时维持 0 值占位
      } finally { if (!stopped) setLoading(false); }
    }
    fetchBalances();
    return () => { stopped = true; };
  }, [session]);

  // 加载机构简介（后台运营可编辑），后端接口建议：GET /institution/profile
  useEffect(() => {
    let stopped = false;
    async function fetchOrg() {
      try {
        const data = await api.get("/institution/profile");
        if (stopped) return;
        const a = String(data?.avatar || org.avatar);
        const n = String(data?.name || org.name);
        const d = String(data?.desc || org.desc);
        setOrg({ avatar: normalizeAvatar(a), name: n, desc: d });
        setAvatarUrl(normalizeAvatar(session?.avatarUrl || session?.avatar || a));
      } catch (_) {
        // 保持默认占位，不报错
      }
    }
    fetchOrg();
    (async () => { try { const r = await api.get('/me/invite/code'); setRefCode(String(r?.code||'')); } catch {} })();
    return () => { stopped = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const s = session;
    setAvatarUrl(normalizeAvatar(s?.avatar || s?.avatarUrl || avatarUrl));
  }, [session]);

  // 加载用户的大宗订单卡片与状态
  useEffect(() => {
    // 首次访问校验是否已解锁
    (async () => {
      try {
        const me = await api.get('/me');
        const assigned = me?.user?.assigned_operator_id ?? null;
        try { localStorage.setItem('sessionUser', JSON.stringify(me.user)); } catch {}
        setLocked(!(assigned != null));
      } catch { setLocked(true); }
    })();
    let stopped = false;
    async function fetchOrders() {
      try {
        const data = await api.get('/me/trade/block/orders');
        const arr = Array.isArray(data?.items) ? data.items : [];
        const mapped = arr.map(r => {
          const s = String(r.symbol || '').toUpperCase();
          const base = s.replace(/USDT$/i, '').replace(/\/-?USDT$/i, '').replace(/\/-?USD$/i, '');
          const isCrypto = ['BTC','ETH','SOL','ADA','XRP','DOGE','LTC','BCH','BNB','AVAX','DOT','LINK','MATIC','XMR','TRX','ATOM','NEAR','ETC','UNI'].includes(base);
          const mk = isCrypto ? 'crypto' : 'us';
          const ts = Date.parse(r.submitted_at || '') || Date.now();
          const lu = r.lock_until_ts || r.lock_until || null;
          return { id: r.id, symbol: base, market: mk, blockPrice: Number(r.price || 0), price: Number(r.price || 0), qty: Number(r.qty || 0), status: String(r.status || 'submitted'), lockUntil: lu, ts };
        });
        if (!stopped) setOrders(mapped);
      } catch {
        // 后端不可用时不使用本地镜像，保持为空
        if (!stopped) setOrders([]);
      }
    }
    fetchOrders();
    const iv = setInterval(fetchOrders, 5000);
    return () => { stopped = true; clearInterval(iv); };
  }, []);

  // 根据订单列表刷新行情（2s），用于实时盈亏显示
  useEffect(() => {
    let stopped = false;
    async function refreshQuotes() {
      const cryptoBases = orders.filter(o => o.market === 'crypto').map(o => String(o.symbol).toUpperCase());
      const usSymbols = orders.filter(o => o.market === 'us').map(o => String(o.symbol).toUpperCase());
      const next = {};
      try {
        if (cryptoBases.length) {
          const q = await getCryptoQuotes({ symbols: cryptoBases });
          for (const r of q) next[`crypto:${String(r.symbol).toUpperCase()}`] = { price: Number(r.priceUSD || r.price || 0), changePct: Number(r.changePct || 0) };
        }
      } catch {}
      try {
        if (usSymbols.length) {
          const q = await getQuotes({ market: 'us', symbols: usSymbols });
          for (const r of q) next[`us:${String(r.symbol).toUpperCase()}`] = { price: Number(r.price || 0), changePct: Number(r.changePct || 0) };
        }
      } catch {}
      if (!stopped) setQuotes(next);
    }
    refreshQuotes();
    const iv = setInterval(refreshQuotes, 2000);
    return () => { stopped = true; clearInterval(iv); };
  }, [orders]);

  function quoteKeyFor(o) { return `${o.market}:${String(o.symbol).toUpperCase()}`; }
  function currentPriceFor(o) { return Number(quotes[quoteKeyFor(o)]?.price || 0); }
  function pnlValue(o) {
    const buy = Number(o.blockPrice || o.price || 0);
    const cur = currentPriceFor(o);
    const qty = Number(o.qty || 0);
    if (!Number.isFinite(buy) || !Number.isFinite(cur) || !Number.isFinite(qty) || qty <= 0) return 0;
    return Number(((cur - buy) * qty).toFixed(2));
  }
  function pnlPct(o) {
    const buy = Number(o.blockPrice || o.price || 0);
    const cur = currentPriceFor(o);
    if (!Number.isFinite(buy) || buy <= 0 || !Number.isFinite(cur) || cur <= 0) return 0;
    return Number((((cur - buy) / buy) * 100).toFixed(2));
  }
  function profitColor(o) {
    const v = pnlValue(o);
    if (v > 0) return '#5cff9b';
    if (v < 0) return '#ff5c7a';
    return '#9aa3ad';
  }
  function statusColor(s) {
    const v = String(s || 'submitted');
    if (v === 'rejected') return '#7a2a2a';
    if (v === 'done') return '#9aa3ad';
    return '#274a36';
  }
  function tabBtnStyle(active) {
    return active
      ? { background: 'linear-gradient(90deg, #4a9cff, #7d6bff)', color: '#fff', border: '1px solid #6fa8ff' }
      : { background: 'transparent', color: '#aeb8c7', border: '1px solid #2a3b56' };
  }
  function statusLabel(s) {
    const v = String(s || 'pending');
    if (v === 'done') return (lang==='zh'?'已完成':(lang==='es'?'Completado':'Completed'));
    if (v === 'approved') return (lang==='zh'?'已批准':(lang==='es'?'Aprobado':'Approved'));
    if (v === 'rejected') return (lang==='zh'?'已拒绝':(lang==='es'?'Rechazado':'Rejected'));
    return (lang==='zh'?'待审核':(lang==='es'?'Pendiente':'Pending'));
  }
  function isLocked(o) {
    const lu = o.lockUntil || o.lock_until;
    const ts = typeof lu === 'number' ? lu : Date.parse(lu || '');
    return Number.isFinite(ts) && Date.now() < ts;
  }
  async function sell(o) {
    try {
      if (o.status !== 'approved') { setToast({ show:true, type:'error', text: lang==='zh'?'仅已批准订单可卖出':(lang==='es'?'Solo órdenes aprobadas':'Only approved orders') }); setTimeout(()=>setToast({ show:false, type:'error', text:'' }), 1000); return; }
      if (isLocked(o)) {
        const until = o.lockUntil || o.lock_until;
        setToast({ show:true, type:'error', text: (lang==='zh'?'目前订单锁定中，解锁时间: ':(lang==='es'?'Orden bloqueada hasta: ':'Order locked until: ')) + formatMinute(until) });
        setTimeout(()=>setToast({ show:false, type:'error', text:'' }), 1000);
        return;
      }
      const cur = currentPriceFor(o);
      if (!Number.isFinite(cur) || cur <= 0) { setToast({ show:true, type:'error', text: lang==='zh'?'当前价格不可用':(lang==='es'?'Precio actual no disponible':'Current price unavailable') }); setTimeout(()=>setToast({ show:false, type:'error', text:'' }), 1000); return; }
      await api.post(`/me/institution/block/orders/${o.id}/sell`, { currentPrice: cur });
      setToast({ show:true, type:'ok', text: lang==='zh'?'卖出成功，订单已完成':(lang==='es'?'Venta exitosa, orden completada':'Sold successfully, order completed') });
      setTimeout(()=>setToast({ show:false, type:'ok', text:'' }), 1000);
    } catch (e) {
      const msg = (e && (e.message || (e.response && (e.response.data?.error || e.response.data?.message)))) || String(e);
      setToast({ show:true, type:'error', text: (lang==='zh' ? '卖出失败: ' : (lang==='es'?'Fallo de venta: ':'Sell failed: ')) + msg });
      setTimeout(()=>setToast({ show:false, type:'error', text:'' }), 1000);
    }
  }

  return (
    <div className="screen top-align">
      {locked && (
        <div className="modal">
          <div className="modal-card">
            <div style={{ fontWeight:700, marginBottom:8 }}>{t('inviteTitle') || '请输入你的机构邀请码'}</div>
            <input className="input" placeholder={t('invitePlaceholder') || '请输入你的机构邀请码'} value={inviteCode} onChange={e=>setInviteCode(e.target.value)} />
            {inviteError && <div className="error" style={{ marginTop:8 }}>{inviteError}</div>}
            <div className="sub-actions" style={{ justifyContent:'flex-end', gap:8, marginTop:10 }}>
              <button className="btn" onClick={()=>nav('/me')}>{t('inviteCancel') || (lang==='es'?'Cancelar':'Cancel')}</button>
              <button className="btn primary" disabled={verifying} onClick={async ()=>{
                setInviteError('');
                const code = String(inviteCode||'').trim();
                if (!code) { setInviteError(t('inviteInvalid') || '邀请码无效'); return; }
                setVerifying(true);
                try {
                  await api.post('/me/invite/verify', { code });
                  const me = await api.get('/me');
                  try { localStorage.setItem('sessionUser', JSON.stringify(me.user)); } catch {}
                  setLocked(false);
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
      {toast?.show && (
        <div style={{ position:'fixed', top: 10, left: 0, right: 0, display:'grid', placeItems:'center', zIndex: 1000 }}>
          <div style={{ padding:'8px 12px', borderRadius: 10, background: toast.type==='error' ? '#7a2a2a' : '#274a36', color:'#fff', boxShadow:'0 4px 14px rgba(0,0,0,.2)' }}>{toast.text}</div>
        </div>
      )}
      <div className="inst-container">
        {/* 顶部：头像 + 用户资金 */}
        <div className="inst-card">
          <div className="profile-top-card" style={{ marginTop: 0 }}>
            <div className="top-left">
              <div className="avatar-wrap">
                <img className="avatar" src={avatarUrl || "/logo.png"} alt="avatar" onError={(e)=>{ try { e.currentTarget.src = '/logo.png'; } catch {} }} />
                <button className="btn" style={{ position:'absolute', right: -6, top: -6, height: 32, padding: '0 10px', borderRadius: 10, background: 'linear-gradient(90deg, #00e5ff, #7c4dff)', color: '#061223', border: 'none' }} onClick={()=>nav('/me/invite')}>{lang==='zh'?'邀请':(lang==='es'?'Invitar':'Invite')}</button>
              </div>
              <div className="top-name">{labels.title}</div>
              </div>
              <div className="top-right">
                <div className="top-title">{lang==='zh' ? '资产' : (lang==='es' ? 'Fondos' : 'Funds')}</div>
                <div className="funds-list">
                  <div className="fund-row"><span className="label">MX</span><span className="value">{formatMXN(funds.mxn, lang)}</span></div>
                  <div className="fund-row"><span className="label">USD</span><span className="value">{formatMoney(funds.usd, 'USD', lang)}</span></div>
                  <div className="fund-row"><span className="label">USDT</span><span className="value">{formatUSDT(funds.usdt, lang)}</span></div>
                </div>
                {tradeDisabled && <div className="desc" style={{ marginTop: 6, color: '#ff6b6b' }}>{lang==='es'?'Operación deshabilitada (USD negativo)':'Trading disabled (USD negative)'}</div>}
              </div>
          </div>
        </div>

        {/* 机构简介占位：头像 + 名称 + 文案介绍 */}
        <div className="inst-card">
          <div style={{ display: 'grid', gridTemplateColumns: '96px 1fr', gap: 16, alignItems: 'center' }}>
            <img src={normalizeAvatar(org.avatar)} alt="org-avatar" style={{ width: 72, height: 72, borderRadius: 36, border: '1px solid #2a3441', objectFit: 'cover' }} onError={(e)=>{ try { e.currentTarget.src = '/logo.png'; } catch {} }} />
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{org.name}</div>
              <div className="desc" style={{ lineHeight: 1.5 }}>{org.desc}</div>
            </div>
          </div>
        </div>

        {/* 三个圆形按钮入口：基金 / 大宗交易 / IPO-RWA */}
        <div className="inst-card">
          <div className="icon-grid">
            <div className="icon-item" onClick={()=>nav('/institution/funds')}>
              <div className="icon-circle">💼</div>
              <div className="icon-label">{labels.btnFunds}</div>
            </div>
            <div className="icon-item" onClick={()=>nav('/institution/blocks')}>
              <div className="icon-circle">📦</div>
              <div className="icon-label">{labels.btnBlocks}</div>
            </div>
            <div className="icon-item" onClick={()=>nav('/institution/ipo-rwa')}>
              <div className="icon-circle">🏛️</div>
              <div className="icon-label">{labels.btnIpoRwa}</div>
            </div>
          </div>
        </div>

        {/* 持仓板块（仅机构订单，不与外部交易混合） */}
        <div className="inst-card">
          <div style={{ display: 'flex', gap: 8 }}>
            <button className={`btn slim`} style={tabBtnStyle(tab==='current')} onClick={()=>setTab('current')}>{labels.tabCurrent}</button>
            <button className={`btn slim`} style={tabBtnStyle(tab==='done')} onClick={()=>setTab('done')}>{labels.tabDone}</button>
          </div>
          <div className="sub-card" style={{ display: 'grid', gap: 8 }}>
            {(orders || []).filter(o => (tab==='current' ? o.status!=='done' : o.status==='done')).length === 0 && (
              <div className="desc">{labels.emptyTip}</div>
            )}
            {(orders || []).filter(o => (tab==='current' ? o.status!=='done' : o.status==='done')).map(o => (
              <div key={o.id} className="card flat order-row" style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: 8, alignItems: 'center', border: '1px solid rgba(68,120,192,0.38)', borderRadius: 14, padding: '12px 14px', background: 'linear-gradient(180deg, rgba(12,18,28,0.78), rgba(12,18,28,0.55))', boxShadow: '0 0 0 2px rgba(68,120,192,0.32), inset 0 0 0 2px rgba(68,120,192,0.26), inset 0 8px 28px rgba(68,120,192,0.14)', overflow: 'hidden', boxSizing: 'border-box' }}>
                <div style={{ display: 'grid', gap: 4, minWidth: 0, wordBreak: 'break-word' }}>
                  <div style={{ fontWeight: 700 }}>{String(o.market).toUpperCase()} · {String(o.symbol).toUpperCase()}</div>
                  <div className="desc">
                    {lang==='zh' ? '价格' : (lang==='es' ? 'Precio' : 'Price')}: {formatMoney(Number(o.blockPrice||o.price||0), 'USD', lang)}
                    {' · '}
                    {lang==='zh' ? '数量' : (lang==='es' ? 'Cantidad' : 'Qty')}: {Number(o.qty||0)}
                    {' · '}
                    {lang==='zh' ? '总额' : (lang==='es' ? 'Total' : 'Total')}: {formatMoney(Number((o.blockPrice||o.price||0) * Number(o.qty||0)), 'USD', lang)}
                  </div>
                  <div className="desc">
                    {lang==='zh' ? '锁定至' : (lang==='es' ? 'Bloqueado hasta' : 'Lock Until')}: {formatMinute(o.lockUntil || o.lock_until)}
                    {' · '}
                    {lang==='zh' ? '当前价' : (lang==='es' ? 'Precio actual' : 'Current')}: {formatMoney(currentPriceFor(o) || 0, 'USD', lang)}
                  </div>
                  <div className="desc">
                    {lang==='zh' ? '提交于' : (lang==='es' ? 'Enviado' : 'Submitted')}: {formatMinute(Number(o.ts||Date.now()))}
                  </div>
                </div>
                <div style={{ display:'grid', justifyItems:'end', alignContent:'start', gap:6, minWidth: 0, paddingRight: 6 }}>
                  <span className="tag" style={{ background: statusColor(o.status) }}>{statusLabel(o.status)}</span>
                  <div style={{ fontSize:18, fontWeight:700, color: profitColor(o) }}>{pnlPct(o)}%</div>
                  <div style={{ fontSize:14, color: profitColor(o) }}>{Number(pnlValue(o)).toFixed(2)}</div>
                  {tab==='current' && (
                    <button className="btn primary slim" disabled={tradeDisabled || o.status!=='approved'} onClick={()=>sell(o)}>
                      {lang==='zh' ? '卖出' : (lang==='es' ? 'Vender' : 'Sell')}
                    </button>
                  )}
                  {tab==='done' && (
                    <span className="tag" style={{ background: '#274a36' }}>
                      {lang==='zh'?'已完成':(lang==='es'?'Completado':'Completed')}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        
      </div>
      <BottomNav />
    </div>
  );
}