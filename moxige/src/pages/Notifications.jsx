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
  // 翻译通知内容到当前语言
  const translateNotif = (text) => {
    try {
      const s = String(text || '').trim();
      if (!s) return s;
      
      // 多语言映射表
      const translations = [
        // KYC 相关
        { patterns: [/KYC\s*submitted/i, /KYC\s*przesłany/i, /KYC\s*提交成功/i], zh: 'KYC 已提交', en: 'KYC submitted', pl: 'KYC przesłany' },
        { patterns: [/KYC\s*approved/i, /KYC\s*zatwierdzony/i, /KYC\s*审核通过/i], zh: 'KYC 已通过', en: 'KYC approved', pl: 'KYC zatwierdzony' },
        { patterns: [/KYC\s*rejected/i, /KYC\s*odrzucony/i, /KYC\s*审核(?:未|不)通过/i], zh: 'KYC 已拒绝', en: 'KYC rejected', pl: 'KYC odrzucony' },
        { patterns: [/Identity verification submitted/i, /Weryfikacja przesłana/i, /你的实名审核已提交/i], zh: '身份验证已提交，审核中', en: 'Identity verification submitted, under review', pl: 'Weryfikacja przesłana, w trakcie przetwarzania' },
        { patterns: [/Identity verification approved/i, /Weryfikacja tożsamości zatwierdzona/i, /你的实名审核已通过/i], zh: '身份验证已通过', en: 'Identity verification approved', pl: 'Weryfikacja tożsamości zatwierdzona' },
        // 交易相关
        { patterns: [/Trade\s*Executed/i, /Transakcja wykonana/i, /交易已执行/i], zh: '交易已执行', en: 'Trade Executed', pl: 'Transakcja wykonana' },
        { patterns: [/Block\s*Trade\s*Purchased/i, /Day\s*Trade\s*Purchased/i, /Transakcja blokowa zakupiona/i, /日内交易已购买/i, /大宗交易已购买/i], zh: '日内交易已购买', en: 'Day Trade Purchased', pl: 'Day Trade Purchased' },
        { patterns: [/Block\s*Trade\s*Sold/i, /Day\s*Trade\s*Sold/i, /Transakcja blokowa sprzedana/i, /日内交易已卖出/i, /大宗交易已卖出/i], zh: '日内交易已卖出', en: 'Day Trade Sold', pl: 'Day Trade Sold' },
        // IPO/认购相关
        { patterns: [/Suscripci[oó]n\s*Aprobada/i, /Subscription\s*Approved/i, /认购.*?(?:通过|批准)/i], zh: 'IPO认购已批准', en: 'Subscription Approved', pl: 'Subskrypcja zatwierdzona' },
        // 充值/提现
        { patterns: [/Balance recharge/i, /Doładowanie salda/i, /资金充值/i], zh: '充值成功', en: 'Balance recharge succeeded', pl: 'Doładowanie salda udane' },
        { patterns: [/withdrawal.*completed/i, /wypłata.*zrealizowana/i, /提现.*到账/i], zh: '提现已到账', en: 'Withdrawal completed', pl: 'Wypłata zrealizowana' },
        { patterns: [/withdrawal.*rejected/i, /wypłata.*odrzucona/i, /提现.*驳回/i], zh: '提现已被驳回', en: 'Withdrawal rejected', pl: 'Wypłata odrzucona' },
        // 持仓变动
        { patterns: [/持仓变动/i, /Position\s*Change/i, /Zmiana pozycji/i], zh: '持仓变动', en: 'Position Change', pl: 'Zmiana pozycji' },
        // 信用分
        { patterns: [/Credit\s*Score\s*Updated/i, /Punktacja kredytowa/i, /信用分更新/i], zh: '信用分已更新', en: 'Credit Score Updated', pl: 'Punktacja kredytowa zaktualizowana' },
      ];
      
      // 尝试匹配并翻译
      for (const t of translations) {
        for (const pattern of t.patterns) {
          if (pattern.test(s)) {
            return lang === 'zh' ? t.zh : (lang === 'pl' ? t.pl : t.en);
          }
        }
      }
      
      // 处理带参数的通知（如购买/卖出金额）
      // 购买通知
      const buyMatch = s.match(/(?:You purchased|Kupiłeś|你已.*购买)\s*([A-Z0-9./:-]+).*?(?:Total|Razem|Paid|Zapłacono|总金额|已支付)\s*([0-9,.]+)\s*(?:PLN)?/i);
      if (buyMatch) {
        const [, symbol, amount] = buyMatch;
        return lang === 'zh' ? `你已购买 ${symbol} · 总额 ${amount} PLN` : (lang === 'pl' ? `Kupiłeś ${symbol} · Razem ${amount} PLN` : `You purchased ${symbol} · Total ${amount} PLN`);
      }
      
      // 卖出通知
      const sellMatch = s.match(/(?:You sold|Sprzedałeś|你已.*卖出)\s*([A-Z0-9./:-]+).*?(?:Total|Razem|总金额|总计)\s*([0-9,.]+)\s*(?:PLN)?/i);
      if (sellMatch) {
        const [, symbol, amount] = sellMatch;
        return lang === 'zh' ? `你已卖出 ${symbol} · 总额 ${amount} PLN` : (lang === 'pl' ? `Sprzedałeś ${symbol} · Razem ${amount} PLN` : `You sold ${symbol} · Total ${amount} PLN`);
      }
      
      // 平仓通知
      const closeMatch = s.match(/(?:You closed|Zamknąłeś|你已.*平仓)\s*([A-Z0-9./:-]+).*?(?:Total|Razem|总金额)\s*([0-9,.]+)\s*(?:PLN)?/i);
      if (closeMatch) {
        const [, symbol, amount] = closeMatch;
        return lang === 'zh' ? `你已平仓 ${symbol} · 总额 ${amount} PLN` : (lang === 'pl' ? `Zamknąłeś ${symbol} · Razem ${amount} PLN` : `You closed ${symbol} · Total ${amount} PLN`);
      }
      
      // IPO认购通知（带数量）
      const ipoMatch = s.match(/(?:IPO|认购|Subscription|Subskrypcja).*?(?:approved|zatwierdzona|通过|批准).*?(?:quantity|ilość|数量)[:\s]*([0-9]+)/i);
      if (ipoMatch) {
        const qty = ipoMatch[1];
        return lang === 'zh' ? `IPO认购已批准，数量: ${qty}` : (lang === 'pl' ? `Subskrypcja IPO zatwierdzona, ilość: ${qty}` : `IPO subscription approved, quantity: ${qty}`);
      }
      
      // 西班牙语通知翻译
      if (/Tu solicitud de suscripci[oó]n/i.test(s)) {
        const match = s.match(/para\s+(.+?)\.\s*(?:ha sido aprobada|Cantidad)[:\s]*(\d+)?/i);
        if (match) {
          const name = match[1] || '';
          const qty = match[2] || '';
          const qtyText = qty ? (lang === 'zh' ? `，数量: ${qty}` : (lang === 'pl' ? `, ilość: ${qty}` : `, quantity: ${qty}`)) : '';
          return lang === 'zh' ? `你的 ${name} 认购申请已通过${qtyText}` : (lang === 'pl' ? `Twoja subskrypcja ${name} została zatwierdzona${qtyText}` : `Your ${name} subscription has been approved${qtyText}`);
        }
        return lang === 'zh' ? 'IPO认购已批准' : (lang === 'pl' ? 'Subskrypcja zatwierdzona' : 'Subscription Approved');
      }
      
      // 如果文本是中文且当前语言就是中文，直接返回
      if (lang === 'zh' && /[\u4e00-\u9fa5]/.test(s)) {
        return s;
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
          const items = arr.map(it => ({ id: it.id, title: translateNotif(it.title || 'Notification'), body: translateNotif(it.message || ''), ts: new Date(it.created_at).getTime(), pinned: (ids.has(it.id) || Boolean(it.pinned)) }));
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
    setList(ls => ls.map(x => ({ ...x, title: translateNotif(x.title), body: translateNotif(x.body) })));
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

  const title = lang === "zh" ? "通知" : (lang === "pl" ? "Powiadomienia" : "Notifications");
  const emptyText = lang === "zh" ? "暂无通知" : (lang === "pl" ? "Brak powiadomień" : "No notifications");
  const pinnedText = lang === "zh" ? "已置顶" : (lang === "pl" ? "Przypięte" : "Pinned");
  const timeOf = (ts) => new Date(ts).toLocaleString(lang === "zh" ? "zh-CN" : (lang === "pl" ? "pl-PL" : "en-US"));
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
    <div className="screen top-align" style={{ padding: 0, width: '100%', maxWidth: '100%' }}>
      <div style={{ padding: '16px', width: '100%', boxSizing: 'border-box', paddingBottom: 100 }}>
        <h1 className="title" style={{ marginTop: 0, marginBottom: 8 }}>{title}</h1>
        <div style={{ width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="pill" onClick={async () => { try { const data = await api.get('/me/notifications'); const arr = Array.isArray(data?.items) ? data.items : []; const items = arr.map(it => ({ id: it.id, title: translateNotif(it.title || 'Notification'), body: translateNotif(it.message || ''), ts: new Date(it.created_at).getTime(), pinned: Boolean(it.pinned) })); setList(items.sort((a, b) => (Number(b.ts) - Number(a.ts)))); } catch { } }}>{lang === 'zh' ? '刷新' : (lang === 'pl' ? 'Odśwież' : 'Refresh')}</button>
          <button className="pill" onClick={clearAll}>{lang === 'zh' ? '清空' : (lang === 'pl' ? 'Wyczyść' : 'Clear')}</button>
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
                  <div className="notice-title">{it.title || (lang === "zh" ? "通知" : (lang === "pl" ? "Powiadomienie" : "Notification"))}</div>
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
      </div>
      <BottomNav />
    </div>
  );
}
