import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import Redis from 'ioredis';
import https from 'https';
import nodemailer from 'nodemailer';

const app = express();
const PROD = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
const ADMIN_OTP_REQUIRED = String(process.env.ADMIN_OTP_REQUIRED || (PROD ? '1' : '0')).trim() === '1';
const COOKIE_SAMESITE = String(process.env.COOKIE_SAMESITE || (PROD ? 'Lax' : 'Lax')).trim();
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || (PROD ? '1' : '0')).trim() === '1';
const ENABLE_LOGIN_RATE_LIMIT = String(process.env.ENABLE_LOGIN_RATE_LIMIT || (PROD ? '1' : '0')).trim() === '1';

const PORT = Number(process.env.PORT || 5210);
const DB_PATH = process.env.DB_PATH || '/app/data/app.db';

// 手续费率：千分之一 (0.1%)
const TRADE_FEE_RATE = Number(process.env.TRADE_FEE_RATE || 0.001);
const FALLBACK_DB_PATH = '/var/lib/docker/volumes/mxg-data/_data/app.db';
const LOCAL_DB_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'data', 'app.db');
const resolvedDbPath = (() => {
  try { if (fs.existsSync(DB_PATH)) return DB_PATH; } catch { }
  try { if (fs.existsSync(FALLBACK_DB_PATH)) return FALLBACK_DB_PATH; } catch { }
  try { if (fs.existsSync(LOCAL_DB_PATH)) return LOCAL_DB_PATH; } catch { }
  return LOCAL_DB_PATH;
})();
try {
  const dirEnsure = path.dirname(resolvedDbPath);
  if (!fs.existsSync(dirEnsure)) {
    fs.mkdirSync(dirEnsure, { recursive: true });
  }
} catch { }
// Enforce encrypted storage marker in production if required
try {
  const REQUIRE_ENC = String(process.env.REQUIRE_ENCRYPTED_DB || '').trim() === '1';
  if (REQUIRE_ENC && PROD) {
    const marker = String(process.env.DB_ENC_MARKER_FILE || '').trim() || path.join(path.dirname(resolvedDbPath), 'enc.ok');
    if (!fs.existsSync(marker)) { try { console.error('[mxg-backend] encrypted DB marker not found:', marker); } catch { }; process.exit(1); }
    const fieldKey = String(process.env.DB_FIELD_ENC_KEY || '').trim();
    if (!fieldKey || fieldKey.length !== 64) { try { console.error('[mxg-backend] DB_FIELD_ENC_KEY (64-hex) required in production'); } catch { }; process.exit(1); }
  }
} catch { }
// 若数据库不存在则初始化（创建表与默认数据）
let needInit = false;
try { needInit = !fs.existsSync(resolvedDbPath); } catch { needInit = false; }
const db = new Database(resolvedDbPath, { fileMustExist: false });

const DB_BACKUP_BEFORE_MIGRATION = String(process.env.DB_BACKUP_BEFORE_MIGRATION || '1') === '1';
function backupDatabaseFile() {
  try {
    if (!DB_BACKUP_BEFORE_MIGRATION) return;
    if (!fs.existsSync(resolvedDbPath)) return;
    const ts = new Date().toISOString().replace(/[-:]/g, '').replace('T', '').slice(0, 14);
    const toPlain = resolvedDbPath.replace(/\.db$/, `.bak.${ts}.db`);
    const toEnc = resolvedDbPath.replace(/\.db$/, `.bak.${ts}.db.enc`);
    fs.copyFileSync(resolvedDbPath, toPlain);
    try {
      const keyHex = String(process.env.DB_ENC_KEY || '').trim();
      if (keyHex && keyHex.length === 64) {
        const iv = crypto.randomBytes(12);
        const key = Buffer.from(keyHex, 'hex');
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const data = fs.readFileSync(toPlain);
        const enc = Buffer.concat([cipher.update(data), cipher.final()]);
        const tag = cipher.getAuthTag();
        fs.writeFileSync(toEnc, Buffer.concat([iv, enc, tag]));
        try { fs.unlinkSync(toPlain); } catch { }
      }
    } catch { }
  } catch { }
}

// Frontend dist directory (served by backend for production domains)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_DIST = path.resolve(__dirname, 'moxige', 'dist');
const UPLOADS_DIR = path.resolve(__dirname, 'data', 'uploads');
try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch { }

function runMigrations() {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  // 启用外键
  db.exec('PRAGMA foreign_keys = ON;');
  // 用户表
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT,
    password_hash TEXT,
    name TEXT,
    created_at TEXT,
    updated_at TEXT,
    phone TEXT UNIQUE,
    role TEXT,
    last_login_ip TEXT,
    assigned_admin_id INTEGER,
    assigned_operator_id INTEGER
  );`);
  // 兼容旧库：补充缺失的列（SQLite 不支持 IF NOT EXISTS 列，采用运行时检测）
  try {
    const cols = db.prepare('PRAGMA table_info(users)').all().map(r => String(r.name));
    const addCol = (name, def) => {
      if (!cols.includes(name)) {
        try { db.exec(`ALTER TABLE users ADD COLUMN ${name} ${def};`); } catch (e) { /* ignore */ }
      }
    };
    addCol('account', 'TEXT');
    addCol('last_login_ip', 'TEXT');
    addCol('assigned_admin_id', 'INTEGER');
    addCol('assigned_operator_id', 'INTEGER');
    addCol('avatar', 'TEXT');
    addCol('avatar_mime', 'TEXT');
    addCol('avatar_updated_at', 'TEXT');
    addCol('disallow_trading', 'INTEGER');
    addCol('last_login_country', 'TEXT');
    addCol('disallow_login', 'INTEGER');
    addCol('lang', 'TEXT');
    addCol('invite_code', 'TEXT');
    addCol('otp_enabled', 'INTEGER');
    addCol('otp_secret', 'TEXT');
    addCol('referral_code', 'TEXT');
    addCol('invited_by_user_id', 'INTEGER');
    addCol('credit_score', 'INTEGER');
    addCol('trade_password', 'TEXT');
  } catch { }
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS institution_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT,
      desc TEXT,
      avatar TEXT,
      updated_at TEXT
    );`);
    const exists = db.prepare('SELECT id FROM institution_profile WHERE id = 1').get();
    if (!exists) db.prepare('INSERT INTO institution_profile (id, name, desc, avatar, updated_at) VALUES (1, ?, ?, ?, ?)')
      .run('Institution', 'Welcome to our institution. Trade responsibly.', '/logo.png', new Date().toISOString());
  } catch { }
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS withdraw_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      currency TEXT,
      amount REAL,
      method_type TEXT,
      bank_account TEXT,
      usdt_address TEXT,
      usdt_network TEXT,
      status TEXT,
      operator_id INTEGER,
      created_at TEXT,
      updated_at TEXT,
      canceled_at TEXT,
      completed_at TEXT,
      rejected_at TEXT
    );`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_withdraw_user ON withdraw_orders(user_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_withdraw_status ON withdraw_orders(status)');
  } catch { }
  // token 表
  db.exec(`CREATE TABLE IF NOT EXISTS tokens (
    token TEXT PRIMARY KEY,
    user_id INTEGER,
    exp INTEGER,
    created_at TEXT
  );`);
  try {
    const tcols = db.prepare('PRAGMA table_info(tokens)').all().map(r => String(r.name))
    if (!tcols.includes('token_hash')) { try { db.exec('ALTER TABLE tokens ADD COLUMN token_hash TEXT'); } catch { } }
    if (tcols.includes('token')) {
      try {
        db.exec('CREATE TABLE IF NOT EXISTS tokens_new (token_hash TEXT PRIMARY KEY, user_id INTEGER, exp INTEGER, created_at TEXT)');
        const rows = db.prepare('SELECT token_hash, user_id, exp, created_at FROM tokens WHERE token_hash IS NOT NULL').all();
        const ins = db.prepare('INSERT INTO tokens_new (token_hash, user_id, exp, created_at) VALUES (?, ?, ?, ?)');
        const tx = db.transaction((arr) => { for (const r of arr) ins.run(r.token_hash, r.user_id, r.exp, r.created_at); });
        tx(rows);
        db.exec('DROP TABLE tokens');
        db.exec('ALTER TABLE tokens_new RENAME TO tokens');
      } catch { }
    }
  } catch { }
  db.exec(`CREATE TABLE IF NOT EXISTS login_throttle (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    k TEXT,
    ip TEXT,
    fail_count INTEGER,
    locked_until INTEGER,
    updated_at TEXT,
    UNIQUE(k, ip)
  );`);
  db.exec(`CREATE TABLE IF NOT EXISTS commission_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    block_pct REAL DEFAULT 5,
    block_freeze_days INTEGER DEFAULT 3,
    fund_pct REAL DEFAULT 5,
    fund_freeze_days INTEGER DEFAULT 3,
    ipo_pct REAL DEFAULT 5,
    ipo_freeze_days INTEGER DEFAULT 3,
    updated_at TEXT
  );`);
  db.exec(`INSERT OR IGNORE INTO commission_settings (id, updated_at) VALUES (1, datetime('now'))`);
  db.exec(`CREATE TABLE IF NOT EXISTS commission_wallets (
    user_id INTEGER,
    currency TEXT,
    amount REAL,
    updated_at TEXT,
    UNIQUE(user_id, currency)
  );`);
  db.exec(`CREATE TABLE IF NOT EXISTS commission_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inviter_id INTEGER,
    invitee_id INTEGER,
    source TEXT,
    order_id INTEGER,
    currency TEXT,
    amount REAL,
    status TEXT,
    frozen_until TEXT,
    created_at TEXT,
    released_at TEXT,
    notes TEXT
  );`);
  // 余额表（user_id + currency 唯一）
  db.exec(`CREATE TABLE IF NOT EXISTS balances (
    user_id INTEGER,
    currency TEXT,
    amount REAL,
    updated_at TEXT,
    UNIQUE(user_id, currency)
  );`);
  // 闪兑汇率表（管理员可配置）
  db.exec(`CREATE TABLE IF NOT EXISTS swap_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_currency TEXT NOT NULL,
    to_currency TEXT NOT NULL,
    rate REAL NOT NULL,
    active INTEGER DEFAULT 1,
    created_at TEXT,
    updated_at TEXT,
    UNIQUE(from_currency, to_currency)
  );`);
  // 闪兑记录表
  db.exec(`CREATE TABLE IF NOT EXISTS swap_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    from_currency TEXT NOT NULL,
    to_currency TEXT NOT NULL,
    from_amount REAL NOT NULL,
    to_amount REAL NOT NULL,
    rate REAL NOT NULL,
    created_at TEXT
  );`);
  // 持仓表
  db.exec(`CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    symbol TEXT,
    market TEXT,
    long_qty REAL,
    short_qty REAL,
    avg_price REAL,
    long_avg REAL,
    short_avg REAL,
    locked INTEGER,
    created_at TEXT,
    updated_at TEXT,
    UNIQUE(user_id, symbol, market)
  );`);
  // 订单表
  db.exec(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    symbol TEXT,
    market TEXT,
    side TEXT,
    type TEXT,
    price REAL,
    qty REAL,
    status TEXT,
    created_at TEXT,
    updated_at TEXT
  );`);

  db.exec(`CREATE TABLE IF NOT EXISTS payment_methods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    type TEXT,
    label TEXT,
    data TEXT,
    uniq_key TEXT,
    created_at TEXT,
    updated_at TEXT,
    UNIQUE(user_id, type, uniq_key)
  );`);

  db.exec(`CREATE TABLE IF NOT EXISTS fund_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    operator_id INTEGER,
    operator_role TEXT,
    request_id TEXT,
    reason TEXT,
    currency TEXT,
    amount REAL,
    created_at TEXT
  );`);

  db.exec(`CREATE TABLE IF NOT EXISTS block_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market TEXT,
    symbol TEXT,
    price REAL,
    min_qty REAL,
    time_window TEXT,
    start_at TEXT,
    end_at TEXT,
    lock_until TEXT,
    subscribe_key TEXT,
    status TEXT,
    created_at TEXT,
    updated_at TEXT
  );`);
  // 市场交易时间设置
  db.exec(`CREATE TABLE IF NOT EXISTS market_settings (
    id INTEGER PRIMARY KEY,
    mx_enabled INTEGER,
    us_enabled INTEGER,
    mx_holidays TEXT,
    us_holidays TEXT,
    updated_at TEXT
  );`);
  try {
    const row = db.prepare('SELECT id FROM market_settings WHERE id = 1').get();
    if (!row) db.prepare('INSERT INTO market_settings (id, mx_enabled, us_enabled, mx_holidays, us_holidays, updated_at) VALUES (1, 1, 1, ?, ?, ?)').run('', '', new Date().toISOString());
  } catch { }

  // 邮箱验证码表
  db.exec(`CREATE TABLE IF NOT EXISTS email_verification_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );`);

  db.exec(`CREATE TABLE IF NOT EXISTS block_trade_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    block_trade_id INTEGER,
    user_id INTEGER,
    price REAL,
    qty REAL,
    amount REAL,
    status TEXT,
    submitted_at TEXT,
    approved_at TEXT,
    lock_until TEXT,
    notes TEXT
  );`);
  try {
    const cols = db.prepare('PRAGMA table_info(block_trade_orders)').all().map(r => String(r.name));
    const addCol = (name, def) => { if (!cols.includes(name)) { try { db.exec(`ALTER TABLE block_trade_orders ADD COLUMN ${name} ${def};`); } catch { } } };
    addCol('approved_at', 'TEXT');
    addCol('lock_until', 'TEXT');
    addCol('locked', 'INTEGER');
    addCol('sell_price', 'REAL');
    addCol('sell_amount', 'REAL');
    addCol('profit', 'REAL');
    addCol('profit_pct', 'REAL');
    addCol('sold_at', 'TEXT');
    addCol('cost_pln', 'REAL');
    addCol('currency', 'TEXT');
    addCol('fee', 'REAL');
  } catch { }
  try { db.exec("UPDATE block_trade_orders SET locked=1 WHERE status='approved' AND (locked IS NULL OR locked!=1)"); } catch { }

  // 红利股配置表
  db.exec(`CREATE TABLE IF NOT EXISTS dividend_stocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market TEXT,
    symbol TEXT,
    name TEXT,
    price REAL,
    min_qty REAL DEFAULT 1,
    max_qty REAL,
    start_at TEXT,
    end_at TEXT,
    subscribe_key TEXT,
    status TEXT DEFAULT 'active',
    created_at TEXT,
    updated_at TEXT
  );`);

  // 红利股订单表
  db.exec(`CREATE TABLE IF NOT EXISTS dividend_stock_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dividend_stock_id INTEGER,
    user_id INTEGER,
    symbol TEXT,
    market TEXT,
    price REAL,
    qty REAL,
    amount REAL,
    status TEXT DEFAULT 'pending',
    locked INTEGER DEFAULT 1,
    submitted_at TEXT,
    approved_at TEXT,
    sell_price REAL,
    sell_amount REAL,
    profit REAL,
    profit_pct REAL,
    sold_at TEXT,
    notes TEXT,
    currency TEXT
  );`);

  // 红利股订单表迁移
  try {
    const colsDiv = db.prepare('PRAGMA table_info(dividend_stock_orders)').all().map(r => String(r.name));
    const addDivCol = (name, def) => { if (!colsDiv.includes(name)) { try { db.exec(`ALTER TABLE dividend_stock_orders ADD COLUMN ${name} ${def};`); } catch { } } };
    addDivCol('fee', 'REAL');
    addDivCol('sell_fee', 'REAL');
  } catch { }

  try {
    const colsP = db.prepare('PRAGMA table_info(positions)').all().map(r => String(r.name));
    const addPosCol = (name, def) => { if (!colsP.includes(name)) { try { db.exec(`ALTER TABLE positions ADD COLUMN ${name} ${def};`); } catch { } } };
    addPosCol('long_avg', 'REAL');
    addPosCol('short_avg', 'REAL');
    addPosCol('locked', 'INTEGER');
  } catch { }

  app.post('/api/admin/db/migrate', requireRoles(['super', 'admin']), (req, res) => {
    try {
      const cols = db.prepare('PRAGMA table_info(positions)').all().map(r => String(r.name));
      const added = [];
      const addCol = (name, def) => { if (!cols.includes(name)) { try { db.exec(`ALTER TABLE positions ADD COLUMN ${name} ${def};`); added.push(name); } catch { } } };
      addCol('long_avg', 'REAL');
      addCol('short_avg', 'REAL');
      addCol('locked', 'INTEGER');
      posColsCache = null;
      const colsAfter = db.prepare('PRAGMA table_info(positions)').all().map(r => String(r.name));
      res.json({ ok: true, added, cols: colsAfter });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get('/api/admin/db/inspect', requireRoles(['super', 'admin']), (req, res) => {
    try {
      const pos = db.prepare('PRAGMA table_info(positions)').all();
      res.json({ ok: true, positions: pos });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  db.exec(`CREATE TABLE IF NOT EXISTS funds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE,
    name_es TEXT,
    name_en TEXT,
    desc_es TEXT,
    desc_en TEXT,
    tiers TEXT,
    dividend TEXT,
    redeem_days INTEGER,
    currency TEXT,
    status TEXT,
    created_at TEXT,
    updated_at TEXT
  );`);

  try {
    const colsF = db.prepare('PRAGMA table_info(funds)').all().map(r => String(r.name));
    const addFundCol = (name, def) => { if (!colsF.includes(name)) { try { db.exec(`ALTER TABLE funds ADD COLUMN ${name} ${def};`); } catch { } } };
    addFundCol('currency', 'TEXT');
    addFundCol('subscribe_price', 'REAL DEFAULT 0');
    addFundCol('market_price', 'REAL DEFAULT 0');
    addFundCol('dividend_percent', 'REAL DEFAULT 0');
  } catch { }

  // 基金价格历史记录表
  db.exec(`CREATE TABLE IF NOT EXISTS fund_price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fund_id INTEGER,
    price REAL,
    set_by INTEGER,
    created_at TEXT
  );`);

  db.exec(`CREATE TABLE IF NOT EXISTS fund_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    fund_id INTEGER,
    code TEXT,
    price REAL,
    percent REAL,
    qty REAL,
    status TEXT,
    submitted_at TEXT,
    approved_at TEXT,
    notes TEXT,
    next_payout_at TEXT,
    last_payout_at TEXT,
    updated_at TEXT
  );`);
  // Add updated_at column if missing
  try { db.exec(`ALTER TABLE fund_orders ADD COLUMN updated_at TEXT`); } catch (e) { /* column exists */ }

  db.exec(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    title TEXT,
    message TEXT,
    created_at TEXT,
    read INTEGER,
    pinned INTEGER
  );`);
  try {
    const cols = db.prepare('PRAGMA table_info(notifications)').all().map(r => String(r.name));
    const addCol = (name, def) => { if (!cols.includes(name)) { try { db.exec(`ALTER TABLE notifications ADD COLUMN ${name} ${def};`); } catch { } } };
    addCol('title', 'TEXT');
    addCol('pinned', 'INTEGER');
  } catch { }

  db.exec(`CREATE TABLE IF NOT EXISTS ipo_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT,
    name TEXT,
    code TEXT UNIQUE,
    subscribe_price REAL,
    list_price REAL,
    issue_at TEXT,
    subscribe_at TEXT,
    subscribe_end_at TEXT,
    list_at TEXT,
    can_sell_on_listing_day INTEGER,
    currency TEXT,
    released INTEGER,
    status TEXT,
    created_at TEXT,
    updated_at TEXT
  );`);
  try {
    const colsI = db.prepare('PRAGMA table_info(ipo_items)').all().map(r => String(r.name));
    const addColI = (name, def) => { if (!colsI.includes(name)) { try { db.exec(`ALTER TABLE ipo_items ADD COLUMN ${name} ${def};`); } catch { } } };
    addColI('subscribe_end_at', 'TEXT');
    addColI('pair_address', 'TEXT');
    addColI('chain', 'TEXT');
    addColI('token_address', 'TEXT');
    addColI('currency', 'TEXT');
  } catch { }

  db.exec(`CREATE TABLE IF NOT EXISTS ipo_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    item_id INTEGER,
    code TEXT,
    qty REAL,
    price REAL,
    status TEXT,
    submitted_at TEXT,
    approved_at TEXT,
    notes TEXT
  );`);

  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_block_trade_orders_status ON block_trade_orders(status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_block_trade_orders_user ON block_trade_orders(user_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_ipo_orders_user_status ON ipo_orders(user_id, status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_ipo_items_released_code ON ipo_items(released, code)');
  } catch { }

  db.exec(`CREATE TABLE IF NOT EXISTS credit_apps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT,
    phone TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    amount REAL,
    score INTEGER,
    period_value INTEGER,
    period_unit TEXT,
    images TEXT,
    status TEXT,
    created_at TEXT,
    updated_at TEXT
  );`);
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_credit_apps_status ON credit_apps(status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_credit_apps_user ON credit_apps(user_id)');
  } catch { }

  // 种子：超级管理员（可用于后台登录验证与演示）
  const superExists = db.prepare('SELECT id FROM users WHERE phone = ?').get('0000000000');
  const seedEnabled = String(process.env.ENABLE_SEED_SUPER || '').trim() === '1';
  if (!superExists && (!PROD || seedEnabled)) {
    const now = new Date().toISOString();
    const info = db.prepare('INSERT INTO users (email, password_hash, name, created_at, updated_at, phone, role) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('0000000000@phone.local', hashPassword('admin123'), 'Super Admin', now, now, '0000000000', 'super');
    const uid = info.lastInsertRowid;
    // 给演示用户一些初始余额
    db.prepare(`INSERT INTO balances (user_id, currency, amount, updated_at) VALUES (?, 'PLN', 50000, ?)`)
      .run(uid, now);
    db.prepare(`INSERT INTO balances (user_id, currency, amount, updated_at) VALUES (?, 'USD', 1000, ?)`)
      .run(uid, now);
    db.prepare(`INSERT INTO balances (user_id, currency, amount, updated_at) VALUES (?, 'USDT', 0, ?)`)
      .run(uid, now);
  }
  // 演示种子：后台账号（admin 与 822888），便于本地快速登录
  try {
    if (!PROD || seedEnabled) {
      const now = new Date().toISOString();
      const accAdmin = db.prepare("SELECT id FROM users WHERE account = ? AND role IN ('admin','super','operator')").get('admin');
      if (!accAdmin) {
        db.prepare('INSERT INTO users (email, password_hash, name, created_at, updated_at, phone, role, account, assigned_admin_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run('admin@account.local', hashPassword('admin123'), 'Admin', now, now, null, 'admin', 'admin', null);
      }
      const acc822 = db.prepare("SELECT id FROM users WHERE account = ? AND role IN ('admin','super','operator')").get('822888');
      if (!acc822) {
        db.prepare('INSERT INTO users (email, password_hash, name, created_at, updated_at, phone, role, account, assigned_admin_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run('822888@account.local', hashPassword('822888'), 'Admin 822888', now, now, null, 'admin', '822888', null);
      }
    }
  } catch { }
  // 用户加密钱包地址
  db.exec(`CREATE TABLE IF NOT EXISTS user_wallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    network TEXT,
    address TEXT,
    created_at TEXT
  );`);

  // 用户银行卡（仅用于提现绑定）
  db.exec(`CREATE TABLE IF NOT EXISTS user_bank_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    bin TEXT,
    last4 TEXT,
    holder_name TEXT,
    bank_name TEXT,
    created_at TEXT
  );`);
}

try { backupDatabaseFile(); runMigrations(); } catch (e) { console.error('[mxg-backend] migration failed:', e?.message || e); }
try { setInterval(() => { try { db.prepare('DELETE FROM tokens WHERE exp IS NOT NULL AND exp < ?').run(Date.now()); } catch { } }, 60 * 60 * 1000); } catch { }
function scheduleBackupCleanup() {
  try {
    const keepDays = Math.max(1, Number(process.env.DB_BACKUP_RETENTION_DAYS || 14));
    const keepMs = keepDays * 24 * 60 * 60 * 1000;
    const dir = path.dirname(resolvedDbPath);
    const run = () => {
      try {
        const files = fs.readdirSync(dir).filter(n => /\.bak\.[0-9]{14}\.db$/i.test(n));
        const now = Date.now();
        for (const f of files) {
          const fp = path.join(dir, f);
          try { const st = fs.statSync(fp); if (st.isFile() && (now - st.mtimeMs) > keepMs) fs.unlinkSync(fp); } catch { }
        }
      } catch { }
    };
    setInterval(run, 60 * 60 * 1000);
  } catch { }
}
try { scheduleBackupCleanup(); } catch { }

const allowOrigins = String(process.env.CORS_ORIGIN || '').split(/[\s,]+/).filter(Boolean);
const allowAllCors = allowOrigins.length === 0;
if (PROD && allowAllCors) { try { console.error('[mxg-backend] CORS_ORIGIN is required in production') } catch (e) { }; process.exit(1); }
app.use(cors({
  origin: (origin, cb) => {
    try {
      if (allowAllCors || !origin) return cb(null, true);
      const host = new URL(origin).hostname;
      const ok = allowOrigins.some(o => {
        try { const d = new URL(o).hostname || o; return host === d || host.endsWith('.' + d); }
        catch { return host === o || host.endsWith('.' + o); }
      });
      return cb(ok ? null : new Error('cors_denied'), ok);
    } catch { return cb(new Error('cors_denied'), false); }
  },
  credentials: true
}));
app.use(bodyParser.json({ limit: '20mb' }));
const COOKIE_NAME = String(process.env.COOKIE_NAME || 'session_token');
const COOKIE_DOMAIN = String(process.env.COOKIE_DOMAIN || '').trim();
const CSRF_COOKIE_NAME = String(process.env.CSRF_COOKIE_NAME || 'csrf_token');
const CSRF_HEADER_NAME = String(process.env.CSRF_HEADER_NAME || 'x-csrf-token');
function setSessionCookie(res, token) {
  try {
    const opts = { httpOnly: true, sameSite: COOKIE_SAMESITE, secure: COOKIE_SECURE, path: '/' };
    if (COOKIE_DOMAIN) opts.domain = COOKIE_DOMAIN;
    const maxAgeMs = 30 * 24 * 3600 * 1000;
    res.cookie(COOKIE_NAME, token, { ...opts, maxAge: maxAgeMs });
  } catch { }
}
function clearSessionCookie(res) {
  try {
    const opts = { httpOnly: true, sameSite: COOKIE_SAMESITE, secure: COOKIE_SECURE, path: '/' };
    if (COOKIE_DOMAIN) opts.domain = COOKIE_DOMAIN;
    res.cookie(COOKIE_NAME, '', { ...opts, maxAge: 0 });
  } catch { }
}
function parseCookieHeader(h) {
  const out = {}; try { String(h || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) { const k = p.slice(0, i).trim(); const v = p.slice(i + 1).trim(); out[k] = v; } }); } catch { }
  return out;
}
function setCsrfCookie(res) {
  try {
    const token = crypto.randomBytes(16).toString('hex');
    const opts = { httpOnly: false, sameSite: COOKIE_SAMESITE, secure: COOKIE_SECURE, path: '/' };
    if (COOKIE_DOMAIN) opts.domain = COOKIE_DOMAIN;
    const maxAgeMs = 30 * 24 * 3600 * 1000;
    res.cookie(CSRF_COOKIE_NAME, token, { ...opts, maxAge: maxAgeMs });
  } catch { }
}
function csrfGuard(req, res, next) {
  try {
    const m = String(req.method || 'GET').toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(m)) return next();
    const url = String(req.originalUrl || req.url || '');
    if (url.startsWith('/api/auth/')) return next();
    if (url.startsWith('/api/admin/login_account')) return next();
    const authHdr = String(req.headers['authorization'] || '').trim();
    if (/^Bearer\s+/i.test(authHdr)) return next();
    const cookies = parseCookieHeader(req.headers && req.headers.cookie);
    const c = String(cookies[CSRF_COOKIE_NAME] || '').trim();
    const h = String(req.headers[CSRF_HEADER_NAME] || '').trim();
    if (!c || !h || c !== h) return res.status(403).json({ ok: false, error: 'csrf_invalid' });
    return next();
  } catch { return res.status(403).json({ ok: false, error: 'csrf_invalid' }); }
}
app.use('/api', wrapForMethods(['POST', 'PUT', 'PATCH', 'DELETE'], csrfGuard));
function payloadGuard(req, res, next) {
  try {
    const m = String(req.method || 'GET').toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(m)) return next();
    const b = req.body || {};
    const pathLower = String(req.originalUrl || req.url || '').toLowerCase();
    const isKycSubmit = pathLower.includes('/api/me/kyc/submit');
    const isAvatarUpload = pathLower.includes('/api/me/avatar');
    const isCreditApply = pathLower.includes('/api/me/credit/apply');
    const isNewsWrite = pathLower.includes('/api/admin/news/create') || pathLower.includes('/api/admin/news/update') || pathLower.includes('/api/admin/news/upload_image') || pathLower.includes('/api/admin/institution/upload_image');
    const maxStr = (isKycSubmit || isCreditApply) ? (20 * 1024 * 1024) : (isAvatarUpload ? (6 * 1024 * 1024) : (isNewsWrite ? (10 * 1024 * 1024) : 256));
    const limitStr = (s) => { s = String(s || ''); if ((isKycSubmit || isAvatarUpload || isCreditApply) && /^data:image\//i.test(s)) return s.length <= maxStr; return s.length <= maxStr; };
    const limitNum = (n) => { n = Number(n); return Number.isFinite(n) && Math.abs(n) <= 1e12; };
    const limitArr = (a) => Array.isArray(a) ? a.length <= ((isKycSubmit || isAvatarUpload) ? 10 : 200) : true;
    const check = (v) => {
      if (v == null) return true;
      if (typeof v === 'string') return limitStr(v);
      if (typeof v === 'number') return limitNum(v);
      if (Array.isArray(v)) { if (!limitArr(v)) return false; for (const x of v) { if (!check(x)) return false; } return true; }
      if (typeof v === 'object') { const keys = Object.keys(v); if (keys.length > 100) return false; for (const k of keys) { if (!limitStr(k) || !check(v[k])) return false; } return true; }
      return true;
    };
    if (!check(b)) return res.status(400).json({ ok: false, error: 'payload_invalid' });
    return next();
  } catch { return res.status(400).json({ ok: false, error: 'payload_invalid' }); }
}
app.use('/api/admin', wrapForMethods(['POST', 'PUT', 'PATCH', 'DELETE'], payloadGuard));
app.use('/api/me', payloadGuard);
function securityHeaders(req, res, next) {
  try {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const hsts = String(process.env.ENABLE_HSTS || '').trim() === '1';
    if (hsts) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    const csp = String(process.env.CSP || '').trim();
    const strict = String(process.env.CSP_STRICT || '').trim() === '1';
    if (csp) {
      res.setHeader('Content-Security-Policy', csp);
    } else if (PROD) {
      if (strict) {
        res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; script-src 'self'; style-src 'self'; connect-src 'self' https:");
      } else {
        res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https:");
      }
    }
  } catch { }
  next();
}
app.use(securityHeaders);
const rateBuckets = new Map();
const REDIS_URL = String(process.env.REDIS_URL || '').trim();
let redis = null; try { if (REDIS_URL) redis = new Redis(REDIS_URL); } catch { }
try {
  const REQUIRE_REDIS = String(process.env.REQUIRE_REDIS || '').trim() === '1';
  if (PROD && REQUIRE_REDIS && !REDIS_URL) { try { console.error('[mxg-backend] REDIS_URL required in production'); } catch { }; process.exit(1); }
} catch { }
function createRateLimiter(opts) {
  const windowMs = Math.max(1000, Number(opts?.windowMs || 60000));
  const max = Math.max(1, Number(opts?.max || 10));
  if (redis) {
    return async (req, res, next) => {
      try {
        const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
        const ip = xf || req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
        const base = req.user?.id ? `u:${req.user.id}` : `ip:${ip}`;
        const key = `${base}:rl:${windowMs}:${max}`;
        const ttl = Math.ceil(windowMs / 1000);
        const val = await redis.incr(key);
        if (val === 1) await redis.expire(key, ttl);
        if (val > max) return res.status(429).json({ ok: false, error: 'rate_limited' });
        return next();
      } catch { return next(); }
    };
  }
  return (req, res, next) => {
    try {
      const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      const ip = xf || req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
      const key = req.user?.id ? `u:${req.user.id}` : `ip:${ip}`;
      const now = Date.now();
      const b = rateBuckets.get(key);
      if (!b || now > b.reset) { rateBuckets.set(key, { reset: now + windowMs, count: 1 }); return next(); }
      if (b.count >= max) return res.status(429).json({ ok: false, error: 'rate_limited' });
      b.count += 1; return next();
    } catch { return next(); }
  };
}
const rateLimitLogin = ENABLE_LOGIN_RATE_LIMIT ? createRateLimiter({ windowMs: 60000, max: 8 }) : ((req, res, next) => next());
const rateLimitAdminWrite = createRateLimiter({ windowMs: 60000, max: 60 });
function createUserWriteLimiter() {
  if (redis) {
    return async (req, res, next) => {
      try {
        const m = String(req.method || 'GET').toUpperCase();
        if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(m)) return next();
        const uid = Number(req.user && req.user.id);
        if (!Number.isFinite(uid) || uid <= 0) return next();
        const key = `u:${uid}:w:rl`;
        const val = await redis.incr(key);
        if (val === 1) await redis.expire(key, 60);
        if (val > 120) return res.status(429).json({ ok: false, error: 'rate_limited' });
        return next();
      } catch { return next(); }
    };
  }
  return (req, res, next) => {
    try {
      const m = String(req.method || 'GET').toUpperCase();
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(m)) return next();
      const uid = Number(req.user && req.user.id);
      if (!Number.isFinite(uid) || uid <= 0) return next();
      const key = 'u:' + uid + ':w';
      const now = Date.now();
      const b = rateBuckets.get(key);
      if (!b || now > b.reset) { rateBuckets.set(key, { reset: now + 60000, count: 1 }); return next(); }
      if (b.count >= 120) return res.status(429).json({ ok: false, error: 'rate_limited' });
      b.count += 1; return next();
    } catch { return next(); }
  };
}
const rateLimitUserWrite = createUserWriteLimiter();
function getThrottleKeyForPhone(phone) { return `phone:${String(phone || '').trim()}`; }
function getThrottleKeyForAccount(account) { return /^[0-9]{10}$/.test(String(account || '')) ? `phone:${String(account).trim()}` : `account:${String(account || '').trim()}`; }
function checkLoginLocked(k, ip) {
  try {
    const row = db.prepare('SELECT fail_count, locked_until FROM login_throttle WHERE k = ? AND ip = ?').get(String(k), String(ip));
    if (!row) return { locked: false, remain: 0 };
    const now = Date.now();
    if (Number(row.locked_until || 0) > now) return { locked: true, remain: Number(row.locked_until) - now };
    return { locked: false, remain: 0 };
  } catch { return { locked: false, remain: 0 }; }
}
function recordLoginFailure(k, ip, opts) {
  try {
    const now = Date.now();
    const r = db.prepare('SELECT fail_count FROM login_throttle WHERE k = ? AND ip = ?').get(String(k), String(ip));
    const prev = Number(r?.fail_count || 0) + 1;
    const limit = Math.max(1, Number(opts?.limit || 5));
    const lockMs = Math.max(60000, Number(opts?.lockMs || 15 * 60 * 1000));
    const lu = prev >= limit ? (now + lockMs) : 0;
    db.prepare(`INSERT INTO login_throttle (k, ip, fail_count, locked_until, updated_at) VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(k, ip) DO UPDATE SET fail_count=excluded.fail_count, locked_until=excluded.locked_until, updated_at=excluded.updated_at`).run(String(k), String(ip), prev, lu, new Date().toISOString());
  } catch { }
}
function recordLoginSuccess(k, ip) {
  try {
    db.prepare(`INSERT INTO login_throttle (k, ip, fail_count, locked_until, updated_at) VALUES (?, ?, 0, 0, ?)
               ON CONFLICT(k, ip) DO UPDATE SET fail_count=0, locked_until=0, updated_at=excluded.updated_at`).run(String(k), String(ip), new Date().toISOString());
  } catch { }
}
function adminAudit(req, res, next) {
  try {
    db.exec('CREATE TABLE IF NOT EXISTS admin_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER, method TEXT, path TEXT, ip TEXT, body TEXT, created_at TEXT)');
    const now = new Date().toISOString();
    const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const ip = xf || req.ip || (req.connection && req.connection.remoteAddress) || '';
    const mask = (obj) => {
      try {
        const sens = new Set(['password', 'token', 'secret', 'apikey', 'apiKey', 'authorization']);
        const walk = (v) => {
          if (v && typeof v === 'object') {
            const out = Array.isArray(v) ? [] : {};
            for (const k of Object.keys(v)) {
              out[k] = sens.has(k.toLowerCase()) ? '***' : walk(v[k]);
            }
            return out;
          }
          return v;
        };
        return walk(obj);
      } catch { return {}; }
    };
    const bodyMasked = mask(req.body || {});
    const bodyStr = JSON.stringify(bodyMasked);
    db.prepare('INSERT INTO admin_audit (admin_id, method, path, ip, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(Number(req.user?.id || 0), String(req.method || ''), String(req.originalUrl || req.url || ''), String(ip), String(bodyStr || '').slice(0, 2000), now);
  } catch { }
  next();
}
app.use('/api/admin', wrapForMethods(['POST', 'PATCH', 'DELETE'], rateLimitAdminWrite));
app.use('/api/admin', wrapForMethods(['POST', 'PATCH', 'DELETE'], adminAudit));
app.use('/api/me', rateLimitUserWrite);
app.use((err, req, res, next) => {
  try {
    if (err && (err.type === 'entity.too.large' || err.status === 413)) {
      return res.status(413).json({ ok: false, error: 'payload_too_large', message: 'Image too large' });
    }
  } catch { }
  next(err);
});

// Serve static frontend assets if build exists
app.use(express.static(FRONTEND_DIST, { index: 'index.html', maxAge: '1h' }));
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d' }));

function sha256(text) { return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex'); }
function isBcryptHash(h) { return typeof h === 'string' && /^\$2[aby]\$/.test(h); }
function hashPassword(pwd) { return bcrypt.hashSync(String(pwd || ''), 12); }
function verifyPassword(pwd, hash) {
  const s = String(hash || '');
  if (isBcryptHash(s)) return bcrypt.compareSync(String(pwd || ''), s);
  return s === sha256(pwd);
}
function base32Encode(buf) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0, output = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i]; bits += 8;
    while (bits >= 5) { output += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}
function totpGenerate(secretBase32, step = 30, digits = 6) {
  const key = Buffer.from(secretBase32, 'ascii');
  const buf = Buffer.alloc(Math.ceil(key.length * 5 / 8));
  let bits = 0, value = 0, idx = 0;
  for (let i = 0; i < key.length; i++) {
    const c = key[i];
    let v = 0;
    if (c >= 65 && c <= 90) v = c - 65; else if (c >= 50 && c <= 55) v = c - 24; else continue;
    value = (value << 5) | v; bits += 5;
    if (bits >= 8) { buf[idx++] = (value >>> (bits - 8)) & 0xff; bits -= 8; }
  }
  const counter = Math.floor(Date.now() / 1000 / step);
  const msg = Buffer.alloc(8); for (let i = 7; i >= 0; i--) { msg[i] = counter & 0xff; counter >>>= 8; }
  const h = crypto.createHmac('sha1', buf).update(msg).digest();
  const offset = h[h.length - 1] & 0x0f;
  const code = ((h[offset] & 0x7f) << 24) | ((h[offset + 1] & 0xff) << 16) | ((h[offset + 2] & 0xff) << 8) | (h[offset + 3] & 0xff);
  const str = String(code % (10 ** digits)).padStart(digits, '0');
  return str;
}
function totpVerify(secretBase32, token) {
  token = String(token || '').trim(); if (!token) return false;
  const step = 30; const digits = 6; const t = Math.floor(Date.now() / 1000 / step);
  for (let drift = -1; drift <= 1; drift++) {
    const counter = t + drift;
    const msg = Buffer.alloc(8); let c = counter; for (let i = 7; i >= 0; i--) { msg[i] = c & 0xff; c >>>= 8; }
    const key = Buffer.from(secretBase32, 'ascii');
    const kbuf = Buffer.alloc(Math.ceil(key.length * 5 / 8));
    let bits = 0, value = 0, idx = 0;
    for (let i = 0; i < key.length; i++) {
      const cc = key[i]; let v = 0; if (cc >= 65 && cc <= 90) v = cc - 65; else if (cc >= 50 && cc <= 55) v = cc - 24; else continue;
      value = (value << 5) | v; bits += 5; if (bits >= 8) { kbuf[idx++] = (value >>> (bits - 8)) & 0xff; bits -= 8; }
    }
    const h = crypto.createHmac('sha1', kbuf).update(msg).digest();
    const offset = h[h.length - 1] & 0x0f;
    const code = ((h[offset] & 0x7f) << 24) | ((h[offset + 1] & 0xff) << 16) | ((h[offset + 2] & 0xff) << 8) | (h[offset + 3] & 0xff);
    const str = String(code % (10 ** digits)).padStart(digits, '0');
    if (str === token) return true;
  }
  return false;
}

function issueTokenForUser(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  const exp = Date.now() + 30 * 24 * 3600 * 1000; // 30d
  const th = sha256(token);
  try {
    db.prepare('INSERT INTO tokens (token_hash, user_id, exp, created_at) VALUES (?, ?, ?, ?)')
      .run(th, userId, exp, new Date().toISOString());
  } catch {
    try {
      db.prepare('INSERT INTO tokens (token, token_hash, user_id, exp, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(token, th, userId, exp, new Date().toISOString());
    } catch {
      db.prepare('INSERT INTO tokens (token, user_id, exp, created_at) VALUES (?, ?, ?, ?)')
        .run(token, userId, exp, new Date().toISOString());
    }
  }
  return token;
}

// Token 验证中间件（从 tokens 表）
function authOptional(req, _res, next) {
  try {
    const hdr = String(req.headers['authorization'] || '');
    const tk = hdr.replace(/^Bearer\s+/i, '').trim();
    if (tk) {
      let row = null;
      try { row = db.prepare('SELECT user_id, exp FROM tokens WHERE token_hash = ?').get(sha256(tk)); } catch { }
      if (!row) { try { row = db.prepare('SELECT user_id, exp FROM tokens WHERE token = ?').get(String(tk)); } catch { } }
      if (row && (!row.exp || Number(row.exp) >= Date.now())) {
        const user = db.prepare('SELECT id, phone, name, role FROM users WHERE id = ?').get(row.user_id);
        if (user) req.user = user;
      }
    }
  } catch { }
  try {
    if (req.user && req.user.id) return next();
    const cookies = parseCookieHeader(req.headers && req.headers.cookie);
    const tk = String(cookies[COOKIE_NAME] || '').trim();
    if (!tk) return next();
    let row = null;
    try { row = db.prepare('SELECT user_id, exp FROM tokens WHERE token_hash = ?').get(sha256(tk)); } catch { }
    if (!row) { try { row = db.prepare('SELECT user_id, exp FROM tokens WHERE token = ?').get(String(tk)); } catch { } }
    if (row && (!row.exp || Number(row.exp) >= Date.now())) {
      const user = db.prepare('SELECT id, phone, name, role FROM users WHERE id = ?').get(row.user_id);
      if (user) req.user = user;
    }
  } catch { }
  next();
}
function requireAuth(req, res, next) {
  if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  next();
}

function requireRoles(roles) {
  return (req, res, next) => {
    try { console.log('[auth] hdr=', String(req.headers['authorization'] || ''), 'user=', req.user && req.user.id ? req.user.id : null) } catch { }
    if (!req.user || !req.user.id) {
      try {
        const hdr = String(req.headers['authorization'] || '');
        const tk = hdr.replace(/^Bearer\s+/i, '').trim();
        try { console.log('[auth] tk_len=', tk.length); } catch { }
        if (tk) {
          try { const _h = sha256(tk); const _r = db.prepare('SELECT token, user_id, exp FROM tokens WHERE token_hash = ?').get(_h); console.log('[auth] token_hash_found=', !!_r, 'uid=', _r && _r.user_id, 'exp=', _r && _r.exp); } catch { }
          let row = null;
          try { row = db.prepare('SELECT user_id, exp FROM tokens WHERE token_hash = ?').get(sha256(tk)); } catch { }
          if (!row) { try { row = db.prepare('SELECT user_id, exp FROM tokens WHERE token = ?').get(String(tk)); } catch { } }
          if (row && (!row.exp || Number(row.exp) >= Date.now())) { try { const user = db.prepare('SELECT id, phone, name, role FROM users WHERE id = ?').get(row.user_id); console.log('[auth] user_found=', !!user, 'role=', user && user.role); if (user) req.user = user; } catch { } }
        }
      } catch { }
    }
    try { console.log('[auth] after-parse user=', req.user && req.user.id ? req.user.id : null, 'role=', req.user && req.user.role) } catch { }
    if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    const userRole = String(req.user.role || '').trim();
    const allowed = Array.isArray(roles) ? roles.map(r => String(r || '').trim()) : [String(roles || '').trim()];
    const ok = allowed.includes(userRole);
    console.log('[auth-debug-v2] uid=', req.user.id, 'db_role=', req.user.role, 'parsed_role=', JSON.stringify(userRole), 'allowed=', JSON.stringify(allowed), 'ok=', ok);
    if (!ok) return res.status(403).json({ ok: false, error: 'Forbidden' });
    next();
  };
}

function adminReadRoles() {
  return ['super', 'admin', 'operator'];
}

function wrapForMethods(methods, mw) {
  const set = (Array.isArray(methods) ? methods : [methods]).map(m => String(m).toUpperCase());
  return (req, res, next) => {
    const m = String(req.method || 'GET').toUpperCase();
    if (set.includes(m)) return mw(req, res, next);
    return next();
  };
}

app.use(authOptional);

// 健康检查：容器健康探针与负载均衡可用
app.get('/api/health', (req, res) => {
  let connected = false;
  try { db.prepare('SELECT 1').get(); connected = true; } catch { }
  res.json({ ok: true, status: 'healthy', db: { path: resolvedDbPath, connected } });
});

app.get('/api/version', (req, res) => {
  let connected = false;
  try { db.prepare('SELECT 1').get(); connected = true; } catch { }
  res.json({ ok: true, name: 'mxg-backend', version: '1.0.1', port: PORT, db: { path: resolvedDbPath, connected } });
});

// Development helper: provide TwelveData key to frontend
app.get('/api/config/tdkey', (req, res) => {
  try {
    const key =
      process.env.VITE_TWELVEDATA_KEY ||
      process.env.VITE_TWELVE_DATA_KEY ||
      process.env.TWELVEDATA_KEY ||
      process.env.TD_KEY ||
      process.env.TD_KEY_OVERRIDE || '';
    res.json({ key });
  } catch (e) {
    res.json({ key: '' });
  }
});

app.get('/api/me', requireAuth, (req, res) => {
  try {
    const row = db.prepare('SELECT id, phone, name, role, account, avatar, avatar_mime, avatar_updated_at, disallow_trading, assigned_operator_id, assigned_admin_id, referral_code, invited_by_user_id FROM users WHERE id = ?').get(Number(req.user.id));
    if (!row) return res.status(404).json({ ok: false, error: 'user not found' });
    let reason = '';
    try {
      const usd = db.prepare('SELECT amount FROM balances WHERE user_id = ? AND currency = ?').get(Number(req.user.id), 'USD')?.amount || 0;
      if (Number(usd) < 0) reason = 'USD negative';
    } catch { }
    const trade_disabled = Number(row.disallow_trading || 0) === 1 || !!reason;
    res.json({ ok: true, user: { id: row.id, phone: row.phone, name: row.name, role: row.role, account: row.account, avatar: row.avatar, avatar_mime: row.avatar_mime, avatar_updated_at: row.avatar_updated_at, assigned_operator_id: row.assigned_operator_id ?? null, assigned_admin_id: row.assigned_admin_id ?? null, referral_code: row.referral_code || null, invited_by_user_id: row.invited_by_user_id ?? null, trade_disabled, reason: trade_disabled ? (reason || 'disabled') : '' } });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});
let newsCache = { pl: { ts: 0, items: [] } }
app.get('/api/news/pl', async (req, res) => {
  try {
    const ttl = Math.max(60000, Number(req.query.ttl || 600000))
    const now = Date.now()
    if (now - (newsCache.pl.ts || 0) < ttl && Array.isArray(newsCache.pl.items) && newsCache.pl.items.length) {
      return res.json({ items: newsCache.pl.items })
    }
    const langParam = String(req.query.lang || '').toLowerCase()
    const isPl = langParam === 'pl' || langParam === 'pl-pl'
    const hl = isPl ? 'pl' : 'en'
    const ceid = isPl ? 'PL:pl' : 'PL:en'
    const gl = 'PL'
    const defaultQPl = '(giełda OR rynki OR inwestycje OR finanse OR WIG OR GPW OR akcje) (site:money.pl OR site:bankier.pl OR site:parkiet.com OR site:forbes.pl OR site:reuters.com OR site:bloomberg.com OR site:investing.com OR site:yahoo.com/finance)'
    const defaultQEn = '(stock OR market OR investment OR finance OR WIG OR GPW OR equities) (site:reuters.com OR site:bloomberg.com OR site:investing.com OR site:yahoo.com/finance OR site:wsj.com OR site:ft.com)'
    const q = String(req.query.q || '').trim() || (isPl ? defaultQPl : defaultQEn)
    const url = 'https://news.google.com/rss/search?' + new URLSearchParams({ q, hl, gl, ceid }).toString()
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Safari/537.36' } })
    let xml = await r.text()
    if (!/<rss/i.test(xml) || !/<item/i.test(xml)) {
      const r2 = await fetch('https://news.google.com/rss?hl=pl&gl=PL&ceid=PL:pl', { headers: { 'User-Agent': 'Mozilla/5.0' } })
      xml = await r2.text()
    }
    let items = []
    const m = xml.match(/<item[\s\S]*?<\/item>/g) || []
    for (const it of m.slice(0, 50)) {
      const pick = (tag) => { const mm = it.match(new RegExp('<' + tag + '>([\s\S]*?)<\/' + tag + '>', 'i')); return mm ? mm[1] : '' }
      const attr = (tag, name) => { const mm = it.match(new RegExp('<' + tag + '[^>]*' + name + '=\"([^\"]+)\"[^>]*>', 'i')); return mm ? mm[1] : '' }
      const title = pick('title')
      const link = pick('link')
      const desc = pick('description')
      const pubDate = pick('pubDate')
      let img = attr('enclosure', 'url') || attr('media:content', 'url') || attr('media:thumbnail', 'url')
      if (!img) img = 'https://picsum.photos/seed/' + encodeURIComponent(title || link) + '/600/400'
      items.push({ title, link, desc, pubDate, img })
    }
    const kw = /(giełda|rynki|rynek|inwestycje|finanse|WIG|GPW|akcje|waluty|obligacje|stopy|zyski|straty|kwartalne|wyniki|emisja|kapitał|wolumen|notowania|otwarcie|zamknięcie|stock|market|investment|finance)/i
    items = items.filter(it => kw.test(String(it.title || '')) || kw.test(String(it.desc || '')))
    for (let i = 0; i < Math.min(items.length, 20); i++) {
      try {
        const it = items[i]
        if (!it || !it.link) continue
        if (it.img && !/picsum\.photos/.test(String(it.img || ''))) continue
        const dimg = String(it.desc || '').match(/<img[^>]*src=["']([^"']+)["']/i)
        if (dimg && dimg[1]) { it.img = dimg[1]; continue }
        const ac = new AbortController()
        const t = setTimeout(() => ac.abort(), 1500)
        let html = ''
        try {
          const resp = await fetch(it.link, { signal: ac.signal, headers: { 'User-Agent': 'Mozilla/5.0' } })
          html = await resp.text()
        } catch { }
        clearTimeout(t)
        if (html) {
          const mOg = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
            || html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)
          if (mOg && mOg[1]) { items[i].img = mOg[1] }
        }
      } catch { }
    }
    if (!items.length) {
      items = [
        { title: 'Rynek otwiera się wzrostem', link: 'https://example.com/pl/rynek-wzrost', desc: 'Główne indeksy polskie rozpoczęły sesję od wzrostów.', pubDate: new Date().toUTCString(), img: 'https://picsum.photos/seed/pl1/600/400' },
        { title: 'Złoty zyskuje wobec dolara', link: 'https://example.com/pl/zloty-dolar', desc: 'Kurs wymiany sprzyja złotemu przez drugą sesję z rzędu.', pubDate: new Date().toUTCString(), img: 'https://picsum.photos/seed/pl2/600/400' },
        { title: 'Wyniki kwartalne napędzają akcje', link: 'https://example.com/pl/wyniki', desc: 'Kilka spółek odnotowało wyniki powyżej oczekiwań.', pubDate: new Date().toUTCString(), img: 'https://picsum.photos/seed/pl3/600/400' }
      ]
    }
    newsCache.pl = { ts: now, items }
    return res.json({ items })
  } catch (e) {
    let items = Array.isArray(newsCache.pl.items) ? newsCache.pl.items : []
    if (!items.length) {
      items = [
        { title: 'Rynek otwiera się wzrostem', link: 'https://example.com/pl/rynek-wzrost', desc: 'Główne indeksy polskie rozpoczęły sesję od wzrostów.', pubDate: new Date().toUTCString(), img: 'https://picsum.photos/seed/pl1/600/400' },
        { title: 'Złoty zyskuje wobec dolara', link: 'https://example.com/pl/zloty-dolar', desc: 'Kurs wymiany sprzyja złotemu przez drugą sesję z rzędu.', pubDate: new Date().toUTCString(), img: 'https://picsum.photos/seed/pl2/600/400' },
        { title: 'Wyniki kwartalne napędzają akcje', link: 'https://example.com/pl/wyniki', desc: 'Kilka spółek odnotowało wyniki powyżej oczekiwań.', pubDate: new Date().toUTCString(), img: 'https://picsum.photos/seed/pl3/600/400' }
      ]
      newsCache.pl = { ts: Date.now(), items }
    }
    return res.json({ items })
  }
})

const FINNHUB_TOKEN = String(process.env.FINNHUB_TOKEN || '').trim()
let feedCache = new Map()
app.get('/api/news/feed', async (req, res) => {
  try {
    const market = String(req.query.market || 'us').trim().toLowerCase()
    try {
      db.exec('CREATE TABLE IF NOT EXISTS news_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, pub_date TEXT, intro TEXT, content TEXT, img TEXT, pinned INTEGER DEFAULT 0, author_id INTEGER, created_at TEXT, updated_at TEXT)')
    } catch { }
    try {
      const rows = db.prepare('SELECT id, title, pub_date, intro, content, img FROM news_posts ORDER BY pinned DESC, pub_date DESC, id DESC').all()
      if (Array.isArray(rows) && rows.length) {
        const items = rows.map(r => ({
          id: Number(r.id || 0),
          title: String(r.title || ''),
          link: '',
          desc: String(r.intro || r.content || ''),
          content: String(r.content || ''),
          pubDate: String(r.pub_date || new Date().toUTCString()),
          img: String(r.img || '')
        }))
        return res.json({ items })
      }
    } catch { }
    const key = 'feed:' + market
    const ttl = Math.max(60000, Number(req.query.ttl || 300000))
    const now = Date.now()
    const cached = feedCache.get(key)
    if (cached && now - (cached.ts || 0) < ttl && Array.isArray(cached.items) && cached.items.length) {
      return res.json({ items: cached.items })
    }
    if (FINNHUB_TOKEN) {
      let category = 'general'
      if (market === 'crypto') category = 'crypto'
      else if (market === 'fx' || market === 'forex') category = 'forex'
      const u = new URL('https://finnhub.io/api/v1/news')
      u.searchParams.set('category', category)
      u.searchParams.set('token', FINNHUB_TOKEN)
      let items = []
      try {
        const r = await fetch(u.toString())
        const j = await r.json()
        const arr = Array.isArray(j) ? j : []
        items = arr.slice(0, 50).map(x => ({
          title: String(x.headline || ''),
          link: String(x.url || ''),
          desc: String(x.summary || ''),
          pubDate: new Date((Number(x.datetime || 0) * 1000) || Date.now()).toUTCString(),
          img: String(x.image || ''),
          source: String(x.source || ''),
          related: String(x.related || ''),
        }))
      } catch { }
      const kw = /(stock|equity|market|bolsa|mercados|mercado|invest|inversión|finanzas|BMV|IPC|acciones|forex|crypto|bitcoin|ethereum|bonos|tasas)/i
      items = items.filter(it => kw.test(it.title) || kw.test(it.desc) || kw.test(it.source) || kw.test(it.related))
      if (items.length) { feedCache.set(key, { ts: now, items }); return res.json({ items }) }
    }
    let fallback = []
    try {
      const url = req.protocol + '://' + req.get('host') + '/api/news/mx'
      const r = await fetch(url)
      const j = await r.json()
      fallback = Array.isArray(j.items) ? j.items : []
    } catch { }
    feedCache.set(key, { ts: now, items: fallback })
    return res.json({ items: fallback })
  } catch (e) { return res.json({ items: [] }) }
})

// Fetch single news by id (for full content reading)
app.get('/api/news/get', (req, res) => {
  try {
    const id = Number(req.query.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });
    const r = db.prepare('SELECT id, title, pub_date, intro, content, img, pinned, author_id, created_at, updated_at FROM news_posts WHERE id = ?').get(id);
    if (!r) return res.status(404).json({ ok: false, error: 'not found' });
    res.json({ ok: true, item: r });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

// ---- Admin: News content management ----
try { db.exec('CREATE TABLE IF NOT EXISTS news_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, pub_date TEXT, intro TEXT, content TEXT, img TEXT, pinned INTEGER DEFAULT 0, author_id INTEGER, created_at TEXT, updated_at TEXT)') } catch { }

app.get('/api/admin/news/list', requireRoles(adminReadRoles()), (req, res) => {
  try {
    const rows = db.prepare('SELECT id, title, pub_date, intro, content, img, pinned, author_id, created_at, updated_at FROM news_posts ORDER BY pinned DESC, pub_date DESC, id DESC').all()
    res.json({ items: rows })
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }) }
})
app.post('/api/admin/news/create', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const { title, pubDate, intro, content, img } = req.body || {}
    if (!title) return res.status(400).json({ ok: false, error: 'title required' })
    const now = new Date().toISOString()
    const r = db.prepare('INSERT INTO news_posts (title, pub_date, intro, content, img, pinned, author_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)')
      .run(String(title), String(pubDate || now), String(intro || ''), String(content || ''), String(img || ''), Number(req.user.id || 0), now, now)
    const row = db.prepare('SELECT id, title, pub_date, intro, content, img, pinned, author_id, created_at, updated_at FROM news_posts WHERE id = ?').get(r.lastInsertRowid)
    res.json({ ok: true, item: row })
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }) }
})
app.post('/api/admin/news/update/:id', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' })
    const { title, pubDate, intro, content, img } = req.body || {}
    const now = new Date().toISOString()
    db.prepare('UPDATE news_posts SET title=?, pub_date=?, intro=?, content=?, img=?, updated_at=? WHERE id=?')
      .run(String(title || ''), String(pubDate || now), String(intro || ''), String(content || ''), String(img || ''), now, id)
    const row = db.prepare('SELECT id, title, pub_date, intro, content, img, pinned, author_id, created_at, updated_at FROM news_posts WHERE id = ?').get(id)
    res.json({ ok: true, item: row })
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }) }
})
app.post('/api/admin/news/delete/:id', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' })
    db.prepare('DELETE FROM news_posts WHERE id = ?').run(id)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }) }
})
app.post('/api/admin/news/pin/:id', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id)
    const pinned = Number((req.body && req.body.pinned) ? 1 : 0)
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' })
    db.prepare('UPDATE news_posts SET pinned=? WHERE id=?').run(pinned, id)
    const row = db.prepare('SELECT id, title, pub_date, intro, content, img, pinned FROM news_posts WHERE id=?').get(id)
    res.json({ ok: true, item: row })
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }) }
})

// ---- Admin: News image upload (base64 dataUrl) ----
app.post('/api/admin/news/upload_image', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const { data, dataUrl, mime: mimeHint } = req.body || {}
    const raw = typeof data === 'string' && data ? data : (typeof dataUrl === 'string' ? dataUrl : '')
    if (!raw || raw.length < 48) return res.status(400).json({ ok: false, error: 'invalid image data' })
    const m = raw.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/i)
    const mime = (m ? m[1] : String(mimeHint || '').toLowerCase()) || 'image/png'
    const b64 = m ? m[3] : raw.replace(/^data:[^,]*,/, '')
    let buf
    try { buf = Buffer.from(b64, 'base64') } catch { return res.status(400).json({ ok: false, error: 'bad base64' }) }
    if (!buf || buf.length === 0) return res.status(400).json({ ok: false, error: 'empty data' })
    if (buf.length > 8 * 1024 * 1024) return res.status(413).json({ ok: false, error: 'too large' })
    const ext = mime.includes('png') ? '.png' : (mime.includes('webp') ? '.webp' : '.jpg')
    const d = new Date()
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`
    const newsDir = path.join(UPLOADS_DIR, 'news')
    try { fs.mkdirSync(newsDir, { recursive: true }) } catch { }
    const filename = `news_${stamp}${ext}`
    const filePath = path.join(newsDir, filename)
    fs.writeFileSync(filePath, buf)
    const url = `/uploads/news/${filename}`
    res.json({ ok: true, url })
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }) }
})

// 前端资产校验：用于发布后核对 index.html 与 assets 哈希是否一致
app.get('/api/dev/assets', (req, res) => {
  try {
    const distDir = FRONTEND_DIST;
    const indexPath = path.join(FRONTEND_DIST, 'index.html');
    const existsIndex = fs.existsSync(indexPath);
    const assetsDir = path.join(FRONTEND_DIST, 'assets');
    const assets = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir).filter(n => /\.(js|css)$/.test(n)) : [];
    let indexHtml = '';
    if (existsIndex) {
      try { indexHtml = fs.readFileSync(indexPath, 'utf8'); } catch { }
    }
    const referenced = [];
    if (indexHtml) {
      const jsMatches = [...indexHtml.matchAll(/assets\/[^"]+\.js/g)].map(m => m[0].replace('assets/', ''));
      const cssMatches = [...indexHtml.matchAll(/assets\/[^"]+\.css/g)].map(m => m[0].replace('assets/', ''));
      for (const f of [...jsMatches, ...cssMatches]) referenced.push(f);
    }
    const refsUnique = Array.from(new Set(referenced));
    const status = refsUnique.map(name => ({ name, exists: assets.includes(name) }));
    res.json({ ok: true, existsIndex, count: assets.length, status });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get('/api/dev/seed', (req, res) => {
  try {
    const DEV = String(process.env.NODE_ENV || '').trim().toLowerCase() !== 'production';
    const ALLOW = String(process.env.ENABLE_DEV_SEED || '').trim() === '1';
    if (!DEV || !ALLOW) return res.status(403).json({ ok: false, error: 'dev_seed_disabled' });
    const now = new Date().toISOString();
    let admin = db.prepare("SELECT id, account FROM users WHERE account = ? AND role = 'admin'").get('admin');
    if (!admin) {
      const info = db.prepare('INSERT INTO users (email, password_hash, name, created_at, updated_at, phone, role, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run('admin@account.local', hashPassword('admin123'), 'Admin', now, now, null, 'admin', 'admin');
      admin = { id: info.lastInsertRowid, account: 'admin' };
    }
    let operator = db.prepare("SELECT id, account FROM users WHERE account = ? AND role = 'operator'").get('yisen01');
    if (!operator) {
      const info = db.prepare('INSERT INTO users (email, password_hash, name, created_at, updated_at, phone, role, account, assigned_admin_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run('yisen01@account.local', hashPassword('yisen01'), 'Operator yisen01', now, now, null, 'operator', 'yisen01', Number(admin.id));
      operator = { id: info.lastInsertRowid, account: 'yisen01' };
    }
    try { db.prepare('UPDATE users SET password_hash=?, updated_at=? WHERE id=?').run(hashPassword('yisen01'), now, Number(operator.id)); } catch { }
    try {
      const cur = db.prepare('SELECT invite_code FROM users WHERE id = ?').get(Number(operator.id))?.invite_code || '';
      if (!cur) {
        let code = '';
        let tries = 0;
        do {
          code = String(Math.floor(100000 + Math.random() * 900000));
          const exists = db.prepare('SELECT id FROM users WHERE invite_code = ?').get(code);
          if (!exists) break;
          tries++;
        } while (tries < 5);
        db.prepare('UPDATE users SET invite_code=?, updated_at=? WHERE id=?').run(code, now, Number(operator.id));
      }
    } catch { }
    let user = db.prepare("SELECT id, phone FROM users WHERE phone = ? AND role = 'customer'").get('1111111111');
    if (!user) {
      const info = db.prepare('INSERT INTO users (email, password_hash, name, created_at, updated_at, phone, role) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('1111111111@phone.local', hashPassword('user123'), 'Test User', now, now, '1111111111', 'customer');
      user = { id: info.lastInsertRowid, phone: '1111111111' };
    }
    const urow = db.prepare('SELECT assigned_operator_id, assigned_admin_id FROM users WHERE id = ?').get(Number(user.id));
    const opRow = db.prepare('SELECT assigned_admin_id FROM users WHERE id = ?').get(Number(operator.id));
    const aid = Number(opRow?.assigned_admin_id || admin.id);
    if (urow && (urow.assigned_operator_id == null)) {
      db.prepare('UPDATE users SET assigned_operator_id=?, assigned_admin_id=?, updated_at=? WHERE id=?')
        .run(Number(operator.id), aid, now, Number(user.id));
    }
    try { db.prepare('INSERT INTO balances (user_id, currency, amount, updated_at) VALUES (?, ?, ?, ?)').run(Number(user.id), 'USD', 1234.56, now); } catch { }
    try {
      db.prepare('INSERT OR IGNORE INTO positions (user_id, symbol, market, long_qty, short_qty, avg_price, long_avg, short_avg, locked, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(Number(user.id), 'AAPL', 'NASDAQ', 10, 0, 180.12, 180.12, 0, 0, now, now);
    } catch { }
    try {
      db.prepare('INSERT INTO block_trade_orders (user_id, symbol, market, side, price, qty, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(Number(user.id), 'TSLA', 'NASDAQ', 'BUY', 250.5, 5, 'completed', now, now);
    } catch { }
    try {
      db.prepare('INSERT INTO fund_orders (user_id, fund_code, side, price, qty, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(Number(user.id), 'FND123', 'BUY', 10.0, 100, 'completed', now, now);
    } catch { }
    try {
      let ipo = db.prepare('SELECT id FROM ipo_items WHERE code = ?').get('IPOXG');
      if (!ipo) {
        const infoI = db.prepare('INSERT INTO ipo_items (code, name, market, released, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run('IPOXG', 'IPO XG', 'NASDAQ', 1, now, now);
        ipo = { id: infoI.lastInsertRowid };
      }
      db.prepare('INSERT INTO ipo_orders (user_id, ipo_id, code, price, qty, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(Number(user.id), Number(ipo.id), 'IPOXG', 20.0, 50, 'approved', now, now);
    } catch { }
    try {
      db.exec('CREATE TABLE IF NOT EXISTS balance_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, currency TEXT, amount REAL, reason TEXT, admin_id INTEGER, created_at TEXT)');
      db.prepare('INSERT INTO balance_logs (user_id, currency, amount, reason, admin_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(Number(user.id), 'USD', 200, 'dev_seed', Number(admin.id), now);
    } catch { }
    res.json({ ok: true, admin, operator, user });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

// ===================== 邮箱验证码功能 =====================

// 邮件发送配置 - ZeptoMail SMTP
const emailConfig = {
  host: process.env.SMTP_HOST || 'smtp.zeptomail.com',
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER || 'emailapikey',
    pass: process.env.SMTP_PASS || 'wSsVR60irB6iX/h6lDOtIOtumlxcBg+lFB8p0FKh4yOuG/nKpcdpnkSdAwbxSKIWFDZrQWYXo7sgzkoC1TsJiI4knw4FCCiF9mqRe1U4J3x17qnvhDzMX2pdlxuOK44JwApvkmFhE80g+g==',
  },
};

// 创建邮件传输器
let emailTransporter = null;
function getEmailTransporter() {
  if (!emailTransporter && emailConfig.auth.user && emailConfig.auth.pass) {
    emailTransporter = nodemailer.createTransport(emailConfig);
  }
  return emailTransporter;
}

// 生成6位数验证码
function generateVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// 发送邮箱验证码API
app.post('/api/auth/send_email_code', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: 'invalid_email' });
    }
    
    // 检查邮箱是否已被注册（作为真实邮箱）
    const existsEmail = db.prepare("SELECT id FROM users WHERE email = ? AND email NOT LIKE '%@phone.local'").get(email.toLowerCase());
    if (existsEmail) {
      return res.status(409).json({ ok: false, error: 'email_exists' });
    }
    
    // 检查是否发送过于频繁（1分钟内只能发一次）
    const recentCode = db.prepare('SELECT id FROM email_verification_codes WHERE email = ? AND created_at > ? AND used = 0').get(
      email.toLowerCase(),
      new Date(Date.now() - 60 * 1000).toISOString()
    );
    if (recentCode) {
      return res.status(429).json({ ok: false, error: 'too_frequent', message: '请稍后再试' });
    }
    
    // 生成验证码
    const code = generateVerificationCode();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10分钟有效
    
    // 保存验证码
    db.prepare('INSERT INTO email_verification_codes (email, code, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(email.toLowerCase(), code, expiresAt.toISOString(), now.toISOString());
    
    // 发送邮件
    const transporter = getEmailTransporter();
    if (transporter) {
      try {
        await transporter.sendMail({
          from: `"GQ Trade" <support@hkgqgs.com>`,
          to: email,
          subject: 'Kod weryfikacyjny - GQ Trade',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; background: #ffffff;">
              <div style="text-align: center; padding: 20px 0; border-bottom: 2px solid #1e3a5f;">
                <h1 style="margin: 0; color: #1e3a5f; font-size: 24px;">GQ Trade</h1>
                <p style="margin: 5px 0 0 0; color: #666; font-size: 12px;">Globalna Platforma Inwestycyjna</p>
              </div>
              
              <div style="padding: 30px 0;">
                <h2 style="margin: 0 0 15px 0; color: #333; font-size: 18px;">Kod weryfikacyjny</h2>
                <p style="margin: 0 0 20px 0; color: #666; font-size: 14px;">
                  Witaj! Oto Twój kod weryfikacyjny:
                </p>
                
                <div style="background: #f5f5f5; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
                  <span style="font-size: 32px; font-weight: bold; color: #1e3a5f; letter-spacing: 8px;">${code}</span>
                </div>
                
                <p style="margin: 20px 0 0 0; color: #999; font-size: 13px;">
                  Kod jest ważny przez 10 minut. Nie udostępniaj nikomu.<br>
                  <span style="color: #bbb; font-size: 11px;">Code valid for 10 minutes. Do not share with anyone.</span>
                </p>
              </div>
              
              <div style="border-top: 1px solid #eee; padding-top: 15px; text-align: center;">
                <p style="margin: 0; color: #999; font-size: 11px;">
                  © 2026 GQ Trade. Wszelkie prawa zastrzeżone.
                </p>
              </div>
            </div>
          `,
        });
        console.log(`[Email] Verification code sent to ${email}`);
      } catch (mailErr) {
        console.error('[Email] Failed to send:', mailErr.message);
        // 即使邮件发送失败，也返回成功（开发环境可以从数据库查看验证码）
      }
    } else {
      console.log(`[Email] No transporter configured. Code for ${email}: ${code}`);
    }
    
    res.json({ ok: true, message: 'code_sent' });
  } catch (e) {
    console.error('[Email] Error:', e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// 验证邮箱验证码
function verifyEmailCode(email, code) {
  if (!email || !code) return { valid: false, error: 'missing_params' };
  
  const record = db.prepare(
    'SELECT id, code, expires_at, used FROM email_verification_codes WHERE email = ? AND used = 0 ORDER BY id DESC LIMIT 1'
  ).get(email.toLowerCase());
  
  if (!record) return { valid: false, error: 'code_not_found' };
  if (record.code !== String(code)) return { valid: false, error: 'invalid_code' };
  if (new Date(record.expires_at) < new Date()) return { valid: false, error: 'code_expired' };
  
  // 标记验证码为已使用
  db.prepare('UPDATE email_verification_codes SET used = 1 WHERE id = ?').run(record.id);
  
  return { valid: true };
}

// ===================== 结束邮箱验证码功能 =====================

app.post('/api/auth/register_phone', (req, res) => {
  const { phone, password, name, inviteCode, email, emailCode } = req.body || {};
  if (!phone || !password) return res.status(400).json({ ok: false, error: 'phone and password required' });
  
  // 验证邮箱验证码（如果提供了邮箱）
  if (email) {
    if (!emailCode) return res.status(400).json({ ok: false, error: 'email_code_required' });
    const verification = verifyEmailCode(email, emailCode);
    if (!verification.valid) {
      return res.status(400).json({ ok: false, error: verification.error });
    }
  }
  
  const digits = String(phone).replace(/\D+/g, '');
  if (!/^\d{9,11}$/.test(digits)) return res.status(400).json({ ok: false, error: 'phone must be 9-11 digits' });
  const exists = db.prepare('SELECT id FROM users WHERE phone = ?').get(String(digits));
  if (exists) return res.status(409).json({ ok: false, error: 'phone exists' });
  
  // 处理邀请码 - 查找运营账号
  let assignedOperatorId = null;
  let assignedAdminId = null;
  let invitedByUserId = null;
  
  if (inviteCode && String(inviteCode).trim()) {
    const code = String(inviteCode).trim().toUpperCase();
    // 先查找运营的邀请码
    const operator = db.prepare("SELECT id, role, assigned_admin_id FROM users WHERE invite_code = ? AND role = 'operator'").get(code);
    if (operator) {
      assignedOperatorId = Number(operator.id);
      assignedAdminId = operator.assigned_admin_id ? Number(operator.assigned_admin_id) : null;
      invitedByUserId = Number(operator.id);
    } else {
      // 再查找用户的推荐码
      const refUser = db.prepare('SELECT id, assigned_operator_id, assigned_admin_id FROM users WHERE referral_code = ?').get(code);
      if (refUser) {
        assignedOperatorId = refUser.assigned_operator_id ? Number(refUser.assigned_operator_id) : null;
        assignedAdminId = refUser.assigned_admin_id ? Number(refUser.assigned_admin_id) : null;
        invitedByUserId = Number(refUser.id);
      }
    }
  }
  
  const now = new Date().toISOString();
  // 如果提供了邮箱，使用真实邮箱；否则使用phone@phone.local
  const userEmail = email ? email.toLowerCase() : `${digits}@phone.local`;
  const stmt = db.prepare('INSERT INTO users (email, password_hash, name, created_at, updated_at, phone, role, assigned_operator_id, assigned_admin_id, invited_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const info = stmt.run(userEmail, hashPassword(password), name || 'User', now, now, String(digits), 'customer', assignedOperatorId, assignedAdminId, invitedByUserId);
  const uid = info.lastInsertRowid;
  const user = db.prepare('SELECT id, phone, name, role, assigned_operator_id, assigned_admin_id FROM users WHERE id = ?').get(uid);
  res.json({ ok: true, user, assigned: assignedOperatorId != null });
});

app.post('/api/auth/login_phone', rateLimitLogin, (req, res) => {
  const { phone, password } = req.body || {};
  if (!phone || !password) return res.status(400).json({ ok: false, error: 'phone and password required' });
  const ip = getClientIp(req);
  const lock = checkLoginLocked(getThrottleKeyForPhone(phone), ip);
  if (lock.locked) {
    if (!PROD) { try { recordLoginSuccess(getThrottleKeyForPhone(phone), ip); } catch { } }
    else return res.status(429).json({ ok: false, error: 'login_locked', remainMs: Number(lock.remain || 0) });
  }
  const row = db.prepare('SELECT id, phone, name, role, password_hash FROM users WHERE phone = ?').get(String(phone));
  if (!row) return res.status(401).json({ ok: false, error: 'wrong phone or password' });
  const ok = verifyPassword(password, row.password_hash);
  const LIMIT = PROD ? 5 : 99;
  const LOCK_MS = PROD ? 15 * 60 * 1000 : 60 * 1000;
  if (!ok) { recordLoginFailure(getThrottleKeyForPhone(phone), ip, { limit: LIMIT, lockMs: LOCK_MS }); return res.status(401).json({ ok: false, error: 'wrong phone or password' }); }
  if (String(row.role) !== 'customer') return res.status(403).json({ ok: false, error: 'forbidden role' });
  // 兼容旧库：若为旧哈希，透明升级为 bcrypt
  try { if (!isBcryptHash(row.password_hash)) db.prepare('UPDATE users SET password_hash=?, updated_at=? WHERE id=?').run(hashPassword(password), new Date().toISOString(), row.id); } catch { }
  // 生成令牌（48位十六进制）并写入 tokens 表，有效期30天
  const token = issueTokenForUser(row.id);
  // 记录最近登录 IP
  try {
    recordLoginSuccess(getThrottleKeyForPhone(phone), ip);
    const country = getCountryFromHeaders(req);
    db.prepare('UPDATE users SET last_login_ip=?, last_login_country=?, updated_at=? WHERE id=?').run(encField(ip), country || null, new Date().toISOString(), row.id);
  } catch { }
  try { setSessionCookie(res, token); } catch { }
  try { setCsrfCookie(res); } catch { }
  res.json({ ok: true, token, user: { id: row.id, phone: row.phone, role: row.role, name: row.name } });
});

// ---- Admin/Staff: 账号登录（支持 account 或 phone） ----
app.post('/api/auth/login_account', rateLimitLogin, (req, res) => {
  const { account, password } = req.body || {};
  if (!account || !password) return res.status(400).json({ ok: false, error: 'account and password required' });
  const acc = String(account).trim();
  const isPhone = /^[0-9]{9,11}$/.test(acc);
  const ip = getClientIp(req);
  const lock = checkLoginLocked(getThrottleKeyForAccount(acc), ip);
  if (lock.locked) {
    if (!PROD) { try { recordLoginSuccess(getThrottleKeyForAccount(acc), ip); } catch { } }
    else return res.status(429).json({ ok: false, error: 'login_locked', remainMs: Number(lock.remain || 0) });
  }
  const row = isPhone
    ? db.prepare('SELECT id, phone, name, role, password_hash, account, disallow_login, otp_enabled, otp_secret FROM users WHERE phone = ?').get(acc)
    : db.prepare('SELECT id, phone, name, role, password_hash, account, disallow_login, otp_enabled, otp_secret FROM users WHERE account = ?').get(acc);
  if (!row) return res.status(401).json({ ok: false, error: 'wrong account or password' });
  const ok = verifyPassword(password, row.password_hash);
  const LIMIT2 = PROD ? 5 : 99;
  const LOCK_MS2 = PROD ? 15 * 60 * 1000 : 60 * 1000;
  if (!ok) { recordLoginFailure(getThrottleKeyForAccount(acc), ip, { limit: LIMIT2, lockMs: LOCK_MS2 }); return res.status(401).json({ ok: false, error: 'wrong account or password' }); }
  if (!['admin', 'super', 'operator'].includes(String(row.role))) return res.status(403).json({ ok: false, error: 'forbidden role' });
  // ignore disallow_login for staff accounts to reduce login friction
  if (Number(row.otp_enabled || 0) === 1 && ADMIN_OTP_REQUIRED) {
    const otp = String((req.body && req.body.otp) || '').trim();
    if (!otp || !row.otp_secret || !totpVerify(String(row.otp_secret), otp)) return res.status(401).json({ ok: false, error: 'otp_required' });
  }
  const token = issueTokenForUser(row.id);
  try {
    recordLoginSuccess(getThrottleKeyForAccount(acc), ip);
    const country = getCountryFromHeaders(req);
    db.prepare('UPDATE users SET last_login_ip=?, last_login_country=?, updated_at=? WHERE id=?').run(encField(ip), country || null, new Date().toISOString(), row.id);
  } catch { }
  try { setSessionCookie(res, token); } catch { }
  try { setCsrfCookie(res); } catch { }
  res.json({ ok: true, token, user: { id: row.id, phone: row.phone, account: row.account, role: row.role, name: row.name } });
});

app.post('/api/admin/login_account', rateLimitLogin, (req, res) => {
  const { account, password, otp } = req.body || {};
  if (!account || !password) return res.status(400).json({ ok: false, error: 'account and password required' });
  const acc = String(account).trim();
  const isPhone = /^[0-9]{9,11}$/.test(acc);
  const ip = getClientIp(req);
  const lock = checkLoginLocked(getThrottleKeyForAccount(acc), ip);
  if (lock.locked) return res.status(429).json({ ok: false, error: 'login_locked', remainMs: Number(lock.remain || 0) });
  const row = isPhone
    ? db.prepare('SELECT id, phone, name, role, password_hash, account, disallow_login, otp_enabled, otp_secret FROM users WHERE phone = ?').get(acc)
    : db.prepare('SELECT id, phone, name, role, password_hash, account, disallow_login, otp_enabled, otp_secret FROM users WHERE account = ?').get(acc);
  if (!row) return res.status(401).json({ ok: false, error: 'wrong account or password' });
  const ok = verifyPassword(password, row.password_hash);
  if (!ok) { recordLoginFailure(getThrottleKeyForAccount(acc), ip, { limit: 5, lockMs: 15 * 60 * 1000 }); return res.status(401).json({ ok: false, error: 'wrong account or password' }); }
  if (!['admin', 'super', 'operator'].includes(String(row.role))) return res.status(403).json({ ok: false, error: 'forbidden role' });
  if (Number(row.otp_enabled || 0) === 1 && ADMIN_OTP_REQUIRED) {
    const otpStr = String(otp || '').trim();
    if (!otpStr || !row.otp_secret || !totpVerify(String(row.otp_secret), otpStr)) return res.status(401).json({ ok: false, error: 'otp_required' });
  }
  const token = issueTokenForUser(row.id);
  try {
    recordLoginSuccess(getThrottleKeyForAccount(acc), ip);
    const country = getCountryFromHeaders(req);
    db.prepare('UPDATE users SET last_login_ip=?, last_login_country=?, updated_at=? WHERE id=?').run(encField(ip), country || null, new Date().toISOString(), row.id);
  } catch { }
  try { setSessionCookie(res, token); } catch { }
  try { setCsrfCookie(res); } catch { }
  res.json({ ok: true, token, user: { id: row.id, phone: row.phone, account: row.account, role: row.role, name: row.name } });
});

// ---- Admin: 用户列表 ----
app.get('/api/admin/users', requireRoles(['super', 'admin', 'operator']), (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const assigned = String(req.query.assigned || 'all').toLowerCase();
    const includeBalances = String(req.query.includeBalances || '1') !== '0';
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize || 20)));
    const offset = (page - 1) * pageSize;
    const assignedCond = assigned === 'assigned'
      ? ' AND (assigned_admin_id IS NOT NULL OR assigned_operator_id IS NOT NULL)'
      : assigned === 'unassigned'
        ? ' AND assigned_admin_id IS NULL AND assigned_operator_id IS NULL'
        : '';
    const role = String(req.user?.role || '');
    let extraCond = '';
    const extraParams = [];
    if (role === 'operator') {
      const sid = Number(req.user.id || 0);
      if (assigned === 'assigned' || assigned === 'all') {
        extraCond = ' AND assigned_operator_id = ?';
        extraParams.push(sid);
      }
    } else if (role === 'admin') {
      const aid = Number(req.user.id || 0);
      if (assigned === 'assigned' || assigned === 'all') {
        const ops = db.prepare("SELECT id FROM users WHERE role = 'operator' AND assigned_admin_id = ?").all(aid).map(r => Number(r.id));
        if (ops.length > 0) { extraCond = ` AND assigned_operator_id IN (${ops.map(() => '?').join(',')})`; extraParams.push(...ops); }
        else { extraCond = ' AND 1=0'; }
      }
    }
    let rows;
    if (q) {
      const exactSql = "SELECT id, phone, name, role, last_login_ip, last_login_country AS country, assigned_admin_id, assigned_operator_id, credit_score FROM users WHERE phone = ? AND role NOT IN ('admin','operator','super')" + assignedCond + extraCond + " ORDER BY id ASC LIMIT ? OFFSET ?";
      rows = db.prepare(exactSql).all(q, ...extraParams, pageSize, offset);
      const cntExact = db.prepare("SELECT COUNT(1) AS c FROM users WHERE phone = ? AND role NOT IN ('admin','operator','super')" + assignedCond + extraCond).get(q, ...extraParams)?.c || 0;
      if (rows && rows.length > 0) {
        let balMap = new Map();
        if (includeBalances) {
          const ids = rows.map(r => Number(r.id));
          if (ids.length > 0) {
            const balRows = db.prepare(`SELECT user_id, currency, amount FROM balances WHERE user_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
            for (const r of balRows) {
              const m = balMap.get(r.user_id) || { PLN: 0, USD: 0, USDT: 0, EUR: 0 };
              m[String(r.currency || '').toUpperCase()] = Number(r.amount || 0);
              balMap.set(r.user_id, m);
            }
          }
        }
        const users = rows.map(u => ({ ...u, last_login_ip: u.last_login_ip ? decField(u.last_login_ip) : null, balances: includeBalances ? (balMap.get(u.id) || { PLN: 0, USD: 0, USDT: 0, EUR: 0 }) : undefined }));
        return res.json({ ok: true, users, total: cntExact });
      } else {
        const like = `%${q}%`;
        const sql = "SELECT id, phone, name, role, last_login_ip, last_login_country AS country, assigned_admin_id, assigned_operator_id, credit_score FROM users WHERE name LIKE ? AND role NOT IN ('admin','operator','super')" + assignedCond + extraCond + " ORDER BY id ASC LIMIT ? OFFSET ?";
        rows = db.prepare(sql).all(like, ...extraParams, pageSize, offset);
        const c = db.prepare("SELECT COUNT(1) AS c FROM users WHERE name LIKE ? AND role NOT IN ('admin','operator','super')" + assignedCond + extraCond).get(like, ...extraParams)?.c || 0;
        let balMap = new Map();
        if (includeBalances) {
          const ids = rows.map(r => Number(r.id));
          if (ids.length > 0) {
            const balRows = db.prepare(`SELECT user_id, currency, amount FROM balances WHERE user_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
            for (const r of balRows) {
              const m = balMap.get(r.user_id) || { PLN: 0, USD: 0, USDT: 0, EUR: 0 };
              m[String(r.currency || '').toUpperCase()] = Number(r.amount || 0);
              balMap.set(r.user_id, m);
            }
          }
        }
        const users = rows.map(u => ({ ...u, last_login_ip: u.last_login_ip ? decField(u.last_login_ip) : null, balances: includeBalances ? (balMap.get(u.id) || { PLN: 0, USD: 0, USDT: 0, EUR: 0 }) : undefined }));
        return res.json({ ok: true, users, total: c });
      }
    } else {
      const sql = "SELECT id, phone, name, role, last_login_ip, last_login_country AS country, assigned_admin_id, assigned_operator_id, credit_score FROM users WHERE role NOT IN ('admin','operator','super')" + assignedCond + extraCond + " ORDER BY id ASC LIMIT ? OFFSET ?";
      rows = db.prepare(sql).all(...extraParams, pageSize, offset);
      const c = db.prepare("SELECT COUNT(1) AS c FROM users WHERE role NOT IN ('admin','operator','super')" + assignedCond + extraCond).get(...extraParams)?.c || 0;
      let balMap = new Map();
      if (includeBalances) {
        const ids = rows.map(r => Number(r.id));
        if (ids.length > 0) {
          const balRows = db.prepare(`SELECT user_id, currency, amount FROM balances WHERE user_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
          for (const r of balRows) {
            const m = balMap.get(r.user_id) || { PLN: 0, USD: 0, USDT: 0, EUR: 0 };
            m[String(r.currency || '').toUpperCase()] = Number(r.amount || 0);
            balMap.set(r.user_id, m);
          }
        }
      }
      const users = rows.map(u => ({ ...u, last_login_ip: u.last_login_ip ? decField(u.last_login_ip) : null, credit_score: Number.isFinite(Number(u.credit_score)) ? Number(u.credit_score) : null, balances: includeBalances ? (balMap.get(u.id) || { PLN: 0, USD: 0, USDT: 0, EUR: 0 }) : undefined }));
      return res.json({ ok: true, users, total: c });
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ---- Admin: 修改用户密码 ----
function operatorCanManageCustomer(req, uid) {
  try {
    if (!req.user || String(req.user.role) !== 'operator') return false;
    const u = db.prepare('SELECT role, assigned_operator_id FROM users WHERE id = ?').get(Number(uid));
    if (!u) return false;
    if (String(u.role) !== 'customer') return false;
    return Number(u.assigned_operator_id || 0) === Number(req.user.id || 0);
  } catch { return false; }
}

app.post('/api/admin/users/:uid/password', requireRoles(['super', 'admin', 'operator']), (req, res) => {
  try {
    const uid = Number(req.params.uid);
    const { password } = req.body || {};
    if (!Number.isFinite(uid) || !password || String(password).length < 6) {
      return res.status(400).json({ ok: false, error: 'bad uid or weak password' });
    }
    if (String(req.user.role) === 'operator' && !operatorCanManageCustomer(req, uid)) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    const row = db.prepare('SELECT id FROM users WHERE id = ?').get(uid);
    if (!row) return res.status(404).json({ ok: false, error: 'user not found' });
    db.prepare('UPDATE users SET password_hash=?, updated_at=? WHERE id=?').run(hashPassword(password), new Date().toISOString(), uid);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// [removed] 用户角色变更：客户与后台账号体系独立，此路由移除

// ---- Admin: 用户资金调整 ----
app.post('/api/admin/users/:uid/funds', requireRoles(['super', 'admin', 'operator']), (req, res) => {
  try {
    const uid = Number(req.params.uid);
    const { ops, reason = '', requestId = '', operatorId = null, operatorRole = '' } = req.body || {};
    if (!Number.isFinite(uid) || !Array.isArray(ops) || ops.length === 0) {
      return res.status(400).json({ ok: false, error: 'invalid payload' });
    }
    if (String(req.user.role) === 'operator' && !operatorCanManageCustomer(req, uid)) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    for (const r of ops) {
      const c = String(r?.currency || '').trim().toUpperCase();
      const a = Number(r?.amount || 0);
      if (!['PLN', 'USD', 'USDT', 'EUR'].includes(c)) return res.status(400).json({ ok: false, error: 'bad currency' });
      if (!Number.isFinite(a)) return res.status(400).json({ ok: false, error: 'bad amount' });
      upsertBalance(uid, c, a);
      try {
        const opIdFinal = String(req.user.role) === 'operator' ? Number(req.user.id) : (operatorId === null ? null : Number(operatorId));
        const opRoleFinal = String(req.user.role) || String(operatorRole || '');
        db.prepare('INSERT INTO fund_audit (user_id, operator_id, operator_role, request_id, reason, currency, amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(uid, opIdFinal, opRoleFinal, String(requestId || ''), String(reason || ''), c, a, new Date().toISOString());
      } catch { }
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ---- Admin: 设置用户归属 ----
app.post('/api/admin/users/:uid/assign', requireRoles(['super', 'admin', 'operator']), (req, res) => {
  try {
    const uid = Number(req.params.uid);
    const { adminId = null, operatorId = null } = req.body || {};
    if (!Number.isFinite(uid)) return res.status(400).json({ ok: false, error: 'bad uid' });
    const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(uid);
    if (!exists) return res.status(404).json({ ok: false, error: 'user not found' });
    const toIntOrNull = (v) => v === '' || v === null || typeof v === 'undefined' ? null : Number(v);
    let aid = toIntOrNull(adminId);
    let oid = toIntOrNull(operatorId);
    if (String(req.user.role) === 'operator') {
      // 运营仅可将客户归属到自己，不允许修改管理员归属
      if (!operatorCanManageCustomer(req, uid)) return res.status(403).json({ ok: false, error: 'Forbidden' });
      aid = null; // 不允许操作管理员归属
      oid = Number(req.user.id);
    }
    if (aid == null && Number.isFinite(Number(oid))) {
      const rowOp = db.prepare("SELECT assigned_admin_id AS admin_id FROM users WHERE id = ? AND role = 'operator'").get(Number(oid));
      const autoAdmin = rowOp && Number(rowOp.admin_id || 0);
      if (Number.isFinite(autoAdmin) && autoAdmin > 0) aid = autoAdmin;
    }
    db.prepare('UPDATE users SET assigned_admin_id=?, assigned_operator_id=?, updated_at=? WHERE id=?').run(aid, oid, new Date().toISOString(), uid);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ---- Admin: 删除用户 ----
app.delete('/api/admin/users/:uid', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const uid = Number(req.params.uid);
    if (!Number.isFinite(uid)) return res.status(400).json({ ok: false, error: 'bad uid' });
    db.prepare('DELETE FROM tokens WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM balances WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM positions WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM orders WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM users WHERE id = ?').run(uid);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ---- Admin: 代登录（颁发目标用户令牌） ----
app.post('/api/admin/impersonate', requireRoles(['super', 'admin', 'operator']), (req, res) => {
  try {
    const { userId } = req.body || {};
    const uid = Number(userId);
    if (!Number.isFinite(uid)) return res.status(400).json({ ok: false, error: 'bad userId' });
    const user = db.prepare('SELECT id, phone, name, role FROM users WHERE id = ?').get(uid);
    if (!user) return res.status(404).json({ ok: false, error: 'user not found' });
    const token = issueTokenForUser(uid);
    res.json({ ok: true, token, user });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ---- Auth: Logout ----
app.post('/api/auth/logout', requireAuth, (req, res) => {
  try {
    const hdr = String(req.headers['authorization'] || '').trim();
    const tk = hdr.replace(/^Bearer\s+/i, '').trim();
    if (tk) {
      try { db.prepare('DELETE FROM tokens WHERE token_hash = ?').run(sha256(tk)); } catch { }
      try { db.prepare('DELETE FROM tokens WHERE token = ?').run(tk); } catch { }
    }
    clearSessionCookie(res);
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Admin: 用户余额 ----
app.get('/api/admin/users/:uid/balances', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const uid = Number(req.params.uid);
    if (!Number.isFinite(uid)) return res.status(400).json({ ok: false, error: 'bad uid' });
    const rows = db.prepare('SELECT currency, amount, updated_at FROM balances WHERE user_id = ? ORDER BY currency ASC').all(uid);
    res.json({ ok: true, balances: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ---- Me: 持仓 ----
app.get('/api/me/positions', requireAuth, (req, res) => {
  try {
    const uid = Number(req.user.id);
    const cols = ensurePosCols();
    const selectCols = ['symbol', 'market', 'long_qty', 'short_qty', 'updated_at'];
    if (cols.hasAvgPrice) selectCols.push('avg_price');
    if (cols.hasLongAvg) selectCols.push('long_avg');
    if (cols.hasShortAvg) selectCols.push('short_avg');
    if (db.prepare('PRAGMA table_info(positions)').all().some(r => String(r.name) === 'locked')) selectCols.push('locked');
    const sql = `SELECT ${selectCols.join(', ')} FROM positions WHERE user_id = ? ORDER BY symbol ASC`;
    const raw = db.prepare(sql).all(uid);
    const rows = raw.map(r => ({
      symbol: r.symbol,
      market: r.market,
      long_qty: Number(r.long_qty || 0),
      short_qty: Number(r.short_qty || 0),
      avg_price: Number(r.avg_price ?? r.long_avg ?? 0),
      long_avg: Number(r.long_avg ?? r.avg_price ?? 0),
      short_avg: Number(r.short_avg ?? 0),
      locked: Number(r.locked ?? 0),
      updated_at: r.updated_at,
    }));
    res.json({ ok: true, positions: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ---- Me: 余额 ----
app.get('/api/me/balances', requireAuth, (req, res) => {
  try {
    const uid = Number(req.user.id);
    const rows = db.prepare('SELECT currency, amount, updated_at FROM balances WHERE user_id = ? ORDER BY currency ASC').all(uid);
    let disabled = false;
    try {
      const pln = db.prepare('SELECT amount FROM balances WHERE user_id = ? AND currency = ?').get(uid, 'PLN')?.amount || 0;
      disabled = Number(pln) < 0;
    } catch { }
    res.json({ ok: true, balances: rows, disabled });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ---- Flash Swap (闪兑) API ----
// 汇率缓存（5分钟刷新一次）
let forexRateCache = { ts: 0, USDPLN: 4.0, USDEUR: 0.92 };
const FOREX_CACHE_TTL = 5 * 60 * 1000; // 5分钟

// 从 EODHD 获取实时外汇汇率
async function getForexRatesFromEodhd() {
  const now = Date.now();
  // 使用缓存
  if (forexRateCache.ts && (now - forexRateCache.ts) < FOREX_CACHE_TTL) {
    return { USDPLN: forexRateCache.USDPLN, USDEUR: forexRateCache.USDEUR };
  }
  
  let usdPln = forexRateCache.USDPLN || 4.0;
  let usdEur = forexRateCache.USDEUR || 0.92;
  
  try {
    // 获取 USD/PLN
    const urlPln = `https://eodhd.com/api/real-time/USDPLN.FOREX?api_token=${EODHD_API_KEY}&fmt=json`;
    const respPln = await fetch(urlPln);
    if (respPln.ok) {
      const data = await respPln.json();
      const rate = Number(data.close || data.previousClose || data.price || 0);
      if (rate > 0) usdPln = rate;
    }
    
    // 获取 USD/EUR (实际上是 EUR/USD 的倒数)
    const urlEur = `https://eodhd.com/api/real-time/EURUSD.FOREX?api_token=${EODHD_API_KEY}&fmt=json`;
    const respEur = await fetch(urlEur);
    if (respEur.ok) {
      const data = await respEur.json();
      const eurUsd = Number(data.close || data.previousClose || data.price || 0);
      if (eurUsd > 0) usdEur = 1 / eurUsd; // USD/EUR = 1 / EUR/USD
    }
    
    forexRateCache = { ts: now, USDPLN: usdPln, USDEUR: usdEur };
    console.log(`[EODHD] 汇率更新: USD/PLN=${usdPln}, USD/EUR=${usdEur}`);
  } catch (e) {
    console.error('[EODHD] 获取汇率失败:', e.message);
  }
  
  return { USDPLN: usdPln, USDEUR: usdEur };
}

// 获取汇率
app.get('/api/swap/rates', requireAuth, async (req, res) => {
  try {
    // 从 EODHD 获取实时汇率
    const { USDPLN: usdPlnRate, USDEUR: usdEurRate } = await getForexRatesFromEodhd();
    const plnUsdRate = 1 / usdPlnRate;
    const eurUsdRate = 1 / usdEurRate;
    const plnEurRate = plnUsdRate * usdEurRate; // PLN -> USD -> EUR
    const eurPlnRate = eurUsdRate * usdPlnRate; // EUR -> USD -> PLN
    
    // 基于实时汇率计算所有汇率对
    // USDT 与 USD 保持 1:1
    const rates = {
      // PLN 相关
      PLN_USD: plnUsdRate,           // 1 PLN = ? USD
      USD_PLN: usdPlnRate,           // 1 USD = ? PLN
      PLN_USDT: plnUsdRate,          // 1 PLN = ? USDT (USDT≈USD)
      USDT_PLN: usdPlnRate,          // 1 USDT = ? PLN
      PLN_EUR: plnEurRate,           // 1 PLN = ? EUR
      EUR_PLN: eurPlnRate,           // 1 EUR = ? PLN
      // USD 相关
      USD_USDT: 1.0,                 // 1 USD = 1 USDT
      USDT_USD: 1.0,                 // 1 USDT = 1 USD
      USD_EUR: usdEurRate,           // 1 USD = ? EUR
      EUR_USD: eurUsdRate,           // 1 EUR = ? USD
      // EUR 相关
      EUR_USDT: eurUsdRate,          // 1 EUR = ? USDT (USDT≈USD)
      USDT_EUR: usdEurRate,          // 1 USDT = ? EUR
    };
    
    // 尝试从数据库读取自定义汇率（管理员可覆盖）
    try {
      const customRates = db.prepare('SELECT from_currency, to_currency, rate FROM swap_rates WHERE active = 1').all();
      for (const r of customRates) {
        const key = `${r.from_currency}_${r.to_currency}`;
        rates[key] = Number(r.rate);
      }
    } catch { /* 表不存在则使用默认值 */ }
    
    res.json({ ok: true, rates, source: 'eodhd', usdPlnRate, usdEurRate });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// 执行闪兑
app.post('/api/swap/execute', requireAuth, async (req, res) => {
  try {
    const uid = Number(req.user.id);
    const { from, to, amount } = req.body || {};
    
    const fromCurrency = String(from || '').toUpperCase();
    const toCurrency = String(to || '').toUpperCase();
    const swapAmount = Number(amount);
    
    // 验证参数
    const validCurrencies = ['PLN', 'USD', 'USDT', 'EUR'];
    if (!validCurrencies.includes(fromCurrency)) {
      return res.status(400).json({ ok: false, error: 'Invalid from currency' });
    }
    if (!validCurrencies.includes(toCurrency)) {
      return res.status(400).json({ ok: false, error: 'Invalid to currency' });
    }
    if (fromCurrency === toCurrency) {
      return res.status(400).json({ ok: false, error: 'Cannot swap same currency' });
    }
    if (!Number.isFinite(swapAmount) || swapAmount <= 0) {
      return res.status(400).json({ ok: false, error: 'Invalid amount' });
    }
    
    // 获取实时汇率
    const { USDPLN: usdPlnRate, USDEUR: usdEurRate } = await getForexRatesFromEodhd();
    const plnUsdRate = 1 / usdPlnRate;
    const eurUsdRate = 1 / usdEurRate;
    const plnEurRate = plnUsdRate * usdEurRate;
    const eurPlnRate = eurUsdRate * usdPlnRate;
    
    const rateKey = `${fromCurrency}_${toCurrency}`;
    const defaultRates = {
      PLN_USD: plnUsdRate, USD_PLN: usdPlnRate,
      PLN_USDT: plnUsdRate, USDT_PLN: usdPlnRate,
      PLN_EUR: plnEurRate, EUR_PLN: eurPlnRate,
      USD_USDT: 1.0, USDT_USD: 1.0,
      USD_EUR: usdEurRate, EUR_USD: eurUsdRate,
      EUR_USDT: eurUsdRate, USDT_EUR: usdEurRate,
    };
    let rate = defaultRates[rateKey] || 1;
    
    // 尝试从数据库读取自定义汇率（管理员可覆盖）
    try {
      const row = db.prepare('SELECT rate FROM swap_rates WHERE from_currency = ? AND to_currency = ? AND active = 1').get(fromCurrency, toCurrency);
      if (row && Number(row.rate) > 0) {
        rate = Number(row.rate);
      }
    } catch { /* 表不存在则使用默认值 */ }
    
    const received = swapAmount * rate;
    
    // 检查余额
    const fromBalance = db.prepare('SELECT amount FROM balances WHERE user_id = ? AND currency = ?').get(uid, fromCurrency);
    const currentFrom = Number(fromBalance?.amount || 0);
    
    if (currentFrom < swapAmount) {
      return res.status(400).json({ ok: false, error: 'Insufficient balance' });
    }
    
    // 执行闪兑（事务）
    const now = new Date().toISOString();
    db.transaction(() => {
      // 扣除 from 货币
      db.prepare(`
        INSERT INTO balances (user_id, currency, amount, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, currency) DO UPDATE SET amount = amount - ?, updated_at = ?
      `).run(uid, fromCurrency, -swapAmount, now, swapAmount, now);
      
      // 增加 to 货币
      db.prepare(`
        INSERT INTO balances (user_id, currency, amount, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, currency) DO UPDATE SET amount = amount + ?, updated_at = ?
      `).run(uid, toCurrency, received, now, received, now);
      
      // 记录闪兑日志
      try {
        db.prepare(`
          INSERT INTO swap_logs (user_id, from_currency, to_currency, from_amount, to_amount, rate, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(uid, fromCurrency, toCurrency, swapAmount, received, rate, now);
      } catch { /* 表不存在则跳过日志记录 */ }
      
      // 资金流水（fund_logs）
      try {
        db.prepare(`
          INSERT INTO fund_logs (user_id, change, balance_after, currency, type, reason, created_at)
          VALUES (?, ?, (SELECT amount FROM balances WHERE user_id = ? AND currency = ?), ?, 'swap_out', ?, ?)
        `).run(uid, -swapAmount, uid, fromCurrency, fromCurrency, `Swap to ${toCurrency}`, now);
        
        db.prepare(`
          INSERT INTO fund_logs (user_id, change, balance_after, currency, type, reason, created_at)
          VALUES (?, ?, (SELECT amount FROM balances WHERE user_id = ? AND currency = ?), ?, 'swap_in', ?, ?)
        `).run(uid, received, uid, toCurrency, toCurrency, `Swap from ${fromCurrency}`, now);
      } catch { /* fund_logs 表可能不存在 */ }
    })();
    
    res.json({ 
      ok: true, 
      success: true,
      from: fromCurrency,
      to: toCurrency,
      spent: swapAmount,
      received: received,
      rate: rate
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ---- Me: 头像（前端目前走本地存储；此处提供占位接口） ----
app.post('/api/me/avatar', requireAuth, (req, res) => {
  try {
    const { data, dataUrl, mime: mimeHint } = req.body || {};
    const raw = typeof data === 'string' && data ? data : (typeof dataUrl === 'string' ? dataUrl : '');
    if (!raw || raw.length < 48) return res.status(400).json({ ok: false, error: 'invalid avatar data' });
    const m = raw.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/i);
    const mime = (m ? m[1] : String(mimeHint || '').toLowerCase()) || 'image/png';
    const b64 = m ? m[3] : raw.replace(/^data:[^,]*,/, '');
    let buf;
    try { buf = Buffer.from(b64, 'base64'); } catch { return res.status(400).json({ ok: false, error: 'bad base64' }); }
    if (!buf || buf.length === 0) return res.status(400).json({ ok: false, error: 'empty data' });
    if (buf.length > 20 * 1024 * 1024) return res.status(413).json({ ok: false, error: 'too large' });
    const uid = Number(req.user.id);
    const ext = mime.includes('png') ? '.png' : (mime.includes('webp') ? '.webp' : '.jpg');
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
    const userDir = path.join(UPLOADS_DIR, 'users', String(uid));
    try { fs.mkdirSync(userDir, { recursive: true }); } catch { }
    const filename = `avatar_${stamp}${ext}`;
    const absPath = path.join(userDir, filename);
    fs.writeFileSync(absPath, buf);
    const publicPath = `/uploads/users/${uid}/${filename}`;
    const now = new Date().toISOString();
    db.prepare('UPDATE users SET avatar=?, avatar_mime=?, avatar_updated_at=?, updated_at=? WHERE id=?').run(publicPath, mime, now, now, uid);
    res.json({ ok: true, path: publicPath, size: buf.length, mime });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post('/api/me/name', requireAuth, (req, res) => {
  try {
    const { name } = req.body || {};
    const n = String(name || '').trim();
    if (n.length < 2 || n.length > 32) return res.status(400).json({ ok: false, error: 'bad name' });
    db.prepare('UPDATE users SET name=?, updated_at=? WHERE id=?').run(n, new Date().toISOString(), Number(req.user.id));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post('/api/me/password', requireAuth, (req, res) => {
  try {
    const { old, password } = req.body || {};
    if (!password || String(password).length < 6) return res.status(400).json({ ok: false, error: 'bad password' });
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(Number(req.user.id));
    if (!row || !row.password_hash) return res.status(404).json({ ok: false, error: 'user not found' });
    if (!bcrypt.compareSync(String(old || ''), String(row.password_hash))) return res.status(403).json({ ok: false, error: 'old password mismatch' });
    db.prepare('UPDATE users SET password_hash=?, updated_at=? WHERE id=?').run(hashPassword(password), new Date().toISOString(), Number(req.user.id));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post('/api/me/trade-password', requireAuth, (req, res) => {
  try {
    const { password, login } = req.body || {};
    const pin = String(password || '').replace(/\D/g, '');
    if (pin.length !== 6) return res.status(400).json({ ok: false, error: 'bad pin' });
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(Number(req.user.id));
    if (!row || !row.password_hash) return res.status(404).json({ ok: false, error: 'user not found' });
    if (!bcrypt.compareSync(String(login || ''), String(row.password_hash))) return res.status(403).json({ ok: false, error: 'login password mismatch' });
    db.prepare('UPDATE users SET trade_password=?, updated_at=? WHERE id=?').run(hashPassword(pin), new Date().toISOString(), Number(req.user.id));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});


// ---- Me: 订单 ----
app.get('/api/me/orders', requireAuth, (req, res) => {
  try {
    const uid = Number(req.user.id);
    const rows = db.prepare('SELECT id, symbol, market, side, type, price, qty, status, created_at, updated_at FROM orders WHERE user_id = ? ORDER BY created_at DESC, id DESC').all(uid);
    res.json({ ok: true, orders: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

function detectMarketFromSymbol(symbol) {
  const s = String(symbol || '').toUpperCase();
  if (/\.WA$/i.test(s)) return 'pl';
  if (/(USDT|USD|BUSD)$/.test(s)) return 'crypto';
  return 'us';
}
function currencyForMarket(market) {
  const m = String(market || '').toLowerCase();
  if (m === 'us' || m === 'usa') return 'USD';
  if (m === 'crypto') return 'USDT';
  if (m === 'pl' || m === 'poland') return 'PLN';
  return 'USD'; // default
}
function isTradingAllowedForMarket(market) {
  try {
    const s = db.prepare('SELECT mx_enabled, us_enabled, mx_holidays, us_holidays FROM market_settings WHERE id = 1').get() || { mx_enabled: 1, us_enabled: 1, mx_holidays: '', us_holidays: '' };
    const now = new Date();
    const y = now.getFullYear(); const m = (now.getMonth() + 1).toString().padStart(2, '0'); const d = now.getDate().toString().padStart(2, '0');
    const today = `${y}-${m}-${d}`;
    const wd = now.getDay();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const start = 8 * 60 + 30; // 08:30
    const end = 15 * 60; // 15:00
    const withinWindow = (wd >= 1 && wd <= 5) && (minutes >= start && minutes <= end);
    const listMx = String(s.mx_holidays || '').split(/[\s,]+/).filter(Boolean);
    const listUs = String(s.us_holidays || '').split(/[\s,]+/).filter(Boolean);
    if (market === 'pl') {
      if (!s.mx_enabled) return true; // 开关关闭：不限时
      if (listMx.includes(today)) return false;
      return withinWindow;
    }
    if (market === 'us') {
      if (!s.us_enabled) return true; // 开关关闭：不限时
      if (listUs.includes(today)) return false;
      return withinWindow;
    }
    return true;
  } catch { return true }
}
function upsertBalance(userId, currency, delta, reason = 'system') {
  const now = new Date().toISOString();
  const row = db.prepare('SELECT amount FROM balances WHERE user_id = ? AND currency = ?').get(userId, currency);
  const next = Number((row?.amount ?? 0)) + Number(delta || 0);
  db.prepare(`INSERT INTO balances (user_id, currency, amount, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(user_id, currency) DO UPDATE SET amount=excluded.amount, updated_at=excluded.updated_at`)
    .run(userId, currency, next, now);
  try { db.exec('CREATE TABLE IF NOT EXISTS balance_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, currency TEXT, amount REAL, reason TEXT, admin_id INTEGER, created_at TEXT)'); } catch { }
  try { db.prepare('INSERT INTO balance_logs (user_id, currency, amount, reason, admin_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(Number(userId), String(currency || ''), Number(delta || 0), String(reason || 'system'), null, now); } catch { }
  if (String(currency).toUpperCase() === 'PLN') {
    try {
      const flag = Number(next) < 0 ? 1 : 0;
      db.prepare('UPDATE users SET disallow_trading=?, updated_at=? WHERE id=?').run(flag, now, userId);
    } catch { }
  }
}

let fxCache = { rate: 18.0, ts: 0 };
function getTDKeyServer() {
  try {
    const envKey =
      process.env.VITE_TWELVEDATA_KEY ||
      process.env.VITE_TWELVE_DATA_KEY ||
      process.env.TWELVEDATA_KEY ||
      process.env.TD_KEY ||
      process.env.TD_KEY_OVERRIDE;
    return envKey || undefined;
  } catch { return undefined; }
}
async function getUsdPlnRateServer() {
  const ttl = 10 * 60 * 1000;
  if (Date.now() - fxCache.ts < ttl && Number.isFinite(fxCache.rate) && fxCache.rate > 0) return fxCache.rate;
  const key = getTDKeyServer();
  if (key) {
    try {
      const params = new URLSearchParams({ symbol: 'USD/PLN', apikey: key });
      const url = `https://api.twelvedata.com/forex/quote?${params.toString()}`;
      const res = await fetch(url);
      const j = await res.json();
      const price = Number(j?.price ?? j?.close ?? j?.previous_close);
      if (Number.isFinite(price) && price > 0) { fxCache = { rate: price, ts: Date.now() }; return price; }
    } catch { }
  }
  try {
    const j = await fetch('https://open.er-api.com/v6/latest/USD').then(r => r.json());
    const rate = Number(j?.rates?.PLN || NaN);
    if (Number.isFinite(rate) && rate > 0) { fxCache = { rate, ts: Date.now() }; return rate; }
  } catch { }
  try {
    const j = await fetch('https://api.exchangerate.host/latest?base=USD&symbols=PLN').then(r => r.json());
    const rate = Number(j?.rates?.PLN || NaN);
    if (Number.isFinite(rate) && rate > 0) { fxCache = { rate, ts: Date.now() }; return rate; }
  } catch { }
  return fxCache.rate;
}

// ---- Admin: Balance recharge ----
app.post('/api/admin/balances/recharge', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const { phone, userId, currency, amount } = req.body || {};
    const cur = String(currency || '').trim().toUpperCase();
    const amt = Number(amount);
    if (!['PLN', 'USD', 'USDT', 'EUR'].includes(cur)) return res.status(400).json({ error: 'bad currency' });
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'bad amount' });
    let uid = Number(userId || 0);
    if (!uid && phone) {
      const u = db.prepare('SELECT id FROM users WHERE phone = ?').get(String(phone));
      if (!u) return res.status(404).json({ error: 'user not found' });
      uid = Number(u.id);
    }
    if (!uid) return res.status(400).json({ error: 'user required' });
    upsertBalance(uid, cur, amt);
    try {
      const now = new Date().toISOString();
      db.prepare('INSERT INTO balance_logs (user_id, currency, amount, reason, admin_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(uid, cur, amt, 'admin_recharge', Number(req.user.id), now);
      db.prepare('INSERT INTO notifications (user_id, message, created_at, read) VALUES (?, ?, ?, 0)')
        .run(uid, `你已成功充值 ${cur} ${amt}`, now);
    } catch { }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Admin: Balance logs ----
app.get('/api/admin/balances/logs', requireRoles(adminReadRoles()), (req, res) => {
  try {
    const { phone = '', currency = '', from = '', to = '', page = '1', pageSize = '20' } = req.query || {};
    const where = [];
    const params = [];
    if (phone) { where.push('u.phone = ?'); params.push(String(phone)); }
    if (currency) { where.push('bl.currency = ?'); params.push(String(currency).toUpperCase()); }
    if (from) { where.push('bl.created_at >= ?'); params.push(String(from)); }
    if (to) { where.push('bl.created_at <= ?'); params.push(String(to)); }
    if (String(req.user?.role || '') === 'operator') { where.push('u.assigned_operator_id = ?'); params.push(Number(req.user.id || 0)); }
    const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';
    const p = Math.max(1, Number(page || 1));
    const ps = Math.max(1, Math.min(200, Number(pageSize || 20)));
    const off = (p - 1) * ps;
    const total = db.prepare(`SELECT COUNT(1) AS c FROM balance_logs bl LEFT JOIN users u ON u.id = bl.user_id ${whereSql}`).get(...params)?.c || 0;
    const items = db.prepare(`SELECT bl.id, bl.user_id AS userId, u.name AS userName, u.phone AS phone, bl.currency, bl.amount, bl.reason, bl.admin_id AS adminId, bl.created_at
                              FROM balance_logs bl LEFT JOIN users u ON u.id = bl.user_id ${whereSql}
                              ORDER BY bl.created_at DESC, bl.id DESC LIMIT ? OFFSET ?`).all(...params, ps, off);
    res.json({ items, total });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});
let posColsCache = null;
function ensurePosCols() {
  if (posColsCache) return posColsCache;
  try {
    const cols = db.prepare('PRAGMA table_info(positions)').all().map(r => String(r.name));
    posColsCache = {
      hasAvgPrice: cols.includes('avg_price'),
      hasLongAvg: cols.includes('long_avg'),
      hasShortAvg: cols.includes('short_avg')
    };
  } catch {
    posColsCache = { hasAvgPrice: true, hasLongAvg: false, hasShortAvg: false };
  }
  return posColsCache;
}
function upsertPosition(userId, symbol, market, side, qty, price) {
  const now = new Date().toISOString();
  const cols = ensurePosCols();
  const selectCols = ['id', 'long_qty', 'short_qty'];
  if (cols.hasAvgPrice) selectCols.push('avg_price');
  if (cols.hasLongAvg) selectCols.push('long_avg');
  if (cols.hasShortAvg) selectCols.push('short_avg');
  const row = db.prepare(`SELECT ${selectCols.join(', ')} FROM positions WHERE user_id = ? AND symbol = ? AND market = ?`).get(userId, symbol, market);
  let longQty = Number(row?.long_qty ?? 0);
  let shortQty = Number(row?.short_qty ?? 0);
  let longAvg = Number((cols.hasLongAvg ? row?.long_avg : undefined) ?? (cols.hasAvgPrice ? row?.avg_price : undefined) ?? 0);
  let shortAvg = Number(cols.hasShortAvg ? (row?.short_avg ?? 0) : 0);
  const q = Number(qty || 0);
  const p = Number(price || 0);
  if (side === 'buy') {
    if (shortQty > 0) {
      if (shortQty >= q) {
        shortQty -= q;
        if (shortQty === 0) shortAvg = 0;
      } else {
        const rem = q - shortQty;
        shortQty = 0; shortAvg = 0;
        const totalCost = longAvg * longQty + p * rem;
        longQty += rem;
        longAvg = longQty > 0 ? totalCost / longQty : 0;
      }
    } else {
      const totalCost = longAvg * longQty + p * q;
      longQty += q;
      longAvg = longQty > 0 ? totalCost / longQty : 0;
    }
  } else if (side === 'sell') {
    if (longQty > 0) {
      if (longQty >= q) {
        longQty -= q;
        if (longQty === 0) longAvg = 0;
      } else {
        const rem = q - longQty;
        longQty = 0; longAvg = 0;
        const totalShort = shortAvg * shortQty + p * rem;
        shortQty += rem;
        shortAvg = shortQty > 0 ? totalShort / shortQty : 0;
      }
    } else {
      const totalShort = shortAvg * shortQty + p * q;
      shortQty += q;
      shortAvg = shortQty > 0 ? totalShort / shortQty : 0;
    }
  }
  if (row?.id) {
    const setParts = ['long_qty=?', 'short_qty=?'];
    const params = [longQty, shortQty];
    if (cols.hasAvgPrice) { setParts.push('avg_price=?'); params.push(longAvg); }
    if (cols.hasLongAvg) { setParts.push('long_avg=?'); params.push(longAvg); }
    if (cols.hasShortAvg) { setParts.push('short_avg=?'); params.push(shortAvg); }
    setParts.push('updated_at=?');
    params.push(now);
    params.push(row.id);
    db.prepare(`UPDATE positions SET ${setParts.join(', ')} WHERE id=?`).run(...params);
  } else {
    const colsList = ['user_id', 'symbol', 'market', 'long_qty', 'short_qty'];
    const valsList = ['?', '?', '?', '?', '?'];
    const params = [userId, symbol, market, longQty, shortQty];
    if (cols.hasAvgPrice) { colsList.push('avg_price'); valsList.push('?'); params.push(longAvg); }
    if (cols.hasLongAvg) { colsList.push('long_avg'); valsList.push('?'); params.push(longAvg); }
    if (cols.hasShortAvg) { colsList.push('short_avg'); valsList.push('?'); params.push(shortAvg); }
    colsList.push('created_at', 'updated_at');
    valsList.push('?', '?');
    params.push(now, now);
    db.prepare(`INSERT INTO positions (${colsList.join(', ')}) VALUES (${valsList.join(', ')})`).run(...params);
  }
}

// ---- 交易执行（市价）----
app.post('/api/trade/execute', requireAuth, async (req, res) => {
  try {
    const { symbol, side, qty, price } = req.body || {};
    if (!symbol || !side) return res.status(400).json({ ok: false, error: 'invalid payload' });
    if (!['buy', 'sell'].includes(String(side))) return res.status(400).json({ ok: false, error: 'bad side' });
    if (!Number.isFinite(Number(qty)) || Number(qty) <= 0) return res.status(400).json({ ok: false, error: 'bad qty' });
    if (!Number.isFinite(Number(price)) || Number(price) <= 0) return res.status(400).json({ ok: false, error: 'bad price' });
    const market = detectMarketFromSymbol(symbol);
    if (!isTradingAllowedForMarket(market)) return res.status(403).json({ ok: false, error: 'market_time_closed', message: '当前不在交易时间' });
    // 根据市场类型使用对应货币：美股用USD，加密用USDT，波兰用PLN
    const currency = currencyForMarket(market);
    const cost = Number(qty) * Number(price); // 不再转换汇率，直接使用原价
    const fee = Number((cost * TRADE_FEE_RATE).toFixed(6)); // 手续费：千分之一
    const totalCost = cost + fee; // 买入时总成本 = 交易金额 + 手续费
    if (side === 'buy') {
      try {
        const bal = db.prepare('SELECT amount FROM balances WHERE user_id = ? AND currency = ?').get(Number(req.user.id), currency)?.amount || 0;
        if (Number(bal) < Number(totalCost)) return res.status(400).json({ ok: false, error: `insufficient_funds_${currency.toLowerCase()}`, need: Number(totalCost), have: Number(bal), currency, fee });
      } catch { }
    }
    if (side === 'sell') {
      try {
        const pRow = db.prepare('SELECT locked, long_qty FROM positions WHERE user_id = ? AND symbol = ? AND market = ?').get(Number(req.user.id), symbol, market);
        if (pRow && Number(pRow.locked || 0) === 1 && Number(pRow.long_qty || 0) > 0) return res.status(400).json({ ok: false, error: 'locked' });
      } catch { }
    }
    // 买入：扣除交易金额+手续费；卖出：收到交易金额-手续费
    const delta = side === 'buy' ? -totalCost : (cost - fee);
    upsertBalance(req.user.id, currency, delta, side === 'buy' ? 'trade_buy_market' : 'trade_sell_market');
    // 记录手续费扣除
    if (fee > 0) {
      upsertBalance(req.user.id, currency, 0, `trade_fee_${side}`); // 手续费已包含在 delta 中，这里只记录日志
    }
    const prev = db.prepare('SELECT long_qty, short_qty FROM positions WHERE user_id = ? AND symbol = ? AND market = ?').get(Number(req.user.id), symbol, market) || { long_qty: 0, short_qty: 0 };
    const isClose = (side === 'sell' && Number(prev.long_qty || 0) > 0) || (side === 'buy' && Number(prev.short_qty || 0) > 0);
    upsertPosition(req.user.id, symbol, market, side, Number(qty), Number(price));
    const now = new Date().toISOString();
    const info = db.prepare('INSERT INTO orders (user_id, symbol, market, side, type, price, qty, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(req.user.id, symbol, market, side, 'market', Number(price), Number(qty), 'filled', now, now);
    const oid = info.lastInsertRowid;
    const order = db.prepare('SELECT id, symbol, market, side, type, price, qty, status, created_at, updated_at FROM orders WHERE id = ?').get(oid);
    try {
      const amtStr = Number(cost).toFixed(2);
      const title = '交易已执行';
      const msg = isClose ? `你已完成平仓 ${symbol}，成交总金额 ${currency} ${amtStr}` : (side === 'buy' ? `你已完成购买 ${symbol}，成交总金额 ${currency} ${amtStr}` : `你已完成卖出 ${symbol}，成交总金额 ${currency} ${amtStr}`);
      db.prepare('INSERT INTO notifications (user_id, title, message, created_at, read, pinned) VALUES (?, ?, ?, ?, 0, 0)').run(Number(req.user.id), title, msg, now);
    } catch { }
    res.json({ ok: true, order });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ---- 限价单：创建 ----
app.post('/api/trade/orders', requireAuth, (req, res) => {
  try {
    const { symbol, side, price, qty, limitPrice } = req.body || {};
    const p = Number(typeof limitPrice !== 'undefined' ? limitPrice : price);
    if (!symbol || !side) return res.status(400).json({ ok: false, error: 'invalid payload' });
    if (!['buy', 'sell'].includes(String(side))) return res.status(400).json({ ok: false, error: 'bad side' });
    if (!Number.isFinite(Number(qty)) || Number(qty) <= 0) return res.status(400).json({ ok: false, error: 'bad qty' });
    if (!Number.isFinite(Number(p)) || Number(p) <= 0) return res.status(400).json({ ok: false, error: 'bad price' });
    const now = new Date().toISOString();
    if (!isTradingAllowedForMarket(detectMarketFromSymbol(symbol))) return res.status(403).json({ ok: false, error: 'market_time_closed', message: '当前不在交易时间' });
    if (side === 'sell') {
      try {
        const pRow = db.prepare('SELECT locked, long_qty FROM positions WHERE user_id = ? AND symbol = ? AND market = ?').get(Number(req.user.id), symbol, detectMarketFromSymbol(symbol));
        if (pRow && Number(pRow.locked || 0) === 1 && Number(pRow.long_qty || 0) > 0) return res.status(400).json({ ok: false, error: 'locked' });
      } catch { }
    }
    const info = db.prepare('INSERT INTO orders (user_id, symbol, market, side, type, price, qty, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(req.user.id, symbol, detectMarketFromSymbol(symbol), side, 'limit', Number(p), Number(qty), 'pending', now, now);
    const oid = info.lastInsertRowid;
    const order = db.prepare('SELECT id, symbol, market, side, type, price, qty, status, created_at, updated_at FROM orders WHERE id = ?').get(oid);
    res.json({ ok: true, order });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ---- 限价单：成交 ----
app.post('/api/trade/orders/:id/fill', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { price, qty, fillPrice } = req.body || {};
    const p = Number(typeof fillPrice !== 'undefined' ? fillPrice : price);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });
    if (!Number.isFinite(Number(qty)) || Number(qty) <= 0) return res.status(400).json({ ok: false, error: 'bad qty' });
    if (!Number.isFinite(Number(p)) || Number(p) <= 0) return res.status(400).json({ ok: false, error: 'bad price' });
    const order = db.prepare('SELECT id, symbol, market, side, type, status FROM orders WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!order || order.status !== 'pending') return res.status(404).json({ ok: false, error: 'order not pending' });
    const market = order.market;
    if (!isTradingAllowedForMarket(market)) return res.status(403).json({ ok: false, error: 'market_time_closed', message: '当前不在交易时间' });
    if (order.side === 'sell') {
      try {
        const pRow = db.prepare('SELECT locked, long_qty FROM positions WHERE user_id = ? AND symbol = ? AND market = ?').get(Number(req.user.id), order.symbol, market);
        if (pRow && Number(pRow.locked || 0) === 1 && Number(pRow.long_qty || 0) > 0) return res.status(400).json({ ok: false, error: 'locked' });
      } catch { }
    }
    // 根据市场类型使用对应货币
    const currency = currencyForMarket(market);
    const cost = Number(qty) * Number(p);
    const fee = Number((cost * TRADE_FEE_RATE).toFixed(6)); // 手续费：千分之一
    const totalCost = cost + fee;
    if (order.side === 'buy') {
      try {
        const bal = db.prepare('SELECT amount FROM balances WHERE user_id = ? AND currency = ?').get(Number(req.user.id), currency)?.amount || 0;
        if (Number(bal) < Number(totalCost)) return res.status(400).json({ ok: false, error: `insufficient_funds_${currency.toLowerCase()}`, need: Number(totalCost), have: Number(bal), currency, fee });
      } catch { }
    }
    // 买入：扣除交易金额+手续费；卖出：收到交易金额-手续费
    const delta2 = order.side === 'buy' ? -totalCost : (cost - fee);
    upsertBalance(req.user.id, currency, delta2, order.side === 'buy' ? 'trade_buy_limit' : 'trade_sell_limit');
    const prev2 = db.prepare('SELECT long_qty, short_qty FROM positions WHERE user_id = ? AND symbol = ? AND market = ?').get(Number(req.user.id), order.symbol, market) || { long_qty: 0, short_qty: 0 };
    const isClose2 = (order.side === 'sell' && Number(prev2.long_qty || 0) > 0) || (order.side === 'buy' && Number(prev2.short_qty || 0) > 0);
    upsertPosition(req.user.id, order.symbol, market, order.side, Number(qty), Number(p));
    const now = new Date().toISOString();
    db.prepare('UPDATE orders SET status=?, price=?, qty=?, updated_at=? WHERE id=?').run('filled', Number(p), Number(qty), now, id);
    const updated = db.prepare('SELECT id, symbol, market, side, type, price, qty, status, created_at, updated_at FROM orders WHERE id = ?').get(id);
    try {
      const amtStr = Number(cost).toFixed(2);
      const title = '交易已执行';
      const msg = isClose2 ? `你已完成平仓 ${order.symbol}，成交总金额 ${currency} ${amtStr}` : (order.side === 'buy' ? `你已完成购买 ${order.symbol}，成交总金额 ${currency} ${amtStr}` : `你已完成卖出 ${order.symbol}，成交总金额 ${currency} ${amtStr}`);
      db.prepare('INSERT INTO notifications (user_id, title, message, created_at, read, pinned) VALUES (?, ?, ?, ?, 0, 0)').run(Number(req.user.id), title, msg, now);
    } catch { }
    res.json({ ok: true, order: updated });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ---- Admin: Block Trade list/create/delete ----
app.get('/api/admin/trade/block/list', requireRoles(adminReadRoles()), (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toUpperCase();
    let rows;
    if (q) {
      rows = db.prepare('SELECT id, market, symbol, price, min_qty, start_at, end_at, lock_until, subscribe_key, status FROM block_trades WHERE symbol LIKE ? ORDER BY id DESC').all(`%${q}%`);
    } else {
      rows = db.prepare('SELECT id, market, symbol, price, min_qty, start_at, end_at, lock_until, subscribe_key, status FROM block_trades ORDER BY id DESC').all();
    }
    res.json({ items: rows });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Public: Block Trade list (active only) ----
app.get('/api/trade/block/list', (req, res) => {
  try {
    const rows = db.prepare('SELECT id, market, symbol, price, min_qty, start_at, end_at, lock_until, status FROM block_trades WHERE status = ? ORDER BY id DESC').all('active');
    res.json({ items: rows });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/api/admin/trade/block/create', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const { market, symbol, price, minQty, startAt, endAt, lockUntil, subscribeKey } = req.body || {};
    const mkt = String(market || '').trim().toLowerCase();
    const sym = String(symbol || '').trim().toUpperCase();
    const p = Number(price);
    const mq = Number(minQty);
    if (!sym || !mkt) return res.status(400).json({ error: 'invalid payload' });
    if (!Number.isFinite(p) || p <= 0) return res.status(400).json({ error: 'bad price' });
    if (!Number.isFinite(mq) || mq <= 0) return res.status(400).json({ error: 'bad minQty' });
    if (startAt && endAt && (new Date(startAt) >= new Date(endAt))) return res.status(400).json({ error: 'time window invalid' });
    const now = new Date().toISOString();
    const info = db.prepare('INSERT INTO block_trades (market, symbol, price, min_qty, start_at, end_at, lock_until, subscribe_key, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(mkt, sym, p, mq, String(startAt || ''), String(endAt || ''), String(lockUntil || ''), String(subscribeKey || ''), 'active', now, now);
    const row = db.prepare('SELECT id FROM block_trades WHERE id = ?').get(info.lastInsertRowid);
    res.json({ id: row.id });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});
app.post('/api/admin/trade/block/:id/update', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const { market, symbol, price, minQty, startAt, endAt, lockUntil, subscribeKey } = req.body || {};
    const mkt = String(market || '').trim().toLowerCase();
    const sym = String(symbol || '').trim().toUpperCase();
    const p = Number(price);
    const mq = Number(minQty);
    if (!sym || !mkt) return res.status(400).json({ error: 'invalid payload' });
    if (!Number.isFinite(p) || p <= 0) return res.status(400).json({ error: 'bad price' });
    if (!Number.isFinite(mq) || mq <= 0) return res.status(400).json({ error: 'bad minQty' });
    if (startAt && endAt && (new Date(startAt) >= new Date(endAt))) return res.status(400).json({ error: 'time window invalid' });
    const now = new Date().toISOString();
    db.prepare('UPDATE block_trades SET market=?, symbol=?, price=?, min_qty=?, start_at=?, end_at=?, lock_until=?, subscribe_key=?, updated_at=? WHERE id=?')
      .run(mkt, sym, p, mq, String(startAt || ''), String(endAt || ''), String(lockUntil || ''), String(subscribeKey || ''), now, id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.delete('/api/admin/trade/block/:id', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    db.prepare('DELETE FROM block_trades WHERE id = ?').run(id);
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/api/admin/trade/block/:id/activate', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const row = db.prepare('SELECT id FROM block_trades WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'not found' });
    db.prepare('UPDATE block_trades SET status=?, updated_at=? WHERE id=?').run('active', new Date().toISOString(), id);
    res.json({ ok: true, status: 'active' });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/api/admin/trade/block/:id/deactivate', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const row = db.prepare('SELECT id FROM block_trades WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'not found' });
    db.prepare('UPDATE block_trades SET status=?, updated_at=? WHERE id=?').run('inactive', new Date().toISOString(), id);
    res.json({ ok: true, status: 'inactive' });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Admin: Block Trade orders list/approve/reject ----
app.get('/api/admin/trade/block/orders', requireRoles(adminReadRoles()), (req, res) => {
  try {
    const status = String(req.query.status || '').trim();
    const phone = String(req.query.phone || '').trim();
    let operatorId = req.query.operatorId ? Number(req.query.operatorId) : null;
    const adminId = req.query.adminId ? Number(req.query.adminId) : null;
    const where = [];
    const params = [];
    if (status) { where.push('o.status = ?'); params.push(status); }
    if (phone) { where.push('u.phone = ?'); params.push(phone); }
    if (String(req.user?.role || '') === 'operator') { operatorId = Number(req.user.id || 0); }
    if (operatorId !== null) { where.push('u.assigned_operator_id = ?'); params.push(operatorId); }
    if (adminId !== null) { where.push('u.assigned_admin_id = ?'); params.push(adminId); }
    const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';
    const sql = `
      SELECT o.id, o.block_trade_id, o.user_id, o.price, o.qty, o.amount, o.status,
             o.submitted_at, o.approved_at, o.lock_until, o.locked, o.notes,
             b.symbol, b.market, u.phone
      FROM block_trade_orders o
      JOIN block_trades b ON o.block_trade_id = b.id
      JOIN users u ON o.user_id = u.id
      ${whereSql}
      ORDER BY o.submitted_at DESC`;
    const rows = db.prepare(sql).all(...params);
    const items = rows.map(r => {
      let ts = null;
      if (r.lock_until) {
        const d = new Date(r.lock_until);
        if (!isNaN(d.getTime())) ts = d.getTime();
      }
      return {
        id: r.id,
        block_trade_id: r.block_trade_id,
        user_id: r.user_id,
        phone: r.phone,
        symbol: r.symbol,
        market: r.market,
        price: r.price,
        qty: r.qty,
        amount: r.amount,
        status: r.status,
        submitted_at: r.submitted_at,
        approved_at: r.approved_at,
        lock_until: r.lock_until,
        lock_until_ts: ts,
        locked: Number(r.locked || 0) === 1,
        notes: r.notes,
      };
    });
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/api/admin/trade/block/orders/:id/approve', requireRoles(['super', 'admin', 'operator']), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const exists = db.prepare('SELECT id, user_id, block_trade_id, price, qty, status, cost_pln FROM block_trade_orders WHERE id = ?').get(id);
    if (!exists || exists.status !== 'submitted') return res.status(404).json({ error: 'not submitted' });
    if (String(req.user?.role || '') === 'operator') {
      const opId = db.prepare('SELECT assigned_operator_id AS opId FROM users WHERE id = ?').get(Number(exists.user_id))?.opId || null;
      if (Number(opId || 0) !== Number(req.user.id || 0)) return res.status(403).json({ error: 'Forbidden' });
    }
    const bt = db.prepare('SELECT market, symbol, lock_until FROM block_trades WHERE id = ?').get(exists.block_trade_id);
    const now = new Date().toISOString();
    const lu = bt?.lock_until || null;
    db.prepare('UPDATE block_trade_orders SET status=?, approved_at=?, lock_until=?, locked=? WHERE id=?').run('approved', now, lu, 1, id);
    // 扣款并入仓（统一 PLN 按汇率）
    try {
      const alreadyPaid = Number(exists.cost_pln || 0); // Need to fetch cost_pln first
      const mkt = String(bt?.market || 'us');
      const rate = mkt === 'pl' ? 1 : await getUsdPlnRateServer();
      const plnCost = Number(exists.qty) * Number(exists.price) * Number(rate);

      if (alreadyPaid > 0) {
        // New flow: already deducted at subscribe
      } else {
        // Legacy flow: deduct now
        upsertBalance(Number(exists.user_id), 'PLN', -plnCost, 'block_approve');
      }

      try {
        db.prepare('INSERT INTO notifications (user_id, title, message, created_at, read, pinned) VALUES (?, ?, ?, ?, 0, 0)')
          .run(Number(exists.user_id), '大宗交易已购买', `你已成功购买 ${String(bt.symbol || '')}，已支付 PLN ${Number(alreadyPaid > 0 ? alreadyPaid : plnCost).toFixed(2)}`, new Date().toISOString());
      } catch { }
    } catch { }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get('/api/me/trade/block/orders', requireAuth, (req, res) => {
  try {
    const status = String(req.query.status || '').trim();
    const uid = Number(req.user.id);
    let rows;
    if (status) rows = db.prepare('SELECT o.id, o.block_trade_id, b.symbol, b.market, o.price, o.qty, o.amount, o.status, o.submitted_at, o.approved_at, o.lock_until, o.locked, o.sell_price, o.sell_amount, o.profit, o.profit_pct, o.sold_at, o.notes FROM block_trade_orders o JOIN block_trades b ON o.block_trade_id = b.id WHERE o.user_id = ? AND o.status = ? ORDER BY o.submitted_at DESC').all(uid, status);
    else rows = db.prepare('SELECT o.id, o.block_trade_id, b.symbol, b.market, o.price, o.qty, o.amount, o.status, o.submitted_at, o.approved_at, o.lock_until, o.locked, o.sell_price, o.sell_amount, o.profit, o.profit_pct, o.sold_at, o.notes FROM block_trade_orders o JOIN block_trades b ON o.block_trade_id = b.id WHERE o.user_id = ? ORDER BY o.submitted_at DESC').all(uid);
    const items = rows.map(r => {
      let ts = null;
      if (r.lock_until) {
        const d = new Date(r.lock_until);
        if (!isNaN(d.getTime())) ts = d.getTime();
      }
      let sellPrice = Number(r.sell_price || NaN);
      if (!Number.isFinite(sellPrice) && r.notes && /^sold@/i.test(String(r.notes))) {
        const m = String(r.notes).match(/sold@([0-9.]+)/i);
        if (m) sellPrice = Number(m[1] || NaN);
      }
      let profit = Number(r.profit || NaN);
      let profitPct = Number(r.profit_pct || NaN);
      if ((!Number.isFinite(profit) || !Number.isFinite(profitPct)) && Number.isFinite(sellPrice)) {
        const buy = Number(r.price || 0);
        const qty = Number(r.qty || 0);
        profit = (sellPrice * qty) - (buy * qty);
        profitPct = buy > 0 ? ((sellPrice - buy) / buy) * 100 : 0;
      }
      return { id: r.id, blockId: r.block_trade_id, symbol: r.symbol, market: r.market, price: r.price, qty: r.qty, amount: r.amount, status: r.status, submitted_at: r.submitted_at, approved_at: r.approved_at, lock_until: r.lock_until, lock_until_ts: ts, locked: r.locked, sell_price: sellPrice, sell_amount: r.sell_amount, profit, profit_pct: profitPct, sold_at: r.sold_at };
    });
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Me: Block subscribe (直接购买，无需审核) ----
app.post('/api/trade/block/subscribe', requireAuth, async (req, res) => {
  try {
    const { blockId, qty, currentPrice, key } = req.body || {};
    const id = Number(blockId);
    const q = Number(qty);
    const p = Number(currentPrice);
    if (!Number.isFinite(id) || !Number.isFinite(q) || q <= 0 || !Number.isFinite(p) || p <= 0) return res.status(400).json({ error: 'invalid payload' });
    const bt = db.prepare('SELECT id, market, symbol, price, min_qty, start_at, end_at, lock_until, subscribe_key, status FROM block_trades WHERE id = ?').get(id);
    if (!bt || String(bt.status) !== 'active') return res.status(404).json({ error: 'not found' });
    const now = Date.now();
    const st = getPolandTimestamp(bt.start_at);
    const en = getPolandTimestamp(bt.end_at);
    const inWindow = (!st || st <= now) && (!en || now <= en);
    if (!inWindow) return res.status(400).json({ error: 'window closed', code: 3001 });
    if (q < Number(bt.min_qty || 0)) return res.status(400).json({ error: 'qty too small', code: 3002 });
    if (String(bt.subscribe_key || '') !== String(key || '')) return res.status(400).json({ error: 'bad key', code: 3003 });
    // 资金校验 - 根据市场类型使用对应货币：美股USD，加密USDT，波兰股PLN
    const market = String(bt.market || 'us').toLowerCase();
    const currency = currencyForMarket(market);
    const cost = Number(q) * Number(bt.price); // 使用日内交易价格，不是市场价
    const fee = Number((cost * TRADE_FEE_RATE).toFixed(6)); // 手续费：千分之一
    const totalCost = cost + fee;
    try {
      const bal = db.prepare('SELECT amount FROM balances WHERE user_id = ? AND currency = ?').get(Number(req.user.id), currency)?.amount || 0;
      if (Number(bal) < Number(totalCost)) return res.status(400).json({ error: `insufficient_funds_${currency.toLowerCase()}`, need: Number(totalCost), have: Number(bal), currency, fee });
      upsertBalance(Number(req.user.id), currency, -totalCost, 'block_subscribe');
    } catch (e) {
      if (String(e).includes('insufficient_funds')) throw e; // RETHROW insufficient funds error
    }
    const nowIso = new Date().toISOString();
    const lu = bt?.lock_until || null;
    // 直接插入为 approved 状态，无需后台审核
    const info = db.prepare('INSERT INTO block_trade_orders (block_trade_id, user_id, price, qty, amount, status, submitted_at, approved_at, lock_until, locked, cost_pln, currency, fee) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(bt.id, Number(req.user.id), bt.price, q, bt.price * q, 'approved', nowIso, nowIso, lu, 1, totalCost, currency, fee);
    // 发送购买成功通知
    try {
      db.prepare('INSERT INTO notifications (user_id, title, message, created_at, read, pinned) VALUES (?, ?, ?, ?, 0, 0)')
        .run(Number(req.user.id), '日内交易购买成功', `你已成功购买 ${String(bt.symbol || '')}，已支付 ${currency} ${Number(totalCost).toFixed(2)}（含手续费 ${fee.toFixed(2)}）`, nowIso);
    } catch { }
    res.json({ id: info.lastInsertRowid, status: 'approved', fee });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/api/admin/trade/block/orders/:id/reject', requireRoles(['super', 'admin', 'operator']), (req, res) => {
  try {
    const id = Number(req.params.id);
    const { notes = '' } = req.body || {};
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const exists = db.prepare('SELECT id, user_id, status, cost_pln, currency FROM block_trade_orders WHERE id = ?').get(id);
    if (!exists || exists.status !== 'submitted') return res.status(404).json({ error: 'not submitted' });
    if (String(req.user?.role || '') === 'operator') {
      const opId = db.prepare('SELECT assigned_operator_id AS opId FROM users WHERE id = ?').get(Number(exists.user_id))?.opId || null;
      if (Number(opId || 0) !== Number(req.user.id || 0)) return res.status(403).json({ error: 'Forbidden' });
    }
    // Refund if cost_pln > 0 (使用对应货币退款)
    const alreadyPaid = Number(exists.cost_pln || 0);
    const refundCurrency = exists.currency || 'PLN';
    if (alreadyPaid > 0) {
      upsertBalance(Number(exists.user_id), refundCurrency, alreadyPaid, 'block_reject_refund');
    }
    db.prepare('UPDATE block_trade_orders SET status=?, notes=? WHERE id=?').run('rejected', String(notes || ''), id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ===================== 红利股 (Dividend Stocks) API =====================

// ---- Admin: List dividend stocks ----
app.get('/api/admin/trade/dividend/list', requireRoles(adminReadRoles()), (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    let rows;
    if (q) {
      rows = db.prepare('SELECT id, market, symbol, name, price, min_qty, max_qty, start_at, end_at, subscribe_key, status, created_at FROM dividend_stocks WHERE symbol LIKE ? OR name LIKE ? ORDER BY id DESC').all(`%${q}%`, `%${q}%`);
    } else {
      rows = db.prepare('SELECT id, market, symbol, name, price, min_qty, max_qty, start_at, end_at, subscribe_key, status, created_at FROM dividend_stocks ORDER BY id DESC').all();
    }
    res.json({ items: rows });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Public: Dividend stocks list (active only) ----
app.get('/api/trade/dividend/list', (req, res) => {
  try {
    const rows = db.prepare('SELECT id, market, symbol, name, price, min_qty, max_qty, start_at, end_at, subscribe_key, status FROM dividend_stocks WHERE status = ? ORDER BY id DESC').all('active');
    // 返回 has_key 标志而不是实际密钥
    const items = rows.map(r => ({
      ...r,
      subscribe_key: r.subscribe_key ? true : false, // 只返回是否需要密钥
    }));
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Admin: Create dividend stock ----
app.post('/api/admin/trade/dividend/create', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const { market, symbol, name, price, minQty, maxQty, startAt, endAt, subscribeKey } = req.body || {};
    const mkt = String(market || '').trim().toLowerCase();
    const sym = String(symbol || '').trim().toUpperCase();
    const nm = String(name || '').trim();
    const p = Number(price);
    const mq = Number(minQty || 1);
    const xq = Number(maxQty || 0);
    if (!sym || !mkt) return res.status(400).json({ error: 'invalid payload' });
    if (!Number.isFinite(p) || p <= 0) return res.status(400).json({ error: 'bad price' });
    if (startAt && endAt && (new Date(startAt) >= new Date(endAt))) return res.status(400).json({ error: 'time window invalid' });
    const now = new Date().toISOString();
    const info = db.prepare('INSERT INTO dividend_stocks (market, symbol, name, price, min_qty, max_qty, start_at, end_at, subscribe_key, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(mkt, sym, nm, p, mq, xq || null, String(startAt || ''), String(endAt || ''), String(subscribeKey || ''), 'active', now, now);
    const row = db.prepare('SELECT id FROM dividend_stocks WHERE id = ?').get(info.lastInsertRowid);
    res.json({ id: row.id });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Admin: Update dividend stock ----
app.post('/api/admin/trade/dividend/:id/update', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const { market, symbol, name, price, minQty, maxQty, startAt, endAt, subscribeKey } = req.body || {};
    const mkt = String(market || '').trim().toLowerCase();
    const sym = String(symbol || '').trim().toUpperCase();
    const nm = String(name || '').trim();
    const p = Number(price);
    const mq = Number(minQty || 1);
    const xq = Number(maxQty || 0);
    if (!sym || !mkt) return res.status(400).json({ error: 'invalid payload' });
    if (!Number.isFinite(p) || p <= 0) return res.status(400).json({ error: 'bad price' });
    if (startAt && endAt && (new Date(startAt) >= new Date(endAt))) return res.status(400).json({ error: 'time window invalid' });
    const now = new Date().toISOString();
    db.prepare('UPDATE dividend_stocks SET market=?, symbol=?, name=?, price=?, min_qty=?, max_qty=?, start_at=?, end_at=?, subscribe_key=?, updated_at=? WHERE id=?')
      .run(mkt, sym, nm, p, mq, xq || null, String(startAt || ''), String(endAt || ''), String(subscribeKey || ''), now, id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Admin: Delete dividend stock ----
app.delete('/api/admin/trade/dividend/:id', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    db.prepare('DELETE FROM dividend_stocks WHERE id = ?').run(id);
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Admin: Activate/Deactivate dividend stock ----
app.post('/api/admin/trade/dividend/:id/activate', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    db.prepare('UPDATE dividend_stocks SET status=?, updated_at=? WHERE id=?').run('active', new Date().toISOString(), id);
    res.json({ ok: true, status: 'active' });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/api/admin/trade/dividend/:id/deactivate', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    db.prepare('UPDATE dividend_stocks SET status=?, updated_at=? WHERE id=?').run('inactive', new Date().toISOString(), id);
    res.json({ ok: true, status: 'inactive' });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Admin: Dividend stock orders list ----
app.get('/api/admin/trade/dividend/orders', requireRoles(adminReadRoles()), (req, res) => {
  try {
    const status = String(req.query.status || '').trim();
    const phone = String(req.query.phone || '').trim();
    let operatorId = req.query.operatorId ? Number(req.query.operatorId) : null;
    const where = [];
    const params = [];
    if (status) { where.push('o.status = ?'); params.push(status); }
    if (phone) { where.push('u.phone = ?'); params.push(phone); }
    if (String(req.user?.role || '') === 'operator') { operatorId = Number(req.user.id || 0); }
    if (operatorId !== null) { where.push('u.assigned_operator_id = ?'); params.push(operatorId); }
    const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';
    const sql = `
      SELECT o.id, o.dividend_stock_id, o.user_id, o.symbol, o.market, o.price, o.qty, o.amount, o.status,
             o.locked, o.submitted_at, o.approved_at, o.sell_price, o.sold_at, o.notes, o.currency, u.phone
      FROM dividend_stock_orders o
      JOIN users u ON o.user_id = u.id
      ${whereSql}
      ORDER BY o.submitted_at DESC`;
    const rows = db.prepare(sql).all(...params);
    res.json({ items: rows });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Admin: Approve dividend stock order ----
app.post('/api/admin/trade/dividend/orders/:id/approve', requireRoles(['super', 'admin', 'operator']), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const exists = db.prepare('SELECT id, user_id, symbol, status FROM dividend_stock_orders WHERE id = ?').get(id);
    if (!exists || exists.status !== 'pending') return res.status(404).json({ error: 'not pending' });
    // Operator 权限检查
    if (String(req.user?.role || '') === 'operator') {
      const opId = db.prepare('SELECT assigned_operator_id AS opId FROM users WHERE id = ?').get(Number(exists.user_id))?.opId || null;
      if (Number(opId || 0) !== Number(req.user.id || 0)) return res.status(403).json({ error: 'Forbidden' });
    }
    const now = new Date().toISOString();
    db.prepare('UPDATE dividend_stock_orders SET status=?, approved_at=?, locked=1 WHERE id=?').run('approved', now, id);
    try {
      db.prepare('INSERT INTO notifications (user_id, title, message, created_at, read, pinned) VALUES (?, ?, ?, ?, 0, 0)')
        .run(Number(exists.user_id), '红利股已购买', `你已成功购买红利股 ${exists.symbol}，锁定中`, now);
    } catch { }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Admin: Reject dividend stock order ----
app.post('/api/admin/trade/dividend/orders/:id/reject', requireRoles(['super', 'admin', 'operator']), (req, res) => {
  try {
    const id = Number(req.params.id);
    const { notes = '' } = req.body || {};
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const exists = db.prepare('SELECT id, user_id, status, amount, currency FROM dividend_stock_orders WHERE id = ?').get(id);
    if (!exists || exists.status !== 'pending') return res.status(404).json({ error: 'not pending' });
    // Operator 权限检查
    if (String(req.user?.role || '') === 'operator') {
      const opId = db.prepare('SELECT assigned_operator_id AS opId FROM users WHERE id = ?').get(Number(exists.user_id))?.opId || null;
      if (Number(opId || 0) !== Number(req.user.id || 0)) return res.status(403).json({ error: 'Forbidden' });
    }
    // Refund
    const refundAmount = Number(exists.amount || 0);
    const refundCurrency = exists.currency || 'PLN';
    if (refundAmount > 0) {
      upsertBalance(Number(exists.user_id), refundCurrency, refundAmount, 'dividend_reject_refund');
    }
    db.prepare('UPDATE dividend_stock_orders SET status=?, notes=? WHERE id=?').run('rejected', String(notes || ''), id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Admin: Unlock dividend stock order (allow selling) ----
app.post('/api/admin/trade/dividend/orders/:id/unlock', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const exists = db.prepare('SELECT id, user_id, symbol, status FROM dividend_stock_orders WHERE id = ?').get(id);
    if (!exists) return res.status(404).json({ error: 'not found' });
    db.prepare('UPDATE dividend_stock_orders SET locked=0 WHERE id=?').run(id);
    try {
      db.prepare('INSERT INTO notifications (user_id, title, message, created_at, read, pinned) VALUES (?, ?, ?, ?, 0, 0)')
        .run(Number(exists.user_id), '红利股已解锁', `你的红利股 ${exists.symbol} 已解锁，可以卖出`, new Date().toISOString());
    } catch { }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Admin: Lock dividend stock order ----
app.post('/api/admin/trade/dividend/orders/:id/lock', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    db.prepare('UPDATE dividend_stock_orders SET locked=1 WHERE id=?').run(id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Me: Dividend stock orders ----
app.get('/api/me/trade/dividend/orders', requireAuth, (req, res) => {
  try {
    const uid = Number(req.user.id);
    const rows = db.prepare('SELECT id, dividend_stock_id, symbol, market, price, qty, amount, status, locked, submitted_at, approved_at, sell_price, sell_amount, profit, profit_pct, sold_at, currency FROM dividend_stock_orders WHERE user_id = ? ORDER BY submitted_at DESC').all(uid);
    res.json({ items: rows });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Me: Subscribe dividend stock ----
app.post('/api/trade/dividend/subscribe', requireAuth, async (req, res) => {
  try {
    const { stockId, qty, key } = req.body || {};
    const id = Number(stockId);
    const q = Number(qty);
    if (!Number.isFinite(id) || !Number.isFinite(q) || q <= 0) return res.status(400).json({ error: 'invalid payload' });
    const ds = db.prepare('SELECT id, market, symbol, name, price, min_qty, max_qty, start_at, end_at, subscribe_key, status FROM dividend_stocks WHERE id = ?').get(id);
    if (!ds || String(ds.status) !== 'active') return res.status(404).json({ error: 'not found' });
    // Check time window
    const now = Date.now();
    const st = getPolandTimestamp(ds.start_at);
    const en = getPolandTimestamp(ds.end_at);
    const inWindow = (!st || st <= now) && (!en || now <= en);
    if (!inWindow) return res.status(400).json({ error: 'window closed', code: 3001 });
    // Check qty
    if (q < Number(ds.min_qty || 1)) return res.status(400).json({ error: 'qty too small', code: 3002 });
    if (ds.max_qty && q > Number(ds.max_qty)) return res.status(400).json({ error: 'qty too large', code: 3004 });
    // Check key
    if (ds.subscribe_key && String(ds.subscribe_key) !== String(key || '')) return res.status(400).json({ error: 'bad key', code: 3003 });
    // Check funds
    const market = String(ds.market || 'us').toLowerCase();
    const currency = currencyForMarket(market);
    const cost = Number(q) * Number(ds.price);
    const fee = Number((cost * TRADE_FEE_RATE).toFixed(6)); // 手续费：千分之一
    const totalCost = cost + fee;
    const bal = db.prepare('SELECT amount FROM balances WHERE user_id = ? AND currency = ?').get(Number(req.user.id), currency)?.amount || 0;
    if (Number(bal) < Number(totalCost)) return res.status(400).json({ error: `insufficient_funds_${currency.toLowerCase()}`, need: totalCost, have: bal, currency, fee });
    // Deduct funds (including fee)
    upsertBalance(Number(req.user.id), currency, -totalCost, 'dividend_subscribe');
    // Create order
    const info = db.prepare('INSERT INTO dividend_stock_orders (dividend_stock_id, user_id, symbol, market, price, qty, amount, status, locked, submitted_at, currency, fee) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ds.id, Number(req.user.id), ds.symbol, ds.market, ds.price, q, totalCost, 'pending', 1, new Date().toISOString(), currency, fee);
    res.json({ id: info.lastInsertRowid, status: 'pending', fee });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Me: Sell dividend stock (only if unlocked) ----
app.post('/api/me/trade/dividend/orders/:id/sell', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { sellPrice } = req.body || {};
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const o = db.prepare('SELECT id, user_id, symbol, market, price, qty, status, locked, currency FROM dividend_stock_orders WHERE id = ?').get(id);
    if (!o || Number(o.user_id) !== Number(req.user.id)) return res.status(404).json({ error: 'not found' });
    if (o.status !== 'approved') return res.status(400).json({ error: 'not approved' });
    if (Number(o.locked) === 1) return res.status(400).json({ error: 'locked', message: '红利股尚未解锁，无法卖出' });
    const sp = Number(sellPrice);
    if (!Number.isFinite(sp) || sp <= 0) return res.status(400).json({ error: 'bad sell price' });
    const qty = Number(o.qty || 0);
    const buyPrice = Number(o.price || 0);
    const sellAmount = sp * qty;
    const fee = Number((sellAmount * TRADE_FEE_RATE).toFixed(6)); // 卖出手续费：千分之一
    const netSellAmount = sellAmount - fee; // 扣除手续费后的实际收入
    const profit = netSellAmount - (buyPrice * qty); // 利润也要扣除手续费
    const profitPct = buyPrice > 0 ? ((sp - buyPrice) / buyPrice * 100) : 0;
    const currency = o.currency || 'PLN';
    const nowIso = new Date().toISOString();
    // Credit funds (after fee deduction)
    upsertBalance(Number(req.user.id), currency, netSellAmount, 'dividend_sell');
    // Update order
    db.prepare('UPDATE dividend_stock_orders SET status=?, sell_price=?, sell_amount=?, profit=?, profit_pct=?, sold_at=?, sell_fee=? WHERE id=?')
      .run('sold', sp, netSellAmount, profit, profitPct, nowIso, fee, id);
    // 佣金计算（如果有推荐人且有利润）
    const inviterId = db.prepare('SELECT invited_by_user_id FROM users WHERE id = ?').get(Number(req.user.id))?.invited_by_user_id || null;
    if (inviterId && Number(profit) > 0) {
      try {
        const s = getCommissionSettings();
        const pct = Number(s.dividendPct || s.blockPct || 0); // 使用 dividendPct 或回退到 blockPct
        const freezeDays = Number(s.dividendFreezeDays || s.blockFreezeDays || 0);
        if (pct > 0) {
          const commission = Number(((profit * pct) / 100).toFixed(2));
          const frozenUntil = new Date(Date.now() + Math.max(0, freezeDays) * 24 * 3600 * 1000).toISOString();
          db.prepare('INSERT INTO commission_records (inviter_id, invitee_id, source, order_id, currency, amount, status, frozen_until, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(Number(inviterId), Number(req.user.id), 'dividend', id, currency, commission, freezeDays > 0 ? 'frozen' : 'released', freezeDays > 0 ? frozenUntil : null, nowIso);
          if (freezeDays <= 0) upsertCommissionBalance(Number(inviterId), currency, commission);
        }
      } catch { }
    }
    res.json({ ok: true, profit, profitPct });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ===================== End of Dividend Stocks API =====================

// ---- Version info ----
app.get('/version', (req, res) => {
  try {
    const guessDist = () => { try { return FRONTEND_DIST || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'moxige', 'dist'); } catch { return '' } };
    const assetsDir = path.join(guessDist() || '', 'assets');
    const files = assetsDir && fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir).filter(n => /(\.js|\.css)$/.test(n)) : [];
    const frontendAssets = files.map(f => {
      const m = f.match(/\.([a-f0-9]{8,})\./i);
      return { file: f, hash: m ? m[1] : '' };
    });
    const api = { name: 'mxg-backend', version: '1.0.1' };
    const buildInfoPath = path.join(guessDist() || '', 'build-info.json');
    let build = { buildTime: '' };
    try { build = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8')); } catch { }
    const ts = new Date().toISOString();
    const origin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['host'] || ''}`;
    res.json({ api, frontendAssets, build, ts, origin });
  } catch (e) {
    res.json({ api: { name: 'mxg-backend', version: '1.0.1' }, frontendAssets: [], build: {}, ts: new Date().toISOString() });
  }
});

app.get('/api/health', (req, res) => {
  try { res.json({ ok: true, ts: new Date().toISOString() }); } catch { res.json({ ok: true }); }
});

// ---- Admin: Staffs list/create/delete ----
app.get('/api/admin/staffs', requireRoles(['super', 'admin', 'operator']), (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize || 20)));
    const offset = (page - 1) * pageSize;
    let whereSql = "WHERE role IN ('admin','operator','super')";
    const params = [];
    if (String(req.user?.role || '') === 'operator') {
      const me = db.prepare('SELECT assigned_admin_id FROM users WHERE id = ?').get(Number(req.user.id));
      const aid = Number(me?.assigned_admin_id || 0);
      const ids = [Number(req.user.id)];
      if (aid) ids.push(aid);
      whereSql = `WHERE id IN (${ids.map(() => '?').join(',')})`;
      params.push(...ids);
    } else {
      if (q) { whereSql += ' AND (account LIKE ? OR name LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
    }
    const items = db.prepare(`SELECT id, name, account, role, assigned_admin_id AS admin_id, disallow_login AS disabled FROM users ${whereSql} ORDER BY id ASC LIMIT ? OFFSET ?`).all(...params, pageSize, offset);
    const total = db.prepare(`SELECT COUNT(1) AS c FROM users ${whereSql}`).get(...params)?.c || 0;
    res.json({ items, total });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/api/admin/staffs', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const { name, account, password, role, adminId = null } = req.body || {};
    const n = String(name || '').trim();
    const acc = String(account || '').trim();
    const r = String(role || '').trim();
    if (!n || !acc || !password || String(password).length < 6) return res.status(400).json({ error: 'invalid payload' });
    if (!['admin', 'operator'].includes(r)) return res.status(400).json({ error: 'bad role' });
    const now = new Date().toISOString();
    const info = db.prepare('INSERT INTO users (email, password_hash, name, created_at, updated_at, phone, role, account, assigned_admin_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(`${acc}@account.local`, hashPassword(password), n, now, now, null, r, acc, adminId === null ? null : Number(adminId));
    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.delete('/api/admin/staffs/:id', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const u = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
    if (!u) return res.status(404).json({ error: 'not found' });
    if (String(u.role) === 'super') return res.status(403).json({ error: 'cannot delete super' });
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Admin: Positions aggregated query ----
app.get('/api/admin/positions', requireRoles(['super', 'admin', 'operator']), (req, res) => {
  try {
    const phone = String(req.query.phone || '').trim();
    let operatorId = req.query.operatorId ? Number(req.query.operatorId) : null;
    const status = String(req.query.status || '').trim();
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize || 20)));
    const sortBy = String(req.query.sortBy || 'time');
    const sortDir = String(req.query.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const offset = (page - 1) * pageSize;
    const where = [];
    const params = [];
    if (phone) { where.push('u.phone = ?'); params.push(phone); }
    if (String(req.user?.role || '') === 'operator') { operatorId = Number(req.user.id || 0); }
    if (operatorId !== null) { where.push('u.assigned_operator_id = ?'); params.push(operatorId); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = db.prepare(`SELECT p.id, p.user_id AS userId, u.name AS userName, u.phone AS phone, u.assigned_operator_id AS operatorId, p.symbol, p.market, p.long_qty AS longQty, p.short_qty AS shortQty, p.avg_price AS avgPrice, p.locked AS locked, (p.long_qty * p.avg_price) AS amount, p.updated_at AS lastTradeAt FROM positions p JOIN users u ON p.user_id = u.id ${whereSql} ORDER BY ${sortBy === 'amount' ? 'amount' : 'lastTradeAt'} ${sortDir} LIMIT ? OFFSET ?`).all(...params, pageSize, offset);
    const items = rows.map(r => {
      let st = 'completed';
      if (Number(r.longQty) > 0 || Number(r.shortQty) > 0) st = 'holding';
      return { ...r, status: st };
    });
    const total = db.prepare(`SELECT COUNT(1) AS c FROM positions p JOIN users u ON p.user_id = u.id ${whereSql}`).get(...params)?.c || 0;
    if (status) {
      const allowed = status.split(',');
      const filtered = items.filter(it => allowed.includes(it.status));
      return res.json({ items: filtered, total: filtered.length });
    }
    res.json({ items, total });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/api/admin/positions/:id/unlock', requireRoles(['super', 'admin', 'operator']), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const row = db.prepare('SELECT p.id, u.assigned_operator_id AS opId FROM positions p JOIN users u ON p.user_id = u.id WHERE p.id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'not found' });
    if (String(req.user?.role || '') === 'operator') {
      const my = Number(req.user?.id || 0);
      if (Number(row.opId || 0) !== my) return res.status(403).json({ error: 'Forbidden' });
    }
    db.prepare('UPDATE positions SET locked=0, updated_at=? WHERE id=?').run(new Date().toISOString(), id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

app.post('/api/admin/positions/:id/lock', requireRoles(['super', 'admin', 'operator']), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const row = db.prepare('SELECT p.id, u.assigned_operator_id AS opId FROM positions p JOIN users u ON p.user_id = u.id WHERE p.id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'not found' });
    if (String(req.user?.role || '') === 'operator') {
      const my = Number(req.user?.id || 0);
      if (Number(row.opId || 0) !== my) return res.status(403).json({ error: 'Forbidden' });
    }
    db.prepare('UPDATE positions SET locked=1, updated_at=? WHERE id=?').run(new Date().toISOString(), id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/api/admin/positions/:id/force_close', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    const { price } = req.body || {};
    if (!Number.isFinite(id) || !Number.isFinite(Number(price)) || Number(price) <= 0) return res.status(400).json({ error: 'invalid payload' });
    const pos = db.prepare('SELECT id, user_id AS userId, symbol, market, long_qty AS longQty FROM positions WHERE id = ?').get(id);
    if (!pos) return res.status(404).json({ error: 'not found' });
    const q = Number(pos.longQty || 0);
    if (q <= 0) return res.status(400).json({ error: 'no long position' });
    const p = Number(price);
    const amt = q * p;
    const currency = currencyForMarket(pos.market);
    upsertBalance(Number(pos.userId), currency, amt);
    db.prepare('UPDATE positions SET long_qty=0, long_avg=0, avg_price=0, updated_at=? WHERE id=?').run(new Date().toISOString(), id);
    try { db.prepare('INSERT INTO notifications (user_id, title, message, created_at, read, pinned) VALUES (?, ?, ?, ?, 0, 0)').run(Number(pos.userId), '订单已强制平仓', '你的该笔订单已强制平仓', new Date().toISOString()); } catch { }
    res.json({ ok: true, amount: amt });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.delete('/api/admin/positions/:id', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const row = db.prepare('SELECT id FROM positions WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'not found' });
    db.prepare('DELETE FROM positions WHERE id = ?').run(id);
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Admin: Add position to user (with fund deduction, can go negative) ----
app.post('/api/admin/positions/add', requireRoles(['super', 'admin', 'operator']), (req, res) => {
  try {
    const { userId, symbol, market, quantity, price, deductFunds } = req.body || {};
    
    // Validate input
    const uid = Number(userId);
    const qty = Number(quantity);
    const prc = Number(price);
    const shouldDeduct = deductFunds !== false; // default true
    
    if (!Number.isFinite(uid) || uid <= 0) return res.status(400).json({ error: '无效的用户ID' });
    if (!symbol || typeof symbol !== 'string') return res.status(400).json({ error: '请输入股票代码' });
    if (!market || !['usa', 'poland', 'crypto'].includes(market)) return res.status(400).json({ error: '无效的市场类型' });
    if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: '请输入有效的数量' });
    if (!Number.isFinite(prc) || prc <= 0) return res.status(400).json({ error: '请输入有效的价格' });
    
    // Check user exists
    const user = db.prepare('SELECT id, name, phone, assigned_operator_id FROM users WHERE id = ?').get(uid);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    
    // Check operator permission
    if (String(req.user?.role || '') === 'operator') {
      const myId = Number(req.user?.id || 0);
      if (Number(user.assigned_operator_id || 0) !== myId) {
        return res.status(403).json({ error: '无权操作此用户' });
      }
    }
    
    const symbolUpper = String(symbol).toUpperCase().trim();
    const totalCost = qty * prc;
    const currency = currencyForMarket(market);
    const now = new Date().toISOString();
    
    // Deduct funds (allow negative balance)
    if (shouldDeduct) {
      // Get current balance
      const balRow = db.prepare('SELECT amount FROM balances WHERE user_id = ? AND currency = ?').get(uid, currency);
      const currentBalance = Number(balRow?.amount || 0);
      const newBalance = currentBalance - totalCost;
      
      // Update or insert balance (can be negative)
      if (balRow) {
        db.prepare('UPDATE balances SET amount = ?, updated_at = ? WHERE user_id = ? AND currency = ?').run(newBalance, now, uid, currency);
      } else {
        db.prepare('INSERT INTO balances (user_id, currency, amount, updated_at) VALUES (?, ?, ?, ?)').run(uid, currency, -totalCost, now);
      }
    }
    
    // Check if position already exists for this user/symbol/market
    const existingPos = db.prepare('SELECT id, long_qty, long_avg, avg_price FROM positions WHERE user_id = ? AND symbol = ? AND market = ?').get(uid, symbolUpper, market);
    
    if (existingPos) {
      // Update existing position (add to quantity, recalculate average price)
      const oldQty = Number(existingPos.long_qty || 0);
      const oldAvg = Number(existingPos.long_avg || existingPos.avg_price || 0);
      const newQty = oldQty + qty;
      const newAvg = oldQty > 0 ? ((oldQty * oldAvg) + (qty * prc)) / newQty : prc;
      
      db.prepare('UPDATE positions SET long_qty = ?, long_avg = ?, avg_price = ?, updated_at = ? WHERE id = ?')
        .run(newQty, newAvg, newAvg, now, existingPos.id);
      
      res.json({ 
        ok: true, 
        positionId: existingPos.id, 
        action: 'updated',
        quantity: newQty,
        avgPrice: newAvg,
        deducted: shouldDeduct ? totalCost : 0,
        currency
      });
    } else {
      // Create new position
      const result = db.prepare('INSERT INTO positions (user_id, symbol, market, long_qty, short_qty, long_avg, short_avg, avg_price, locked, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, 0, ?, 0, ?, ?)')
        .run(uid, symbolUpper, market, qty, prc, prc, now, now);
      
      res.json({ 
        ok: true, 
        positionId: result.lastInsertRowid, 
        action: 'created',
        quantity: qty,
        avgPrice: prc,
        deducted: shouldDeduct ? totalCost : 0,
        currency
      });
    }
    
    // Add notification to user
    try {
      const marketName = { usa: '美股', poland: '波兰股', crypto: '加密货币' }[market] || market;
      db.prepare('INSERT INTO notifications (user_id, title, message, created_at, read, pinned) VALUES (?, ?, ?, ?, 0, 0)')
        .run(uid, '持仓变动', `您的 ${marketName} ${symbolUpper} 持仓已增加 ${qty} 股/份`, now);
    } catch { }
    
  } catch (e) {
    console.error('[admin/positions/add]', e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Admin: Search users for position adding ----
app.get('/api/admin/users/search', requireRoles(['super', 'admin', 'operator']), (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ users: [] });
    
    let where = "(u.phone LIKE ? OR u.name LIKE ? OR CAST(u.id AS TEXT) = ?)";
    const params = [`%${q}%`, `%${q}%`, q];
    
    // Operator can only search their assigned users
    if (String(req.user?.role || '') === 'operator') {
      const myId = Number(req.user?.id || 0);
      where += ' AND u.assigned_operator_id = ?';
      params.push(myId);
    }
    
    const rows = db.prepare(`SELECT u.id, u.name, u.phone FROM users u WHERE ${where} AND u.role = 'user' LIMIT 20`).all(...params);
    res.json({ users: rows });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// SPA fallback for non-API routes: serve index.html (must be before 404)
try {
  app.get(/^\/(?!api\/).*$/, (req, res, next) => {
    try {
      const indexPath = path.join(FRONTEND_DIST, 'index.html');
      if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
    } catch { }
    next();
  });
} catch { }

// ---- EUR 充值任务奖励系统 ----
// 创建表
try {
  db.exec(`CREATE TABLE IF NOT EXISTS recharge_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    tier INTEGER NOT NULL,
    claimed_at TEXT NOT NULL,
    reward_amount REAL NOT NULL,
    UNIQUE(user_id, tier)
  )`);
} catch {}

// 任务档位配置
const RECHARGE_TIERS = [
  { tier: 1, threshold: 10000, reward: 100 },   // 1万EUR → 100 PLN
  { tier: 2, threshold: 20000, reward: 200 },   // 2万EUR → 200 PLN
  { tier: 3, threshold: 50000, reward: 600 },   // 5万EUR → 600 PLN
  { tier: 4, threshold: 80000, reward: 888 },   // 8万EUR → 888 PLN
  { tier: 5, threshold: 100000, reward: 1888 }, // 10万EUR → 1888 PLN
];

// 获取用户EUR充值总额
function getUserEurRechargeTotal(userId) {
  try {
    const row = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM balance_logs 
      WHERE user_id = ? AND currency = 'EUR' AND amount > 0 AND reason = 'admin_recharge'
    `).get(userId);
    return Number(row?.total || 0);
  } catch { return 0; }
}

// 获取用户已领取的奖励档位
function getUserClaimedTiers(userId) {
  try {
    const rows = db.prepare('SELECT tier FROM recharge_tasks WHERE user_id = ?').all(userId);
    return rows.map(r => r.tier);
  } catch { return []; }
}

// 获取充值任务进度
app.get('/api/me/recharge-tasks', requireAuth, (req, res) => {
  try {
    const uid = Number(req.user.id);
    const totalEur = getUserEurRechargeTotal(uid);
    const claimedTiers = getUserClaimedTiers(uid);
    
    const tasks = RECHARGE_TIERS.map(t => ({
      tier: t.tier,
      threshold: t.threshold,
      reward: t.reward,
      progress: Math.min(totalEur / t.threshold * 100, 100),
      completed: totalEur >= t.threshold,
      claimed: claimedTiers.includes(t.tier),
    }));
    
    res.json({ ok: true, totalEur, tasks });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// 领取奖励
app.post('/api/me/recharge-tasks/claim', requireAuth, (req, res) => {
  try {
    const uid = Number(req.user.id);
    const { tier } = req.body || {};
    const tierNum = Number(tier);
    
    // 验证档位
    const tierConfig = RECHARGE_TIERS.find(t => t.tier === tierNum);
    if (!tierConfig) {
      return res.status(400).json({ ok: false, error: '无效的奖励档位' });
    }
    
    // 检查是否已领取
    const claimedTiers = getUserClaimedTiers(uid);
    if (claimedTiers.includes(tierNum)) {
      return res.status(400).json({ ok: false, error: '该奖励已领取' });
    }
    
    // 检查是否达到门槛
    const totalEur = getUserEurRechargeTotal(uid);
    if (totalEur < tierConfig.threshold) {
      return res.status(400).json({ ok: false, error: `未达到充值门槛 ${tierConfig.threshold} EUR` });
    }
    
    // 发放奖励
    const now = new Date().toISOString();
    db.prepare('INSERT INTO recharge_tasks (user_id, tier, claimed_at, reward_amount) VALUES (?, ?, ?, ?)')
      .run(uid, tierNum, now, tierConfig.reward);
    
    // 增加PLN余额
    upsertBalance(uid, 'PLN', tierConfig.reward);
    
    // 记录日志
    try {
      db.prepare('INSERT INTO balance_logs (user_id, currency, amount, reason, admin_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(uid, 'PLN', tierConfig.reward, `recharge_task_tier_${tierNum}`, 0, now);
    } catch {}
    
    // 发送通知
    try {
      db.prepare('INSERT INTO notifications (user_id, title, message, created_at, read, pinned) VALUES (?, ?, ?, ?, 0, 0)')
        .run(uid, '充值奖励领取成功', `恭喜！您已领取充值 ${tierConfig.threshold} EUR 的奖励 ${tierConfig.reward} PLN`, now);
    } catch {}
    
    res.json({ ok: true, reward: tierConfig.reward, message: `成功领取 ${tierConfig.reward} PLN 奖励！` });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.listen(PORT, () => {
  console.log(`[mxg-backend] running on port ${PORT}`);
});
// ---- Admin: DB backups summary ----
app.get('/api/admin/db/summary_list', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const Database = require('better-sqlite3');
    const dir = path.dirname(resolvedDbPath);
    const names = fs.readdirSync(dir).filter(n => /^app\.bak\.\d{14}\.db$/.test(n)).sort();
    const items = [];
    for (const name of names) {
      const p = path.join(dir, name);
      let tmp;
      try { tmp = new Database(p, { fileMustExist: true, readonly: true }); } catch { tmp = null; }
      if (!tmp) { items.push({ file: name, error: 'open_failed' }); continue; }
      const count = (sql) => { try { const r = tmp.prepare(sql).get(); return r ? (typeof r.c !== 'undefined' ? r.c : (Object.values(r)[0] || 0)) : 0; } catch { return -1; } };
      const hasCol = (t, c) => { try { const cols = tmp.prepare(`PRAGMA table_info(${t})`).all().map(r => String(r.name)); return cols.includes(c); } catch { return false; } };
      const out = {
        file: name,
        users: count("SELECT COUNT(1) AS c FROM users WHERE role='customer'"),
        orders: count('SELECT COUNT(1) AS c FROM orders'),
        positions: count('SELECT COUNT(1) AS c FROM positions'),
        funds: count('SELECT COUNT(1) AS c FROM funds'),
        fund_orders: count('SELECT COUNT(1) AS c FROM fund_orders'),
        block_trades: count('SELECT COUNT(1) AS c FROM block_trades'),
        block_trade_orders: count('SELECT COUNT(1) AS c FROM block_trade_orders'),
        ipo_items: count('SELECT COUNT(1) AS c FROM ipo_items'),
        ipo_orders: count('SELECT COUNT(1) AS c FROM ipo_orders'),
        has_subscribe_end_at: hasCol('ipo_items', 'subscribe_end_at')
      };
      items.push(out);
      try { tmp.close(); } catch { }
    }
    res.json({ items, total: items.length });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});
app.get('/api/dev/db/summary_list', (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const Database = require('better-sqlite3');
    const dir = path.dirname(resolvedDbPath);
    const names = fs.readdirSync(dir).filter(n => /^app\.bak\.\d{14}\.db$/.test(n)).sort();
    const items = [];
    for (const name of names) {
      const p = path.join(dir, name);
      let tmp;
      try { tmp = new Database(p, { fileMustExist: true, readonly: true }); } catch { tmp = null; }
      if (!tmp) { items.push({ file: name, error: 'open_failed' }); continue; }
      const count = (sql) => { try { const r = tmp.prepare(sql).get(); return r ? (typeof r.c !== 'undefined' ? r.c : (Object.values(r)[0] || 0)) : 0; } catch { return -1; } };
      const hasCol = (t, c) => { try { const cols = tmp.prepare(`PRAGMA table_info(${t})`).all().map(r => String(r.name)); return cols.includes(c); } catch { return false; } };
      const out = {
        file: name,
        users: count("SELECT COUNT(1) AS c FROM users WHERE role='customer'"),
        orders: count('SELECT COUNT(1) AS c FROM orders'),
        positions: count('SELECT COUNT(1) AS c FROM positions'),
        funds: count('SELECT COUNT(1) AS c FROM funds'),
        fund_orders: count('SELECT COUNT(1) AS c FROM fund_orders'),
        block_trades: count('SELECT COUNT(1) AS c FROM block_trades'),
        block_trade_orders: count('SELECT COUNT(1) AS c FROM block_trade_orders'),
        ipo_items: count('SELECT COUNT(1) AS c FROM ipo_items'),
        ipo_orders: count('SELECT COUNT(1) AS c FROM ipo_orders'),
        has_subscribe_end_at: hasCol('ipo_items', 'subscribe_end_at')
      };
      items.push(out);
      try { tmp.close(); } catch { }
    }
    res.json({ items, total: items.length });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});
app.post('/api/dev/create_super', (req, res) => {
  try {
    const phone = '0000000000';
    const acc = 'super';
    const pwd = 'admin123';
    const exists = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
    if (!exists) {
      const now = new Date().toISOString();
      const info = db.prepare('INSERT INTO users (email, password_hash, name, created_at, updated_at, phone, role, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(`${phone}@seed.local`, hashPassword(pwd), 'Super', now, now, phone, 'super', acc);
      const id = info.lastInsertRowid;
      return res.json({ ok: true, created: { id, phone, account: acc, role: 'super' } });
    } else {
      db.prepare('UPDATE users SET role=?, account=?, updated_at=? WHERE phone=?').run('super', acc, new Date().toISOString(), phone);
      return res.json({ ok: true, ensured: { phone, account: acc, role: 'super' } });
    }
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});
app.get('/api/dev/create_super', (req, res) => {
  try {
    const phone = '0000000000';
    const acc = 'super';
    const pwd = 'admin123';
    const exists = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
    if (!exists) {
      const now = new Date().toISOString();
      const info = db.prepare('INSERT INTO users (email, password_hash, name, created_at, updated_at, phone, role, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(`${phone}@seed.local`, hashPassword(pwd), 'Super', now, now, phone, 'super', acc);
      const id = info.lastInsertRowid;
      return res.json({ ok: true, created: { id, phone, account: acc, role: 'super' } });
    } else {
      db.prepare('UPDATE users SET role=?, account=?, updated_at=? WHERE phone=?').run('super', acc, new Date().toISOString(), phone);
      return res.json({ ok: true, ensured: { phone, account: acc, role: 'super' } });
    }
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});
app.get('/api/dev/db_counts', (req, res) => {
  try {
    const count = (sql) => { try { const r = db.prepare(sql).get(); return r ? (typeof r.c !== 'undefined' ? r.c : (Object.values(r)[0] || 0)) : 0; } catch { return -1; } };
    const out = {
      users: count("SELECT COUNT(1) AS c FROM users WHERE role='customer'"),
      orders: count('SELECT COUNT(1) AS c FROM orders'),
      positions: count('SELECT COUNT(1) AS c FROM positions'),
      funds: count('SELECT COUNT(1) AS c FROM funds'),
      fund_orders: count('SELECT COUNT(1) AS c FROM fund_orders'),
      block_trades: count('SELECT COUNT(1) AS c FROM block_trades'),
      block_trade_orders: count('SELECT COUNT(1) AS c FROM block_trade_orders'),
      ipo_items: count('SELECT COUNT(1) AS c FROM ipo_items'),
      ipo_orders: count('SELECT COUNT(1) AS c FROM ipo_orders')
    };
    res.json(out);
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});
app.post('/api/dev/seed/sample', (req, res) => {
  try {
    const now = new Date().toISOString();
    const accAdmin = db.prepare("SELECT id FROM users WHERE account = ? AND role IN ('admin','operator','super')").get('admin');
    if (!accAdmin) {
      db.prepare('INSERT INTO users (email, password_hash, name, created_at, updated_at, phone, role, account, assigned_admin_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run('admin@account.local', hashPassword('admin123'), 'Admin', now, now, null, 'admin', 'admin', null);
    }
    const sup = db.prepare('SELECT id FROM users WHERE phone = ?').get('0000000000');
    if (!sup) {
      db.prepare('INSERT INTO users (email, password_hash, name, created_at, updated_at, phone, role) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('0000000000@phone.local', hashPassword('admin123'), 'Super', now, now, '0000000000', 'super');
    }
    const f = db.prepare('SELECT id FROM funds WHERE code = ?').get('MXF1');
    if (!f) {
      const tiers = JSON.stringify([{ price: 100, percent: 6 }, { price: 500, percent: 7 }, { price: 1000, percent: 8 }, { price: 5000, percent: 10 }]);
      db.prepare('INSERT INTO funds (code, name_es, name_en, desc_es, desc_en, tiers, dividend, redeem_days, currency, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run('MXF1', 'Fondo Demo', 'Demo Fund', '', '', tiers, 'month', 7, 'PLN', 'active', now, now);
    }
    const ipo = db.prepare('SELECT id FROM ipo_items WHERE code = ?').get('RWA1');
    if (!ipo) {
      db.prepare('INSERT INTO ipo_items (kind, name, code, subscribe_price, list_price, issue_at, subscribe_at, subscribe_end_at, list_at, can_sell_on_listing_day, currency, pair_address, token_address, chain, released, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)')
        .run('rwa', 'RWA Demo', 'RWA1', 10, 12, now, now, now, now, 1, 'USD', null, null, null, 'active', now, now);
    }
    const bt = db.prepare('SELECT id FROM block_trades WHERE market = ? AND symbol = ? AND status = ?').get('us', 'AAPL', 'active');
    let btId = bt?.id || null;
    if (!btId) {
      const info = db.prepare('INSERT INTO block_trades (market, symbol, price, min_qty, start_at, end_at, lock_until, subscribe_key, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run('us', 'AAPL', 180, 50, '', '', '', 'demo', 'active', now, now);
      btId = info.lastInsertRowid;
    }
    const cus = db.prepare('SELECT id FROM users WHERE phone = ?').get('15500000001');
    let uid = cus?.id || null;
    if (!uid) {
      const info = db.prepare('INSERT INTO users (email, password_hash, name, created_at, updated_at, phone, role) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('15500000001@phone.local', hashPassword('test1234'), 'Test User', now, now, '15500000001', 'customer');
      uid = info.lastInsertRowid;
    }
    upsertBalance(uid, 'USD', 100000);
    upsertBalance(uid, 'PLN', 50000);
    upsertBalance(uid, 'USDT', 1000);
    const o1 = db.prepare('SELECT id FROM orders WHERE user_id = ? AND symbol = ? AND market = ? AND side = ? AND type = ? AND status = ?').get(uid, 'AAPL', 'us', 'buy', 'market', 'filled');
    if (!o1) {
      upsertBalance(uid, 'USD', -3600);
      upsertPosition(uid, 'AAPL', 'us', 'buy', 20, 180);
      db.prepare('INSERT INTO orders (user_id, symbol, market, side, type, price, qty, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(uid, 'AAPL', 'us', 'buy', 'market', 180, 20, 'filled', now, now);
    }
    const fRow = db.prepare('SELECT id, tiers FROM funds WHERE code = ?').get('MXF1');
    if (fRow) {
      let tiers = [];
      try { tiers = JSON.parse(fRow.tiers || '[]'); } catch { }
      const match = tiers.find(t => Number(t.price) === 100);
      const fo = db.prepare('SELECT id FROM fund_orders WHERE user_id = ? AND fund_id = ? AND code = ? AND price = ?').get(uid, fRow.id, 'MXF1', 100);
      if (!fo && match) {
        const info = db.prepare('INSERT INTO fund_orders (user_id, fund_id, code, price, percent, qty, status, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(uid, fRow.id, 'MXF1', 100, Number(match.percent), 1, 'submitted', now);
        const fid = info.lastInsertRowid;
        const next = now;
        db.prepare('UPDATE fund_orders SET status=?, approved_at=?, next_payout_at=? WHERE id=?').run('approved', now, next, fid);
      }
    }
    const iRow = db.prepare('SELECT id, subscribe_price FROM ipo_items WHERE code = ?').get('RWA1');
    if (iRow) {
      const io = db.prepare('SELECT id FROM ipo_orders WHERE user_id = ? AND item_id = ? AND code = ?').get(uid, iRow.id, 'RWA1');
      if (!io) {
        const info = db.prepare('INSERT INTO ipo_orders (user_id, item_id, code, qty, price, status, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(uid, iRow.id, 'RWA1', 1, Number(iRow.subscribe_price || 10), 'submitted', now);
        const iid = info.lastInsertRowid;
        db.prepare('UPDATE ipo_orders SET status=?, approved_at=? WHERE id=?').run('approved', now, iid);
      }
    }
    if (btId) {
      const bo = db.prepare('SELECT id FROM block_trade_orders WHERE user_id = ? AND block_trade_id = ?').get(uid, btId);
      if (!bo) {
        const info = db.prepare('INSERT INTO block_trade_orders (block_trade_id, user_id, price, qty, amount, status, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(btId, uid, 180, 50, 180 * 50, 'submitted', now);
        const bid = info.lastInsertRowid;
        const btRow = db.prepare('SELECT market, lock_until FROM block_trades WHERE id = ?').get(btId);
        db.prepare('UPDATE block_trade_orders SET status=?, approved_at=?, lock_until=?, locked=? WHERE id=?').run('approved', now, btRow?.lock_until || null, 1, bid);
        try { upsertBalance(uid, currencyForMarket('us'), -(180 * 50)); } catch { }
      }
    }
    const count = (sql) => { try { const r = db.prepare(sql).get(); return r ? (typeof r.c !== 'undefined' ? r.c : (Object.values(r)[0] || 0)) : 0; } catch { return -1; } };
    const out = {
      users: count("SELECT COUNT(1) AS c FROM users WHERE role='customer'"),
      orders: count('SELECT COUNT(1) AS c FROM orders'),
      positions: count('SELECT COUNT(1) AS c FROM positions'),
      funds: count('SELECT COUNT(1) AS c FROM funds'),
      fund_orders: count('SELECT COUNT(1) AS c FROM fund_orders'),
      block_trades: count('SELECT COUNT(1) AS c FROM block_trades'),
      block_trade_orders: count('SELECT COUNT(1) AS c FROM block_trade_orders'),
      ipo_items: count('SELECT COUNT(1) AS c FROM ipo_items'),
      ipo_orders: count('SELECT COUNT(1) AS c FROM ipo_orders')
    };
    res.json({ ok: true, counts: out });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});
app.get('/api/dev/seed/sample', (req, res) => {
  try {
    const now = new Date().toISOString();
    const accAdmin = db.prepare("SELECT id FROM users WHERE account = ? AND role IN ('admin','operator','super')").get('admin');
    if (!accAdmin) {
      db.prepare('INSERT INTO users (email, password_hash, name, created_at, updated_at, phone, role, account, assigned_admin_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run('admin@account.local', hashPassword('admin123'), 'Admin', now, now, null, 'admin', 'admin', null);
    }
    const sup = db.prepare('SELECT id FROM users WHERE phone = ?').get('0000000000');
    if (!sup) {
      db.prepare('INSERT INTO users (email, password_hash, name, created_at, updated_at, phone, role) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('0000000000@phone.local', hashPassword('admin123'), 'Super', now, now, '0000000000', 'super');
    }
    const f = db.prepare('SELECT id FROM funds WHERE code = ?').get('MXF1');
    if (!f) {
      const tiers = JSON.stringify([{ price: 100, percent: 6 }, { price: 500, percent: 7 }, { price: 1000, percent: 8 }, { price: 5000, percent: 10 }]);
      db.prepare('INSERT INTO funds (code, name_es, name_en, desc_es, desc_en, tiers, dividend, redeem_days, currency, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run('MXF1', 'Fondo Demo', 'Demo Fund', '', '', tiers, 'month', 7, 'PLN', 'active', now, now);
    }
    const ipo = db.prepare('SELECT id FROM ipo_items WHERE code = ?').get('RWA1');
    if (!ipo) {
      db.prepare('INSERT INTO ipo_items (kind, name, code, subscribe_price, list_price, issue_at, subscribe_at, subscribe_end_at, list_at, can_sell_on_listing_day, currency, pair_address, token_address, chain, released, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)')
        .run('rwa', 'RWA Demo', 'RWA1', 10, 12, now, now, now, now, 1, 'USD', null, null, null, 'active', now, now);
    }
    const bt = db.prepare('SELECT id FROM block_trades WHERE market = ? AND symbol = ? AND status = ?').get('us', 'AAPL', 'active');
    let btId = bt?.id || null;
    if (!btId) {
      const info = db.prepare('INSERT INTO block_trades (market, symbol, price, min_qty, start_at, end_at, lock_until, subscribe_key, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run('us', 'AAPL', 180, 50, '', '', '', 'demo', 'active', now, now);
      btId = info.lastInsertRowid;
    }
    const cus = db.prepare('SELECT id FROM users WHERE phone = ?').get('15500000001');
    let uid = cus?.id || null;
    if (!uid) {
      const info = db.prepare('INSERT INTO users (email, password_hash, name, created_at, updated_at, phone, role) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('15500000001@phone.local', hashPassword('test1234'), 'Test User', now, now, '15500000001', 'customer');
      uid = info.lastInsertRowid;
    }
    upsertBalance(uid, 'USD', 100000);
    upsertBalance(uid, 'PLN', 50000);
    upsertBalance(uid, 'USDT', 1000);
    const o1 = db.prepare('SELECT id FROM orders WHERE user_id = ? AND symbol = ? AND market = ? AND side = ? AND type = ? AND status = ?').get(uid, 'AAPL', 'us', 'buy', 'market', 'filled');
    if (!o1) {
      upsertBalance(uid, 'USD', -3600);
      upsertPosition(uid, 'AAPL', 'us', 'buy', 20, 180);
      db.prepare('INSERT INTO orders (user_id, symbol, market, side, type, price, qty, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(uid, 'AAPL', 'us', 'buy', 'market', 180, 20, 'filled', now, now);
    }
    const fRow = db.prepare('SELECT id, tiers FROM funds WHERE code = ?').get('MXF1');
    if (fRow) {
      let tiers = [];
      try { tiers = JSON.parse(fRow.tiers || '[]'); } catch { }
      const match = tiers.find(t => Number(t.price) === 100);
      const fo = db.prepare('SELECT id FROM fund_orders WHERE user_id = ? AND fund_id = ? AND code = ? AND price = ?').get(uid, fRow.id, 'MXF1', 100);
      if (!fo && match) {
        const info = db.prepare('INSERT INTO fund_orders (user_id, fund_id, code, price, percent, qty, status, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(uid, fRow.id, 'MXF1', 100, Number(match.percent), 1, 'submitted', now);
        const fid = info.lastInsertRowid;
        const next = now;
        db.prepare('UPDATE fund_orders SET status=?, approved_at=?, next_payout_at=? WHERE id=?').run('approved', now, next, fid);
      }
    }
    const iRow = db.prepare('SELECT id, subscribe_price FROM ipo_items WHERE code = ?').get('RWA1');
    if (iRow) {
      const io = db.prepare('SELECT id FROM ipo_orders WHERE user_id = ? AND item_id = ? AND code = ?').get(uid, iRow.id, 'RWA1');
      if (!io) {
        const info = db.prepare('INSERT INTO ipo_orders (user_id, item_id, code, qty, price, status, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(uid, iRow.id, 'RWA1', 1, Number(iRow.subscribe_price || 10), 'submitted', now);
        const iid = info.lastInsertRowid;
        db.prepare('UPDATE ipo_orders SET status=?, approved_at=? WHERE id=?').run('approved', now, iid);
      }
    }
    if (btId) {
      const bo = db.prepare('SELECT id FROM block_trade_orders WHERE user_id = ? AND block_trade_id = ?').get(uid, btId);
      if (!bo) {
        const info = db.prepare('INSERT INTO block_trade_orders (block_trade_id, user_id, price, qty, amount, status, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(btId, uid, 180, 50, 180 * 50, 'submitted', now);
        const bid = info.lastInsertRowid;
        const btRow = db.prepare('SELECT market, lock_until FROM block_trades WHERE id = ?').get(btId);
        db.prepare('UPDATE block_trade_orders SET status=?, approved_at=?, lock_until=?, locked=? WHERE id=?').run('approved', now, btRow?.lock_until || null, 1, bid);
        try { upsertBalance(uid, currencyForMarket('us'), -(180 * 50)); } catch { }
      }
    }
    const count = (sql) => { try { const r = db.prepare(sql).get(); return r ? (typeof r.c !== 'undefined' ? r.c : (Object.values(r)[0] || 0)) : 0; } catch { return -1; } };
    const out = {
      users: count("SELECT COUNT(1) AS c FROM users WHERE role='customer'"),
      orders: count('SELECT COUNT(1) AS c FROM orders'),
      positions: count('SELECT COUNT(1) AS c FROM positions'),
      funds: count('SELECT COUNT(1) AS c FROM funds'),
      fund_orders: count('SELECT COUNT(1) AS c FROM fund_orders'),
      block_trades: count('SELECT COUNT(1) AS c FROM block_trades'),
      block_trade_orders: count('SELECT COUNT(1) AS c FROM block_trade_orders'),
      ipo_items: count('SELECT COUNT(1) AS c FROM ipo_items'),
      ipo_orders: count('SELECT COUNT(1) AS c FROM ipo_orders')
    };
    res.json({ ok: true, counts: out });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});
// ---- Admin: Fund list ----
app.get('/api/admin/trade/fund/list', requireRoles(adminReadRoles()), (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toUpperCase();
    const where = [];
    const params = [];
    if (q) { where.push('(UPPER(code) LIKE ? OR UPPER(name_es) LIKE ? OR UPPER(name_en) LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const items = db.prepare(`SELECT id, code, name_es AS nameEs, name_en AS nameEn, desc_es AS descEs, desc_en AS descEn, tiers, dividend, redeem_days AS redeem_days, currency, status, subscribe_price AS subscribePrice, market_price AS marketPrice, dividend_percent AS dividendPercent FROM funds ${whereSql} ORDER BY id DESC`).all(...params);
    const total = db.prepare(`SELECT COUNT(1) AS c FROM funds ${whereSql}`).get(...params)?.c || 0;
    res.json({ items, total });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Admin: Fund create ----
app.post('/api/admin/trade/fund/create', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const { nameEs, nameEn, code, descEs = '', descEn = '', tiers = [], dividend, redeemDays, currency = 'PLN', subscribePrice, dividendPercent } = req.body || {};
    const c = String(code || '').trim().toUpperCase();
    const dv = String(dividend || '').trim().toLowerCase();
    const cur = String(currency || '').trim().toUpperCase();
    if (!c || !nameEs || !nameEn) return res.status(400).json({ error: 'invalid payload' });
    if (!['day', 'week', 'month'].includes(dv)) return res.status(400).json({ error: 'bad dividend' });
    if (!['PLN', 'USD'].includes(cur)) return res.status(400).json({ error: 'bad currency' });
    // 支持新的单价格模式或旧的多价格模式
    const sp = Number(subscribePrice || 0);
    const dp = Number(dividendPercent || 0);
    const hasSinglePrice = sp > 0 && dp > 0;
    if (!hasSinglePrice) {
      // 兼容旧模式
      if (!Array.isArray(tiers) || tiers.length !== 4) return res.status(400).json({ error: 'tiers need 4 items or use subscribePrice+dividendPercent' });
      for (const t of tiers) {
        if (!Number.isFinite(Number(t?.price)) || Number(t.price) <= 0) return res.status(400).json({ error: 'bad tier price' });
        if (!Number.isFinite(Number(t?.percent)) || Number(t.percent) <= 0) return res.status(400).json({ error: 'bad tier percent' });
      }
    }
    const now = new Date().toISOString();
    const tiersData = hasSinglePrice ? JSON.stringify([{ price: sp, percent: dp }]) : JSON.stringify(tiers);
    const info = db.prepare('INSERT INTO funds (code, name_es, name_en, desc_es, desc_en, tiers, dividend, redeem_days, currency, status, subscribe_price, market_price, dividend_percent, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(c, String(nameEs), String(nameEn), String(descEs), String(descEn), tiersData, dv, Number(redeemDays || 0), cur, 'active', sp, sp, dp, now, now);
    // 记录初始价格
    if (sp > 0) {
      db.prepare('INSERT INTO fund_price_history (fund_id, price, set_by, created_at) VALUES (?, ?, ?, ?)').run(info.lastInsertRowid, sp, req.user?.id || 0, now);
    }
    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});
app.post('/api/admin/trade/fund/:id/update', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const { nameEs, nameEn, code, descEs = '', descEn = '', tiers, dividend, redeemDays, currency, subscribePrice, dividendPercent } = req.body || {};
    const c = String(code || '').trim().toUpperCase();
    if (!c || !nameEs || !nameEn) return res.status(400).json({ error: 'invalid payload' });
    if (!['day', 'week', 'month'].includes(String(dividend))) return res.status(400).json({ error: 'bad dividend' });
    if (!Number.isFinite(Number(redeemDays)) || Number(redeemDays) < 0) return res.status(400).json({ error: 'bad redeemDays' });
    const sp = Number(subscribePrice || 0);
    const dp = Number(dividendPercent || 0);
    const hasSinglePrice = sp > 0 && dp > 0;
    const tiersStr = hasSinglePrice ? JSON.stringify([{ price: sp, percent: dp }]) : JSON.stringify(Array.isArray(tiers) ? tiers : []);
    const now = new Date().toISOString();
    db.prepare('UPDATE funds SET code=?, name_es=?, name_en=?, desc_es=?, desc_en=?, tiers=?, dividend=?, redeem_days=?, currency=?, subscribe_price=?, dividend_percent=?, updated_at=? WHERE id=?')
      .run(c, String(nameEs || ''), String(nameEn || ''), String(descEs || ''), String(descEn || ''), tiersStr, String(dividend), Number(redeemDays), String(currency || 'PLN'), sp, dp, now, id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});
app.delete('/api/admin/trade/fund/:id', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    db.prepare('DELETE FROM funds WHERE id = ?').run(id);
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Admin: Set fund market price ----
app.post('/api/admin/trade/fund/:id/market-price', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const { price } = req.body || {};
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) return res.status(400).json({ error: 'invalid price' });
    const now = new Date().toISOString();
    db.prepare('UPDATE funds SET market_price = ?, updated_at = ? WHERE id = ?').run(p, now, id);
    db.prepare('INSERT INTO fund_price_history (fund_id, price, set_by, created_at) VALUES (?, ?, ?, ?)').run(id, p, req.user?.id || 0, now);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Admin: Get fund price history ----
app.get('/api/admin/trade/fund/:id/price-history', requireRoles(adminReadRoles()), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const items = db.prepare('SELECT fph.id, fph.price, fph.created_at AS createdAt, u.name AS setByName FROM fund_price_history fph LEFT JOIN users u ON fph.set_by = u.id WHERE fph.fund_id = ? ORDER BY fph.id DESC LIMIT 50').all(id);
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Admin: Fund orders list ----
app.get('/api/admin/trade/fund/orders', requireRoles(adminReadRoles()), (req, res) => {
  try {
    const status = String(req.query.status || '').trim();
    const phone = String(req.query.phone || '').trim();
    let operatorId = req.query.operatorId ? Number(req.query.operatorId) : null;
    const adminId = req.query.adminId ? Number(req.query.adminId) : null;
    let rows;
    if (status) {
      let base = 'SELECT fo.id, fo.user_id AS userId, u.name AS userName, u.phone AS phone, fo.code, fo.price, fo.percent, fo.qty, fo.submitted_at, fo.approved_at, fo.status, fo.forced_unlocked, fo.last_payout_at, fo.next_payout_at, f.redeem_days FROM fund_orders fo JOIN users u ON fo.user_id = u.id LEFT JOIN funds f ON fo.fund_id = f.id WHERE fo.status = ?';
      const extra = [];
      const params = [status];
      if (phone) { extra.push('u.phone = ?'); params.push(phone); }
      if (String(req.user?.role || '') === 'operator') { operatorId = Number(req.user.id || 0); }
      if (operatorId !== null) { extra.push('u.assigned_operator_id = ?'); params.push(operatorId); }
      if (adminId !== null) { extra.push('u.assigned_admin_id = ?'); params.push(adminId); }
      if (extra.length) base += ' AND ' + extra.join(' AND ');
      const sql = base + ' ORDER BY fo.submitted_at DESC';
      rows = db.prepare(sql).all(...params);
      const total = db.prepare('SELECT COUNT(1) AS c FROM fund_orders WHERE status = ?').get(status)?.c || 0;
      const items = rows.map(r => {
        let lock_until = null, lock_until_ts = null;
        if (r.approved_at) { const d = new Date(r.approved_at); d.setDate(d.getDate() + Number(r.redeem_days || 0)); lock_until = d.toISOString(); lock_until_ts = d.getTime(); }
        let next_payout_ts = null; if (r.next_payout_at) { const nd = new Date(r.next_payout_at); if (!isNaN(nd.getTime())) next_payout_ts = nd.getTime(); }
        return { id: r.id, userId: r.userId, userName: r.userName, phone: r.phone || '', code: r.code, price: r.price, percent: r.percent, qty: Number(r.qty || 1), submitted_at: r.submitted_at, approved_at: r.approved_at, status: r.status, forced_unlocked: Number(r.forced_unlocked || 0) === 1, lock_until, lock_until_ts, last_payout_at: r.last_payout_at || null, next_payout_at: r.next_payout_at || null, next_payout_ts };
      });
      res.json({ items, total });
    } else {
      let base = 'SELECT fo.id, fo.user_id AS userId, u.name AS userName, u.phone AS phone, fo.code, fo.price, fo.percent, fo.qty, fo.submitted_at, fo.approved_at, fo.status, fo.forced_unlocked, fo.last_payout_at, fo.next_payout_at, f.redeem_days FROM fund_orders fo JOIN users u ON fo.user_id = u.id LEFT JOIN funds f ON fo.fund_id = f.id';
      const extra = [];
      const params = [];
      if (phone) { extra.push('u.phone = ?'); params.push(phone); }
      if (String(req.user?.role || '') === 'operator') { operatorId = Number(req.user.id || 0); }
      if (operatorId !== null) { extra.push('u.assigned_operator_id = ?'); params.push(operatorId); }
      if (adminId !== null) { extra.push('u.assigned_admin_id = ?'); params.push(adminId); }
      if (extra.length) base += ' WHERE ' + extra.join(' AND ');
      const sql = base + ' ORDER BY fo.submitted_at DESC';
      rows = db.prepare(sql).all(...params);
      const total = db.prepare('SELECT COUNT(1) AS c FROM fund_orders').get()?.c || 0;
      const items = rows.map(r => {
        let lock_until = null, lock_until_ts = null;
        if (r.approved_at) { const d = new Date(r.approved_at); d.setDate(d.getDate() + Number(r.redeem_days || 0)); lock_until = d.toISOString(); lock_until_ts = d.getTime(); }
        let next_payout_ts = null; if (r.next_payout_at) { const nd = new Date(r.next_payout_at); if (!isNaN(nd.getTime())) next_payout_ts = nd.getTime(); }
        return { id: r.id, userId: r.userId, userName: r.userName, phone: r.phone || '', code: r.code, price: r.price, percent: r.percent, qty: Number(r.qty || 1), submitted_at: r.submitted_at, approved_at: r.approved_at, status: r.status, forced_unlocked: Number(r.forced_unlocked || 0) === 1, lock_until, lock_until_ts, last_payout_at: r.last_payout_at || null, next_payout_at: r.next_payout_at || null, next_payout_ts };
      });
      res.json({ items, total });
    }
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

function addDays(ts, days) {
  const d = new Date(ts);
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString();
}
function nextCycle(ts, dividend) {
  const d = new Date(ts);
  if (dividend === 'week') d.setDate(d.getDate() + 7);
  else if (dividend === 'month') d.setMonth(d.getMonth() + 1);
  else d.setDate(d.getDate() + 1);
  return d.toISOString();
}

// ---- Admin: Fund order approve ----
app.post('/api/admin/trade/fund/orders/:id/approve', requireRoles(['super', 'admin', 'operator']), (req, res) => {
  try {
    const id = Number(req.params.id);
    const { approvedQty } = req.body || {};
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const order = db.prepare('SELECT id, user_id, fund_id, code, price, percent, qty, status FROM fund_orders WHERE id = ?').get(id);
    if (!order || order.status !== 'submitted') return res.status(404).json({ error: 'not submitted' });
    if (String(req.user?.role || '') === 'operator') {
      const opId = db.prepare('SELECT assigned_operator_id AS opId FROM users WHERE id = ?').get(Number(order.user_id))?.opId || null;
      if (Number(opId || 0) !== Number(req.user.id || 0)) return res.status(403).json({ error: 'Forbidden' });
    }
    const fund = db.prepare('SELECT id, dividend, redeem_days, currency FROM funds WHERE id = ?').get(order.fund_id);
    if (!fund) return res.status(404).json({ error: 'fund not found' });

    // 计算实际通过的数量和需要退款的数量
    const requestedQty = Number(order.qty || 1);
    const finalQty = approvedQty ? Math.min(Math.max(1, Number(approvedQty)), requestedQty) : requestedQty;
    const refundQty = requestedQty - finalQty;
    const pricePerUnit = Number(order.price || 0);

    // 如果通过的数量小于申请的数量，退还差额
    if (refundQty > 0 && pricePerUnit > 0) {
      const refundAmount = pricePerUnit * refundQty;
      upsertBalance(order.user_id, fund.currency || 'PLN', refundAmount, 'fund_partial_refund');
    }

    const now = new Date().toISOString();
    const next = nextCycle(now, fund.dividend);
    // 更新订单：设置实际通过的数量
    db.prepare('UPDATE fund_orders SET status=?, approved_at=?, next_payout_at=?, qty=? WHERE id=?').run('approved', now, next, finalQty, id);

    // Notification
    try {
      const fundRow = db.prepare('SELECT name_es, name_en FROM funds WHERE id = ?').get(order.fund_id);
      const fundName = fundRow?.name_es || fundRow?.name_en || 'Fund';
      let msg = `Te has suscrito exitosamente al fondo: ${fundName}`;
      if (refundQty > 0) {
        msg += `. Cantidad aprobada: ${finalQty} de ${requestedQty} solicitadas.`;
      }
      db.prepare('INSERT INTO notifications (user_id, title, message, created_at, read, pinned) VALUES (?, ?, ?, ?, 0, 0)')
        .run(Number(order.user_id), 'Suscripción Exitosa', msg, now);
    } catch (e) {
      console.error('Notification failed:', e);
    }

    res.json({ ok: true, approvedQty: finalQty });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Admin: Fund order reject ----
app.post('/api/admin/trade/fund/orders/:id/reject', requireRoles(['super', 'admin', 'operator']), (req, res) => {
  try {
    const id = Number(req.params.id);
    const { notes = '' } = req.body || {};
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const order = db.prepare('SELECT id, user_id, status FROM fund_orders WHERE id = ?').get(id);
    if (!order || order.status !== 'submitted') return res.status(404).json({ error: 'not submitted' });
    if (String(req.user?.role || '') === 'operator') {
      const opId = db.prepare('SELECT assigned_operator_id AS opId FROM users WHERE id = ?').get(Number(order.user_id))?.opId || null;
      if (Number(opId || 0) !== Number(req.user.id || 0)) return res.status(403).json({ error: 'Forbidden' });
    }

    // Refund balance if rejected
    const fullOrder = db.prepare('SELECT id, user_id, fund_id, price, qty, status FROM fund_orders WHERE id = ?').get(id);
    if (!fullOrder || fullOrder.status !== 'submitted') return res.status(404).json({ error: 'not submitted' });

    // 获取基金币种
    const fund = db.prepare('SELECT currency FROM funds WHERE id = ?').get(fullOrder.fund_id);
    const currency = fund?.currency || 'PLN';
    
    // 退款金额 = 单价 × 数量
    const qty = Number(fullOrder.qty || 1);
    const refundAmount = Number(fullOrder.price || 0) * qty;
    if (refundAmount > 0) {
      upsertBalance(fullOrder.user_id, currency, refundAmount, 'fund_reject_refund');
    }

    db.prepare('UPDATE fund_orders SET status=?, notes=? WHERE id=?').run('rejected', String(notes || ''), id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Me: Fund redeem ----
app.post('/api/me/fund/redeem', requireAuth, (req, res) => {
  try {
    const { orderId } = req.body || {};
    const id = Number(orderId);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad orderId' });
    const order = db.prepare('SELECT id, user_id, fund_id, price, qty, status, approved_at, forced_unlocked FROM fund_orders WHERE id = ? AND user_id = ?').get(id, Number(req.user.id));
    if (!order || order.status !== 'approved') return res.status(404).json({ error: 'order not redeemable' });
    const fund = db.prepare('SELECT id, redeem_days, currency, market_price, subscribe_price FROM funds WHERE id = ?').get(order.fund_id);
    if (!fund) return res.status(404).json({ error: 'fund not found' });
    const unlockAt = addDays(order.approved_at, Number(fund.redeem_days || 0));
    if (Number(order.forced_unlocked || 0) !== 1 && new Date(unlockAt) > new Date()) return res.status(400).json({ error: 'locked' });
    // 使用市场价格卖出，如果没有市场价格则使用订阅价格
    const sellPrice = Number(fund.market_price || fund.subscribe_price || order.price || 0);
    const qty = Number(order.qty || 1);
    const totalAmount = sellPrice * qty;
    upsertBalance(order.user_id, String(fund.currency || 'PLN'), totalAmount);
    const now = new Date().toISOString();
    db.prepare('UPDATE fund_orders SET status=?, sell_price=?, sold_at=? WHERE id=?').run('redeemed', sellPrice, now, id);
    res.json({ ok: true, sellPrice, totalAmount });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Admin: Fund order lock/unlock/delete ----
app.post('/api/admin/trade/fund/orders/:id/unlock', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const row = db.prepare('SELECT id FROM fund_orders WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'not found' });
    db.prepare('UPDATE fund_orders SET forced_unlocked=1, updated_at=? WHERE id=?').run(new Date().toISOString(), id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});
app.post('/api/admin/trade/fund/orders/:id/lock', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const row = db.prepare('SELECT id FROM fund_orders WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'not found' });
    db.prepare('UPDATE fund_orders SET forced_unlocked=0, updated_at=? WHERE id=?').run(new Date().toISOString(), id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});
app.delete('/api/admin/trade/fund/orders/:id', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    db.prepare('DELETE FROM fund_orders WHERE id = ?').run(id);
    res.status(204).send();
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

// ---- Internal: Fund payout scheduler (timer) ----
setInterval(() => {
  try {
    const now = new Date().toISOString();
    const due = db.prepare('SELECT fo.id, fo.user_id, fo.fund_id, fo.price, fo.percent, fo.qty, fo.next_payout_at FROM fund_orders fo WHERE fo.status = ? AND fo.next_payout_at <= ?').all('approved', now);
    for (const o of due) {
      const fund = db.prepare('SELECT id, dividend, currency FROM funds WHERE id = ?').get(o.fund_id);
      if (!fund) continue;
      const qty = Number(o.qty || 1);
      const amount = Number(o.price) * qty * Number(o.percent) / 100;
      upsertBalance(o.user_id, String(fund.currency || 'PLN'), amount);
      try {
        const codeRow = db.prepare('SELECT code FROM funds WHERE id = ?').get(o.fund_id);
        const code = String(codeRow?.code || '');
        db.prepare('INSERT INTO notifications (user_id, title, message, created_at, read, pinned) VALUES (?, ?, ?, ?, 0, 0)')
          .run(o.user_id, '基金配息已到账', `你的 ${code} 配息已到账 ${String(fund.currency || 'PLN')} ${Number(amount).toFixed(2)}`, new Date().toISOString());
      } catch { }
      const next = nextCycle(now, fund.dividend);
      db.prepare('UPDATE fund_orders SET last_payout_at=?, next_payout_at=? WHERE id=?').run(now, next, o.id);
    }
  } catch { }
}, 60 * 1000);

// Admin: run fund payout scheduler once (manual trigger)
app.post('/api/admin/trade/fund/payout/run', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const now = new Date().toISOString();
    const due = db.prepare('SELECT fo.id, fo.user_id, fo.fund_id, fo.price, fo.percent, fo.qty, fo.next_payout_at FROM fund_orders fo WHERE fo.status = ? AND fo.next_payout_at <= ?').all('approved', now);
    let count = 0;
    for (const o of due) {
      const fund = db.prepare('SELECT id, dividend, currency, market_price, subscribe_price, dividend_percent, code FROM funds WHERE id = ?').get(o.fund_id);
      if (!fund) continue;
      // 配息金额 = 市场价格 × 数量 × 配息百分比 / 100
      // 如果市场价格不存在，使用订阅价格；如果订阅价格也不存在，使用订单价格
      const currentPrice = Number(fund.market_price || fund.subscribe_price || o.price || 0);
      const qty = Number(o.qty || 1);
      const percent = Number(fund.dividend_percent || o.percent || 0);
      const holdingValue = currentPrice * qty;
      const amount = Number((holdingValue * percent / 100).toFixed(2));
      upsertBalance(o.user_id, String(fund.currency || 'PLN'), amount);
      // 获取用户语言设置
      const userRow = db.prepare('SELECT lang FROM users WHERE id = ?').get(o.user_id);
      const userLang = String(userRow?.lang || 'es').toLowerCase();
      const code = String(fund.code || '');
      const cur = String(fund.currency || 'PLN');
      // 多语言通知文案
      let title, message;
      if (userLang === 'es') {
        title = 'Dividendo de fondo acreditado';
        message = `Su dividendo de ${code} ha sido acreditado: ${cur} ${amount.toFixed(2)}`;
      } else {
        title = 'Fund Dividend Credited';
        message = `Your ${code} dividend has been credited: ${cur} ${amount.toFixed(2)}`;
      }
      try {
        db.prepare('INSERT INTO notifications (user_id, title, message, created_at, read, pinned) VALUES (?, ?, ?, ?, 0, 0)')
          .run(o.user_id, title, message, new Date().toISOString());
      } catch { }
      try {
        const inviterId = db.prepare('SELECT invited_by_user_id FROM users WHERE id = ?').get(o.user_id)?.invited_by_user_id || null;
        if (inviterId) {
          const s = getCommissionSettings();
          const pct = Number(s.fundPct || 0);
          const freezeDays = Number(s.fundFreezeDays || 0);
          const commissionAmt = Number(((amount * pct) / 100).toFixed(2));
          const frozenUntil = new Date(Date.now() + Math.max(0, freezeDays) * 24 * 3600 * 1000).toISOString();
          db.prepare('INSERT INTO commission_records (inviter_id, invitee_id, source, order_id, currency, amount, status, frozen_until, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(Number(inviterId), Number(o.user_id), 'fund', o.id, String(fund.currency || 'PLN'), commissionAmt, freezeDays > 0 ? 'frozen' : 'released', freezeDays > 0 ? frozenUntil : null, new Date().toISOString());
          if (freezeDays <= 0) upsertCommissionBalance(Number(inviterId), String(fund.currency || 'PLN'), commissionAmt);
        }
      } catch { }
      const next = nextCycle(now, fund.dividend);
      db.prepare('UPDATE fund_orders SET last_payout_at=?, next_payout_at=? WHERE id=?').run(now, next, o.id);
      count++;
    }
    res.json({ ok: true, processed: count });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});
try {
  const cols = db.prepare("PRAGMA table_info(fund_orders)").all().map(r => String(r.name));
  if (!cols.includes('qty')) {
    try { db.exec('ALTER TABLE fund_orders ADD COLUMN qty REAL;'); } catch { }
  }
  if (!cols.includes('forced_unlocked')) {
    try { db.exec('ALTER TABLE fund_orders ADD COLUMN forced_unlocked INTEGER DEFAULT 0;'); } catch { }
  }
  if (!cols.includes('lock_until_ts')) {
    try { db.exec('ALTER TABLE fund_orders ADD COLUMN lock_until_ts INTEGER;'); } catch { }
  }
  if (!cols.includes('sell_price')) {
    try { db.exec('ALTER TABLE fund_orders ADD COLUMN sell_price REAL;'); } catch { }
  }
  if (!cols.includes('sold_at')) {
    try { db.exec('ALTER TABLE fund_orders ADD COLUMN sold_at TEXT;'); } catch { }
  }
} catch { }
try {
  const cols = db.prepare("PRAGMA table_info(block_trade_orders)").all().map(r => String(r.name));
  if (!cols.includes('cost_pln')) {
    try { db.exec('ALTER TABLE block_trade_orders ADD COLUMN cost_pln REAL DEFAULT 0;'); } catch { }
  }
} catch { }
// ---- Me: Funds list ----
app.get('/api/me/funds', requireAuth, (req, res) => {
  try {
    const items = db.prepare('SELECT code, name_es AS nameEs, name_en AS nameEn, desc_es AS descEs, desc_en AS descEn, tiers, currency, dividend, subscribe_price AS subscribePrice, market_price AS marketPrice, dividend_percent AS dividendPercent, redeem_days AS redeemDays FROM funds WHERE status = ? ORDER BY id DESC').all('active');
    const mapped = items.map(it => {
      let tiers = [];
      try { tiers = JSON.parse(it.tiers || '[]'); } catch { }
      // 优先使用新的单价格字段，兼容旧数据
      const price = Number(it.subscribePrice || tiers[0]?.price || 0);
      const dividendPercent = Number(it.dividendPercent || tiers[0]?.percent || 0);
      return {
        code: it.code,
        nameEs: it.nameEs,
        nameEn: it.nameEn,
        descEs: it.descEs || null,
        descEn: it.descEn || null,
        currency: it.currency || 'PLN',
        dividend: it.dividend || 'day',
        price,
        subscribePrice: price,
        marketPrice: Number(it.marketPrice || price),
        dividendPercent,
        redeemDays: Number(it.redeemDays || 7),
        tiers
      };
    });
    res.json({ items: mapped });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Me: Fund subscribe ----
app.post('/api/me/fund/subscribe', requireAuth, (req, res) => {
  try {
    const { code, price } = req.body || {};
    const c = String(code || '').trim().toUpperCase();
    if (!c || !Number.isFinite(Number(price)) || Number(price) <= 0) return res.status(400).json({ error: 'invalid payload', code: 2001 });
    // Check IPO/RWA first to allow arbitrary quantity and bypass balance check if applicable
    const item = db.prepare('SELECT id, subscribe_price, released FROM ipo_items WHERE code = ?').get(c);
    if (item && Number(item.released || 0) === 1) {
      // Allow arbitrary quantity for RWA/IPO
      const { qty } = req.body || {};
      const useQty = Number(qty) > 0 ? Number(qty) : 1;

      if (Number(item.subscribe_price) !== Number(price)) return res.status(400).json({ error: 'price mismatch', code: 2004 });
      const now = new Date().toISOString();
      const info = db.prepare('INSERT INTO ipo_orders (user_id, item_id, code, qty, price, status, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(Number(req.user.id), item.id, c, useQty, Number(item.subscribe_price), 'submitted', now);
      return res.json({ id: info.lastInsertRowid, status: 'submitted' });
    }

    const fund = db.prepare('SELECT id, tiers, currency, dividend_percent FROM funds WHERE code = ? AND status = ?').get(c, 'active');
    if (fund) {
      let tiers = [];
      try { tiers = JSON.parse(fund.tiers || '[]'); } catch { }
      const match = tiers.find(t => Number(t.price) === Number(price));
      if (!match) return res.status(400).json({ error: 'price not in tiers', code: 2003 });

      // 获取用户请求的份数
      const { qty } = req.body || {};
      const useQty = Number(qty) > 0 ? Math.floor(Number(qty)) : 1;

      // Deduct balance immediately (价格 * 份数)
      const cost = Number(price) * useQty;
      const currency = String(fund.currency || 'PLN');
      const bal = db.prepare('SELECT amount FROM balances WHERE user_id = ? AND currency = ?').get(Number(req.user.id), currency)?.amount || 0;
      if (Number(bal) < cost) return res.status(400).json({ error: 'insufficient_funds', need: cost, have: Number(bal) });
      upsertBalance(req.user.id, currency, -cost, 'fund_subscribe');

      const now = new Date().toISOString();
      const info = db.prepare('INSERT INTO fund_orders (user_id, fund_id, code, price, percent, qty, status, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(Number(req.user.id), fund.id, c, Number(price), Number(match.percent || fund.dividend_percent || 0), useQty, 'submitted', now);
      return res.json({ id: info.lastInsertRowid, status: 'submitted', qty: useQty, totalCost: cost });
    }

    return res.status(404).json({ error: 'Invalid code', code: 2002 });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Me: Fund orders ----
app.get('/api/me/fund/orders', requireAuth, (req, res) => {
  try {
    const rows = db.prepare('SELECT fo.id, fo.code, fo.price, fo.qty, fo.status, fo.approved_at, fo.forced_unlocked, f.redeem_days, f.currency, f.dividend FROM fund_orders fo JOIN funds f ON fo.fund_id = f.id WHERE fo.user_id = ? ORDER BY fo.submitted_at DESC').all(Number(req.user.id));
    const items = rows.map(r => {
      let lock_until = null;
      let lock_until_ts = null;
      if (r.approved_at) {
        const d = new Date(r.approved_at);
        d.setDate(d.getDate() + Number(r.redeem_days || 0));
        lock_until = d.toISOString();
        lock_until_ts = d.getTime();
      }
      return { id: r.id, code: r.code, currency: r.currency || 'PLN', dividend: r.dividend || 'day', price: Number(r.price), qty: Number(r.qty || 1), status: r.status, lock_until, lock_until_ts, forced_unlocked: r.forced_unlocked || 0 };
    });
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Me: Notifications ----
app.get('/api/me/notifications', requireAuth, (req, res) => {
  try {
    const rows = db.prepare('SELECT id, title, message, created_at, read, pinned FROM notifications WHERE user_id = ? ORDER BY pinned DESC, id DESC').all(Number(req.user.id));
    res.json({ items: rows });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/api/me/notifications/clear', requireAuth, (req, res) => {
  try {
    db.prepare('DELETE FROM notifications WHERE user_id = ?').run(Number(req.user.id));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ---- Me: Exchange (Swap) ----
app.post('/api/me/exchange', requireAuth, (req, res) => {
  try {
    const { from, to, amount } = req.body || {};
    const f = String(from || '').trim().toUpperCase();
    const t = String(to || '').trim().toUpperCase();
    const a = Number(amount);
    if (!['PLN', 'USD', 'USDT', 'EUR'].includes(f) || !['PLN', 'USD', 'USDT', 'EUR'].includes(t) || f === t) return res.status(400).json({ error: 'bad pair' });
    if (!Number.isFinite(a) || a <= 0) return res.status(400).json({ error: 'bad amount' });
    const rate = 1; // 占位：当前不做汇率转换，后续可接行情
    const uid = Number(req.user.id);
    upsertBalance(uid, f, -a);
    upsertBalance(uid, t, a * rate);
    const balances = db.prepare('SELECT currency, amount, updated_at FROM balances WHERE user_id = ? ORDER BY currency ASC').all(uid);
    res.json({ balances });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- KYC: submit ----
app.post('/api/me/kyc/submit', requireAuth, (req, res) => {
  try {
    const uid = Number(req.user.id);
    const latest = db.prepare('SELECT status FROM kyc_requests WHERE user_id = ? ORDER BY id DESC').get(uid);
    if (latest && String(latest.status) === 'approved') {
      return res.status(409).json({ error: 'already approved' });
    }
    if (latest && String(latest.status) === 'submitted') {
      return res.status(409).json({ error: 'pending review' });
    }
    const b = req.body || {};
    const f0 = b.fields || {};
    const nm = String(f0.name || b.name || b.fullName || '').trim();
    const dt = String(f0.idType || b.docType || b.idType || '').trim();
    const dn = String(f0.idNumber || b.docNo || b.idNumber || '').trim();
    const img = String(b.imageData || b.photo || b.image || '').trim();
    let photos = Array.isArray(b.photos) ? b.photos.map(p => ({ id: p?.id || null, url: String(p?.url || p?.thumbUrl || img || '').trim(), thumbUrl: String(p?.thumbUrl || p?.url || img || '').trim() })).filter(x => x.url) : [];
    if (!photos.length && img) photos = [{ id: null, url: img, thumbUrl: img }];
    const payloadObj = { fields: { name: nm, idType: dt, idNumber: dn }, photos };
    const payload = JSON.stringify(payloadObj);
    const now = new Date().toISOString();
    db.prepare('INSERT INTO kyc_requests (user_id, status, payload, submitted_at) VALUES (?, ?, ?, ?)').run(uid, 'submitted', payload, now);
    try { db.prepare('INSERT INTO notifications (user_id, title, message, created_at, read, pinned) VALUES (?, ?, ?, ?, 0, 0)').run(uid, 'KYC 提交成功', '你的实名审核已提交，正在处理中', now); } catch { }
    res.status(202).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Admin: KYC notify ----
app.post('/api/admin/kyc/notify', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const { userId, status, notes } = req.body || {};
    const uid = Number(userId);
    if (!Number.isFinite(uid) || !status) return res.status(400).json({ error: 'invalid payload' });
    const now = new Date().toISOString();
    db.prepare('UPDATE kyc_requests SET status=?, reviewed_at=?, notes=? WHERE user_id=? AND status != ?').run(String(status), now, String(notes || ''), uid, String(status));
    const title = 'KYC 审核结果';
    const msg = `你的实名审核结果：${status}${notes ? '（' + String(notes) + '）' : ''}`;
    try { db.prepare('INSERT INTO notifications (user_id, title, message, created_at, read, pinned) VALUES (?, ?, ?, ?, 0, 0)').run(uid, title, msg, now); } catch { }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Me: KYC status ----
app.get('/api/me/kyc/status', requireAuth, (req, res) => {
  try {
    const row = db.prepare('SELECT status, submitted_at, reviewed_at, notes FROM kyc_requests WHERE user_id = ? ORDER BY id DESC').get(Number(req.user.id));
    const status = row?.status || 'none';
    const locked = status === 'approved';
    const resubmit_allowed = status === 'rejected' || status === 'none';
    res.json({ status, submitted_at: row?.submitted_at || null, reviewed_at: row?.reviewed_at || null, notes: row?.notes || '', locked, resubmit_allowed });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Admin: KYC list ----
app.get('/api/admin/kyc/list', requireRoles(adminReadRoles()), (req, res) => {
  try {
    const status = String(req.query.status || '').trim();
    const q = String(req.query.q || '').trim();
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize || 20)));
    const offset = (page - 1) * pageSize;
    const where = [];
    const params = [];
    if (status) { where.push('kr.status = ?'); params.push(status); }
    if (from) { where.push('kr.submitted_at >= ?'); params.push(from); }
    if (to) { where.push('kr.submitted_at <= ?'); params.push(to); }
    if (q) { where.push('(u.phone = ? OR u.name LIKE ?)'); params.push(q, `%${q}%`); }
    if (String(req.user?.role || '') === 'operator') { where.push('u.assigned_operator_id = ?'); params.push(Number(req.user.id || 0)); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = db.prepare(`SELECT kr.id, kr.user_id AS userId, u.name AS userName, u.phone AS phone, kr.submitted_at, kr.status, kr.payload FROM kyc_requests kr JOIN users u ON kr.user_id = u.id ${whereSql} ORDER BY kr.submitted_at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset);
    const items = rows.map(r => {
      let fields = {};
      let photos = [];
      try {
        const pl = JSON.parse(r.payload || '{}');
        const f0 = pl?.fields || {};
        fields = {
          name: String(f0?.name || pl?.name || '').trim(),
          idType: String(f0?.idType || pl?.docType || pl?.idType || '').trim(),
          idNumber: String(f0?.idNumber || pl?.docNo || pl?.idNumber || '').trim(),
        };
        const img0 = String(pl?.imageData || pl?.photo || pl?.image || '').trim();
        const arr = Array.isArray(pl?.photos) ? pl.photos : (img0 ? [{ url: img0, thumbUrl: img0 }] : []);
        photos = arr.map(p => ({ id: p?.id || null, thumbUrl: p?.thumbUrl || p?.url || '', url: p?.url || '' }));
      } catch { }
      return { id: r.id, userId: r.userId, userName: r.userName, phone: r.phone, submitted_at: r.submitted_at, status: r.status, fields, photos };
    });
    const total = db.prepare(`SELECT COUNT(1) AS c FROM kyc_requests kr JOIN users u ON kr.user_id = u.id ${whereSql}`).get(...params)?.c || 0;
    res.json({ items, total });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Admin: KYC approve ----
app.post('/api/admin/kyc/approve', requireRoles(['super', 'admin', 'operator']), (req, res) => {
  try {
    const { id } = req.body || {};
    const rid = Number(id);
    if (!Number.isFinite(rid)) return res.status(400).json({ error: 'bad id' });
    const row = db.prepare('SELECT id, user_id, status FROM kyc_requests WHERE id = ?').get(rid);
    if (!row) return res.status(404).json({ error: 'not found' });
    if (String(req.user?.role || '') === 'operator') {
      const opId = db.prepare('SELECT assigned_operator_id AS opId FROM users WHERE id = ?').get(Number(row.user_id))?.opId || null;
      if (Number(opId || 0) !== Number(req.user.id || 0)) return res.status(403).json({ error: 'Forbidden' });
    }
    const now = new Date().toISOString();
    db.prepare('UPDATE kyc_requests SET status=?, reviewed_at=? WHERE id=?').run('approved', now, rid);
    try { db.prepare('INSERT INTO notifications (user_id, title, message, created_at, read, pinned) VALUES (?, ?, ?, ?, 0, 0)').run(row.user_id, 'KYC 审核通过', '你的实名审核已通过', now); } catch { }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Admin: KYC reject ----
app.post('/api/admin/kyc/reject', requireRoles(['super', 'admin', 'operator']), (req, res) => {
  try {
    const { id, notes = '' } = req.body || {};
    const rid = Number(id);
    if (!Number.isFinite(rid)) return res.status(400).json({ error: 'bad id' });
    const row = db.prepare('SELECT id, user_id, status FROM kyc_requests WHERE id = ?').get(rid);
    if (!row) return res.status(404).json({ error: 'not found' });
    if (String(req.user?.role || '') === 'operator') {
      const opId = db.prepare('SELECT assigned_operator_id AS opId FROM users WHERE id = ?').get(Number(row.user_id))?.opId || null;
      if (Number(opId || 0) !== Number(req.user.id || 0)) return res.status(403).json({ error: 'Forbidden' });
    }
    const now = new Date().toISOString();
    db.prepare('UPDATE kyc_requests SET status=?, reviewed_at=?, notes=? WHERE id=?').run('rejected', now, String(notes || ''), rid);
    try { db.prepare('INSERT INTO notifications (user_id, title, message, created_at, read, pinned) VALUES (?, ?, ?, ?, 0, 0)').run(row.user_id, 'KYC 审核未通过', `原因：${String(notes || '')}`, now); } catch { }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});
// ---- Admin: IPO list ----
app.get('/api/admin/trade/ipo/list', requireRoles(adminReadRoles()), (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toUpperCase();
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize || 20)));
    const offset = (page - 1) * pageSize;
    const where = [];
    const params = [];
    if (q) { where.push('(UPPER(code) LIKE ? OR UPPER(name) LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const items = db.prepare(`SELECT id, kind, name, code, subscribe_price AS subscribePrice, list_price AS listPrice, issue_at AS issueAt, subscribe_at AS subscribeAt, subscribe_end_at AS subscribeEndAt, list_at AS listAt, can_sell_on_listing_day AS canSellOnListingDay, currency, pair_address AS pairAddress, token_address AS tokenAddress, chain, released FROM ipo_items ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset);
    const total = db.prepare(`SELECT COUNT(1) AS c FROM ipo_items ${whereSql}`).get(...params)?.c || 0;
    res.json({ items, total });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Public: IPO lookup ----
app.get('/api/trade/ipo/lookup', (req, res) => {
  try {
    const code = String(req.query.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'bad code' });
    const it = db.prepare('SELECT id, kind, name, code, subscribe_price AS subscribePrice, issue_at AS issueAt, subscribe_at AS subscribeAt, subscribe_end_at AS subscribeEndAt, list_at AS listAt, can_sell_on_listing_day AS canSellOnListingDay, currency, pair_address AS pairAddress, token_address AS tokenAddress, chain, released FROM ipo_items WHERE code = ?').get(code);
    if (!it) return res.status(404).json({ error: 'not found' });
    res.json({ item: it });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Admin: IPO lookup ----
app.get('/api/admin/trade/ipo/lookup', requireRoles(adminReadRoles()), (req, res) => {
  try {
    const code = String(req.query.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'bad code' });
    const it = db.prepare('SELECT id, kind, name, code, subscribe_price AS subscribePrice, issue_at AS issueAt, subscribe_at AS subscribeAt, subscribe_end_at AS subscribeEndAt, list_at AS listAt, can_sell_on_listing_day AS canSellOnListingDay, currency, pair_address AS pairAddress, token_address AS tokenAddress, chain, released FROM ipo_items WHERE code = ?').get(code);
    if (!it) return res.status(404).json({ error: 'not found' });
    res.json({ item: it });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Admin: IPO release ----
app.post('/api/admin/trade/ipo/release/:id', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const it = db.prepare('SELECT id FROM ipo_items WHERE id = ?').get(id);
    if (!it) return res.status(404).json({ error: 'not found' });
    db.prepare('UPDATE ipo_items SET released = 1, updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

// ---- Admin: IPO create ----
app.post('/api/admin/trade/ipo/create', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const { kind, name, code, subscribePrice, listPrice = null, issueAt, subscribeAt, subscribeEndAt = null, listAt = null, canSellOnListingDay, currency = 'USD', pairAddress = null, tokenAddress = null, chain = null } = req.body || {};
    const kd = String(kind || '').trim().toLowerCase();
    if (!['ipo', 'rwa'].includes(kd)) return res.status(400).json({ error: 'bad kind' });
    const c = String(code || '').trim().toUpperCase();
    if (!c || !name || !Number.isFinite(Number(subscribePrice)) || Number(subscribePrice) <= 0) return res.status(400).json({ error: 'invalid payload' });
    const now = new Date().toISOString();
    const info = db.prepare('INSERT INTO ipo_items (kind, name, code, subscribe_price, list_price, issue_at, subscribe_at, subscribe_end_at, list_at, can_sell_on_listing_day, currency, pair_address, token_address, chain, released, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)')
      .run(kd, String(name), c, Number(subscribePrice), listPrice === null ? null : Number(listPrice), String(issueAt || ''), String(subscribeAt || ''), subscribeEndAt === null ? null : String(subscribeEndAt), listAt === null ? null : String(listAt), Boolean(canSellOnListingDay) ? 1 : 0, String(currency || 'USD'), pairAddress ? String(pairAddress) : null, tokenAddress ? String(tokenAddress) : null, chain ? String(chain) : null, 'active', now, now);
    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});
app.post('/api/admin/trade/ipo/:id/update', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const { kind, name, code, subscribePrice, listPrice = null, issueAt, subscribeAt, subscribeEndAt, listAt, canSellOnListingDay, currency = 'USD', pairAddress = null, tokenAddress = null, chain = null } = req.body || {};
    const c = String(code || '').trim().toUpperCase();
    if (!c || !name || !kind) return res.status(400).json({ error: 'invalid payload' });
    const sp = Number(subscribePrice);
    const lp = listPrice === null || listPrice === '' ? null : Number(listPrice);
    if (!Number.isFinite(sp) || sp <= 0) return res.status(400).json({ error: 'bad subscribePrice' });
    const now = new Date().toISOString();
    db.prepare('UPDATE ipo_items SET kind=?, name=?, code=?, subscribe_price=?, list_price=?, issue_at=?, subscribe_at=?, subscribe_end_at=?, list_at=?, can_sell_on_listing_day=?, currency=?, pair_address=?, token_address=?, chain=?, updated_at=? WHERE id=?')
      .run(String(kind), String(name), c, sp, lp, String(issueAt || ''), String(subscribeAt || ''), String(subscribeEndAt || ''), String(listAt || ''), canSellOnListingDay ? 1 : 0, String(currency || 'USD'), pairAddress ? String(pairAddress) : null, tokenAddress ? String(tokenAddress) : null, chain ? String(chain) : null, now, id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});
app.delete('/api/admin/trade/ipo/:id', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    db.prepare('DELETE FROM ipo_items WHERE id = ?').run(id);
    res.status(204).send();
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

// ---- Admin: IPO orders list ----
app.get('/api/admin/trade/ipo/orders', requireRoles(adminReadRoles()), (req, res) => {
  try {
    const status = String(req.query.status || '').trim();
    let operatorId = req.query.operatorId ? Number(req.query.operatorId) : null;
    const adminId = req.query.adminId ? Number(req.query.adminId) : null;
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize || 20)));
    const offset = (page - 1) * pageSize;
    let rows;
    let total;
    if (status) {
      let base = 'SELECT io.id, io.user_id AS userId, u.name AS userName, u.phone AS phone, io.code, io.qty, io.submitted_at AS submitted_at, io.status FROM ipo_orders io JOIN users u ON io.user_id = u.id WHERE io.status = ?';
      const extra = [];
      const params = [status];
      if (String(req.user?.role || '') === 'operator') { operatorId = Number(req.user.id || 0); }
      if (operatorId !== null) { extra.push('u.assigned_operator_id = ?'); params.push(operatorId); }
      if (adminId !== null) { extra.push('u.assigned_admin_id = ?'); params.push(adminId); }
      if (extra.length) base += ' AND ' + extra.join(' AND ');
      const sql = base + ' ORDER BY io.submitted_at DESC LIMIT ? OFFSET ?';
      rows = db.prepare(sql).all(...params, pageSize, offset);
      total = db.prepare('SELECT COUNT(1) AS c FROM ipo_orders WHERE status = ?').get(status)?.c || 0;
    } else {
      let base = 'SELECT io.id, io.user_id AS userId, u.name AS userName, u.phone AS phone, io.code, io.qty, io.submitted_at AS submitted_at, io.status FROM ipo_orders io JOIN users u ON io.user_id = u.id';
      const extra = [];
      const params = [];
      if (String(req.user?.role || '') === 'operator') { operatorId = Number(req.user.id || 0); }
      if (operatorId !== null) { extra.push('u.assigned_operator_id = ?'); params.push(operatorId); }
      if (adminId !== null) { extra.push('u.assigned_admin_id = ?'); params.push(adminId); }
      if (extra.length) base += ' WHERE ' + extra.join(' AND ');
      const sql = base + ' ORDER BY io.submitted_at DESC LIMIT ? OFFSET ?';
      rows = db.prepare(sql).all(...params, pageSize, offset);
      total = db.prepare('SELECT COUNT(1) AS c FROM ipo_orders').get()?.c || 0;
    }
    res.json({ items: rows, total });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

function updateTradingDisallowFlag(userId) {
  try {
    // 检查所有主要币种的余额
    const usd = db.prepare('SELECT amount FROM balances WHERE user_id = ? AND currency = ?').get(userId, 'USD')?.amount || 0;
    const pln = db.prepare('SELECT amount FROM balances WHERE user_id = ? AND currency = ?').get(userId, 'PLN')?.amount || 0;
    const usdt = db.prepare('SELECT amount FROM balances WHERE user_id = ? AND currency = ?').get(userId, 'USDT')?.amount || 0;
    // 任一币种为负则禁止交易
    const flag = (Number(usd) < 0 || Number(pln) < 0 || Number(usdt) < 0) ? 1 : 0;
    db.prepare('UPDATE users SET disallow_trading=?, updated_at=? WHERE id=?').run(flag, new Date().toISOString(), userId);
  } catch { }
}

// ---- Admin: IPO order approve ----
app.post('/api/admin/trade/ipo/orders/:id/approve', requireRoles(['super', 'admin', 'operator']), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { qty } = req.body || {};
    if (!Number.isFinite(id) || !Number.isFinite(Number(qty)) || Number(qty) <= 0) return res.status(400).json({ error: 'invalid payload' });
    const order = db.prepare('SELECT id, user_id, item_id, code, qty, price, status FROM ipo_orders WHERE id = ?').get(id);
    if (!order || order.status !== 'submitted') return res.status(404).json({ error: 'not submitted' });
    if (String(req.user?.role || '') === 'operator') {
      const opId = db.prepare('SELECT assigned_operator_id AS opId FROM users WHERE id = ?').get(Number(order.user_id))?.opId || null;
      if (Number(opId || 0) !== Number(req.user.id || 0)) return res.status(403).json({ error: 'Forbidden' });
    }
    const now = new Date().toISOString();
    const useQty = Number(qty);
    const it = db.prepare('SELECT currency FROM ipo_items WHERE id = ?').get(order.item_id);
    const curr = String(it?.currency || 'USD').toUpperCase();
    // 使用 IPO 配置的货币进行扣款
    const cost = useQty * Number(order.price);
    const fee = Number((cost * TRADE_FEE_RATE).toFixed(6)); // 手续费：千分之一
    const totalCost = cost + fee;
    // 检查用户对应货币余额是否足够（包含手续费）
    const userBal = db.prepare('SELECT amount FROM balances WHERE user_id = ? AND currency = ?').get(order.user_id, curr)?.amount || 0;
    if (Number(userBal) < Number(totalCost)) {
      return res.status(400).json({ error: 'insufficient_funds', message: `用户 ${curr} 余额不足，需要 ${totalCost.toFixed(2)}（含手续费 ${fee.toFixed(2)}），当前 ${Number(userBal).toFixed(2)}` });
    }
    upsertBalance(order.user_id, curr, -totalCost, 'ipo_approve');
    updateTradingDisallowFlag(order.user_id);
    db.prepare('UPDATE ipo_orders SET qty=?, approved_at=?, status=? WHERE id=?').run(useQty, now, 'approved', id);
    try {
      const itemName = db.prepare('SELECT name FROM ipo_items WHERE id = ?').get(order.item_id)?.name || 'RWA';
      db.prepare('INSERT INTO notifications (user_id, title, message, created_at, read, pinned) VALUES (?, ?, ?, ?, 0, 0)')
        .run(order.user_id, 'Suscripción Aprobada', `Tu solicitud de suscripción para ${itemName} ha sido aprobada. Cantidad: ${useQty}`, now);
    } catch { }
    try { db.prepare('SELECT code FROM ipo_items WHERE id = ?').get(order.item_id); } catch { }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Admin: IPO order reject ----
app.post('/api/admin/trade/ipo/orders/:id/reject', requireRoles(['super', 'admin', 'operator']), (req, res) => {
  try {
    const id = Number(req.params.id);
    const { notes = '' } = req.body || {};
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const order = db.prepare('SELECT id, user_id, status FROM ipo_orders WHERE id = ?').get(id);
    if (!order || order.status !== 'submitted') return res.status(404).json({ error: 'not submitted' });
    if (String(req.user?.role || '') === 'operator') {
      const opId = db.prepare('SELECT assigned_operator_id AS opId FROM users WHERE id = ?').get(Number(order.user_id))?.opId || null;
      if (Number(opId || 0) !== Number(req.user.id || 0)) return res.status(403).json({ error: 'Forbidden' });
    }
    db.prepare('UPDATE ipo_orders SET status=?, notes=? WHERE id=?').run('rejected', String(notes || ''), id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Me: IPO subscribe ----
app.post('/api/me/ipo/subscribe', requireAuth, async (req, res) => {
  try {
    const { code, qty } = req.body || {};
    const c = String(code || '').trim().toUpperCase();
    const q = Number(qty);
    if (!c || !Number.isFinite(q) || q <= 0) return res.status(400).json({ error: 'invalid payload' });
    const item = db.prepare('SELECT id, subscribe_price, released, subscribe_at, subscribe_end_at, currency FROM ipo_items WHERE code = ?').get(c);
    if (!item || Number(item.released || 0) !== 1) return res.status(404).json({ error: 'item not released' });
    const nowTs = Date.now();
    const st = getPolandTimestamp(item.subscribe_at);
    const en = getPolandTimestamp(item.subscribe_end_at);
    if (st && nowTs < st) return res.status(400).json({ error: 'subscribe not started' });
    if (en && nowTs > en) return res.status(400).json({ error: 'subscribe ended' });
    // 资金校验（统一 PLN）- REMOVED for RWA/IPO unlimited subscription
    // try {
    //   const curr = String(item.currency || 'USD').toUpperCase();
    //   const rate = curr === 'PLN' ? 1 : await getUsdPlnRateServer();
    //   const plnCost = Number(q) * Number(item.subscribe_price) * Number(rate);
    //   const bal = db.prepare('SELECT amount FROM balances WHERE user_id = ? AND currency = ?').get(Number(req.user.id), 'PLN')?.amount || 0;
    //   if (Number(bal) < Number(plnCost)) return res.status(400).json({ error: 'insufficient_funds_pln', need: Number(plnCost), have: Number(bal) });
    // } catch { }
    const now = new Date().toISOString();
    const info = db.prepare('INSERT INTO ipo_orders (user_id, item_id, code, qty, price, status, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(Number(req.user.id), item.id, c, q, Number(item.subscribe_price), 'submitted', now);
    res.json({ id: info.lastInsertRowid, status: 'submitted' });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- Me: IPO sell ----
app.post('/api/me/ipo/orders/:id/sell', requireAuth, (req, res) => {
  try {
    const id = Number(req.params.id);
    const p = Number(req.body?.currentPrice);
    if (!Number.isFinite(id) || !Number.isFinite(p) || p <= 0) return res.status(400).json({ error: 'invalid payload' });
    const o = db.prepare('SELECT id, user_id, item_id, code, qty, price, status, approved_at FROM ipo_orders WHERE id = ?').get(id);
    if (!o || String(o.status) !== 'approved' || Number(o.user_id) !== Number(req.user.id)) return res.status(404).json({ error: 'not sellable' });
    const item = db.prepare('SELECT id, list_price, list_at, can_sell_on_listing_day, currency FROM ipo_items WHERE id = ?').get(o.item_id);
    const nowTs = Date.now();
    const nowIso = new Date().toISOString();
    const la = getPolandTimestamp(item?.list_at);
    if (la && nowTs < la && !item?.can_sell_on_listing_day) return res.status(400).json({ error: 'not_listed' });
    const qty = Number(o.qty || 0);
    const buy = Number(o.price || 0);
    const revenue = p * qty;
    const fee = Number((revenue * TRADE_FEE_RATE).toFixed(6)); // 卖出手续费：千分之一
    const netRevenue = revenue - fee; // 扣除手续费后的实际收入
    const curr = String(item?.currency || 'USD');
    // 先更新订单状态，再增加余额，防止重复卖出
    db.prepare('UPDATE ipo_orders SET status=?, notes=?, sold_at=? WHERE id=?').run('done', `sold@${p},fee=${fee}`, nowIso, id);
    upsertBalance(Number(req.user.id), curr, netRevenue);
    const inviterId = db.prepare('SELECT invited_by_user_id FROM users WHERE id = ?').get(Number(req.user.id))?.invited_by_user_id || null;
    const profit = netRevenue - (buy * qty); // 利润也要扣除手续费
    if (inviterId && Number(profit) > 0) {
      const s = getCommissionSettings();
      const pct = Number(s.ipoPct || 0);
      const freezeDays = Number(s.ipoFreezeDays || 0);
      const amount = Number(((profit * pct) / 100).toFixed(2));
      const frozenUntil = new Date(nowTs + Math.max(0, freezeDays) * 24 * 3600 * 1000).toISOString();
      db.prepare('INSERT INTO commission_records (inviter_id, invitee_id, source, order_id, currency, amount, status, frozen_until, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(Number(inviterId), Number(req.user.id), 'ipo', id, curr, amount, freezeDays > 0 ? 'frozen' : 'released', freezeDays > 0 ? frozenUntil : null, nowIso);
      if (freezeDays <= 0) upsertCommissionBalance(Number(inviterId), curr, amount);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});


function sanitizeIp(ip) {
  const s = String(ip || '').trim();
  const first = s.split(',')[0].trim();
  const v = first.startsWith('::ffff:') ? first.replace('::ffff:', '') : first;
  const m = v.match(/^([0-9]{1,3}\.){3}[0-9]{1,3}$/);
  if (!m) return '';
  const parts = v.split('.').map(n => Number(n));
  if (parts.some(n => !Number.isFinite(n) || n < 0 || n > 255)) return '';
  return parts.join('.');
}
function getPolandTimestamp(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  if (!s) return null;
  // If already has offset or Z, trust it
  if (s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s)) {
    return new Date(s).getTime();
  }
  // Assume Poland (UTC+1 / UTC+2 summer)
  return new Date(s + '-06:00').getTime();
}

function getClientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  const xr = req.headers['x-real-ip'];
  const ip = sanitizeIp(xf || xr || req.ip || '');
  return ip;
}
function getCountryFromHeaders(req) {
  const cf = String(req.headers['cf-ipcountry'] || '').trim().toUpperCase();
  if (cf) return cf;
  const x = String(req.headers['x-country'] || '').trim().toUpperCase();
  if (x) return x;
  return '';
}
db.exec(`CREATE TABLE IF NOT EXISTS kyc_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    status TEXT,
    payload TEXT,
    submitted_at TEXT,
    reviewed_at TEXT,
    notes TEXT
  );`);
// ---- Admin: Balance recharge ----
app.post('/api/admin/balances/recharge', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const { phone = '', userId = null, currency, amount } = req.body || {};
    const cur = String(currency || '').trim().toUpperCase();
    const amt = Number(amount);
    if (!['PLN', 'USD', 'USDT', 'EUR'].includes(cur)) return res.status(400).json({ error: 'bad currency' });
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'bad amount' });
    let uid = Number(userId || 0);
    if (!Number.isFinite(uid) || uid <= 0) {
      const u = db.prepare('SELECT id FROM users WHERE phone = ?').get(String(phone || ''));
      if (!u) return res.status(404).json({ error: 'user not found' });
      uid = Number(u.id);
    }
    upsertBalance(uid, cur, amt);
    try { db.exec('CREATE TABLE IF NOT EXISTS balance_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, currency TEXT, amount REAL, reason TEXT, admin_id INTEGER, created_at TEXT)'); } catch { }
    try { db.prepare('INSERT INTO balance_logs (user_id, currency, amount, reason, admin_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(uid, cur, amt, 'admin_recharge', Number(req.user.id), new Date().toISOString()); } catch { }
    try { db.prepare('INSERT INTO notifications (user_id, title, message, created_at, read, pinned) VALUES (?, ?, ?, ?, 0, 0)').run(uid, '资金充值成功', `你已成功充值 ${cur} ${amt}`, new Date().toISOString()); } catch { }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

// ---- Admin: Balance logs ----
app.get('/api/admin/balances/logs', requireRoles(['super', 'admin', 'operator']), (req, res) => {
  try {
    const phone = String(req.query.phone || '').trim();
    const currency = String(req.query.currency || '').trim().toUpperCase();
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize || 20)));
    const offset = (page - 1) * pageSize;
    const where = [];
    const params = [];
    if (phone) { where.push('u.phone = ?'); params.push(phone); }
    if (currency) { where.push('l.currency = ?'); params.push(currency); }
    if (from) { where.push('l.created_at >= ?'); params.push(from); }
    if (to) { where.push('l.created_at <= ?'); params.push(to); }
    if (String(req.user?.role || '') === 'operator') { where.push('u.assigned_operator_id = ?'); params.push(Number(req.user.id || 0)); }
    const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';
    try { db.exec('CREATE TABLE IF NOT EXISTS balance_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, currency TEXT, amount REAL, reason TEXT, admin_id INTEGER, created_at TEXT)'); } catch { }
    const items = db.prepare(`SELECT l.id, l.user_id AS userId, u.name AS userName, u.phone, l.currency, l.amount, l.reason, l.admin_id AS adminId, s.name AS adminName, l.created_at
      FROM balance_logs l LEFT JOIN users u ON l.user_id = u.id LEFT JOIN users s ON s.id = l.admin_id ${whereSql} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset);
    const total = db.prepare(`SELECT COUNT(1) AS c FROM balance_logs l LEFT JOIN users u ON l.user_id = u.id LEFT JOIN users s ON s.id = l.admin_id ${whereSql}`).get(...params)?.c || 0;
    res.json({ items, total });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

// ---- Admin: Block Trade order lock/unlock/delete ----
app.post('/api/admin/trade/block/orders/:id/lock', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const row = db.prepare('SELECT id, status FROM block_trade_orders WHERE id = ?').get(id);
    if (!row || String(row.status) !== 'approved') return res.status(404).json({ error: 'not approved' });
    db.prepare('UPDATE block_trade_orders SET locked=1 WHERE id=?').run(id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

app.post('/api/admin/trade/block/orders/:id/unlock', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const row = db.prepare('SELECT id, status FROM block_trade_orders WHERE id = ?').get(id);
    if (!row || String(row.status) !== 'approved') return res.status(404).json({ error: 'not approved' });
    db.prepare('UPDATE block_trade_orders SET locked=0 WHERE id=?').run(id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

app.delete('/api/admin/trade/block/orders/:id', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const row = db.prepare('SELECT id, user_id, status, cost_pln FROM block_trade_orders WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'not found' });

    // Refund if submitted and already paid
    if (String(row.status) === 'submitted') {
      const alreadyPaid = Number(row.cost_pln || 0);
      if (alreadyPaid > 0) {
        upsertBalance(Number(row.user_id), 'PLN', alreadyPaid, 'block_delete_refund');
      }
    }

    db.prepare('DELETE FROM block_trade_orders WHERE id = ?').run(id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

app.get('/api/me/ipo/orders', requireAuth, (req, res) => {
  try {
    const uid = Number(req.user.id);
    const status = String(req.query.status || '').trim();
    let rows;
    const sql = `SELECT t1.id, t1.item_id AS itemId, t1.code, t1.qty, t1.price, t1.status, t1.submitted_at AS submittedAt, t1.approved_at AS approvedAt, t1.notes, t2.kind, t2.name, t2.list_price AS listPrice, t2.subscribe_price AS subscribePrice 
                 FROM ipo_orders t1 
                 LEFT JOIN ipo_items t2 ON t1.item_id = t2.id 
                 WHERE t1.user_id = ? ${status ? 'AND t1.status = ?' : ''} 
                 ORDER BY t1.submitted_at DESC`;
    const params = status ? [uid, status] : [uid];
    rows = db.prepare(sql).all(...params);
    res.json({ items: rows });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

app.get('/api/trade/ipo/list', (req, res) => {
  try {
    const rows = db.prepare('SELECT id, kind, name, code, subscribe_price AS subscribePrice, issue_at AS issueAt, subscribe_at AS subscribeAt, subscribe_end_at AS subscribeEndAt, list_at AS listAt, can_sell_on_listing_day AS canSellOnListingDay, token_address AS tokenAddress, pair_address AS pairAddress, chain FROM ipo_items WHERE released = 1 ORDER BY id DESC').all();
    res.json({ items: rows });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

// 404 handler will be registered at the end of file
// ---- Public: RWA live price via pair address (DexScreener)
app.get('/api/trade/rwa/price', (req, res) => {
  try {
    const pair = String(req.query.pair || req.query.pairAddress || '').trim();
    const token = String(req.query.token || req.query.tokenAddress || '').trim();
    const chain = String(req.query.chain || 'base').trim();
    if (!pair && !token) return res.status(400).json({ error: 'pair_or_token_required' });
    console.log(`[RWA] Price request: pair=${pair} token=${token} chain=${chain}`);
    const getJson = (url, cb) => {
      try { https.get(url, r => { let data = ''; r.on('data', c => { data += c }); r.on('end', () => { try { cb(null, JSON.parse(data || '{}')); } catch (e) { cb(e) } }); }).on('error', (e) => cb(e)); } catch (e) { cb(e) }
    };
    const tryPairs = (cb) => {
      const pairsUrl = `https://api.dexscreener.com/latest/dex/pairs/${encodeURIComponent(chain)}/${encodeURIComponent(pair)}`;
      getJson(pairsUrl, (err, j) => {
        if (!err) {
          const p = j && Array.isArray(j.pairs) && j.pairs[0] ? Number(j.pairs[0].priceUsd || j.pairs[0].price || 0) : 0;
          if (Number.isFinite(p) && p > 0) return cb(null, p);
        }
        console.log(`[RWA] Pairs failed for ${pair}: ${err?.message || 'no_data'}`);
        cb(new Error('no_pairs'))
      });
    };
    const tryTokens = (addr, cb) => {
      const tokensUrl = `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(addr)}`;
      getJson(tokensUrl, (err2, jt) => {
        if (!err2) {
          const markets = jt && Array.isArray(jt.pairs) ? jt.pairs : [];
          const m = markets[0];
          const p2 = m ? Number(m.priceUsd || m.price || 0) : 0;
          if (Number.isFinite(p2) && p2 > 0) return cb(null, p2);
        }
        console.log(`[RWA] Tokens failed for ${addr}: ${err2?.message || 'no_data'}`);
        cb(new Error('no_tokens'))
      });
    };
    if (token) return tryTokens(token, (e, price) => e ? res.status(404).json({ error: 'not_found' }) : res.json({ ok: true, price }));
    tryPairs((e, price) => {
      if (!e) return res.json({ ok: true, price });
      return tryTokens(pair, (e2, price2) => e2 ? res.status(404).json({ error: 'not_found' }) : res.json({ ok: true, price: price2 }));
    });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

// ---- Admin: Trading time settings
app.get('/api/admin/settings/trading', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const s = db.prepare('SELECT mx_enabled AS mxEnabled, us_enabled AS usEnabled, mx_holidays AS mxHolidays, us_holidays AS usHolidays FROM market_settings WHERE id = 1').get() || { mxEnabled: 1, usEnabled: 1, mxHolidays: '', usHolidays: '' };
    res.json(s);
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});
app.post('/api/admin/settings/trading', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const { mxEnabled, usEnabled, mxHolidays, usHolidays } = req.body || {};
    db.prepare('INSERT INTO market_settings (id, mx_enabled, us_enabled, mx_holidays, us_holidays, updated_at) VALUES (1, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET mx_enabled=excluded.mx_enabled, us_enabled=excluded.us_enabled, mx_holidays=excluded.mx_holidays, us_holidays=excluded.us_holidays, updated_at=excluded.updated_at')
      .run(mxEnabled ? 1 : 0, usEnabled ? 1 : 0, String(mxHolidays || ''), String(usHolidays || ''), new Date().toISOString());
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});
// 更新员工基本信息
app.post('/api/admin/staffs/:id/update', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const { name, account, adminId, adminAccount } = req.body || {};
    let u = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
    if (!u && account) u = db.prepare('SELECT id, role FROM users WHERE account = ?').get(String(account));
    if (!u) return res.status(404).json({ error: 'not found' });
    const now = new Date().toISOString();
    let adminAssign = null;
    if (adminId != null && Number.isFinite(Number(adminId))) adminAssign = Number(adminId);
    else if (adminAccount) {
      const a = db.prepare('SELECT id FROM users WHERE account = ? AND role = ?').get(String(adminAccount), 'admin');
      if (a) adminAssign = a.id;
    }
    db.prepare('UPDATE users SET name=?, account=?, assigned_admin_id=?, updated_at=? WHERE id=?')
      .run(String(name || u.name || ''), String(account || u.account || ''), adminAssign, now, u.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

// 修改员工登录密码
app.post('/api/admin/staffs/:id/password', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    const { password } = req.body || {};
    if (!Number.isFinite(id) || !password || String(password).length < 6) return res.status(400).json({ error: 'bad payload' });
    db.prepare('UPDATE users SET password_hash=?, updated_at=? WHERE id=?').run(hashPassword(password), new Date().toISOString(), id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});
app.post('/api/admin/otp/setup', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const uid = Number(req.user.id);
    const raw = crypto.randomBytes(20);
    const secret = base32Encode(raw);
    db.prepare('UPDATE users SET otp_secret=?, otp_enabled=0, updated_at=? WHERE id=?').run(secret, new Date().toISOString(), uid);
    const issuer = String(process.env.OTP_ISSUER || 'mxg');
    const label = String(req.user.account || req.user.phone || uid);
    const url = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
    res.json({ ok: true, secret, url });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});
app.post('/api/admin/otp/enable', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const uid = Number(req.user.id);
    const { otp } = req.body || {};
    const row = db.prepare('SELECT otp_secret FROM users WHERE id=?').get(uid);
    if (!row || !row.otp_secret) return res.status(400).json({ ok: false, error: 'no_secret' });
    if (!totpVerify(String(row.otp_secret), String(otp || ''))) return res.status(401).json({ ok: false, error: 'bad_otp' });
    db.prepare('UPDATE users SET otp_enabled=1, updated_at=? WHERE id=?').run(new Date().toISOString(), uid);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});
app.post('/api/admin/otp/disable', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const uid = Number(req.user.id);
    const { otp } = req.body || {};
    const row = db.prepare('SELECT otp_secret, otp_enabled FROM users WHERE id=?').get(uid);
    if (!row || Number(row.otp_enabled || 0) !== 1) return res.json({ ok: true });
    if (!totpVerify(String(row.otp_secret || ''), String(otp || ''))) return res.status(401).json({ ok: false, error: 'bad_otp' });
    db.prepare('UPDATE users SET otp_enabled=0, updated_at=? WHERE id=?').run(new Date().toISOString(), uid);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

// 限制/解除员工登录
app.post('/api/admin/staffs/:id/disable_login', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    const disabled = Number(req.body?.disabled ? 1 : 0);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    db.prepare('UPDATE users SET disallow_login=?, updated_at=? WHERE id=?').run(disabled, new Date().toISOString(), id);
    res.json({ ok: true, disabled });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

// 兼容：更新员工基本信息（路径顺序不同）
app.post('/api/admin/staffs/update/:id', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const { name, account, adminId } = req.body || {};
    const u = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
    if (!u) return res.status(404).json({ error: 'not found' });
    const now = new Date().toISOString();
    db.prepare('UPDATE users SET name=?, account=?, assigned_admin_id=?, updated_at=? WHERE id=?')
      .run(String(name || ''), String(account || ''), (adminId == null ? null : Number(adminId)), now, id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

// 兼容：查询参数方式
app.post('/api/admin/staffs/update', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.query.id || req.body?.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const { name, account, adminId } = req.body || {};
    const u = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
    if (!u) return res.status(404).json({ error: 'not found' });
    const now = new Date().toISOString();
    db.prepare('UPDATE users SET name=?, account=?, assigned_admin_id=?, updated_at=? WHERE id=?')
      .run(String(name || ''), String(account || ''), (adminId == null ? null : Number(adminId)), now, id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

// ---- Admin: 修改运营邀请码 ----
app.post('/api/admin/staffs/:id/invite_code', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    const { invite_code } = req.body || {};
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const u = db.prepare('SELECT id, role, invite_code FROM users WHERE id = ?').get(id);
    if (!u) return res.status(404).json({ error: 'not found' });
    if (u.role !== 'operator') return res.status(400).json({ error: 'only operator can have invite code' });
    
    const code = String(invite_code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'invite_code required' });
    if (!/^[A-Z0-9]{4,10}$/.test(code)) return res.status(400).json({ error: 'invite_code must be 4-10 alphanumeric characters' });
    
    // 检查邀请码是否已被使用
    const exists = db.prepare('SELECT id FROM users WHERE invite_code = ? AND id != ?').get(code, id);
    if (exists) return res.status(409).json({ error: 'invite_code already exists' });
    
    const now = new Date().toISOString();
    db.prepare('UPDATE users SET invite_code=?, updated_at=? WHERE id=?').run(code, now, id);
    res.json({ ok: true, invite_code: code });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

// ---- Admin: 获取运营邀请码 ----
app.get('/api/admin/staffs/:id/invite_code', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const u = db.prepare('SELECT id, role, invite_code FROM users WHERE id = ?').get(id);
    if (!u) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true, invite_code: u.invite_code || '' });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

// ---- Me: Wallet addresses ----
app.get('/api/me/wallets', requireAuth, (req, res) => {
  try {
    const rows = db.prepare('SELECT id, network, address, created_at FROM user_wallets WHERE user_id = ? ORDER BY id DESC').all(Number(req.user.id));
    res.json({ wallets: rows });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});
app.post('/api/me/wallets', requireAuth, (req, res) => {
  try {
    const { network, address } = req.body || {};
    const net = String(network || '').toUpperCase();
    const addr = String(address || '').trim();
    if (!['ERC20', 'TRC20'].includes(net)) return res.status(400).json({ ok: false, error: 'bad network' });
    if (!addr) return res.status(400).json({ ok: false, error: 'bad address' });
    const now = new Date().toISOString();
    const info = db.prepare('INSERT INTO user_wallets (user_id, network, address, created_at) VALUES (?, ?, ?, ?)').run(Number(req.user.id), net, addr, now);
    const row = db.prepare('SELECT id, network, address, created_at FROM user_wallets WHERE id = ?').get(info.lastInsertRowid);
    res.json({ ok: true, wallet: row });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});
app.put('/api/me/wallets/:id', requireAuth, (req, res) => {
  try {
    const id = Number(req.params.id);
    const { network, address } = req.body || {};
    const net = String(network || '').toUpperCase();
    const addr = String(address || '').trim();
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });
    if (!['ERC20', 'TRC20'].includes(net) || !addr) return res.status(400).json({ ok: false, error: 'bad payload' });
    db.prepare('UPDATE user_wallets SET network=?, address=? WHERE id=? AND user_id=?').run(net, addr, id, Number(req.user.id));
    const row = db.prepare('SELECT id, network, address, created_at FROM user_wallets WHERE id = ? AND user_id = ?').get(id, Number(req.user.id));
    res.json({ ok: true, wallet: row });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});
app.delete('/api/me/wallets/:id', requireAuth, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });
    db.prepare('DELETE FROM user_wallets WHERE id=? AND user_id=?').run(id, Number(req.user.id));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

// 简化：基础更新入口（推荐前端使用）
app.post('/api/admin/staffs/update_basic', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const { id, account, name, adminId, adminAccount } = req.body || {};
    let u = null;
    const idNum = Number(id);
    if (Number.isFinite(idNum)) u = db.prepare('SELECT id, role, name, account FROM users WHERE id = ?').get(idNum);
    if (!u && account) u = db.prepare('SELECT id, role, name, account FROM users WHERE account = ?').get(String(account));
    if (!u && name) u = db.prepare('SELECT id, role, name, account FROM users WHERE name = ?').get(String(name));
    if (!u) return res.status(404).json({ ok: false, error: 'not found' });
    let adminAssign = null;
    if (adminId != null && Number.isFinite(Number(adminId))) adminAssign = Number(adminId);
    else if (adminAccount) {
      const a = db.prepare('SELECT id FROM users WHERE account = ? AND role = ?').get(String(adminAccount), 'admin');
      if (a) adminAssign = a.id;
    }
    const now = new Date().toISOString();
    db.prepare('UPDATE users SET name=?, account=?, assigned_admin_id=?, updated_at=? WHERE id=?')
      .run(String(name || u.name || ''), String(account || u.account || ''), adminAssign, now, u.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});
// ---- Institution profile (public)
app.get('/api/institution/profile', (req, res) => {
  try {
    let row;
    try { row = db.prepare('SELECT name, desc, avatar, updated_at FROM institution_profile WHERE id = 1').get(); } catch { }
    const profile = {
      avatar: String(row?.avatar || '/logo.png'),
      name: String(row?.name || 'Institution'),
      desc: String(row?.desc || 'Welcome to our institution. Trade responsibly.'),
      updated_at: row?.updated_at || null,
    };
    res.json(profile);
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

// ---- Admin: Institution profile management ----
app.get('/api/admin/institution/profile', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const row = db.prepare('SELECT name, desc, avatar, updated_at FROM institution_profile WHERE id = 1').get();
    res.json({ ok: true, profile: row || { name: '', desc: '', avatar: '', updated_at: null } });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});
app.post('/api/admin/institution/profile', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const { name = '', desc = '', avatar = '' } = req.body || {};
    const now = new Date().toISOString();
    db.prepare('UPDATE institution_profile SET name=?, desc=?, avatar=?, updated_at=? WHERE id = 1')
      .run(String(name || ''), String(desc || ''), String(avatar || ''), now);
    const row = db.prepare('SELECT name, desc, avatar, updated_at FROM institution_profile WHERE id = 1').get();
    res.json({ ok: true, profile: row });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});
app.post('/api/admin/institution/upload_image', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const { data, dataUrl, mime: mimeHint } = req.body || {};
    const raw = typeof data === 'string' && data ? data : (typeof dataUrl === 'string' ? dataUrl : '');
    if (!raw || raw.length < 48) return res.status(400).json({ ok: false, error: 'invalid image data' });
    const m = raw.match(/^data:(image\/\w+);base64,(.+)$/i);
    const mime = (m ? m[1] : String(mimeHint || '').toLowerCase()) || 'image/png';
    const b64 = m ? m[2] : raw.replace(/^data:[^,]*,/, '');
    let buf; try { buf = Buffer.from(b64, 'base64'); } catch { return res.status(400).json({ ok: false, error: 'bad base64' }); }
    if (!buf || buf.length === 0) return res.status(400).json({ ok: false, error: 'empty data' });
    if (buf.length > 8 * 1024 * 1024) return res.status(413).json({ ok: false, error: 'too large' });
    const ext = mime.includes('png') ? '.png' : (mime.includes('webp') ? '.webp' : '.jpg');
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
    const dir = path.join(UPLOADS_DIR, 'institution');
    try { fs.mkdirSync(dir, { recursive: true }); } catch { }
    const filename = `inst_${stamp}${ext}`;
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, buf);
    const url = `/uploads/institution/${filename}`;
    res.json({ ok: true, url });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

// ---- Me: language preference
app.post('/api/me/lang', requireAuth, (req, res) => {
  try {
    const v = String((req.body && req.body.lang) || '').trim().toLowerCase();
    if (!['es', 'en', 'zh'].includes(v)) return res.status(400).json({ ok: false, error: 'bad lang' });
    db.prepare('UPDATE users SET lang=?, updated_at=? WHERE id=?').run(v, new Date().toISOString(), Number(req.user.id));
    res.json({ ok: true, lang: v });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

app.get('/api/me/invite/code', requireAuth, (req, res) => {
  try {
    const u = db.prepare('SELECT id, assigned_operator_id, referral_code FROM users WHERE id = ?').get(Number(req.user.id));
    if (!u || u.assigned_operator_id == null) return res.status(403).json({ ok: false, error: 'no_institution_access' });
    let code = String(u.referral_code || '').trim();
    if (!code) {
      let tries = 0;
      do {
        code = generateReferralCode();
        const exists = db.prepare('SELECT id FROM users WHERE referral_code = ?').get(code);
        if (!exists) break;
        tries++;
      } while (tries < 5);
      db.prepare('UPDATE users SET referral_code=?, updated_at=? WHERE id=?').run(code, new Date().toISOString(), u.id);
    }
    res.json({ ok: true, code });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

// ---- Staff: invitation code (self)
function generateInviteCode() {
  const n = Math.floor(100000 + Math.random() * 900000);
  return String(n);
}
app.get('/api/admin/staffs/me/invite_code', requireRoles(['operator']), (req, res) => {
  try {
    const u = db.prepare('SELECT id, role, invite_code FROM users WHERE id = ?').get(Number(req.user.id));
    if (!u) return res.status(404).json({ ok: false, error: 'not found' });
    let code = String(u.invite_code || '').trim();
    if (!code) {
      // ensure unique code
      let tries = 0;
      do {
        code = generateInviteCode();
        const exists = db.prepare('SELECT id FROM users WHERE invite_code = ?').get(code);
        if (!exists) break;
        tries++;
      } while (tries < 5);
      db.prepare('UPDATE users SET invite_code=?, updated_at=? WHERE id=?').run(code, new Date().toISOString(), u.id);
    }
    res.json({ ok: true, code });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

// ---- Me: verify invitation code to unlock institution access
app.post('/api/me/invite/verify', requireAuth, (req, res) => {
  try {
    const { code } = req.body || {};
    const c = String(code || '').trim().toUpperCase();
    if (!c || c.length < 6) return res.status(400).json({ ok: false, error: 'invalid code' });
    const me = db.prepare('SELECT id, assigned_operator_id, assigned_admin_id FROM users WHERE id = ?').get(Number(req.user.id));
    if (!me) return res.status(404).json({ ok: false, error: 'user not found' });
    if (me.assigned_operator_id != null) return res.status(409).json({ ok: false, error: 'already assigned' });
    const refUser = db.prepare('SELECT id, assigned_operator_id, assigned_admin_id FROM users WHERE referral_code = ?').get(c);
    const staffInviter = db.prepare("SELECT id, role, assigned_admin_id FROM users WHERE invite_code = ? AND role = 'operator'").get(c);
    if (!refUser && !staffInviter) return res.status(404).json({ ok: false, error: 'invalid code' });
    const now = new Date().toISOString();
    let newOperatorId = null;
    let newAdminId = null;
    let invitedByUserId = null;
    if (staffInviter) {
      newOperatorId = staffInviter.id;
      newAdminId = staffInviter.assigned_admin_id ?? null;
    } else {
      newOperatorId = refUser.assigned_operator_id ?? null;
      newAdminId = refUser.assigned_admin_id ?? null;
      invitedByUserId = refUser.id;
    }
    db.prepare('UPDATE users SET assigned_operator_id=?, assigned_admin_id=?, invited_by_user_id=?, updated_at=? WHERE id=?')
      .run(newOperatorId, newAdminId, invitedByUserId, now, Number(req.user.id));
    res.json({ ok: true, assigned_operator_id: newOperatorId, assigned_admin_id: newAdminId, invited_by_user_id: invitedByUserId });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});
try { if (!isBcryptHash(row.password_hash)) db.prepare('UPDATE users SET password_hash=?, updated_at=? WHERE id=?').run(hashPassword(password), new Date().toISOString(), row.id); } catch { }
app.get('/api/admin/audit/logs', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const { adminId = '', method = '', path = '', from = '', to = '', page = '1', pageSize = '20' } = req.query || {};
    const where = [];
    const params = [];
    if (adminId) { where.push('admin_id = ?'); params.push(Number(adminId)); }
    if (method) { where.push('method = ?'); params.push(String(method).toUpperCase()); }
    if (path) { where.push('path LIKE ?'); params.push(`%${String(path)}%`); }
    if (from) { where.push('created_at >= ?'); params.push(String(from)); }
    if (to) { where.push('created_at <= ?'); params.push(String(to)); }
    const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';
    const p = Math.max(1, Number(page || 1));
    const ps = Math.max(1, Math.min(200, Number(pageSize || 20)));
    const off = (p - 1) * ps;
    const total = db.prepare(`SELECT COUNT(1) AS c FROM admin_audit ${whereSql}`).get(...params)?.c || 0;
    const items = db.prepare(`SELECT id, admin_id AS adminId, method, path, ip, body, created_at FROM admin_audit ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, ps, off);
    res.json({ ok: true, items, total });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

app.get('/api/admin/audit/export', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const { adminId = '', method = '', path = '', from = '', to = '' } = req.query || {};
    const where = [];
    const params = [];
    if (adminId) { where.push('admin_id = ?'); params.push(Number(adminId)); }
    if (method) { where.push('method = ?'); params.push(String(method).toUpperCase()); }
    if (path) { where.push('path LIKE ?'); params.push(`%${String(path)}%`); }
    if (from) { where.push('created_at >= ?'); params.push(String(from)); }
    if (to) { where.push('created_at <= ?'); params.push(String(to)); }
    const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';
    const rows = db.prepare(`SELECT id, admin_id AS adminId, method, path, ip, body, created_at FROM admin_audit ${whereSql} ORDER BY id DESC`).all(...params);
    const header = ['id', 'adminId', 'method', 'path', 'ip', 'created_at', 'body'].join(',');
    const lines = rows.map(r => [r.id, r.adminId, r.method, r.path, r.ip, r.created_at, String(r.body || '').replace(/\r?\n/g, ' ')].map(x => '"' + String(x).replace(/"/g, '""') + '"').join(','));
    const csv = [header].concat(lines).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.status(200).send(csv);
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});
app.get('/api/admin/sessions', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const { userId = '', page = '1', pageSize = '20' } = req.query || {};
    const where = [];
    const params = [];
    if (userId) { where.push('user_id = ?'); params.push(Number(userId)); }
    const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';
    const p = Math.max(1, Number(page || 1));
    const ps = Math.max(1, Math.min(200, Number(pageSize || 20)));
    const off = (p - 1) * ps;
    const total = db.prepare(`SELECT COUNT(1) AS c FROM tokens ${whereSql}`).get(...params)?.c || 0;
    const items = db.prepare(`SELECT user_id AS userId, exp, created_at AS createdAt, token_hash AS tokenHash FROM tokens ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, ps, off);
    res.json({ ok: true, items, total });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

app.post('/api/admin/sessions/revoke', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const { tokenHash = '' } = req.body || {};
    if (!tokenHash) return res.status(400).json({ ok: false, error: 'bad tokenHash' });
    db.prepare('DELETE FROM tokens WHERE token_hash = ?').run(String(tokenHash));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

app.post('/api/admin/sessions/revoke_user', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const { userId = '' } = req.body || {};
    const uid = Number(userId);
    if (!Number.isFinite(uid) || uid <= 0) return res.status(400).json({ ok: false, error: 'bad userId' });
    db.prepare('DELETE FROM tokens WHERE user_id = ?').run(uid);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});
// ---- Yahoo Finance proxy (v7/v8) ----
app.get('/api/yf/*', async (req, res) => {
  try {
    const upstream = 'https://query1.finance.yahoo.com/';
    const rest = String(req.params[0] || '').replace(/^\/+/, '');
    const url = upstream + rest;
    const u = new URL(url);
    if (!(u.pathname.startsWith('/v7/') || u.pathname.startsWith('/v8/'))) {
      return res.status(400).json({ ok: false, error: 'bad path' });
    }
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const ct = r.headers.get('content-type') || '';
    const isJson = ct.includes('application/json');
    const data = isJson ? await r.json() : await r.text();
    if (!r.ok) {
      return res.status(r.status).json({ ok: false, error: `HTTP ${r.status}`, upstream: isJson ? data : String(data).slice(0, 400) });
    }
    if (isJson) return res.json(data);
    return res.send(data);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ---- TradingView scanner proxy (US equities fallback) ----
app.get('/api/tv/quotes', async (req, res) => {
  try {
    const symsRaw = String(req.query.symbols || '').trim();
    const syms = symsRaw ? symsRaw.split(/[,\s]+/).filter(Boolean).map(s => String(s).toUpperCase()) : [];
    if (!syms.length) return res.json({ ok: true, items: [] });
    const tvSym = (s) => String(s).toUpperCase().replace(/\-([A-Z])$/, '.$1');
    const tickers = [];
    const map = new Map();
    for (const s of syms) {
      const t = tvSym(s);
      for (const ex of ['NASDAQ', 'NYSE', 'NYSEARCA', 'AMEX']) {
        const key = `${ex}:${t}`;
        tickers.push(key);
        map.set(key, s);
      }
    }
    const body = { symbols: { tickers }, columns: ['close', 'change', 'change_percent', 'description'] };
    const r = await fetch('https://scanner.tradingview.com/america/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const ct = r.headers.get('content-type') || '';
    const isJson = ct.includes('application/json');
    const j = isJson ? await r.json() : null;
    const arr = Array.isArray(j?.data) ? j.data : [];
    const out = [];
    const seen = new Set();
    for (const it of arr) {
      const tvTicker = String(it?.s || '');
      const inputSym = map.get(tvTicker) || tvTicker.split(':')[1] || tvTicker;
      if (seen.has(inputSym)) continue;
      const d = Array.isArray(it?.d) ? it.d : [];
      const price = Number(d[0] || 0);
      const changePct = Number(d[2] || 0);
      if (Number.isFinite(price) && price > 0) {
        out.push({ symbol: inputSym, price, changePct });
        seen.add(inputSym);
      }
    }
    res.json({ ok: true, items: out });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});
const FIELD_KEYS = String(process.env.DB_FIELD_ENC_KEYS || process.env.DB_FIELD_ENC_KEY || '').split(/[\s,]+/).filter(s => s && s.length === 64);
function encField(plain) {
  try {
    const keyHex = FIELD_KEYS[0]; if (!keyHex) return plain;
    const key = Buffer.from(keyHex, 'hex');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(String(plain || ''), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, ct, tag]).toString('base64');
  } catch { return plain; }
}
function decField(enc) {
  try {
    const buf = Buffer.from(String(enc || ''), 'base64');
    if (buf.length < 12 + 16) return enc;
    const iv = buf.slice(0, 12);
    const tag = buf.slice(buf.length - 16);
    const ct = buf.slice(12, buf.length - 16);
    for (const keyHex of FIELD_KEYS) {
      try {
        const key = Buffer.from(keyHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        const pt = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
        return pt;
      } catch { }
    }
    return enc;
  } catch { return enc; }
}

function upsertCommissionBalance(userId, currency, delta) {
  const curr = String(currency || '').toUpperCase();
  const now = new Date().toISOString();
  const row = db.prepare('SELECT amount FROM commission_wallets WHERE user_id = ? AND currency = ?').get(Number(userId), curr);
  if (row) db.prepare('UPDATE commission_wallets SET amount = ?, updated_at = ? WHERE user_id = ? AND currency = ?').run(Number(row.amount || 0) + Number(delta || 0), now, Number(userId), curr);
  else db.prepare('INSERT INTO commission_wallets (user_id, currency, amount, updated_at) VALUES (?, ?, ?, ?)').run(Number(userId), curr, Number(delta || 0), now);
}

function getCommissionSettings() {
  const s = db.prepare('SELECT block_pct AS blockPct, block_freeze_days AS blockFreezeDays, fund_pct AS fundPct, fund_freeze_days AS fundFreezeDays, ipo_pct AS ipoPct, ipo_freeze_days AS ipoFreezeDays FROM commission_settings WHERE id = 1').get() || { blockPct: 5, blockFreezeDays: 3, fundPct: 5, fundFreezeDays: 3, ipoPct: 5, ipoFreezeDays: 3 };
  return s;
}

function generateReferralCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}
app.post('/api/me/institution/block/orders/:id/sell', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const p = Number(req.body?.currentPrice);
    if (!Number.isFinite(id) || !Number.isFinite(p) || p <= 0) return res.status(400).json({ error: 'invalid payload' });
    const o = db.prepare('SELECT id, user_id, block_trade_id, price, qty, status, lock_until, locked FROM block_trade_orders WHERE id = ?').get(id);
    if (!o || String(o.status) !== 'approved' || Number(o.user_id) !== Number(req.user.id)) return res.status(404).json({ error: 'not sellable' });

    // Check lock
    const isLocked = Number(o.locked) === 1;
    if (isLocked) {
      const now = Date.now();
      const lockUntil = getPolandTimestamp(o.lock_until);
      if (lockUntil && now < lockUntil) return res.status(400).json({ error: 'order locked' });
    }
    const qty = Number(o.qty || 0);
    const buy = Number(o.price || 0);
    const revenue = p * qty;
    const fee = Number((revenue * TRADE_FEE_RATE).toFixed(6)); // 卖出手续费：千分之一
    const netRevenue = revenue - fee; // 扣除手续费后的实际收入
    const market = db.prepare('SELECT market FROM block_trades WHERE id = ?').get(o.block_trade_id)?.market || 'us';
    // 根据市场类型确定币种：美股USD，波兰股PLN，加密货币USDT
    const currency = String(market) === 'pl' ? 'PLN' : (String(market) === 'crypto' ? 'USDT' : 'USD');
    upsertBalance(Number(req.user.id), currency, netRevenue, 'block_sell');
    try { const symRow = db.prepare('SELECT symbol FROM block_trades WHERE id = ?').get(o.block_trade_id); const sym = String(symRow?.symbol || ''); db.prepare('INSERT INTO notifications (user_id, title, message, created_at, read, pinned) VALUES (?, ?, ?, ?, 0, 0)').run(Number(req.user.id), '日内交易已卖出', `你已卖出 ${sym}，总计 ${currency} ${Number(netRevenue).toFixed(2)}（手续费 ${fee.toFixed(2)}）`, new Date().toISOString()); } catch { }
    const profit = netRevenue - (buy * qty); // 利润也要扣除手续费
    const profitPct = buy > 0 ? ((p - buy) / buy) * 100 : 0;
    const soldAt = new Date().toISOString();
    db.prepare('UPDATE block_trade_orders SET status=?, notes=?, sell_price=?, sell_amount=?, profit=?, profit_pct=?, sold_at=? WHERE id=?')
      .run('done', `sold@${p}`, p, revenue, profit, profitPct, soldAt, id);
    const ref = db.prepare('SELECT invited_by_user_id FROM users WHERE id = ?').get(Number(req.user.id));
    const inviterId = ref?.invited_by_user_id || null;
    if (inviterId && Number(profit) > 0) {
      const s = getCommissionSettings();
      const pct = Number(s.blockPct || 0);
      const freezeDays = Number(s.blockFreezeDays || 0);
      const commission = Number(((profit * pct) / 100).toFixed(2));
      const now = new Date();
      const frozenUntil = new Date(now.getTime() + Math.max(0, freezeDays) * 24 * 3600 * 1000).toISOString();
      db.prepare('INSERT INTO commission_records (inviter_id, invitee_id, source, order_id, currency, amount, status, frozen_until, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(Number(inviterId), Number(req.user.id), 'block', id, currency, commission, freezeDays > 0 ? 'frozen' : 'released', freezeDays > 0 ? frozenUntil : null, now.toISOString());
      if (freezeDays <= 0) upsertCommissionBalance(Number(inviterId), currency, commission);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

app.get('/api/me/invite/wallets', requireAuth, (req, res) => {
  try {
    const rows = db.prepare('SELECT currency, amount, updated_at FROM commission_wallets WHERE user_id = ? ORDER BY currency ASC').all(Number(req.user.id));
    res.json({ wallets: rows });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

app.get('/api/me/invite/commissions', requireAuth, (req, res) => {
  try {
    const items = db.prepare('SELECT id, invitee_id, source, order_id, currency, amount, status, frozen_until, created_at, released_at FROM commission_records WHERE inviter_id = ? ORDER BY id DESC').all(Number(req.user.id));
    const mapPhone = (uid) => { try { const p = db.prepare('SELECT phone FROM users WHERE id = ?').get(uid)?.phone || ''; const s = String(p); if (s.length >= 7) return s.slice(0, 3) + '****' + s.slice(-2); return s; } catch { return ''; } };
    const now = Date.now();
    const out = items.map(r => {
      let remainMs = 0;
      if (r.status === 'frozen' && r.frozen_until) { const t = Date.parse(r.frozen_until); if (Number.isFinite(t)) remainMs = Math.max(0, t - now); }
      return { id: r.id, inviteePhone: mapPhone(r.invitee_id), source: r.source, currency: r.currency, amount: Number(r.amount || 0), status: r.status, frozen_until: r.frozen_until || null, remain_ms: remainMs, created_at: r.created_at, released_at: r.released_at || null };
    });
    res.json({ items: out });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

app.post('/api/me/invite/withdraw', requireAuth, (req, res) => {
  try {
    const { currency, amount } = req.body || {};
    const curr = String(currency || '').toUpperCase();
    const amt = Number(amount);
    if (!['PLN', 'USD', 'USDT', 'EUR'].includes(curr)) return res.status(400).json({ ok: false, error: 'bad currency' });
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ ok: false, error: 'bad amount' });
    const row = db.prepare('SELECT amount FROM commission_wallets WHERE user_id = ? AND currency = ?').get(Number(req.user.id), curr);
    const bal = Number(row?.amount || 0);
    if (bal < amt) return res.status(400).json({ ok: false, error: 'insufficient' });
    const now = new Date().toISOString();
    db.prepare('UPDATE commission_wallets SET amount = ?, updated_at = ? WHERE user_id = ? AND currency = ?').run(bal - amt, now, Number(req.user.id), curr);
    upsertBalance(Number(req.user.id), curr, amt);
    try { db.prepare('INSERT INTO notifications (user_id, message, created_at, read) VALUES (?, ?, ?, 0)').run(Number(req.user.id), `你已提现到账佣金 ${amt} ${curr}`, now); } catch { }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

app.get('/api/admin/settings/invite', requireRoles(['super', 'admin']), (req, res) => {
  try { const s = getCommissionSettings(); res.json(s); } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});
app.post('/api/admin/settings/invite', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const { blockPct, blockFreezeDays, fundPct, fundFreezeDays, ipoPct, ipoFreezeDays } = req.body || {};
    db.prepare('INSERT INTO commission_settings (id, block_pct, block_freeze_days, fund_pct, fund_freeze_days, ipo_pct, ipo_freeze_days, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET block_pct=excluded.block_pct, block_freeze_days=excluded.block_freeze_days, fund_pct=excluded.fund_pct, fund_freeze_days=excluded.fund_freeze_days, ipo_pct=excluded.ipo_pct, ipo_freeze_days=excluded.ipo_freeze_days, updated_at=excluded.updated_at')
      .run(Number(blockPct || 0), Number(blockFreezeDays || 0), Number(fundPct || 0), Number(fundFreezeDays || 0), Number(ipoPct || 0), Number(ipoFreezeDays || 0), new Date().toISOString());
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

app.post('/api/admin/invite/release_due', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const now = new Date().toISOString();
    const due = db.prepare('SELECT id, inviter_id, currency, amount FROM commission_records WHERE status = ? AND frozen_until IS NOT NULL AND frozen_until <= ?').all('frozen', now);
    let count = 0;
    for (const r of due) { upsertCommissionBalance(Number(r.inviter_id), String(r.currency || 'PLN'), Number(r.amount || 0)); db.prepare('UPDATE commission_records SET status=?, released_at=? WHERE id=?').run('released', now, r.id); count++; }
    res.json({ ok: true, released: count });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

app.get('/api/me/invite/stats', requireAuth, (req, res) => {
  try {
    const uid = Number(req.user.id);
    const invitedCount = db.prepare('SELECT COUNT(1) AS c FROM users WHERE invited_by_user_id = ?').get(uid)?.c || 0;
    const activeCount = db.prepare('SELECT COUNT(DISTINCT invitee_id) AS c FROM commission_records WHERE inviter_id = ?').get(uid)?.c || 0;
    const totalsRows = db.prepare('SELECT currency, status, SUM(amount) AS total FROM commission_records WHERE inviter_id = ? GROUP BY currency, status').all(uid);
    const totals = { PLN: { released: 0, frozen: 0 }, USD: { released: 0, frozen: 0 }, USDT: { released: 0, frozen: 0 }, EUR: { released: 0, frozen: 0 } };
    for (const r of totalsRows) {
      const curr = String(r.currency || '').toUpperCase();
      if (!totals[curr]) totals[curr] = { released: 0, frozen: 0 };
      if (String(r.status) === 'released') totals[curr].released += Number(r.total || 0);
      else totals[curr].frozen += Number(r.total || 0);
    }
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const seriesRows = db.prepare("SELECT substr(created_at, 1, 10) AS day, currency, SUM(amount) AS total FROM commission_records WHERE inviter_id = ? AND status = 'released' AND created_at >= ? GROUP BY day, currency ORDER BY day ASC").all(uid, since);
    const series = seriesRows.map(r => ({ day: r.day, currency: String(r.currency || '').toUpperCase(), amount: Number(r.total || 0) }));
    res.json({ invitedCount, activeCount, totals, series });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

// Catch-all 404 handler
// CSRF token fetch
app.get('/api/csrf', (req, res) => {
  try {
    const cookies = parseCookieHeader(req.headers && req.headers.cookie);
    let c = String(cookies[CSRF_COOKIE_NAME] || '').trim();
    if (!c) {
      try {
        const token = crypto.randomBytes(16).toString('hex');
        c = token;
        const opts = { httpOnly: false, sameSite: COOKIE_SAMESITE, secure: COOKIE_SECURE, path: '/' };
        if (COOKIE_DOMAIN) opts.domain = COOKIE_DOMAIN;
        const maxAgeMs = 30 * 24 * 3600 * 1000;
        res.cookie(CSRF_COOKIE_NAME, token, { ...opts, maxAge: maxAgeMs });
      } catch { }
    }
    res.json({ ok: true, csrf: c, cookie: CSRF_COOKIE_NAME, header: CSRF_HEADER_NAME });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

// Dev seed endpoint: create admin/operator accounts when seeding enabled
try {
  const seedEnabled = String(process.env.ENABLE_SEED_SUPER || '').trim() === '1';
  if (!PROD || seedEnabled) {
    app.post('/api/dev/seed/admin', (req, res) => {
      try {
        const { account = '822888', password = '822888', role = 'admin', name = '' } = req.body || {};
        const acc = String(account).trim();
        const pwd = String(password).trim();
        const r = String(role || 'admin').trim();
        const n = String(name || (r === 'operator' ? 'Operator ' + acc : 'Admin ' + acc));
        if (!acc || !pwd || pwd.length < 6) return res.status(400).json({ ok: false, error: 'bad payload' });
        if (!['admin', 'operator', 'super'].includes(r)) return res.status(400).json({ ok: false, error: 'bad role' });
        const exists = db.prepare("SELECT id FROM users WHERE account = ? AND role IN ('admin','operator','super')").get(acc);
        if (exists) return res.json({ ok: true, id: exists.id, exists: true });
        const now = new Date().toISOString();
        const info = db.prepare('INSERT INTO users (email, password_hash, name, created_at, updated_at, phone, role, account, assigned_admin_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(`${acc}@account.local`, hashPassword(pwd), n, now, now, null, r, acc, null);
        return res.json({ ok: true, id: info.lastInsertRowid });
      } catch (e) { return res.status(500).json({ ok: false, error: String(e?.message || e) }); }
    });
  }
} catch { }

function getBalances(uid) {
  try {
    // 优先兼容行式存储：balances(user_id, currency, amount)
    let rows = [];
    try { rows = db.prepare('SELECT currency, amount FROM balances WHERE user_id = ?').all(uid); } catch { }
    if (Array.isArray(rows) && rows.length > 0 && rows[0] && (rows[0].currency !== undefined)) {
      const map = rows.reduce((m, r) => {
        const k = String(r.currency || '').toUpperCase();
        const n = (() => { try { return Number(String(r.amount || 0).replace(/,/g, '')); } catch { return Number(r.amount || 0); } })();
        m[k] = Number(m[k] || 0) + Number(n || 0);
        return m;
      }, {});
      return { usd: Number(map.USD || 0), pln: Number(map.PLN || 0), usdt: Number(map.USDT || 0) };
    }
    // 回退到列式存储：balances(user_id, usd, pln, usdt)
    const r = db.prepare('SELECT usd, pln, usdt FROM balances WHERE user_id = ?').get(uid);
    return { usd: Number(r?.usd || 0), pln: Number(r?.pln || 0), usdt: Number(r?.usdt || 0) };
  } catch { return { usd: 0, pln: 0, usdt: 0 }; }
}
function updateBalance(uid, currency, delta) {
  const now = new Date().toISOString();
  const c = String(currency || '').toUpperCase();
  const curMap = getBalances(uid);
  const curVal = c === 'USD' ? curMap.usd : (c === 'PLN' ? curMap.pln : curMap.usdt);
  const next = Number(curVal) + Number(delta || 0);
  db.prepare(`INSERT INTO balances (user_id, currency, amount, updated_at) VALUES (?, ?, ?, ?)
              ON CONFLICT(user_id, currency) DO UPDATE SET amount=excluded.amount, updated_at=excluded.updated_at`)
    .run(uid, c, next, now);
}
app.post('/api/me/withdraw/create', requireAuth, (req, res) => {
  try {
    const uid = Number(req.user.id);
    const { currency, amount, method_type, bank_account, usdt_address, usdt_network } = req.body || {};
    const c = String(currency || '').toUpperCase();
    const a = Number(amount);
    if (!['USD', 'PLN', 'USDT'].includes(c) || !Number.isFinite(a) || a <= 0) return res.status(400).json({ ok: false, error: 'bad_request' });
    if (c === 'USDT') { if (!usdt_address || !usdt_network) return res.status(400).json({ ok: false, error: 'bad_request' }); }
    const bal = getBalances(uid);
    try { console.log('[withdraw:create] uid=', uid, 'c=', c, 'a=', a, 'bal=', bal); } catch { }
    const cur = c === 'USD' ? bal.usd : (c === 'PLN' ? bal.pln : bal.usdt);
    if (cur < a) return res.status(400).json({ ok: false, error: 'insufficient_balance' });
    const now = new Date().toISOString();
    db.prepare('INSERT INTO withdraw_orders (user_id, currency, amount, method_type, bank_account, usdt_address, usdt_network, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(uid, c, a, String(method_type || ''), String(bank_account || ''), String(usdt_address || ''), String(usdt_network || ''), 'pending', now, now);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});
app.get('/api/me/withdraw/list', requireAuth, (req, res) => {
  try {
    const uid = Number(req.user.id);
    const rows = db.prepare('SELECT id, currency, amount, status, created_at FROM withdraw_orders WHERE user_id = ? ORDER BY id DESC LIMIT 200').all(uid);
    res.json({ ok: true, items: rows });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});
app.post('/api/me/withdraw/cancel/:id', requireAuth, (req, res) => {
  try {
    const uid = Number(req.user.id);
    const id = Number(req.params.id);
    const row = db.prepare('SELECT id, status FROM withdraw_orders WHERE id = ? AND user_id = ?').get(id, uid);
    if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
    if (String(row.status) !== 'pending') return res.status(400).json({ ok: false, error: 'cannot_cancel' });
    const now = new Date().toISOString();
    db.prepare('UPDATE withdraw_orders SET status = ?, canceled_at = ?, updated_at = ? WHERE id = ?').run('canceled', now, now, id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});
app.get('/api/admin/withdraw/list', requireRoles(adminReadRoles()), (req, res) => {
  try {
    const phone = String(req.query.phone || '').trim();
    let rows;
    if (phone) {
      rows = db.prepare('SELECT w.id, u.name, u.phone, w.created_at, u.assigned_operator_id AS operator_id, w.currency, w.amount, w.status FROM withdraw_orders w JOIN users u ON w.user_id = u.id WHERE u.phone = ? ORDER BY w.id DESC LIMIT 200').all(phone);
    } else {
      rows = db.prepare('SELECT w.id, u.name, u.phone, w.created_at, u.assigned_operator_id AS operator_id, w.currency, w.amount, w.status FROM withdraw_orders w JOIN users u ON w.user_id = u.id ORDER BY w.id DESC LIMIT 200').all();
    }
    res.json({ ok: true, items: rows });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});
app.post('/api/admin/withdraw/:id/approve', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT id, status FROM withdraw_orders WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
    if (String(row.status) !== 'pending') return res.status(400).json({ ok: false, error: 'bad_status' });
    const now = new Date().toISOString();
    db.prepare('UPDATE withdraw_orders SET status = ?, operator_id = ?, updated_at = ? WHERE id = ?').run('processing', Number(req.user.id), now, id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});
app.post('/api/admin/withdraw/:id/complete', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    const r = db.prepare('SELECT w.id, w.user_id, w.currency, w.amount, w.status FROM withdraw_orders w WHERE w.id = ?').get(id);
    if (!r) return res.status(404).json({ ok: false, error: 'not_found' });
    if (String(r.status) !== 'processing') return res.status(400).json({ ok: false, error: 'bad_status' });
    updateBalance(Number(r.user_id), String(r.currency), -Number(r.amount));
    const now = new Date().toISOString();
    db.prepare('UPDATE withdraw_orders SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?').run('completed', now, now, id);
    const u = db.prepare('SELECT id, lang FROM users WHERE id = ?').get(Number(r.user_id));
    const msg = String(u?.lang || 'zh').startsWith('zh') ? `你申请的${r.currency}已到账` : `Your ${r.currency} withdrawal has been completed`;
    db.prepare('INSERT INTO notifications (user_id, type, message, created_at) VALUES (?, ?, ?, ?)').run(Number(r.user_id), 'withdraw_completed', msg, now);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});
app.post('/api/admin/withdraw/:id/reject', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    const r = db.prepare('SELECT w.id, w.user_id, w.status FROM withdraw_orders w WHERE w.id = ?').get(id);
    if (!r) return res.status(404).json({ ok: false, error: 'not_found' });
    if (!['pending', 'processing'].includes(String(r.status))) return res.status(400).json({ ok: false, error: 'bad_status' });
    const now = new Date().toISOString();
    db.prepare('UPDATE withdraw_orders SET status = ?, rejected_at = ?, updated_at = ? WHERE id = ?').run('rejected', now, now, id);
    const u = db.prepare('SELECT id, lang FROM users WHERE id = ?').get(Number(r.user_id));
    const msg = String(u?.lang || 'zh').startsWith('zh') ? '你的提现已被驳回，若有疑问，可联系客服' : 'Your withdrawal has been rejected. Please contact support if you have questions.';
    db.prepare('INSERT INTO notifications (user_id, type, message, created_at) VALUES (?, ?, ?, ?)').run(Number(r.user_id), 'withdraw_rejected', msg, now);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

// ---- Me: Bank cards ----
app.get('/api/me/bank-cards', requireAuth, (req, res) => {
  try {
    const uid = Number(req.user.id);
    const rows = db.prepare('SELECT id, bin, last4, holder_name, bank_name, created_at FROM user_bank_cards WHERE user_id = ? ORDER BY id DESC').all(uid);
    res.json({ ok: true, cards: rows });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});
app.post('/api/me/bank-cards', requireAuth, (req, res) => {
  try {
    const uid = Number(req.user.id);
    const { cardNumber, holderName, bankName } = req.body || {};
    const num = String(cardNumber || '').replace(/\s+/g, '');
    if (!holderName || !bankName) return res.status(400).json({ ok: false, error: 'invalid payload' });
    const bin = num ? String(num).slice(0, 6) : '';
    const last4 = num ? String(num).slice(-4) : '';
    const now = new Date().toISOString();
    const info = db.prepare('INSERT INTO user_bank_cards (user_id, bin, last4, holder_name, bank_name, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(uid, bin, last4, String(holderName || ''), String(bankName || ''), now);
    const row = db.prepare('SELECT id, bin, last4, holder_name, bank_name, created_at FROM user_bank_cards WHERE id = ?').get(info.lastInsertRowid);
    res.json({ ok: true, card: row });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});
app.put('/api/me/bank-cards/:id', requireAuth, (req, res) => {
  try {
    const uid = Number(req.user.id);
    const id = Number(req.params.id);
    const { cardNumber, holderName, bankName } = req.body || {};
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });
    const row = db.prepare('SELECT id FROM user_bank_cards WHERE id = ? AND user_id = ?').get(id, uid);
    if (!row) return res.status(404).json({ ok: false, error: 'not found' });
    const num = String(cardNumber || '').replace(/\s+/g, '');
    const bin = num ? String(num).slice(0, 6) : undefined;
    const last4 = num ? String(num).slice(-4) : undefined;
    const sets = []; const params = [];
    if (holderName != null) { sets.push('holder_name=?'); params.push(String(holderName || '')); }
    if (bankName != null) { sets.push('bank_name=?'); params.push(String(bankName || '')); }
    if (bin !== undefined) { sets.push('bin=?'); params.push(bin); }
    if (last4 !== undefined) { sets.push('last4=?'); params.push(last4); }
    params.push(id, uid);
    if (sets.length) db.prepare(`UPDATE user_bank_cards SET ${sets.join(', ')} WHERE id=? AND user_id=?`).run(...params);
    const updated = db.prepare('SELECT id, bin, last4, holder_name, bank_name, created_at FROM user_bank_cards WHERE id = ? AND user_id = ?').get(id, uid);
    res.json({ ok: true, card: updated });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});
app.delete('/api/me/bank-cards/:id', requireAuth, (req, res) => {
  try {
    const uid = Number(req.user.id);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });
    db.prepare('DELETE FROM user_bank_cards WHERE id = ? AND user_id = ?').run(id, uid);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

app.get('/api/admin/invite/commissions', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const status = String(req.query.status || '').trim();
    const currency = String(req.query.currency || '').trim().toUpperCase();
    const q = String(req.query.q || '').trim();
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize || 20)));
    const offset = (page - 1) * pageSize;
    const where = [];
    const params = [];
    if (status) { where.push('cr.status = ?'); params.push(status); }
    if (currency) { where.push('UPPER(cr.currency) = ?'); params.push(currency); }
    if (q) { where.push('(UPPER(inv.name) LIKE ? OR UPPER(inv.phone) LIKE ? OR UPPER(rec.name) LIKE ? OR UPPER(rec.phone) LIKE ?)'); params.push(`%${q.toUpperCase()}%`, `%${q.toUpperCase()}%`, `%${q.toUpperCase()}%`, `%${q.toUpperCase()}%`); }
    const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';
    const sql = `SELECT cr.id, cr.inviter_id AS inviterId, cr.invitee_id AS inviteeId, cr.source, cr.order_id AS orderId, cr.currency, cr.amount, cr.status, cr.frozen_until, cr.created_at, cr.released_at,
      inv.name AS inviterName, inv.phone AS inviterPhone, rec.name AS inviteeName, rec.phone AS inviteePhone
      FROM commission_records cr
      LEFT JOIN users inv ON cr.inviter_id = inv.id
      LEFT JOIN users rec ON cr.invitee_id = rec.id ${whereSql} ORDER BY cr.id DESC LIMIT ? OFFSET ?`;
    const rows = db.prepare(sql).all(...params, pageSize, offset);
    const total = db.prepare(`SELECT COUNT(1) AS c FROM commission_records cr LEFT JOIN users inv ON cr.inviter_id = inv.id LEFT JOIN users rec ON cr.invitee_id = rec.id ${whereSql}`).get(...params)?.c || 0;
    const now = Date.now();
    const items = rows.map(r => {
      let remainMs = 0;
      if (r.status === 'frozen' && r.frozen_until) { const t = Date.parse(r.frozen_until); if (Number.isFinite(t)) remainMs = Math.max(0, t - now); }
      const maskPhone = (s) => { const x = String(s || ''); return x.length >= 7 ? (x.slice(0, 3) + '****' + x.slice(-2)) : x; };
      return {
        id: r.id,
        inviterId: r.inviterId,
        inviterName: r.inviterName || '',
        inviterPhone: r.inviterPhone || '',
        inviteeId: r.inviteeId,
        inviteeName: r.inviteeName || '',
        inviteePhoneMasked: maskPhone(r.inviteePhone),
        source: r.source,
        orderId: r.orderId,
        currency: String(r.currency || '').toUpperCase(),
        amount: Number(r.amount || 0),
        status: r.status,
        frozen_until: r.frozen_until || null,
        remain_ms: remainMs,
        created_at: r.created_at,
        released_at: r.released_at || null
      };
    });
    res.json({ items, total, page, pageSize });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

// Final 404 handler (must be registered last)
// moved to the end of file

// ---- Public: user profile lookup by phone (limited fields) ----
app.get('/api/public/user_profile', (req, res) => {
  try {
    const phone = String(req.query.phone || '').replace(/\D+/g, '').trim();
    if (!/^\d{5,}$/.test(phone)) return res.status(400).json({ error: 'bad_phone' });
    const row = db.prepare('SELECT phone, name, avatar, last_login_country AS country FROM users WHERE phone = ?').get(phone);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const origin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['host'] || ''}`;
    const avatar = (() => { const a = String(row.avatar || '').trim(); if (!a) return ''; if (/^https?:\/\//i.test(a)) return a; return origin.replace(/\/$/, '') + (a.startsWith('/') ? a : ('/' + a)); })();
    res.json({ phone: row.phone, name: row.name || '', avatar, country: row.country || '' });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});
// ---- Me: Credit score ----
app.get('/api/me/credit/score', requireAuth, (req, res) => {
  try {
    const row = db.prepare('SELECT credit_score FROM users WHERE id = ?').get(Number(req.user.id));
    const s = Number(row?.credit_score ?? 100);
    const score = Number.isFinite(s) ? s : 100;
    res.json({ ok: true, score });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

app.get('/api/me/credit/apps', requireAuth, (req, res) => {
  try {
    const uid = Number(req.user.id);
    const rows = db.prepare('SELECT * FROM credit_apps WHERE user_id = ? ORDER BY id DESC').all(uid);
    const items = rows.map(r => ({
      ...r,
      images: (() => { try { return JSON.parse(r.images || '[]'); } catch { return []; } })()
    }));
    res.json({ ok: true, items });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

app.post('/api/me/credit/apply', requireAuth, (req, res) => {
  try {
    const uid = Number(req.user.id);
    const { name, phone, address, city, state, zip, periodUnit, images } = req.body;
    const amount = Number(req.body.amount || 0);
    const periodValue = Number(req.body.periodValue || 0);
    const score = Number(req.body.score || 0);

    if (!amount || amount <= 0) return res.status(400).json({ ok: false, error: 'bad amount' });

    // Check if there is already a pending application
    const pending = db.prepare("SELECT id FROM credit_apps WHERE user_id = ? AND status = 'pending'").get(uid);
    if (pending) return res.status(400).json({ ok: false, error: 'already_pending' });

    const imgsStr = JSON.stringify(Array.isArray(images) ? images : []);

    db.prepare(`INSERT INTO credit_apps (
      user_id, name, phone, address, city, state, zip, amount, score, period_value, period_unit, images, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
      .run(uid, String(name || ''), String(phone || ''), String(address || ''), String(city || ''), String(state || ''), String(zip || ''), amount, score, periodValue, String(periodUnit || 'month'), imgsStr, new Date().toISOString(), new Date().toISOString());

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

// ---- Admin: set user credit score ----
app.post('/api/admin/users/:uid/credit_score', requireRoles(['super', 'admin', 'operator']), (req, res) => {
  try {
    const uid = Number(req.params.uid);
    const raw = Number(req.body?.score);
    if (!Number.isFinite(uid)) return res.status(400).json({ ok: false, error: 'bad uid' });
    if (!Number.isFinite(raw)) return res.status(400).json({ ok: false, error: 'bad score' });
    const score = Math.max(0, Math.min(1000, Math.round(raw)));
    if (String(req.user.role) === 'operator' && !operatorCanManageCustomer(req, uid)) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(uid);
    if (!exists) return res.status(404).json({ ok: false, error: 'user not found' });
    db.prepare('UPDATE users SET credit_score=?, updated_at=? WHERE id=?').run(score, new Date().toISOString(), uid);
    try { db.exec('CREATE TABLE IF NOT EXISTS credit_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, admin_id INTEGER, role TEXT, score INTEGER, created_at TEXT)'); } catch { }
    try { db.prepare('INSERT INTO credit_audit (user_id, admin_id, role, score, created_at) VALUES (?, ?, ?, ?, ?)').run(uid, Number(req.user.id), String(req.user.role || ''), score, new Date().toISOString()); } catch { }
    try {
      db.prepare('INSERT INTO notifications (user_id, title, message, created_at, read, pinned) VALUES (?, ?, ?, ?, 0, 0)')
        .run(uid, '信用分更新', `你当前的机构信用分已更新为：${score}`, new Date().toISOString());
    } catch { }
    res.json({ ok: true, score });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

// ---- Admin: Credit Audit ----
app.get('/api/admin/credit/apps', requireRoles(['super', 'admin', 'operator']), (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || '').trim();
    const mine = String(req.query.mine || '') === '1';
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize || 50)));
    const offset = (page - 1) * pageSize;

    const where = [];
    const params = [];

    if (q) {
      where.push('(name LIKE ? OR phone LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    if (status && status !== 'all') {
      where.push('status = ?');
      params.push(status);
    }
    if (mine && String(req.user.role) === 'operator') {
      // Filter by users assigned to this operator
      // We need to join users table or subquery. Since credit_apps has user_id, we can join.
      // But wait, credit_apps might not be fully linked if created from outside?
      // Assuming credit_apps.user_id is valid.
      // Let's do a subquery for simplicity or join.
      where.push(`user_id IN (SELECT id FROM users WHERE assigned_operator_id = ?)`);
      params.push(req.user.id);
    }

    const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';
    const sql = `SELECT * FROM credit_apps ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`;
    const items = db.prepare(sql).all(...params, pageSize, offset);
    const total = db.prepare(`SELECT COUNT(1) AS c FROM credit_apps ${whereSql}`).get(...params)?.c || 0;

    // Parse images JSON
    for (const it of items) {
      try { it.images = JSON.parse(it.images || '[]'); } catch { it.images = []; }
    }

    res.json({ ok: true, items, total, page, pageSize });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

app.post('/api/admin/credit/:id/approve', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    const amount = Number(req.body.amount || 0);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });

    const row = db.prepare('SELECT * FROM credit_apps WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ ok: false, error: 'not found' });
    if (row.status === 'done') return res.json({ ok: true }); // idempotent

    db.prepare("UPDATE credit_apps SET status='done', amount=?, updated_at=? WHERE id=?").run(amount, new Date().toISOString(), id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

app.post('/api/admin/credit/:id/reject', requireRoles(['super', 'admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });

    const row = db.prepare('SELECT * FROM credit_apps WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ ok: false, error: 'not found' });
    if (row.status === 'rejected') return res.json({ ok: true });

    db.prepare("UPDATE credit_apps SET status='rejected', updated_at=? WHERE id=?").run(new Date().toISOString(), id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

// ================================================================
// EODHD API 代理端点
// API Key: 69748c0107cda8.75548241
// 文档: https://eodhd.com/financial-apis/
// ================================================================
const EODHD_API_KEY = process.env.EODHD_API_KEY || '69748c0107cda8.75548241';
const EODHD_BASE_URL = 'https://eodhd.com/api';

// 缓存配置
const eodhdCache = new Map();
const EODHD_CACHE_TTL = Number(process.env.EODHD_CACHE_TTL || 15000); // 15秒缓存

// 辅助函数：带缓存的 EODHD 请求
async function fetchEodhd(endpoint, params = {}, cacheTtl = EODHD_CACHE_TTL) {
  const url = new URL(`${EODHD_BASE_URL}${endpoint}`);
  url.searchParams.set('api_token', EODHD_API_KEY);
  url.searchParams.set('fmt', 'json');
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v));
    }
  });

  const cacheKey = url.toString();
  const cached = eodhdCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < cacheTtl) {
    return cached.data;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!res.ok) {
      throw new Error(`EODHD API error: ${res.status}`);
    }
    
    const data = await res.json();
    eodhdCache.set(cacheKey, { ts: Date.now(), data });
    return data;
  } catch (err) {
    console.error('[EODHD] fetch error:', endpoint, err.message);
    throw err;
  }
}

// 清理过期缓存（每5分钟）
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of eodhdCache.entries()) {
    if (now - val.ts > EODHD_CACHE_TTL * 10) {
      eodhdCache.delete(key);
    }
  }
}, 5 * 60 * 1000);

// ---- EODHD: 实时/延迟报价（股票） ----
// 支持美股(.US)、波兰股(.WAR)等
// 示例: GET /api/eodhd/realtime?symbols=AAPL.US,MSFT.US
// 示例: GET /api/eodhd/realtime?symbols=PKO.WAR,CDR.WAR&market=pl
app.get('/api/eodhd/realtime', async (req, res) => {
  try {
    const symbolsRaw = String(req.query.symbols || '').trim();
    const market = String(req.query.market || 'us').toLowerCase();
    
    if (!symbolsRaw) {
      return res.status(400).json({ ok: false, error: 'symbols required' });
    }
    
    const symbols = symbolsRaw.split(',').map(s => s.trim()).filter(Boolean);
    if (!symbols.length) {
      return res.status(400).json({ ok: false, error: 'invalid symbols' });
    }
    
    // 将符号转换为 EODHD 格式
    const formatSymbol = (sym) => {
      const upper = sym.toUpperCase();
      // 已经包含交易所后缀，需要转换 .WA 为 .WAR
      if (/\.WA$/i.test(upper)) {
        return upper.replace(/\.WA$/i, '.WAR'); // .WA -> .WAR
      }
      if (/\.[A-Z]+$/.test(upper)) return upper;
      // 根据市场添加后缀
      if (market === 'pl' || market === 'war' || market === 'wse') {
        return `${upper}.WAR`; // 华沙证券交易所
      }
      return `${upper}.US`; // 默认美股
    };
    
    // 建立原始符号到 EODHD 符号的映射
    const symbolMap = new Map();
    symbols.forEach(orig => {
      symbolMap.set(formatSymbol(orig).toUpperCase(), orig);
    });
    
    const eodhdSymbols = symbols.map(formatSymbol);
    const primary = eodhdSymbols[0];
    const additional = eodhdSymbols.slice(1);
    
    // EODHD 批量请求格式：第一个符号在路径中，其他通过 s 参数
    const params = additional.length ? { s: additional.join(',') } : {};
    const data = await fetchEodhd(`/real-time/${primary}`, params);
    
    // 标准化响应 - 保持原始符号格式
    const normalize = (item) => {
      const eodhdSym = String(item.code || item.symbol || '').toUpperCase();
      // 查找原始符号，如果找不到则使用去掉后缀的版本
      const origSymbol = symbolMap.get(eodhdSym) || eodhdSym.replace(/\.(US|WAR|WSE|CC|FOREX)$/i, '');
      return {
        symbol: origSymbol,
        fullSymbol: eodhdSym,
        price: Number(item.close || item.previousClose || 0),
        open: Number(item.open || 0),
        high: Number(item.high || 0),
        low: Number(item.low || 0),
        previousClose: Number(item.previousClose || item.previous_close || 0),
        change: Number(item.change || 0),
        changePct: Number(item.change_p || item.percent_change || 0),
        volume: Number(item.volume || 0),
        timestamp: item.timestamp,
        exchange: item.exchange || market.toUpperCase(),
      };
    };
    
    let results = [];
    if (Array.isArray(data)) {
      results = data.map(normalize);
    } else if (data && typeof data === 'object' && data.code) {
      results = [normalize(data)];
    }
    
    res.json({ ok: true, data: results });
  } catch (e) {
    console.error('[EODHD/realtime] error:', e.message);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ---- EODHD: 加密货币实时报价 ----
// 示例: GET /api/eodhd/crypto/realtime?symbols=BTC,ETH,SOL
app.get('/api/eodhd/crypto/realtime', async (req, res) => {
  try {
    const symbolsRaw = String(req.query.symbols || '').trim();
    
    if (!symbolsRaw) {
      return res.status(400).json({ ok: false, error: 'symbols required' });
    }
    
    const symbols = symbolsRaw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    if (!symbols.length) {
      return res.status(400).json({ ok: false, error: 'invalid symbols' });
    }
    
    // EODHD 加密货币格式: BTC-USD.CC
    const formatCryptoSymbol = (sym) => `${sym}-USD.CC`;
    const eodhdSymbols = symbols.map(formatCryptoSymbol);
    const primary = eodhdSymbols[0];
    const additional = eodhdSymbols.slice(1);
    
    const params = additional.length ? { s: additional.join(',') } : {};
    const data = await fetchEodhd(`/real-time/${primary}`, params);
    
    const normalize = (item) => {
      const code = String(item.code || item.symbol || '');
      const base = code.replace(/-USD\.CC$/i, '').toUpperCase();
      return {
        symbol: base,
        fullSymbol: code,
        priceUSD: Number(item.close || item.previousClose || 0),
        open: Number(item.open || 0),
        high: Number(item.high || 0),
        low: Number(item.low || 0),
        previousClose: Number(item.previousClose || item.previous_close || 0),
        change: Number(item.change || 0),
        changePct: Number(item.change_p || item.percent_change || 0),
        volume: Number(item.volume || 0),
        timestamp: item.timestamp,
      };
    };
    
    let results = [];
    if (Array.isArray(data)) {
      results = data.map(normalize);
    } else if (data && typeof data === 'object' && data.code) {
      results = [normalize(data)];
    }
    
    res.json({ ok: true, data: results });
  } catch (e) {
    console.error('[EODHD/crypto/realtime] error:', e.message);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ---- EODHD: 分时数据（K线） ----
// 示例: GET /api/eodhd/intraday?symbol=AAPL&interval=5m&from=2024-01-01&to=2024-01-31
// interval: 1m, 5m, 1h
app.get('/api/eodhd/intraday', async (req, res) => {
  try {
    const symbolRaw = String(req.query.symbol || '').trim();
    const market = String(req.query.market || 'us').toLowerCase();
    const interval = String(req.query.interval || '5m').toLowerCase();
    const from = req.query.from;
    const to = req.query.to;
    
    if (!symbolRaw) {
      return res.status(400).json({ ok: false, error: 'symbol required' });
    }
    
    // 转换符号格式
    const formatSymbol = (sym) => {
      const upper = sym.toUpperCase();
      // 转换 .WA 为 .WAR（波兰华沙证券交易所）
      if (/\.WA$/i.test(upper)) {
        return upper.replace(/\.WA$/i, '.WAR');
      }
      if (/\.[A-Z]+$/.test(upper)) return upper;
      if (market === 'pl' || market === 'war' || market === 'wse') {
        return `${upper}.WAR`;
      }
      if (market === 'crypto' || market === 'cc') {
        return `${upper}-USD.CC`;
      }
      return `${upper}.US`;
    };
    
    const eodhdSymbol = formatSymbol(symbolRaw);
    const params = { interval };
    if (from) params.from = from;
    if (to) params.to = to;
    
    const data = await fetchEodhd(`/intraday/${eodhdSymbol}`, params, 30000); // 30秒缓存
    
    // 返回 OHLCV 数组
    const candles = Array.isArray(data) ? data.map(item => ({
      datetime: item.datetime || item.timestamp,
      open: Number(item.open || 0),
      high: Number(item.high || 0),
      low: Number(item.low || 0),
      close: Number(item.close || 0),
      volume: Number(item.volume || 0),
    })) : [];
    
    res.json({ ok: true, symbol: eodhdSymbol, interval, data: candles });
  } catch (e) {
    console.error('[EODHD/intraday] error:', e.message);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ---- EODHD: 加密货币分时数据 ----
// 示例: GET /api/eodhd/crypto/intraday?symbol=BTC&interval=5m
app.get('/api/eodhd/crypto/intraday', async (req, res) => {
  try {
    const symbolRaw = String(req.query.symbol || '').trim().toUpperCase();
    const interval = String(req.query.interval || '5m').toLowerCase();
    const from = req.query.from;
    const to = req.query.to;
    
    if (!symbolRaw) {
      return res.status(400).json({ ok: false, error: 'symbol required' });
    }
    
    const eodhdSymbol = `${symbolRaw}-USD.CC`;
    const params = { interval };
    if (from) params.from = from;
    if (to) params.to = to;
    
    const data = await fetchEodhd(`/intraday/${eodhdSymbol}`, params, 30000);
    
    const candles = Array.isArray(data) ? data.map(item => ({
      datetime: item.datetime || item.timestamp,
      open: Number(item.open || 0),
      high: Number(item.high || 0),
      low: Number(item.low || 0),
      close: Number(item.close || 0),
      volume: Number(item.volume || 0),
    })) : [];
    
    res.json({ ok: true, symbol: symbolRaw, interval, data: candles });
  } catch (e) {
    console.error('[EODHD/crypto/intraday] error:', e.message);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ---- EODHD: 日终历史数据 ----
// 示例: GET /api/eodhd/eod?symbol=AAPL&from=2024-01-01&to=2024-12-31
// 或者: GET /api/eodhd/eod?symbol=AAPL&period=3mo (最近3个月)
app.get('/api/eodhd/eod', async (req, res) => {
  try {
    const symbolRaw = String(req.query.symbol || '').trim();
    const market = String(req.query.market || 'us').toLowerCase();
    let from = req.query.from;
    let to = req.query.to;
    const period = req.query.period || ''; // 支持 3mo, 6mo, 1y 等
    
    if (!symbolRaw) {
      return res.status(400).json({ ok: false, error: 'symbol required' });
    }
    
    // 根据 period 计算日期范围
    if (period && !from) {
      const now = new Date();
      to = now.toISOString().split('T')[0];
      const periodMatch = period.match(/^(\d+)(d|w|mo|m|y)$/i);
      if (periodMatch) {
        const num = parseInt(periodMatch[1]);
        const unit = periodMatch[2].toLowerCase();
        const fromDate = new Date(now);
        if (unit === 'd') fromDate.setDate(fromDate.getDate() - num);
        else if (unit === 'w') fromDate.setDate(fromDate.getDate() - num * 7);
        else if (unit === 'mo' || unit === 'm') fromDate.setMonth(fromDate.getMonth() - num);
        else if (unit === 'y') fromDate.setFullYear(fromDate.getFullYear() - num);
        from = fromDate.toISOString().split('T')[0];
      }
    }
    
    const formatSymbol = (sym) => {
      const upper = sym.toUpperCase();
      // 转换 .WA 为 .WAR（波兰华沙证券交易所）
      if (/\.WA$/i.test(upper)) {
        return upper.replace(/\.WA$/i, '.WAR');
      }
      if (/\.[A-Z]+$/.test(upper)) return upper;
      if (market === 'pl' || market === 'war' || market === 'wse') {
        return `${upper}.WAR`;
      }
      if (market === 'crypto' || market === 'cc') {
        return `${upper}-USD.CC`;
      }
      return `${upper}.US`;
    };
    
    const eodhdSymbol = formatSymbol(symbolRaw);
    const params = { period: 'd' }; // 日线数据
    if (from) params.from = from;
    if (to) params.to = to;
    
    const data = await fetchEodhd(`/eod/${eodhdSymbol}`, params, 60000); // 1分钟缓存
    
    const bars = Array.isArray(data) ? data.map(item => ({
      date: item.date,
      open: Number(item.open || 0),
      high: Number(item.high || 0),
      low: Number(item.low || 0),
      close: Number(item.close || 0),
      adjustedClose: Number(item.adjusted_close || item.close || 0),
      volume: Number(item.volume || 0),
    })) : [];
    
    res.json({ ok: true, symbol: eodhdSymbol, period, data: bars });
  } catch (e) {
    console.error('[EODHD/eod] error:', e.message);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ---- EODHD: 外汇汇率 ----
// 示例: GET /api/eodhd/forex?pair=USDPLN
app.get('/api/eodhd/forex', async (req, res) => {
  try {
    const pair = String(req.query.pair || 'USDPLN').toUpperCase();
    
    const eodhdSymbol = `${pair}.FOREX`;
    const data = await fetchEodhd(`/real-time/${eodhdSymbol}`, {}, 60000); // 1分钟缓存
    
    if (!data || !data.close) {
      return res.status(404).json({ ok: false, error: 'rate not found' });
    }
    
    res.json({
      ok: true,
      pair,
      rate: Number(data.close || 0),
      previousClose: Number(data.previousClose || data.previous_close || 0),
      change: Number(data.change || 0),
      changePct: Number(data.change_p || 0),
      timestamp: data.timestamp,
    });
  } catch (e) {
    console.error('[EODHD/forex] error:', e.message);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ---- EODHD: 搜索符号 ----
// 示例: GET /api/eodhd/search?query=apple
app.get('/api/eodhd/search', async (req, res) => {
  try {
    const query = String(req.query.query || req.query.q || '').trim();
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 10)));
    
    if (!query) {
      return res.status(400).json({ ok: false, error: 'query required' });
    }
    
    const data = await fetchEodhd('/search', { query, limit }, 300000); // 5分钟缓存
    
    const results = Array.isArray(data) ? data.map(item => ({
      code: item.Code,
      name: item.Name,
      exchange: item.Exchange,
      country: item.Country,
      currency: item.Currency,
      type: item.Type,
      isin: item.ISIN,
    })) : [];
    
    res.json({ ok: true, query, data: results });
  } catch (e) {
    console.error('[EODHD/search] error:', e.message);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Final 404 handler (must be registered last)
app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Not Found' });
});
