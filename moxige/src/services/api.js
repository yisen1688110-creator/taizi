function normalizeBase(u) {
  try {
    let s = String(u || '').trim();
    if (!s) return '/api';
    if (s.startsWith('http')) {
      const endsWithApi = /\/api\/?$/.test(s);
      if (!endsWithApi) s = s.replace(/\/$/, '') + '/api';
    }
    return s;
  } catch { return '/api'; }
}

const BASE = (() => {
  try {
    const isBrowser = typeof location !== 'undefined';
    const port = isBrowser ? String(location.port || '') : '';
    const host = isBrowser ? String(location.hostname || '') : '';
    const isDevLocal = isBrowser && (port === '5173' || port === '5174') && (host === 'localhost' || host === '127.0.0.1');
    if (isDevLocal) return normalizeBase('/api');
    try {
      const override = String(localStorage.getItem('api:base:override') || '').trim();
      if (override) return normalizeBase(override);
    } catch {}
  } catch {}
  try {
    const ls = String(localStorage.getItem('api:base') || '').trim();
    if (ls) return normalizeBase(ls);
  } catch {}
  try {
    const v = String(import.meta.env?.VITE_API_BASE || '').trim();
    if (v) return normalizeBase(v);
  } catch {}
  return '/api';
})();
let activeBase = BASE;

let token = localStorage.getItem('token') || '';
let csrfCached = (typeof localStorage !== 'undefined' ? (localStorage.getItem('csrf:token') || '') : '') || '';

export function setToken(newToken) {
  token = newToken || '';
  if (newToken) localStorage.setItem('token', newToken);
  else localStorage.removeItem('token');
}

export function getToken() {
  return token;
}

export function clearToken() {
  token = '';
  try { localStorage.removeItem('token'); } catch {}
}

export function setApiBase(url) { const u = String(url || '').trim(); if (!u) return; activeBase = normalizeBase(u); }

function handleUnauthorized() {
  try { localStorage.removeItem('token'); } catch {}
  try { localStorage.removeItem('sessionUser'); } catch {}
}

const DEFAULT_TIMEOUT_MS = 9000;
const YF_TIMEOUT_MS = 4500; // Yahoo 代理查询较快，设置更短超时

function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  const opts = { ...options, signal: controller.signal };
  return fetch(url, opts).finally(() => clearTimeout(id));
}
function getCookie(name) {
  try {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()\[\]\\\/\+^])/g, '\\$1') + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  } catch { return ''; }
}

async function fetchCsrf(base) {
  try {
    const res = await fetchWithTimeout(`${base}/csrf`, { method: 'GET', credentials: 'include' }, 1500);
    const ct = res.headers.get('content-type') || '';
    const isJson = ct.includes('application/json');
    const data = isJson ? await res.json() : await res.text();
    const t = isJson ? (data?.csrf || '') : '';
    if (t) { csrfCached = t; try { localStorage.setItem('csrf:token', t); } catch {} }
    return t;
  } catch {
    try { return localStorage.getItem('csrf:token') || ''; } catch { return ''; }
  }
}

async function silentAdminLogin(base) {
  try {
    const raw = localStorage.getItem('auth:last') || '{}';
    const last = JSON.parse(raw);
    const account = String(last?.account || last?.phone || '').trim();
    const password = String(last?.password || '').trim();
    const otp = String(last?.otp || '').trim();
    if (!account || !password) return false;
    const res = await fetchWithTimeout(`${base}/auth/login_account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account, password, otp }),
      credentials: 'include',
    }, 3000);
    const ct = res.headers.get('content-type') || '';
    const isJson = ct.includes('application/json');
    const data = isJson ? await res.json() : await res.text();
    if (!res.ok || !isJson || !data?.token) return false;
    token = data.token || '';
    try { localStorage.setItem('token', token); } catch {}
    try { if (data?.user) localStorage.setItem('sessionUser', JSON.stringify(data.user)); } catch {}
    return true;
  } catch {
    return false;
  }
}

async function request(path, { method = 'GET', body, headers = {}, timeoutMs } = {}) {
  let lastErr = null;
  let base = activeBase;
  let attempts = 0;
  while (attempts < 2) {
      const h = {
        'Content-Type': 'application/json',
        ...headers,
      };
      try {
        if (token) {
          h['Authorization'] = `Bearer ${token}`;
        } else {
          const sessName = (typeof window !== 'undefined' && (window.COOKIE_NAME || 'session_token')) || 'session_token';
          const sess = getCookie(sessName);
          if (sess) h['Authorization'] = `Bearer ${sess}`;
        }
      } catch {}
      try {
        const isAdminPath = String(path || '').startsWith('/admin/');
        if (isAdminPath && !h['Authorization']) {
          const ok = await silentAdminLogin(base);
          if (ok && token) h['Authorization'] = `Bearer ${token}`;
        }
      } catch {}
      try {
        const csrfName = (typeof window !== 'undefined' && (window.CSRF_COOKIE_NAME || 'csrf_token')) || 'csrf_token';
        const isWrite = ['POST','PUT','PATCH','DELETE'].includes(String(method).toUpperCase());
        if (isWrite) {
          let t = getCookie(csrfName);
          if (!t) t = csrfCached || '';
          if (!t) t = await fetchCsrf(base);
          if (t) h['X-CSRF-Token'] = t;
        }
      } catch {}
      try {
        const isYf = String(path || '').startsWith('/yf/');
        const tm = Number(timeoutMs || (isYf ? YF_TIMEOUT_MS : DEFAULT_TIMEOUT_MS)) || DEFAULT_TIMEOUT_MS;
        const res = await fetchWithTimeout(`${base}${path}`, {
          method,
          headers: h,
          body: body ? JSON.stringify(body) : undefined,
          credentials: 'include',
        }, tm);
        const contentType = res.headers.get('content-type') || '';
        const isJson = contentType.includes('application/json');
        const data = isJson ? await res.json() : await res.text();
        const looksHtml = typeof data === 'string' && /<html[\s>]/i.test(data);
        if (res.ok) {
          // 对返回 HTML 的 2xx 响应进行保护：这通常意味着后端代理未配置，返回了前端页面
          if (!isJson && looksHtml) {
            throw new Error('API base misconfigured: received HTML instead of JSON');
          }
          activeBase = base;
          return data;
        }
        if (res.status === 401) {
          const msg = isJson ? (data?.error || 'Unauthorized') : String(data);
          const needAdmin = String(path || '').startsWith('/admin/');
          if (needAdmin) {
            const ok = await silentAdminLogin(base);
            if (ok) { attempts++; continue; }
          }
          handleUnauthorized();
          const err = new Error(msg);
          if (isJson && data) { err.code = data.error || ''; err.remainMs = data.remainMs || 0; }
          throw err;
        }
        if (res.status === 403) {
          const msg = isJson ? (data?.error || 'Forbidden') : String(data);
          const needAdmin = String(path || '').startsWith('/admin/');
          if (needAdmin) {
            const ok = await silentAdminLogin(base);
            if (ok) { attempts++; continue; }
          }
          const err = new Error(msg);
          if (isJson && data) { err.code = data.error || ''; }
          throw err;
        }
        if (res.status === 404 || res.status >= 500) {
          // 若返回为 HTML，避免把整页 HTML 填充到错误信息中
          const msg = isJson ? (data?.error || `HTTP ${res.status}`) : (looksHtml ? `HTTP ${res.status}: Not found (HTML)` : String(data).slice(0, 300));
          lastErr = new Error(msg);
          try {
            const isBrowser = typeof location !== 'undefined';
            const port = isBrowser ? String(location.port || '') : '';
            const host = isBrowser ? String(location.hostname || '') : '';
            const isDevLocal = isBrowser && (port === '5173' || port === '5174') && (host === 'localhost' || host === '127.0.0.1');
            if (isDevLocal) {
              const alt = normalizeBase('http://127.0.0.1:5210');
              if (String(base) !== alt) {
                base = alt;
                attempts++;
                continue;
              }
            }
          } catch {}
          break;
        }
        const msg = isJson ? (data?.error || 'Request failed') : (looksHtml ? 'Request failed: received HTML' : String(data).slice(0, 300));
        const err = new Error(msg);
        if (isJson && data) { err.code = data.error || ''; err.remainMs = data.remainMs || 0; }
        throw err;
      } catch (e) {
        const msg = (e?.name === 'AbortError')
          ? `Request timeout after ${timeoutMs || (String(path||'').startsWith('/yf/') ? YF_TIMEOUT_MS : DEFAULT_TIMEOUT_MS)} ms`
          : (e?.message || 'Network error');
        lastErr = new Error(msg);
        break;
      }
    }
  
  throw lastErr || new Error('Network error');
}

export const api = {
  get: (p, opts) => request(p, opts),
  post: (p, body, opts) => request(p, { method: 'POST', body, ...(opts||{}) }),
  put: (p, body, opts) => request(p, { method: 'PUT', body, ...(opts||{}) }),
  delete: (p, opts) => request(p, { method: 'DELETE', ...(opts||{}) }),
  setBase: (u) => { try { activeBase = normalizeBase(String(u||'')); } catch { activeBase = normalizeBase(String(u||'')); } },
};

export async function meWithdrawCreate(payload) { return api.post('/me/withdraw/create', payload); }
export async function meWithdrawList() { return api.get('/me/withdraw/list'); }
export async function meWithdrawCancel(id) { return api.post(`/me/withdraw/cancel/${id}`); }
export async function adminWithdrawList(params) { const qs = new URLSearchParams(params||{}).toString(); return api.get(`/admin/withdraw/list${qs?('?' + qs):''}`); }
export async function adminWithdrawApprove(id) { return api.post(`/admin/withdraw/${id}/approve`); }
export async function adminWithdrawComplete(id) { return api.post(`/admin/withdraw/${id}/complete`); }
export async function adminWithdrawReject(id) { return api.post(`/admin/withdraw/${id}/reject`); }

export async function waitForHealth(maxWaitMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const r = await request('/health', { method: 'GET', timeoutMs: 1500 });
      if (r && r.ok) return true;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('backend_unhealthy');
}

// 通知接口封装：前端持久化在 localStorage；如后端提供可替换为真实接口
const notifKey = (uid) => `notifications:${uid || 'guest'}`;

export const notificationsApi = {
  list(uid) {
    try {
      const data = JSON.parse(localStorage.getItem(notifKey(uid)) || '[]');
      return Array.isArray(data) ? data : [];
    } catch { return []; }
  },
  add(uid, notif) {
    const list = notificationsApi.list(uid);
    const item = { id: `nt_${Date.now()}`, pinned: !!notif.pinned, ts: Date.now(), ...notif };
    const next = [item, ...list];
    try { localStorage.setItem(notifKey(uid), JSON.stringify(next)); } catch {}
    return item;
  },
  clear(uid) {
    try { localStorage.setItem(notifKey(uid), JSON.stringify([])); } catch {}
  },
};