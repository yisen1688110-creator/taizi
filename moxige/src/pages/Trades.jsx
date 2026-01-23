import { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import BottomNav from "../components/BottomNav.jsx";
import { useI18n } from "../i18n.jsx";
import "../styles/trading.css";
import { api } from "../services/api.js";
import { formatMoney } from "../utils/money.js";

function readSession() {
  try { return JSON.parse(localStorage.getItem("sessionUser") || "null"); } catch { return null; }
}

function formatDay(ts) {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  } catch { return '—'; }
}

// 成交配对逻辑（FIFO）：
// - 买 = 做多开仓；卖 = 做空开仓
// - 先配对平仓：买先尝试回补空头；卖先尝试卖出平多
// - 剩余部分进入对应方向的未平仓队列
function buildDeals(rawTrades = []) {
  const byTime = [...rawTrades].sort((a, b) => a.ts - b.ts);
  const longBuys = new Map();   // symbol -> [{ price, qty, ts }]
  const shortSells = new Map(); // symbol -> [{ price, qty, ts }]
  const deals = [];

  for (const tr of byTime) {
    const symbol = tr.symbol;
    const price = Number(tr.price);
    let remaining = Number(tr.quantity);
    const ts = tr.ts;

    if (tr.side === 'buy') {
      // 先尝试回补空头（买平空）
      let sq = shortSells.get(symbol) || [];
      while (remaining > 0 && sq.length > 0) {
        const lot = sq[0];
        const useQty = Math.min(remaining, lot.qty);
        const coverAmount = price * useQty; // 买入金额（平空的成交金额）
        const openAmount = lot.price * useQty; // 开空时的卖出金额
        const pnl = openAmount - coverAmount; // 做空盈亏 = 卖出收入 - 买回成本
        deals.push({
          symbol,
          buyTs: ts,
          sellTs: lot.ts,
          qty: useQty,
          buyPrice: price,
          sellPrice: lot.price,
          amount: openAmount, // 显示卖出总金额（做空开仓时卖出）
          pnl,
        });
        lot.qty -= useQty;
        remaining -= useQty;
        if (lot.qty <= 0) sq.shift();
      }
      shortSells.set(symbol, sq);
      // 未完全回补的买单作为做多开仓
      if (remaining > 0) {
        const lq = longBuys.get(symbol) || [];
        lq.push({ price, qty: remaining, ts });
        longBuys.set(symbol, lq);
      }
    } else if (tr.side === 'sell') {
      // 先尝试卖出平多（卖平多）
      let lq = longBuys.get(symbol) || [];
      while (remaining > 0 && lq.length > 0) {
        const lot = lq[0];
        const useQty = Math.min(remaining, lot.qty);
        const openAmount = lot.price * useQty; // 买入开多的金额
        const closeAmount = price * useQty;    // 卖出平多的成交金额（用于显示）
        const pnl = closeAmount - openAmount;  // 做多盈亏
        deals.push({
          symbol,
          buyTs: lot.ts,
          sellTs: ts,
          qty: useQty,
          buyPrice: lot.price,
          sellPrice: price,
          amount: closeAmount, // 显示卖出的总金额（平多时）
          pnl,
        });
        lot.qty -= useQty;
        remaining -= useQty;
        if (lot.qty <= 0) lq.shift();
      }
      longBuys.set(symbol, lq);

      // 剩余未配对的卖单作为做空开仓
      if (remaining > 0) {
        const sq = shortSells.get(symbol) || [];
        sq.push({ price, qty: remaining, ts });
        shortSells.set(symbol, sq);
      }
    }
  }

  // 剩余未平仓：
  // 未卖出的多头：保留买入信息，盈亏为 null
  for (const [symbol, q] of longBuys.entries()) {
    for (const lot of q) {
      if (lot.qty > 0) {
        const pnl = null;    // 未平仓不显示动态盈亏
        const amount = null; // 未平仓不显示金额
        deals.push({
          symbol,
          buyTs: lot.ts,
          sellTs: null,
          qty: lot.qty,
          buyPrice: lot.price,
          sellPrice: null,
          amount,
          pnl,
        });
      }
    }
  }
  // 未买回的空头：保留卖出信息，盈亏为 null
  for (const [symbol, q] of shortSells.entries()) {
    for (const lot of q) {
      if (lot.qty > 0) {
        const pnl = null;    // 未平仓不显示动态盈亏
        const amount = null; // 未平仓不显示金额
        deals.push({
          symbol,
          buyTs: null,
          sellTs: lot.ts,
          qty: lot.qty,
          buyPrice: null,
          sellPrice: lot.price,
          amount,
          pnl,
        });
      }
    }
  }

  // 展示按最近（平仓时间优先，其次开仓时间）倒序
  deals.sort((a, b) => ((b.sellTs && b.buyTs ? Math.max(b.sellTs, b.buyTs) : (b.sellTs || b.buyTs)) - (a.sellTs && a.buyTs ? Math.max(a.sellTs, a.buyTs) : (a.sellTs || a.buyTs))));
  return deals;
}

export default function Trades() {
  const { t } = useI18n();
  const [session] = useState(() => readSession());
  const navigate = useNavigate();

  const [trades, setTrades] = useState([]);
  const deals = useMemo(() => buildDeals(trades), [trades]);

  // 后端拉取真实交易记录，不使用本地缓存
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const data = await api.get('/me/orders');
        const arr = Array.isArray(data?.orders) ? data.orders : [];
        const norm = arr
          .filter(o => String(o.status).toLowerCase() === 'filled')
          .map(o => ({
            symbol: String(o.symbol),
            price: Number(o.price || 0),
            quantity: Number(o.qty || 0),
            side: String(o.side || 'buy').toLowerCase(),
            market: String(o.market || 'us'),
            ts: new Date(o.updated_at || o.created_at).getTime(),
          }));
        if (!stopped) setTrades(norm);
      } catch {
        if (!stopped) setTrades([]);
      }
    };
    load();
    const timer = setInterval(load, 5000);
    return () => { stopped = true; clearInterval(timer); };
  }, []);

  return (
    <div className="screen trading-screen" style={{ paddingTop: 0 }}>
      {/* 页面顶部：返回按钮 + 标题 */}
      <div style={{ 
        display: 'flex', alignItems: 'center', gap: 12, 
        padding: '16px 16px 12px', width: '100%', boxSizing: 'border-box'
      }}>
        <button
          onClick={() => {
            try {
              const params = new URLSearchParams(window.location.search || "");
              const from = (params.get('from') || sessionStorage.getItem('trades:from') || '').trim();
              if (from === 'me') { navigate('/me'); return; }
              if (from === 'swap') { navigate('/swap'); return; }
            } catch {}
            navigate(-1);
          }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 36, height: 36, borderRadius: 10,
            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
            cursor: 'pointer', color: '#e5e7eb', fontSize: 16, flexShrink: 0
          }}
          aria-label="back"
        >
          <span style={{ 
            width: 10, height: 10, 
            border: 'solid #e5e7eb', borderWidth: '0 0 2px 2px',
            transform: 'rotate(45deg)', marginLeft: 3
          }}></span>
        </button>
        <h2 className="trades-title" style={{ margin: 0 }}>{t('trades')}</h2>
      </div>

      {/* 页面卡片栅格（靠左对齐） */}
      <div className="trades-page-grid">
        <div className="trading-card positions-card">
          <div className="deals-list" aria-label="deals-list">
            <div className="deal-header">
              <span>{t('symbol')}</span>
              <span>{t('market') || 'Market'}</span>
              <span>{t('direction') || 'Direction'}</span>
              <span>{t('buyTime') || 'Buy Time'}</span>
              <span>{t('sellTime') || 'Sell Time'}</span>
              <span>{t('amount') || 'Amount'}</span>
              <span>{t('pnl') || 'PnL'}</span>
              <span>{t('pnlPct') || 'PnL %'}</span>
            </div>
            {deals.length === 0 ? (
              <div className="portfolio-placeholder"><p>{t('tradesEmpty') || 'No trades'}</p></div>
            ) : (
              deals.map((d, idx) => (
                <div className="deal-row" key={`${d.symbol}-${d.buyTs ?? d.sellTs}-${idx}`}>
                  <span className="pos-symbol">{d.symbol}</span>
                  <span className="pos-avg">{
                    (() => {
                      const m = trades.find(x => x.symbol === d.symbol)?.market || 'us';
                      return m === 'pl' ? (t('poland') || 'Poland') : (m === 'us' ? (t('usa') || 'USA') : (t('crypto') || 'Crypto'));
                    })()
                  }</span>
                  <span className="pos-avg">{(d.buyTs && !d.sellTs) ? (t('long') || 'Long') : (d.sellTs && !d.buyTs) ? (t('short') || 'Short') : (d.buyTs && d.sellTs) ? (d.sellPrice >= d.buyPrice ? (t('long') || 'Long') : (t('short') || 'Short')) : '—'}</span>
                  <span className="pos-avg">{formatDay(d.buyTs ?? d.sellTs)}</span>
                  <span className="pos-avg">{formatDay(d.sellTs ?? d.buyTs)}</span>
                  <span className="pos-avg">{
                    (() => {
                      if (d.amount == null) return '—';
                      const m = trades.find(x => x.symbol === d.symbol)?.market || 'us';
                      const cur = m === 'pl' ? 'PLN' : (m === 'us' ? 'USD' : 'USD');
                      return formatMoney(d.amount, cur);
                    })()
                  }</span>
                  <span className={`pos-pnl ${d.pnl == null ? '' : d.pnl >= 0 ? 'up' : 'down'}`}>{
                    (() => {
                      if (d.pnl == null) return '—';
                      const m = trades.find(x => x.symbol === d.symbol)?.market || 'us';
                      const cur = m === 'pl' ? 'PLN' : (m === 'us' ? 'USD' : 'USD');
                      return formatMoney(d.pnl, cur);
                    })()
                  }</span>
                  <span className={`pos-pnl ${d.pnl == null ? '' : d.pnl >= 0 ? 'up' : 'down'}`}>{
                    (() => {
                      if (d.pnl == null || !Number.isFinite(d.buyPrice) || !Number.isFinite(d.sellPrice)) return '—';
                      const base = Math.max(d.buyPrice, 0.00001);
                      const pct = ((d.sellPrice - d.buyPrice) / base) * 100;
                      return `${pct.toFixed(2)}%`;
                    })()
                  }</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <BottomNav />
    </div>
  );
}