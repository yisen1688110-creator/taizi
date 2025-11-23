import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { meWithdrawList, meWithdrawCancel } from '../../services/api'
import { useI18n } from '../../i18n.jsx'

export default function WithdrawRecords() {
  const { t } = useI18n()
  const nav = useNavigate()
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  async function load() { try { const r = await meWithdrawList(); setItems(r.items||[]) } catch (e) { setError(e?.message||'加载失败') } }
  useEffect(()=>{ load() }, [])
  async function cancel(id){ try { await meWithdrawCancel(id); await load() } catch {} }
  return (
    <div className="screen">
      <div className="card">
        <div className="title" style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span>{t('withdrawRecordsTitle')}</span>
          <button className="btn" onClick={()=>nav('/me/withdraw')}>{t('btnBackProfile')}</button>
        </div>
        {error ? <div className="error">{error}</div> : null}
        <table className="table">
          <thead><tr><th>{t('tableTime')}</th><th>{t('tableCurrency')}</th><th>{t('tableAmount')}</th><th>{t('tableStatus')}</th><th>{t('tableActions')}</th></tr></thead>
          <tbody>
            {(items||[]).map(r => (
              <tr key={r.id}>
                <td>{r.created_at}</td>
                <td>{r.currency}</td>
                <td>{r.amount}</td>
                <td>{r.status==='pending'?t('statusPending'):r.status==='processing'?t('statusProcessing'):r.status==='completed'?t('statusCompleted'):t('statusRejected')}</td>
                <td>{r.status==='pending' ? (<button className="btn" onClick={()=>cancel(r.id)}>{t('btnCancel')}</button>) : null}</td>
              </tr>
            ))}
            {items.length===0 ? (<tr><td colSpan={5} className="desc">{t('tableNoRecords')}</td></tr>) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}