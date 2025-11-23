import { useState, useEffect } from 'react'
import { meWithdrawCreate, meWithdrawList, meWithdrawCancel } from '../../services/api'

export default function WithdrawModal({ onClose }) {
  const [currency, setCurrency] = useState('USD')
  const [amount, setAmount] = useState('')
  const [methodType, setMethodType] = useState('bank')
  const [bankAccount, setBankAccount] = useState('')
  const [usdtAddress, setUsdtAddress] = useState('')
  const [usdtNetwork, setUsdtNetwork] = useState('')
  const [balance, setBalance] = useState({ usd: 0, mxn: 0, usdt: 0 })
  const [records, setRecords] = useState([])
  const [error, setError] = useState('')

  useEffect(() => { loadRecords() }, [])
  async function loadRecords() { try { const r = await meWithdrawList(); setRecords(r.items || []) } catch {} }

  function onCurrencyChange(e) {
    const c = e.target.value
    setCurrency(c)
    if (c === 'USDT') setMethodType('usdt'); else setMethodType('bank')
  }

  async function submit() {
    setError('')
    try {
      const payload = { currency, amount: Number(amount||0), method_type: methodType, bank_account: bankAccount, usdt_address: usdtAddress, usdt_network: usdtNetwork }
      await meWithdrawCreate(payload)
      await loadRecords()
      setAmount('')
    } catch (e) { setError(e?.message || '提交失败') }
  }

  async function cancel(id) { try { await meWithdrawCancel(id); await loadRecords() } catch {} }

  return (
    <div className="modal">
      <div className="modal-content">
        <div className="modal-header">
          <div className="title">提现</div>
          <button className="close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <label>币种</label>
          <select value={currency} onChange={onCurrencyChange}>
            <option value="USD">USD</option>
            <option value="MXN">MXN</option>
            <option value="USDT">USDT</option>
          </select>
          {currency !== 'USDT' ? (
            <>
              <label>银行卡</label>
              <input className="input" value={bankAccount} onChange={e=>setBankAccount(e.target.value)} placeholder="请输入银行卡信息" />
            </>
          ) : (
            <>
              <label>USDT地址</label>
              <input className="input" value={usdtAddress} onChange={e=>setUsdtAddress(e.target.value)} placeholder="请输入地址" />
              <label>网络</label>
              <input className="input" value={usdtNetwork} onChange={e=>setUsdtNetwork(e.target.value)} placeholder="例如 TRC20/ERC20" />
            </>
          )}
          <label>金额</label>
          <input className="input" type="number" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="提现金额" />
          <div className="desc">余额：USD {balance.usd} / MXN {balance.mxn} / USDT {balance.usdt}</div>
          {error ? <div className="error">{error}</div> : null}
          <button className="btn primary" onClick={submit}>提交</button>
          <div className="section">
            <div className="subtitle">提现记录</div>
            <table className="table">
              <thead><tr><th>时间</th><th>币种</th><th>金额</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                {(records||[]).map(r=> (
                  <tr key={r.id}>
                    <td>{r.created_at}</td>
                    <td>{r.currency}</td>
                    <td>{r.amount}</td>
                    <td>{r.status}</td>
                    <td>{r.status==='pending' ? (<button className="btn" onClick={()=>cancel(r.id)}>取消</button>) : null}</td>
                  </tr>
                ))}
                {records.length===0 ? (<tr><td colSpan={5} className="desc">暂无记录</td></tr>) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}