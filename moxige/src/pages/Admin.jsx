import { useEffect, useMemo, useState } from "react";
import { api, waitForHealth, getToken } from "../services/api.js";
import AdminWithdraws from "./admin/Withdraws.jsx";
import NewsManage from "./admin/NewsManage.jsx";
import InstitutionManage from "./admin/InstitutionManage.jsx";
import { loginAdmin as loginAdminApi, loginAccount as loginAccountApi, logout as logoutApi } from "../services/auth.js";

function loadUsers() {
  try { return JSON.parse(localStorage.getItem("users") || "[]"); } catch { return []; }
}
function saveUsers(u) {
  localStorage.setItem("users", JSON.stringify(u));
}
function getSessionUser() {
  try { return JSON.parse(localStorage.getItem("sessionUser") || "null"); } catch { return null; }
}

export default function Admin() {
  const [users, setUsers] = useState(() => loadUsers());
  const [session, setSession] = useState(() => getSessionUser());
  const isStaff = ["super", "admin", "operator"].includes(session?.role);
  const isAuthed = isStaff && !!getToken();

  const [q, setQ] = useState("");
  const [assignFilter, setAssignFilter] = useState("unassigned");
  const [selectedUser, setSelectedUser] = useState(null);
  const [newPassword, setNewPassword] = useState("");
  const [active, setActive] = useState("overview"); // overview | users | team | stocks | positions
  const [assignAdminId, setAssignAdminId] = useState(null);
  const [assignOperatorId, setAssignOperatorId] = useState(null);
  const [inviteCode, setInviteCode] = useState('');

  // 客户列表“操作”下拉的独立打开状态，避免与 selectedUser 混用导致误弹详情
  const [opsOpenId, setOpsOpenId] = useState(null);
  const [usersTab, setUsersTab] = useState('list');
  const [showKyc, setShowKyc] = useState({ open: false, userId: null, user: null });

  useEffect(() => {
    try {
      const path = typeof location !== 'undefined' ? (location.pathname || '') : '';
      if (path.endsWith('/admin/chognzhi')) setActive('funds-recharge');
      else if (path.endsWith('/admin/zijin')) setActive('funds-logs');
      else if (path.endsWith('/admin/withdraws')) setActive('funds-withdraws');
      else if (path.endsWith('/admin/news')) setActive('content-news');
      const isBrowser = typeof location !== 'undefined';
      const port = isBrowser ? String(location.port || '') : '';
      const host = isBrowser ? String(location.hostname || '') : '';
      const isDevLocal = isBrowser && (port === '5174' || port === '5173') && (host === 'localhost' || host === '127.0.0.1');
      if (isDevLocal) {
        try { localStorage.removeItem('api:base:override'); } catch { }
        try { localStorage.removeItem('api:base'); } catch { }
        api.setBase('/api');
      }
    } catch { }
  }, []);

  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const apibase = sp.get('apibase');
      if (apibase) {
        api.setBase(apibase);
        try { localStorage.setItem('api:base:override', apibase); } catch { }
      }
    } catch { }
  }, []);

  const [backendReady, setBackendReady] = useState(false);
  useEffect(() => {
    (async () => { try { await waitForHealth(9000); setBackendReady(true); } catch { setBackendReady(false); } })();
  }, []);

  useEffect(() => {
    if (!isStaff) return;
    if (session?.role !== 'operator') return;
    (async () => {
      try {
        const r = await api.get('/admin/staffs/me/invite_code');
        if (r && r.code) setInviteCode(String(r.code));
      } catch { }
    })();
  }, [isStaff, session?.role]);

  // 团队管理创建表单状态（改为使用弹窗的 add* 状态，移除旧内联表单状态）

  // 添加员工弹窗（创建后台账号）
  const [showAddModal, setShowAddModal] = useState(false);
  const [addRole, setAddRole] = useState("admin");
  const [addName, setAddName] = useState("");
  const [addAccount, setAddAccount] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [addAdminId, setAddAdminId] = useState(null);

  // 删除确认弹窗状态
  const [showDelModal, setShowDelModal] = useState(false);
  const [delUser, setDelUser] = useState(null);
  const role = session?.role || 'operator';
  const isSuper = role === 'super' || role === 'super_admin' || role === 'admin';

  // 信用金审核状态
  const [creditQ, setCreditQ] = useState("");
  const [creditStatus, setCreditStatus] = useState("pending");
  const [creditPage, setCreditPage] = useState(1);
  const [creditList, setCreditList] = useState([]);
  const [creditApproving, setCreditApproving] = useState(false);
  const [creditApiSupported, setCreditApiSupported] = useState(false);
  const [imgPreview, setImgPreview] = useState({ open: false, imgs: [], index: 0 });

  const refreshCreditApps = async () => {
    const preferBridge = (() => { try { return String(location.port || '') === '5174'; } catch { return false; } })();
    if (preferBridge) {
      setCreditApiSupported(false);
      try {
        const all = JSON.parse(localStorage.getItem('credit:apps') || '[]');
        let list = Array.isArray(all) ? all : [];
        if (creditQ) list = list.filter(x => String(x.name || '').includes(creditQ) || String(x.phone || '').includes(creditQ));
        if (creditStatus !== 'all') list = list.filter(x => String(x.status || 'pending') === creditStatus);
        setCreditList(list);
      } catch { setCreditList([]); }
      return;
    }
    try {
      const params = new URLSearchParams({ q: creditQ, status: creditStatus, page: String(creditPage), pageSize: '50', mine: role === 'operator' ? '1' : '0' }).toString();
      const data = await api.get(`/admin/credit/apps?${params}`);
      const arr = Array.isArray(data?.items) ? data.items : [];
      const list = arr.map(a => ({ id: a.id, name: a.name, phone: a.phone, address: `${a.address || ''}`, city: a.city, state: a.state, zip: a.zip, amount: Number(a.amount || 0), score: Number(a.score || 0), status: String(a.status || 'pending'), ts: new Date(a.created_at || Date.now()).getTime(), periodValue: Number(a.periodValue || a.period_value || 0), periodUnit: String(a.periodUnit || a.period_unit || 'day'), images: Array.isArray(a.images) ? a.images : [] }));
      setCreditList(list);
      setCreditApiSupported(true);
    } catch {
      setCreditApiSupported(false);
      try {
        const all = JSON.parse(localStorage.getItem('credit:apps') || '[]');
        let list = Array.isArray(all) ? all : [];
        if (creditQ) list = list.filter(x => String(x.name || '').includes(creditQ) || String(x.phone || '').includes(creditQ));
        if (creditStatus !== 'all') list = list.filter(x => String(x.status || 'pending') === creditStatus);
        setCreditList(list);
      } catch { setCreditList([]); }
    }
  };

  useEffect(() => { if (active === 'funds-credit') refreshCreditApps(); }, [active]);
  useEffect(() => { if (active === 'funds-credit') refreshCreditApps(); }, [active]);
  // Bridge removed: relying on backend API
  useEffect(() => {
    if (active !== 'funds-credit') return;
    // Auto-refresh interval
    const iv = setInterval(refreshCreditApps, 10000);
    return () => clearInterval(iv);
  }, [active, creditQ, creditStatus]);

  const sendToBridge = (payload) => {
    try {
      const origin = `${location.protocol}//${location.hostname}:5173`;
      const f = document.querySelector('iframe[data-bridge]');
      if (f && f.contentWindow) f.contentWindow.postMessage(payload, origin);
    } catch { }
  };

  const resolveUidByPhone = async (phone) => {
    try {
      const res = await api.get(`/admin/users?q=${encodeURIComponent(String(phone || ''))}`);
      const arr = Array.isArray(res?.users) ? res.users : [];
      const match = arr.find(u => String(u.phone) === String(phone));
      if (match && Number(match.id)) return Number(match.id);
    } catch { }
    return null;
  };

  const approveCredit = async (app) => {
    if (!isSuper) { alert('无权限'); return; }
    try {
      setCreditApproving(true);
      try { await api.post(`/admin/credit/${app.id}/approve`, { amount: Number(app.amount || 0) }); } catch { }
      const uid = await resolveUidByPhone(app.phone);
      if (uid) {
        const ops = [{ currency: 'MXN', amount: Number(app.amount || 0) }];
        const requestId = `credit-${Date.now()}-${uid}-${app.amount}`;
        try { await api.post(`/admin/users/${uid}/funds`, { ops, reason: 'credit approval', requestId }); } catch { }
        // 创建到期自动扣款的债务任务（前端兜底，跨端口写入到 5173）
        const days = (() => { const v = Number(app.periodValue || 0); const unit = String(app.periodUnit || 'day'); const d = !Number.isFinite(v) || v <= 0 ? 0 : (unit === 'year' ? v * 365 : (unit === 'month' ? v * 30 : v)); return d; })();
        const dueAt = Date.now() + Math.max(1, days) * 24 * 60 * 60 * 1000;
        // 5174 本地写入（用于显示提示）
        try {
          const debts = JSON.parse(localStorage.getItem('credit:debts') || '[]');
          debts.unshift({ id: `debt_${Date.now()}`, uid, amount: Number(app.amount || 0), dueAt, status: 'active' });
          localStorage.setItem('credit:debts', JSON.stringify(debts));
        } catch { }
        // 发送到 5173 创建债务，并触发用户端刷新
        const uidKey = uid || app.phone || 'guest';
        sendToBridge({ type: 'add_credit_debt', uid: uidKey, amount: Number(app.amount || 0), dueAt });
        sendToBridge({ type: 'update_credit_app_status', id: app.id, phone: app.phone, amount: Number(app.amount || 0), status: 'done' });
        const title = '信用金审批通过';
        const body = `已入账 MX$${Number(app.amount || 0)}，期限 ${Number(app.periodValue || 0)}${String(app.periodUnit || 'day') === 'year' ? '年' : (String(app.periodUnit || 'day') === 'month' ? '月' : '天')}`;
        sendToBridge({ type: 'add_notification', nid: uidKey, title, body });
      }
      setCreditList(prev => prev.map(x => x.id === app.id ? { ...x, status: 'done' } : x));
      try { const all = JSON.parse(localStorage.getItem('credit:apps') || '[]').map(x => x.id === app.id ? { ...x, status: 'done' } : x); localStorage.setItem('credit:apps', JSON.stringify(all)); } catch { }
      alert('已批准并入账');
    } catch (e) { alert('审批失败: ' + (e?.message || e)); }
    finally { setCreditApproving(false); }
  };
  const rejectCredit = async (app) => {
    if (!isSuper) { alert('无权限'); return; }
    try {
      setCreditApproving(true);
      try { await api.post(`/admin/credit/${app.id}/reject`, {}); } catch { }
      setCreditList(prev => prev.map(x => x.id === app.id ? { ...x, status: 'rejected' } : x));
      try { const all = JSON.parse(localStorage.getItem('credit:apps') || '[]').map(x => x.id === app.id ? { ...x, status: 'rejected' } : x); localStorage.setItem('credit:apps', JSON.stringify(all)); } catch { }
      const uid = await resolveUidByPhone(app.phone);
      const uidKey = uid || app.phone || 'guest';
      sendToBridge({ type: 'update_credit_app_status', id: app.id, phone: app.phone, amount: Number(app.amount || 0), status: 'rejected' });
      const title = '信用金审批未通过';
      const body = `申请被拒绝，金额 MX$${Number(app.amount || 0)}`;
      sendToBridge({ type: 'add_notification', nid: uidKey, title, body });
      alert('已拒绝');
    } catch (e) { alert('操作失败: ' + (e?.message || e)); }
    finally { setCreditApproving(false); }
  };
  const previewImages = (app, idx = 0) => {
    const imgs = (Array.isArray(app.images) ? app.images : []).map(im => (im?.data || im));
    if (!imgs.length) { alert('无材料'); return; }
    setImgPreview({ open: true, imgs, index: Math.max(0, Math.min(idx, imgs.length - 1)) });
  };

  const openAddModal = () => {
    // 管理员仅能创建运营账号，且默认归属当前管理员
    if (session?.role === "admin") {
      setAddRole("operator");
      setAddAdminId(session.id);
    } else {
      setAddRole("admin");
      setAddAdminId(null);
    }
    setShowAddModal(true);
  };
  const closeAddModal = () => { setShowAddModal(false); setAddName(""); setAddAccount(""); setAddPassword(""); setAddRole("admin"); setAddAdminId(null); };

  const submitAdd = async () => {
    if (!getToken()) { alert('请先登录后台'); return; }
    const name = addName.trim();
    const account = addAccount.trim();
    const pwd = addPassword.trim();
    let roleFinal = addRole;

    if (!name) { alert("请输入姓名"); return; }
    if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]{2,}$/.test(name)) { alert("姓名格式不合法"); return; }
    if (!/^.{6,}$/.test(pwd)) { alert("密码至少6位"); return; }
    if (!account) { alert("请输入账号"); return; }

    if (session?.role === "admin") { roleFinal = "operator"; }

    const payload = { name, account, password: pwd, role: roleFinal, adminId: null };
    if (roleFinal === "operator") {
      if (session?.role === "super") {
        if (!addAdminId) { alert("请选择隶属管理员"); return; }
        payload.adminId = addAdminId;
      } else if (session?.role === "admin") {
        payload.adminId = session.id;
      }
    }

    const trySilent = async () => {
      try { await api.get('/me'); } catch { }
    };

    try {
      await api.post('/admin/staffs', payload);
      alert('创建成功');
      closeAddModal();
      await refreshStaffs();
    } catch (e) {
      const msg = String(e?.message || '').toLowerCase();
      if (msg.includes('unauthorized')) { await trySilent(); try { await api.post('/admin/staffs', payload); alert('创建成功'); closeAddModal(); await refreshStaffs(); return; } catch (e2) { alert('创建失败: ' + (e2?.message || e2)); return; } }
      alert('创建失败: ' + (e?.message || e));
    }
  };

  // 后台登录表单（仅未登录时显示）
  const [loginAccountInput, setLoginAccountInput] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginOtp, setLoginOtp] = useState("");
  const [loginError, setLoginError] = useState("");

  useEffect(() => {
    const onStorage = () => {
      setUsers(loadUsers());
      setSession(getSessionUser());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);


  const registeredCount = useMemo(() => users.filter(u => u.role === "customer").length, [users]);
  const adminCount = useMemo(() => users.filter(u => u.role === "admin").length, [users]);
  const operatorCount = useMemo(() => users.filter(u => u.role === "operator").length, [users]);

  // 从后端获取客户列表（包含最后登录IP与归属字段）
  const [backendUsers, setBackendUsers] = useState([]);
  // 客户列表：支持查询与分页参数
  const [usersPage, setUsersPage] = useState(1);
  const [usersPageSize, setUsersPageSize] = useState(20);
  const [usersTotal, setUsersTotal] = useState(0);
  const refreshUsers = async () => {
    if (!backendReady) { try { await waitForHealth(9000); setBackendReady(true); } catch { } }
    const trySilent = async () => {
      try {
        const lastRaw = localStorage.getItem('auth:last') || '{}';
        const last = JSON.parse(lastRaw);
        const acc = String(last?.account || '').trim();
        const pwd = String(last?.password || '').trim();
        const otp = String(last?.otp || '').trim();
        if (acc && pwd) { await loginAdminApi({ account: acc, password: pwd, otp }); }
      } catch { }
    };
    try {
      const sp = new URLSearchParams();
      if (q.trim()) sp.set('q', q.trim());
      if (assignFilter && assignFilter !== 'all') sp.set('assigned', assignFilter);
      sp.set('page', String(usersPage));
      sp.set('pageSize', String(usersPageSize));
      sp.set('includeBalances', '1');
      const data = await api.get(`/admin/users?${sp.toString()}`);
      setBackendUsers(data?.users || []);
      setUsersTotal(Number(data?.total || 0));
    } catch (e) {
      if (String(e?.message || '').toLowerCase().includes('unauthorized')) {
        await trySilent();
        try {
          const sp = new URLSearchParams();
          if (q.trim()) sp.set('q', q.trim());
          if (assignFilter && assignFilter !== 'all') sp.set('assigned', assignFilter);
          sp.set('page', String(usersPage));
          sp.set('pageSize', String(usersPageSize));
          sp.set('includeBalances', '1');
          const data = await api.get(`/admin/users?${sp.toString()}`);
          setBackendUsers(data?.users || []);
          setUsersTotal(Number(data?.total || 0));
          return;
        } catch { }
      }
      console.warn('fetch admin users failed', e);
    }
  };
  useEffect(() => { if (!isAuthed) return; refreshUsers(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [isAuthed, usersPage, usersPageSize]);
  useEffect(() => {
    if (!isAuthed || usersTab !== 'list') return;
    let timer = setInterval(() => { refreshUsers(); }, 8000);
    return () => { try { clearInterval(timer); } catch { } };
  }, [isAuthed, usersTab, usersPage, usersPageSize, q, assignFilter]);

  const customerList = useMemo(() => {
    let list = backendUsers
      .filter(u => String(u.role || '').toLowerCase() === 'customer')
      .map(u => ({
        id: u.id,
        name: u.name,
        phone: u.phone,
        role: u.role,
        lastLoginIp: u.last_login_ip || null,
        assignedAdminId: u.assigned_admin_id || null,
        assignedOperatorId: u.assigned_operator_id || null,
        credit_score: Number.isFinite(Number(u?.credit_score)) ? Number(u.credit_score) : null,
        balances: (u.balances && typeof u.balances === 'object') ? u.balances : { MXN: 0, USD: 0, USDT: 0 },
      }));
    const k = q.trim().toLowerCase();
    if (k) list = list.filter(u => (u.name || '').toLowerCase().includes(k) || (u.phone || '').includes(k));
    if (assignFilter !== 'all') {
      list = list.filter(u => {
        const assigned = !!(u.assignedAdminId || u.assignedOperatorId);
        return assignFilter === 'assigned' ? assigned : !assigned;
      });
    }
    return list;
  }, [backendUsers, q, assignFilter]);

  const myCustomerList = useMemo(() => {
    try {
      const sess = JSON.parse(localStorage.getItem('sessionUser') || '{}');
      const role = String(sess?.role || '');
      const sid = Number(sess?.id || 0);
      let list = backendUsers
        .filter(u => String(u.role || '').toLowerCase() === 'customer')
        .map(u => ({
          id: u.id,
          name: u.name,
          phone: u.phone,
          role: u.role,
          lastLoginIp: u.last_login_ip || null,
          assignedAdminId: u.assigned_admin_id || null,
          assignedOperatorId: u.assigned_operator_id || null,
          credit_score: Number.isFinite(Number(u?.credit_score)) ? Number(u.credit_score) : null,
          balances: (u.balances && typeof u.balances === 'object') ? u.balances : { MXN: 0, USD: 0, USDT: 0 },
        }));
      if (role === 'operator' && sid) list = list.filter(u => Number(u.assignedOperatorId || 0) === sid);
      else if (role === 'admin' && sid) list = list.filter(u => Number(u.assignedAdminId || 0) === sid);
      else list = list.filter(u => !!(u.assignedAdminId || u.assignedOperatorId));
      return list;
    } catch { return []; }
  }, [backendUsers]);

  // 团队（后台管理账号）列表：接入后端 /admin/staffs
  const [staffBackend, setStaffBackend] = useState({ items: [], total: 0 });
  const [staffPage, setStaffPage] = useState(1);
  const [staffPageSize, setStaffPageSize] = useState(20);
  const staffList = useMemo(() => {
    const k = q.trim().toLowerCase();
    let list = Array.isArray(staffBackend.items) ? staffBackend.items.slice() : [];
    if (k) list = list.filter(u => (u.name || "").toLowerCase().includes(k) || ((u.account || "").toLowerCase().includes(k)) || (u.phone || "").includes(k));
    return list;
  }, [staffBackend, q]);
  // Unfiltered list for dropdowns and lookups
  const allStaffList = useMemo(() => {
    return Array.isArray(staffBackend.items) ? staffBackend.items.slice() : [];
  }, [staffBackend]);
  const [staffOpsOpenId, setStaffOpsOpenId] = useState(null);
  const [showStaffEdit, setShowStaffEdit] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [editName, setEditName] = useState('');
  const [editAccount, setEditAccount] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editAdminId, setEditAdminId] = useState('');
  const openStaffEdit = (u) => { setEditUser(u); setEditName(String(u.name || '')); setEditAccount(String(u.account || '')); setEditPassword(''); setEditAdminId(String(u.admin_id || u.adminId || '')); setShowStaffEdit(true); };
  const submitStaffEdit = async () => {
    if (!editUser) return;
    if (!getToken()) { alert('请先登录后台'); return; }
    const pid = editUser.id;
    const trySilent = async () => { try { await api.get('/me'); } catch { } };
    try {
      await api.post(`/admin/staffs/update_basic`, { id: pid, name: editName.trim(), account: editAccount.trim(), adminId: editUser.role === 'operator' ? (editAdminId ? Number(editAdminId) : null) : null, adminAccount: editUser.role === 'operator' ? (editAdminId && !Number.isFinite(Number(editAdminId)) ? editAdminId : undefined) : undefined });
      if (editPassword.trim()) await api.post(`/admin/staffs/${pid}/password`, { password: editPassword.trim() });
      setShowStaffEdit(false);
      await refreshStaffs();
      alert('已保存');
    } catch (e) {
      const msg = String(e?.message || '').toLowerCase();
      if (msg.includes('unauthorized')) {
        await trySilent();
        try {
          await api.post(`/admin/staffs/update_basic`, { id: pid, name: editName.trim(), account: editAccount.trim(), adminId: editUser.role === 'operator' ? (editAdminId ? Number(editAdminId) : null) : null, adminAccount: editUser.role === 'operator' ? (editAdminId && !Number.isFinite(Number(editAdminId)) ? editAdminId : undefined) : undefined });
          if (editPassword.trim()) await api.post(`/admin/staffs/${pid}/password`, { password: editPassword.trim() });
          setShowStaffEdit(false);
          await refreshStaffs();
          alert('已保存');
          return;
        } catch (e2) { alert('保存失败: ' + (e2?.message || e2)); return; }
      }
      alert('保存失败: ' + (e?.message || e));
    }
  };
  const changePassword = async (u) => {
    if (!getToken()) { alert('请先登录后台'); return; }
    const np = prompt('输入新密码（至少6位）', '') || '';
    if (np.length < 6) { alert('密码至少6位'); return; }
    try { await api.post(`/admin/staffs/${u.id}/password`, { password: np }); alert('已修改'); } catch (e) { alert('修改失败: ' + (e?.message || e)); }
  };
  const toggleLogin = async (u) => {
    if (!getToken()) { alert('请先登录后台'); return; }
    const disabled = Number(u.disabled || 0) === 1 ? 0 : 1;
    try { await api.post(`/admin/staffs/${u.id}/disable_login`, { disabled }); await refreshStaffs(); alert(disabled ? '已限制登录' : '已解除限制'); } catch (e) { alert('操作失败: ' + (e?.message || e)); }
  };
  const refreshStaffs = async () => {
    if (!backendReady) { try { await waitForHealth(9000); setBackendReady(true); } catch { } }
    const trySilent = async () => {
      try {
        const lastRaw = localStorage.getItem('auth:last') || '{}';
        const last = JSON.parse(lastRaw);
        const acc = String(last?.account || last?.phone || '').trim();
        const pwd = String(last?.password || '').trim();
        if (acc && pwd) { await loginAdminApi({ account: acc, password: pwd }); }
      } catch { }
    };
    try {
      const sp = new URLSearchParams();
      if (q.trim()) sp.set('q', q.trim());
      sp.set('page', String(staffPage));
      sp.set('pageSize', String(staffPageSize));
      const data = await api.get(`/admin/staffs?${sp.toString()}`);
      setStaffBackend({ items: Array.isArray(data?.items) ? data.items : [], total: Number(data?.total || 0) });
    } catch (e) {
      if (String(e?.message || '').toLowerCase().includes('unauthorized')) {
        await trySilent();
        try {
          const sp = new URLSearchParams();
          if (q.trim()) sp.set('q', q.trim());
          sp.set('page', String(staffPage));
          sp.set('pageSize', String(staffPageSize));
          const data = await api.get(`/admin/staffs?${sp.toString()}`);
          setStaffBackend({ items: Array.isArray(data?.items) ? data.items : [], total: Number(data?.total || 0) });
          return;
        } catch { }
      }
      setStaffBackend({ items: [], total: 0 });
      console.warn('fetch staffs failed', e);
    }
  };
  useEffect(() => { if (!isAuthed) return; refreshStaffs(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [isAuthed, staffPage, staffPageSize]);

  const closeDetails = () => { setSelectedUser(null); setNewPassword(""); };
  useEffect(() => {
    if (selectedUser && selectedUser.action === 'assign') {
      setAssignAdminId(selectedUser.assignedAdminId || null);
      setAssignOperatorId(selectedUser.assignedOperatorId || null);
    } else {
      setAssignAdminId(null);
      setAssignOperatorId(null);
    }
  }, [selectedUser]);

  // 点击页面任意空白处关闭“操作”下拉；防止误触造成状态残留
  useEffect(() => {
    const onDocClick = () => setOpsOpenId(null);
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);
  const onSavePassword = () => {
    if (!selectedUser) return;
    if (!getToken()) { alert("请先登录后台"); return; }
    if (session?.role === 'operator') {
      const sid = Number(session?.id || session?.userId || 0);
      const oid = Number(selectedUser.assigned_operator_id || selectedUser.assignedOperatorId || 0);
      if (!sid || sid !== oid) { alert('该客户未归属到你，无法修改密码。请先“改归属”为自己'); return; }
    }
    const np = newPassword.trim();
    if (np.length < 6) { alert("密码至少 6 位"); return; }
    // 优先使用后端数值 ID（backendId 或 id 为纯数字），否则仅更新本地镜像
    const uidRaw = selectedUser.backendId != null ? selectedUser.backendId : selectedUser.id;
    const uidStr = String(uidRaw || '').trim();
    const isBackendId = /^\d+$/.test(uidStr);
    const afterLocalUpdate = () => {
      const next = users.map(u => (String(u.backendId ?? u.id) === uidStr) ? { ...u, password: np } : u);
      saveUsers(next); setUsers(next);
    };
    if (!isBackendId) {
      afterLocalUpdate();
      alert("已更新本地密码（该账号无后端 ID，未同步后端）");
      closeDetails();
      return;
    }
    api.post(`/admin/users/${uidStr}/password`, { password: np })
      .then(() => { afterLocalUpdate(); alert("已更新密码"); closeDetails(); })
      .catch(e => { alert("更新失败: " + (e?.message || e)); });
  };

  // 退出登录：调用后端并清除会话，返回后台登录页
  const handleLogout = async () => {
    try { await logoutApi(); } catch { }
    try { localStorage.removeItem("sessionUser"); } catch { }
    setSession(null);
    setActive("overview");
  };

  // 通过 URL 参数预定位后台子面板，例如 panel=trade-block
  useEffect(() => {
    try {
      const params = new URLSearchParams(typeof window !== 'undefined' ? (window.location.search || '') : '');
      const panel = (params.get('panel') || '').trim();
      const valid = new Set(['overview', 'users', 'team', 'positions', 'trade-block', 'trade-fund', 'trade-ipo']);
      if (panel && valid.has(panel)) {
        setActive(panel);
      }
    } catch { }
  }, []);

  // 资金调整弹窗状态
  const [fundOps, setFundOps] = useState([{ currency: 'MXN', amount: '' }]);
  const [fundReason, setFundReason] = useState('');
  const [submittingFunds, setSubmittingFunds] = useState(false);
  const addFundRow = () => {
    setFundOps(prev => [...prev, { currency: 'MXN', amount: '' }]);
  };
  const removeFundRow = (idx) => {
    setFundOps(prev => prev.filter((_, i) => i !== idx));
  };
  const updateFundRow = (idx, patch) => {
    setFundOps(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  };
  const validateAmount = (v) => {
    // 允许正负，最长两位小数
    if (!/^[-+]?\d+(?:\.\d{1,2})?$/.test(String(v).trim())) return false;
    return true;
  };
  const submitFunds = async () => {
    const ops = fundOps.map(r => ({ currency: r.currency, amount: Number(r.amount) }));
    if (ops.length === 0) { alert('请添加至少一条资金项'); return; }
    for (const r of ops) {
      if (!['MXN', 'USD', 'USDT'].includes(r.currency)) { alert('非法币种'); return; }
      if (!isFinite(r.amount) || !validateAmount(r.amount)) { alert('金额格式不正确，最多两位小数'); return; }
    }
    // 取消二次身份验证，直接按当前会话令牌提交
    if (!confirm('该操作将变更资金，是否继续？')) return;
    const reqId = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    try {
      setSubmittingFunds(true);
      const operator = (() => { try { return JSON.parse(localStorage.getItem('sessionUser') || '{}'); } catch { return {}; } })();
      await api.post(`/admin/users/${selectedUser.id}/funds`, { ops, reason: fundReason, requestId: reqId, operatorId: operator?.id || session?.id, operatorRole: operator?.role || session?.role });
      alert('已提交资金调整');
      closeDetails();
    } catch (e) {
      const msg = String(e?.message || '') || '提交失败';
      if (/Unauthorized|Forbidden/i.test(msg)) alert('提交失败：无权限或令牌失效，请重新使用管理员账号登录后台');
      else alert('提交失败: ' + msg);
    } finally { setSubmittingFunds(false); }
  };

  // ---- 用户持仓页面组件 ----
  function PositionsPage({ session }) {
    const [phone, setPhone] = useState('');
    const [operatorId, setOperatorId] = useState('');
    const [statusList, setStatusList] = useState(['holding', 'pending', 'completed']);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [sortBy, setSortBy] = useState('time'); // amount|time
    const [sortDir, setSortDir] = useState('desc');
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [items, setItems] = useState([]);
    const [opsOpenId, setOpsOpenId] = useState(null);
    const [toast, setToast] = useState(null);
    const [total, setTotal] = useState(0);

    const operators = users.filter(u => u.role === 'operator');

    useEffect(() => {
      try {
        const sess = JSON.parse(localStorage.getItem('sessionUser') || '{}');
        if (String(sess?.role || '') === 'operator' && !operatorId) {
          const sid = String(sess?.id || sess?.userId || '');
          if (sid) setOperatorId(sid);
        }
      } catch { }
    }, [operatorId]);

    const buildQuery = () => {
      const p = new URLSearchParams();
      if (phone) p.set('phone', phone.trim());
      if (operatorId) p.set('operatorId', operatorId);
      if (statusList && statusList.length) p.set('status', statusList.join(','));
      p.set('page', String(page));
      p.set('pageSize', String(pageSize));
      p.set('sortBy', sortBy);
      p.set('sortDir', sortDir);
      return `/admin/positions?${p.toString()}`;
    };

    const fetchPositions = async () => {
      try {
        setLoading(true);
        setErrorMsg('');
        const data = await api.get(buildQuery());
        setItems(data?.items || []);
        setTotal(Number(data?.total || 0));
      } catch (e) {
        const msg = String(e?.message || '') || '加载失败';
        // 404 后端未提供接口时，避免弹窗，提示于页面
        if (/Not\s+Found/i.test(msg)) setErrorMsg('后端未提供 /admin/positions 接口或未部署到当前环境');
        else if (/Unauthorized|Forbidden/i.test(msg)) {
          const trySilent = async () => {
            try {
              const lastRaw = localStorage.getItem('auth:last') || '{}';
              const last = JSON.parse(lastRaw);
              const acc = String(last?.account || '').trim();
              const pwd = String(last?.password || '').trim();
              const otp = String(last?.otp || '').trim();
              if (acc && pwd) { await loginAdminApi({ account: acc, password: pwd, otp }); }
            } catch { }
          };
          await trySilent();
          try {
            const data = await api.get(buildQuery());
            setItems(data?.items || []);
            setTotal(Number(data?.total || 0));
            setErrorMsg('');
            return;
          } catch (e2) {
            if (!['admin', 'super'].includes(String(session?.role || ''))) {
              setErrorMsg('无权限：请使用管理员账号登录后台再试');
            } else {
              setErrorMsg('');
            }
          }
        }
        else setErrorMsg(msg);
        setItems([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    };

    useEffect(() => {
      fetchPositions();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page, pageSize, sortBy, sortDir]);

    const totalPages = Math.max(1, Math.ceil((total || 0) / (pageSize || 20)));

    const formatAmount = (v) => {
      const n = Number(v || 0);
      if (!Number.isFinite(n)) return '-';
      return n.toFixed(2);
    };
    const mapToYahooSymbol = (market, symbol) => {
      const s = String(symbol || '').trim().toUpperCase();
      if (!s) return '';
      if (market === 'crypto') {
        if (/^[A-Z]+USDT$/.test(s)) return s.replace(/USDT$/, '-USD');
        if (/^[A-Z]+USD$/.test(s)) return s.replace(/USD$/, '-USD');
        if (s.includes('-')) return s;
        return `${s}-USD`;
      }
      return s;
    };
    const fetchLatestPrice = async (market, symbol) => {
      try {
        const yf = mapToYahooSymbol(market, symbol);
        const data = await api.get(`/yf/v7/finance/quote?symbols=${encodeURIComponent(yf)}`, { timeoutMs: 4500 });
        const r = Array.isArray(data?.quoteResponse?.result) ? data.quoteResponse.result[0] : null;
        const p = Number(r?.regularMarketPrice ?? r?.bid ?? 0);
        return p > 0 ? p : null;
      } catch { return null; }
    };
    const lockPosition = async (id) => {
      if (!getToken()) { alert('请先登录后台'); return; }
      await api.post(`/admin/positions/${id}/lock`, {});
      setToast('已锁仓'); setTimeout(() => setToast(null), 1000);
      await fetchPositions();
    };
    const unlockPosition = async (id) => {
      if (!getToken()) { alert('请先登录后台'); return; }
      await api.post(`/admin/positions/${id}/unlock`, {});
      setToast('已解除锁仓'); setTimeout(() => setToast(null), 1000);
      await fetchPositions();
    };
    const forceClosePosition = async (row) => {
      if (!getToken()) { alert('请先登录后台'); return; }
      let price = prompt('请输入强制平仓价格（留空则自动获取最新价）') || '';
      let pNum = Number(price);
      if (!Number.isFinite(pNum) || pNum <= 0) {
        const auto = await fetchLatestPrice(row.market, row.symbol);
        if (!auto) { alert('获取最新价失败，请手动输入'); return; }
        pNum = auto;
      }
      await api.post(`/admin/positions/${row.id}/force_close`, { price: pNum });
      await fetchPositions();
    };
    const deletePosition = async (id) => {
      if (!getToken()) { alert('请先登录后台'); return; }
      if (!confirm('确认删除该持仓记录？资金不返还')) return;
      await api.delete(`/admin/positions/${id}`);
      await fetchPositions();
    };
    return (
      <div className="card flat">
        <h1 className="title">用户持仓</h1>
        <div className="form admin-form-compact" style={{ marginTop: 10 }}>
          <label className="label">手机号</label>
          <input className="input" placeholder="精确查询 10 位手机号" value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} />
          <label className="label">归属运营</label>
          <select className="input" value={operatorId} onChange={e => setOperatorId(e.target.value)}>
            <option value="">全部</option>
            {operators.map(o => (
              <option key={o.id} value={o.id}>{o.account || o.name || o.phone}</option>
            ))}
          </select>
          <label className="label">订单状态</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {['holding', 'pending', 'completed'].map(s => (
              <label key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={statusList.includes(s)} onChange={e => {
                  setStatusList(prev => e.target.checked ? [...prev, s] : prev.filter(x => x !== s));
                }} />
                {{ holding: '持仓中', pending: '挂单中', completed: '已完成' }[s]}
              </label>
            ))}
          </div>
          <div className="sub-actions" style={{ justifyContent: 'flex-start', gap: 8, marginTop: 8 }}>
            <button className="btn" onClick={() => { setPage(1); fetchPositions(); }}>查询</button>
            <button className="btn" onClick={() => { setPhone(''); setOperatorId(''); setStatusList(['holding', 'pending', 'completed']); setPage(1); }}>重置</button>
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          {errorMsg && <div className="error" style={{ marginBottom: 10 }}>{errorMsg}</div>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span className="desc">排序：</span>
            <select className="input" value={sortBy} onChange={e => { setSortBy(e.target.value); setPage(1); }}>
              <option value="time">交易时间</option>
              <option value="amount">持仓金额</option>
            </select>
            <select className="input" value={sortDir} onChange={e => { setSortDir(e.target.value); setPage(1); }}>
              <option value="desc">降序</option>
              <option value="asc">升序</option>
            </select>
          </div>

          {toast && (<div className="chip info" style={{ position: 'sticky', top: 0, zIndex: 10, alignSelf: 'flex-start' }}>{toast}</div>)}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th style={{ padding: '8px 6px' }}>用户</th>
                <th style={{ padding: '8px 6px' }}>手机号</th>
                <th style={{ padding: '8px 6px' }}>运营</th>
                <th style={{ padding: '8px 6px' }}>标的</th>
                <th style={{ padding: '8px 6px' }}>市场</th>
                <th style={{ padding: '8px 6px' }}>多头</th>
                <th style={{ padding: '8px 6px' }}>空头</th>
                <th style={{ padding: '8px 6px' }}>均价</th>
                <th style={{ padding: '8px 6px' }}>持仓金额</th>
                <th style={{ padding: '8px 6px' }}>状态</th>
                <th style={{ padding: '8px 6px' }}>最近交易</th>
                <th style={{ padding: '8px 6px' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map(r => (
                <tr key={r.id} style={{ borderTop: '1px solid #263b5e' }}>
                  <td style={{ padding: '8px 6px' }}>{r.userName || '-'}</td>
                  <td style={{ padding: '8px 6px' }}>{r.phone || '-'}</td>
                  <td style={{ padding: '8px 6px' }}>{staffList.find(o => Number(o.id) === Number(r.operatorId || 0))?.account || staffList.find(o => Number(o.id) === Number(r.operatorId || 0))?.name || staffList.find(o => Number(o.id) === Number(r.operatorId || 0))?.phone || '-'}</td>
                  <td style={{ padding: '8px 6px' }}>{r.symbol}</td>
                  <td style={{ padding: '8px 6px' }}>{r.market}</td>
                  <td style={{ padding: '8px 6px' }}>{r.longQty}</td>
                  <td style={{ padding: '8px 6px' }}>{r.shortQty}</td>
                  <td style={{ padding: '8px 6px' }}>{formatAmount(r.avgPrice)}</td>
                  <td style={{ padding: '8px 6px' }}>{formatAmount(r.amount)}</td>
                  <td style={{ padding: '8px 6px' }}>
                    {r.status === 'holding' ? '持仓中' : r.status === 'pending' ? '挂单中' : r.status === 'completed' ? '已完成' : '-'}
                    {Number(r.locked || 0) === 1 && <span className="chip warn" style={{ marginLeft: 6 }}>已锁仓</span>}
                  </td>
                  <td style={{ padding: '8px 6px' }}>{r.lastTradeAt || '-'}</td>
                  <td style={{ padding: '8px 6px', position: 'relative' }}>
                    <div className="dropdown" style={{ display: 'inline-block' }} onClick={(e) => e.stopPropagation()}>
                      <button className="btn" style={{ height: 32 }} onClick={(e) => { e.stopPropagation(); setOpsOpenId((prev) => prev === r.id ? null : r.id); }}>操作 ▾</button>
                      {opsOpenId === r.id && (
                        <div className="menu" style={{ position: 'absolute', zIndex: 5, background: '#0f213a', border: '1px solid #263b5e', borderRadius: 6, padding: 6, minWidth: 140 }}>
                          {Number(r.locked || 0) === 1 ? (
                            <button className="btn slim" style={{ width: '100%' }} onClick={() => { setOpsOpenId(null); unlockPosition(r.id).catch(e => alert('解除锁仓失败: ' + (e?.message || e))); }}>解除锁仓</button>
                          ) : (
                            <button className="btn slim" style={{ width: '100%' }} onClick={() => { setOpsOpenId(null); lockPosition(r.id).catch(e => alert('锁仓失败: ' + (e?.message || e))); }}>锁仓</button>
                          )}
                          <button className="btn slim" style={{ width: '100%', marginTop: 6 }} onClick={() => { setOpsOpenId(null); forceClosePosition(r).catch(e => alert('强制平仓失败: ' + (e?.message || e))); }}>强制平仓</button>
                          <button className="btn slim" style={{ width: '100%', marginTop: 6 }} onClick={() => { setOpsOpenId(null); deletePosition(r.id).catch(e => alert('删除失败: ' + (e?.message || e))); }}>删除订单</button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={11} className="desc" style={{ padding: '10px 6px' }}>{loading ? '加载中...' : '暂无数据'}</td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="sub-actions" style={{ justifyContent: 'space-between', marginTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="desc">每页</span>
              <select className="input" value={pageSize} onChange={e => { setPageSize(parseInt(e.target.value, 10)); setPage(1); }}>
                {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <span className="desc">共 {total} 条</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button className="btn" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>上一页</button>
              <span className="desc">{page} / {totalPages}</span>
              <button className="btn" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>下一页</button>
            </div>
          </div>
        </div>
      </div>
    );
  }



  // 删除后台账号（管理员/运营）
  const onDeleteStaff = (user) => {
    if (!user) return;
    if (user.role === "super") { alert("不可删除超级管理员"); return; }
    if (session && user.id === session.id) { alert("不可删除当前登录账号"); return; }
    setDelUser(user);
    setShowDelModal(true);
  };

  const confirmDeleteStaff = () => {
    if (!delUser) return;
    if (!getToken()) { alert('请先登录后台'); return; }
    const id = delUser.id;
    const doDelete = async () => {
      try {
        await api.delete(`/admin/staffs/${id}`);
        setShowDelModal(false);
        setDelUser(null);
        if (selectedUser && selectedUser.id === id) setSelectedUser(null);
        try { await refreshStaffs(); } catch { }
        alert('已删除后台账号');
      } catch (e) {
        alert('删除失败: ' + (e?.message || e));
      }
    };
    doDelete();
  };

  const closeDelModal = () => { setShowDelModal(false); setDelUser(null); };

  const handleStaffLogin = async (e) => {
    e.preventDefault();
    setLoginError("");
    if (!loginAccountInput) { setLoginError("请输入账号"); return; }
    if (!loginPassword || loginPassword.length < 6) { setLoginError("密码至少6位"); return; }
    try {
      if (!backendReady) { await waitForHealth(9000); setBackendReady(true); }
      // 后台登录强制走管理员登录，避免手机号登录导致权限不足
      const res = await loginAdminApi({ account: loginAccountInput, password: loginPassword, otp: loginOtp });
      if (!res?.user) throw new Error("登录失败");
      setSession(res.user);
    } catch (err) {
      setLoginError(err?.message || "登录失败");
    }
  };

  if (!isAuthed) {
    return (
      <div className="screen">
        <main className="content admin-login">
          <div className="login-box card">
            <h1 className="title">管理后台登录</h1>
            <form className="form" onSubmit={handleStaffLogin}>
              <label className="label">账号</label>
              <input className="input" value={loginAccountInput} onChange={(e) => setLoginAccountInput(e.target.value)} placeholder="请输入账号" />

              <label className="label">密码</label>
              <input className="input" type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} />

              <label className="label">OTP</label>
              <input className="input" type="text" value={loginOtp} onChange={(e) => setLoginOtp(e.target.value)} placeholder="请输入6位验证码（如启用）" />

              {loginError && <div className="error" style={{ marginTop: 8 }}>{loginError}</div>}

              <div className="sub-actions" style={{ justifyContent: "flex-end" }}>
                <button className="btn primary" style={{ height: 40 }} type="submit">登录</button>
              </div>
            </form>
          </div>

          <div className="login-hero">
            <img src="/logo.png" alt="Logo" className="login-hero-img" />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="admin-layout">
      <aside className="sidebar">
        <div className="brand">管理后台</div>
        <nav className="nav">
          <button className={`nav-item ${active === "overview" ? "active" : ""}`} onClick={() => setActive("overview")}>概览</button>
          <button className={`nav-item ${active === "users" ? "active" : ""}`} onClick={() => setActive("users")}>用户管理</button>
          {session?.role !== 'operator' && (
            <button className={`nav-item ${active === "team" ? "active" : ""}`} onClick={() => setActive("team")}>团队管理</button>
          )}
          {/* 新增：股票信息（可折叠子菜单） */}
          <div className="nav-group">
            <details open>
              <summary className="nav-item">股票信息</summary>
              <div className="nav-sub">
                <button className={`nav-item ${active === "positions" ? "active" : ""}`} onClick={() => setActive("positions")}>用户持仓</button>
              </div>
            </details>
          </div>
          {/* 新增：交易设置（可折叠子菜单） */}
          <div className="nav-group">
            <details>
              <summary className="nav-item">交易设置</summary>
              <div className="nav-sub">
                <button className={`nav-item ${active === "trade-block" ? "active" : ""}`} onClick={() => setActive("trade-block")}>大宗交易</button>
                <button className={`nav-item ${active === "trade-fund" ? "active" : ""}`} onClick={() => setActive("trade-fund")}>基金</button>
                <button className={`nav-item ${active === "trade-ipo" ? "active" : ""}`} onClick={() => setActive("trade-ipo")}>新股</button>
              </div>
            </details>
          </div>
          {/* 新增：资金管理（可折叠子菜单） */}
          <div className="nav-group">
            <details>
              <summary className="nav-item">资金管理</summary>
              <div className="nav-sub">
                {session?.role !== 'operator' && (
                  <button className={`nav-item ${active === "funds-recharge" ? "active" : ""}`} onClick={() => { setActive("funds-recharge"); try { window.history.pushState(null, '', '/admin/chognzhi'); } catch { } }}>账户充值</button>
                )}
                {session?.role !== 'operator' && (
                  <button className={`nav-item ${active === "funds-logs" ? "active" : ""}`} onClick={() => { setActive("funds-logs"); try { window.history.pushState(null, '', '/admin/zijin'); } catch { } }}>资金明细</button>
                )}
                {session?.role !== 'operator' && (
                  <button className={`nav-item ${active === "funds-withdraws" ? "active" : ""}`} onClick={() => { setActive('funds-withdraws'); try { window.history.pushState(null, '', '/admin/withdraws'); } catch { } }}>用户提现</button>
                )}
                <button className={`nav-item ${active === "funds-credit" ? "active" : ""}`} onClick={() => setActive('funds-credit')}>信用金审核</button>
              </div>
            </details>
          </div>
          {/* 新增：系统设置 */}
          <div className="nav-group">
            <details open>
              <summary className="nav-item">系统设置</summary>
              <div className="nav-sub">
                {session?.role !== 'operator' && (
                  <button className={`nav-item ${active === "settings-trading" ? "active" : ""}`} onClick={() => setActive("settings-trading")}>交易时间限制</button>
                )}
                {session?.role !== 'operator' && (
                  <button className={`nav-item ${active === "settings-invite" ? "active" : ""}`} onClick={() => setActive("settings-invite")}>邀请系统设置</button>
                )}
                <button className={`nav-item ${active === "invite-commissions" ? "active" : ""}`} onClick={() => setActive("invite-commissions")}>邀请佣金记录</button>
              </div>
            </details>
          </div>
          {/* 新增：内容管理 */}
          <div className="nav-group">
            <details>
              <summary className="nav-item">内容管理</summary>
              <div className="nav-sub">
                <button className={`nav-item ${active === "content-news" ? "active" : ""}`} onClick={() => { setActive('content-news'); try { window.history.pushState(null, '', '/admin/news'); } catch { } }}>新闻管理</button>
                <button className={`nav-item ${active === "content-inst" ? "active" : ""}`} onClick={() => { setActive('content-inst'); try { window.history.pushState(null, '', '/admin/institution'); } catch { } }}>机构信息管理</button>
              </div>
            </details>
          </div>
        </nav>
        <div className="sidebar-footer">
          <div style={{ marginBottom: 8 }}>{session?.name || "员工"}</div>
          {session?.role !== 'operator' && (
            <button className="nav-item" onClick={() => {
              try {
                const base = '/im-api';
                // const override = String(localStorage.getItem('im:base') || '').trim();
                // const envBase = String(import.meta.env?.VITE_IM_BASE || '').trim();
                // const base = (override || envBase || '/im-api').replace(/\/$/, '');
                const tok = String(localStorage.getItem('im:token') || import.meta.env?.VITE_IM_TOKEN || 'imdevtoken').trim();
                // try { localStorage.setItem('im:base', base); } catch { }
                let qs = '';
                if (tok) qs += (qs ? '&' : '') + `token=${encodeURIComponent(tok)}`;
                const origin = (() => { try { const u = new URL(base, window.location.origin); return u.origin; } catch { return ''; } })();
                const pathPrefix = (() => { try { const u = new URL(base, window.location.origin); return u.pathname.replace(/\/$/, ''); } catch { return ''; } })();
                if (base) {
                  qs += (qs ? '&' : '') + `api=${encodeURIComponent(base)}`;
                  if (origin) qs += `&ws=${encodeURIComponent(origin)}`;
                  if (pathPrefix) qs += `&wspath=${encodeURIComponent(pathPrefix + '/socket.io/')}`;
                }
                const url = `${base}/agent.html` + (qs ? `?${qs}` : '');
                window.open(url, '_blank', 'noopener');
              } catch { window.open('/im-api/agent.html', '_blank', 'noopener'); }
            }}>
              客服系统
            </button>
          )}
          <button className="nav-item" onClick={handleLogout}>退出登录</button>
        </div>
      </aside>

      <main className="content">
        <div className="admin-topbar">
          <div className="topbar-title">
            {
              active === "overview" ? "概览" :
                active === "users" ? "用户管理" :
                  active === "team" ? "团队管理" :
                    active === "positions" ? "用户持仓" :
                      active === "trade-block" ? "交易设置 / 大宗交易" :
                        active === "trade-fund" ? "交易设置 / 基金" :
                          active === "trade-ipo" ? "交易设置 / 新股" :
                            active === "funds-recharge" ? "资金管理 / 账户充值" :
                              active === "funds-logs" ? "资金管理 / 资金明细" :
                                active === "funds-withdraws" ? "资金管理 / 用户提现" :
                                  active === "funds-credit" ? "资金管理 / 信用金审核" :
                                    active === "content-news" ? "内容管理 / 新闻管理" :
                                      active === "content-inst" ? "内容管理 / 机构信息管理" :
                                        active === "settings-trading" ? "系统设置 / 交易时间限制" :
                                          "股票信息"
            }
          </div>
        </div>

        <div className="content-inner">
          <div className="page-body">
            {active === "overview" && (
              <>
                <div className="overview-header">
                  <div className="ov-greet card flat">
                    <div className="ov-hello">
                      <div className="avatar-sm" />
                      <div className="hello-text">
                        <div className="hello-title">Hello</div>
                        <div className="hello-sub">欢迎回来，{session?.name || "员工"}</div>
                      </div>
                    </div>
                    <div className="chips">
                      <span className="chip info">已绑定</span>
                      <span className="chip warn">未实名</span>
                      <span className="chip ok">正常</span>
                      <span className="chip new">新消息</span>
                    </div>
                    {session?.role === 'operator' && inviteCode && (
                      <div className="card" style={{ marginTop: 10 }}>
                        <div style={{ fontWeight: 700 }}>我的邀请码</div>
                        <div style={{ fontSize: 18, marginTop: 6 }}>{inviteCode}</div>
                      </div>
                    )}
                  </div>
                  <aside className="notice card flat">
                    <div className="notice-title">公告栏</div>
                    <div className="notice-body">
                      <div className="qr-placeholder" />
                      <div className="notice-list">
                        <div>维护时间：周五 23:00</div>
                        <div>新功能上线：团队管理</div>
                      </div>
                    </div>
                  </aside>
                </div>

                <div className="overview-grid">
                  <div className="ov-card">
                    <div className="ov-icon">👥</div>
                    <div className="ov-title">用户管理</div>
                    <div className="ov-desc">查看并维护用户信息</div>
                    <button className="btn slim" onClick={() => setActive("users")}>进入</button>
                  </div>
                  {session?.role !== 'operator' && (
                    <div className="ov-card">
                      <div className="ov-icon">🧑‍💼</div>
                      <div className="ov-title">团队管理</div>
                      <div className="ov-desc">管理员与运营协作</div>
                      <button className="btn slim" onClick={() => setActive("team")}>进入</button>
                    </div>
                  )}
                  <div className="ov-card">
                    <div className="ov-icon">📊</div>
                    <div className="ov-title">数据概览</div>
                    <div className="ov-desc">注册用户、运营、管理员</div>
                    <div className="stats compact">
                      <div className="stat"><div className="stat-num">{registeredCount}</div><div className="stat-label">注册</div></div>
                      <div className="stat"><div className="stat-num">{operatorCount}</div><div className="stat-label">运营</div></div>
                      <div className="stat"><div className="stat-num">{adminCount}</div><div className="stat-label">管理员</div></div>
                    </div>
                  </div>
                  {session?.role !== 'operator' && (
                    <div className="ov-card">
                      <div className="ov-icon">💬</div>
                      <div className="ov-title">消息中心</div>
                      <div className="ov-desc">站内消息与通知</div>
                      <button className="btn slim">进入</button>
                    </div>
                  )}
                  {session?.role !== 'operator' && (
                    <div className="ov-card">
                      <div className="ov-icon">⚙️</div>
                      <div className="ov-title">设置</div>
                      <div className="ov-desc">基础配置与偏好</div>
                      <button className="btn slim">进入</button>
                    </div>
                  )}
                  <div className="ov-card">
                    <div className="ov-icon">🧾</div>
                    <div className="ov-title">工单</div>
                    <div className="ov-desc">处理客户请求</div>
                    <button className="btn slim">进入</button>
                  </div>
                  {/* 版本状态面板 */}
                  <VersionPanel />
                </div>
              </>
            )}

            {active === 'content-news' && (
              <NewsManage />
            )}
            {active === 'content-inst' && (
              <InstitutionManage />
            )}

            {active === "users" && (
              <div className="card flat">
                <h1 className="title">用户管理</h1>
                <div className="sub-actions" style={{ justifyContent: 'flex-start', gap: 8 }}>
                  <button className={`btn ${usersTab === 'list' ? 'primary' : ''}`} onClick={() => setUsersTab('list')}>用户列表</button>
                  <button className={`btn ${usersTab === 'my' ? 'primary' : ''}`} onClick={() => setUsersTab('my')}>我的用户</button>
                  <button className={`btn ${usersTab === 'kyc' ? 'primary' : ''}`} onClick={() => setUsersTab('kyc')}>实名认证审核</button>
                </div>
                {usersTab === 'list' && (
                  <>
                    <div className="form admin-form-compact" style={{ marginTop: 10 }}>
                      <label className="label">搜索</label>
                      <input className="input" placeholder={"输入姓名或手机号"} value={q} onChange={e => setQ(e.target.value)} />
                      <label className="label">归属</label>
                      <select className="input" value={assignFilter} onChange={e => setAssignFilter(e.target.value)}>
                        <option value="all">全部</option>
                        <option value="assigned">已归属</option>
                        <option value="unassigned">未归属</option>
                      </select>
                      <div className="sub-actions" style={{ justifyContent: 'flex-start', gap: 8, marginTop: 8 }}>
                        <button className="btn" onClick={() => { setUsersPage(1); refreshUsers(); }}>查询</button>
                        <button className="btn" onClick={() => { setQ(''); setAssignFilter('all'); setUsersPage(1); refreshUsers(); }}>重置</button>
                      </div>
                    </div>

                    <div style={{ marginTop: 14 }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ textAlign: "left" }}>
                            <th style={{ padding: "8px 6px" }}>姓名</th>
                            <th style={{ padding: "8px 6px" }}>手机号</th>
                            <th style={{ padding: "8px 6px" }}>归属运营</th>
                            <th style={{ padding: "8px 6px" }}>归属管理</th>
                            <th style={{ padding: "8px 6px" }}>登录IP</th>
                            <th style={{ padding: "8px 6px" }}>国家</th>
                            <th style={{ padding: "8px 6px" }}>资金</th>
                            <th style={{ padding: "8px 6px" }}>操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {customerList.map(u => (
                            <tr key={u.id} style={{ borderTop: "1px solid #263b5e" }}>
                              <td style={{ padding: "8px 6px" }}>{u.name}</td>
                              <td style={{ padding: "8px 6px" }}>{u.phone}</td>
                              <td style={{ padding: "8px 6px" }}>
                                {u.assignedOperatorId
                                  ? (staffList.find(o => Number(o.id) === Number(u.assignedOperatorId || 0))?.account || staffList.find(o => Number(o.id) === Number(u.assignedOperatorId || 0))?.name || staffList.find(o => Number(o.id) === Number(u.assignedOperatorId || 0))?.phone || "运营")
                                  : "未归属"}
                              </td>
                              <td style={{ padding: "8px 6px" }}>
                                {(() => {
                                  const op = staffList.find(o => Number(o.id) === Number(u.assignedOperatorId || 0));
                                  const aid = u.assignedAdminId || (op ? (op.admin_id ?? op.adminId) : null);
                                  const adm = staffList.find(a => a.role === 'admin' && Number(a.id) === Number(aid || 0));
                                  return adm ? (adm.account || adm.name || adm.phone || '-') : '-';
                                })()}
                              </td>
                              <td style={{ padding: "8px 6px" }}>{u.lastLoginIp || '-'}</td>
                              <td style={{ padding: "8px 6px" }}>{u.country || '-'}</td>
                              <td style={{ padding: "8px 6px" }}>
                                <span className="chip">MXN {Number(u?.balances?.MXN || 0).toFixed(2)}</span>
                              </td>
                              <td style={{ padding: "8px 6px", position: 'relative' }}>
                                <div className="dropdown" style={{ display: 'inline-block' }} onClick={(e) => e.stopPropagation()}>
                                  <button
                                    className="btn primary"
                                    style={{ height: 32 }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setOpsOpenId((prev) => (prev === u.id ? null : u.id));
                                    }}
                                  >操作 ▾</button>
                                  {opsOpenId === u.id && (
                                    <div className="menu" style={{ position: 'absolute', zIndex: 5, background: '#0f213a', border: '1px solid #263b5e', borderRadius: 6, padding: 6, minWidth: 140 }}>
                                      <button className="btn slim" style={{ width: '100%' }} onClick={() => { setOpsOpenId(null); setSelectedUser(u); }}>详情</button>
                                      <button className="btn slim" style={{ width: '100%', marginTop: 6 }} onClick={() => { setOpsOpenId(null); setSelectedUser({ ...u, action: 'changePassword' }); }}>改登录密码</button>
                                      <button className="btn slim" style={{ width: '100%', marginTop: 6 }} onClick={() => { setOpsOpenId(null); setSelectedUser({ ...u, action: 'creditScore' }); }}>修改信用评分</button>

                                      <button className="btn slim" style={{ width: '100%', marginTop: 6 }} onClick={() => {
                                        if (!['admin', 'super'].includes(session?.role)) { alert('无权限'); return; }
                                        setOpsOpenId(null);
                                        setSelectedUser({ ...u, action: 'assign' });
                                      }}>改归属</button>
                                      {session?.role !== 'operator' && (
                                        <button className="btn slim" style={{ width: '100%', marginTop: 6 }} onClick={() => {
                                          if (!['admin', 'super'].includes(session?.role)) { alert('无权限'); return; }
                                          setOpsOpenId(null);
                                          setSelectedUser({ ...u, action: 'funds' });
                                        }}>修改账户资金</button>
                                      )}
                                      <button className="btn slim" style={{ width: '100%', marginTop: 6 }} onClick={() => {
                                        if (!['admin', 'super'].includes(session?.role)) { alert('无权限'); return; }
                                        setOpsOpenId(null);
                                        setShowKyc({ open: true, userId: u.id, user: u });
                                      }}>实名认证审核</button>
                                      <button className="btn slim" style={{ width: '100%', marginTop: 6 }} onClick={() => {
                                        if (!['admin', 'super'].includes(session?.role)) { alert('无权限'); return; }
                                        setOpsOpenId(null);
                                        setSelectedUser({ ...u, action: 'delete' });
                                      }}>删除账号</button>
                                      <button className="btn slim" style={{ width: '100%', marginTop: 6 }} onClick={async () => {
                                        if (!['admin', 'super', 'operator'].includes(session?.role)) { alert('无权限'); return; }
                                        try {
                                          const data = await api.post('/admin/impersonate', { userId: u.id });
                                          if (!data?.token) throw new Error('未返回令牌');
                                          // 跨域登录：打开新标签页并传递 token
                                          const url = `https://ecimapp.net/?token=${encodeURIComponent(data.token)}`;
                                          window.open(url, '_blank');
                                        } catch (e) {
                                          alert('代登录失败: ' + (e?.message || e));
                                        }
                                      }}>代登录</button>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                          {customerList.length === 0 && (
                            <tr>
                              <td colSpan={8} className="desc" style={{ padding: "10px 6px" }}>暂无数据</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                      <div className="sub-actions" style={{ justifyContent: 'space-between', marginTop: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="desc">每页</span>
                          <select className="input" value={usersPageSize} onChange={e => { setUsersPageSize(parseInt(e.target.value, 10)); setUsersPage(1); }}>
                            {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
                          </select>
                          <span className="desc">共 {usersTotal} 条</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <button className="btn" disabled={usersPage <= 1} onClick={() => setUsersPage(p => Math.max(1, p - 1))}>上一页</button>
                          <span className="desc">{usersPage} / {Math.max(1, Math.ceil((usersTotal || 0) / (usersPageSize || 20)))}</span>
                          <button className="btn" disabled={usersPage >= Math.max(1, Math.ceil((usersTotal || 0) / (usersPageSize || 20)))} onClick={() => setUsersPage(p => Math.min(Math.max(1, Math.ceil((usersTotal || 0) / (usersPageSize || 20))), p + 1))}>下一页</button>
                        </div>
                      </div>
                    </div>
                  </>
                )}
                {usersTab === 'my' && (
                  <>
                    <div style={{ marginTop: 14 }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ textAlign: "left" }}>
                            <th style={{ padding: "8px 6px" }}>姓名</th>
                            <th style={{ padding: "8px 6px" }}>手机号</th>
                            <th style={{ padding: "8px 6px" }}>归属运营</th>
                            <th style={{ padding: "8px 6px" }}>归属管理</th>
                            <th style={{ padding: "8px 6px" }}>登录IP</th>
                            <th style={{ padding: "8px 6px" }}>国家</th>
                            <th style={{ padding: "8px 6px" }}>资金</th>
                            <th style={{ padding: "8px 6px" }}>操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {myCustomerList.map(u => (
                            <tr key={u.id} style={{ borderTop: "1px solid #263b5e" }}>
                              <td style={{ padding: "8px 6px" }}>{u.name}</td>
                              <td style={{ padding: "8px 6px" }}>{u.phone}</td>
                              <td style={{ padding: "8px 6px" }}>
                                {u.assignedOperatorId
                                  ? (allStaffList.find(o => Number(o.id) === Number(u.assignedOperatorId || 0))?.account || allStaffList.find(o => Number(o.id) === Number(u.assignedOperatorId || 0))?.name || allStaffList.find(o => Number(o.id) === Number(u.assignedOperatorId || 0))?.phone || '运营')
                                  : '-'}
                              </td>
                              <td style={{ padding: "8px 6px" }}>
                                {(() => {
                                  const op = allStaffList.find(o => Number(o.id) === Number(u.assignedOperatorId || 0));
                                  const aid = u.assignedAdminId || (op ? (op.admin_id ?? op.adminId) : null);
                                  const adm = allStaffList.find(a => a.role === 'admin' && Number(a.id) === Number(aid || 0));
                                  return adm ? (adm.account || adm.name || adm.phone || '-') : '-';
                                })()}
                              </td>
                              <td style={{ padding: "8px 6px" }}>{u.lastLoginIp || '-'}</td>
                              <td style={{ padding: "8px 6px" }}>{u.country || '-'}</td>
                              <td style={{ padding: "8px 6px" }}>
                                <span className="chip">MXN {Number(u?.balances?.MXN || 0).toFixed(2)}</span>
                              </td>
                              <td style={{ padding: "8px 6px", position: 'relative' }}>
                                <div className="dropdown" style={{ display: 'inline-block' }} onClick={(e) => e.stopPropagation()}>
                                  <button className="btn primary" style={{ height: 32 }} onClick={(e) => { e.stopPropagation(); setOpsOpenId((prev) => (prev === u.id ? null : u.id)); }}>操作 ▾</button>
                                  {opsOpenId === u.id && (
                                    <div className="menu" style={{ position: 'absolute', zIndex: 5, background: '#0f213a', border: '1px solid #263b5e', borderRadius: 6, padding: 6, minWidth: 140 }}>
                                      <button className="btn slim" style={{ width: '100%' }} onClick={() => { setOpsOpenId(null); setSelectedUser(u); }}>详情</button>
                                      <button className="btn slim" style={{ width: '100%', marginTop: 6 }} onClick={() => { setOpsOpenId(null); setSelectedUser({ ...u, action: 'changePassword' }); }}>改登录密码</button>
                                      <button className="btn slim" style={{ width: '100%', marginTop: 6 }} onClick={() => { setOpsOpenId(null); setSelectedUser({ ...u, action: 'creditScore' }); }}>修改信用评分</button>
                                      {session?.role !== 'operator' && (
                                        <button className="btn slim" style={{ width: '100%', marginTop: 6 }} onClick={() => { setOpsOpenId(null); setSelectedUser({ ...u, action: 'funds' }); }}>修改账户资金</button>
                                      )}

                                      <button className="btn slim" style={{ width: '100%', marginTop: 6 }} onClick={async () => {
                                        if (!['admin', 'super', 'operator'].includes(session?.role)) { alert('无权限'); return; }
                                        try {
                                          const data = await api.post('/admin/impersonate', { userId: u.id });
                                          if (!data?.token) throw new Error('未返回令牌');
                                          // 跨域登录：打开新标签页并传递 token
                                          const url = `https://ecimapp.net/?token=${encodeURIComponent(data.token)}`;
                                          window.open(url, '_blank');
                                        } catch (e) {
                                          alert('代登录失败: ' + (e?.message || e));
                                        }
                                      }}>代登录</button>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                          {myCustomerList.length === 0 && (
                            <tr>
                              <td colSpan={8} className="desc" style={{ padding: "10px 6px" }}>暂无数据</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
                {usersTab === 'kyc' && (
                  <KycReviewPage />
                )}
              </div>
            )}

            {active === "team" && (
              <div className="card">
                <div className="section-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <h1 className="title" style={{ margin: 0 }}>团队管理</h1>
                  <button className="btn slim" onClick={openAddModal}>添加</button>
                </div>
                {session?.role === "operator" ? (
                  <p className="desc">仅管理员/超管可访问该模块</p>
                ) : (
                  <>
                    <div className="form admin-form" style={{ marginTop: 10 }}>
                      <label className="label">搜索</label>
                      <input className="input" placeholder={"输入姓名或账号"} value={q} onChange={e => setQ(e.target.value)} />
                      <div className="sub-actions" style={{ justifyContent: 'flex-start', gap: 8, marginTop: 8 }}>
                        <button className="btn" onClick={() => { setStaffPage(1); refreshStaffs(); }}>查询</button>
                        <button className="btn" onClick={() => { setQ(''); setStaffPage(1); refreshStaffs(); }}>重置</button>
                      </div>
                    </div>
                    <div style={{ marginTop: 14 }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ textAlign: "left" }}>
                            <th style={{ padding: "8px 6px" }}>姓名</th>
                            <th style={{ padding: "8px 6px" }}>账号</th>
                            <th style={{ padding: "8px 6px" }}>角色</th>
                            <th style={{ padding: "8px 6px" }}>隶属管理员</th>
                            <th style={{ padding: "8px 6px" }}>操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {staffList.map(u => (
                            <tr key={u.id} style={{ borderTop: "1px solid #263b5e" }}>
                              <td style={{ padding: "8px 6px" }}>{u.name}</td>
                              <td style={{ padding: "8px 6px" }}>{u.account || u.phone || "-"}</td>
                              <td style={{ padding: "8px 6px" }}>{u.role === "admin" ? "管理员" : u.role === "operator" ? "运营" : "超级管理员"}</td>
                              <td style={{ padding: "8px 6px" }}>{u.role === "operator" ? (staffList.find(a => a.role === 'admin' && Number(a.id) === Number(u.admin_id || u.adminId))?.account || staffList.find(a => a.role === 'admin' && Number(a.id) === Number(u.admin_id || u.adminId))?.name || "-") : "-"}</td>
                              <td style={{ padding: "8px 6px" }}>
                                <button className="btn" onClick={() => setStaffOpsOpenId(staffOpsOpenId === u.id ? null : u.id)}>操作</button>
                                {staffOpsOpenId === u.id && (
                                  <div className="card" style={{ position: 'absolute', zIndex: 10, padding: 8, width: 220, right: 0 }}>
                                    <button className="btn slim" style={{ width: '100%' }} onClick={() => { setStaffOpsOpenId(null); openStaffEdit(u); }}>编辑</button>
                                    <button className="btn slim" style={{ width: '100%', marginTop: 6 }} onClick={() => { setStaffOpsOpenId(null); changePassword(u); }}>修改登录密码</button>
                                    {u.role !== 'super' && (
                                      <button className="btn slim" style={{ width: '100%', marginTop: 6 }} onClick={() => { setStaffOpsOpenId(null); toggleLogin(u); }}>{Number(u.disabled || 0) === 1 ? '解除限制' : '限制登录'}</button>
                                    )}
                                    {u.role !== 'super' && u.id !== session?.id && (
                                      <button className="btn slim danger" style={{ width: '100%', marginTop: 6 }} onClick={() => { setStaffOpsOpenId(null); onDeleteStaff(u); }}>删除</button>
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))}
                          {staffList.length === 0 && (
                            <tr>
                              <td colSpan={5} className="desc" style={{ padding: "10px 6px" }}>暂无数据</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                      <div className="sub-actions" style={{ justifyContent: 'space-between', marginTop: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="desc">每页</span>
                          <select className="input" value={staffPageSize} onChange={e => { setStaffPageSize(parseInt(e.target.value, 10)); setStaffPage(1); }}>
                            {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
                          </select>
                          <span className="desc">共 {staffBackend.total} 条</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <button className="btn" disabled={staffPage <= 1} onClick={() => setStaffPage(p => Math.max(1, p - 1))}>上一页</button>
                          <span className="desc">{staffPage} / {Math.max(1, Math.ceil((staffBackend.total || 0) / (staffPageSize || 20)))}</span>
                          <button className="btn" disabled={staffPage >= Math.max(1, Math.ceil((staffBackend.total || 0) / (staffPageSize || 20)))} onClick={() => setStaffPage(p => Math.min(Math.max(1, Math.ceil((staffBackend.total || 0) / (staffPageSize || 20))), p + 1))}>下一页</button>
                        </div>
                      </div>
                    </div>

                    {/* 原内联创建表单已改为弹窗方式，收敛此块 */}
                  </>
                )}
              </div>
            )}

            {/* 用户持仓页面 */}
            {active === "positions" && (
              <PositionsPage session={session} />
            )}

            {/* 交易设置：大宗交易 */}
            {active === "trade-block" && (
              <BlockTradesAdmin session={session} />
            )}

            {/* 交易设置：基金 */}
            {active === "trade-fund" && (
              <FundAdmin session={session} />
            )}

            {/* 交易设置：新股/实物资产 */}
            {active === "trade-ipo" && (
              <IpoRwaAdmin session={session} />
            )}

            {/* 资金管理：账户充值 */}
            {active === "funds-recharge" && (
              <RechargePage />
            )}

            {/* 资金管理：资金明细 */}
            {active === "funds-logs" && (
              <BalanceLogsPage />
            )}

            {/* 资金管理：用户提现 */}
            {active === "funds-withdraws" && (
              <AdminWithdraws embedded={true} />
            )}

            {/* 资金管理：信用金审核 */}
            {active === "funds-credit" && (
              <div className="card flat">
                <h1 className="title">信用金审核</h1>
                <div className="form admin-form-compact" style={{ marginTop: 10 }}>
                  <label className="label">搜索</label>
                  <input className="input" placeholder={"输入姓名或手机号"} value={creditQ} onChange={e => setCreditQ(e.target.value)} />
                  <label className="label">状态</label>
                  <select className="input" value={creditStatus} onChange={e => setCreditStatus(e.target.value)}>
                    <option value="all">全部</option>
                    <option value="pending">待审核</option>
                    <option value="approved">已批准</option>
                    <option value="rejected">已拒绝</option>
                    <option value="done">已完成</option>
                  </select>
                  <div className="sub-actions" style={{ justifyContent: 'flex-start', gap: 8, marginTop: 8 }}>
                    <button className="btn" onClick={() => { setCreditPage(1); refreshCreditApps(); }}>查询</button>
                    <button className="btn" onClick={() => { setCreditQ(''); setCreditStatus('all'); setCreditPage(1); refreshCreditApps(); }}>重置</button>
                  </div>
                </div>
                <div style={{ marginTop: 14 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ textAlign: 'left' }}>
                        <th style={{ padding: '8px 6px' }}>姓名</th>
                        <th style={{ padding: '8px 6px' }}>手机号</th>
                        <th style={{ padding: '8px 6px' }}>地址</th>
                        <th style={{ padding: '8px 6px' }}>金额(MXN)</th>
                        <th style={{ padding: '8px 6px' }}>信用分</th>
                        <th style={{ padding: '8px 6px' }}>状态</th>
                        <th style={{ padding: '8px 6px' }}>提交时间</th>
                        <th style={{ padding: '8px 6px' }}>申请期限</th>
                        <th style={{ padding: '8px 6px' }}>图片</th>
                        <th style={{ padding: '8px 6px' }}>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(creditList || []).map(app => (
                        <tr key={app.id} style={{ borderTop: '1px solid #263b5e' }}>
                          <td style={{ padding: '8px 6px' }}>{app.name}</td>
                          <td style={{ padding: '8px 6px' }}>{app.phone}</td>
                          <td style={{ padding: '8px 6px' }}>{app.address} {app.city} {app.state} {app.zip}</td>
                          <td style={{ padding: '8px 6px' }}>{Number(app.amount || 0)}</td>
                          <td style={{ padding: '8px 6px' }}>{Number(app.score || 0)}</td>
                          <td style={{ padding: '8px 6px' }}>{String(app.status || 'pending')}</td>
                          <td style={{ padding: '8px 6px' }}>{new Date(app.ts || Date.now()).toLocaleString()}</td>
                          <td style={{ padding: '8px 6px' }}>{Number(app.periodValue || 0)}{String(app.periodUnit || 'day') === 'year' ? '年' : (String(app.periodUnit || 'day') === 'month' ? '月' : '天')}</td>
                          <td style={{ padding: '8px 6px' }}>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {(Array.isArray(app.images) ? app.images : []).slice(0, 4).map((im, idx) => (
                                <img key={idx} src={im?.data || im} alt="proof" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6, border: '1px solid #263b5e', cursor: 'pointer' }} onClick={() => previewImages(app, idx)} />
                              ))}
                              {(!app.images || app.images.length === 0) ? (<span className="desc">无</span>) : null}
                            </div>
                          </td>
                          <td style={{ padding: '8px 6px' }}>
                            {isSuper && String(app.status || 'pending') === 'pending' ? (
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button className="btn primary" disabled={creditApproving} onClick={() => approveCredit(app)}>批准</button>
                                <button className="btn" disabled={creditApproving} onClick={() => rejectCredit(app)}>拒绝</button>
                              </div>
                            ) : (
                              <div className="desc">{String(app.status || 'pending') === 'done' ? '已完成' : (String(app.status || 'pending') === 'rejected' ? '已拒绝' : (isSuper ? '待处理' : '无审批权限'))}</div>
                            )}
                          </td>
                        </tr>
                      ))}
                      {(creditList || []).length === 0 && (
                        <tr><td className="desc" colSpan={10}>{creditApiSupported ? '--' : '后端未提供接口，显示本地提交为空'}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {imgPreview.open && (
                  <div className="modal" style={{ display: 'grid', placeItems: 'center' }} onClick={() => setImgPreview({ open: false, imgs: [], index: 0 })}>
                    <div className="modal-card" style={{ maxWidth: 820, marginTop: 0 }} onClick={(e) => e.stopPropagation()}>
                      <h2 className="title" style={{ marginTop: 0 }}>材料预览</h2>
                      <div style={{ display: 'grid', gap: 10 }}>
                        <img src={imgPreview.imgs[imgPreview.index]} alt="proof" style={{ width: '100%', maxHeight: 540, objectFit: 'contain', borderRadius: 8, border: '1px solid #263b5e' }} />
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {imgPreview.imgs.map((u, i) => (
                            <img key={i} src={u} alt={`thumb-${i}`} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6, border: i === imgPreview.index ? '2px solid #4aa3ff' : '1px solid #263b5e', cursor: 'pointer' }} onClick={() => setImgPreview(p => ({ ...p, index: i }))} />
                          ))}
                        </div>
                        <div className="sub-actions" style={{ justifyContent: 'flex-end', gap: 8 }}>
                          <button className="btn" onClick={() => setImgPreview(p => ({ ...p, index: Math.max(0, p.index - 1) }))}>上一张</button>
                          <button className="btn" onClick={() => setImgPreview(p => ({ ...p, index: Math.min(p.imgs.length - 1, p.index + 1) }))}>下一张</button>
                          <button className="btn" onClick={() => setImgPreview({ open: false, imgs: [], index: 0 })}>关闭</button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 系统设置：交易时间限制 */}
            {active === "settings-trading" && (
              <SettingsTrading />
            )}
            {active === "settings-invite" && (
              <InviteSettings />
            )}
            {active === "invite-commissions" && (
              <InviteCommissions />
            )}

            {/* 统一的弹窗详情 */}
            {selectedUser && (
              <div className="modal">
                <div className="modal-card">
                  <h2 className="title" style={{ marginTop: 0 }}>详情</h2>
                  <div className="form">
                    <label className="label">姓名</label>
                    <input className="input" value={selectedUser.name || ""} readOnly />

                    {selectedUser.role === "customer" ? (
                      <>
                        <label className="label">手机号</label>
                        <input className="input" value={selectedUser.phone || ""} readOnly />
                      </>
                    ) : (
                      <>
                        <label className="label">账号</label>
                        <input className="input" value={selectedUser.account || selectedUser.phone || ""} readOnly />
                      </>
                    )}

                    <label className="label">角色</label>
                    <input className="input" value={selectedUser.role === "customer" ? "客户" : selectedUser.role === "operator" ? "运营" : selectedUser.role === "admin" ? "管理员" : "超级管理员"} readOnly />

                    {selectedUser.action === 'changePassword' && (
                      <>
                        <label className="label">修改密码</label>
                        <input className="input" type="password" placeholder={"输入新密码（≥6位）"} value={newPassword} onChange={e => setNewPassword(e.target.value)} />
                      </>
                    )}



                    {selectedUser.action === 'assign' && (
                      <>
                        <label className="label">选择管理员</label>
                        <select className="input" value={assignAdminId || ''} onChange={e => setAssignAdminId(e.target.value || null)}>
                          <option value="">未指定</option>
                          {allStaffList.filter(a => a.role === 'admin').map(a => (
                            <option key={a.id} value={a.id}>{a.account || a.name || a.phone}</option>
                          ))}
                        </select>
                        <label className="label">选择运营</label>
                        <select className="input" value={assignOperatorId || ''} onChange={e => { const id = e.target.value || ''; setAssignOperatorId(id || null); const op = allStaffList.find(o => Number(o.id) === Number(id)); const aid = Number(op && (op.admin_id ?? op.adminId) || 0); if (aid) setAssignAdminId(String(aid)); }}>
                          <option value="">未指定</option>
                          {allStaffList.filter(o => o.role === 'operator' && (!assignAdminId || Number(o.admin_id || o.adminId || 0) === Number(assignAdminId))).map(o => (
                            <option key={o.id} value={o.id}>{o.account || o.name || o.phone}</option>
                          ))}
                        </select>
                      </>
                    )}

                    {selectedUser.action === 'funds' && (
                      <>
                        <label className="label">资金调整</label>
                        <div className="desc">输入正数为增加资金，输入负数为减少资金（如：-100）</div>
                        {fundOps.map((row, idx) => (
                          <div key={idx} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 80px', gap: 8, alignItems: 'center', marginTop: 8 }}>
                            <select className="input" value={row.currency} onChange={e => updateFundRow(idx, { currency: e.target.value })}>
                              <option value="MXN">MXN</option>
                              <option value="USD">USD</option>
                              <option value="USDT">USDT</option>
                            </select>
                            <input className="input" placeholder="金额（可正负，最多两位小数）" value={row.amount} onChange={e => updateFundRow(idx, { amount: e.target.value })} />
                            <button className="btn" onClick={() => removeFundRow(idx)}>移除</button>
                          </div>
                        ))}
                        <div className="sub-actions" style={{ justifyContent: 'flex-start', gap: 8, marginTop: 8 }}>
                          <button className="btn" onClick={addFundRow}>添加币种</button>
                        </div>
                        <label className="label">备注</label>
                        <input className="input" placeholder="原因/备注（可选）" value={fundReason} onChange={e => setFundReason(e.target.value)} />
                      </>
                    )}

                    {selectedUser.action === 'creditScore' && (
                      <>
                        <label className="label">信用评分</label>
                        <input className="input" type="number" min={0} max={1000} value={String(selectedUser.credit_score ?? selectedUser.creditScore ?? '')}
                          onChange={e => setSelectedUser(prev => ({ ...prev, credit_score: e.target.value }))} placeholder="0-1000" />
                      </>
                    )}

                    <div className="sub-actions" style={{ justifyContent: "flex-end", gap: 10 }}>
                      <button className="btn" style={{ height: 36 }} onClick={closeDetails}>取消</button>
                      {selectedUser.action === 'changePassword' && <button className="btn primary" style={{ height: 36 }} onClick={onSavePassword}>保存</button>}

                      {selectedUser.action === 'assign' && <button className="btn primary" style={{ height: 36 }} onClick={() => {
                        if (!getToken()) { alert('请先登录后台'); return; }
                        let oid = assignOperatorId || null;
                        let aid = assignAdminId || null;
                        if (session?.role === 'operator') {
                          const sid = Number(session?.id || session?.userId || 0);
                          oid = sid; aid = null;
                        }
                        if (!aid && oid) {
                          const op = allStaffList.find(o => Number(o.id) === Number(oid));
                          const autoA = Number(op && (op.admin_id ?? op.adminId) || 0);
                          if (autoA) aid = String(autoA);
                        }
                        api.post(`/admin/users/${selectedUser.id}/assign`, { operatorId: oid || null, adminId: aid || null })
                          .then(() => {
                            alert('已更新归属');
                            setBackendUsers(prev => prev.map(u => u.id === selectedUser.id ? { ...u, assigned_operator_id: oid || null, assigned_admin_id: aid || null } : u));
                            closeDetails();
                          })
                          .catch(e => alert('更新失败: ' + (e?.message || e)));
                      }}>保存</button>}
                      {selectedUser.action === 'funds' && <button className="btn primary" style={{ height: 36 }} onClick={() => { if (!getToken()) { alert('请先登录后台'); return; } if (session?.role === 'operator') { const sid = Number(session?.id || session?.userId || 0); const oid = Number(selectedUser.assigned_operator_id || selectedUser.assignedOperatorId || 0); if (!sid || sid !== oid) { alert('该客户未归属到你，无法调整资金'); return; } } submitFunds(); }} disabled={submittingFunds}>{submittingFunds ? '提交中...' : '确认调整'}</button>}
                      {selectedUser.action === 'creditScore' && <button className="btn primary" style={{ height: 36 }} onClick={() => {
                        if (!getToken()) { alert('请先登录后台'); return; }
                        const v = Number(selectedUser.credit_score ?? selectedUser.creditScore);
                        if (!Number.isFinite(v)) { alert('请输入数字'); return; }
                        const val = Math.max(0, Math.min(1000, Math.round(v)));
                        if (session?.role === 'operator') { const sid = Number(session?.id || session?.userId || 0); const oid = Number(selectedUser.assigned_operator_id || selectedUser.assignedOperatorId || 0); if (!sid || sid !== oid) { alert('该客户未归属到你，无法修改信用评分'); return; } }
                        api.post(`/admin/users/${selectedUser.id}/credit_score`, { score: val })
                          .then(() => { alert('已更新信用评分'); setBackendUsers(prev => prev.map(u => u.id === selectedUser.id ? { ...u, credit_score: val } : u)); closeDetails(); })
                          .catch(e => alert('更新失败: ' + (e?.message || e)));
                      }}>保存</button>}
                      {selectedUser.action === 'delete' && <button className="btn primary" style={{ height: 36 }} onClick={() => {
                        if (!getToken()) { alert('请先登录后台'); return; }
                        if (session?.role === 'operator') { const sid = Number(session?.id || session?.userId || 0); const oid = Number(selectedUser.assigned_operator_id || selectedUser.assignedOperatorId || 0); if (!sid || sid !== oid) { alert('该客户未归属到你，无法删除'); return; } }
                        if (!confirm('确认删除该用户？')) return;
                        api.delete(`/admin/users/${selectedUser.id}`).then(() => {
                          alert('已删除用户');
                          setBackendUsers(prev => prev.filter(u => u.id !== selectedUser.id));
                          closeDetails();
                        }).catch(e => alert('删除失败: ' + (e?.message || e)));
                      }}>删除</button>}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* KYC 审核弹窗 */}
            {showKyc.open && (
              <KycReviewModal open={showKyc.open} onClose={() => setShowKyc({ open: false, userId: null, user: null })} user={showKyc.user} />
            )}

            {/* 创建后台账号弹窗 */}
            {showAddModal && (
              <div className="modal">
                <div className="modal-card">
                  <h2 className="title" style={{ marginTop: 0 }}>创建后台账号</h2>
                  <div className="form">
                    {session?.role === "admin" ? (
                      <>
                        <label className="label">角色</label>
                        <input className="input" value={"运营"} readOnly />
                        {/* 管理员创建的运营默认归属当前管理员，无需选择 */}
                      </>
                    ) : (
                      <>
                        <label className="label">角色</label>
                        <select className="input" value={addRole} onChange={e => setAddRole(e.target.value)}>
                          <option value="admin">管理员</option>
                          <option value="operator">运营</option>
                        </select>

                        {addRole === "operator" && (
                          <>
                            <label className="label">隶属管理员</label>
                            <select className="input" value={addAdminId || ""} onChange={e => setAddAdminId(e.target.value || null)}>
                              <option value="">未指定</option>
                              {allStaffList.filter(a => a.role === 'admin').map(a => (
                                <option key={a.id} value={a.id}>{a.account || a.name || a.phone}</option>
                              ))}
                            </select>
                          </>
                        )}
                      </>
                    )}

                    <label className="label">姓名</label>
                    <input className="input" value={addName} onChange={e => setAddName(e.target.value)} />
                    <label className="label">账号</label>
                    <input className="input" value={addAccount} onChange={e => setAddAccount(e.target.value)} placeholder="例如 admin001" />
                    <label className="label">密码</label>
                    <input className="input" type="password" value={addPassword} onChange={e => setAddPassword(e.target.value)} />

                    <div className="sub-actions" style={{ justifyContent: "flex-end", gap: 10 }}>
                      <button className="btn" style={{ height: 36 }} onClick={closeAddModal}>取消</button>
                      <button className="btn primary" style={{ height: 36 }} onClick={submitAdd}>创建</button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 删除确认弹窗 */}
            {showDelModal && (
              <div className="modal">
                <div className="modal-card">
                  <h2 className="title" style={{ marginTop: 0 }}>确认删除</h2>
                  <div className="form">
                    <div className="desc">将删除该后台账号：{delUser?.name || delUser?.account || delUser?.phone}</div>
                    <div className="sub-actions" style={{ justifyContent: "flex-end", gap: 10 }}>
                      <button className="btn" style={{ height: 36 }} onClick={closeDelModal}>取消</button>
                      <button className="btn primary" style={{ height: 36 }} onClick={confirmDeleteStaff}>删除</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {showStaffEdit && (
              <div className="modal">
                <div className="modal-card">
                  <h2 className="title" style={{ marginTop: 0 }}>编辑后台账号</h2>
                  <div className="form">
                    <label className="label">姓名</label>
                    <input className="input" value={editName} onChange={e => setEditName(e.target.value)} />
                    <label className="label">账号</label>
                    <input className="input" value={editAccount} onChange={e => setEditAccount(e.target.value)} />
                    <label className="label">登录密码</label>
                    <input className="input" type="password" value={editPassword} onChange={e => setEditPassword(e.target.value)} placeholder="留空则不修改" />
                    {editUser?.role === 'operator' && (
                      <>
                        <label className="label">隶属管理员</label>
                        <select className="input" value={editAdminId} onChange={e => setEditAdminId(e.target.value)}>
                          <option value="">未指定</option>
                          {allStaffList.filter(a => a.role === 'admin').map(a => (
                            <option key={a.id} value={a.id}>{a.account || a.name}</option>
                          ))}
                        </select>
                      </>
                    )}
                    <div className="sub-actions" style={{ justifyContent: 'flex-end', gap: 10 }}>
                      <button className="btn" onClick={() => setShowStaffEdit(false)}>取消</button>
                      <button className="btn primary" onClick={submitStaffEdit}>保存</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function SettingsTrading() {
  const [mxEnabled, setMxEnabled] = useState(true);
  const [usEnabled, setUsEnabled] = useState(true);
  const [mxDates, setMxDates] = useState('');
  const [usDates, setUsDates] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let stopped = false;
    const run = async () => {
      setLoading(true);
      try {
        const trySilent = async () => {
          try {
            const lastRaw = localStorage.getItem('auth:last') || '{}';
            const last = JSON.parse(lastRaw);
            const acc = String(last?.account || last?.phone || '').trim();
            const pwd = String(last?.password || '').trim();
            if (acc && pwd) { await loginAdminApi({ account: acc, password: pwd }); }
          } catch { }
        };
        let s;
        try { s = await api.get('/admin/settings/trading'); }
        catch (e) { if (String(e?.message || '').toLowerCase().includes('unauthorized')) { await trySilent(); s = await api.get('/admin/settings/trading'); } else { throw e; } }
        if (stopped) return;
        setMxEnabled(Boolean(s?.mxEnabled ?? true));
        setUsEnabled(Boolean(s?.usEnabled ?? true));
        setMxDates(String(s?.mxHolidays || ''));
        setUsDates(String(s?.usHolidays || ''));
      } catch { }
      finally { setLoading(false); }
    };
    run();
    return () => { stopped = true; };
  }, []);
  const save = async () => {
    setSaving(true);
    try {
      await api.post('/admin/settings/trading', { mxEnabled, usEnabled, mxHolidays: mxDates, usHolidays: usDates });
      alert('已保存');
    } catch (e) { alert('保存失败: ' + (e?.message || e)); }
    finally { setSaving(false); }
  };
  return (
    <div className="card flat" style={{ maxWidth: 900 }}>
      <h2 className="title">交易时间限制</h2>
      <div className="desc" style={{ marginBottom: 12 }}>时间窗口：周一至周五 08:30–15:00（按墨西哥本地时间）。输入节假日（YYYY-MM-DD，逗号或空格分隔）可完全禁止交易。</div>
      <div className="form admin-form-compact">
        <label className="label">墨西哥市场</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 12, alignItems: 'center' }}>
          <label className="switch"><input type="checkbox" checked={mxEnabled} onChange={e => setMxEnabled(e.target.checked)} /><span>开启限制</span></label>
          <input className="input" placeholder="节假日（例如 2025-03-03 2025-03-04）" value={mxDates} onChange={e => setMxDates(e.target.value)} />
        </div>
        <label className="label" style={{ marginTop: 16 }}>美国市场</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 12, alignItems: 'center' }}>
          <label className="switch"><input type="checkbox" checked={usEnabled} onChange={e => setUsEnabled(e.target.checked)} /><span>开启限制</span></label>
          <input className="input" placeholder="节假日（例如 2025-03-03 2025-03-04）" value={usDates} onChange={e => setUsDates(e.target.value)} />
        </div>
        <div style={{ marginTop: 16 }}>
          <button className="btn primary" disabled={saving || loading} onClick={save}>保存</button>
        </div>
      </div>
    </div>
  );
}

function InviteSettings() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ blockPct: 5, blockFreezeDays: 3, fundPct: 5, fundFreezeDays: 3, ipoPct: 5, ipoFreezeDays: 3 });
  const load = async () => { try { setLoading(true); const s = await api.get('/admin/settings/invite'); setForm({ blockPct: Number(s?.blockPct || 0), blockFreezeDays: Number(s?.blockFreezeDays || 0), fundPct: Number(s?.fundPct || 0), fundFreezeDays: Number(s?.fundFreezeDays || 0), ipoPct: Number(s?.ipoPct || 0), ipoFreezeDays: Number(s?.ipoFreezeDays || 0) }); } catch (e) { setError(String(e?.message || e)); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);
  const save = async () => { try { setLoading(true); setError(''); await api.post('/admin/settings/invite', form); alert('已保存'); } catch (e) { const msg = String(e?.message || e); if (/unauthorized|forbidden|csrf/i.test(msg)) setError('请先登录管理员或超级管理员，再保存设置'); else setError(msg || '保存失败'); } finally { setLoading(false); } };
  return (
    <div className="card flat">
      <h1 className="title">邀请系统设置</h1>
      <div className="form admin-form-compact" style={{ marginTop: 10 }}>
        <label className="label">大宗交易佣金比例 (%)</label>
        <input className="input" value={form.blockPct} onChange={e => setForm(f => ({ ...f, blockPct: Number(e.target.value || 0) }))} />
        <label className="label">大宗交易佣金冻结时间 (天)</label>
        <input className="input" value={form.blockFreezeDays} onChange={e => setForm(f => ({ ...f, blockFreezeDays: Number(e.target.value || 0) }))} />
        <label className="label">基金佣金比例 (%)</label>
        <input className="input" value={form.fundPct} onChange={e => setForm(f => ({ ...f, fundPct: Number(e.target.value || 0) }))} />
        <label className="label">基金佣金冻结时间 (天)</label>
        <input className="input" value={form.fundFreezeDays} onChange={e => setForm(f => ({ ...f, fundFreezeDays: Number(e.target.value || 0) }))} />
        <label className="label">IPO佣金比例 (%)</label>
        <input className="input" value={form.ipoPct} onChange={e => setForm(f => ({ ...f, ipoPct: Number(e.target.value || 0) }))} />
        <label className="label">IPO佣金冻结时间 (天)</label>
        <input className="input" value={form.ipoFreezeDays} onChange={e => setForm(f => ({ ...f, ipoFreezeDays: Number(e.target.value || 0) }))} />
        <div className="sub-actions" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" onClick={load} disabled={loading}>{loading ? '加载中…' : '重载'}</button>
          <button className="btn primary" onClick={save} disabled={loading}>{loading ? '保存中…' : '保存'}</button>
        </div>
        {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
      </div>
    </div>
  );
}

function InviteCommissions() {
  const [list, setList] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [status, setStatus] = useState('');
  const [currency, setCurrency] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const fetchList = async () => {
    try {
      setLoading(true);
      const sp = new URLSearchParams();
      if (status) sp.set('status', status);
      if (currency) sp.set('currency', currency);
      if (q.trim()) sp.set('q', q.trim());
      sp.set('page', String(page));
      sp.set('pageSize', String(pageSize));
      const data = await api.get(`/admin/invite/commissions?${sp.toString()}`);
      setList(Array.isArray(data?.items) ? data.items : []);
      setTotal(Number(data?.total || 0));
    } catch (e) { setList([]); setTotal(0); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetchList(); }, [page, pageSize]);
  return (
    <div className="card flat">
      <h1 className="title">邀请佣金记录</h1>
      <div className="sub-actions" style={{ gap: 8 }}>
        <select className="input" value={status} onChange={e => setStatus(e.target.value)} style={{ maxWidth: 160 }}>
          <option value="">全部状态</option>
          <option value="frozen">冻结中</option>
          <option value="released">已解冻</option>
        </select>
        <select className="input" value={currency} onChange={e => setCurrency(e.target.value)} style={{ maxWidth: 160 }}>
          <option value="">全部币种</option>
          <option value="MXN">MXN</option>
          <option value="USD">USD</option>
          <option value="USDT">USDT</option>
        </select>
        <input className="input" placeholder="搜索姓名/手机号" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 220 }} />
        <button className="btn" onClick={() => { setPage(1); fetchList(); }}>{loading ? '查询中…' : '查询'}</button>
      </div>
      <div style={{ marginTop: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th style={{ padding: '8px 6px' }}>邀请人</th>
              <th style={{ padding: '8px 6px' }}>好友</th>
              <th style={{ padding: '8px 6px' }}>来源</th>
              <th style={{ padding: '8px 6px' }}>币种</th>
              <th style={{ padding: '8px 6px' }}>金额</th>
              <th style={{ padding: '8px 6px' }}>状态</th>
              <th style={{ padding: '8px 6px' }}>剩余冻结</th>
              <th style={{ padding: '8px 6px' }}>创建时间</th>
              <th style={{ padding: '8px 6px' }}>解冻时间</th>
            </tr>
          </thead>
          <tbody>
            {list.map(r => (
              <tr key={r.id} style={{ borderTop: '1px solid #263b5e' }}>
                <td style={{ padding: '8px 6px' }}>{r.inviterName || r.inviterPhone || r.inviterId}</td>
                <td style={{ padding: '8px 6px' }}>{r.inviteeName || r.inviteePhoneMasked || r.inviteeId}</td>
                <td style={{ padding: '8px 6px' }}>{r.source}</td>
                <td style={{ padding: '8px 6px' }}>{r.currency}</td>
                <td style={{ padding: '8px 6px' }}>{Number(r.amount || 0).toFixed(2)}</td>
                <td style={{ padding: '8px 6px' }}>{r.status === 'frozen' ? '冻结中' : '已解冻'}</td>
                <td style={{ padding: '8px 6px' }}>{r.status === 'frozen' ? Math.ceil((r.remain_ms || 0) / 60000) + '分' : '—'}</td>
                <td style={{ padding: '8px 6px' }}>{r.created_at}</td>
                <td style={{ padding: '8px 6px' }}>{r.released_at || '—'}</td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={9} className="desc" style={{ padding: '10px 6px' }}>{loading ? '加载中…' : '暂无数据'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="sub-actions" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
        <button className="btn" onClick={() => setPage(p => Math.max(1, p - 1))}>上一页</button>
        <div className="desc">{page} / {Math.max(1, Math.ceil(total / pageSize))}</div>
        <button className="btn" onClick={() => setPage(p => p + 1)} disabled={page >= Math.ceil(total / pageSize)}>下一页</button>
      </div>
    </div>
  );
}

// 版本状态组件：展示后端版本与前端资源版本
function VersionPanel() {
  const [status, setStatus] = useState({ api: null, assets: [], build: null, ts: null, origin: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const refresh = async () => {
    try {
      setLoading(true); setError('');
      const data = await api.get('/version');
      setStatus({
        api: data?.api || null,
        assets: Array.isArray(data?.frontendAssets) ? data.frontendAssets : [],
        build: data?.build || null,
        ts: data?.ts || null,
        origin: data?.origin || null,
      });
    } catch (e) {
      setError(e?.message || '加载失败');
    } finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, []);
  const env = typeof location !== 'undefined' ? `${location.protocol}//${location.host}` : '';
  return (
    <div className="ov-card" style={{ gridColumn: 'span 2' }}>
      <div className="ov-icon">🔎</div>
      <div className="ov-title">版本状态： V {status?.api?.version || '1.0.1'}</div>
    </div>
  );
}

function BlockTradesAdmin({ session }) {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ market: 'us', symbol: '', startAt: '', endAt: '', price: '', minQty: '1', lockUntil: '', subscribeKey: '' });
  const [orderTab, setOrderTab] = useState('submitted');
  const [orders, setOrders] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [orderOpsOpenId, setOrderOpsOpenId] = useState(null);
  const [orderPhone, setOrderPhone] = useState('');
  const shortIso = (s) => (s ? String(s).replace(/:00\.000Z$/, '').replace(/\.\d+Z$/, 'Z') : '-');

  // 根据 URL 参数 orders=submitted|approved|rejected 预设订单标签
  useEffect(() => {
    try {
      const params = new URLSearchParams(typeof window !== 'undefined' ? (window.location.search || '') : '');
      const o = (params.get('orders') || '').trim();
      if (['submitted', 'approved', 'rejected'].includes(o)) {
        setOrderTab(o);
      }
    } catch { }
  }, []);

  // 本地回退工具：在后端不可用时，使用 localStorage 进行数据镜像
  // 移除所有本地镜像相关常量与回退逻辑，统一仅读后端DB

  // 已移除本地数据镜像工具，所有列表与订单均从后端读取

  // 日期时间选择弹窗（日期 + 时分秒）
  const [dtPicker, setDtPicker] = useState({ open: false, field: null, date: '', hour: '00', minute: '00', second: '00' });
  const pad2 = (n) => String(n).padStart(2, '0');
  const toLocalInput = (iso) => {
    try {
      if (!iso) return '';
      const d = new Date(iso);
      const y = d.getFullYear();
      const m = pad2(d.getMonth() + 1);
      const da = pad2(d.getDate());
      const h = pad2(d.getHours());
      const mi = pad2(d.getMinutes());
      const s = pad2(d.getSeconds());
      return `${y}-${m}-${da}T${h}:${mi}:${s}`;
    } catch { return ''; }
  };
  const fromLocalInputToISO = (local) => {
    try {
      if (!local) return '';
      const d = new Date(local);
      return d.toISOString();
    } catch { return ''; }
  };
  const splitLocal = (local) => {
    if (!local || !local.includes('T')) return { date: '', hour: '00', minute: '00', second: '00' };
    const [date, time] = local.split('T');
    const [h = '00', mi = '00', s = '00'] = (time || '').split(':');
    return { date, hour: pad2(h), minute: pad2(mi), second: pad2(s) };
  };
  const fromLocalPartsToISO = (date, hour, minute, second) => {
    if (!date) return '';
    const local = `${date}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}`;
    return fromLocalInputToISO(local);
  };
  const openDt = (field) => {
    const local = toLocalInput(form[field]);
    const parts = splitLocal(local);
    setDtPicker({ open: true, field, ...parts });
  };
  const closeDt = () => setDtPicker({ open: false, field: null, date: '', hour: '00', minute: '00', second: '00' });
  const confirmDt = () => {
    if (!dtPicker.field || !dtPicker.date) return closeDt();
    const iso = fromLocalPartsToISO(dtPicker.date, dtPicker.hour, dtPicker.minute, dtPicker.second);
    setForm(f => ({ ...f, [dtPicker.field]: iso }));
    closeDt();
  };

  const fetchList = async () => {
    try {
      setLoading(true);
      const url = q.trim() ? `/admin/trade/block/list?q=${encodeURIComponent(q.trim())}` : '/admin/trade/block/list';
      const data = await api.get(url);
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (e) {
      console.warn('加载大宗交易列表失败（后端不可用）', e);
      setItems([]);
    } finally { setLoading(false); }
  };
  useEffect(() => { fetchList(); }, []);
  const fetchOrders = async () => {
    try {
      const p = new URLSearchParams();
      if (orderTab) p.set('status', orderTab);
      if (orderPhone.trim()) p.set('phone', orderPhone.trim());
      try {
        const sess = JSON.parse(localStorage.getItem('sessionUser') || '{}');
        if (sess?.role === 'operator' && sess?.id) p.set('operatorId', String(sess.id));
        else if (sess?.role === 'admin' && sess?.id) p.set('adminId', String(sess.id));
      } catch { }
      const data = await api.get(`/admin/trade/block/orders${p.toString() ? ('?' + p.toString()) : ''}`);
      const remote = Array.isArray(data?.items) ? data.items : [];
      setOrders(remote);
    } catch (e) {
      console.warn('加载订单失败（后端不可用）', e);
      setOrders([]);
    }
  };
  useEffect(() => { fetchOrders(); }, [orderTab]);

  const openAdd = () => { setShowAdd(true); };
  const [editId, setEditId] = useState(null);
  const [opsOpenId, setOpsOpenId] = useState(null);
  const closeAdd = () => { setShowAdd(false); setEditId(null); setForm({ market: 'us', symbol: '', startAt: '', endAt: '', price: '', minQty: '1', lockUntil: '', subscribeKey: '' }); };
  const openEdit = (it) => {
    setEditId(it.id);
    setShowAdd(true);
    setForm({
      market: String(it.market || 'us'),
      symbol: String(it.symbol || ''),
      startAt: String(it.start_at || ''),
      endAt: String(it.end_at || ''),
      price: String(it.price || ''),
      minQty: String(it.min_qty || '1'),
      lockUntil: String(it.lock_until || ''),
      subscribeKey: String(it.subscribe_key || ''),
    });
  };

  // 将输入的 symbol 映射为 Yahoo Finance 可识别的代码
  const mapToYahooSymbol = (market, symbol) => {
    const s = String(symbol || '').trim().toUpperCase();
    if (!s) return '';
    if (market === 'us') return s;
    if (market === 'crypto') {
      if (/^[A-Z]+USDT$/.test(s)) return s.replace(/USDT$/, '-USD');
      if (/^[A-Z]+USD$/.test(s)) return s.replace(/USD$/, '-USD');
      if (s.includes('-')) return s; // e.g. BTC-USD
      if (s === 'BTC' || s === 'ETH' || s === 'SOL') return `${s}-USD`;
      // 默认补齐为 -USD
      return `${s}-USD`;
    }
    return s;
  };

  // Twelve Data API key 读取：URL ?tdkey= 覆盖 -> localStorage -> env -> 默认值
  const getTwelveDataKey = () => {
    try {
      const qs = new URLSearchParams(typeof location !== 'undefined' ? (location.search || '') : '');
      const fromUrl = (qs.get('tdkey') || '').trim();
      if (fromUrl) {
        try { localStorage.setItem('td:apikey', fromUrl); } catch { }
        return fromUrl;
      }
    } catch { }
    try {
      const ls = (localStorage.getItem('td:apikey') || '').trim();
      if (ls) return ls;
    } catch { }
    const envKey = (import.meta.env?.VITE_TWELVEDATA_KEY || import.meta.env?.VITE_TD_KEY || '').trim();
    if (envKey) return envKey;
    // 用户提供的默认密钥（可在 URL 或 localStorage 中覆盖）
    return '45a943df091e40af9f9444d58bd520a0';
  };



  // 将输入映射为 Twelve Data 支持的 symbol 格式
  // us: 直接使用如 AAPL；crypto: 转为 BASE/QUOTE（如 BTC/USDT、BTC/USD）
  const mapToTwelveSymbol = (market, symbol) => {
    const s0 = String(symbol || '').trim().toUpperCase();
    if (!s0) return '';
    if (market === 'us') return s0;
    if (market === 'crypto') {
      if (s0.includes('/')) return s0; // 已是 BASE/QUOTE
      if (s0.includes('-')) return s0.replace('-', '/'); // 兼容 BTC-USD -> BTC/USD
      if (/^[A-Z]+USDT$/.test(s0)) return `${s0.replace(/USDT$/, '')}/USDT`;
      if (/^[A-Z]+USD$/.test(s0)) return `${s0.replace(/USD$/, '')}/USD`;
      // 单币默认补齐 USD 作为报价币
      if (['BTC', 'ETH', 'SOL'].includes(s0)) return `${s0}/USD`;
      // 其它币默认补 USD
      return `${s0}/USD`;
    }
    return s0;
  };

  // 轻量 JSON 获取（带超时）用于直连 Yahoo 作为后备
  const fetchJSONWithTimeout = async (url, ms = 4500) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), Math.max(1, ms));
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { 'Accept': 'application/json' } });
      const ct = res.headers.get('content-type') || '';
      const isJson = ct.includes('application/json');
      const data = isJson ? await res.json() : await res.text();
      if (!res.ok) {
        const msg = isJson ? (data?.error || `HTTP ${res.status}`) : String(data).slice(0, 300);
        throw new Error(msg);
      }
      return isJson ? data : JSON.parse(typeof data === 'string' ? data : '{}');
    } finally {
      clearTimeout(id);
    }
  };

  // 检查标的是否存在（优先走 Twelve Data；必要时再后备 Yahoo）
  const checkInstrumentExists = async (market, symbol) => {
    const tdSymbol = mapToTwelveSymbol(market, symbol);
    if (!tdSymbol) return { ok: false, reason: '股票/币种代码为空' };
    const tdKey = getTwelveDataKey();

    // Helper: 调用 Twelve Data quote 并校验价格有效
    const tryTD = async (sym, extraParams = {}) => {
      const params = new URLSearchParams({ apikey: tdKey, symbol: sym });
      Object.entries(extraParams || {}).forEach(([k, v]) => {
        if (typeof v === 'undefined' || v === null || v === '') return;
        params.set(k, v);
      });
      const url = `https://api.twelvedata.com/quote?${params.toString()}`;
      const data = await fetchJSONWithTimeout(url, 4500);
      if (data?.status === 'error' || data?.code) {
        const msg = data?.message || 'Twelve Data 错误';
        throw new Error(msg);
      }
      const price = Number(data?.price ?? data?.close ?? 0);
      if (!(price > 0)) throw new Error('未找到有效价格');
      return data;
    };

    // Twelve Data 优先：加密货币尝试 USD/USDT 与常见交易所；美股直接查询
    try {
      if (market === 'crypto') {
        const isUsdt = /\/USDT$/i.test(tdSymbol);
        const base = tdSymbol.split('/')[0];
        const variants = [];
        // 先尝试更常见的 USD，再尝试 USDT
        if (isUsdt) variants.push(`${base}/USD`, `${base}/USDT`);
        else variants.push(`${base}/USD`, `${base}/USDT`);
        const exchangesFor = (pair) => (pair.endsWith('/USDT') ? ['BINANCE', 'BYBIT'] : ['COINBASE', 'KRAKEN']);
        let lastErr;
        for (const pair of variants) {
          // 先不带交易所，若失败再带常见交易所
          try {
            const d0 = await tryTD(pair);
            return { ok: true, yfSymbol: d0?.symbol, name: d0?.name || null };
          } catch (e0) { lastErr = e0; }
          for (const ex of exchangesFor(pair)) {
            try {
              const d1 = await tryTD(pair, { exchange: ex });
              return { ok: true, yfSymbol: d1?.symbol, name: d1?.name || null };
            } catch (e1) { lastErr = e1; }
          }
        }
        throw lastErr || new Error('加密货币查询失败');
      } else {
        const d = await tryTD(tdSymbol);
        return { ok: true, yfSymbol: d?.symbol, name: d?.name || null };
      }
    } catch (e) {
      // 失败时再后备 Yahoo（某些代码兼容性更好），但不强求
      const yfSymbol = mapToYahooSymbol(market, symbol);
      const interpret = (data) => {
        const list = data?.quoteResponse?.result || [];
        if (Array.isArray(list) && list.length) {
          const r = list[0];
          const price = Number(r?.regularMarketPrice ?? r?.bid ?? 0) || 0;
          const ok = !!r?.symbol && price > 0;
          return ok ? { ok: true, yfSymbol, name: r?.shortName || r?.longName || null } : { ok: false, reason: '未找到有效价格' };
        }
        return { ok: false, reason: '未查询到该标的（Yahoo 空结果）' };
      };
      try {
        const data2 = await api.get(`/yf/v7/finance/quote?symbols=${encodeURIComponent(yfSymbol)}`, { timeoutMs: 4500 });
        const res2 = interpret(data2);
        if (res2.ok) return res2;
      } catch { }
      const msg = e?.message || '查询失败';
      const looksCors = /CORS|Access-Control|preflight|Failed to fetch|NetworkError/i.test(msg);
      return { ok: false, reason: looksCors ? '网络或跨域问题（已尝试 Twelve Data 与 Yahoo）' : msg };
    }
  };

  const submitAdd = async () => {
    const payload = {
      market: form.market,
      symbol: form.symbol.trim(),
      startAt: form.startAt.trim(),
      endAt: form.endAt.trim(),
      price: Number(form.price),
      minQty: Number(form.minQty),
      lockUntil: form.lockUntil.trim(),
      subscribeKey: form.subscribeKey.trim(),
    };
    const keyOk = /^[A-Za-z0-9]{6,}$/.test(payload.subscribeKey || '');
    if (!payload.symbol || !payload.startAt || !payload.endAt || !payload.lockUntil || !isFinite(payload.price) || payload.price <= 0 || !isFinite(payload.minQty) || payload.minQty <= 0 || !keyOk) {
      alert('请完整填写并校验字段'); return;
    }
    // 额外校验：时间窗与锁定周期
    try {
      const now = Date.now();
      const st = new Date(payload.startAt).getTime();
      const en = new Date(payload.endAt).getTime();
      const lk = new Date(payload.lockUntil).getTime();
      if (!isFinite(st) || !isFinite(en) || !isFinite(lk)) {
        alert('时间格式不正确，请重新选择开始/结束/锁定时间');
        return;
      }
      if (st >= en) { alert('结束时间必须晚于开始时间'); return; }
      if (en <= now) { alert('结束时间必须晚于当前时间'); return; }
      if (lk <= en) { alert('锁定到期必须晚于结束时间'); return; }
    } catch (_) {
      alert('时间校验失败，请检查输入'); return;
    }
    try {
      setChecking(true);
      const chk = await checkInstrumentExists(payload.market, payload.symbol);
      setChecking(false);
      if (!chk.ok) {
        alert(`标的校验失败：${chk.reason || '未找到该股票/币种'}\n请检查代码是否正确`);
        return;
      }
      setSubmitting(true);
      if (editId) {
        await api.post(`/admin/trade/block/${editId}/update`, payload, { timeoutMs: 9000 });
        alert('已更新大宗交易');
      } else {
        await api.post('/admin/trade/block/create', payload, { timeoutMs: 9000 });
        alert('已添加大宗交易');
      }
      closeAdd();
      fetchList();
    } catch (e) {
      const msg = String(e?.message || '') || '添加失败';
      alert(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const removeItem = async (id) => {
    if (!confirm('确认删除该配置？')) return;
    try {
      await api.delete(`/admin/trade/block/${id}`);
      fetchList();
    } catch (e) {
      alert('删除失败: ' + (e?.message || e));
    }
  };

  const approveOrder = async (id) => {
    if (!confirm('确认通过该订单审核并扣款？')) return;
    try {
      await api.post(`/admin/trade/block/orders/${id}/approve`, {});
      alert('已通过');
      fetchOrders();
    } catch (e) {
      alert('操作失败: ' + (e?.message || e));
    }
  };
  const deleteOrder = async (id) => {
    if (!confirm('确认删除该订单？删除后用户侧将不可见，资金不退还')) return;
    try { await api.delete(`/admin/trade/block/orders/${id}`); alert('已删除'); fetchOrders(); } catch (e) { alert('删除失败: ' + (e?.message || e)); }
  };
  const toggleOrderLock = async (o) => {
    try {
      if (o.locked) { await api.post(`/admin/trade/block/orders/${o.id}/unlock`, {}); alert('已解除锁定'); }
      else { await api.post(`/admin/trade/block/orders/${o.id}/lock`, {}); alert('已锁定'); }
      fetchOrders();
    } catch (e) { alert('操作失败: ' + (e?.message || e)); }
  };
  const runPayoutOnce = async () => {
    try {
      const r = await api.post('/admin/trade/fund/payout/run', {});
      const n = Number(r?.processed || 0);
      alert(n > 0 ? `已处理到期配息 ${n} 条` : '暂无到期订单');
      fetchOrders();
    } catch (e) { alert('执行失败: ' + (e?.message || e)); }
  };
  const formatNextPayout = (ts) => {
    if (!ts) return '-';
    const diff = ts - Date.now();
    if (diff <= 0) return '已到期';
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return `${d > 0 ? d + '天' : ''}${h > 0 ? h + '小时' : ''}${m > 0 ? m + '分' : ''}` || `${m}分`;
  };
  const formatRemain = (ts, locked) => {
    try {
      if (!ts) return locked ? '—' : '未锁定';
      const now = Date.now();
      const diff = Math.max(0, ts - now);
      if (diff <= 0) return '已解锁';
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      return `${d > 0 ? d + '天' : ''}${h > 0 ? h + '小时' : ''}${m > 0 ? m + '分' : ''}${s > 0 ? s + '秒' : ''}` || `${s}s`;
    } catch { return locked ? '—' : '未锁定'; }
  };
  const rejectOrder = async (id) => {
    const reason = prompt('请输入驳回原因（可选）') || '';
    try {
      await api.post(`/admin/trade/block/orders/${id}/reject`, { notes: reason });
      alert('已驳回');
      fetchOrders();
    } catch (e) {
      alert('操作失败: ' + (e?.message || e));
    }
  };

  return (
    <div className="card flat">
      <h1 className="title">大宗交易</h1>
      {session?.role !== 'operator' && (
        <>
          <div className="form admin-form-compact" style={{ marginTop: 10 }}>
            <label className="label">搜索股票代码</label>
            <input className="input" placeholder="如 AAPL（美股）或 ETH（加密）" value={q} onChange={e => setQ(e.target.value)} />
            <div className="sub-actions" style={{ justifyContent: 'flex-start', gap: 8 }}>
              <button className="btn" onClick={fetchList}>查询</button>
              <button className="btn primary" onClick={openAdd}>添加</button>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={{ padding: '8px 6px' }}>市场</th>
                  <th style={{ padding: '8px 6px' }}>股票/币种</th>
                  <th style={{ padding: '8px 6px' }}>价格</th>
                  <th style={{ padding: '8px 6px' }}>最低数量</th>
                  <th style={{ padding: '8px 6px' }}>购买时间窗</th>
                  <th style={{ padding: '8px 6px' }}>锁定至</th>
                  <th style={{ padding: '8px 6px' }}>认购密钥</th>
                  <th style={{ padding: '8px 6px' }}>状态</th>
                  <th style={{ padding: '8px 6px' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.id} style={{ borderTop: '1px solid #263b5e' }}>
                    <td style={{ padding: '8px 6px' }}>{it.market}</td>
                    <td style={{ padding: '8px 6px' }}>{it.symbol}</td>
                    <td style={{ padding: '8px 6px' }}>{it.price}</td>
                    <td style={{ padding: '8px 6px' }}>{it.min_qty}</td>
                    <td style={{ padding: '8px 6px' }}>{shortIso(it.start_at)} ~ {shortIso(it.end_at)}</td>
                    <td style={{ padding: '8px 6px' }}>{shortIso(it.lock_until)}</td>
                    <td style={{ padding: '8px 6px' }}>{it.subscribe_key || '-'}</td>
                    <td style={{ padding: '8px 6px' }}>{it.status}</td>
                    <td style={{ padding: '8px 6px', position: 'relative' }}>
                      <button className="btn" onClick={() => setOpsOpenId(opsOpenId === it.id ? null : it.id)}>操作</button>
                      {opsOpenId === it.id && (
                        <div className="card" style={{ position: 'absolute', zIndex: 10, padding: 8, right: 8 }}>
                          <button className="btn slim" style={{ width: '100%' }} onClick={() => { setOpsOpenId(null); openEdit(it); }}>编辑</button>
                          <button className="btn slim" style={{ width: '100%', marginTop: 6 }} onClick={() => { setOpsOpenId(null); removeItem(it.id); }}>删除</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={8} className="desc" style={{ padding: '10px 6px' }}>{loading ? '加载中...' : '暂无数据'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* 审核订单列表 */}
      <div className="card flat" style={{ marginTop: 18 }}>
        <div className="section-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 className="title" style={{ margin: 0 }}>订单审核</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className={`btn slim ${orderTab === 'submitted' ? 'primary' : ''}`} onClick={() => setOrderTab('submitted')}>待审核</button>
            <button className={`btn slim ${orderTab === 'approved' ? 'primary' : ''}`} onClick={() => setOrderTab('approved')}>已通过</button>
            <button className={`btn slim ${orderTab === 'rejected' ? 'primary' : ''}`} onClick={() => setOrderTab('rejected')}>已驳回</button>
          </div>
        </div>
        <div className="desc" style={{ marginTop: 6, color: '#8aa0bd' }}>
          已到期但未赎回的订单将持续按配息周期发放，直到用户赎回为止。
        </div>
        <div className="form admin-form-compact" style={{ marginTop: 10 }}>
          <label className="label">按手机号查询订单</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8 }}>
            <input className="input" placeholder="输入用户手机号" value={orderPhone} onChange={e => setOrderPhone(e.target.value)} />
            <button className="btn" onClick={() => { fetchOrders(); }}>查询</button>
            <button className="btn" onClick={() => { setOrderPhone(''); fetchOrders(); }}>重置</button>
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th style={{ padding: '8px 6px' }}>手机号</th>
                <th style={{ padding: '8px 6px' }}>标的</th>
                <th style={{ padding: '8px 6px' }}>市场</th>
                <th style={{ padding: '8px 6px' }}>价格</th>
                <th style={{ padding: '8px 6px' }}>数量</th>
                <th style={{ padding: '8px 6px' }}>状态</th>
                <th style={{ padding: '8px 6px' }}>剩余锁定时间</th>
                <th style={{ padding: '8px 6px' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.id} style={{ borderTop: '1px solid #263b5e' }}>
                  <td style={{ padding: '8px 6px' }}>{o.phone || '-'}</td>
                  <td style={{ padding: '8px 6px' }}>{o.symbol}</td>
                  <td style={{ padding: '8px 6px' }}>{o.market}</td>
                  <td style={{ padding: '8px 6px' }}>{o.price}</td>
                  <td style={{ padding: '8px 6px' }}>{o.qty}</td>
                  <td style={{ padding: '8px 6px' }}>{o.status}</td>
                  <td style={{ padding: '8px 6px' }}>{formatRemain(o.lock_until_ts, o.locked)}</td>
                  <td style={{ padding: '8px 6px', position: 'relative' }}>
                    {o.status === 'submitted' ? (
                      <>
                        <>
                          <button className="btn primary" onClick={() => approveOrder(o.id)}>通过</button>
                          <button className="btn" style={{ marginLeft: 8 }} onClick={() => rejectOrder(o.id)}>驳回</button>
                        </>
                      </>
                    ) : (
                      <>
                        <button className="btn" onClick={() => setOrderOpsOpenId(orderOpsOpenId === o.id ? null : o.id)}>操作</button>
                        {orderOpsOpenId === o.id && (
                          <div className="card" style={{ position: 'absolute', zIndex: 10, padding: 8, right: 8 }}>
                            <button className="btn slim" style={{ width: '100%' }} onClick={() => { setOrderOpsOpenId(null); toggleOrderLock(o); }}>{o.locked ? '解除锁定' : '恢复锁定'}</button>

                            <button className="btn slim danger" style={{ width: '100%', marginTop: 6 }} onClick={() => { setOrderOpsOpenId(null); deleteOrder(o.id); }}>删除订单</button>
                          </div>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={10} className="desc" style={{ padding: '10px 6px' }}>暂无订单</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && session?.role !== 'operator' ? (
        <div className="modal" style={{ alignItems: 'flex-start', paddingTop: 100 }}>
          <div className="modal-card">
            <h2 className="title" style={{ marginTop: 0 }}>添加大宗交易</h2>
            <div className="form">
              <label className="label">交易市场</label>
              <select className="input" value={form.market} onChange={e => setForm(f => ({ ...f, market: e.target.value }))}>
                <option value="us">美股</option>
                <option value="crypto">加密货币</option>
              </select>
              <label className="label">股票代码</label>
              <input className="input" placeholder="如 AAPL 或 BTC/USDT（支持 BTC-USD / BTCUSD / BTCUSDT 自动识别）" value={form.symbol} onChange={e => setForm(f => ({ ...f, symbol: e.target.value }))} />
              <div className="desc">提交前将自动校验标的有效性，校验通过方可添加。</div>
              <label className="label">购买时间限制</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <input className="input" readOnly placeholder="开始时间（精确到秒）" value={form.startAt ? toLocalInput(form.startAt) : ''} onClick={() => openDt('startAt')} style={{ cursor: 'pointer' }} />
                <input className="input" readOnly placeholder="结束时间（精确到秒）" value={form.endAt ? toLocalInput(form.endAt) : ''} onClick={() => openDt('endAt')} style={{ cursor: 'pointer' }} />
              </div>
              <label className="label">大宗交易价格</label>
              <input className="input" placeholder="如 123.45" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
              <label className="label">最低购买数量</label>
              <input className="input" placeholder="如 100" value={form.minQty} onChange={e => setForm(f => ({ ...f, minQty: e.target.value }))} />
              <label className="label">锁定周期至</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
                <input className="input" readOnly placeholder="锁定到期（精确到秒）" value={form.lockUntil ? toLocalInput(form.lockUntil) : ''} onClick={() => openDt('lockUntil')} style={{ cursor: 'pointer' }} />
              </div>

              <label className="label">认购密钥</label>
              <input className="input" placeholder="至少6位字母+数字" value={form.subscribeKey} onChange={e => setForm(f => ({ ...f, subscribeKey: e.target.value }))} />

              <div className="sub-actions" style={{ justifyContent: 'flex-end', gap: 10 }}>
                <button className="btn" onClick={closeAdd}>取消</button>
                <button className="btn primary" disabled={submitting || checking} onClick={submitAdd}>{checking ? '校验中…' : (submitting ? '提交中…' : '提交')}</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {dtPicker.open && (
        <div className="modal" style={{ zIndex: 1000, alignItems: 'flex-start', paddingTop: 100 }}>
          <div className="modal-card">
            <h2 className="title" style={{ marginTop: 0 }}>选择日期时间（秒级）</h2>
            <div className="form">
              <label className="label">{dtPicker.field === 'startAt' ? '开始时间' : dtPicker.field === 'endAt' ? '结束时间' : '锁定到期'}</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
                <input className="input" type="date" value={dtPicker.date} onChange={(e) => setDtPicker(p => ({ ...p, date: e.target.value }))} />
                <select className="input" value={dtPicker.hour} onChange={(e) => setDtPicker(p => ({ ...p, hour: e.target.value }))}>
                  {[...Array(24).keys()].map(h => (<option key={h} value={pad2(h)}>{pad2(h)} 时</option>))}
                </select>
                <select className="input" value={dtPicker.minute} onChange={(e) => setDtPicker(p => ({ ...p, minute: e.target.value }))}>
                  {[...Array(60).keys()].map(m => (<option key={m} value={pad2(m)}>{pad2(m)} 分</option>))}
                </select>
                <select className="input" value={dtPicker.second} onChange={(e) => setDtPicker(p => ({ ...p, second: e.target.value }))}>
                  {[...Array(60).keys()].map(s => (<option key={s} value={pad2(s)}>{pad2(s)} 秒</option>))}
                </select>
              </div>
              <div className="desc">先选择日期，再选择时/分/秒</div>
              <div className="sub-actions" style={{ justifyContent: 'flex-end', gap: 10 }}>
                <button className="btn" onClick={closeDt}>取消</button>
                <button className="btn primary" onClick={confirmDt}>确定</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- 资金管理：账户充值（顶层作用域） ----
function RechargePage() {
  const [phone, setPhone] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [currency, setCurrency] = useState('MXN');
  const [amount, setAmount] = useState('');
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const submit = async () => {
    const ph = String(phone || '').trim();
    if (!ph) { alert('请填写用户手机号'); return; }
    const amt = Number(amount);
    if (!/^\d+(\.\d{1,2})?$/.test(String(amount || ''))) { alert('金额格式不正确，最多两位小数'); return; }
    if (!Number.isFinite(amt) || amt <= 0) { alert('金额必须为正数'); return; }
    try { await api.post('/admin/balances/recharge', { phone: ph, currency, amount: amt }); alert('充值成功'); setModalOpen(false); setAmount(''); fetchList(); } catch (e) { alert('充值失败: ' + (e?.message || e)); }
  };
  const fetchList = async () => {
    try {
      const sp = new URLSearchParams();
      if (phone.trim()) sp.set('phone', phone.trim());
      sp.set('page', String(page)); sp.set('pageSize', String(pageSize));
      const data = await api.get(`/admin/balances/logs?${sp.toString()}`);
      setItems(Array.isArray(data?.items) ? data.items : []);
      setTotal(Number(data?.total || 0));
    } catch (_) { setItems([]); setTotal(0); }
  };
  useEffect(() => { fetchList(); }, [page, pageSize]);
  return (
    <div className="card flat">
      <h1 className="title">资金充值</h1>
      <div className="form admin-form-compact" style={{ marginTop: 10 }}>
        <label className="label">按手机号查询充值记录</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8 }}>
          <input className="input" placeholder="输入用户手机号" value={phone} onChange={e => setPhone(e.target.value)} />
          <button className="btn" onClick={() => { setPage(1); fetchList(); }}>查询</button>
          <button className="btn primary" onClick={() => setModalOpen(true)}>发起充值</button>
        </div>
      </div>
      {modalOpen && (
        <div className="modal" style={{ position: 'fixed', inset: 0, alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="modal-card" style={{ width: 420, transform: 'translateY(12vh)' }}>
            <h2 className="title" style={{ marginTop: 0 }}>账户充值</h2>
            <div className="form">
              <label className="label">手机号</label>
              <input className="input" placeholder="输入用户手机号" value={phone} onChange={e => setPhone(e.target.value)} />
              <label className="label">币种</label>
              <select className="input" value={currency} onChange={e => setCurrency(e.target.value)}>
                <option value="MXN">MXN</option>
                <option value="USD">USD</option>
                <option value="USDT">USDT</option>
              </select>
              <label className="label">金额</label>
              <input className="input" placeholder="如 100 或 100.50" value={amount} onChange={e => setAmount(e.target.value)} />
              <div className="sub-actions" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                <button className="btn" onClick={() => setModalOpen(false)}>取消</button>
                <button className="btn primary" onClick={submit}>提交</button>
              </div>
            </div>
          </div>
        </div>
      )}
      <div style={{ marginTop: 14 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th style={{ padding: '8px 6px' }}>姓名</th>
              <th style={{ padding: '8px 6px' }}>手机号</th>
              <th style={{ padding: '8px 6px' }}>充值币种</th>
              <th style={{ padding: '8px 6px' }}>充值时间</th>
              <th style={{ padding: '8px 6px' }}>操作人</th>
            </tr>
          </thead>
          <tbody>
            {items.map(it => (
              <tr key={it.id} style={{ borderTop: '1px solid #263b5e' }}>
                <td style={{ padding: '8px 6px' }}>{it.userName || it.userId}</td>
                <td style={{ padding: '8px 6px' }}>{it.phone || '-'}</td>
                <td style={{ padding: '8px 6px' }}>{it.currency}</td>
                <td style={{ padding: '8px 6px' }}>{it.created_at}</td>
                <td style={{ padding: '8px 6px' }}>{it.adminName || it.adminId || '-'}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={5} className="desc" style={{ padding: '10px 6px' }}>暂无数据</td></tr>
            )}
          </tbody>
        </table>
        <div className="sub-actions" style={{ justifyContent: 'space-between', marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="desc">每页</span>
            <select className="input" value={pageSize} onChange={e => { setPageSize(parseInt(e.target.value, 10)); setPage(1); }}>
              {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <span className="desc">共 {total} 条</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="btn" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>上一页</button>
            <span className="desc">{page} / {Math.max(1, Math.ceil((total || 0) / (pageSize || 20)))}</span>
            <button className="btn" disabled={page >= Math.max(1, Math.ceil((total || 0) / (pageSize || 20)))} onClick={() => setPage(p => Math.min(Math.max(1, Math.ceil((total || 0) / (pageSize || 20))), p + 1))}>下一页</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- 资金管理：资金明细（顶层作用域） ----
function BalanceLogsPage() {
  const [phone, setPhone] = useState('');
  const [currency, setCurrency] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const fetchList = async () => {
    try {
      const sp = new URLSearchParams();
      if (phone.trim()) sp.set('phone', phone.trim());
      if (currency) sp.set('currency', currency);
      if (from) sp.set('from', from);
      if (to) sp.set('to', to);
      sp.set('page', String(page)); sp.set('pageSize', String(pageSize));
      const data = await api.get(`/admin/balances/logs?${sp.toString()}`);
      setItems(Array.isArray(data?.items) ? data.items : []);
      setTotal(Number(data?.total || 0));
    } catch (_) { setItems([]); setTotal(0); }
  };
  useEffect(() => { fetchList(); }, [page, pageSize]);
  return (
    <div className="card flat">
      <h1 className="title">资金明细</h1>
      <div className="form admin-form-compact" style={{ marginTop: 10 }}>
        <label className="label">手机号</label>
        <input className="input" placeholder="输入手机号筛选" value={phone} onChange={e => setPhone(e.target.value)} />
        <label className="label">币种</label>
        <select className="input" value={currency} onChange={e => setCurrency(e.target.value)}>
          <option value="">全部</option>
          <option value="MXN">MXN</option>
          <option value="USD">USD</option>
          <option value="USDT">USDT</option>
        </select>
        <label className="label">时间范围</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <input className="input" type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} />
          <input className="input" type="datetime-local" value={to} onChange={e => setTo(e.target.value)} />
        </div>
        <div className="sub-actions" style={{ justifyContent: 'flex-start', gap: 8, marginTop: 8 }}>
          <button className="btn" onClick={() => { setPage(1); fetchList(); }}>查询</button>
          <button className="btn" onClick={() => { setPhone(''); setCurrency(''); setFrom(''); setTo(''); setPage(1); fetchList(); }}>重置</button>
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th style={{ padding: '8px 6px' }}>用户</th>
              <th style={{ padding: '8px 6px' }}>手机号</th>
              <th style={{ padding: '8px 6px' }}>币种</th>
              <th style={{ padding: '8px 6px' }}>变动金额</th>
              <th style={{ padding: '8px 6px' }}>原因</th>
              <th style={{ padding: '8px 6px' }}>时间</th>
            </tr>
          </thead>
          <tbody>
            {items.map(it => (
              <tr key={it.id} style={{ borderTop: '1px solid #263b5e' }}>
                <td style={{ padding: '8px 6px' }}>{it.userName || it.userId}</td>
                <td style={{ padding: '8px 6px' }}>{it.phone || '-'}</td>
                <td style={{ padding: '8px 6px' }}>{it.currency}</td>
                <td style={{ padding: '8px 6px' }}>{Number(it.amount).toFixed(2)}</td>
                <td style={{ padding: '8px 6px' }}>{it.reason || '-'}</td>
                <td style={{ padding: '8px 6px' }}>{it.created_at}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={6} className="desc" style={{ padding: '10px 6px' }}>{'暂无数据'}</td></tr>
            )}
          </tbody>
        </table>
        <div className="sub-actions" style={{ justifyContent: 'space-between', marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="desc">每页</span>
            <select className="input" value={pageSize} onChange={e => { setPageSize(parseInt(e.target.value, 10)); setPage(1); }}>
              {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <span className="desc">共 {total} 条</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="btn" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>上一页</button>
            <span className="desc">{page} / {Math.max(1, Math.ceil((total || 0) / (pageSize || 20)))}</span>
            <button className="btn" disabled={page >= Math.max(1, Math.ceil((total || 0) / (pageSize || 20)))} onClick={() => setPage(p => Math.min(Math.max(1, Math.ceil((total || 0) / (pageSize || 20))), p + 1))}>下一页</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function IpoRwaAdmin({ session }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [kind, setKind] = useState('ipo');
  const [pubMode, setPubMode] = useState('online'); // online | offline
  const [form, setForm] = useState({ name: '', code: '', pairAddress: '', tokenAddress: '', chain: 'base', subscribePrice: '', issueAt: '', subscribeAt: '', subscribeEndAt: '', listAt: '', canSellOnListingDay: false });
  const [dtPicker, setDtPicker] = useState({ open: false, field: null, date: '', hour: '00', minute: '00', second: '00' });
  const pad2 = (n) => String(n).padStart(2, '0');
  const toLocalInput = (iso) => { try { if (!iso) return ''; const d = new Date(iso); const y = d.getFullYear(), m = pad2(d.getMonth() + 1), da = pad2(d.getDate()), h = pad2(d.getHours()), mi = pad2(d.getMinutes()), s = pad2(d.getSeconds()); return `${y}-${m}-${da}T${h}:${mi}:${s}`; } catch { return ''; } };
  const fromLocalInputToISO = (local) => { try { if (!local) return ''; const d = new Date(local); return d.toISOString(); } catch { return ''; } };
  const splitLocal = (local) => { if (!local || !local.includes('T')) return { date: '', hour: '00', minute: '00', second: '00' }; const [date, time] = local.split('T'); const [h = '00', mi = '00', s = '00'] = (time || '').split(':'); return { date, hour: pad2(h), minute: pad2(mi), second: pad2(s) }; };
  const openDt = (field) => { const local = toLocalInput(form[field]); const parts = splitLocal(local); setDtPicker({ open: true, field, ...parts }); };
  const closeDt = () => setDtPicker({ open: false, field: null, date: '', hour: '00', minute: '00', second: '00' });
  const confirmDt = () => { if (!dtPicker.field || !dtPicker.date) return closeDt(); const iso = fromLocalInputToISO(`${dtPicker.date}T${pad2(dtPicker.hour)}:${pad2(dtPicker.minute)}:${pad2(dtPicker.second)}`); setForm(f => ({ ...f, [dtPicker.field]: iso })); closeDt(); };

  const fetchList = async () => {
    try {
      setLoading(true);
      const sp = new URLSearchParams();
      if (q.trim()) sp.set('q', q.trim());
      sp.set('page', String(page));
      sp.set('pageSize', String(pageSize));
      const data = await api.get(`/admin/trade/ipo/list?${sp.toString()}`, { timeoutMs: 15000 });
      setItems(Array.isArray(data?.items) ? data.items : []);
      setTotal(Number(data?.total || 0));
    } catch (_) { setItems([]); setTotal(0); } finally { setLoading(false); }
  };
  useEffect(() => { fetchList(); }, [page, pageSize]);

  const removeIpo = async (id) => { if (!confirm('确认删除该项目？')) return; try { await api.delete(`/admin/trade/ipo/${id}`); fetchList(); } catch (e) { alert('删除失败: ' + (e?.message || e)); } };

  const [itemEditId, setItemEditId] = useState(null);
  const [itemOpsId, setItemOpsId] = useState(null);
  const openItemEdit = (it) => {
    setItemEditId(it.id);
    setShowAdd(true);
    setKind(String(it.kind || 'ipo'));
    setForm({
      name: String(it.name || ''),
      code: String(it.code || ''),
      pairAddress: String((it.pairAddress ?? it.pair_address) || ''),
      tokenAddress: String((it.tokenAddress ?? it.token_address) || ''),
      chain: String(it.chain || ''),
      subscribePrice: String((it.subscribePrice ?? it.subscribe_price) || ''),
      listPrice: String((it.listPrice ?? it.list_price) ?? ''),
      issueAt: String((it.issueAt ?? it.issue_at) || ''),
      subscribeAt: String((it.subscribeAt ?? it.subscribe_at) || ''),
      subscribeEndAt: String((it.subscribeEndAt ?? it.subscribe_end_at) || ''),
      listAt: String((it.listAt ?? it.list_at) || ''),
      canSellOnListingDay: !!(it.canSellOnListingDay ?? it.can_sell_on_listing_day),
    });
  };

  const submitAdd = async () => {
    const payload = {
      kind,
      name: form.name.trim(),
      code: form.code.trim().toUpperCase(),
      subscribePrice: Number(form.subscribePrice),
      listPrice: (kind === 'ipo' && pubMode === 'online') ? null : (form.listPrice ? Number(form.listPrice) : null),
      issueAt: String(form.issueAt || ''), // 扣款时间
      subscribeAt: String(form.subscribeAt || ''), // 开始
      subscribeEndAt: String(form.subscribeEndAt || ''), // 截止
      listAt: String(form.listAt || ''),
      canSellOnListingDay: !!form.canSellOnListingDay,
      pairAddress: kind === 'rwa' ? String(form.pairAddress || '') : null,
      tokenAddress: kind === 'rwa' ? String(form.tokenAddress || '') : null,
      chain: kind === 'rwa' ? String(form.chain || 'base') : null,
    };
    if (!payload.name || !payload.code || !payload.subscribePrice || !payload.issueAt || !payload.subscribeAt) { alert('请完整填写名称、代码、申购价格、扣款时间、申购开始时间'); return; }
    try {
      if (itemEditId) {
        await api.post(`/admin/trade/ipo/${itemEditId}/update`, payload);
        alert('已更新');
      } else {
        await api.post('/admin/trade/ipo/create', payload);
        alert('已创建');
      }

      // ---- 资金管理：账户充值 ----
      // 占位：已移动到顶层作用域，避免嵌套定义导致不可见

      setShowAdd(false); setItemEditId(null);
      setForm({ name: '', code: '', pairAddress: '', tokenAddress: '', subscribePrice: '', issueAt: '', subscribeAt: '', subscribeEndAt: '', listAt: '', canSellOnListingDay: false });
      setPage(1); fetchList();
    } catch (e) { alert('提交失败: ' + (e?.message || e)); }
  };

  const [orderTab, setOrderTab] = useState('submitted');
  const [orders, setOrders] = useState([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [orderPage, setOrderPage] = useState(1);
  const [orderPageSize, setOrderPageSize] = useState(20);
  const fetchOrders = async () => {
    try {
      const sp = new URLSearchParams();
      sp.set('status', orderTab);
      sp.set('page', String(orderPage));
      sp.set('pageSize', String(orderPageSize));
      try {
        const sess = JSON.parse(localStorage.getItem('sessionUser') || '{}');
        if (sess?.role === 'operator' && sess?.id) sp.set('operatorId', String(sess.id));
        else if (sess?.role === 'admin' && sess?.id) sp.set('adminId', String(sess.id));
      } catch { }
      const data = await api.get(`/admin/trade/ipo/orders?${sp.toString()}`);
      setOrders(Array.isArray(data?.items) ? data.items : []);
      setOrdersTotal(Number(data?.total || 0));
    } catch (_) { setOrders([]); setOrdersTotal(0); }
  };
  useEffect(() => { fetchOrders(); }, [orderTab, orderPage, orderPageSize]);

  const approveOrder = async (id) => { const qtyRaw = prompt('请输入审批股数'); const qty = Number(qtyRaw || ''); if (!Number.isFinite(qty) || qty <= 0) { alert('审批股数必须为正数'); return; } try { await api.post(`/admin/trade/ipo/orders/${id}/approve`, { qty }); alert('已通过并扣款'); fetchOrders(); } catch (e) { alert('操作失败: ' + (e?.message || e)); } };
  const rejectOrder = async (id) => { const reason = prompt('请输入驳回原因（可选）') || ''; try { await api.post(`/admin/trade/ipo/orders/${id}/reject`, { notes: reason }); alert('已驳回'); fetchOrders(); } catch (e) { alert('操作失败: ' + (e?.message || e)); } };

  const totalPages = Math.max(1, Math.ceil((total || 0) / (pageSize || 20)));
  const ordersTotalPages = Math.max(1, Math.ceil((ordersTotal || 0) / (orderPageSize || 20)));

  return (
    <div className="card flat">
      <h1 className="title">新股 / 实物资产</h1>
      {session?.role !== 'operator' && (
        <>
          <div className="form admin-form-compact" style={{ marginTop: 10 }}>
            <label className="label">搜索编码或名称</label>
            <input className="input" placeholder="如 AAPL 或关键词" value={q} onChange={e => setQ(e.target.value)} />
            <div className="sub-actions" style={{ justifyContent: 'flex-start', gap: 8 }}>
              <button className="btn" onClick={() => { setPage(1); fetchList(); }}>查询</button>
              <button className="btn primary" onClick={() => setShowAdd(true)}>创建</button>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={{ padding: '8px 6px' }}>类型</th>
                  <th style={{ padding: '8px 6px' }}>名称</th>
                  <th style={{ padding: '8px 6px' }}>代码</th>
                  <th style={{ padding: '8px 6px' }}>申购价</th>
                  <th style={{ padding: '8px 6px' }}>上市价</th>
                  <th style={{ padding: '8px 6px' }}>发行</th>
                  <th style={{ padding: '8px 6px' }}>申购</th>
                  <th style={{ padding: '8px 6px' }}>申购截止</th>
                  <th style={{ padding: '8px 6px' }}>上市</th>
                  <th style={{ padding: '8px 6px' }}>上市日卖出</th>
                  <th style={{ padding: '8px 6px' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.id} style={{ borderTop: '1px solid #263b5e' }}>
                    <td style={{ padding: '8px 6px' }}>{it.kind || 'ipo'}</td>
                    <td style={{ padding: '8px 6px' }}>{it.name}</td>
                    <td style={{ padding: '8px 6px' }}>{it.code}</td>
                    <td style={{ padding: '8px 6px' }}>{it.subscribePrice ?? it.subscribe_price}</td>
                    <td style={{ padding: '8px 6px' }}>{(it.listPrice ?? it.list_price) ?? '-'}</td>
                    <td style={{ padding: '8px 6px' }}>{((it.issueAt ?? it.issue_at) || '').replace(/:00\.000Z$/, '').replace(/\.\d+Z$/, 'Z')}</td>
                    <td style={{ padding: '8px 6px' }}>{((it.subscribeAt ?? it.subscribe_at) || '').replace(/:00\.000Z$/, '').replace(/\.\d+Z$/, 'Z')}</td>
                    <td style={{ padding: '8px 6px' }}>{(it.subscribeEndAt ?? it.subscribe_end_at) ? String(it.subscribeEndAt ?? it.subscribe_end_at).replace(/:00\.000Z$/, '').replace(/\.\d+Z$/, 'Z') : '-'}</td>
                    <td style={{ padding: '8px 6px' }}>{(it.listAt ?? it.list_at) ? String(it.listAt ?? it.list_at).replace(/:00\.000Z$/, '').replace(/\.\d+Z$/, 'Z') : '-'}</td>
                    <td style={{ padding: '8px 6px' }}>{(it.canSellOnListingDay ?? it.can_sell_on_listing_day) ? '是' : '否'}</td>
                    <td style={{ padding: '8px 6px', position: 'relative' }}>
                      <button className="btn" onClick={() => setItemOpsId(itemOpsId === it.id ? null : it.id)}>操作</button>
                      {itemOpsId === it.id && (
                        <div className="card" style={{ position: 'absolute', zIndex: 10, padding: 8, right: 8 }}>
                          <button className="btn slim" style={{ width: '100%' }} onClick={() => { setItemOpsId(null); openItemEdit(it); }}>编辑</button>
                          <button className="btn slim" style={{ width: '100%', marginTop: 6 }} onClick={() => { setItemOpsId(null); removeIpo(it.id); }}>删除</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td colSpan={10} className="desc" style={{ padding: '10px 6px' }}>{loading ? '加载中...' : '暂无数据'}</td></tr>
                )}
              </tbody>
            </table>
            <div className="sub-actions" style={{ justifyContent: 'space-between', marginTop: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="desc">每页</span>
                <select className="input" value={pageSize} onChange={e => { setPageSize(parseInt(e.target.value, 10)); setPage(1); }}>
                  {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                <span className="desc">共 {total} 条</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button className="btn" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>上一页</button>
                <span className="desc">{page} / {Math.max(1, Math.ceil((total || 0) / (pageSize || 20)))}</span>
                <button className="btn" disabled={page >= Math.max(1, Math.ceil((total || 0) / (pageSize || 20)))} onClick={() => setPage(p => Math.min(Math.max(1, Math.ceil((total || 0) / (pageSize || 20))), p + 1))}>下一页</button>
              </div>
            </div>
          </div>
        </>
      )}

      <div style={{ marginTop: 20 }}>
        <h2 className="title" style={{ marginTop: 0 }}>订单审核</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          {['submitted', 'approved', 'rejected', 'all'].map(s => {
            const txt = s === 'submitted' ? '待审核' : s === 'approved' ? '已通过' : s === 'rejected' ? '已驳回' : '全部';
            return (
              <button
                key={s}
                className={`btn ${orderTab === s ? 'primary' : ''}`}
                style={{ height: 32, padding: '0 12px', fontSize: 13 }}
                onClick={() => { setOrderTab(s); setOrderPage(1); }}
              >
                {txt}
              </button>
            );
          })}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th style={{ padding: '8px 6px' }}>手机号</th>
              <th style={{ padding: '8px 6px' }}>用户</th>
              <th style={{ padding: '8px 6px' }}>代码</th>
              <th style={{ padding: '8px 6px' }}>申购数量</th>
              <th style={{ padding: '8px 6px' }}>提交时间</th>
              <th style={{ padding: '8px 6px' }}>状态</th>
              <th style={{ padding: '8px 6px' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {orders.map(o => (
              <tr key={o.id} style={{ borderTop: '1px solid #263b5e' }}>
                <td style={{ padding: '8px 6px' }}>{o.phone || '-'}</td>
                <td style={{ padding: '8px 6px' }}>{o.userName || o.userId}</td>
                <td style={{ padding: '8px 6px' }}>{o.code}</td>
                <td style={{ padding: '8px 6px' }}>{o.qty}</td>
                <td style={{ padding: '8px 6px' }}>{o.submitted_at}</td>
                <td style={{ padding: '8px 6px' }}>{o.status}</td>
                <td style={{ padding: '8px 6px' }}>
                  {o.status === 'submitted' ? (
                    <>
                      <>
                        <button className="btn primary" style={{ height: 32 }} onClick={() => approveOrder(o.id)}>审批并扣款</button>
                        <button className="btn" style={{ height: 32, marginLeft: 8 }} onClick={() => rejectOrder(o.id)}>驳回</button>
                      </>
                    </>
                  ) : (
                    <span className="desc">—</span>
                  )}
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <span className="desc" style={{ padding: '10px 6px', display: 'inline-block' }}>{'暂无订单'}</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="sub-actions" style={{ justifyContent: 'space-between', marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="desc">每页</span>
            <select className="input" value={orderPageSize} onChange={e => { setOrderPageSize(parseInt(e.target.value, 10)); setOrderPage(1); }}>
              {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <span className="desc">共 {ordersTotal} 条</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="btn" disabled={orderPage <= 1} onClick={() => setOrderPage(p => Math.max(1, p - 1))}>上一页</button>
            <span className="desc">{orderPage} / {ordersTotalPages}</span>
            <button className="btn" disabled={orderPage >= ordersTotalPages} onClick={() => setOrderPage(p => Math.min(ordersTotalPages, p + 1))}>下一页</button>
          </div>
        </div>
      </div>

      {showAdd && session?.role !== 'operator' ? (
        <div className="modal" style={{ alignItems: 'flex-start', justifyContent: 'center', paddingTop: 100 }}>
          <div className="modal-card" style={{ maxWidth: '92vw', width: 680, maxHeight: '80vh', overflow: 'auto' }}>
            <h2 className="title" style={{ marginTop: 0 }}>创建新项目</h2>
            <div className="form">
              <div style={{ display: 'flex', gap: 8 }}>
                <button className={`btn ${kind === 'ipo' ? 'primary' : ''}`} onClick={() => setKind('ipo')}>IPO</button>
                <button className={`btn ${kind === 'rwa' ? 'primary' : ''}`} onClick={() => setKind('rwa')}>RWA</button>
              </div>
              {kind === 'ipo' && (
                <div className="sub-actions" style={{ justifyContent: 'flex-start', gap: 8, marginTop: 8 }}>
                  <button className={`btn ${pubMode === 'online' ? 'primary' : ''}`} onClick={() => setPubMode('online')}>线上发布</button>
                  <button className={`btn ${pubMode === 'offline' ? 'primary' : ''}`} onClick={() => setPubMode('offline')}>线下发布</button>
                </div>
              )}
              <label className="label">名称</label>
              <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              <label className="label">代码</label>
              <input className="input" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} />
              {kind === 'rwa' && (<>
                <label className="label">交易对地址（Uniswap Pair）</label>
                <input className="input" placeholder="0x..." value={form.pairAddress} onChange={e => setForm(f => ({ ...f, pairAddress: e.target.value }))} />
                <label className="label">合约地址（Token）</label>
                <input className="input" placeholder="0x..." value={form.tokenAddress} onChange={e => setForm(f => ({ ...f, tokenAddress: e.target.value }))} />
              </>)}
              <label className="label">申购价格</label>
              <input className="input" value={form.subscribePrice} onChange={e => setForm(f => ({ ...f, subscribePrice: e.target.value }))} />
              {!(kind === 'ipo' && pubMode === 'online') && (
                <>
                  <label className="label">上市价格（可选）</label>
                  <input className="input" value={form.listPrice || ''} onChange={e => setForm(f => ({ ...f, listPrice: e.target.value }))} />
                </>
              )}
              <label className="label">扣款时间（拨捐日）</label>
              <input className="input" readOnly placeholder="选择时间" value={form.issueAt ? toLocalInput(form.issueAt) : ''} onClick={() => openDt('issueAt')} style={{ cursor: 'pointer' }} />
              <label className="label">申购开始时间</label>
              <input className="input" readOnly placeholder="选择时间" value={form.subscribeAt ? toLocalInput(form.subscribeAt) : ''} onClick={() => openDt('subscribeAt')} style={{ cursor: 'pointer' }} />
              <label className="label">申购截止时间</label>
              <input className="input" readOnly placeholder="选择时间" value={form.subscribeEndAt ? toLocalInput(form.subscribeEndAt) : ''} onClick={() => openDt('subscribeEndAt')} style={{ cursor: 'pointer' }} />
              <label className="label">上市时间（未上市留空）</label>
              <input className="input" readOnly placeholder="选择时间" value={form.listAt ? toLocalInput(form.listAt) : ''} onClick={() => openDt('listAt')} style={{ cursor: 'pointer' }} />
              <label className="label">上市当天可卖出</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={form.canSellOnListingDay} onChange={e => setForm(f => ({ ...f, canSellOnListingDay: e.target.checked }))} />
                {!form.canSellOnListingDay && <span className="desc" title="若不可卖出，请在项目说明中明确允许卖出的时间或条件">鼠标悬停查看说明</span>}
              </div>
              <div className="sub-actions" style={{ justifyContent: 'flex-end', gap: 10 }}>
                <button className="btn" onClick={() => setShowAdd(false)}>取消</button>
                <button className="btn primary" onClick={submitAdd}>创建</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {dtPicker.open && (
        <div className="modal" style={{ zIndex: 1000, alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-card" style={{ maxHeight: '70vh', overflow: 'auto' }}>
            <h2 className="title" style={{ marginTop: 0 }}>选择日期时间（秒级）</h2>
            <div className="form">
              <label className="label">时间</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
                <input className="input" type="date" value={dtPicker.date} onChange={(e) => setDtPicker(p => ({ ...p, date: e.target.value }))} />
                <select className="input" value={dtPicker.hour} onChange={(e) => setDtPicker(p => ({ ...p, hour: e.target.value }))}>{[...Array(24).keys()].map(h => (<option key={h} value={pad2(h)}>{pad2(h)} 时</option>))}</select>
                <select className="input" value={dtPicker.minute} onChange={(e) => setDtPicker(p => ({ ...p, minute: e.target.value }))}>{[...Array(60).keys()].map(m => (<option key={m} value={pad2(m)}>{pad2(m)} 分</option>))}</select>
                <select className="input" value={dtPicker.second} onChange={(e) => setDtPicker(p => ({ ...p, second: e.target.value }))}>{[...Array(60).keys()].map(s => (<option key={s} value={pad2(s)}>{pad2(s)} 秒</option>))}</select>
              </div>
              <div className="sub-actions" style={{ justifyContent: 'flex-end', gap: 10 }}>
                <button className="btn" onClick={closeDt}>取消</button>
                <button className="btn primary" onClick={confirmDt}>确定</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FundAdmin({ session }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [orderPage, setOrderPage] = useState(1);
  const [orderPageSize, setOrderPageSize] = useState(20);
  const [orderTab, setOrderTab] = useState('submitted');
  const [orderPhoneFund, setOrderPhoneFund] = useState('');
  const [fundOrderOpsOpenId, setFundOrderOpsOpenId] = useState(null);
  const [fundOpsId, setFundOpsId] = useState(null);
  const [fundEditId, setFundEditId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ nameEs: '', nameEn: '', code: '', descEs: '', descEn: '', tiers: '2000,15%\n5000,20%\n10000,25%\n20000,30%', dividend: 'day', redeemDays: '7', currency: 'MXN' });

  const parseTiers = (text) => {
    const lines = String(text || '').split(/\n+/).map(l => l.trim()).filter(Boolean);
    const arr = [];
    for (const ln of lines) {
      const m = ln.match(/^([0-9]+)\s*,\s*([0-9]+)%$/);
      if (!m) return null;
      const price = Number(m[1]);
      const percent = Number(m[2]);
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(percent) || percent <= 0) return null;
      arr.push({ price, percent });
    }
    return arr;
  };

  const fetchList = async () => {
    try {
      setLoading(true);
      const sp = new URLSearchParams();
      if (q.trim()) sp.set('q', q.trim());
      sp.set('page', String(page));
      sp.set('pageSize', String(pageSize));
      const data = await api.get(`/admin/trade/fund/list?${sp.toString()}`);
      setItems(Array.isArray(data?.items) ? data.items : []);
      setTotal(Number(data?.total || 0));
    } catch (_) { setItems([]); setTotal(0); } finally { setLoading(false); }
  };
  useEffect(() => { fetchList(); }, [page, pageSize]);

  const fetchOrders = async () => {
    try {
      const sp = new URLSearchParams();
      sp.set('status', orderTab);
      sp.set('page', String(orderPage));
      sp.set('pageSize', String(orderPageSize));
      if (orderPhoneFund.trim()) sp.set('phone', orderPhoneFund.trim());
      try {
        const sess = JSON.parse(localStorage.getItem('sessionUser') || '{}');
        if (sess?.role === 'operator' && sess?.id) sp.set('operatorId', String(sess.id));
        else if (sess?.role === 'admin' && sess?.id) sp.set('adminId', String(sess.id));
      } catch { }
      const data = await api.get(`/admin/trade/fund/orders?${sp.toString()}`);
      setOrders(Array.isArray(data?.items) ? data.items : []);
      setOrdersTotal(Number(data?.total || 0));
    } catch (_) { setOrders([]); setOrdersTotal(0); }
  };
  useEffect(() => { fetchOrders(); }, [orderTab, orderPage, orderPageSize]);

  const submitAdd = async () => {
    const tiersArr = parseTiers(form.tiers);
    if (!tiersArr || tiersArr.length !== 4) { alert('申购价格及配息格式不正确或不足 4 行'); return; }
    if (!form.nameEs || !form.nameEn) { alert('请输入基金名称（西语/英文）'); return; }
    if (!form.code) { alert('请输入基金代码'); return; }
    if (!form.descEs || !form.descEn) { alert('请输入基金介绍（西语/英文）'); return; }
    if (!['day', 'week', 'month'].includes(form.dividend)) { alert('请选择配息方式'); return; }
    if (!/^[0-9]+$/.test(String(form.redeemDays || ''))) { alert('请输入赎回周期（天数）'); return; }
    const payload = { nameEs: form.nameEs.trim(), nameEn: form.nameEn.trim(), code: form.code.trim().toUpperCase(), descEs: form.descEs.trim(), descEn: form.descEn.trim(), tiers: tiersArr, dividend: form.dividend, redeemDays: Number(form.redeemDays), currency: form.currency };
    try {
      if (fundEditId) {
        await api.post(`/admin/trade/fund/${fundEditId}/update`, payload);
        alert('已更新基金');
      } else {
        await api.post('/admin/trade/fund/create', payload);
        alert('已添加基金');
      }
      setShowAdd(false);
      setForm({ nameEs: '', nameEn: '', code: '', descEs: '', descEn: '', tiers: '', dividend: 'day', redeemDays: '7', currency: 'MXN' });
      setPage(1);
      fetchList();
    } catch (e) { alert('提交失败: ' + (e?.message || e)); }
  };

  const openFundEdit = (it) => {
    setFundEditId(it.id);
    setShowAdd(true);
    const tiersStr = typeof it.tiers === 'string' ? it.tiers : JSON.stringify(Array.isArray(it.tiers) ? it.tiers : []);
    const tiersLines = (() => { try { const arr = JSON.parse(tiersStr || '[]'); return arr.map(t => `${t.price},${t.percent}`).join('\n'); } catch { return ''; } })();
    setForm({
      nameEs: String(it.nameEs || ''),
      nameEn: String(it.nameEn || ''),
      code: String(it.code || ''),
      descEs: String(it.descEs || ''),
      descEn: String(it.descEn || ''),
      tiers: tiersLines,
      dividend: String(it.dividend || 'day'),
      redeemDays: String(it.redeem_days || '7'),
      currency: String(it.currency || 'MXN'),
    });
  };

  const removeFund = async (id) => {
    if (!confirm('确认删除该基金？')) return;
    try { await api.delete(`/admin/trade/fund/${id}`); fetchList(); } catch (e) { alert('删除失败: ' + (e?.message || e)); }
  };

  const approveOrder = async (id) => {
    if (!confirm('确认通过该基金申购并开始配息？')) return;
    try { await api.post(`/admin/trade/fund/orders/${id}/approve`, {}); alert('已通过'); fetchOrders(); } catch (e) { alert('操作失败: ' + (e?.message || e)); }
  };
  const rejectOrder = async (id) => {
    const reason = prompt('请输入驳回原因（可选）') || '';
    try { await api.post(`/admin/trade/fund/orders/${id}/reject`, { notes: reason }); alert('已驳回'); fetchOrders(); } catch (e) { alert('操作失败: ' + (e?.message || e)); }
  };

  const totalPages = Math.max(1, Math.ceil((total || 0) / (pageSize || 20)));
  const ordersTotalPages = Math.max(1, Math.ceil((ordersTotal || 0) / (orderPageSize || 20)));

  const fmtRemaining = (ts, unlocked) => {
    try {
      if (unlocked) return '已解锁';
      if (!ts || !Number.isFinite(Number(ts))) return '-';
      const diff = Number(ts) - Date.now();
      if (diff <= 0) return '已解锁';
      const d = Math.floor(diff / (24 * 3600e3));
      const h = Math.floor((diff % (24 * 3600e3)) / 3600e3);
      const m = Math.floor((diff % 3600e3) / 60e3);
      return `${d}天${h}小时${m}分`;
    } catch { return '-'; }
  };
  const formatNextPayout = (ts) => {
    if (!ts) return '-';
    const diff = Number(ts) - Date.now();
    if (!Number.isFinite(diff)) return '-';
    if (diff <= 0) return '已到期';
    const d = Math.floor(diff / (24 * 3600e3));
    const h = Math.floor((diff % (24 * 3600e3)) / 3600e3);
    const m = Math.floor((diff % 3600e3) / 60e3);
    return `${d > 0 ? d + '天' : ''}${h > 0 ? h + '小时' : ''}${m > 0 ? m + '分' : ''}` || `${m}分`;
  };
  const toggleLock = async (o) => {
    try {
      if (o.forced_unlocked) {
        await api.post(`/admin/trade/fund/orders/${o.id}/lock`, {});
        alert('已锁定');
      } else {
        await api.post(`/admin/trade/fund/orders/${o.id}/unlock`, {});
        alert('已解除锁定');
      }
      fetchOrders();
    } catch (e) { alert('操作失败: ' + (e?.message || e)); }
  };
  const deleteOrder = async (id) => { if (!confirm('确认删除该订单？资金不返还且停止后续配息')) return; try { await api.delete(`/admin/trade/fund/orders/${id}`); alert('已删除'); fetchOrders(); } catch (e) { alert('删除失败: ' + (e?.message || e)); } };

  return (
    <div className="card flat">
      <h1 className="title">基金</h1>
      {session?.role !== 'operator' && (
        <>
          <div className="form admin-form-compact" style={{ marginTop: 10 }}>
            <label className="label">搜索基金</label>
            <input className="input" placeholder="输入代码或名称关键词" value={q} onChange={e => setQ(e.target.value)} />
            <div className="sub-actions" style={{ justifyContent: 'flex-start', gap: 8 }}>
              <button className="btn" onClick={() => { setPage(1); fetchList(); }}>查询</button>
              <button className="btn primary" onClick={() => setShowAdd(true)}>添加</button>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={{ padding: '8px 6px' }}>代码</th>
                  <th style={{ padding: '8px 6px' }}>名称</th>
                  <th style={{ padding: '8px 6px' }}>配息</th>
                  <th style={{ padding: '8px 6px' }}>赎回</th>
                  <th style={{ padding: '8px 6px' }}>状态</th>
                  <th style={{ padding: '8px 6px' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.id} style={{ borderTop: '1px solid #263b5e' }}>
                    <td style={{ padding: '8px 6px' }}>{it.code}</td>
                    <td style={{ padding: '8px 6px' }}>{it.nameEs} / {it.nameEn}</td>
                    <td style={{ padding: '8px 6px' }}>{it.dividend}</td>
                    <td style={{ padding: '8px 6px' }}>{it.redeem_days} 天</td>
                    <td style={{ padding: '8px 6px' }}>{it.status || 'active'}</td>
                    <td style={{ padding: '8px 6px', position: 'relative' }}>
                      <button className="btn" onClick={() => setFundOpsId(fundOpsId === it.id ? null : it.id)}>操作</button>
                      {fundOpsId === it.id && (
                        <div className="card" style={{ position: 'absolute', zIndex: 10, padding: 8, right: 8 }}>
                          <button className="btn slim" style={{ width: '100%' }} onClick={() => { setFundOpsId(null); openFundEdit(it); }}>编辑</button>
                          <button className="btn slim" style={{ width: '100%', marginTop: 6 }} onClick={() => { setFundOpsId(null); removeFund(it.id); }}>删除</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td colSpan={5} className="desc" style={{ padding: '10px 6px' }}>{loading ? '加载中...' : '暂无数据'}</td></tr>
                )}
              </tbody>
            </table>
            <div className="sub-actions" style={{ justifyContent: 'space-between', marginTop: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="desc">每页</span>
                <select className="input" value={pageSize} onChange={e => { setPageSize(parseInt(e.target.value, 10)); setPage(1); }}>
                  {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                <span className="desc">共 {total} 条</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button className="btn" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>上一页</button>
                <span className="desc">{page} / {totalPages}</span>
                <button className="btn" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>下一页</button>
              </div>
            </div>
          </div>
        </>
      )}

      <div style={{ marginTop: 20 }}>
        <h2 className="title" style={{ marginTop: 0 }}>订单审核</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          {['submitted', 'approved', 'rejected'].map(s => {
            const txt = s === 'submitted' ? '待审核' : s === 'approved' ? '已通过' : '已驳回';
            return (
              <button
                key={s}
                className={`btn ${orderTab === s ? 'primary' : ''}`}
                style={{ height: 32, padding: '0 12px', fontSize: 13 }}
                onClick={() => { setOrderTab(s); setOrderPage(1); }}
              >
                {txt}
              </button>
            );
          })}
        </div>
        <div className="form admin-form-compact" style={{ marginTop: 10 }}>
          <label className="label">按手机号查询订单</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8 }}>
            <input className="input" placeholder="输入用户手机号" value={orderPhoneFund} onChange={e => setOrderPhoneFund(e.target.value)} />
            <button className="btn" onClick={() => { setOrderPage(1); fetchOrders(); }}>查询</button>
            <button className="btn" onClick={() => { setOrderPhoneFund(''); setOrderPage(1); fetchOrders(); }}>重置</button>
          </div>
        </div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <th style={{ padding: '8px 6px' }}>用户</th>
            <th style={{ padding: '8px 6px' }}>手机号</th>
            <th style={{ padding: '8px 6px' }}>基金</th>
            <th style={{ padding: '8px 6px' }}>价格</th>
            <th style={{ padding: '8px 6px' }}>配息比例</th>
            <th style={{ padding: '8px 6px' }}>提交时间</th>
            <th style={{ padding: '8px 6px' }}>封闭期剩余</th>
            <th style={{ padding: '8px 6px' }}>上次配息</th>
            <th style={{ padding: '8px 6px' }}>下次配息</th>
            <th style={{ padding: '8px 6px' }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {orders.map(o => (
            <tr key={o.id} style={{ borderTop: '1px solid #263b5e' }}>
              <td style={{ padding: '8px 6px' }}>{o.userName || o.userId}</td>
              <td style={{ padding: '8px 6px' }}>{o.phone || '-'}</td>
              <td style={{ padding: '8px 6px' }}>{o.code}</td>
              <td style={{ padding: '8px 6px' }}>{o.price}</td>
              <td style={{ padding: '8px 6px' }}>{o.percent}%</td>
              <td style={{ padding: '8px 6px' }}>{o.submitted_at}</td>
              <td style={{ padding: '8px 6px' }}>{o.status === 'approved' ? fmtRemaining(o.lock_until_ts, o.forced_unlocked) : '-'}</td>
              <td style={{ padding: '8px 6px' }}>{o.last_payout_at ? String(o.last_payout_at).replace(/:00\.000Z$/, '').replace(/\.\d+Z$/, 'Z') : '-'}</td>
              <td style={{ padding: '8px 6px' }}>{formatNextPayout(o.next_payout_ts)}</td>
              <td style={{ padding: '8px 6px', position: 'relative' }}>
                {o.status === 'submitted' ? (
                  <>
                    <button className="btn" onClick={() => setFundOrderOpsOpenId(fundOrderOpsOpenId === o.id ? null : o.id)}>操作</button>
                    {fundOrderOpsOpenId === o.id && (
                      <div className="card" style={{ position: 'absolute', zIndex: 10, padding: 8, right: 8 }}>
                        <>
                          <button className="btn slim primary" style={{ width: '100%' }} onClick={() => { setFundOrderOpsOpenId(null); approveOrder(o.id); }}>通过</button>
                          <button className="btn slim" style={{ width: '100%', marginTop: 6 }} onClick={() => { setFundOrderOpsOpenId(null); rejectOrder(o.id); }}>驳回</button>
                        </>
                      </div>
                    )}
                  </>
                ) : o.status === 'approved' ? (
                  <>
                    <button className="btn" onClick={() => setFundOrderOpsOpenId(fundOrderOpsOpenId === o.id ? null : o.id)}>操作</button>
                    {fundOrderOpsOpenId === o.id && (
                      <div className="card" style={{ position: 'absolute', zIndex: 10, padding: 8, right: 8 }}>
                        <button className="btn slim" style={{ width: '100%' }} onClick={() => { setFundOrderOpsOpenId(null); toggleLock(o); }}>{o.forced_unlocked ? '锁定' : '解除锁定'}</button>
                        <button className="btn slim" style={{ width: '100%', marginTop: 6 }} onClick={() => { setFundOrderOpsOpenId(null); runPayoutOnce(); }}>立即配息</button>
                        <button className="btn slim danger" style={{ width: '100%', marginTop: 6 }} onClick={() => { setFundOrderOpsOpenId(null); deleteOrder(o.id); }}>删除订单</button>
                      </div>
                    )}
                  </>
                ) : (<span className="desc">—</span>)}
              </td>
            </tr>
          ))}
          {orders.length === 0 && (
            <tr><td colSpan={10} className="desc" style={{ padding: '10px 6px' }}>暂无订单</td></tr>
          )}
        </tbody>
      </table>
      <div className="sub-actions" style={{ justifyContent: 'space-between', marginTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="desc">每页</span>
          <select className="input" value={orderPageSize} onChange={e => { setOrderPageSize(parseInt(e.target.value, 10)); setOrderPage(1); }}>
            {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <span className="desc">共 {ordersTotal} 条</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn" disabled={orderPage <= 1} onClick={() => setOrderPage(p => Math.max(1, p - 1))}>上一页</button>
          <span className="desc">{orderPage} / {ordersTotalPages}</span>
          <button className="btn" disabled={orderPage >= ordersTotalPages} onClick={() => setOrderPage(p => Math.min(ordersTotalPages, p + 1))}>下一页</button>
        </div>
      </div>

      {showAdd && session?.role !== 'operator' ? (
        <div className="modal" style={{ alignItems: 'flex-start', paddingTop: 100 }}>
          <div className="modal-card" style={{ maxWidth: 720 }}>
            <h2 className="title" style={{ marginTop: 0 }}>{fundEditId ? '编辑基金' : '添加基金'}</h2>
            <div className="form">
              <label className="label">基金名称（西语）</label>
              <input className="input" placeholder={'如 Fondo Prueba'} value={form.nameEs} onChange={e => setForm(f => ({ ...f, nameEs: e.target.value }))} />
              <label className="label">基金名称（英文）</label>
              <input className="input" placeholder={'如 Test Fund'} value={form.nameEn} onChange={e => setForm(f => ({ ...f, nameEn: e.target.value }))} />
              <label className="label">基金代码</label>
              <input className="input" placeholder={'如 FNDX001'} value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} />
              <label className="label">基金介绍（西语）</label>
              <textarea className="input" rows={3} placeholder={'基金介绍（西语）'} value={form.descEs} onChange={e => setForm(f => ({ ...f, descEs: e.target.value }))} />
              <label className="label">基金介绍（英文）</label>
              <textarea className="input" rows={3} placeholder={'基金介绍（英文）'} value={form.descEn} onChange={e => setForm(f => ({ ...f, descEn: e.target.value }))} />
              <label className="label">申购价格与配息比例</label>
              <div className="desc">每行格式：价格,比例%，共4行，例如：2000,15%\n5000,20%\n10000,25%\n20000,30%</div>
              <textarea className="input" rows={6} placeholder={'价格,比例%（每行一组，共4行）'} value={form.tiers} onChange={e => setForm(f => ({ ...f, tiers: e.target.value }))} />
              <label className="label">配息方式</label>
              <select className="input" value={form.dividend} onChange={e => setForm(f => ({ ...f, dividend: e.target.value }))}>
                <option value="day">day</option>
                <option value="week">week</option>
                <option value="month">month</option>
              </select>
              <label className="label">赎回周期（天）</label>
              <input className="input" placeholder={'如 7'} value={form.redeemDays} onChange={e => setForm(f => ({ ...f, redeemDays: e.target.value }))} />
              <label className="label">币种</label>
              <select className="input" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
                <option value="MXN">MXN</option>
                <option value="USD">USD</option>
                <option value="USDT">USDT</option>
              </select>
              <div className="sub-actions" style={{ justifyContent: 'flex-end', gap: 10 }}>
                <button className="btn" onClick={() => { setShowAdd(false); setFundEditId(null); }}>取消</button>
                <button className="btn primary" onClick={submitAdd}>提交</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>

  );
}
function KycReviewModal({ open, onClose, user }) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('submitted');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [preview, setPreview] = useState(null);
  const fetchList = async () => {
    try {
      setLoading(true);
      const sp = new URLSearchParams();
      if (status) sp.set('status', status);
      if (q.trim()) sp.set('q', q.trim());
      if (from) sp.set('from', from);
      if (to) sp.set('to', to);
      sp.set('page', String(page));
      sp.set('pageSize', String(pageSize));
      const data = await api.get(`/admin/kyc/list?${sp.toString()}`);
      setItems(Array.isArray(data?.items) ? data.items : []);
      setTotal(Number(data?.total || 0));
    } catch (e) {
      setItems([]); setTotal(0);
    } finally { setLoading(false); }
  };
  useEffect(() => { if (open) fetchList(); }, [open, status, page, pageSize]);
  const approve = async (id) => {
    try { await api.post('/admin/kyc/approve', { id }); alert('已通过'); fetchList(); } catch (e) { alert('操作失败: ' + (e?.message || e)); }
  };
  const reject = async (id) => {
    const notes = prompt('驳回原因（必填）') || '';
    if (!notes.trim()) return;
    try { await api.post('/admin/kyc/reject', { id, notes }); alert('已驳回'); fetchList(); } catch (e) { alert('操作失败: ' + (e?.message || e)); }
  };
  if (!open) return null;
  return (
    <div className="modal" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div className="modal-card" style={{ width: '88vw', maxHeight: '80vh', overflow: 'auto' }}>
        <h2 className="title" style={{ marginTop: 0 }}>实名认证审核</h2>
        <div className="form admin-form-compact" style={{ marginTop: 10 }}>
          <label className="label">状态</label>
          <select className="input" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="submitted">submitted</option>
            <option value="approved">approved</option>
            <option value="rejected">rejected</option>
          </select>
          <label className="label">关键词</label>
          <input className="input" placeholder="用户姓名/手机号" value={q} onChange={e => setQ(e.target.value)} />
          <label className="label">起止时间</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input className="input" type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} />
            <input className="input" type="datetime-local" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <div className="sub-actions" style={{ justifyContent: 'flex-start', gap: 8, marginTop: 8 }}>
            <button className="btn" onClick={() => { setPage(1); fetchList(); }}>查询</button>
            <button className="btn" onClick={() => { setQ(''); setFrom(''); setTo(''); setStatus('submitted'); setPage(1); fetchList(); }}>重置</button>
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th style={{ padding: '8px 6px' }}>用户</th>
                <th style={{ padding: '8px 6px' }}>提交时间</th>
                <th style={{ padding: '8px 6px' }}>状态</th>
                <th style={{ padding: '8px 6px' }}>字段</th>
                <th style={{ padding: '8px 6px' }}>图片</th>
                <th style={{ padding: '8px 6px' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id} style={{ borderTop: '1px solid #263b5e' }}>
                  <td style={{ padding: '8px 6px' }}>{it.userName || it.phone || it.userId}</td>
                  <td style={{ padding: '8px 6px' }}>{it.submitted_at}</td>
                  <td style={{ padding: '8px 6px' }}>{it.status}</td>
                  <td style={{ padding: '8px 6px' }}>
                    <div className="desc">{Object.entries(it.fields || {}).map(([k, v]) => `${k}: ${v}`).join(' | ') || '-'}</div>
                  </td>
                  <td style={{ padding: '8px 6px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 80px)', gap: 6 }}>
                      {(Array.isArray(it.photos) ? it.photos : []).map(ph => (
                        <img key={ph.id || ph.thumbUrl || ph.url} src={ph.thumbUrl || ph.url} style={{ width: 80, height: 80, objectFit: 'cover', cursor: 'pointer', borderRadius: 4 }} onClick={() => setPreview(ph.url || ph.thumbUrl)} />
                      ))}
                    </div>
                  </td>
                  <td style={{ padding: '8px 6px' }}>
                    {it.status === 'submitted' ? (
                      <>
                        <button className="btn primary" style={{ height: 32 }} onClick={() => approve(it.id)}>通过</button>
                        <button className="btn" style={{ height: 32, marginLeft: 8 }} onClick={() => reject(it.id)}>驳回</button>
                      </>
                    ) : (
                      <span className="desc">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={6} className="desc" style={{ padding: '10px 6px' }}>{loading ? '加载中...' : '暂无数据'}</td></tr>
              )}
            </tbody>
          </table>
          <div className="sub-actions" style={{ justifyContent: 'space-between', marginTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="desc">每页</span>
              <select className="input" value={pageSize} onChange={e => { setPageSize(parseInt(e.target.value, 10)); setPage(1); }}>
                {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <span className="desc">共 {total} 条</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button className="btn" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>上一页</button>
              <span className="desc">{page} / {Math.max(1, Math.ceil((total || 0) / (pageSize || 20)))}</span>
              <button className="btn" disabled={page >= Math.max(1, Math.ceil((total || 0) / (pageSize || 20)))} onClick={() => setPage(p => Math.min(Math.max(1, Math.ceil((total || 0) / (pageSize || 20))), p + 1))}>下一页</button>
            </div>
          </div>
        </div>
        <div className="sub-actions" style={{ justifyContent: 'flex-end', gap: 10 }}>
          <button className="btn" onClick={onClose}>关闭</button>
        </div>
      </div>
      {preview && (
        <div className="modal" style={{ alignItems: 'center', justifyContent: 'center' }} onClick={() => setPreview(null)}>
          <div className="modal-card" style={{ padding: 0, overflow: 'hidden' }}>
            <img src={preview} style={{ maxWidth: '88vw', maxHeight: '80vh', objectFit: 'contain' }} />
          </div>
        </div>
      )}
    </div>
  );
}
function KycReviewPage() {
  const [status, setStatus] = useState('submitted');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const fetchList = async () => {
    try {
      setLoading(true);
      const sp = new URLSearchParams();
      if (status) sp.set('status', status);
      if (q.trim()) sp.set('q', q.trim());
      if (from) sp.set('from', from);
      if (to) sp.set('to', to);
      sp.set('page', String(page));
      sp.set('pageSize', String(pageSize));
      const data = await api.get(`/admin/kyc/list?${sp.toString()}`);
      setItems(Array.isArray(data?.items) ? data.items : []);
      setTotal(Number(data?.total || 0));
    } catch (e) {
      setItems([]); setTotal(0);
    } finally { setLoading(false); }
  };
  useEffect(() => { fetchList(); }, [status, page, pageSize]);
  const approve = async (id) => { try { await api.post('/admin/kyc/approve', { id }); alert('已通过'); fetchList(); } catch (e) { alert('操作失败: ' + (e?.message || e)); } };
  const reject = async (id) => { const notes = prompt('驳回原因（必填）') || ''; if (!notes.trim()) return; try { await api.post('/admin/kyc/reject', { id, notes }); alert('已驳回'); fetchList(); } catch (e) { alert('操作失败: ' + (e?.message || e)); } };

  const statusMap = useMemo(() => ({ submitted: '待审核', approved: '已通过', rejected: '已驳回' }), []);
  return (
    <div style={{ marginTop: 10 }}>
      <div className="form admin-form-compact">
        <label className="label">状态</label>
        <select className="input" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="submitted">待审核</option>
          <option value="approved">已通过</option>
          <option value="rejected">已驳回</option>
        </select>
        <label className="label">关键词</label>
        <input className="input" placeholder="用户姓名/手机号" value={q} onChange={e => setQ(e.target.value)} />
        <label className="label">起止时间</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <input className="input" type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} />
          <input className="input" type="datetime-local" value={to} onChange={e => setTo(e.target.value)} />
        </div>
        <div className="sub-actions" style={{ justifyContent: 'flex-start', gap: 8, marginTop: 8 }}>
          <button className="btn" onClick={() => { setPage(1); fetchList(); }}>查询</button>
          <button className="btn" onClick={() => { setQ(''); setFrom(''); setTo(''); setStatus('submitted'); setPage(1); fetchList(); }}>重置</button>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th style={{ padding: '8px 6px' }}>用户</th>
              <th style={{ padding: '8px 6px' }}>提交时间</th>
              <th style={{ padding: '8px 6px' }}>状态</th>
              <th style={{ padding: '8px 6px' }}>审核字段</th>
              <th style={{ padding: '8px 6px' }}>证件照片</th>
              <th style={{ padding: '8px 6px' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map(it => (
              <tr key={it.id} style={{ borderTop: '1px solid #263b5e' }}>
                <td style={{ padding: '8px 6px' }}>{it.userName || it.phone || it.userId}</td>
                <td style={{ padding: '8px 6px' }}>{it.submitted_at}</td>
                <td style={{ padding: '8px 6px' }}>{statusMap[it.status] || it.status}</td>
                <td style={{ padding: '8px 6px' }}>
                  <div className="desc">姓名：{it.fields?.name || '-'} | 证件类型：{it.fields?.idType || '-'} | 证件号码：{it.fields?.idNumber || '-'}</div>
                </td>
                <td style={{ padding: '8px 6px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 80px)', gap: 6 }}>
                    {(Array.isArray(it.photos) ? it.photos : []).map(ph => (
                      <img key={ph.id || ph.thumbUrl || ph.url} src={ph.thumbUrl || ph.url} style={{ width: 80, height: 80, objectFit: 'cover', cursor: 'pointer', borderRadius: 4 }} onClick={() => setPreview(ph.url || ph.thumbUrl)} />
                    ))}
                  </div>
                </td>
                <td style={{ padding: '8px 6px' }}>
                  {it.status === 'submitted' ? (
                    <>
                      <button className="btn primary" style={{ height: 32 }} onClick={() => approve(it.id)}>通过</button>
                      <button className="btn" style={{ height: 32, marginLeft: 8 }} onClick={() => reject(it.id)}>驳回</button>
                    </>
                  ) : (
                    <span className="desc">—</span>
                  )}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={6} className="desc" style={{ padding: '10px 6px' }}>{loading ? '加载中...' : '暂无数据'}</td></tr>
            )}
          </tbody>
        </table>
        <div className="sub-actions" style={{ justifyContent: 'space-between', marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="desc">每页</span>
            <select className="input" value={pageSize} onChange={e => { setPageSize(parseInt(e.target.value, 10)); setPage(1); }}>
              {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <span className="desc">共 {total} 条</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="btn" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>上一页</button>
            <span className="desc">{page} / {Math.max(1, Math.ceil((total || 0) / (pageSize || 20)))}</span>
            <button className="btn" disabled={page >= Math.max(1, Math.ceil((total || 0) / (pageSize || 20)))} onClick={() => setPage(p => Math.min(Math.max(1, Math.ceil((total || 0) / (pageSize || 20))), p + 1))}>下一页</button>
          </div>
        </div>

        {preview && (
          <div className="modal" style={{ alignItems: 'center', justifyContent: 'center' }} onClick={() => setPreview(null)}>
            <div className="modal-card" style={{ padding: 0, overflow: 'hidden' }}>
              <img src={preview} style={{ maxWidth: '88vw', maxHeight: '80vh', objectFit: 'contain' }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

