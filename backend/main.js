"use strict";
const path = require("path");
const crypto = require("crypto");
try { process.loadEnvFile(path.join(__dirname, "..", ".env")); } catch {}
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const nodemailer = require("nodemailer");

const IS_PROD = process.env.NODE_ENV === "production";

/* ---------- Database (PostgreSQL) ---------- */
/* Find the connection string: DATABASE_URL first, otherwise any variable holding a postgres:// URL
   (Vercel's Neon integration can name it POSTGRES_URL, STORAGE_URL, etc.) */
function resolveDatabase() {
  const isPg = (v) => typeof v === "string" && /^postgres(ql)?:\/\//i.test(v.trim());
  for (const k of ["DATABASE_URL", "POSTGRES_URL", "STORAGE_URL", "NEON_URL"]) if (isPg(process.env[k])) return { name: k, url: process.env[k].trim() };
  const all = Object.keys(process.env).filter((k) => isPg(process.env[k])).sort();
  const pooled = all.filter((k) => !/UNPOOL|NON_POOL/i.test(k));
  const k = pooled[0] || all[0];
  return k ? { name: k, url: process.env[k].trim() } : { name: null, url: undefined };
}
const DB = resolveDatabase();
if (!DB.url) console.error("No Postgres connection string found. Add DATABASE_URL in Vercel.");
const pool = new Pool({ connectionString: DB.url, max: 3, idleTimeoutMillis: 10000 });
pool.on("error", (e) => console.error("DB pool error:", e.message));
const query = (text, params) => pool.query(text, params);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users(
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS items(
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'Other',
  purchase_date TEXT, price DOUBLE PRECISION, store TEXT, serial TEXT,
  warranty_expiry TEXT, notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS subscriptions(
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  cycle TEXT NOT NULL DEFAULT 'monthly', next_date TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Other', status TEXT NOT NULL DEFAULT 'active', notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reminders(
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, due_date TEXT NOT NULL, repeat TEXT NOT NULL DEFAULT 'none',
  notes TEXT, done SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS messages(
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL, email TEXT NOT NULL, message TEXT NOT NULL, ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_items_user ON items(user_id);
CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_rem_user ON reminders(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`;
let schemaReady = null;
const ensureSchema = () => (schemaReady ||= pool.query(SCHEMA).catch((e) => { schemaReady = null; throw e; }));

/* ---------- App setup ---------- */
const app = express();
if (process.env.TRUST_PROXY || process.env.VERCEL) app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1);
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
        styleSrc: ["'self'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: IS_PROD ? [] : null,
      },
    },
  })
);
app.use(express.json({ limit: "50kb" }));
app.use((req, res, next) => { req.body = req.body || {}; next(); });

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: "Too many attempts. Try again in a few minutes." } });
const contactLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { error: "Too many messages sent. Please try again later." } });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 240, standardHeaders: true, legacyHeaders: false });
app.use("/api", apiLimiter);
app.use("/api", async (req, res, next) => { await ensureSchema(); next(); });

/* Block cross-site writes: mutating requests must be JSON and same-origin */
app.use("/api", (req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    const origin = req.get("origin");
    if (origin && new URL(origin).host !== req.get("host")) return res.status(403).json({ error: "Cross-origin request blocked." });
  }
  next();
});

/* ---------- Helpers ---------- */
const COOKIE = "lb_session";
const SESSION_DAYS = 30;
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

function parseCookies(header = "") {
  return Object.fromEntries(
    header.split(";").map((c) => c.trim().split(/=(.*)/s).slice(0, 2)).filter((p) => p[0])
  );
}
function setSessionCookie(res, token, maxAgeMs) {
  const parts = [`${COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (IS_PROD) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}
async function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const ms = SESSION_DAYS * 86400000;
  await query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)", [sha(token), userId, Date.now() + ms]);
  setSessionCookie(res, token, ms);
  query("DELETE FROM sessions WHERE expires_at < $1", [Date.now()]).catch(() => {});
}
async function getUser(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const { rows } = await query(
    "SELECT u.id,u.name,u.email,u.currency,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1",
    [sha(token)]
  );
  const row = rows[0];
  if (!row) return null;
  if (Number(row.expires_at) < Date.now()) {
    await query("DELETE FROM sessions WHERE token_hash=$1", [sha(token)]);
    return null;
  }
  return { id: row.id, name: row.name, email: row.email, currency: row.currency };
}
async function requireAuth(req, res, next) {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: "Please log in." });
  req.user = user;
  next();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AUD", "CAD", "AED", "SGD", "JPY"];
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const validDate = (v) => DATE_RE.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z"));

/* ---------- Auth routes ---------- */
app.post("/api/auth/register", authLimiter, async (req, res) => {
  const name = str(req.body.name, 80);
  const email = str(req.body.email, 200).toLowerCase();
  const password = typeof req.body.password === "string" ? req.body.password : "";
  if (!name) return res.status(400).json({ error: "Enter your name." });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (password.length < 8 || password.length > 128) return res.status(400).json({ error: "Password must be 8 to 128 characters." });
  const hash = await bcrypt.hash(password, 12);
  let id;
  try {
    const r = await query("INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id", [name, email, hash]);
    id = r.rows[0].id;
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "An account with this email already exists. Log in instead." });
    throw e;
  }
  await createSession(res, id);
  res.status(201).json({ user: { id, name, email, currency: "INR" } });
});

const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", 12);
app.post("/api/auth/login", authLimiter, async (req, res) => {
  const email = str(req.body.email, 200).toLowerCase();
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const { rows } = await query("SELECT * FROM users WHERE email=$1", [email]);
  const row = rows[0];
  const ok = await bcrypt.compare(password, row ? row.password_hash : DUMMY_HASH);
  if (!row || !ok) return res.status(401).json({ error: "Email or password is incorrect." });
  await createSession(res, row.id);
  res.json({ user: { id: row.id, name: row.name, email: row.email, currency: row.currency } });
});

app.post("/api/auth/logout", async (req, res) => {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) await query("DELETE FROM sessions WHERE token_hash=$1", [sha(token)]);
  setSessionCookie(res, "", 0);
  res.json({ ok: true });
});

app.get("/api/auth/me", async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: "Not logged in." });
  res.json({ user });
});

app.patch("/api/auth/profile", requireAuth, async (req, res) => {
  const name = str(req.body.name, 80);
  const currency = str(req.body.currency, 3).toUpperCase();
  if (!name) return res.status(400).json({ error: "Enter your name." });
  if (!CURRENCIES.includes(currency)) return res.status(400).json({ error: "Choose a supported currency." });
  await query("UPDATE users SET name=$1, currency=$2 WHERE id=$3", [name, currency, req.user.id]);
  res.json({ user: { ...req.user, name, currency } });
});

app.post("/api/auth/password", requireAuth, authLimiter, async (req, res) => {
  const { current, next } = req.body;
  if (typeof current !== "string" || typeof next !== "string") return res.status(400).json({ error: "Fill in both password fields." });
  if (next.length < 8 || next.length > 128) return res.status(400).json({ error: "New password must be 8 to 128 characters." });
  const { rows } = await query("SELECT password_hash FROM users WHERE id=$1", [req.user.id]);
  if (!(await bcrypt.compare(current, rows[0].password_hash))) return res.status(401).json({ error: "Current password is incorrect." });
  await query("UPDATE users SET password_hash=$1 WHERE id=$2", [await bcrypt.hash(next, 12), req.user.id]);
  const token = parseCookies(req.headers.cookie)[COOKIE];
  await query("DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2", [req.user.id, sha(token)]);
  res.json({ ok: true });
});

app.delete("/api/auth/account", requireAuth, authLimiter, async (req, res) => {
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const { rows } = await query("SELECT password_hash FROM users WHERE id=$1", [req.user.id]);
  if (!(await bcrypt.compare(password, rows[0].password_hash))) return res.status(401).json({ error: "Password is incorrect." });
  await query("DELETE FROM users WHERE id=$1", [req.user.id]);
  setSessionCookie(res, "", 0);
  res.json({ ok: true });
});

/* ---------- Data resources ---------- */
const ITEM_CATEGORIES = ["Electronics", "Appliance", "Vehicle", "Furniture", "Document", "Jewellery", "Clothing", "Other"];
const SUB_CATEGORIES = ["Entertainment", "Music", "Software", "Cloud", "News", "Fitness", "Utilities", "Insurance", "Other"];
const CYCLES = ["weekly", "monthly", "quarterly", "yearly"];
const SUB_STATUS = ["active", "paused"];
const REPEATS = ["none", "weekly", "monthly", "yearly"];

const RESOURCES = {
  items: {
    table: "items",
    fields: {
      name: { t: "str", max: 120, req: "Enter a name." },
      category: { t: "enum", values: ITEM_CATEGORIES, def: "Other" },
      purchase_date: { t: "date" },
      price: { t: "num" },
      store: { t: "str", max: 120 },
      serial: { t: "str", max: 120 },
      warranty_expiry: { t: "date" },
      notes: { t: "str", max: 1000 },
    },
  },
  subscriptions: {
    table: "subscriptions",
    fields: {
      name: { t: "str", max: 120, req: "Enter the service name." },
      amount: { t: "num", req: "Enter the amount." },
      cycle: { t: "enum", values: CYCLES, def: "monthly" },
      next_date: { t: "date", req: "Choose the next renewal date." },
      category: { t: "enum", values: SUB_CATEGORIES, def: "Other" },
      status: { t: "enum", values: SUB_STATUS, def: "active" },
      notes: { t: "str", max: 1000 },
    },
  },
  reminders: {
    table: "reminders",
    fields: {
      title: { t: "str", max: 160, req: "Enter a title." },
      due_date: { t: "date", req: "Choose a due date." },
      repeat: { t: "enum", values: REPEATS, def: "none" },
      notes: { t: "str", max: 1000 },
      done: { t: "bool" },
    },
  },
};

function parseBody(spec, body) {
  const out = {};
  for (const [key, f] of Object.entries(spec.fields)) {
    let v = body[key];
    if (f.t === "str") {
      v = str(v, f.max);
      if (!v && f.req) return { error: f.req };
      out[key] = v || null;
    } else if (f.t === "enum") {
      if (v === undefined || v === null || v === "") v = f.def;
      if (!f.values.includes(v)) return { error: `Invalid ${key}.` };
      out[key] = v;
    } else if (f.t === "date") {
      if (v === undefined || v === null || v === "") {
        if (f.req) return { error: f.req };
        out[key] = null;
      } else {
        if (typeof v !== "string" || !validDate(v)) return { error: `Invalid date for ${key}.` };
        out[key] = v;
      }
    } else if (f.t === "num") {
      if (v === undefined || v === null || v === "") {
        if (f.req) return { error: f.req };
        out[key] = null;
      } else {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 1e10) return { error: `Invalid amount for ${key}.` };
        out[key] = n;
      }
    } else if (f.t === "bool") {
      out[key] = v ? 1 : 0;
    }
  }
  return { value: out };
}

for (const [route, spec] of Object.entries(RESOURCES)) {
  const keys = Object.keys(spec.fields);
  const t = spec.table;

  app.post(`/api/${route}`, requireAuth, async (req, res) => {
    const r = parseBody(spec, req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    const count = (await query(`SELECT COUNT(*)::int c FROM ${t} WHERE user_id=$1`, [req.user.id])).rows[0].c;
    if (count >= 2000) return res.status(400).json({ error: "Limit reached for this list." });
    const { rows } = await query(
      `INSERT INTO ${t}(user_id,${keys.join(",")}) VALUES($1,${keys.map((_, i) => `$${i + 2}`).join(",")}) RETURNING *`,
      [req.user.id, ...keys.map((k) => r.value[k])]
    );
    res.status(201).json(rows[0]);
  });

  app.put(`/api/${route}/:id`, requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: "Not found." });
    const r = parseBody(spec, req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    const { rows } = await query(
      `UPDATE ${t} SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(",")} WHERE id=$${keys.length + 1} AND user_id=$${keys.length + 2} RETURNING *`,
      [...keys.map((k) => r.value[k]), id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found." });
    res.json(rows[0]);
  });

  app.delete(`/api/${route}/:id`, requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: "Not found." });
    const r = await query(`DELETE FROM ${t} WHERE id=$1 AND user_id=$2`, [id, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: "Not found." });
    res.json({ ok: true });
  });
}

async function allData(userId) {
  const [items, subscriptions, reminders] = await Promise.all([
    query("SELECT * FROM items WHERE user_id=$1 ORDER BY id DESC", [userId]),
    query("SELECT * FROM subscriptions WHERE user_id=$1 ORDER BY id DESC", [userId]),
    query("SELECT * FROM reminders WHERE user_id=$1 ORDER BY due_date ASC", [userId]),
  ]);
  return { items: items.rows, subscriptions: subscriptions.rows, reminders: reminders.rows };
}
app.get("/api/data", requireAuth, async (req, res) => {
  res.json({ ...(await allData(req.user.id)), meta: { itemCategories: ITEM_CATEGORIES, subCategories: SUB_CATEGORIES, currencies: CURRENCIES } });
});
app.get("/api/export", requireAuth, async (req, res) => {
  res.setHeader("Content-Disposition", 'attachment; filename="lifebox-export.json"');
  res.json({ exportedAt: new Date().toISOString(), user: req.user, ...(await allData(req.user.id)) });
});

/* ---------- Contact form ---------- */
let mailer = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER) {
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}
app.post("/api/contact", contactLimiter, async (req, res) => {
  if (req.body.website) return res.json({ ok: true }); // honeypot: bots fill this in
  const name = str(req.body.name, 80);
  const email = str(req.body.email, 200);
  const message = str(req.body.message, 4000);
  if (!name) return res.status(400).json({ error: "Enter your name." });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (message.length < 5) return res.status(400).json({ error: "Write a short message." });
  await query("INSERT INTO messages(name,email,message,ip) VALUES($1,$2,$3,$4)", [name, email, message, req.ip]);
  if (mailer && process.env.OWNER_EMAIL) {
    // must finish before responding: serverless functions freeze once the response is sent
    try {
      await mailer.sendMail({
        from: process.env.MAIL_FROM || process.env.SMTP_USER,
        to: process.env.OWNER_EMAIL,
        replyTo: `"${name.replace(/["\r\n]/g, "")}" <${email}>`,
        subject: `LifeBox contact: ${name.replace(/[\r\n]/g, " ")}`,
        text: `From: ${name} <${email}>\n\n${message}`,
      });
    } catch (e) { console.error("Contact email failed:", e.message); }
  }
  res.status(201).json({ ok: true });
});

app.get("/api/admin/messages", async (req, res) => {
  const token = process.env.ADMIN_TOKEN;
  const given = req.get("x-admin-token") || "";
  const ok = token && given.length === token.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token));
  if (!ok) return res.status(401).json({ error: "Unauthorized." });
  res.json((await query("SELECT * FROM messages ORDER BY id DESC LIMIT 500")).rows);
});

/* ---------- Static files (Vercel serves /public itself; this is for local use) ---------- */
app.use(express.static(path.join(__dirname, "..", "public"), { extensions: ["html"] }));
app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid request." });
  console.error(err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

module.exports = app;
