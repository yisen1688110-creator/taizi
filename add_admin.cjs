const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const db = new sqlite3.Database('./server/data/app.db');

function hashPassword(pwd) { return bcrypt.hashSync(String(pwd || ''), 12); }

const account = 'super';
const password = 'admin123';
const role = 'super';
const now = new Date().toISOString();

db.serialize(() => {
    db.get("SELECT id FROM users WHERE account = ?", [account], (err, row) => {
        if (err) {
            console.error('Error checking user:', err);
            db.close();
            return;
        }
        if (row) {
            console.log(`User ${account} already exists.`);
            db.close();
        } else {
            const stmt = db.prepare("INSERT INTO users (email, password_hash, name, created_at, updated_at, phone, role, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
            stmt.run(`${account}@admin.local`, hashPassword(password), 'Super Admin 2', now, now, null, role, account, function (err) {
                if (err) {
                    console.error('Error inserting user:', err);
                } else {
                    console.log(`User ${account} added with ID ${this.lastID}`);
                }
                stmt.finalize(() => {
                    db.close();
                });
            });
        }
    });
});
