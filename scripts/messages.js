// Prints contact-form messages: npm run messages
const path = require("path");
const Database = require("better-sqlite3");
const dir = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const db = new Database(path.join(dir, "lifebox.db"), { readonly: true, fileMustExist: true });
const rows = db.prepare("SELECT * FROM messages ORDER BY id DESC").all();
if (!rows.length) console.log("No messages yet.");
for (const m of rows) console.log(`\n#${m.id}  ${m.created_at}\nFrom: ${m.name} <${m.email}>\n${m.message}\n${"-".repeat(50)}`);
