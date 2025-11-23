import { useEffect, useMemo, useState } from 'react'
import { adminWithdrawList, adminWithdrawApprove, adminWithdrawComplete, adminWithdrawReject } from '../../services/api'

export default function AdminWithdraws({ embedded = false }) {
  const [phone, setPhone] = useState('')
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const [currency, setCurrency] = useState('all')
  const [status, setStatus] = useState('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)

  async function load() { try { const r = await adminWithdrawList(phone?{phone}:{}); setItems(r.items||[]) } catch (e) { setError(e?.message||'加载失败') } }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    let arr = Array.isArray(items) ? items.slice() : []
    if (currency !== 'all') arr = arr.filter(x => String(x.currency) === currency)
    if (status !== 'all') arr = arr.filter(x => String(x.status) === status)
    if (startDate) arr = arr.filter(x => { try { return new Date(x.created_at) >= new Date(startDate) } catch { return true } })
    if (endDate) arr = arr.filter(x => { try { return new Date(x.created_at) <= new Date(endDate) } catch { return true } })
    return arr
  }, [items, currency, status, startDate, endDate])

  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const pageItems = useMemo(() => {
    const p = Math.min(Math.max(1, page), totalPages)
    const start = (p - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, page, pageSize, totalPages])

  useEffect(() => { setPage(1) }, [currency, status, startDate, endDate, phone])

  async function approve(id) { try { await adminWithdrawApprove(id); await load() } catch {} }
  async function complete(id) { try { await adminWithdrawComplete(id); await load() } catch {} }
  async function reject(id) { try { await adminWithdrawReject(id); await load() } catch {} }

  const header = (
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <input className="input" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="搜索手机号" />
      <select className="input" value={currency} onChange={e=>setCurrency(e.target.value)}>
        <option value="all">全部币种</option>
        <option value="USD">USD</option>
        <option value="MXN">MXN</option>
        <option value="USDT">USDT</option>
      </select>
      <select className="input" value={status} onChange={e=>setStatus(e.target.value)}>
        <option value="all">全部状态</option>
        <option value="pending">待审核</option>
        <option value="processing">处理中</option>
        <option value="completed">已完成</option>
        <option value="rejected">已驳回</option>
      </select>
      <input className="input" type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} />
      <input className="input" type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} />
      <button className="btn" onClick={load}>查询</button>
      <button className="btn" onClick={() => { setPhone(''); setCurrency('all'); setStatus('all'); setStartDate(''); setEndDate(''); }}>重置</button>
    </div>
  )

  const table = (
    <table className="table">
      <thead><tr><th>姓名</th><th>手机号</th><th>申请时间</th><th>归属运营</th><th>币种</th><th>金额</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>
        {pageItems.map(x => (
          <tr key={x.id}>
            <td>{x.name||''}</td>
            <td>{x.phone||''}</td>
            <td>{x.created_at||''}</td>
            <td>{x.operator_id||''}</td>
            <td>{x.currency}</td>
            <td>{x.amount}</td>
            <td>{x.status==='pending'?'待审核':x.status==='processing'?'处理中':x.status==='completed'?'已完成':x.status==='rejected'?'已驳回':x.status}</td>
            <td>
              {x.status==='pending' && (<button className="btn" onClick={()=>approve(x.id)}>进入审批</button>)}
              {x.status==='processing' && (<>
                <button className="btn" onClick={()=>complete(x.id)}>已完成打款</button>
                <button className="btn" onClick={()=>reject(x.id)}>驳回</button>
              </>)}
            </td>
          </tr>
        ))}
        {pageItems.length===0 ? (<tr><td colSpan={8} className="desc">暂无申请记录</td></tr>) : null}
      </tbody>
    </table>
  )

  const pager = (
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
      <div>每页
        <select className="input" value={pageSize} onChange={e=>setPageSize(Number(e.target.value))} style={{ width: 80, marginLeft: 6, marginRight: 6 }}>
          <option value={20}>20</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
        共 {total} 条
      </div>
      <div>
        <button className="btn" disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>上一页</button>
        <span style={{ margin: '0 8px' }}>{page}/{totalPages}</span>
        <button className="btn" disabled={page>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))}>下一页</button>
      </div>
    </div>
  )

  if (embedded) {
    return (
      <div>
        {header}
        {error ? <div className="error">{error}</div> : null}
        {table}
        {pager}
      </div>
    )
  }

  return (
    <div className="screen">
      <div className="card">
        <h1 className="title">用户提现</h1>
        {header}
        {error ? <div className="error">{error}</div> : null}
        {table}
        {pager}
      </div>
    </div>
  )
}