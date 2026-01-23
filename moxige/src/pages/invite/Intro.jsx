import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import BottomNav from "../../components/BottomNav.jsx";
import { useI18n } from "../../i18n.jsx";
import { api } from "../../services/api.js";

export default function InviteIntro() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { (async () => { try { setLoading(true); const r = await api.get('/me/invite/code'); setCode(String(r?.code||'')); } catch (e) { setError(String(e?.message||e)); } finally { setLoading(false); } })(); }, []);
  return (
    <div className="screen top-align" style={{ padding: 0, width: '100%', maxWidth: '100%' }}>
      <div style={{ padding: '16px', width: '100%', boxSizing: 'border-box', paddingBottom: 100 }}>
        <h1 className="title" style={{ marginTop: 0 }}>{lang==='zh'? '邀请系统' : (lang==='es'? 'Sistema de invitación' : 'Invite System')}</h1>
        <div className="desc" style={{ marginBottom:12 }}>{lang==='zh'? '通过分享你的机构邀请码，好友完成机构交易后你可获得佣金奖励。' : (lang==='es'? 'Comparte tu código para invitar amigos y gana comisiones por sus beneficios.' : 'Share your code to invite friends and earn commissions from their profits.')}</div>
        <div style={{ display:'grid', gap:10 }}>
          <div className="desc">{lang==='zh'?'我的邀请码':'Mi código'}：<span style={{ fontWeight:700 }}>{code || (loading ? '...' : '-')}</span></div>
          {error && <div className="error">{error}</div>}
          <div className="sub-actions" style={{ justifyContent:'flex-end', gap:8 }}>
            <button className="btn" onClick={()=> nav('/me/institution')}>{lang==='zh'?'返回机构账户':(lang==='es'?'Volver a Institución':'Back to Institution')}</button>
            <button className="btn primary" onClick={()=> nav('/me/invite/dashboard')}>{lang==='zh'?'进入我的邀请系统':(lang==='es'?'Entrar a mi sistema':'Enter My Invite')}</button>
          </div>
        </div>
      </div>
      <BottomNav />
    </div>
  );
}