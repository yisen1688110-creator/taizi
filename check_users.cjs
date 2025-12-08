const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./server/data/app.db');

db.serialize(() => {
    db.all("SELECT id, account, role, phone FROM users", (err, rows) => {
        if (err) {
            console.error(err);
        } else {
            console.log(rows);
        }
    });
});

db.close();
