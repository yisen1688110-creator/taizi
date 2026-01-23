import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import BottomNav from "../../components/BottomNav.jsx";
import { useI18n } from "../../i18n.jsx";
import { api } from "../../services/api.js";
import { formatPLN, formatMoney, formatUSDT } from "../../utils/money.js";

export default function InviteDashboard() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const [wallets, setWallets] = useState([]);
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({ invitedCount: 0, activeCount: 0, totals: { PLN:{released:0,frozen:0}, USD:{released:0,frozen:0}, USDT:{released:0,frozen:0} }, series: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');

  const fetchAll = async () => {
    try {
      setLoading(true); setError('');
      const w = await api.get('/me/invite/wallets');
      setWallets(Array.isArray(w?.wallets) ? w.wallets : []);
      const c = await api.get('/me/invite/commissions');
      setItems(Array.isArray(c?.items) ? c.items : []);
      const s = await api.get('/me/invite/stats');
      setStats(s || stats);
    } catch (e) { setError(String(e?.message||e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetchAll(); }, []);

  const balMap = wallets.reduce((m, r) => { m[String(r.currency).toUpperCase()] = Number(r.amount||0); return m; }, {});

  const withdraw = async () => {
    const amt = Number(amount);
    if (!['PLN','USD','USDT'].includes(currency)) { alert('请选择币种'); return; }
    if (!Number.isFinite(amt) || amt <= 0) { alert('请输入提现金额'); return; }
    try { await api.post('/me/invite/withdraw', { currency, amount: amt }); alert(lang==='zh'?'提现成功':(lang==='es'?'Retiro exitoso':'Withdrawn')); setAmount(''); await fetchAll(); } catch (e) { alert(String(e?.message||e)); }
  };

  const fmt = (curr, v) => curr==='PLN' ? formatPLN(v, lang) : (curr==='USDT' ? formatUSDT(v, lang) : formatMoney(v, 'USD', lang));
  const fmtRemain = (ms) => { if (!Number.isFinite(ms)) return '-'; const d=Math.floor(ms/86400000); const h=Math.floor((ms%86400000)/3600000); const m=Math.floor((ms%3600000)/60000); return `${d>0?d+'天':''}${h>0?h+'小时':''}${m>0?m+'分':''}` || `${m}分`; };

  return (
    <div className="screen top-align" style={{ padding: 0, width: '100%', maxWidth: '100%' }}>
      <div style={{ padding: '16px', width: '100%', boxSizing: 'border-box', paddingBottom: 100 }}>
        <h1 className="title" style={{ marginTop: 0 }}>{lang==='zh'? '我的邀请系统' : (lang==='es'? 'Mi sistema de invitación' : 'My Invite System')}</h1>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom: 10 }}>
          <div className="sub-card">
            <div className="desc">{lang==='zh'?'邀请人数':'Invited'}</div>
            <div style={{ fontWeight:700 }}>{stats.invitedCount || 0}</div>
          </div>
          <div className="sub-card">
            <div className="desc">{lang==='zh'?'产生佣金的好友':'Active (commission)'}</div>
            <div style={{ fontWeight:700 }}>{stats.activeCount || 0}</div>
          </div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
          <div className="sub-card">
            <div className="desc">MX</div>
            <div style={{ fontWeight:700 }}>{fmt('PLN', balMap.PLN || 0)}</div>
            <div className="desc" style={{ marginTop:4 }}>{lang==='zh'?'累计':'Total'}：{fmt('PLN', (stats.totals?.PLN?.released||0)+(stats.totals?.PLN?.frozen||0))}</div>
          </div>
          <div className="sub-card">
            <div className="desc">USD</div>
            <div style={{ fontWeight:700 }}>{fmt('USD', balMap.USD || 0)}</div>
            <div className="desc" style={{ marginTop:4 }}>{lang==='zh'?'累计':'Total'}：{fmt('USD', (stats.totals?.USD?.released||0)+(stats.totals?.USD?.frozen||0))}</div>
          </div>
          <div className="sub-card">
            <div className="desc">USDT</div>
            <div style={{ fontWeight:700 }}>{fmt('USDT', balMap.USDT || 0)}</div>
            <div className="desc" style={{ marginTop:4 }}>{lang==='zh'?'累计':'Total'}：{fmt('USDT', (stats.totals?.USDT?.released||0)+(stats.totals?.USDT?.frozen||0))}</div>
          </div>
        </div>
        <div className="form" style={{ marginTop: 12 }}>
          <label className="label">{lang==='zh'?'提现到主钱包':(lang==='es'?'Retirar a la cartera principal':'Withdraw to main wallet')}</label>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
            <select className="input" value={currency} onChange={e=>setCurrency(e.target.value)}>
              <option value="PLN">PLN</option>
              <option value="USD">USD</option>
              <option value="USDT">USDT</option>
            </select>
            <input className="input" placeholder={lang==='zh'?'金额':(lang==='es'?'Importe':'Amount')} value={amount} onChange={e=>setAmount(e.target.value)} />
            <button className="btn primary" onClick={withdraw}>{lang==='zh'?'提现':(lang==='es'?'Retirar':'Withdraw')}</button>
          </div>
        </div>
      </div>

      <div style={{ background: 'rgba(17,24,39,0.6)', borderRadius: 0, padding: '16px', width: '100%', boxSizing: 'border-box', borderBottom: '1px solid rgba(255,255,255,0.06)', marginTop: 0 }}>
        <div className="section-header" style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <h2 className="title" style={{ margin:0 }}>{lang==='zh'?'近30天已解冻佣金':'Released commissions in last 30 days'}</h2>
        </div>
        <div style={{ marginTop: 10 }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ textAlign:'left' }}>
                <th style={{ padding:'8px 6px' }}>{lang==='zh'?'日期':'Date'}</th>
                <th style={{ padding:'8px 6px' }}>{lang==='zh'?'币种':'Currency'}</th>
                <th style={{ padding:'8px 6px' }}>{lang==='zh'?'金额':'Amount'}</th>
              </tr>
            </thead>
            <tbody>
              {Array.isArray(stats.series) && stats.series.map((r,i) => (
                <tr key={i} style={{ borderTop:'1px solid #263b5e' }}>
                  <td style={{ padding:'8px 6px' }}>{r.day}</td>
                  <td style={{ padding:'8px 6px' }}>{r.currency}</td>
                  <td style={{ padding:'8px 6px' }}>{fmt(r.currency, r.amount)}</td>
                </tr>
              ))}
              {(!stats.series || stats.series.length === 0) && (
                <tr><td colSpan={3} className="desc" style={{ padding:'10px 6px' }}>{lang==='zh'?'暂无数据':'No data'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ background: 'rgba(17,24,39,0.6)', borderRadius: 0, padding: '16px', width: '100%', boxSizing: 'border-box', borderBottom: '1px solid rgba(255,255,255,0.06)', marginTop: 0 }}>
        <div className="section-header" style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <h2 className="title" style={{ margin:0 }}>{lang==='zh'?'佣金记录':(lang==='es'?'Registros de comisión':'Commission Records')}</h2>
          <button className="btn" onClick={fetchAll}>{loading ? (lang==='zh'?'刷新中…':(lang==='es'?'Actualizando…':'Refreshing…')) : (lang==='zh'?'刷新':(lang==='es'?'Actualizar':'Refresh'))}</button>
        </div>
        <div style={{ marginTop: 10 }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ textAlign:'left' }}>
                <th style={{ padding:'8px 6px' }}>{lang==='zh'?'好友':(lang==='es'?'Amigo':'Friend')}</th>
                <th style={{ padding:'8px 6px' }}>{lang==='zh'?'来源':(lang==='es'?'Fuente':'Source')}</th>
                <th style={{ padding:'8px 6px' }}>{lang==='zh'?'币种':(lang==='es'?'Moneda':'Currency')}</th>
                <th style={{ padding:'8px 6px' }}>{lang==='zh'?'金额':(lang==='es'?'Importe':'Amount')}</th>
                <th style={{ padding:'8px 6px' }}>{lang==='zh'?'状态':(lang==='es'?'Estado':'Status')}</th>
                <th style={{ padding:'8px 6px' }}>{lang==='zh'?'剩余冻结':(lang==='es'?'Bloqueo restante':'Remaining lock')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id} style={{ borderTop:'1px solid #263b5e' }}>
                  <td style={{ padding:'8px 6px' }}>{it.inviteePhone || '-'}</td>
                  <td style={{ padding:'8px 6px' }}>{it.source}</td>
                  <td style={{ padding:'8px 6px' }}>{it.currency}</td>
                  <td style={{ padding:'8px 6px' }}>{fmt(it.currency, it.amount)}</td>
                  <td style={{ padding:'8px 6px' }}>{it.status==='frozen' ? (lang==='zh'?'冻结中':(lang==='es'?'Bloqueado':'Frozen')) : (lang==='zh'?'已解冻':(lang==='es'?'Liberado':'Released'))}</td>
                  <td style={{ padding:'8px 6px' }}>{it.status==='frozen' ? fmtRemain(it.remain_ms) : '—'}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={6} className="desc" style={{ padding:'10px 6px' }}>{loading ? (lang==='zh'?'加载中…':(lang==='es'?'Cargando…':'Loading…')) : (lang==='zh'?'暂无记录':(lang==='es'?'Sin registros':'No records'))}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <BottomNav />
    </div>
  );
}