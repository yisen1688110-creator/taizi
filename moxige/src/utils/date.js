// Simple date formatting helper: YYYY/MM/DD HH:MM
export function formatMinute(input) {
  if (!input && input !== 0) return '—';
  let ts = null;
  try {
    if (typeof input === 'number') {
      ts = Number(input);
    } else if (typeof input === 'string') {
      const n = Number(input);
      ts = Number.isFinite(n) ? n : Date.parse(input);
    } else if (input instanceof Date) {
      ts = input.getTime();
    }
  } catch {
    ts = null;
  }
  if (!Number.isFinite(ts) || ts <= 0) return '—';
  try {
    const d = new Date(ts);
    // Force Europe/Warsaw (Poland) time
    const options = {
      timeZone: 'Europe/Warsaw',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    };
    const parts = new Intl.DateTimeFormat('en-CA', options).formatToParts(d); // en-CA gives YYYY-MM-DD
    const p = {};
    parts.forEach(({ type, value }) => { p[type] = value; });
    return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}`;
  } catch (e) {
    // Fallback to simple format
    try {
      const d = new Date(ts);
      const Y = d.getFullYear();
      const M = String(d.getMonth() + 1).padStart(2, '0');
      const D = String(d.getDate()).padStart(2, '0');
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      return `${Y}/${M}/${D} ${h}:${m}`;
    } catch {
      return '—';
    }
  }
}

export function getPolandTimestamp(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  if (!s) return null;
  // If already has offset or Z, trust it
  if (s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s)) {
    return new Date(s).getTime();
  }
  // Assume Poland City (UTC-6)
  // Note: This is a simplified handling. For strict correctness in frontend we might want to use a library,
  // but appending -06:00 aligns with the backend logic we implemented.
  return new Date(s + '-06:00').getTime();
}