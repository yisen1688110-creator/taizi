import { useEffect, useState } from 'react'
import ReactDOM from 'react-dom'
import { api } from '../../services/api.js'

export default function NewsManage() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ id: null, title: '', pubDate: '', intro: '', content: '', img: '' })
  const [uploading, setUploading] = useState(false)

  const fetchList = async () => {
    try { setLoading(true); const r = await api.get('/admin/news/list'); const arr = Array.isArray(r?.items) ? r.items : []; setItems(arr) } catch { setItems([]) } finally { setLoading(false) }
  }
  useEffect(() => { fetchList() }, [])

  const openCreate = () => { setForm({ id: null, title: '', pubDate: new Date().toISOString().slice(0,10), intro: '', content: '', img: '' }); setShowModal(true) }
  const openEdit = (it) => { setForm({ id: it.id, title: it.title||'', pubDate: (it.pub_date||'').slice(0,10), intro: it.intro||'', content: it.content||'', img: it.img||'' }); setShowModal(true) }
  const submit = async () => {
    try {
      const payload = { title: form.title, pubDate: form.pubDate, intro: form.intro, content: form.content, img: form.img }
      if (form.id) { await api.post(`/admin/news/update/${form.id}`, payload) } else { await api.post('/admin/news/create', payload) }
      setShowModal(false); await fetchList()
    } catch (e) { alert(String(e?.message||e)) }
  }
  const del = async (id) => { if (!confirm('确认删除该新闻？')) return; try { await api.post(`/admin/news/delete/${id}`); await fetchList() } catch (e) { alert(String(e?.message||e)) } }
  const pin = async (it) => { try { await api.post(`/admin/news/pin/${it.id}`, { pinned: it.pinned ? 0 : 1 }); await fetchList() } catch (e) { alert(String(e?.message||e)) } }

  return (
    <div className="card">
      <h1 className="title" style={{ marginTop:0 }}>内容管理 / 新闻管理</h1>
      <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
        <button className="btn primary" onClick={openCreate}>发布新闻</button>
      </div>
      <div className="desc" style={{ marginTop:8 }}>{loading ? '加载中...' : ''}</div>
      <table className="data-table" style={{ marginTop:8 }}>
        <thead>
          <tr>
            <th>标题</th>
            <th>日期</th>
            <th>简介</th>
            <th>配图</th>
            <th>置顶</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {(items||[]).map(it => (
            <tr key={it.id}>
              <td>{it.title}</td>
              <td>{(it.pub_date||'').slice(0,10)}</td>
              <td>{(it.intro||'').slice(0,48)}</td>
              <td>{it.img ? <img src={it.img} alt={it.title} style={{ width:80, height:50, objectFit:'cover' }} /> : '-'}</td>
              <td>{it.pinned ? '是' : '否'}</td>
              <td>
                <div style={{ display:'flex', gap:6 }}>
                  <button className="pill" onClick={() => pin(it)}>{it.pinned ? '取消置顶' : '置顶'}</button>
                  <button className="pill" onClick={() => openEdit(it)}>编辑</button>
                  <button className="pill" onClick={() => del(it.id)}>删除</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showModal && ReactDOM.createPortal(
        (
          <div className="modal" role="dialog" aria-modal="true" onClick={() => setShowModal(false)}>
            <div className="modal-card centered" style={{ maxWidth: 680, maxHeight:'80vh', overflow:'auto', margin:0 }} onClick={(e)=>e.stopPropagation()}>
              <h2 className="title" style={{ marginTop:0 }}>{form.id ? '编辑新闻' : '发布新闻'}</h2>
              <div className="form-group"><label>标题</label><input className="form-input" value={form.title} onChange={e=>setForm({ ...form, title:e.target.value })} /></div>
              <div className="form-group"><label>日期</label><input className="form-input" type="date" value={form.pubDate} onChange={e=>setForm({ ...form, pubDate:e.target.value })} /></div>
              <div className="form-group"><label>简介</label><textarea className="form-input" rows={3} value={form.intro} onChange={e=>setForm({ ...form, intro:e.target.value })} /></div>
              <div className="form-group"><label>详情</label><textarea className="form-input" rows={6} value={form.content} onChange={e=>setForm({ ...form, content:e.target.value })} /></div>
              <div className="form-group"><label>配图</label>
                <input type="file" accept="image/*" onChange={async (e) => {
                  const f = e.target.files && e.target.files[0]; if (!f) return;
                  const reader = new FileReader(); reader.onload = async () => {
                    try { setUploading(true); const dataUrl = String(reader.result||''); const r = await api.post('/admin/news/upload_image', { dataUrl }); if (r && r.url) setForm(prev => ({ ...prev, img: r.url })); } catch (err) { alert(String(err?.message||err)); } finally { setUploading(false); }
                  }; reader.readAsDataURL(f);
                }} />
                {form.img ? (<div style={{ marginTop:6 }}><img src={form.img} alt="预览" style={{ width:200, height:120, objectFit:'cover', borderRadius:6 }} /></div>) : null}
                {uploading ? <div className="desc" style={{ marginTop:6 }}>上传中...</div> : null}
              </div>
              <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
                <button className="pill" onClick={()=>setShowModal(false)}>取消</button>
                <button className="btn primary" onClick={submit}>提交</button>
              </div>
            </div>
          </div>
        ), document.body)}
    </div>
  )
}
