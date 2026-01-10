import BottomNav from "../components/BottomNav.jsx";
import { useI18n } from "../i18n.jsx";
import { api, notificationsApi } from "../services/api.js";
import { useEffect, useMemo, useState } from "react";

export default function Notifications() {
  const { lang } = useI18n();
  const [session] = useState(() => {
    try { return JSON.parse(localStorage.getItem("sessionUser") || "null"); } catch { return null; }
  });
  const uid = useMemo(() => session?.id || session?.phone || "guest", [session]);
  const [list, setList] = useState(() => []);
  const [pinnedIds, setPinnedIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem('notif:pinned') || '[]'); } catch { return []; }
  });
  const cnToLocale = (text) => {
    try {
      const s = String(text || '').trim();
      if (!s) return s;
      const isEs = lang === 'es';
      const map = [
        { re: /KYC\s*提交成功/i, en: 'KYC submitted', es: 'KYC enviado' },
        { re: /KYC\s*审核通过/i, en: 'KYC approved', es: 'KYC aprobado' },
        { re: /KYC\s*审核(?:未|不)通过/i, en: 'KYC rejected', es: 'KYC rechazado' },
        { re: /KYC\s*审核结果/i, en: 'KYC review result', es: 'Resultado de revisión KYC' },
        { re: /你的实名审核已提交，正在处理中/i, en: 'Identity verification submitted, under review', es: 'Verificación enviada, en revisión' },
        { re: /你的实名审核已通过/i, en: 'Identity verification approved', es: 'Verificación de identidad aprobada' },
        { re: /资金充值成功/i, en: 'Balance recharge succeeded', es: 'Recarga de saldo exitosa' },
        { re: /你已成功充值\s*([A-Z]+)\s*([0-9.]+)/i, en: 'You have successfully recharged $1 $2', es: 'Has recargado $1 $2' },
        { re: /你的IPO(?:申请|认购|申购)[\s\S]*?已(?:审核|审查|审批)?(?:通过|批准)[\s\S]*?数量\s*([0-9.]+)/i, en: 'Your IPO subscription approved, quantity $1', es: 'Tu suscripción IPO aprobada, cantidad $1' },
        { re: /IPO[\s\S]*?已(?:审核|审查|审批)?(?:通过|批准)[\s\S]*?数量[:：]?\s*([0-9.]+)/i, en: 'IPO approved, quantity $1', es: 'IPO aprobado, cantidad $1' },
        { re: /交易已执行/i, en: 'Trade Executed', es: 'Operación ejecutada' },
        { re: /你已完成购买\s*([A-Z0-9./:-]+)，成交总金额\s*MX\$([0-9.]+)/i, en: 'You purchased $1 · Total MX$ $2', es: 'Has comprado $1 · Total MX$ $2' },
        { re: /你已成功购买\s*([A-Z0-9./:-]+)，已支付\s*MX\$([0-9.]+)/i, en: 'You purchased $1 · Paid MX$ $2', es: 'Has comprado $1 · Pagado MX$ $2' },
        { re: /你已(?:完成)?卖出\s*([A-Z0-9./:-]+)，(?:成交)?总计\s*MX\$([0-9.]+)/i, en: 'You sold $1 · Total MX$ $2', es: 'Has vendido $1 · Total MX$ $2' },
        { re: /你已(?:完成)?卖出\s*([A-Z0-9./:-]+)，成交总金额\s*MX\$([0-9.]+)/i, en: 'You sold $1 · Total MX$ $2', es: 'Has vendido $1 · Total MX$ $2' },
        { re: /你已完成平仓\s*([A-Z0-9./:-]+)，成交总金额\s*MX\$([0-9.]+)/i, en: 'You closed $1 · Total MX$ $2', es: 'Has cerrado $1 · Total MX$ $2' },
        { re: /你申请的\s*([A-Z]+)\s*已到账/i, en: 'Your $1 withdrawal has been completed', es: 'Tu retiro de $1 se ha completado' },
        { re: /你的提现已被驳回/i, en: 'Your withdrawal has been rejected', es: 'Tu retiro ha sido rechazado' },
        { re: /大宗交易已购买/i, en: 'Block Trade Purchased', es: 'Bloque Comprado' },
        { re: /大宗交易已卖出/i, en: 'Block Trade Sold', es: 'Bloque Vendido' },
        { re: /信用分更新/i, en: 'Credit Score Updated', es: 'Puntaje de crédito actualizado' }
      ];
      for (const m of map) {
        if (m.re.test(s)) return s.replace(m.re, isEs ? m.es : m.en);
      }
      // Trade notifications mapping
      if (/交易已执行/.test(s)) return isEs ? 'Operación ejecutada' : 'Trade Executed';
      const mBuy = s.match(/你已完成购买\s*([A-Z0-9./:-]+)，成交总金额\s*MX\$\s*([0-9.]+)/);
      if (mBuy) return isEs ? `Has comprado ${mBuy[1]} · Total MX$ ${mBuy[2]}` : `You purchased ${mBuy[1]} · Total MX$ ${mBuy[2]}`;
      const mBuy2 = s.match(/你已成功购买\s*([A-Z0-9./:-]+)，已支付\s*MX\$\s*([0-9.]+)/);
      if (mBuy2) return isEs ? `Has comprado ${mBuy2[1]} · Pagado MX$ ${mBuy2[2]}` : `You purchased ${mBuy2[1]} · Paid MX$ ${mBuy2[2]}`;
      const mSell = s.match(/你已(?:完成)?卖出\s*([A-Z0-9./:-]+)，(?:成交)?(?:总金额|总计)\s*MX\$\s*([0-9.]+)/);
      if (mSell) return isEs ? `Has vendido ${mSell[1]} · Total MX$ ${mSell[2]}` : `You sold ${mSell[1]} · Total MX$ ${mSell[2]}`;
      const mClose = s.match(/你已完成平仓\s*([A-Z0-9./:-]+)，成交总金额\s*MX\$\s*([0-9.]+)/);
      if (mClose) return isEs ? `Has cerrado ${mClose[1]} · Total MX$ ${mClose[2]}` : `You closed ${mClose[1]} · Total MX$ ${mClose[2]}`;
      // Fallback: generic translation for Chinese text
      if (/[\u4e00-\u9fa5]/.test(s)) {
        const mQty = s.match(/数量[:：]?\s*([0-9.]+)/);
        if (mQty) {
          return isEs ? `Aprobado, cantidad ${mQty[1]}` : `Approved, quantity ${mQty[1]}`;
        }
        // Try to keep original if it looks like a title
        if (s.length < 10 && !/[:，,。]/.test(s)) return s; // Short title-like strings might be better left alone or added to map
        return isEs ? 'Notificación' : 'Notification';
      }
      return s;
    } catch { return text; }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await api.get('/me/notifications');
        const arr = Array.isArray(data?.items) ? data.items : [];
        if (!cancelled) {
          const ids = new Set(pinnedIds || []);
          const items = arr.map(it => ({ id: it.id, title: cnToLocale(it.title || 'Notification'), body: cnToLocale(it.message || ''), ts: new Date(it.created_at).getTime(), pinned: (ids.has(it.id) || Boolean(it.pinned)) }));
          setList(items.sort((a, b) => (Number(b.ts) - Number(a.ts))));
          return;
        }
      } catch { }
      if (!cancelled) setList([]);
    };
    load();
    const id = setInterval(load, 10000);
    return () => { cancelled = true; clearInterval(id); };
  }, [uid, pinnedIds, lang]);

  useEffect(() => {
    // immediate re-map on language change without waiting for polling
    setList(ls => ls.map(x => ({ ...x, title: cnToLocale(x.title), body: cnToLocale(x.body) })));
  }, [lang]);

  const togglePin = (id) => {
    setPinnedIds(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      const arr = Array.from(s);
      try { localStorage.setItem('notif:pinned', JSON.stringify(arr)); } catch { }
      setList(ls => ls.slice().map(x => ({ ...x, pinned: s.has(x.id) })).sort((a, b) => (Number(b.pinned || 0) - Number(a.pinned || 0)) || (Number(b.ts) - Number(a.ts))));
      return arr;
    });
  };

  const title = lang === "es" ? "Notificaciones" : "Notifications";
  const emptyText = lang === "es" ? "Sin notificaciones" : "No notifications";
  const pinnedText = lang === "es" ? "Fijado" : "Pinned";
  const timeOf = (ts) => new Date(ts).toLocaleString(lang === "es" ? "es-MX" : "en-US");
  const clearAll = async () => {
    try { await api.post('/me/notifications/clear'); } catch { }
    try { notificationsApi.clear(uid); } catch { }
    try {
      const data = await api.get('/me/notifications');
      const arr = Array.isArray(data?.items) ? data.items : [];
      setList([]);
    } catch { setList([]); }
  };
  return (
    <div className="screen top-align" style={{ padding: '16px 10px', paddingBottom: 100 }}>
      <h1 className="title" style={{ marginTop: 0, marginBottom: 8 }}>{title}</h1>
      <div style={{ width: '100%', maxWidth: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="pill" onClick={async () => { try { const data = await api.get('/me/notifications'); const arr = Array.isArray(data?.items) ? data.items : []; const items = arr.map(it => ({ id: it.id, title: cnToLocale(it.title || 'Notification'), body: cnToLocale(it.message || ''), ts: new Date(it.created_at).getTime(), pinned: Boolean(it.pinned) })); setList(items.sort((a, b) => (Number(b.ts) - Number(a.ts)))); } catch { } }}>{lang === 'es' ? 'Actualizar' : (lang === 'en' ? 'Refresh' : '刷新')}</button>
          <button className="pill" onClick={clearAll}>{lang === 'es' ? 'Borrar' : (lang === 'en' ? 'Clear' : '清空')}</button>
        </div>
        {list.length === 0 ? (
          <div style={{ display: "grid", placeItems: "center", height: 160 }}>
            <div className="desc" style={{ fontSize: 14 }}>{emptyText}</div>
          </div>
        ) : (
          <div className="notice-list" style={{ marginTop: 8 }}>
            {list.map(it => (
              <div key={it.id} className="card flat" style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center", gap: 10 }}>
                <div className="ov-icon">🔔</div>
                <div>
                  <div className="notice-title">{it.title || (lang === "es" ? "Notificación" : "Notification")}</div>
                  <div className="notice-list">{it.body}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="desc" style={{ fontSize: 11 }}>{timeOf(it.ts)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <BottomNav />
    </div>
  );
}
