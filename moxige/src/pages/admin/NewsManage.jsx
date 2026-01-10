import { useEffect, useState } from 'react'
import ReactDOM from 'react-dom'
import { api } from '../../services/api.js'

export default function NewsManage() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ id: null, title: '', pubDate: '', intro: '', content: '', img: '' })
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)

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
  
  // 图片压缩函数
  const compressImage = (file, maxWidth = 1920, maxHeight = 1080, quality = 0.85) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let width = img.width;
          let height = img.height;
          // 计算缩放比例
          if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width = width * ratio;
            height = height * ratio;
          }
          // 创建canvas进行压缩
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          // 转换为base64，使用JPEG格式以减小文件大小
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(dataUrl);
        };
        img.onerror = () => reject(new Error('图片加载失败'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsDataURL(file);
    });
  };

  // 使用 XMLHttpRequest 上传图片，支持进度显示
  const uploadImageWithProgress = (dataUrl) => {
    return new Promise((resolve, reject) => {
      const BASE = (() => {
        try {
          const isBrowser = typeof location !== 'undefined';
          const port = isBrowser ? String(location.port || '') : '';
          const host = isBrowser ? String(location.hostname || '') : '';
          const isDevLocal = isBrowser && (port === '5173' || port === '5174') && (host === 'localhost' || host === '127.0.0.1');
          if (isDevLocal) return '/api';
          try {
            const override = String(localStorage.getItem('api:base:override') || '').trim();
            if (override) return override.replace(/\/$/, '') + '/api';
          } catch {}
          try {
            const ls = String(localStorage.getItem('api:base') || '').trim();
            if (ls) return ls.replace(/\/$/, '') + '/api';
          } catch {}
          try {
            const v = String(import.meta.env?.VITE_API_BASE || '').trim();
            if (v) return v.replace(/\/$/, '') + '/api';
          } catch {}
          return '/api';
        } catch { return '/api'; }
      })();

      const xhr = new XMLHttpRequest();
      const url = `${BASE}/admin/news/upload_image`;
      
      // 设置超时时间为60秒
      xhr.timeout = 60000;
      
      // 监听上传进度
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          setUploadProgress(percent);
        } else {
          // 如果无法计算总大小，使用模拟进度
          const estimated = Math.min(95, Math.round((e.loaded / (dataUrl.length * 0.75)) * 100));
          setUploadProgress(estimated);
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText);
            if (response.ok && response.url) {
              setUploadProgress(100);
              resolve(response);
            } else {
              reject(new Error(response.error || '上传失败'));
            }
          } catch (e) {
            reject(new Error('响应解析失败'));
          }
        } else {
          try {
            const response = JSON.parse(xhr.responseText);
            reject(new Error(response.error || `HTTP ${xhr.status}`));
          } catch {
            reject(new Error(`HTTP ${xhr.status}`));
          }
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error('网络错误'));
      });

      xhr.addEventListener('timeout', () => {
        reject(new Error('上传超时，请检查网络连接或图片大小'));
      });

      xhr.addEventListener('abort', () => {
        reject(new Error('上传已取消'));
      });

      // 设置请求头
      xhr.open('POST', url);
      xhr.setRequestHeader('Content-Type', 'application/json');
      
      // 添加认证token
      const token = localStorage.getItem('token') || '';
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }
      
      // 添加CSRF token
      try {
        const csrfName = (typeof window !== 'undefined' && (window.CSRF_COOKIE_NAME || 'csrf_token')) || 'csrf_token';
        const getCookie = (name) => {
          try {
            const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()\[\]\\\/\+^])/g, '\\$1') + '=([^;]*)'));
            return m ? decodeURIComponent(m[1]) : '';
          } catch { return ''; }
        };
        const csrf = getCookie(csrfName) || localStorage.getItem('csrf:token') || '';
        if (csrf) {
          xhr.setRequestHeader('X-CSRF-Token', csrf);
        }
      } catch {}

      // 发送请求
      const payload = JSON.stringify({ dataUrl });
      xhr.send(payload);
    });
  };

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
                  try {
                    setUploading(true);
                    setUploadProgress(0);
                    // 先压缩图片（显示10%进度）
                    setUploadProgress(10);
                    const compressedDataUrl = await compressImage(f);
                    // 开始上传（显示20%进度）
                    setUploadProgress(20);
                    // 使用 XMLHttpRequest 上传，支持进度显示
                    const r = await uploadImageWithProgress(compressedDataUrl);
                    if (r && r.url) {
                      setForm(prev => ({ ...prev, img: r.url }));
                    }
                  } catch (err) {
                    setUploadProgress(0);
                    alert(String(err?.message||err || '上传失败，请检查图片大小或网络连接'));
                  } finally {
                    setUploading(false);
                    setTimeout(() => setUploadProgress(0), 500);
                  }
                }} />
                {form.img ? (<div style={{ marginTop:6 }}><img src={form.img} alt="预览" style={{ width:200, height:120, objectFit:'cover', borderRadius:6 }} /></div>) : null}
                {uploading ? (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span className="desc" style={{ fontSize: 14 }}>上传中...</span>
                      <span className="desc" style={{ fontSize: 14, fontWeight: 600 }}>{uploadProgress}%</span>
                    </div>
                    <div style={{ 
                      width: '100%', 
                      height: 8, 
                      backgroundColor: 'var(--card-border)', 
                      borderRadius: 4, 
                      overflow: 'hidden',
                      position: 'relative'
                    }}>
                      <div style={{
                        width: `${uploadProgress}%`,
                        height: '100%',
                        backgroundColor: 'var(--accent)',
                        borderRadius: 4,
                        transition: 'width 0.3s ease',
                        position: 'absolute',
                        left: 0,
                        top: 0
                      }}></div>
                    </div>
                  </div>
                ) : null}
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
