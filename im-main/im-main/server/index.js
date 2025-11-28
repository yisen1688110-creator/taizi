const path = require('path')
const fs = require('fs')
const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
let sqlite3 = null
try { sqlite3 = require('sqlite3').verbose() } catch (_) { sqlite3 = null }
const cors = require('cors')
const { fetchUserProfile, upsertUserProfile } = require('./userService')
const multer = require('multer')

const app = express()
const allowOrigins = String(process.env.IM_CORS_ORIGIN || process.env.CORS_ORIGIN || '').split(/[\s,]+/).filter(Boolean)
const allowAllCors = allowOrigins.length === 0
app.use(cors({
  origin: (origin, cb) => {
    try {
      if (allowAllCors || !origin) return cb(null, true)
      const host = new URL(origin).hostname
      const ok = allowOrigins.some(o => {
        try { const d = new URL(o).hostname || o; return host === d || host.endsWith('.' + d) }
        catch { return host === o || host.endsWith('.' + o) }
      })
      return cb(ok ? null : new Error('cors_denied'), ok)
    } catch { return cb(new Error('cors_denied'), false) }
  }
}))
app.use(express.json({ limit: '20mb' }))
app.use(express.urlencoded({ extended: true, limit: '20mb' }))
app.set('trust proxy', true)
const CSRF_COOKIE_NAME = String(process.env.IM_CSRF_COOKIE_NAME || 'csrf_token')
const CSRF_HEADER_NAME = String(process.env.IM_CSRF_HEADER_NAME || 'x-csrf-token')
function parseCookie(h) { const out = {}; try { String(h||'').split(';').forEach(p=>{ const i=p.indexOf('='); if(i>0){ const k=p.slice(0,i).trim(); const v=p.slice(i+1).trim(); out[k]=v; } }); } catch {} ; return out }
function setCsrfCookieIfMissing(req, res, next) { try { const c = parseCookie(req.headers && req.headers.cookie)[CSRF_COOKIE_NAME]; if (!c) { const t = Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2); const isProd = String(process.env.NODE_ENV||'').trim().toLowerCase()==='production'; const opts = { httpOnly: false, sameSite: isProd ? 'None' : 'Lax', secure: isProd, path: '/' }; res.cookie(CSRF_COOKIE_NAME, t, opts); } } catch {} ; next() }
function csrfGuard(req, res) {
  try {
    const m = String(req.method||'GET').toUpperCase();
    if (!['POST','PUT','PATCH','DELETE'].includes(m)) return true;
    const cookies = parseCookie(req.headers && req.headers.cookie);
    const c = String(cookies[CSRF_COOKIE_NAME]||'').trim();
    const h = String(req.headers[CSRF_HEADER_NAME]||'').trim();
    const devBypass = String(process.env.NODE_ENV||'').trim().toLowerCase() !== 'production';
    if (!c || !h || c !== h) {
      if (devBypass) return true;
      try { res.status(403).json({ error: 'csrf_invalid' }) } catch {}
      return false;
    }
    return true;
  } catch (_) { try { res.status(403).json({ error: 'csrf_invalid' }) } catch {} ; return false }
}
app.use(setCsrfCookieIfMissing)
function securityHeaders(req, res, next) {
  try {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    const hsts = String(process.env.ENABLE_HSTS || '').trim() === '1'
    if (hsts) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains')
    const csp = String(process.env.CSP || '').trim()
    if (csp) res.setHeader('Content-Security-Policy', csp)
    else if (String(process.env.NODE_ENV||'').trim().toLowerCase()==='production') res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https:")
  } catch (_) {}
  next()
}
app.use(securityHeaders)
app.use((req, res, next) => {
  try {
    if (String(req.method||'GET').toUpperCase() === 'GET') {
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Pragma', 'no-cache')
      res.setHeader('Expires', '0')
    }
  } catch (_) {}
  next()
})
const rateBuckets = new Map()
function createRateLimiter(opts) {
  const windowMs = Math.max(1000, Number((opts && opts.windowMs) || 60000))
  const max = Math.max(1, Number((opts && opts.max) || 10))
  const REDIS_URL = String(process.env.REDIS_URL || '').trim()
  let redis = null; try { if (REDIS_URL) { const Redis = require('ioredis'); redis = new Redis(REDIS_URL) } } catch (_){ redis = null }
  if (redis) {
    return async (req, res, next) => {
      try {
        const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
        const ip = xf || req.ip || (req.connection && req.connection.remoteAddress) || 'unknown'
        const key = `ip:${ip}:rl:${windowMs}:${max}`
        const ttl = Math.ceil(windowMs/1000)
        const val = await redis.incr(key)
        if (val === 1) await redis.expire(key, ttl)
        if (val > max) return res.status(429).json({ error: 'rate_limited' })
        return next()
      } catch (_) { return next() }
    }
  }
  return (req, res, next) => {
    try {
      const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      const ip = xf || req.ip || (req.connection && req.connection.remoteAddress) || 'unknown'
      const key = `ip:${ip}`
      const now = Date.now()
      const b = rateBuckets.get(key)
      if (!b || now > b.reset) { rateBuckets.set(key, { reset: now + windowMs, count: 1 }); return next() }
      if (b.count >= max) return res.status(429).json({ error: 'rate_limited' })
      b.count += 1; return next()
    } catch (_) { return next() }
  }
}
const IS_PROD = String(process.env.NODE_ENV||'').trim().toLowerCase()==='production'
const rateLimitUpload = IS_PROD ? createRateLimiter({ windowMs: 60000, max: 5 }) : (req, res, next) => next()
const rateLimitWrite = createRateLimiter({ windowMs: 60000, max: 20 })

app.get('/healthz', (req, res) => res.json({ ok: true }))

app.get('/api/csrf', (req, res) => {
  try {
    const cookies = parseCookie(req.headers && req.headers.cookie)
    let t = String(cookies[CSRF_COOKIE_NAME] || '').trim()
    if (!t) {
      t = Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)
      const isProd = String(process.env.NODE_ENV||'').trim().toLowerCase()==='production'
      const opts = { httpOnly: false, sameSite: isProd ? 'None' : 'Lax', secure: isProd, path: '/' }
      res.cookie(CSRF_COOKIE_NAME, t, opts)
    }
    res.json({ ok: true, csrf: t })
  } catch (_) { res.json({ ok: true, csrf: '' }) }
})

const IM_TOKEN = process.env.IM_TOKEN ? String(process.env.IM_TOKEN) : ''
const server = http.createServer(app)
const io = new Server(server, { cors: { origin: allowAllCors ? '*' : allowOrigins, credentials: true } })
const PROD = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production'
if (PROD && !IM_TOKEN) { try { console.error('[im-main] IM_TOKEN is required in production') } catch (_) {} ; process.exit(1) }

if (IM_TOKEN) {
  app.use((req, res, next) => {
    try {
      const url = String(req.url || '')
      const method = String(req.method || 'GET').toUpperCase()
      const publicStatic = url === '/' || url.startsWith('/agent') || url.startsWith('/customer') || url.startsWith('/styles') || url.startsWith('/uploads/') || url.startsWith('/socket.io/')
      if (publicStatic) return next()
      const anonAllowed = (
        (url === '/api/health') ||
        (url === '/api/version') ||
        (url === '/api/user') ||
        (url.startsWith('/api/user/')) ||
        (url.startsWith('/api/messages/')) ||
        (url.startsWith('/api/message/'))
      )
      if (anonAllowed) return next()
      if (!url.startsWith('/api')) return next()
      const tHeader = String(req.headers['x-im-token'] || '').trim()
      const tQuery = String((req.query && (req.query.token || req.query['x-im-token'])) || '').trim()
      const t = tHeader || tQuery
      if (t && t === IM_TOKEN) return next()
      return res.status(401).json({ error: 'unauthorized' })
    } catch (_) { return res.status(401).json({ error: 'unauthorized' }) }
  })
  io.use((socket, next) => {
    try {
      const a = socket.handshake && socket.handshake.auth && socket.handshake.auth.token
      const q = socket.handshake && socket.handshake.query && (socket.handshake.query.token || socket.handshake.query['x-im-token'])
      const h = socket.handshake && socket.handshake.headers && socket.handshake.headers['x-im-token']
      const at = socket.handshake && socket.handshake.headers && socket.handshake.headers['x-im-agent']
      const t = String(a || q || h || '').trim()
      const PROD = String(process.env.NODE_ENV||'').trim().toLowerCase()==='production'
      if (at) {
        db.get('SELECT id FROM agent_tokens WHERE token = ?', [String(at)], (err, row) => {
          if (!err && row) { try { socket.data = { role: 'agent' } } catch (_) {}; return next() }
          if (!PROD && t && t === IM_TOKEN) { try { socket.data = { role: 'agent' } } catch (_) {}; return next() }
          return next(new Error('unauthorized'))
        })
        return
      }
      try { socket.data = { role: 'customer' } } catch (_) {}
      return next()
    } catch (_) { return next() }
  })
}


const dataDir = path.join(__dirname, '..', 'data')
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir)
const dbPath = path.join(dataDir, 'chat.db')
const db = sqlite3 ? new sqlite3.Database(dbPath) : null
const mem = { users: new Map(), messages: [], notes: [], user_notes: new Map(), kyc: [], kyc_status: new Map(), seen: new Map(), reads: new Map(), agent_acl: new Set(), agent_tokens: [], nextId: 1 }
const memPath = path.join(dataDir, 'mem.json')
try {
  if (fs.existsSync(memPath)) {
    const raw = fs.readFileSync(memPath, 'utf8')
    const obj = JSON.parse(raw || '{}')
    if (Array.isArray(obj.messages)) mem.messages = obj.messages.map(m => ({ id: m.id, phone: m.phone, sender: m.sender, content: m.content, ts: m.ts, type: m.type || null, reply_to: m.reply_to || null }))
    if (obj && obj.users && typeof obj.users === 'object') { mem.users = new Map(Object.entries(obj.users).map(([k,v])=>[k,{ phone:String(k), name:String(v && v.name || ''), avatar:String(v && v.avatar || ''), country:String(v && v.country || '') }])) }
    if (Number.isFinite(obj.nextId)) mem.nextId = obj.nextId
  }
} catch (_) {}
function saveMem() {
  try {
    const usersObj = {}
    for (const [k,v] of mem.users.entries()) usersObj[k] = { name: v.name || '', avatar: v.avatar || '', country: v.country || '' }
    const out = { messages: mem.messages.slice(0), users: usersObj, nextId: mem.nextId }
    fs.writeFileSync(memPath, JSON.stringify(out))
  } catch (_) {}
}

if (db) {
  db.serialize(() => {
    db.run('PRAGMA journal_mode=WAL')
    db.run('PRAGMA synchronous=NORMAL')
    db.run('PRAGMA foreign_keys=ON')
    db.run('CREATE TABLE IF NOT EXISTS users (phone TEXT PRIMARY KEY, name TEXT, avatar TEXT)')
    db.all('PRAGMA table_info(users)', (err, cols) => {
      if (!err) {
        const hasCountry = Array.isArray(cols) && cols.some(c => c.name === 'country')
        if (!hasCountry) db.run('ALTER TABLE users ADD COLUMN country TEXT')
      }
    })
    db.run('CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, sender TEXT, content TEXT, ts INTEGER, type TEXT)')
    db.run('CREATE TABLE IF NOT EXISTS reads (phone TEXT PRIMARY KEY, last_read_ts INTEGER)')
    db.run('CREATE TABLE IF NOT EXISTS user_notes (phone TEXT PRIMARY KEY, note TEXT)')
    db.run('CREATE TABLE IF NOT EXISTS seen (phone TEXT PRIMARY KEY, last_seen_ts INTEGER)')
    db.run('CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, content TEXT, ts INTEGER)')
    db.all('PRAGMA table_info(notes)', (err, cols) => {
      if (!err) {
        const hasPinned = Array.isArray(cols) && cols.some(c => c.name === 'pinned')
        if (!hasPinned) db.run('ALTER TABLE notes ADD COLUMN pinned INTEGER DEFAULT 0')
      }
    })
    db.all('PRAGMA table_info(messages)', (err, cols) => {
      if (!err) {
        const hasType = Array.isArray(cols) && cols.some(c => c.name === 'type')
        if (!hasType) db.run('ALTER TABLE messages ADD COLUMN type TEXT')
        const hasReplyTo = Array.isArray(cols) && cols.some(c => c.name === 'reply_to')
        if (!hasReplyTo) db.run('ALTER TABLE messages ADD COLUMN reply_to INTEGER')
        const hasIp = Array.isArray(cols) && cols.some(c => c.name === 'ip')
        if (!hasIp) db.run('ALTER TABLE messages ADD COLUMN ip TEXT')
        const hasMsgCountry = Array.isArray(cols) && cols.some(c => c.name === 'country')
        if (!hasMsgCountry) db.run('ALTER TABLE messages ADD COLUMN country TEXT')
      }
    })
    db.run('CREATE TABLE IF NOT EXISTS agent_acl (phone TEXT PRIMARY KEY)')
    db.run('CREATE TABLE IF NOT EXISTS agent_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, token TEXT)')
  })
}

app.use(express.static(path.join(__dirname, '..', 'public')))
app.get('/logo.png', (req, res) => {
  try { res.sendFile(path.join(__dirname, '..', 'public', 'tiny.png')) } catch { res.status(204).end() }
})
app.get('/favicon.ico', (req, res) => {
  try { res.sendFile(path.join(__dirname, '..', 'public', 'tiny.png')) } catch { res.status(204).end() }
})

const uploadDir = path.join(__dirname, '..', 'public', 'uploads')
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir)
const pendingDir = path.join(__dirname, '..', 'data', 'pending')
try { if (!fs.existsSync(path.join(__dirname, '..', 'data'))) fs.mkdirSync(path.join(__dirname, '..', 'data')) } catch (_) {}
try { if (!fs.existsSync(pendingDir)) fs.mkdirSync(pendingDir) } catch (_) {}
const upload = multer({
  storage: multer.diskStorage({
    destination: pendingDir,
    filename: (_, file, cb) => {
      const ext = path.extname(file.originalname)
      const name = Date.now() + '-' + Math.random().toString(36).slice(2) + ext
      cb(null, name)
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const ok = /^image\//.test(file.mimetype)
    cb(ok ? null : new Error('invalid_filetype'), ok)
  }
})

app.get('/api/user/:phone', async (req, res) => {
  const phone = req.params.phone
  if (!db) {
    const row = mem.users.get(phone)
    if (row) return res.json(row)
    const profile = await fetchUserProfile(phone)
    if (profile) { mem.users.set(phone, profile); saveMem(); return res.json(profile) }
    return res.status(404).json({ error: 'not_found' })
  }
  function sanitizeCountry(v){ try { const s = String(v||'').trim(); if (!s || /undefined/i.test(s)) return ''; return s } catch { return '' } }
  db.get('SELECT phone, name, avatar, country FROM users WHERE phone = ?', [phone], async (err, row) => {
    if (err) return res.status(500).json({ error: 'db_error' })
    if (row) {
      row.country = sanitizeCountry(row.country)
      if (!row.avatar) {
        const ext = await fetchUserProfile(phone).catch(()=>null)
        if (ext && (ext.avatar || ext.name || ext.country)) {
          upsertUserProfile(db, ext)
          return res.json({ phone, name: ext.name || row.name || '', avatar: ext.avatar || '', country: sanitizeCountry(ext.country || row.country || '') })
        }
      }
      if (!row.country) {
        db.get('SELECT country, ip FROM messages WHERE phone = ? AND sender = ? ORDER BY ts DESC LIMIT 1', [phone, 'customer'], async (e2, last) => {
          if (!e2 && last && (last.country || last.ip)) {
            const c = last.country || await resolveCountry(last.ip)
            const sc = sanitizeCountry(c)
            if (sc) db.run('UPDATE users SET country = ? WHERE phone = ?', [sc, phone])
            return res.json({ ...row, country: sc || row.country || '' })
          }
          return res.json({ ...row, country: sanitizeCountry(row.country) })
        })
      } else {
        return res.json({ ...row, country: sanitizeCountry(row.country) })
      }
      return
    }
    const profile = await fetchUserProfile(phone)
    if (profile) { upsertUserProfile(db, profile); return res.json(profile) }
    res.status(404).json({ error: 'not_found' })
  })
})

app.post('/api/user', async (req, res) => {
  const { phone, name, avatar } = req.body || {}
  if (!phone) return res.status(400).json({ error: 'phone_required' })
  try {
    const ip = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || req.ip || ''
    const country = await resolveCountry(ip)
    if (!db) { mem.users.set(phone, { phone, name: name || '', avatar: avatar || '', country }); saveMem(); return res.json({ ok: true }) }
    upsertUserProfile(db, { phone, name: name || '', avatar: avatar || '', country })
    res.json({ ok: true })
  } catch (_) {
    if (!db) { mem.users.set(phone, { phone, name: name || '', avatar: avatar || '' }); saveMem(); return res.json({ ok: true }) }
    upsertUserProfile(db, { phone, name: name || '', avatar: avatar || '' })
    res.json({ ok: true })
  }
})

app.get('/api/messages/:phone', (req, res) => {
  const phone = req.params.phone
  if (!db) {
    const rows = mem.messages.filter(m => m.phone === phone).sort((a,b)=>a.ts-b.ts)
    return res.json(rows)
  }
  db.all('SELECT id, phone, sender, content, ts, type, reply_to, ip, country FROM messages WHERE phone = ? ORDER BY ts ASC', [phone], (err, rows) => {
    if (err) return res.status(500).json({ error: 'db_error' })
    res.json(rows)
  })
})

app.get('/api/message/:id', (req, res) => {
  const id = req.params.id
  if (!db) {
    const row = mem.messages.find(m => String(m.id) === String(id))
    if (!row) return res.status(404).json({ error: 'not_found' })
    const { phone, sender, content, ts, type, reply_to } = row
    return res.json({ id: row.id, phone, sender, content, ts, type, reply_to })
  }
  db.get('SELECT id, phone, sender, content, ts, type, reply_to FROM messages WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: 'db_error' })
    if (!row) return res.status(404).json({ error: 'not_found' })
    res.json(row)
  })
})

app.get('/api/me/kyc/status', (req, res) => {
  try {
    const key = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || req.ip || ''
    const s = (db ? null : mem.kyc_status.get(key)) || 'unverified'
    return res.json({ status: s })
  } catch (_) { return res.json({ status: 'unverified' }) }
})

app.post('/api/me/kyc/submit', (req, res) => {
  if (!csrfGuard(req, res)) return
  try {
    const fields = (req.body && req.body.fields) || {}
    const photos = (req.body && req.body.photos) || []
    const name = String(fields.name||'').trim()
    const idType = String(fields.idType||'').trim()
    const idNumber = String(fields.idNumber||'').trim()
    if (!name || !idType || !idNumber || !Array.isArray(photos) || photos.length === 0) return res.status(400).json({ error: 'bad_request' })
    const rec = { id: mem.nextId++, fields: { name, idType, idNumber }, photos: photos.slice(0,3), ts: Date.now(), status: 'submitted' }
    if (!db) {
      mem.kyc.push(rec)
      const key = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || req.ip || ''
      mem.kyc_status.set(key, 'submitted')
      return res.json({ ok: true })
    }
    try {
      db.run('CREATE TABLE IF NOT EXISTS kyc_submissions (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, name TEXT, id_type TEXT, id_number TEXT, photos TEXT, ts INTEGER, status TEXT)')
      const photosStr = JSON.stringify(photos.slice(0,3))
      db.run('INSERT INTO kyc_submissions (phone, name, id_type, id_number, photos, ts, status) VALUES (?, ?, ?, ?, ?, ?, ?)', ['', name, idType, idNumber, photosStr, Date.now(), 'submitted'], err => {
        if (err) return res.status(500).json({ error: 'db_error' })
        res.json({ ok: true })
      })
    } catch (_) { return res.status(500).json({ error: 'db_error' }) }
  } catch (_) { return res.status(500).json({ error: 'server_error' }) }
})

app.get('/api/conversations', (req, res) => {
  if (!db) {
    const phones = Array.from(new Set(mem.messages.map(m => m.phone)))
    const rows = phones.map(p => {
      const msgs = mem.messages.filter(m => m.phone === p)
      const last = msgs[msgs.length-1]
      const lastAgent = [...msgs].reverse().find(m => m.sender === 'agent')
      const unreadCount = msgs.filter(m => m.sender === 'customer').length
      const u = mem.users.get(p) || {}
      const s = mem.seen.get(p) || 0
      return { phone: p, name: u.name || '', avatar: u.avatar || '', note: '', last_content: last ? last.content : '', last_ts: last ? last.ts : null, last_agent_ts: lastAgent ? lastAgent.ts : null, unread_count: unreadCount, last_seen_ts: s }
    })
    const list = rows.map(r => ({ ...r, online: onlinePhones.get(r.phone) > 0 }))
    return res.json(list)
  }
  const sql = `
  SELECT p.phone as phone,
         u.name as name,
         u.avatar as avatar,
         un.note as note,
         (SELECT content FROM messages WHERE phone=p.phone ORDER BY ts DESC LIMIT 1) AS last_content,
         (SELECT ts FROM messages WHERE phone=p.phone ORDER BY ts DESC LIMIT 1) AS last_ts,
         (SELECT ts FROM messages WHERE phone=p.phone AND sender='agent' ORDER BY ts DESC LIMIT 1) AS last_agent_ts,
         IFNULL((SELECT COUNT(1) FROM messages m LEFT JOIN reads r ON r.phone=m.phone WHERE m.phone=p.phone AND m.sender='customer' AND (r.last_read_ts IS NULL OR m.ts>r.last_read_ts)),0) AS unread_count,
         s.last_seen_ts as last_seen_ts
  FROM (SELECT DISTINCT phone FROM messages) p
  LEFT JOIN users u ON u.phone=p.phone
  LEFT JOIN user_notes un ON un.phone=p.phone
  LEFT JOIN seen s ON s.phone=p.phone
  ORDER BY last_ts DESC
  `
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'db_error' })
    const list = rows.map(r => ({ ...r, online: onlinePhones.get(r.phone) > 0 }))
    res.json(list)
  })
})

app.post('/api/read', (req, res) => {
  const { phone, ts } = req.body || {}
  if (!phone) return res.status(400).json({ error: 'phone_required' })
  const v = ts || Date.now()
  if (!db) {
    try { mem.reads.set(phone, v); return res.json({ ok: true }) } catch (_) { return res.json({ ok: true }) }
  }
  db.run('INSERT INTO reads (phone, last_read_ts) VALUES (?, ?) ON CONFLICT(phone) DO UPDATE SET last_read_ts=excluded.last_read_ts', [phone, v], err => {
    if (err) return res.status(500).json({ error: 'db_error' })
    res.json({ ok: true })
  })
})

app.get('/api/note/:phone', (req, res) => {
  const phone = req.params.phone
  if (!db) { const note = mem.user_notes.get(phone) || ''; return res.json({ phone, note }) }
  db.get('SELECT note FROM user_notes WHERE phone = ?', [phone], (err, row) => {
    if (err) return res.status(500).json({ error: 'db_error' })
    res.json({ phone, note: row ? row.note : '' })
  })
})

app.post('/api/note', (req, res) => {
  const { phone, note } = req.body || {}
  if (!phone) return res.status(400).json({ error: 'phone_required' })
  const ts = Date.now()
  if (!db) { mem.user_notes.set(phone, note || ''); mem.notes.push({ id: mem.nextId++, phone, content: note || '', ts, pinned: 0 }); return res.json({ ok: true, ts }) }
  db.run('INSERT INTO user_notes (phone, note) VALUES (?, ?) ON CONFLICT(phone) DO UPDATE SET note=excluded.note', [phone, note || ''], err => {
    if (err) return res.status(500).json({ error: 'db_error' })
    db.run('INSERT INTO notes (phone, content, ts) VALUES (?, ?, ?)', [phone, note || '', ts])
    res.json({ ok: true, ts })
  })
})

app.get('/api/notes/:phone', (req, res) => {
  const phone = req.params.phone
  if (!db) {
    const rows = mem.notes.filter(n => n.phone === phone).sort((a,b) => (Number(b.pinned||0) - Number(a.pinned||0)) || (b.ts - a.ts))
    return res.json(rows)
  }
  db.all('SELECT id, phone, content, ts, pinned FROM notes WHERE phone = ? ORDER BY pinned DESC, ts DESC', [phone], (err, rows) => {
    if (err) return res.status(500).json({ error: 'db_error' })
    res.json(rows)
  })
})

app.post('/api/notes', rateLimitWrite, (req, res) => {
  if (!csrfGuard(req, res)) return
  const { phone, content } = req.body || {}
  if (!phone || !content) return res.status(400).json({ error: 'bad_request' })
  const ts = Date.now()
  if (!db) { const id = mem.nextId++; mem.notes.push({ id, phone, content, ts, pinned: 0 }); return res.json({ ok: true, id, ts }) }
  db.run('INSERT INTO notes (phone, content, ts) VALUES (?, ?, ?)', [phone, content, ts], function (err) {
    if (err) return res.status(500).json({ error: 'db_error' })
    res.json({ ok: true, id: this.lastID, ts })
  })
})

app.patch('/api/notes/:id', rateLimitWrite, (req, res) => {
  if (!csrfGuard(req, res)) return
  const id = req.params.id
  const { content } = req.body || {}
  if (!id || typeof content !== 'string') return res.status(400).json({ error: 'bad_request' })
  if (!db) { const i = mem.notes.findIndex(n => String(n.id) === String(id)); if (i>=0) mem.notes[i].content = content; return res.json({ ok: true }) }
  db.run('UPDATE notes SET content = ? WHERE id = ?', [content, id], err => {
    if (err) return res.status(500).json({ error: 'db_error' })
    res.json({ ok: true })
  })
})

app.post('/api/notes/:id/pin', rateLimitWrite, (req, res) => {
  if (!csrfGuard(req, res)) return
  const id = req.params.id
  const { pinned } = req.body || {}
  const val = pinned ? 1 : 0
  if (!db) { const i = mem.notes.findIndex(n => String(n.id) === String(id)); if (i>=0) mem.notes[i].pinned = val; return res.json({ ok: true }) }
  db.run('UPDATE notes SET pinned = ? WHERE id = ?', [val, id], err => {
    if (err) return res.status(500).json({ error: 'db_error' })
    res.json({ ok: true })
  })
})

app.delete('/api/notes/:id', rateLimitWrite, (req, res) => {
  if (!csrfGuard(req, res)) return
  const id = req.params.id
  if (!id) return res.status(400).json({ error: 'bad_request' })
  if (!db) { mem.notes = mem.notes.filter(n => String(n.id) !== String(id)); return res.json({ ok: true }) }
  db.run('DELETE FROM notes WHERE id = ?', [id], err => {
    if (err) return res.status(500).json({ error: 'db_error' })
    res.json({ ok: true })
  })
})

const onlinePhones = new Map()

const socketBuckets = new Map()
function socketLimit(socket, key, opts) {
  try {
    const windowMs = Math.max(1000, Number((opts && opts.windowMs) || 60000))
    const role = (socket.data && socket.data.role) || 'customer'
    const max = role === 'agent' ? Number((opts && opts.agentMax) || 120) : Number((opts && opts.customerMax) || 30)
    const id = socket.id
    const bk = `${id}:${key}`
    const now = Date.now()
    const b = socketBuckets.get(bk)
    if (!b || now > b.reset) { socketBuckets.set(bk, { reset: now + windowMs, count: 1 }); return true }
    if (b.count >= max) { try { socket.emit('rate_limited', { key }) } catch {} ; return false }
    b.count += 1; return true
  } catch { return true }
}

io.on('connection', socket => {
  try { /* minimal connection log */ } catch {}
  socket.on('join', ({ phone }) => {
    if (!socketLimit(socket, 'join', { windowMs: 60000, customerMax: 5, agentMax: 30 })) return
    if (!phone) return
    const role = (socket.data && socket.data.role) === 'agent' ? 'agent' : 'customer'
    if (role === 'agent') {
      if (!db) {
        // allow all agents in memory mode
      } else {
        try {
          const allowAll = String(process.env.IM_AGENT_ALLOW_ALL || '').trim() === '1'
          const allowed = db.prepare('SELECT phone FROM agent_acl WHERE phone = ?').get(String(phone))
          if (!allowAll && !allowed) return
        } catch (_) { return }
      }
    }
    if (role === 'customer' && socket.data && socket.data.phone && socket.data.phone !== phone) return
    socket.join(phone)
    socket.data = { phone, role }
    if (role === 'customer') {
      const c = onlinePhones.get(phone) || 0
      onlinePhones.set(phone, c + 1)
      io.to(phone).emit('presence', { phone, online: true })
      const ip = (socket.handshake.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || socket.handshake.address || ''
      resolveCountry(ip).then(country => {
        if (country) db.run('INSERT INTO users (phone, country) VALUES (?, ?) ON CONFLICT(phone) DO UPDATE SET country=excluded.country', [phone, country])
      }).catch(() => {})
    }
  })
  socket.on('message', payload => {
    if (!socketLimit(socket, 'message', { windowMs: 60000, customerMax: 30, agentMax: 120 })) return
    const { phone, sender, content, type, reply_to } = payload || {}
    if (!phone || !content) return
    if ((socket.data && socket.data.role) === 'customer' && (socket.data && socket.data.phone) && socket.data.phone !== phone) return
    const ts = Date.now()
    const ip = (socket.handshake.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || socket.handshake.address || ''
    const isCustomer = (sender || 'customer') === 'customer'
    const p = isCustomer ? resolveCountry(ip) : Promise.resolve(null)
    p.then(country => {
      if (!db) {
        const m = { id: mem.nextId++, phone, sender: sender || 'customer', content, ts, type: type || null, reply_to: reply_to || null, ip: isCustomer ? ip : null, country: isCustomer ? (country || null) : null }
        mem.messages.push(m); saveMem()
        const payload = { id: m.id, phone, sender: m.sender, content, ts, type: m.type, reply_to: m.reply_to }
        io.to(phone).emit('message', payload)
        return
      }
      db.run('INSERT INTO messages (phone, sender, content, ts, type, reply_to, ip, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [phone, sender || 'customer', content, ts, type || null, reply_to || null, isCustomer ? ip : null, isCustomer ? (country || null) : null], function (err) {
        if (err) return
        if (isCustomer && country) db.run('INSERT INTO users (phone, country) VALUES (?, ?) ON CONFLICT(phone) DO UPDATE SET country=excluded.country', [phone, country])
        const payload = { id: this.lastID, phone, sender: sender || 'customer', content, ts, type: type || null, reply_to: reply_to || null }
        io.to(phone).emit('message', payload)
      })
    })
  })
  socket.on('recall', payload => {
    if (!socketLimit(socket, 'recall', { windowMs: 60000, customerMax: 10, agentMax: 60 })) return
    const { phone, id, by } = payload || {}
    if (!phone || !id) return
    if ((socket.data && socket.data.role) === 'customer' && (socket.data && socket.data.phone) && socket.data.phone !== phone) return
    if (!db) {
      const idx = mem.messages.findIndex(m => String(m.id) === String(id) && m.phone === phone)
      if (idx < 0) return
      const row = mem.messages[idx]
      if (by === 'customer') { mem.messages[idx] = { ...row, type: 'recall' }; io.to(phone).emit('recalled', { phone, id, by: 'customer', content: row.content }) }
      else { mem.messages.splice(idx,1); io.to(phone).emit('recalled', { phone, id, by: 'agent' }) }
      saveMem()
      return
    }
    db.get('SELECT id, content FROM messages WHERE id = ? AND phone = ?', [id, phone], (err, row) => {
      if (err || !row) return
      if (by === 'customer') {
        db.run('UPDATE messages SET type = ? WHERE id = ?', ['recall', id], () => {
          io.to(phone).emit('recalled', { phone, id, by: 'customer', content: row.content })
        })
      } else {
        db.run('DELETE FROM messages WHERE id = ?', [id], () => {
          io.to(phone).emit('recalled', { phone, id, by: 'agent' })
        })
      }
    })
  })
  socket.on('seen', payload => {
    if (!socketLimit(socket, 'seen', { windowMs: 60000, customerMax: 60, agentMax: 120 })) return
    const { phone } = payload || {}
    if (!phone) return
    if ((socket.data && socket.data.role) === 'customer' && (socket.data && socket.data.phone) && socket.data.phone !== phone) return
    const v = Date.now()
    if (!db) { mem.seen.set(phone, v); io.to(phone).emit('read-status', { phone, last_seen_ts: v }); return }
    db.run('INSERT INTO seen (phone, last_seen_ts) VALUES (?, ?) ON CONFLICT(phone) DO UPDATE SET last_seen_ts=excluded.last_seen_ts', [phone, v])
    io.to(phone).emit('read-status', { phone, last_seen_ts: v })
  })
  socket.on('disconnect', () => {
    const d = socket.data || {}
    try { /* minimal disconnect log */ } catch {}
    if (d.role === 'customer' && d.phone) {
      const c = onlinePhones.get(d.phone) || 0
      const n = Math.max(0, c - 1)
      if (n === 0) onlinePhones.delete(d.phone); else onlinePhones.set(d.phone, n)
      io.to(d.phone).emit('presence', { phone: d.phone, online: n > 0 })
    }
  })
})

function recomputeOnlinePhones() {
  try {
    const counts = new Map()
    for (const s of io.sockets.sockets.values()) {
      const d = s.data || {}
      if (d.role === 'customer' && d.phone) {
        counts.set(d.phone, (counts.get(d.phone) || 0) + 1)
      }
    }
    onlinePhones.clear()
    for (const [k, v] of counts.entries()) onlinePhones.set(k, v)
  } catch {}
}
try { setInterval(recomputeOnlinePhones, 30000) } catch {}

const port = process.env.PORT || 3000
server.listen(port, () => {})
function encryptSnapshot() {
  try {
    const keyHex = String(process.env.IM_DB_ENC_KEY || '').trim()
    if (!keyHex || keyHex.length !== 64) return
    const ts = new Date().toISOString().replace(/[-:]/g,'').replace('T','').slice(0,14)
    const src = dbPath
    const dst = path.join(dataDir, `chat.snap.${ts}.db.enc`)
    const iv = require('crypto').randomBytes(12)
    const key = Buffer.from(keyHex, 'hex')
    const cipher = require('crypto').createCipheriv('aes-256-gcm', key, iv)
    const data = fs.readFileSync(src)
    const enc = Buffer.concat([cipher.update(data), cipher.final()])
    const tag = cipher.getAuthTag()
    fs.writeFileSync(dst, Buffer.concat([iv, enc, tag]))
  } catch (_) {}
}
try { setInterval(encryptSnapshot, 60*60*1000) } catch (_) {}
app.get('/api/health', (req, res) => {
  try {
    res.json({ ok: true, status: 'healthy', port: Number(port), tokenEnabled: !!IM_TOKEN })
  } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }) }
})
app.get('/api/version', (req, res) => {
  res.json({ ok: true, name: 'im-main', version: '0.1.0', port: Number(port) })
})
function translateDeepL(text) {
  return new Promise((resolve) => {
    try {
      const key = String(process.env.DEEPL_AUTH_KEY || '').trim()
      if (!key) return resolve({ ok: false })
      const host = /:fx$/i.test(key) ? 'api-free.deepl.com' : 'api.deepl.com'
      const payload = 'text=' + encodeURIComponent(text) + '&target_lang=ZH'
      const https = require('https')
      const opt = { method: 'POST', hostname: host, port: 443, path: '/v2/translate', headers: { 'Authorization': 'DeepL-Auth-Key ' + key, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(payload) } }
      const rq = https.request(opt, r => { let data=''; r.on('data', d=>data+=d); r.on('end', ()=>{ try { const o = JSON.parse(data||'{}'); const t = o && o.translations && o.translations[0] && o.translations[0].text || ''; const dlang = o && o.translations && o.translations[0] && o.translations[0].detected_source_language || ''; resolve({ ok: !!t, text: t, detected: dlang }) } catch { resolve({ ok: false }) } }) })
      rq.setTimeout(6000, () => { try { rq.destroy(new Error('timeout')) } catch {} ; resolve({ ok: false }) })
      rq.on('error', () => resolve({ ok: false }))
      rq.write(payload); rq.end()
    } catch { resolve({ ok: false }) }
  })
}
function translateMyMemory(text) {
  return new Promise((resolve) => {
    try {
      const https = require('https')
      const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=en%7Czh-CN'
      https.get(url, r => { let data=''; r.on('data', d=>data+=d); r.on('end', ()=>{ try { const o = JSON.parse(data||'{}'); const t = o && o.responseData && o.responseData.translatedText || ''; const dlang = o && o.responseData && o.responseData.detectedSourceLanguage || ''; resolve({ ok: !!t, text: t, detected: dlang || '' }) } catch { resolve({ ok: false }) } }) }).on('error', () => resolve({ ok: false }))
    } catch { resolve({ ok: false }) }
  })
}
function translateGoogle(text) {
  return new Promise((resolve) => {
    try {
      const https = require('https')
      const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=' + encodeURIComponent(text)
      https.get(url, r => { let data=''; r.on('data', d=>data+=d); r.on('end', ()=>{ try { const o = JSON.parse(data||'[]'); const t = o && o[0] && o[0][0] && o[0][0][0] || ''; const dlang = o && o[2] || ''; resolve({ ok: !!t, text: t, detected: dlang || '' }) } catch { resolve({ ok: false }) } }) }).on('error', () => resolve({ ok: false }))
    } catch { resolve({ ok: false }) }
  })
}
async function translateSmart(text) {
  const r1 = await translateDeepL(text)
  if (r1 && r1.ok) return r1
  const r2 = await translateMyMemory(text)
  if (r2 && r2.ok) return r2
  const r3 = await translateGoogle(text)
  if (r3 && r3.ok) return r3
  return { ok: false }
}
app.post('/api/translate', rateLimitWrite, async (req, res) => {
  if (!csrfGuard(req, res)) return
  try {
    const text = String((req.body && req.body.text) || '').trim()
    if (!text) return res.status(400).json({ error: 'bad_request' })
    const r = await translateSmart(text)
    if (!r || !r.ok) return res.status(502).json({ error: 'translate_failed' })
    res.json({ ok: true, translated: r.text || '', detected_lang: r.detected || '' })
  } catch (_) { return res.status(500).json({ error: 'server_error' }) }
})
app.post('/api/upload', rateLimitUpload, upload.single('file'), (req, res) => {
  if (!csrfGuard(req, res)) return
  if (!req.file) return res.status(400).json({ error: 'no_file' })
  const src = path.join(pendingDir, req.file.filename)
  const dst = path.join(uploadDir, req.file.filename)
  const url = '/uploads/' + req.file.filename
  try {
    const buf = fs.readFileSync(src)
    const sha = require('crypto').createHash('sha256').update(buf).digest('hex')
    db.run('CREATE TABLE IF NOT EXISTS uploads_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, size INTEGER, mime TEXT, sha256 TEXT, ts INTEGER)')
    db.run('INSERT INTO uploads_audit (name, size, mime, sha256, ts) VALUES (?, ?, ?, ?, ?)', [req.file.filename, Number(req.file.size||buf.length), String(req.file.mimetype||''), sha, Date.now()])
    const scanUrl = String(process.env.UPLOAD_SCAN_URL||'').trim()
    if (scanUrl) {
      const payload = JSON.stringify({ name: req.file.filename, size: Number(req.file.size||buf.length), mime: String(req.file.mimetype||''), sha256: sha })
      const http = scanUrl.startsWith('https') ? require('https') : require('http')
      const u = new URL(scanUrl)
      const opt = { method:'POST', hostname:u.hostname, port:u.port|| (u.protocol==='https:'?443:80), path:u.pathname+u.search, headers:{ 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(payload) } }
      let responded = false
      const done = (fn) => { if (!responded) { responded = true; try { fn() } catch {} } }
      const rq = http.request(opt, r => { let data=''; r.on('data', d=>data+=d); r.on('end', ()=>{ try { const obj = JSON.parse(data||'{}'); if (obj && (obj.flagged || obj.ok===false)) { try { fs.unlinkSync(src) } catch {} ; return done(()=>res.status(400).json({ error:'file_flagged' })) } } catch {} ; try { fs.renameSync(src, dst) } catch {} ; return done(()=>res.json({ url })) }) })
      rq.on('timeout', () => { try { rq.destroy(new Error('timeout')) } catch {} ; try { fs.renameSync(src, dst) } catch {} ; done(()=>res.json({ url })) })
      rq.setTimeout(8000)
      rq.on('error', () => { try { fs.renameSync(src, dst) } catch {} ; done(()=>res.json({ url })) })
      rq.write(payload); rq.end();
      return
    }
  } catch (_) {}
  try { fs.renameSync(src, dst) } catch {} ; res.json({ url })
})

function scheduleUploadCleanup() {
  try {
    const days = Number(process.env.IM_UPLOAD_RETENTION_DAYS || 30)
    const keepMs = Math.max(1, days) * 24 * 60 * 60 * 1000
    const run = () => {
      try {
        const now = Date.now()
        const files = fs.readdirSync(uploadDir)
        for (const f of files) {
          try {
            const fp = path.join(uploadDir, f)
            const st = fs.statSync(fp)
            if (st.isFile() && (now - st.mtimeMs) > keepMs) { fs.unlinkSync(fp) }
          } catch (_) {}
        }
      } catch (_) {}
    }
    setInterval(run, 60 * 60 * 1000)
  } catch (_) {}
}
scheduleUploadCleanup()

function resolveCountry(ip) {
  return new Promise((resolve) => {
    if (ip === '::1' || ip === '127.0.0.1') return resolve('本地')
    if (!ip) return resolve('未知')
    try {
      const https = require('https')
      const url = `https://ipapi.co/${encodeURIComponent(ip)}/country_name/`
      https.get(url, r => {
        let data = ''
        r.on('data', chunk => { data += chunk })
        r.on('end', () => {
          const t = (data || '').trim()
          const sc = (/undefined/i.test(t)) ? null : (t || null)
          resolve(sc)
        })
      }).on('error', () => resolve(null))
    } catch (_) {
      resolve(null)
    }
  })
}
// Agent ACL management (requires IM_TOKEN)
app.get('/api/agent/acl', (req, res) => {
  try {
    if (!IM_TOKEN) return res.status(401).json({ error: 'unauthorized' })
    const tHeader = String(req.headers['x-im-token'] || '').trim()
    const tQuery = String((req.query && (req.query.token || req.query['x-im-token'])) || '').trim()
    const t = tHeader || tQuery
    if (!t || t !== IM_TOKEN) return res.status(401).json({ error: 'unauthorized' })
    db.all('SELECT phone FROM agent_acl ORDER BY phone ASC', [], (err, rows) => {
      if (err) return res.status(500).json({ error: 'db_error' })
      res.json({ items: rows.map(r => r.phone) })
    })
  } catch (_) { return res.status(500).json({ error: 'server_error' }) }
})
app.post('/api/agent/acl/add', (req, res) => {
  try {
    const tHeader = String(req.headers['x-im-token'] || '').trim()
    const t = tHeader || ''
    if (!IM_TOKEN || t !== IM_TOKEN) return res.status(401).json({ error: 'unauthorized' })
    const phone = String((req.body && req.body.phone) || '').trim()
    if (!phone) return res.status(400).json({ error: 'bad_request' })
    db.run('INSERT INTO agent_acl (phone) VALUES (?) ON CONFLICT(phone) DO NOTHING', [phone], err => {
      if (err) return res.status(500).json({ error: 'db_error' })
      res.json({ ok: true })
    })
  } catch (_) { return res.status(500).json({ error: 'server_error' }) }
})
app.delete('/api/agent/acl/:phone', (req, res) => {
  try {
    const tHeader = String(req.headers['x-im-token'] || '').trim()
    const t = tHeader || ''
    if (!IM_TOKEN || t !== IM_TOKEN) return res.status(401).json({ error: 'unauthorized' })
    const phone = String(req.params.phone || '').trim()
    if (!phone) return res.status(400).json({ error: 'bad_request' })
    db.run('DELETE FROM agent_acl WHERE phone = ?', [phone], err => {
      if (err) return res.status(500).json({ error: 'db_error' })
      res.json({ ok: true })
    })
  } catch (_) { return res.status(500).json({ error: 'server_error' }) }
})
app.get('/api/agent/tokens', (req, res) => {
  try {
    const tHeader = String(req.headers['x-im-token'] || '').trim()
    if (!IM_TOKEN || tHeader !== IM_TOKEN) return res.status(401).json({ error: 'unauthorized' })
    db.all('SELECT id, name FROM agent_tokens ORDER BY id ASC', [], (err, rows) => {
      if (err) return res.status(500).json({ error: 'db_error' })
      res.json({ items: rows })
    })
  } catch (_) { return res.status(500).json({ error: 'server_error' }) }
})
app.post('/api/agent/tokens', (req, res) => {
  try {
    const tHeader = String(req.headers['x-im-token'] || '').trim()
    if (!IM_TOKEN || tHeader !== IM_TOKEN) return res.status(401).json({ error: 'unauthorized' })
    const name = String((req.body && req.body.name) || '').trim()
    const tok = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
    db.run('INSERT INTO agent_tokens (name, token) VALUES (?, ?)', [name || 'agent', tok], err => {
      if (err) return res.status(500).json({ error: 'db_error' })
      res.json({ ok: true, token: tok })
    })
  } catch (_) { return res.status(500).json({ error: 'server_error' }) }
})
app.delete('/api/agent/tokens/:id', (req, res) => {
  try {
    const tHeader = String(req.headers['x-im-token'] || '').trim()
    if (!IM_TOKEN || tHeader !== IM_TOKEN) return res.status(401).json({ error: 'unauthorized' })
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_request' })
    db.run('DELETE FROM agent_tokens WHERE id = ?', [id], err => {
      if (err) return res.status(500).json({ error: 'db_error' })
      res.json({ ok: true })
    })
  } catch (_) { return res.status(500).json({ error: 'server_error' }) }
})
