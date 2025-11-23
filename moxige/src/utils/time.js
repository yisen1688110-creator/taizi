// Time utilities used across the app (moxige project)
// Convert a time-like input to milliseconds
// Accepts Date | number (ms or seconds) | string (ISO or numeric)
export function toMs(input) {
  try {
    if (input instanceof Date) return input.getTime();
    if (typeof input === 'number') {
      const n = Number(input);
      if (!Number.isFinite(n)) return NaN;
      // Heuristic: seconds vs milliseconds
      return n < 1e11 ? n * 1000 : n;
    }
    if (typeof input === 'string') {
      const s = input.trim();
      if (!s) return NaN;
      const n = Number(s);
      if (Number.isFinite(n)) return n < 1e11 ? n * 1000 : n;
      const d = new Date(s);
      const t = d.getTime();
      return Number.isFinite(t) ? t : NaN;
    }
    return NaN;
  } catch { return NaN; }
}