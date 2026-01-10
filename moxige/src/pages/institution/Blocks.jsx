import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import BottomNav from "../../components/BottomNav.jsx";
import { useI18n } from "../../i18n.jsx";
import { api } from "../../services/api.js";
import { formatMoney, formatUSDT } from "../../utils/money.js";
import { formatMinute, getMexicoTimestamp } from "../../utils/date.js";
// ...
import { toMs } from "../../utils/time.js";
import { getQuotes, getCryptoQuotes, getStockSpark, getUsdMxnRate } from "../../services/marketData.js";
import "../../styles/settings.css";
import "../../styles/settings.css";

// 机构 - 大宗交易列表页
export default function InstitutionBlocks() {
  const nav = useNavigate();
  const { t, lang } = useI18n();
  const [items, setItems] = useState([]); // 后端配置的大宗交易
  const [loading, setLoading] = useState(false);
  const [quotes, setQuotes] = useState({}); // { key: { price, changePct } }
  const [qtyMap, setQtyMap] = useState({}); // { id: qty }
  const [sliderMap, setSliderMap] = useState({}); // { id: 0-100 }
  const [keyMap, setKeyMap] = useState({}); // { id: subscribeKey }
  const [balances, setBalances] = useState({ MXN: 0, USD: 0, USDT: 0 });
  const [usdToMxnRate, setUsdToMxnRate] = useState(18.0);
  const [submittingId, setSubmittingId] = useState(null);
  const [toast, setToast] = useState({ show: false, type: 'ok', text: '' });
  const showToast = (text, type = 'ok') => { setToast({ show: true, type, text }); setTimeout(() => setToast({ show: false, type, text: '' }), 1000); };
  useEffect(() => {
    try {
      const qs = new URLSearchParams(typeof location !== 'undefined' ? (location.search || '') : '');
      const td = (qs.get('tdkey') || qs.get('twelvedata') || '').trim();
      if (td && !localStorage.getItem('td:key')) localStorage.setItem('td:key', td);
    } catch { }
  }, []);

  const labels = useMemo(() => ({
    pageTitle: lang === 'zh' ? '大宗交易' : (lang === 'es' ? 'Operaciones grandes' : 'Block Trade'),
    type: lang === 'zh' ? '类型' : (lang === 'es' ? 'Tipo' : 'Type'),
    typeCrypto: lang === 'zh' ? '加密货币' : (lang === 'es' ? 'Cripto' : 'Crypto'),
    typeUS: lang === 'zh' ? '美股' : (lang === 'es' ? 'US Acciones' : 'US Stocks'),
    symbol: lang === 'zh' ? '编码' : (lang === 'es' ? 'Código' : 'Symbol'),
    currentPrice: lang === 'zh' ? '现价' : (lang === 'es' ? 'Precio actual' : 'Current Price'),
    blockPrice: lang === 'zh' ? '大宗交易价格' : (lang === 'es' ? 'Precio de bloque' : 'Block Price'),
    minQty: lang === 'zh' ? '最小购买' : (lang === 'es' ? 'Mínimo' : 'Min Qty'),
    qty: lang === 'zh' ? '申购数量' : (lang === 'es' ? 'Cantidad' : 'Quantity'),
    subscribeKey: lang === 'zh' ? '认购密钥' : (lang === 'es' ? 'Clave de suscripción' : 'Subscription Key'),
    window: lang === 'zh' ? '申购时间窗' : (lang === 'es' ? 'Ventana de suscripción' : 'Subscription Window'),
    lockedUntil: lang === 'zh' ? '锁定至' : (lang === 'es' ? 'Bloqueado hasta' : 'Lock Until'),
    btnSubmit: lang === 'zh' ? '提交' : (lang === 'es' ? 'Enviar' : 'Submit'),
    submitting: lang === 'zh' ? '提交中...' : (lang === 'es' ? 'Enviando...' : 'Submitting...'),
    closed: lang === 'zh' ? '已关闭' : (lang === 'es' ? 'Cerrado' : 'Closed'),
    consume: lang === 'zh' ? '消耗资金' : (lang === 'es' ? 'Consumir fondos' : 'Consume'),
  }), [t, lang]);

  useEffect(() => {
    fetchList();
    fetchBalances();
  }, []);

  async function fetchBalances() {
    try {
      const res = await api.get('/me/balances');
      const arr = Array.isArray(res?.balances) ? res.balances : [];
      const map = { MXN: 0, USD: 0, USDT: 0 };
      arr.forEach(b => { map[String(b.currency).toUpperCase()] = Number(b.amount || 0); });
      setBalances(map);

      const { rate } = await getUsdMxnRate();
      if (rate > 0) setUsdToMxnRate(rate);
    } catch (e) { console.warn('fetch balances/rate failed', e); }
  }

  function toCryptoBase(s) {
    const u = String(s || '').toUpperCase();
    return u.replace(/USDT$/i, '').replace(/\/USDT$/i, '').replace(/\/USD$/i, '');
  }

  async function fetchList() {
    try {
      setLoading(true);
      const data = await api.get('/trade/block/list');
      const arr = Array.isArray(data?.items) ? data.items : [];
      const active = arr.filter(it => String(it.status || 'active') === 'active');
      setItems(active);
    } catch (e) {
      console.warn('fetch block list failed', e);
      setItems([]);
    } finally { setLoading(false); }
  }

  // 行情刷新（2s）
  useEffect(() => {
    let stopped = false;
    async function refreshQuotes() {
      const cryptoSymbols = items
        .filter(it => it.market === 'crypto')
        .map(it => toCryptoBase(it.symbol));
      const usSymbols = items.filter(it => it.market === 'us').map(it => String(it.symbol).toUpperCase());
      const next = {};
      try {
        if (cryptoSymbols.length) {
          const q = await getCryptoQuotes({ symbols: cryptoSymbols });
          for (const r of q) {
            next[`crypto:${r.symbol}`] = { price: Number(r.priceUSD || r.price || 0), changePct: Number(r.changePct || 0) };
          }
          const missingCrypto = cryptoSymbols.filter(s => !(next[`crypto:${s}`]?.price > 0));
          for (const base of missingCrypto) {
            try {
              const pair = `${String(base).toUpperCase()}USDT`;
              const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(pair)}`;
              const j = await fetch(url).then(r => r.json()).catch(() => null);
              const p = Number(j?.lastPrice ?? j?.weightedAvgPrice ?? j?.prevClosePrice ?? 0);
              const ch = Number(j?.priceChangePercent ?? 0);
              if (p > 0) next[`crypto:${String(base).toUpperCase()}`] = { price: p, changePct: ch };
            } catch { }
          }
        }
      } catch {
        // TwelveData 不可用或密钥缺失时的全量回退
        try {
          const yfSymsAll = cryptoSymbols.map(b => `${String(b).toUpperCase()}-USD`);
          const arr = await yf.getMultipleStocks(yfSymsAll);
          for (const r of arr) {
            const base = String(r.symbol || '').replace(/-USD$/i, '').toUpperCase();
            const p = Number(r.price || 0);
            if (p > 0) next[`crypto:${base}`] = { price: p, changePct: Number(r.changePercent || 0) };
          }
        } catch { }
        for (const base of cryptoSymbols) {
          try {
            const pair = `${String(base).toUpperCase()}USDT`;
            const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(pair)}`;
            const j = await fetch(url).then(r => r.json()).catch(() => null);
            const p = Number(j?.lastPrice ?? j?.weightedAvgPrice ?? j?.prevClosePrice ?? 0);
            const ch = Number(j?.priceChangePercent ?? 0);
            if (p > 0) next[`crypto:${String(base).toUpperCase()}`] = { price: p, changePct: ch };
          } catch { }
        }
      }
      try {
        if (usSymbols.length) {
          const q = await getQuotes({ market: 'us', symbols: usSymbols });
          for (const r of q) {
            next[`us:${r.symbol}`] = { price: Number(r.price || 0), changePct: Number(r.changePct || 0) };
          }
          const missingUs = usSymbols.filter(s => !(next[`us:${s}`]?.price > 0));
          for (const s of missingUs) {
            try {
              const closes = await getStockSpark(s, 'us', { interval: '1day', points: 1 });
              const prevClose = Array.isArray(closes) && closes.length ? Number(closes[closes.length - 1] || 0) : 0;
              if (Number.isFinite(prevClose) && prevClose > 0) {
                next[`us:${s}`] = { price: prevClose, changePct: 0 };
              } else {
                try {
                  const raw = JSON.parse(localStorage.getItem(`td:us:${s}`) || 'null');
                  const d = raw?.data;
                  const p = Number(d?.price ?? d?.close ?? d?.previous_close ?? 0);
                  if (p > 0) next[`us:${s}`] = { price: p, changePct: Number(d?.changePct ?? d?.percent_change ?? 0) };
                } catch { }
              }
            } catch { }
          }
        }
      } catch { }
      if (!stopped) setQuotes(prev => ({ ...prev, ...next }));
    }
    refreshQuotes();
    const iv = setInterval(refreshQuotes, 30000);
    return () => { stopped = true; clearInterval(iv); };
  }, [items]);

  function nowMs() { return Date.now(); }
  function inWindow(it) {
    const s = getMexicoTimestamp(it.start_at || it.startAt || '');
    const e = getMexicoTimestamp(it.end_at || it.endAt || '');
    const n = nowMs();
    return Number.isFinite(s) && Number.isFinite(e) && n >= s && n <= e;
  }

  // 预览/开发环境下允许跳过时间窗限制，便于测试提交流程
  function canSubmitNow(it) {
    const open = inWindow(it);
    let override = false;
    try {
      const qs = new URLSearchParams(typeof location !== 'undefined' ? (location.search || '') : '');
      const v = (qs.get('submitAny') || qs.get('force') || qs.get('allow') || '').trim();
      if (v) override = /^(1|true|yes|y)$/i.test(v);
    } catch { }
    try {
      const ls = (localStorage.getItem('inst:block:submit_anytime') || '').trim();
      if (ls) override = /^(1|true|yes|y)$/i.test(ls);
    } catch { }
    const isDev = !!(import.meta.env && import.meta.env.DEV);
    return open || override || isDev;
  }

  async function submit(it) {
    const id = Number(it.id);
    const market = String(it.market);
    const symbol = String(it.symbol).toUpperCase();
    const q = Number(qtyMap[id] || 0);
    const minQ = Number(it.min_qty || it.minQty || 1);
    const key = String(keyMap[id] || '').trim();
    if (!q || !Number.isFinite(q) || q < minQ) { alert(lang === 'zh' ? '数量不合法或低于最小购买' : 'Invalid qty or below minimum'); return; }
    if (!key || key.length < 6) { alert(lang === 'zh' ? '请输入有效认购密钥' : 'Enter valid subscription key'); return; }
    const can = canSubmitNow(it);
    if (!can) { alert(lang === 'zh' ? '不在申购时间窗内' : 'Out of subscription window'); return; }
    const quoteKey = `${market}:${symbol}`;
    // Use the block price (discounted price) for the subscription, not the market price
    const cp = Number(it.price || 0);
    try {
      setSubmittingId(id);
      await api.post('/trade/block/subscribe', { blockId: id, qty: q, currentPrice: cp, key });
      showToast(lang === 'zh' ? '已提交申购，待后台审批' : (lang === 'es' ? 'Enviado, en espera de aprobación' : 'Submitted, pending approval'), 'ok');
      setQtyMap(prev => ({ ...prev, [id]: '' }));
      setKeyMap(prev => ({ ...prev, [id]: '' }));
      // 保持在当前页，避免前端 /admin 404
    } catch (e) {
      const msg = (e && (e.message || (e.response && (e.response.data?.error || e.response.data?.message)))) || String(e);
      alert((lang === 'zh' ? '提交失败: ' : 'Submit failed: ') + msg);
    } finally { setSubmittingId(null); }
  }

  const handleSliderChange = (it, percent, currentPrice) => {
    const id = it.id;
    setSliderMap(prev => ({ ...prev, [id]: percent }));

    const market = String(it.market);
    const isCrypto = market === 'crypto';
    const balance = isCrypto ? (balances.USDT || 0) : (balances.MXN || 0);
    const price = Number(it.price || 0); // Block price in USD/USDT

    if (price <= 0) return;

    // Calculate max qty affordable
    // Crypto: balanceUSDT / priceUSDT
    // US: balanceMXN / (priceUSD * rate)
    const costPerUnit = isCrypto ? price : (price * usdToMxnRate);
    const maxQty = Math.floor(balance / costPerUnit);
    const minQty = Number(it.min_qty || it.minQty || 1);

    if (maxQty < minQty) {
      if (percent === 100) setQtyMap(prev => ({ ...prev, [id]: maxQty > 0 ? maxQty : '' }));
      return;
    }

    const targetQty = Math.floor(maxQty * (percent / 100));
    setQtyMap(prev => ({ ...prev, [id]: targetQty > 0 ? targetQty : '' }));
  };

  return (
    <div className="screen top-align" style={{ paddingTop: 6, padding: '6px' }}>
      {toast.show && (<div className={`top-toast ${toast.type}`}>{toast.text}</div>)}
      <div className="inst-container" style={{ paddingTop: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <button className="back-btn" onClick={() => nav(-1)} aria-label="back" style={{ position: 'relative', top: 'auto', left: 'auto' }}><span className="back-icon"></span></button>
            <h1 className="title" style={{ marginTop: 0, marginBottom: 0 }}>{labels.pageTitle}</h1>
          </div>
          <div className="desc" style={{ marginTop: 6 }}>{lang === 'zh' ? '从后台配置的大宗交易中选择并认购' : (lang === 'es' ? 'Seleccione y suscríbase a operaciones de bloque' : 'Select and subscribe to block trades')}</div>
        </div>

        <div className="inst-card">
          {loading && (<div className="desc">{lang === 'zh' ? '加载中...' : (lang === 'es' ? 'Cargando...' : 'Loading...')}</div>)}
          {!loading && (() => items.filter(inWindow).length === 0)() && (<div className="desc">{lang === 'zh' ? '暂无数据' : (lang === 'es' ? 'Sin datos' : 'No data')}</div>)}
          {!loading && items.filter(inWindow).length > 0 && (
            <div style={{ display: 'grid', gap: 12 }}>
              {items.filter(inWindow).map(it => {
                const market = String(it.market);
                const origSymbol = String(it.symbol).toUpperCase();
                const baseSymbol = market === 'crypto' ? toCryptoBase(origSymbol) : origSymbol;
                const blockPrice = Number(it.price || 0);
                const minQty = Number(it.min_qty || it.minQty || 1);
                const qk = `${market}:${baseSymbol}`;
                const quote = quotes[qk];
                const currentPriceRaw = Number(quote?.price || 0);
                const currentPrice = currentPriceRaw > 0 ? currentPriceRaw : blockPrice;
                const currency = market === 'crypto' ? 'USDT' : 'USD';
                const total = (blockPrice * Number(qtyMap[it.id] || 0)) || 0;
                const unitProfit = currentPrice && blockPrice ? (currentPrice - blockPrice) : 0;
                const unitPct = currentPrice && blockPrice ? ((currentPrice - blockPrice) / blockPrice * 100) : 0;
                const qty = Number(qtyMap[it.id] || 0);
                const totalProfit = qty ? unitProfit * qty : unitProfit;
                const isOpen = inWindow(it);
                return (
                  <div key={it.id} className="card" style={{ display: 'grid', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 700 }}>{labels.symbol}: {baseSymbol}</div>
                      <div className="tag" style={{ background: market === 'crypto' ? '#2a3b56' : '#2a5640', transform: 'scale(0.92)', whiteSpace: 'normal', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '60%' }}>{labels.type}: {market === 'crypto' ? labels.typeCrypto : labels.typeUS}</div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div className="desc">{labels.currentPrice}: {(market === 'crypto' ? formatUSDT(currentPrice, lang) : formatMoney(currentPrice * usdToMxnRate, 'MXN', lang))}</div>
                      <div className="desc">{labels.blockPrice}: {market === 'crypto' ? formatUSDT(blockPrice, lang) : formatMoney(blockPrice * usdToMxnRate, 'MXN', lang)}</div>
                      <div className="desc">{labels.window}: {formatMinute(it.start_at || it.startAt)} ~ {formatMinute(it.end_at || it.endAt)}</div>
                      <div className="desc">{lang === 'zh' ? '截至购买' : 'Deadline'}: {formatMinute(it.end_at || it.endAt)}</div>
                      <div className="desc">{labels.lockedUntil}: {formatMinute(it.lock_until || it.lockUntil)}</div>
                      <div className="desc">{labels.minQty}: {minQty}</div>
                      <div className="desc">{labels.consume}: {currency === 'USDT' ? formatUSDT(total, lang) : formatMoney(total * usdToMxnRate, 'MXN', lang)}</div>
                      <div className="desc" style={{ color: unitProfit >= 0 ? '#5cff9b' : '#ff5c7a' }}>
                        {(lang === 'zh' ? '预计收益' : 'Est. Profit')}: {(currency === 'USDT' ? formatUSDT(totalProfit || unitProfit, lang) : formatMoney((totalProfit || unitProfit) * usdToMxnRate, 'MXN', lang))} ({unitPct.toFixed(2)}%)
                      </div>
                    </div>
                    <div className="form admin-form-compact" style={{ marginTop: 4 }}>
                      <label className="label">{labels.subscribeKey}</label>
                      <input
                        className="input"
                        type="password"
                        autoComplete="off"
                        placeholder={lang === 'zh' ? '请输入认购密钥' : 'Enter subscription key'}
                        value={keyMap[it.id] || ''}
                        onChange={e => setKeyMap(p => ({ ...p, [it.id]: e.target.value }))}
                        style={{ WebkitTextSecurity: 'disc', maxWidth: 320 }}
                      />
                      <label className="label">{labels.qty}</label>
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#8aa0bd', marginBottom: 4 }}>
                          <span>{lang === 'zh' ? '可用余额' : (lang === 'es' ? 'Saldo disponible' : 'Available Balance')}: {market === 'crypto' ? formatUSDT(balances.USDT || 0, lang) : formatMoney(balances.MXN || 0, 'MXN', lang)}</span>
                          <span>{sliderMap[it.id] || 0}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          value={sliderMap[it.id] || 0}
                          onChange={e => handleSliderChange(it, Number(e.target.value), currentPrice)}
                          style={{ width: '100%', cursor: 'pointer' }}
                        />
                      </div>
                      <input className="input" type="number" min={minQty} step="1" placeholder={String(minQty)} value={qtyMap[it.id] || ''} onChange={e => {
                        const v = e.target.value;
                        setQtyMap(p => ({ ...p, [it.id]: v }));
                        // Reset slider if manual input (or calculate reverse percentage if desired, but reset is simpler)
                        setSliderMap(p => ({ ...p, [it.id]: 0 }));
                      }} style={{ maxWidth: 240 }} />
                      <div className="sub-actions" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn primary" disabled={submittingId === it.id} onClick={() => submit(it)}>
                          {submittingId === it.id ? labels.submitting : labels.btnSubmit}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
