"use strict";

/* ============ Helpers ============ */
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
  bell: '<path d="M6 16V11a6 6 0 0112 0v5l2 2H4z"/><path d="M10 21a2 2 0 004 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  refresh: '<path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
};
const icon = (n) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;

const state = { user: null, items: [], subscriptions: [], reminders: [], meta: {}, q: "", cat: "all", remFilter: "all" };

const pad = (n) => String(n).padStart(2, "0");
const parseD = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
let TODAY = new Date(); TODAY = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate());
const daysTo = (s) => Math.round((parseD(s) - TODAY) / 86400000);
const fmtDate = (s) => (s ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(parseD(s)) : "—");

function addMonths(d, n) {
  const day = d.getDate();
  const r = new Date(d.getFullYear(), d.getMonth() + n, 1);
  r.setDate(Math.min(day, new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate()));
  return r;
}
function addCycle(d, cycle) {
  if (cycle === "weekly") return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7);
  return addMonths(d, { monthly: 1, quarterly: 3, yearly: 12 }[cycle] || 1);
}
function rel(d) {
  if (d < 0) return d === -1 ? "yesterday" : `${-d} days ago`;
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d <= 60) return `in ${d} days`;
  if (d < 730) return `in ${Math.round(d / 30.4)} months`;
  return `in ${(d / 365).toFixed(1)} years`;
}
const money = (n) => {
  const cur = state.user?.currency || "INR";
  return new Intl.NumberFormat(cur === "INR" ? "en-IN" : undefined, { style: "currency", currency: cur, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n || 0);
};
const CYCLE_FACTOR = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };
const monthlyCost = (s) => s.amount * (CYCLE_FACTOR[s.cycle] || 1);
function nextRenewal(s) {
  let d = parseD(s.next_date);
  let guard = 0;
  while (d < TODAY && guard++ < 5000) d = addCycle(d, s.cycle);
  return iso(d);
}
const PER = { weekly: "week", monthly: "month", quarterly: "3 months", yearly: "year" };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

async function api(url, method = "GET", body) {
  let res;
  try {
    res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
  } catch {
    throw new Error("Can't reach the server. Check your connection and try again.");
  }
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401 && !url.startsWith("/api/auth/password") && !url.startsWith("/api/auth/account") && !url.startsWith("/api/auth/login")) { location.href = "/?login=1"; throw new Error("Please log in."); }
  if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

function toast(msg, type = "") {
  const t = document.createElement("div");
  t.className = "toast " + type;
  t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), 3800);
}

/* ============ Sheet (modal) ============ */
let lastFocus = null;
function openSheet(html) {
  lastFocus = document.activeElement;
  $("#sheet").innerHTML = html;
  $("#sheetBackdrop").hidden = false;
  document.body.style.overflow = "hidden";
  const first = $("#sheet input:not([type=hidden]), #sheet select, #sheet textarea, #sheet button.btn");
  setTimeout(() => first && first.focus({ preventScroll: true }), 30);
}
function closeSheet() {
  $("#sheetBackdrop").hidden = true;
  $("#sheet").innerHTML = "";
  document.body.style.overflow = "";
  if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
}
$("#sheetBackdrop").addEventListener("mousedown", (e) => { if (e.target.id === "sheetBackdrop") closeSheet(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#sheetBackdrop").hidden) closeSheet(); });

function confirmDialog({ title, message, confirmLabel = "Delete" }) {
  return new Promise((resolve) => {
    openSheet(`<h2 id="sheetTitle">${esc(title)}</h2><p class="sub">${esc(message)}</p>
      <div class="form-actions"><button class="btn btn-danger" data-yes type="button">${esc(confirmLabel)}</button><button class="btn btn-ghost" data-no type="button">Cancel</button></div>`);
    $("#sheet [data-yes]").onclick = () => { closeSheet(); resolve(true); };
    $("#sheet [data-no]").onclick = () => { closeSheet(); resolve(false); };
  });
}

function fieldHTML(f, v) {
  const val = v ?? f.def ?? "";
  const id = "f_" + f.name;
  let control;
  if (f.type === "select") {
    control = `<select id="${id}" name="${f.name}">${f.options.map(([value, label]) => `<option value="${esc(value)}" ${String(val) === String(value) ? "selected" : ""}>${esc(label)}</option>`).join("")}</select>`;
  } else if (f.type === "textarea") {
    control = `<textarea id="${id}" name="${f.name}" maxlength="1000" placeholder="${esc(f.placeholder || "")}">${esc(val)}</textarea>`;
  } else {
    control = `<input id="${id}" name="${f.name}" type="${f.type}" value="${esc(val)}" ${f.type === "number" ? 'step="0.01" min="0" inputmode="decimal"' : ""} ${f.type === "text" ? 'maxlength="160"' : ""} ${f.required ? "required" : ""} placeholder="${esc(f.placeholder || "")}">`;
  }
  return `<label class="field ${f.full ? "full" : ""}" for="${id}">${esc(f.label)}${control}${f.hint ? `<small>${esc(f.hint)}</small>` : ""}</label>`;
}

function openForm({ title, sub = "", fields, values = {}, submitLabel = "Save", onSubmit, onDelete }) {
  openSheet(`<h2 id="sheetTitle">${esc(title)}</h2>${sub ? `<p class="sub">${esc(sub)}</p>` : ""}
    <form id="sheetForm" novalidate>
      <div class="form-grid">${fields.map((f) => fieldHTML(f, values[f.name])).join("")}</div>
      <p class="form-error" id="formError" role="alert"></p>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">${esc(submitLabel)}</button>
        <button class="btn btn-ghost" type="button" data-cancel>Cancel</button>
        ${onDelete ? '<button class="btn btn-danger" type="button" data-delete>Delete</button>' : ""}
      </div>
    </form>`);
  const form = $("#sheetForm");
  $("[data-cancel]", form).onclick = closeSheet;
  if (onDelete) $("[data-delete]", form).onclick = onDelete;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const missing = fields.find((f) => f.required && !String(data[f.name] || "").trim());
    const err = $("#formError");
    if (missing) { err.textContent = `${missing.label} is required.`; $(`[name=${missing.name}]`, form).focus(); return; }
    const btn = $("button[type=submit]", form);
    btn.disabled = true; err.textContent = "";
    try { await onSubmit(data); closeSheet(); }
    catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  };
}

/* ============ Forms config ============ */
const opts = (arr) => arr.map((x) => [x, x]);
const itemFields = () => [
  { name: "name", label: "Name", type: "text", required: true, full: true, placeholder: "e.g. Samsung TV, Passport" },
  { name: "category", label: "Category", type: "select", options: opts(state.meta.itemCategories), def: "Other" },
  { name: "price", label: `Price (${state.user.currency})`, type: "number" },
  { name: "purchase_date", label: "Purchase date", type: "date" },
  { name: "warranty_expiry", label: "Warranty or expiry date", type: "date", hint: "Leave empty if it has none." },
  { name: "store", label: "Bought from", type: "text" },
  { name: "serial", label: "Serial or ID number", type: "text" },
  { name: "notes", label: "Notes", type: "textarea", full: true, placeholder: "Invoice number, support phone, where the receipt is kept" },
];
const subFields = () => [
  { name: "name", label: "Service", type: "text", required: true, full: true, placeholder: "e.g. Netflix, iCloud" },
  { name: "amount", label: `Amount (${state.user.currency})`, type: "number", required: true },
  { name: "cycle", label: "Billing cycle", type: "select", options: [["weekly", "Weekly"], ["monthly", "Monthly"], ["quarterly", "Every 3 months"], ["yearly", "Yearly"]], def: "monthly" },
  { name: "next_date", label: "Next renewal date", type: "date", required: true },
  { name: "category", label: "Category", type: "select", options: opts(state.meta.subCategories), def: "Other" },
  { name: "status", label: "Status", type: "select", options: [["active", "Active"], ["paused", "Paused"]], def: "active" },
  { name: "notes", label: "Notes", type: "textarea", full: true },
];
const reminderFields = () => [
  { name: "title", label: "What do you need to remember?", type: "text", required: true, full: true, placeholder: "e.g. Renew car insurance" },
  { name: "due_date", label: "Due date", type: "date", required: true },
  { name: "repeat", label: "Repeats", type: "select", options: [["none", "Does not repeat"], ["weekly", "Every week"], ["monthly", "Every month"], ["yearly", "Every year"]], def: "none" },
  { name: "notes", label: "Notes", type: "textarea", full: true },
];

/* ============ Data actions ============ */
const listOf = (kind) => state[kind];
async function saveRecord(kind, existing, data, extra = {}) {
  const body = { ...data, ...extra };
  if (existing) {
    const rec = await api(`/api/${kind}/${existing.id}`, "PUT", body);
    state[kind] = state[kind].map((x) => (x.id === rec.id ? rec : x));
  } else {
    const rec = await api(`/api/${kind}`, "POST", body);
    state[kind] = [rec, ...state[kind]];
  }
  if (kind === "reminders") state.reminders.sort((a, b) => a.due_date.localeCompare(b.due_date));
  render();
}
async function deleteRecord(kind, id, label) {
  const ok = await confirmDialog({ title: `Delete ${label}?`, message: "This can't be undone." });
  if (!ok) return;
  try { await api(`/api/${kind}/${id}`, "DELETE"); state[kind] = state[kind].filter((x) => x.id !== id); render(); toast("Deleted."); }
  catch (e) { toast(e.message, "error"); }
}
const findRec = (kind, id) => listOf(kind).find((x) => x.id === Number(id));

function itemForm(item, presetWarranty) {
  openForm({
    title: item ? "Edit belonging" : "Add belonging",
    sub: presetWarranty && !item ? "Add a warranty or expiry date so LifeBox can remind you." : "",
    fields: itemFields(), values: item || {}, submitLabel: item ? "Save changes" : "Add belonging",
    onSubmit: async (d) => { await saveRecord("items", item, d); toast(item ? "Saved." : "Belonging added."); },
    onDelete: item ? async () => { closeSheet(); await deleteRecord("items", item.id, `"${item.name}"`); } : null,
  });
}
function subForm(sub) {
  openForm({
    title: sub ? "Edit subscription" : "Add subscription", fields: subFields(),
    values: sub ? { ...sub, next_date: sub.next_date } : { next_date: iso(addCycle(TODAY, "monthly")) },
    submitLabel: sub ? "Save changes" : "Add subscription",
    onSubmit: async (d) => { await saveRecord("subscriptions", sub, d); toast(sub ? "Saved." : "Subscription added."); },
    onDelete: sub ? async () => { closeSheet(); await deleteRecord("subscriptions", sub.id, `"${sub.name}"`); } : null,
  });
}
function reminderForm(rem) {
  openForm({
    title: rem ? "Edit reminder" : "Add reminder", fields: reminderFields(),
    values: rem || { due_date: iso(TODAY) }, submitLabel: rem ? "Save changes" : "Add reminder",
    onSubmit: async (d) => { await saveRecord("reminders", rem, d, { done: rem ? rem.done : 0 }); toast(rem ? "Saved." : "Reminder added."); },
    onDelete: rem ? async () => { closeSheet(); await deleteRecord("reminders", rem.id, `"${rem.title}"`); } : null,
  });
}

async function completeReminder(rem) {
  try {
    const base = { title: rem.title, due_date: rem.due_date, repeat: rem.repeat, notes: rem.notes };
    if (rem.repeat !== "none") {
      let d = addCycle(parseD(rem.due_date), rem.repeat);
      while (d < TODAY) d = addCycle(d, rem.repeat);
      await saveRecord("reminders", rem, { ...base, due_date: iso(d) }, { done: 0 });
      toast(`Done. Next reminder on ${fmtDate(iso(d))}.`);
    } else {
      await saveRecord("reminders", rem, base, { done: 1 });
      toast("Marked as done.");
    }
  } catch (e) { toast(e.message, "error"); }
}
async function undoReminder(rem) {
  try { await saveRecord("reminders", rem, { title: rem.title, due_date: rem.due_date, repeat: rem.repeat, notes: rem.notes }, { done: 0 }); }
  catch (e) { toast(e.message, "error"); }
}
async function updateSub(sub, changes, msg) {
  try {
    const base = { name: sub.name, amount: sub.amount, cycle: sub.cycle, next_date: sub.next_date, category: sub.category, status: sub.status, notes: sub.notes };
    await saveRecord("subscriptions", sub, { ...base, ...changes });
    if (msg) toast(msg);
  } catch (e) { toast(e.message, "error"); }
}
const paySub = (sub) => {
  const next = iso(addCycle(parseD(nextRenewal(sub)), sub.cycle));
  return updateSub(sub, { next_date: next }, `Marked as paid. Next renewal ${fmtDate(next)}.`);
};

/* ============ Derived data ============ */
function warrantyState(days) {
  if (days < 0) return { cls: "bad", label: "Expired" };
  if (days <= 30) return { cls: "warn", label: `Ends ${rel(days)}` };
  return { cls: "ok", label: "Active" };
}
function buildEvents() {
  const ev = [];
  state.reminders.filter((r) => !r.done).forEach((r) => ev.push({ kind: "reminders", id: r.id, title: r.title, date: r.due_date, days: daysTo(r.due_date), color: "blue", ico: "bell", meta: r.repeat !== "none" ? `Repeats ${r.repeat}` : "Reminder", rec: r }));
  state.items.filter((i) => i.warranty_expiry).forEach((i) => {
    const days = daysTo(i.warranty_expiry);
    if (days >= -14) ev.push({ kind: "items", id: i.id, title: i.name, date: i.warranty_expiry, days, color: "orange", ico: "shield", meta: i.category === "Document" ? "Expires" : "Warranty ends", rec: i });
  });
  state.subscriptions.filter((s) => s.status === "active").forEach((s) => {
    const date = nextRenewal(s);
    ev.push({ kind: "subscriptions", id: s.id, title: s.name, date, days: daysTo(date), color: "purple", ico: "card", meta: `Renews · ${money(s.amount)}`, rec: s });
  });
  return ev.sort((a, b) => a.date.localeCompare(b.date));
}
const dayChip = (days, kind) => {
  if (days < 0) return `<span class="chip bad">${kind === "items" ? "Expired" : "Overdue"} ${rel(days)}</span>`;
  if (days === 0) return '<span class="chip warn">Today</span>';
  if (days <= 7) return `<span class="chip warn">${cap(rel(days))}</span>`;
  return `<span class="chip info">${cap(rel(days))}</span>`;
};

/* ============ Views ============ */
const ROUTES = [
  { id: "overview", label: "Overview", short: "Home", icon: "home", title: "Overview" },
  { id: "belongings", label: "Belongings", short: "Items", icon: "box", title: "Belongings", add: "Add belonging" },
  { id: "warranties", label: "Warranties", short: "Warranty", icon: "shield", title: "Warranties", add: "Add warranty" },
  { id: "subscriptions", label: "Subscriptions", short: "Subs", icon: "card", title: "Subscriptions", add: "Add subscription" },
  { id: "reminders", label: "Reminders", short: "Alerts", icon: "bell", title: "Reminders", add: "Add reminder" },
  { id: "settings", label: "Settings", title: "Settings" },
];
const currentRoute = () => (ROUTES.find((r) => r.id === location.hash.slice(1)) || ROUTES[0]).id;
const ADD_ACTIONS = { belongings: () => itemForm(), warranties: () => itemForm(null, true), subscriptions: () => subForm(), reminders: () => reminderForm() };

function emptyState(title, text, btn, action) {
  return `<div class="empty"><h3>${esc(title)}</h3><p>${esc(text)}</p><button class="btn btn-primary" data-action="${action}" type="button">${icon("plus")} ${esc(btn)}</button></div>`;
}

function viewOverview() {
  const ev = buildEvents();
  const overdue = ev.filter((e) => e.days < 0 && e.kind !== "items").length;
  const due30 = ev.filter((e) => e.days >= 0 && e.days <= 30).length;
  const activeSubs = state.subscriptions.filter((s) => s.status === "active");
  const monthly = activeSubs.reduce((t, s) => t + monthlyCost(s), 0);
  const withW = state.items.filter((i) => i.warranty_expiry);
  const hr = new Date().getHours();
  const hello = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
  const dateStr = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" }).format(TODAY);
  const nothing = !state.items.length && !state.subscriptions.length && !state.reminders.length;

  const upcoming = ev.filter((e) => e.days >= -14).slice(0, 6);
  const cats = {};
  activeSubs.forEach((s) => (cats[s.category] = (cats[s.category] || 0) + monthlyCost(s)));
  const catRows = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  const maxCat = catRows[0]?.[1] || 1;
  const wc = { ok: 0, warn: 0, bad: 0 };
  withW.forEach((i) => wc[warrantyState(daysTo(i.warranty_expiry)).cls]++);

  return `
  <div class="greeting"><h2>${hello}, ${esc(state.user.name.split(" ")[0])}</h2><p>${esc(dateStr)}${overdue ? ` · ${overdue} overdue` : due30 ? ` · ${due30} due in the next 30 days` : " · Nothing due soon"}</p></div>
  <div class="quick">
    <button class="btn btn-primary" data-action="add-item" type="button">${icon("plus")} Belonging</button>
    <button class="btn btn-ghost" data-action="add-sub" type="button">${icon("plus")} Subscription</button>
    <button class="btn btn-ghost" data-action="add-reminder" type="button">${icon("plus")} Reminder</button>
  </div>
  <div class="stats">
    <div class="stat"><small>Belongings</small><strong>${state.items.length}</strong><span>${withW.length} with a warranty or expiry date</span></div>
    <div class="stat"><small>Monthly spend</small><strong>${money(monthly)}</strong><span>${money(monthly * 12)} a year · ${activeSubs.length} active</span></div>
    <div class="stat ${due30 ? "alert" : ""}"><small>Due in 30 days</small><strong>${due30}</strong><span>${overdue ? `${overdue} overdue` : "Nothing overdue"}</span></div>
    <div class="stat ${wc.warn + wc.bad ? "alert" : ""}"><small>Warranties needing attention</small><strong>${wc.warn + wc.bad}</strong><span>${wc.bad} expired · ${wc.warn} ending soon</span></div>
  </div>
  ${nothing ? `<div class="panel">${emptyState("Your LifeBox is empty", "Start with something you own, a subscription you pay for, or a date you can't afford to miss.", "Add your first belonging", "add-item")}</div>` : `
  <div class="grid-2">
    <div class="panel">
      <div class="panel-head"><h3>Coming up</h3><button class="btn btn-ghost btn-small" data-route="reminders" type="button">See all</button></div>
      ${upcoming.length ? `<div class="rows">${upcoming.map(eventRow).join("")}</div>` : '<p class="sub">Nothing coming up. Add warranty dates, subscriptions or reminders to see them here.</p>'}
    </div>
    <div class="stack">
      <div class="panel"><div class="panel-head"><h3>Spending by category</h3></div>
        ${catRows.length ? catRows.map(([c, v]) => `<div class="bar-row"><span>${esc(c)}</span><div class="meter"><i data-w="${Math.max(4, (v / maxCat) * 100)}"></i></div><b>${money(v)}</b></div>`).join("") : '<p class="sub">Add a subscription to see where your money goes each month.</p>'}
      </div>
      <div class="panel"><div class="panel-head"><h3>Warranty health</h3><button class="btn btn-ghost btn-small" data-route="warranties" type="button">Open</button></div>
        <div class="card-tags"><span class="chip ok">${wc.ok} active</span><span class="chip warn">${wc.warn} ending soon</span><span class="chip bad">${wc.bad} expired</span></div>
      </div>
    </div>
  </div>`}`;
}

function eventRow(e) {
  const actions = e.kind === "reminders"
    ? `<button class="icon-btn" data-action="done-reminder" data-id="${e.id}" aria-label="Mark done" title="Mark done" type="button">${icon("check")}</button><button class="icon-btn" data-action="open-event" data-kind="${e.kind}" data-id="${e.id}" aria-label="Edit" title="Edit" type="button">${icon("edit")}</button>`
    : e.kind === "subscriptions"
      ? `<button class="icon-btn" data-action="pay-sub" data-id="${e.id}" aria-label="Mark paid" title="Mark paid" type="button">${icon("refresh")}</button><button class="icon-btn" data-action="open-event" data-kind="${e.kind}" data-id="${e.id}" aria-label="Edit" title="Edit" type="button">${icon("edit")}</button>`
      : `<button class="icon-btn" data-action="open-event" data-kind="${e.kind}" data-id="${e.id}" aria-label="Edit" title="Edit" type="button">${icon("edit")}</button>`;
  return `<div class="row"><span class="row-icon ${e.color}">${icon(e.ico)}</span>
    <div class="row-body"><div class="row-title">${esc(e.title)}</div><div class="row-meta">${esc(e.meta)} · ${fmtDate(e.date)}</div></div>
    ${dayChip(e.days, e.kind)}<div class="row-actions">${actions}</div></div>`;
}

function itemCard(i) {
  const days = i.warranty_expiry ? daysTo(i.warranty_expiry) : null;
  const ws = days !== null ? warrantyState(days) : null;
  if (ws && days >= 0 && days <= 30 && i.category === "Document") ws.label = `Expires ${rel(days)}`;
  let meter = "";
  if (i.warranty_expiry && i.purchase_date) {
    const total = parseD(i.warranty_expiry) - parseD(i.purchase_date);
    if (total > 0) {
      const pct = Math.min(100, Math.max(0, ((TODAY - parseD(i.purchase_date)) / total) * 100));
      meter = `<div class="meter ${ws.cls === "ok" ? "" : ws.cls}" title="${Math.round(pct)}% of warranty used"><i data-w="${pct}"></i></div>`;
    }
  }
  return `<article class="card">
    <div class="card-top"><div><h3>${esc(i.name)}</h3><div class="card-tags"><span class="chip">${esc(i.category)}</span>${ws ? `<span class="chip ${ws.cls}">${esc(ws.label)}</span>` : ""}</div></div>
    <div class="row-actions"><button class="icon-btn" data-action="edit-item" data-id="${i.id}" aria-label="Edit ${esc(i.name)}" type="button">${icon("edit")}</button><button class="icon-btn danger" data-action="delete-item" data-id="${i.id}" aria-label="Delete ${esc(i.name)}" type="button">${icon("trash")}</button></div></div>
    ${meter}
    <dl class="facts">
      <div><dt>Price</dt><dd>${i.price != null ? money(i.price) : "—"}</dd></div>
      <div><dt>Purchased</dt><dd>${fmtDate(i.purchase_date)}</dd></div>
      <div><dt>${i.category === "Document" ? "Expires" : "Warranty ends"}</dt><dd>${fmtDate(i.warranty_expiry)}</dd></div>
      <div><dt>Bought from</dt><dd>${esc(i.store) || "—"}</dd></div>
      ${i.serial ? `<div class="wide"><dt>Serial or ID</dt><dd>${esc(i.serial)}</dd></div>` : ""}
    </dl>
    ${i.notes ? `<p class="notes">${esc(i.notes)}</p>` : ""}
  </article>`;
}

function itemsListHTML() {
  const q = state.q.trim().toLowerCase();
  const list = state.items.filter((i) => (state.cat === "all" || i.category === state.cat) && (!q || [i.name, i.store, i.serial, i.notes, i.category].some((v) => (v || "").toLowerCase().includes(q))));
  if (!state.items.length) return emptyState("No belongings yet", "Add devices, appliances, vehicles and important documents to keep their details in one place.", "Add your first belonging", "add-item");
  if (!list.length) return '<div class="empty"><h3>No matches</h3><p>Try a different search or category.</p></div>';
  return `<div class="cards">${list.map(itemCard).join("")}</div>`;
}
function viewBelongings() {
  return `<div class="toolbar">
    <input type="search" id="itemSearch" placeholder="Search belongings" value="${esc(state.q)}" aria-label="Search belongings">
    <select id="itemCat" aria-label="Filter by category"><option value="all">All categories</option>${state.meta.itemCategories.map((c) => `<option ${state.cat === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
  </div><div id="itemsList">${itemsListHTML()}</div>`;
}

function viewWarranties() {
  const withW = state.items.filter((i) => i.warranty_expiry).map((i) => ({ i, days: daysTo(i.warranty_expiry) })).sort((a, b) => a.days - b.days);
  const without = state.items.length - withW.length;
  if (!withW.length) return emptyState("No warranties tracked", state.items.length ? "Edit a belonging and add a warranty or expiry date to track it here." : "Add a belonging with a warranty or expiry date and LifeBox will watch it for you.", "Add warranty", "add-warranty");
  const groups = [
    ["Expired", "bad", withW.filter((x) => x.days < 0)],
    ["Ending within 30 days", "warn", withW.filter((x) => x.days >= 0 && x.days <= 30)],
    ["Active", "", withW.filter((x) => x.days > 30)],
  ];
  const row = ({ i, days }) => {
    const ws = warrantyState(days);
    return `<div class="row"><span class="row-icon ${ws.cls === "bad" ? "orange" : ws.cls === "warn" ? "orange" : "green"}">${icon("shield")}</span>
      <div class="row-body"><div class="row-title">${esc(i.name)}</div><div class="row-meta">${i.category === "Document" ? "Expires" : "Ends"} ${fmtDate(i.warranty_expiry)} · ${esc(rel(days))}${i.store ? " · " + esc(i.store) : ""}</div></div>
      <span class="chip ${ws.cls}">${days < 0 ? "Expired" : days <= 30 ? cap(rel(days)) : "Active"}</span>
      <div class="row-actions"><button class="icon-btn" data-action="edit-item" data-id="${i.id}" aria-label="Edit ${esc(i.name)}" type="button">${icon("edit")}</button></div></div>`;
  };
  return `<p class="sub tight">${withW.length} tracked${without ? ` · ${without} belonging${without > 1 ? "s have" : " has"} no date` : ""}</p>` +
    groups.filter((g) => g[2].length).map(([t, c, l]) => `<div class="group-title ${c}">${t} (${l.length})</div><div class="panel"><div class="rows">${l.map(row).join("")}</div></div>`).join("");
}

function subCard(s) {
  const paused = s.status === "paused";
  const nx = nextRenewal(s), d = daysTo(nx);
  return `<article class="card ${paused ? "paused" : ""}">
    <div class="card-top"><div><h3>${esc(s.name)}</h3><div class="card-tags"><span class="chip">${esc(s.category)}</span><span class="chip">${cap(s.cycle)}</span>${paused ? '<span class="chip warn">Paused</span>' : ""}</div></div>
    <div class="row-actions"><button class="icon-btn" data-action="edit-sub" data-id="${s.id}" aria-label="Edit ${esc(s.name)}" type="button">${icon("edit")}</button><button class="icon-btn danger" data-action="delete-sub" data-id="${s.id}" aria-label="Delete ${esc(s.name)}" type="button">${icon("trash")}</button></div></div>
    <div><div class="price">${money(s.amount)}<span class="muted per"> / ${PER[s.cycle]}</span></div>
    ${s.cycle !== "monthly" ? `<div class="row-meta">${money(monthlyCost(s))} a month</div>` : ""}</div>
    ${paused ? '<p class="notes">Paused subscriptions are not counted in your spending or reminders.</p>' : `<div class="row-meta">Next renewal ${fmtDate(nx)} ${dayChip(d, "subscriptions")}</div>`}
    ${s.notes ? `<p class="notes">${esc(s.notes)}</p>` : ""}
    <div class="card-foot">
      ${paused ? "" : `<button class="btn btn-ghost btn-small" data-action="pay-sub" data-id="${s.id}" type="button">${icon("refresh")} Mark paid</button>`}
      <button class="btn btn-ghost btn-small" data-action="toggle-sub" data-id="${s.id}" type="button">${icon(paused ? "play" : "pause")} ${paused ? "Resume" : "Pause"}</button>
    </div></article>`;
}
function viewSubscriptions() {
  if (!state.subscriptions.length) return emptyState("No subscriptions yet", "Add the services you pay for to see what they cost each month and when they renew.", "Add subscription", "add-sub");
  const active = state.subscriptions.filter((s) => s.status === "active");
  const monthly = active.reduce((t, s) => t + monthlyCost(s), 0);
  const sorted = [...state.subscriptions].sort((a, b) => (a.status === b.status ? nextRenewal(a).localeCompare(nextRenewal(b)) : a.status === "active" ? -1 : 1));
  return `<div class="stats three">
    <div class="stat"><small>Per month</small><strong>${money(monthly)}</strong></div>
    <div class="stat"><small>Per year</small><strong>${money(monthly * 12)}</strong></div>
    <div class="stat"><small>Active</small><strong>${active.length}</strong><span>${state.subscriptions.length - active.length} paused</span></div>
  </div><div class="cards">${sorted.map(subCard).join("")}</div>`;
}

function viewReminders() {
  const all = buildEvents();
  const f = state.remFilter;
  const ev = all.filter((e) => f === "all" || e.kind === f);
  const seg = [["all", "All"], ["reminders", "Reminders"], ["items", "Warranties"], ["subscriptions", "Subscriptions"]];
  const buckets = [
    ["Overdue", "bad", ev.filter((e) => e.days < 0)],
    ["Today", "warn", ev.filter((e) => e.days === 0)],
    ["Next 7 days", "", ev.filter((e) => e.days >= 1 && e.days <= 7)],
    ["Next 30 days", "", ev.filter((e) => e.days >= 8 && e.days <= 30)],
    ["Later", "", ev.filter((e) => e.days > 30)],
  ];
  const done = state.reminders.filter((r) => r.done);
  const body = buckets.filter((b) => b[2].length).map(([t, c, l]) => `<div class="group-title ${c}">${t} (${l.length})</div><div class="panel"><div class="rows">${l.map(eventRow).join("")}</div></div>`).join("");
  return `<div class="seg" role="tablist">${seg.map(([id, l]) => `<button class="${f === id ? "on" : ""}" data-filter="${id}" type="button">${l}</button>`).join("")}</div>
    <p class="sub tight">Warranty dates and subscription renewals appear here automatically.</p>
    ${body || emptyState("Nothing to remind you about", "Add a reminder, or add warranty dates and subscriptions and they will show up here.", "Add reminder", "add-reminder")}
    ${done.length ? `<div class="group-title">Completed (${done.length})</div><div class="panel"><div class="rows">${done.map((r) => `<div class="row is-done"><span class="row-icon green">${icon("check")}</span><div class="row-body"><div class="row-title">${esc(r.title)}</div><div class="row-meta">Was due ${fmtDate(r.due_date)}</div></div><div class="row-actions"><button class="icon-btn" data-action="undo-reminder" data-id="${r.id}" aria-label="Mark not done" title="Mark not done" type="button">${icon("undo")}</button><button class="icon-btn danger" data-action="delete-reminder" data-id="${r.id}" aria-label="Delete" type="button">${icon("trash")}</button></div></div>`).join("")}</div></div>` : ""}`;
}

function viewSettings() {
  return `<div class="settings-grid">
    <form class="panel" data-form="profile" novalidate><div><h3>Profile</h3><p class="sub">${esc(state.user.email)}</p></div>
      <label class="field">Name<input name="name" value="${esc(state.user.name)}" maxlength="80" required autocomplete="name"></label>
      <label class="field">Currency<select name="currency">${state.meta.currencies.map((c) => `<option ${state.user.currency === c ? "selected" : ""}>${c}</option>`).join("")}</select></label>
      <p class="form-error"></p><button class="btn btn-primary" type="submit">Save profile</button></form>
    <form class="panel" data-form="password" novalidate><div><h3>Change password</h3><p class="sub">Other devices will be signed out.</p></div>
      <label class="field">Current password<input name="current" type="password" autocomplete="current-password" required></label>
      <label class="field">New password<input name="next" type="password" autocomplete="new-password" minlength="8" required><small>At least 8 characters.</small></label>
      <p class="form-error"></p><button class="btn btn-primary" type="submit">Update password</button></form>
    <div class="panel"><div><h3>Your data</h3><p class="sub">Download everything in your LifeBox as a JSON file.</p></div>
      <a class="btn btn-ghost" href="/api/export" download>Export my data</a>
      <button class="btn btn-ghost" data-action="logout" type="button">Log out</button></div>
    <form class="panel" data-form="delete" novalidate><div><h3>Delete account</h3><p class="sub">Permanently removes your account and everything in it.</p></div>
      <label class="field">Confirm with your password<input name="password" type="password" autocomplete="current-password" required></label>
      <p class="form-error"></p><button class="btn btn-danger" type="submit">Delete my account</button></form>
  </div>`;
}

/* ============ Render / router ============ */
const VIEWS = { overview: viewOverview, belongings: viewBelongings, warranties: viewWarranties, subscriptions: viewSubscriptions, reminders: viewReminders, settings: viewSettings };

function navHTML(bottom) {
  const alertCount = buildEvents().filter((e) => e.days <= 0 && e.kind !== "items").length;
  const counts = { belongings: state.items.length, subscriptions: state.subscriptions.filter((s) => s.status === "active").length };
  return ROUTES.filter((r) => r.icon).map((r) => {
    const n = r.id === "reminders" ? alertCount : counts[r.id];
    const badge = n ? `<span class="nav-count ${r.id === "reminders" ? "alert" : ""}">${n}</span>` : "";
    return `<button class="nav-link ${currentRoute() === r.id ? "active" : ""}" data-route="${r.id}" type="button" ${currentRoute() === r.id ? 'aria-current="page"' : ""}>${icon(r.icon)}<span>${bottom ? r.short : r.label}</span>${bottom && r.id !== "reminders" ? "" : badge}</button>`;
  }).join("");
}

function render() {
  TODAY = new Date(); TODAY = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate());
  const route = ROUTES.find((r) => r.id === currentRoute());
  $("#topTitle").textContent = route.title;
  document.title = `${route.title} — LifeBox`;
  const addBtn = $("#addBtn");
  addBtn.hidden = !route.add;
  if (route.add) addBtn.innerHTML = `${icon("plus")}<span class="add-label">${route.add}</span>`;
  addBtn.setAttribute("aria-label", route.add || "");
  $("#sideNav").innerHTML = navHTML(false);
  $("#bottomNav").innerHTML = navHTML(true);
  $("#view").innerHTML = VIEWS[route.id]();
  animateBars();
  const initial = state.user.name.trim().charAt(0).toUpperCase() || "?";
  ["#avatarSide", "#avatarTop"].forEach((s) => ($(s).textContent = initial));
  $("#userNameSide").textContent = state.user.name;
  $("#userEmailSide").textContent = state.user.email;
}
function animateBars() {
  document.querySelectorAll("[data-w]").forEach((el) => { el.style.width = el.dataset.w + "%"; });
}

window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });

/* ============ Events ============ */
async function logout() {
  try { await api("/api/auth/logout", "POST", {}); } catch {}
  location.href = "/";
}
document.addEventListener("click", (e) => {
  const routeBtn = e.target.closest("[data-route]");
  if (routeBtn) { location.hash = routeBtn.dataset.route; return; }
  const f = e.target.closest("[data-filter]");
  if (f) { state.remFilter = f.dataset.filter; render(); return; }
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const id = btn.dataset.id;
  switch (btn.dataset.action) {
    case "add-item": itemForm(); break;
    case "add-warranty": itemForm(null, true); break;
    case "add-sub": subForm(); break;
    case "add-reminder": reminderForm(); break;
    case "edit-item": itemForm(findRec("items", id)); break;
    case "delete-item": { const r = findRec("items", id); deleteRecord("items", r.id, `"${r.name}"`); break; }
    case "edit-sub": subForm(findRec("subscriptions", id)); break;
    case "delete-sub": { const r = findRec("subscriptions", id); deleteRecord("subscriptions", r.id, `"${r.name}"`); break; }
    case "toggle-sub": { const s = findRec("subscriptions", id); updateSub(s, { status: s.status === "active" ? "paused" : "active" }, s.status === "active" ? "Paused." : "Resumed."); break; }
    case "pay-sub": paySub(findRec("subscriptions", id)); break;
    case "done-reminder": completeReminder(findRec("reminders", id)); break;
    case "undo-reminder": undoReminder(findRec("reminders", id)); break;
    case "delete-reminder": { const r = findRec("reminders", id); deleteRecord("reminders", r.id, `"${r.title}"`); break; }
    case "open-event": {
      const k = btn.dataset.kind, r = findRec(k, id);
      if (k === "items") itemForm(r); else if (k === "subscriptions") subForm(r); else reminderForm(r);
      break;
    }
    case "logout": logout(); break;
    case "reload": location.reload(); break;
  }
});
$("#addBtn").addEventListener("click", () => { const fn = ADD_ACTIONS[currentRoute()]; if (fn) fn(); });
$("#logoutBtn").addEventListener("click", logout);

document.addEventListener("input", (e) => {
  if (e.target.id === "itemSearch") { state.q = e.target.value; $("#itemsList").innerHTML = itemsListHTML(); animateBars(); }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "itemCat") { state.cat = e.target.value; $("#itemsList").innerHTML = itemsListHTML(); animateBars(); }
});

document.addEventListener("submit", async (e) => {
  const form = e.target.closest("[data-form]");
  if (!form) return;
  e.preventDefault();
  const kind = form.dataset.form;
  const data = Object.fromEntries(new FormData(form));
  const err = $(".form-error", form), btn = $("button[type=submit]", form);
  err.textContent = "";
  btn.disabled = true;
  try {
    if (kind === "profile") {
      const { user } = await api("/api/auth/profile", "PATCH", data);
      state.user = user; render(); toast("Profile saved.");
    } else if (kind === "password") {
      await api("/api/auth/password", "POST", data);
      form.reset(); toast("Password updated.");
    } else if (kind === "delete") {
      const ok = await confirmDialog({ title: "Delete your account?", message: "Everything in your LifeBox will be permanently deleted.", confirmLabel: "Delete account" });
      if (!ok) { btn.disabled = false; return; }
      await api("/api/auth/account", "DELETE", data);
      location.href = "/";
      return;
    }
  } catch (ex) { err.textContent = ex.message; }
  btn.disabled = false;
});

/* ============ Boot ============ */
(async function boot() {
  try {
    const { user } = await api("/api/auth/me");
    state.user = user;
    const data = await api("/api/data");
    state.items = data.items; state.subscriptions = data.subscriptions; state.reminders = data.reminders; state.meta = data.meta;
    render();
    // keep "today" correct if the tab stays open overnight
    setInterval(() => { const n = new Date(); if (n.getDate() !== TODAY.getDate()) render(); }, 60000);
  } catch (e) {
    $("#view").innerHTML = `<div class="empty"><h3>Couldn't load your LifeBox</h3><p>${esc(e.message)}</p><button class="btn btn-primary" data-action="reload" type="button">Try again</button></div>`;
  }
})();
