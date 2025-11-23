import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import BottomNav from "../components/BottomNav.jsx";
import { useI18n } from "../i18n.jsx";
import { api, notificationsApi } from "../services/api.js";
import { getUsdMxnRate } from "../services/marketData.js";
import { formatMoney } from "../utils/money.js";

function readSession() {
  try { return JSON.parse(localStorage.getItem("sessionUser") || "null"); } catch { return null; }
}
function readUsers() {
  try { return JSON.parse(localStorage.getItem("users") || "[]"); } catch { return []; }
}

// 实时 USD→MXN 汇率：使用 TwelveData，带回退与缓存；页面内每10秒轮询

export default function Exchange() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [session, setSession] = useState(() => readSession());
  const [users, setUsers] = useState(() => readUsers());
  const me = useMemo(() => {
    if (!session) return null;
    const byId = users.find(u => u.id && u.id === session.id);
    const byPhone = users.find(u => u.phone === session.phone);
    return byId || byPhone || session;
  }, [session, users]);

  const [rate, setRate] = useState(18.0);
  const [RATE_TS, setRateTs] = useState(0);
  const [RATE_SRC, setRateSrc] = useState("");
  // 统一的双向兑换：支持 MXN↔USD、MXN↔USDT、USD↔MXN、USDT↔MXN、USD↔USDT
  const [from, setFrom] = useState("MXN"); // MXN | USD | USDT
  const [to, setTo] = useState("USD"); // MXN | USD | USDT
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    let stopped = false;
    const pull = async () => {
      try {
        const res = await getUsdMxnRate();
        const r = Number(res?.rate);
        if (!stopped && Number.isFinite(r) && r > 0) {
          setRate(r);
          setRateTs(Date.now());
          setRateSrc(String(res?.source || ""));
        }
      } catch {}
    };
    pull();
    const timer = setInterval(pull, 10_000);
    const onStorage = () => { setSession(readSession()); setUsers(readUsers()); };
    window.addEventListener("storage", onStorage);
    return () => { stopped = true; clearInterval(timer); window.removeEventListener("storage", onStorage); };
  }, []);

  // 从后端读取余额
  const [balanceMXN, setBalanceMXN] = useState(0);
  const [balanceUSD, setBalanceUSD] = useState(0);
  const [balanceUSDT, setBalanceUSDT] = useState(0);
  const [tradeDisabled, setTradeDisabled] = useState(false);

  const resolveUid = useCallback(async () => {
    let uid = Number(session?.id ?? session?.backendId);
    if (!uid && session?.phone) {
      try {
        const res = await api.get(`/admin/users?q=${encodeURIComponent(session.phone)}`);
        const arr = Array.isArray(res?.users) ? res.users : [];
        const match = arr.find(u => String(u.phone) === String(session.phone));
        if (match && Number(match.id)) uid = Number(match.id);
      } catch {}
    }
    return uid || null;
  }, [session]);

  const refreshBalancesFromServer = useCallback(async () => {
    try {
      const uid = await resolveUid();
      if (!uid) return;
      let data;
      try {
        const meData = await api.get('/me');
        if (typeof meData === 'object' && meData?.user) {
          setTradeDisabled(!!meData.user.trade_disabled);
        }
      } catch {}
      try {
        data = await api.get(`/me/balances`);
        setTradeDisabled(!!data?.disabled);
      } catch {
        data = await api.get(`/admin/users/${uid}/balances`);
      }
      const arr = Array.isArray(data?.balances) ? data.balances : [];
      const map = arr.reduce((m, r) => { m[String(r.currency).toUpperCase()] = Number(r.amount || 0); return m; }, {});
      setBalanceMXN(Number.isFinite(map.MXN) ? map.MXN : 0);
      setBalanceUSD(Number.isFinite(map.USD) ? map.USD : 0);
      setBalanceUSDT(Number.isFinite(map.USDT) ? map.USDT : 0);
    } catch {}
  }, [resolveUid]);

  useEffect(() => {
    let stopped = false;
    const tick = async () => { if (!stopped) await refreshBalancesFromServer(); };
    tick();
    const timer = setInterval(tick, 5000);
    return () => { stopped = true; clearInterval(timer); };
  }, [session, refreshBalancesFromServer]);

  // 计算接收金额（USDT 视作与 USD 1:1）
  const receive = (() => {
    const amt = Number(amount || 0);
    if (!Number.isFinite(amt) || amt <= 0 || !Number.isFinite(rate) || rate <= 0) return 0;
    if (from === to) return amt;
    // MXN↔USD/USDT
    if (from === "MXN" && (to === "USD" || to === "USDT")) return amt / rate;
    if ((from === "USD" || from === "USDT") && to === "MXN") return amt * rate;
    // USD↔USDT 1:1
    if ((from === "USD" && to === "USDT") || (from === "USDT" && to === "USD")) return amt;
    return 0;
  })();

  // 统一使用共享工具，确保 MXN 显示为 MX$

  const onSwap = async () => {
    setError(""); setOk("");
    const amt = Number(amount || 0);
    if (!me) { navigate("/login"); return; }
    if (!Number.isFinite(amt) || amt <= 0) { setError(t("errorAmountInvalid")); return; }
    if (!Number.isFinite(rate) || rate <= 0) { setError(t("errorRateUnavailable")); return; }
    if (tradeDisabled) { setError(lang==='es'? 'Operación deshabilitada (USD negativo)' : 'Trading disabled (USD negative)'); return; }
    const recv = receive;
    const uid = await resolveUid();
    if (!uid) { setError(t("errorLoginRequired")); return; }

    // Balance checks
    if (from === "MXN" && amt > balanceMXN) { setError(t("errorBalanceInsufficientMXN")); return; }
    if (from === "USD" && amt > balanceUSD) { setError(t("errorBalanceInsufficientUSD")); return; }
    if (from === "USDT" && amt > balanceUSDT) { setError(t("errorBalanceInsufficientUSDT")); return; }

    try {
      const resp = await api.post('/me/exchange', { from, to, amount: amt });
      if (!resp || !resp.balances) {
        const ops = [
          { currency: from, amount: -amt },
          { currency: to, amount: recv },
        ];
        const requestId = `swap-${Date.now()}-${from}-${to}-${amt}`;
        await api.post(`/admin/users/${uid}/funds`, { ops, reason: 'exchange swap', requestId });
      }
      await refreshBalancesFromServer();
    } catch (e) {
      setError(String(e?.message || t('errorNetwork')));
      return;
    }
    setOk(t("successSwap"));
    setAmount("");
    try {
      const nid = uid || me?.phone || "guest";
      const title = lang === "es" ? "Intercambio exitoso" : "Swap Successful";
      const body = lang === "es"
        ? `Has convertido ${formatMoney(amt, from)} a ${formatMoney(recv, to)}`
        : `Converted ${formatMoney(amt, from)} to ${formatMoney(recv, to)}`;
      notificationsApi.add(nid, { title, body, pinned: false });
    } catch {}
  };

  return (
    <div className="screen">
      <div className="card">
        <h1 className="title" style={{ marginTop: 0 }}>{t("swap")}</h1>
        <p className="desc">{t("swapSupportDesc")}</p>
        {/* 调整：去掉余额展示，将汇率移到原位置（左侧） */}
        <div style={{ marginTop: 10 }}>
          <div className="desc">1 USD ≈ {rate.toFixed(4)} MXN</div>
        </div>
        <div className="form" style={{ marginTop: 14 }}>
          <label className="label">{t("labelFrom")}</label>
          <div style={{ display: "flex", gap: 8 }}>
            <button className={`pill ${from === "MXN" ? "active" : ""}`} onClick={() => setFrom("MXN")}>MXN</button>
            <button className={`pill ${from === "USD" ? "active" : ""}`} onClick={() => setFrom("USD")}>USD</button>
            <button className={`pill ${from === "USDT" ? "active" : ""}`} onClick={() => setFrom("USDT")}>USDT</button>
          </div>

          <label className="label" style={{ marginTop: 10 }}>{t("labelTo")}</label>
          <div style={{ display: "flex", gap: 8 }}>
            <button className={`pill ${to === "MXN" ? "active" : ""}`} onClick={() => setTo("MXN")}>MXN</button>
            <button className={`pill ${to === "USD" ? "active" : ""}`} onClick={() => setTo("USD")}>USD</button>
            <button className={`pill ${to === "USDT" ? "active" : ""}`} onClick={() => setTo("USDT")}>USDT</button>
          </div>

          <label className="label" style={{ marginTop: 10 }}>{t("labelAmount")} ({from})</label>
          <input className="input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={from === "MXN" ? t("placeholderAmountMXN") : (from === "USD" ? t("placeholderAmountUSD") : t("placeholderAmountUSDT"))} />

          <div className="desc" style={{ marginTop: 8 }}>
            {t("estimatedReceive")}: {formatMoney(receive, to === "MXN" ? "MXN" : "USD")}
          </div>

          {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
          {ok && <div className="success" style={{ marginTop: 8 }}>{ok}</div>}

          <div className="sub-actions" style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => navigate("/home")}>{t("btnBack")}</button>
            <button className="btn primary" onClick={onSwap} disabled={tradeDisabled || !amount}>{t("btnSwap")}</button>
          </div>
        </div>
        {/* 底部额外提示文案移除以保持界面简洁 */}
      </div>
      <BottomNav />
    </div>
  );
}