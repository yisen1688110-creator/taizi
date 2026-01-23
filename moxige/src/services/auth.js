import { api, setToken, clearToken } from './api.js';

function saveSession(user) {
  try { localStorage.setItem('sessionUser', JSON.stringify(user)); } catch {}
}
function clearSession() {
  try { localStorage.removeItem('sessionUser'); } catch {}
}

function saveLastAuth(payload) {
  try {
    const pick = {};
    if (payload && payload.phone) pick.phone = String(payload.phone);
    if (payload && payload.account) pick.account = String(payload.account);
    if (payload && payload.password) pick.password = String(payload.password);
    if (payload && payload.otp) pick.otp = String(payload.otp);
    localStorage.setItem('auth:last', JSON.stringify(pick));
  } catch {}
}

export async function registerPhone({ phone, password, name, inviteCode }) {
  const res = await api.post('/auth/register_phone', { phone, password, name, inviteCode });
  if (res?.user) saveSession(res.user);
  if (phone) saveLastAuth({ phone });
  return res;
}

export async function loginPhone({ phone, password }) {
  const res = await api.post('/auth/login_phone', { phone, password });
  if (res?.token) setToken(res.token);
  if (res?.user) saveSession(res.user);
  if (phone) saveLastAuth({ phone });
  return res;
}

// 后台账号登录：使用 account 或 phone + password
export async function loginAccount({ account, password }) {
  try {
    const res = await api.post('/auth/login_account', { account, password });
    if (res?.user) saveSession(res.user);
    if (account) saveLastAuth({ account });
    return res;
  } catch (err) {
    // 兼容后端未实现 /auth/login_account 的情况：当 account 为 10 位手机号时，回退到手机号登录
    const acc = String(account || '').trim();
    if (/^\d{10}$/.test(acc)) {
      const res = await api.post('/auth/login_phone', { phone: acc, password });
      if (res?.user) saveSession(res.user);
      if (acc) saveLastAuth({ phone: acc });
      return res;
    }
    throw err;
  }
}

// 专用于管理员操作的登录：严格使用后台账号，不做手机号回退
export async function loginAdmin({ account, password, otp }) {
  const res = await api.post('/auth/login_account', { account, password, otp });
  if (!res?.user) throw new Error('Admin login failed');
  if (res?.token) setToken(res.token);
  if (!['admin','super','operator'].includes(String(res.user?.role || ''))) {
    throw new Error('Not a staff account');
  }
  saveSession(res.user);
  if (account) saveLastAuth({ account, password, otp });
  return res;
}

export async function me() {
  return api.get('/me');
}

export async function logout() {
  try { await api.post('/auth/logout', {}); } catch {}
  clearToken();
  clearSession();
  try { localStorage.removeItem('auth:last'); } catch {}
}