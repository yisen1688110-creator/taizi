import { useEffect, useState } from 'react'
import ReactDOM from 'react-dom'
import { api } from '../../services/api.js'

export default function InstitutionManage() {
  const [profile, setProfile] = useState({ name: '', desc: '', avatar: '' })
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [showModal, setShowModal] = useState(false)

  const fetchProfile = async () => {
    try { setLoading(true); const r = await api.get('/admin/institution/profile'); const p = r?.profile || {}; setProfile({ name: p.name||'', desc: p.desc||'', avatar: p.avatar||'' }) }
    catch { setProfile({ name:'', desc:'', avatar:'' }) }
    finally { setLoading(false) }
  }
  useEffect(() => { fetchProfile() }, [])

  const submit = async () => {
    try { await api.post('/admin/institution/profile', profile); setShowModal(false); await fetchProfile(); alert('已保存机构信息') } catch (e) { alert(String(e?.message||e)) }
  }

  return (
    <div className="card">
      <h1 className="title" style={{ marginTop:0 }}>内容管理 / 机构信息管理</h1>
      <div className="desc" style={{ marginTop:8 }}>{loading ? '加载中...' : ''}</div>
      <div className="form admin-form" style={{ maxWidth: 720, marginTop: 10 }}>
        <label className="label">标题</label>
        <input className="input" value={profile.name} onChange={e=>setProfile(p=>({ ...p, name:e.target.value }))} />
        <label className="label">介绍内容</label>
        <textarea className="input" rows={5} value={profile.desc} onChange={e=>setProfile(p=>({ ...p, desc:e.target.value }))} />
        <label className="label">照片</label>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <input type="file" accept="image/*" onChange={async (e) => {
            const f = e.target.files && e.target.files[0]; if (!f) return;
            const reader = new FileReader(); reader.onload = async () => {
              try { setUploading(true); const dataUrl = String(reader.result||''); const r = await api.post('/admin/institution/upload_image', { dataUrl }); if (r && r.url) setProfile(prev => ({ ...prev, avatar: r.url })); }
              catch (err) { alert(String(err?.message||err)) }
              finally { setUploading(false) }
            }; reader.readAsDataURL(f);
          }} />
          {uploading ? <span className="desc">上传中...</span> : null}
        </div>
        {profile.avatar ? (<div style={{ marginTop:6 }}><img src={profile.avatar} alt="预览" style={{ width:220, height:140, objectFit:'cover', borderRadius:6 }} /></div>) : null}
        <div className="sub-actions" style={{ justifyContent:'flex-end', gap:8, marginTop:10 }}>
          <button className="btn" onClick={() => setShowModal(true)}>预览</button>
          <button className="btn primary" onClick={submit}>保存</button>
        </div>
      </div>

      {showModal && ReactDOM.createPortal((
        <div className="modal" role="dialog" aria-modal="true" onClick={() => setShowModal(false)}>
          <div className="modal-card centered" style={{ maxWidth: 520 }} onClick={(e)=>e.stopPropagation()}>
            <h2 className="title" style={{ marginTop:0 }}>预览</h2>
            <div className="card flat" style={{ display:'grid', gridTemplateColumns:'auto 1fr', gap:12, alignItems:'center' }}>
              <div style={{ width:72, height:72, borderRadius:12, overflow:'hidden', background:'#12243f', display:'grid', placeItems:'center' }}>
                {profile.avatar ? <img src={profile.avatar} alt="logo" style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : <img src="/logo.jpg" alt="logo" style={{ width:48 }} />}
              </div>
              <div>
                <div style={{ fontWeight:700 }}>{profile.name || 'Institution'}</div>
                <div className="desc" style={{ marginTop:6 }}>{profile.desc || 'Welcome to our institution. Trade responsibly.'}</div>
              </div>
            </div>
            <div className="sub-actions" style={{ justifyContent:'flex-end', gap:8, marginTop:10 }}>
              <button className="btn" onClick={() => setShowModal(false)}>关闭</button>
            </div>
          </div>
        </div>
      ), document.body)}
    </div>
  )
}

