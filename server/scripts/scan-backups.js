const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const dir = process.env.DB_DIR || '/app/data';
let files = [];
try { files = fs.readdirSync(dir).filter(fn => /^app\.bak\.\d{14}\.db$/.test(fn)).sort(); } catch (e) { console.log(JSON.stringify({ error: String(e) })); }
function countSql(db, sql) { try { const r = db.prepare(sql).get(); if (!r) return 0; if (typeof r.c !== 'undefined') return r.c; const vals = Object.values(r); return vals.length ? (vals[0] || 0) : 0; } catch (_) { return -1; } }
function hasCol(db, t, c) { try { const names = db.prepare('PRAGMA table_info(' + t + ')').all().map(r => String(r.name)); return names.includes(c); } catch (_) { return false; } }
for (const fn of files) {
  const p = path.join(dir, fn);
  let db;
  try { db = new Database(p, { fileMustExist: true, readonly: true }); } catch (e) { console.log(JSON.stringify({ file: fn, error: String(e) })); continue; }
  const out = {
    file: fn,
    users: countSql(db, "SELECT COUNT(1) AS c FROM users WHERE role='customer'"),
    orders: countSql(db, 'SELECT COUNT(1) AS c FROM orders'),
    positions: countSql(db, 'SELECT COUNT(1) AS c FROM positions'),
    funds: countSql(db, 'SELECT COUNT(1) AS c FROM funds'),
    fund_orders: countSql(db, 'SELECT COUNT(1) AS c FROM fund_orders'),
    block_trades: countSql(db, 'SELECT COUNT(1) AS c FROM block_trades'),
    block_trade_orders: countSql(db, 'SELECT COUNT(1) AS c FROM block_trade_orders'),
    ipo_items: countSql(db, 'SELECT COUNT(1) AS c FROM ipo_items'),
    ipo_orders: countSql(db, 'SELECT COUNT(1) AS c FROM ipo_orders'),
    has_subscribe_end_at: hasCol(db, 'ipo_items', 'subscribe_end_at')
  };
  console.log(JSON.stringify(out));
  try { db.close(); } catch (_) {}
}