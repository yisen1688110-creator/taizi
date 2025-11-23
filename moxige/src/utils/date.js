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
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}