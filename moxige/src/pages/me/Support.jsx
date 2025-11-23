import { useNavigate } from "react-router-dom";
import { useMemo, useEffect } from "react";
import { useI18n } from "../../i18n.jsx";

function readSession() {
  try { return JSON.parse(localStorage.getItem("sessionUser") || "null"); } catch { return null; }
}
function pickPhone(session) {
  if (session?.phone) return String(session.phone)
  try {
    const u = JSON.parse(localStorage.getItem('users')||'[]')
    const s = session
    const m = u.find(x => x.id && s?.id && x.id===s.id) || u.find(x => x.phone && s?.phone && String(x.phone)===String(s.phone))
    if (m?.phone) return String(m.phone)
  } catch {}
  try { const anon = localStorage.getItem('anon_phone'); if (anon) return String(anon) } catch {}
  return ''
}

export default function Support() {
  const nav = useNavigate();
  const { lang } = useI18n();
  const session = useMemo(() => readSession(), []);
  const imBase = useMemo(() => {
    try { const v = String(localStorage.getItem('im:base') || '').trim(); if (v) return v; } catch {}
    try { const v = String(import.meta.env?.VITE_IM_BASE || '').trim(); if (v) return v; } catch {}
    return 'http://127.0.0.1:3000';
  }, []);
  const url = useMemo(() => {
    const phone = encodeURIComponent(pickPhone(session));
    const name = encodeURIComponent(session?.name || '');
    const avatar = encodeURIComponent(session?.avatarUrl || '/logo.png');
    const placeholder = encodeURIComponent(lang==='es' ? 'Escribir mensaje' : 'Enter message');
    const sendLabel = encodeURIComponent(lang==='es' ? 'Enviar' : 'Send');
    const v = Date.now();
    return `${imBase.replace(/\/$/, '')}/customer.html?phone=${phone}&name=${name}&avatar=${avatar}&lang=${encodeURIComponent(lang)}&placeholder=${placeholder}&send=${sendLabel}&v=${v}`;
  }, [imBase, session, lang]);

  return (
    <div className="screen borderless">
      {useEffect(() => { try { window.location.replace(url); } catch { nav('/me'); } }, [url])}
    </div>
  );
}