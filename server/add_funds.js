const db = require('better-sqlite3')('./data/app.db');
const now = new Date().toISOString();

const funds = [
  {
    code: 'GQF001',
    name: 'GQ Growth Fund',
    desc: 'High growth fund focusing on tech stocks',
    nav: 1.25,
    minAmount: 1000,
    status: 'active',
    tiers: JSON.stringify([{min:1000,rate:0.08},{min:10000,rate:0.10},{min:50000,rate:0.12}])
  },
  {
    code: 'GQF002',
    name: 'GQ Stable Fund',
    desc: 'Stable fund for asset preservation',
    nav: 1.05,
    minAmount: 500,
    status: 'active',
    tiers: JSON.stringify([{min:500,rate:0.05},{min:5000,rate:0.06},{min:20000,rate:0.07}])
  },
  {
    code: 'GQF003',
    name: 'GQ Crypto Fund',
    desc: 'Crypto fund with high risk high reward',
    nav: 2.50,
    minAmount: 2000,
    status: 'active',
    tiers: JSON.stringify([{min:2000,rate:0.15},{min:20000,rate:0.18},{min:100000,rate:0.22}])
  }
];

for (const f of funds) {
  try {
    db.prepare(`INSERT INTO funds (code, name, description, nav, min_amount, status, tiers, created_at, updated_at) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      f.code, f.name, f.desc, f.nav, f.minAmount, f.status, f.tiers, now, now
    );
    console.log('Added fund:', f.code);
  } catch (e) {
    console.log('Fund exists or error:', f.code, e.message);
  }
}

console.log('Done!');
db.close();
