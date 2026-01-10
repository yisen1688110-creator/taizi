const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/im.db');

db.serialize(() => {
    db.all("PRAGMA table_info(user_notes)", (err, rows) => {
        if (err) {
            console.error(err);
        } else {
            console.log("user_notes columns:", rows);
        }
    });
});
