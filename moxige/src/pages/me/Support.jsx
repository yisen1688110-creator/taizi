import { useNavigate } from "react-router-dom";
import { useMemo, useEffect } from "react";
import { useI18n } from "../../i18n.jsx";

function readSession() {
  try { return JSON.parse(localStorage.getItem("sessionUser") || "null"); } catch { return null; }
}
function pickPhone(session) {
  if (session?.phone) return String(session.phone)
  try {
    const u = JSON.parse(localStorage.getItem('users') || '[]')
    const s = session
    const m = u.find(x => x.id && s?.id && x.id === s.id) || u.find(x => x.phone && s?.phone && String(x.phone) === String(s.phone))
    if (m?.phone) return String(m.phone)
  } catch { }
  try { const anon = localStorage.getItem('anon_phone'); if (anon) return String(anon) } catch { }
  return ''
}

export default function Support() {
  const nav = useNavigate();
  const { lang } = useI18n();
  const session = useMemo(() => readSession(), []);
  const imBase = useMemo(() => {
    try { const v = String(localStorage.getItem('im:base') || '').trim(); if (v) return v; } catch { }
    try { const v = String(import.meta.env?.VITE_IM_BASE || '').trim(); if (v) return v; } catch { }
    return '/im-api';
  }, []);
  const url = useMemo(() => {
    const phone = encodeURIComponent(pickPhone(session));
    const name = encodeURIComponent(session?.name || '');
    const avatar = encodeURIComponent(session?.avatarUrl || '/logo.jpg');
    const placeholder = encodeURIComponent(lang === 'zh' ? '输入消息' : (lang === 'pl' ? 'Wpisz wiadomość' : 'Enter message'));
    const sendLabel = encodeURIComponent(lang === 'zh' ? '发送' : (lang === 'pl' ? 'Wyślij' : 'Send'));
    const v = Date.now();
    const base = imBase.replace(/\/$/, '');
    let origin = '';
    let pathPrefix = '';
    try { const u = new URL(base); origin = u.origin; pathPrefix = u.pathname.replace(/\/$/, ''); } catch { }
    let qs = `phone=${phone}&name=${name}&avatar=${avatar}&lang=${encodeURIComponent(lang)}&placeholder=${placeholder}&send=${sendLabel}&v=${v}`;
    try {
      const tok = String(localStorage.getItem('im:token') || import.meta.env?.VITE_IM_TOKEN || '').trim();
      if (tok) qs += `&token=${encodeURIComponent(tok)}`;
    } catch { }
    qs += `&api=${encodeURIComponent(base)}`;
    if (origin) qs += `&ws=${encodeURIComponent(origin)}`;
    if (pathPrefix) qs += `&wspath=${encodeURIComponent(pathPrefix + '/socket.io/')}`;
    return `${base}/customer.html?${qs}`;
  }, [imBase, session, lang]);

  return (
    <div className="screen borderless">
      {useEffect(() => {
        try {
          localStorage.setItem('im:unread_count', '0');
          window.dispatchEvent(new Event('im:unread'));
        } catch { }
        try { window.location.replace(url); } catch { nav('/me'); }
      }, [url])}
    </div>
  );
}
