(() => {
"use strict";
// Демо (?demo): вымышленная семья, хранилище в памяти вкладки, сеть подменена — см. demo-data.js.
// Настоящий вход и данные на этом устройстве демо не трогает
const DEMO = /[?&]demo(?:[=&]|$)/.test(location.search) && !!window.KeelDemo;
const store = (() => {
  if (DEMO) return window.KeelDemo.install();
  try { return window.localStorage; } catch { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }
})();
const DOW = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];
const MONTHS = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
const CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="var(--pine-ink)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const LS = { cfg: "habits.cfg", base: "habits.base", pending: "habits.pending", view: "habits.view", tasks: "habits.tasks" };
const DEFAULT_SETTINGS = {
  busyDays: [], busyLabel: "", spheres: ["работа","семья","здоровье","дом","деньги"],
  kidName: "", kidNameGen: "", morningMinutes: 30, morningHabit: "", bedFrom: "21:00",
  slots: [], tasksUrl: "", tasksKey: "", togetherPerWeek: 1, work: null,
  prayerTarget: 15, prayerChime: true, prayerHabit: null, prayerPlan: [],
};
// Прогноз подъёма: окно истории, период полураспада веса и шаг календаря
const K_WINDOW = 42, K_HALF = 10, SLOT = 15;

const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const monday = d => addDays(d, -((d.getDay() + 6) % 7));
const todayDate = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const dow = d => (d.getDay() + 6) % 7;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtLong = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" });
const fmtDay = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });
const fmtShort = new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "short" });
const fmtDM = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" });
const fmtTime = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}
function lsGet(k) { try { return JSON.parse(store.getItem(k)); } catch { return null; } }
function lsSet(k, v) { try { v == null ? store.removeItem(k) : store.setItem(k, JSON.stringify(v)); } catch {} }
const clone = o => JSON.parse(JSON.stringify(o));
const pct = v => v == null ? "—" : Math.round(v * 100) + "%";
const num = v => v < 10 && Math.abs(v - Math.round(v)) > .05 ? v.toFixed(1).replace(".", ",") : String(Math.round(v));

// Время: минуты от полуночи. Отбой до полудня считается следующими сутками (00:30 → 24:30).
const toMin = s => { if (!s) return null; const [h, m] = String(s).split(":").map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null; };
const bedMinOf = s => { const m = toMin(s); return m == null ? null : m < 720 ? m + 1440 : m; };
const hm = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return `${Math.floor(m / 60)}:${pad(m % 60)}`; };
const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dur = m => { m = Math.round(m); const h = Math.floor(m / 60); return `${h} ч ${pad(m % 60)} мин`; };

/* ---------- состояние ----------
   base    — последняя версия data.json с GitHub и её sha
   pending — изменения, ещё не отправленные коммитом; накладываются поверх base */
const S = {
  cfg: lsGet(LS.cfg), base: lsGet(LS.base), pending: lsGet(LS.pending) || [],
  data: null, memo: null, sync: "idle", savedAt: null, saving: false, again: false,
  weekOffset: 0, confirmDelete: null,
  view: lsGet(LS.view) === "quarter" ? "quarter" : "month", monthOffset: 0, quarterOffset: 0,
  kidOffset: 0, undo: null, recMemo: new Map(), confirmGoal: null,
};

function applyOp(d, op) {
  if (op.t === "check") {
    const day = d.log[op.date] || (d.log[op.date] = {});
    if (op.val) day[op.hid] = true; else delete day[op.hid];
    if (!Object.keys(day).length) delete d.log[op.date];
  } else if (op.t === "habit") {
    const h = d.habits.find(x => x.id === op.id);
    if (h) Object.assign(h, op.data); else d.habits.push({ id: op.id, ...op.data });
  } else if (op.t === "del") {
    d.habits = d.habits.filter(x => x.id !== op.id);
  } else if (op.t === "kid" || op.t === "me") {
    const box = op.t === "kid" ? d.kid : d.me, day = { ...(box[op.date] || {}) };
    for (const [k, v] of Object.entries(op.data)) {
      if (v == null || v === "" || (Array.isArray(v) && !v.length)) delete day[k]; else day[k] = v;
    }
    if (Object.keys(day).length) box[op.date] = day; else delete box[op.date];
  } else if (op.t === "together") {
    if (op.data == null) delete d.together[op.date];
    else d.together[op.date] = { ...(d.together[op.date] || {}), ...op.data };
  } else if (op.t === "review") {
    if (op.date == null) delete d.reviews[op.week]; else d.reviews[op.week] = op.date;
  } else if (op.t === "goal") {
    const g = d.goals.find(x => x.id === op.id);
    if (g) Object.assign(g, op.data); else d.goals.push({ id: op.id, history: [], steps: [], ...op.data });
  } else if (op.t === "goalDel") {
    d.goals = d.goals.filter(x => x.id !== op.id);
  } else if (op.t === "goalLog") {
    const g = d.goals.find(x => x.id === op.id);
    if (g) {
      g.history = (g.history || []).filter(x => x.d !== op.d);
      if (op.v != null) g.history.push({ d: op.d, v: op.v });
      g.history.sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : 0);
    }
  } else if (op.t === "goalStep") {
    const g = d.goals.find(x => x.id === op.id);
    if (g) {
      g.steps = g.steps || [];
      const st = g.steps.find(x => x.id === op.sid);
      if (op.data == null) g.steps = g.steps.filter(x => x.id !== op.sid);
      else if (st) Object.assign(st, op.data);
      else g.steps.push({ id: op.sid, done: false, ...op.data });
    }
  } else if (op.t === "session") {
    if (op.data == null) delete d.sessions[op.key];
    else d.sessions[op.key] = { ...(d.sessions[op.key] || {}), ...op.data };
  } else if (op.t === "need") {
    const n = d.needs.find(x => x.id === op.id);
    if (op.data == null) d.needs = d.needs.filter(x => x.id !== op.id);
    else if (n) Object.assign(n, op.data); else d.needs.push({ id: op.id, ...op.data });
  } else if (op.t === "prayer") {
    if (!op.items || !op.items.length) delete d.prayer[op.date]; else d.prayer[op.date] = op.items;
  } else if (op.t === "focus") {
    if (!op.items || !op.items.length) delete d.focus[op.date]; else d.focus[op.date] = op.items;
  } else if (op.t === "care") {
    const list = (d.care[op.date] || []).filter(s => s !== op.sphere);
    if (op.val) list.push(op.sphere);
    if (list.length) d.care[op.date] = list; else delete d.care[op.date];
  } else if (op.t === "tag") {
    if (op.sphere == null) delete d.tags[op.id]; else d.tags[op.id] = op.sphere;
  } else if (op.t === "ritual") {
    const box = d.rituals[op.kind] || (d.rituals[op.kind] = {});
    if (op.time == null) delete box[op.date]; else box[op.date] = op.time;
  } else if (op.t === "pushSub") {
    const ep = op.sub?.endpoint || op.endpoint;
    d.push.subs = d.push.subs.filter(x => x.endpoint !== ep);
    if (!op.remove) d.push.subs.push(op.sub);
  } else if (op.t === "settings") {
    Object.assign(d.settings, op.data);
  }
  return d;
}
function normalize(d) {
  d = d && typeof d === "object" ? d : {};
  const obj = v => v && typeof v === "object" && !Array.isArray(v) ? v : {};
  return { version: 1, ...d, settings: { ...DEFAULT_SETTINGS, ...obj(d.settings) },
    habits: Array.isArray(d.habits) ? d.habits : [], log: obj(d.log), kid: obj(d.kid),
    me: obj(d.me), together: obj(d.together), reviews: obj(d.reviews), goals: Array.isArray(d.goals) ? d.goals : [],
    sessions: obj(d.sessions), focus: obj(d.focus), rituals: obj(d.rituals), prayer: obj(d.prayer),
    needs: Array.isArray(d.needs) ? d.needs : [], care: obj(d.care), tags: obj(d.tags),
    push: { ...obj(d.push), subs: Array.isArray(d.push?.subs) ? d.push.subs : [] } };
}
function recompute() {
  S.memo = null; S.recMemo = new Map();
  if (!S.base) { S.data = null; return; }
  const d = normalize(clone(S.base.data));
  for (const op of S.pending) applyOp(d, op);
  S.data = d;
}
function persist() { lsSet(LS.base, S.base); lsSet(LS.pending, S.pending.length ? S.pending : null); }

const settings = () => S.data ? S.data.settings : DEFAULT_SETTINGS;
const habits = () => S.data ? S.data.habits : [];
const active = () => habits().filter(h => !h.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
const archived = () => habits().filter(h => h.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
const existed = (h, date) => !h.created || h.created <= date;
const isDone = (date, hid) => S.data?.log[date]?.[hid] === true;
const canWrite = () => !!(S.cfg && S.data);
const kidName = () => settings().kidName || "Малыш";
const kidGen = () => settings().kidNameGen || settings().kidName || "малыша";
const meWakeOf = k => toMin(S.data?.me[k]?.wake);
const fmt1 = v => v.toFixed(1).replace(".", ",");
const fmtN = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const fmtDate = d => `${fmtDay.format(d)} ${d.getFullYear()}`;
const smart = v => fmtN.format(Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10);
function diffText(d) {
  d = Math.round(d);
  return Math.abs(d) <= 5 ? "по плану" : d > 0 ? `на ${d} мин позже плана` : `на ${-d} мин раньше плана`;
}

/* ---------- GitHub ---------- */
function b64dec(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}
function b64enc(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function gh(method, body) {
  const res = await fetch(`https://api.github.com/repos/${S.cfg.repo}/contents/data.json`, {
    method, cache: "no-store",
    headers: {
      Authorization: `Bearer ${S.cfg.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(json.message || res.statusText); e.status = res.status; throw e; }
  return json;
}
async function pull() {
  const j = await gh("GET");
  let data;
  try { data = JSON.parse(b64dec(j.content)); }
  catch { const e = new Error("bad json"); e.status = "json"; throw e; }
  return { data, sha: j.sha };
}
function commitMsg(ops) {
  const on = ops.filter(o => o.t === "check" && o.val), off = ops.filter(o => o.t === "check" && !o.val);
  const days = [...new Set([...on, ...off].map(o => fmtDM.format(parse(o.date))))];
  const parts = [];
  if (on.length || off.length) parts.push(`Отметки ${days.join(", ")}: ${[on.length && "+" + on.length, off.length && "−" + off.length].filter(Boolean).join(" ")}`);
  const F = { wake: "подъём", bed: "отбой", nights: "просыпался", tries: "ложно засыпал" };
  const kidOps = ops.filter(o => o.t === "kid"), kidSet = kidOps.flatMap(o => Object.entries(o.data).filter(([, v]) => v != null && v !== ""));
  const kid = kidOps.flatMap(o => Object.entries(o.data).filter(([, v]) => !kidSet.length || (v != null && v !== "")).map(([f, v]) =>
    `${F[f] || f} ${fmtDM.format(parse(o.date))} ${Array.isArray(v) ? v.map(x => x.s ? `${x.s}→${x.w}` : x).join(", ") : v || "удалён"}`));
  if (kid.length) parts.push(`${kidName()}: ${kid.join(", ")}`);
  const meOps = ops.filter(o => o.t === "me"), meSet = meOps.some(o => o.data.wake);
  const me = meOps.filter(o => !meSet || o.data.wake).filter(o => o.data.wake || !kidSet.length).map(o => `${fmtDM.format(parse(o.date))} ${o.data.wake || "удалён"}`);
  if (me.length) parts.push(`Мой подъём: ${me.join(", ")}`);
  if (ops.some(o => o.t === "together")) parts.push("время вдвоём");
  if (ops.some(o => o.t === "review")) parts.push("обзор недели");
  if (ops.some(o => o.t.startsWith("goal"))) parts.push("цели");
  if (ops.some(o => o.t === "session")) parts.push("слоты");
  if (ops.some(o => o.t === "focus")) parts.push("главное на день");
  if (ops.some(o => o.t === "need")) parts.push(ops.some(o => o.t === "need" && o.data?.answered) ? "ответ на молитву" : "молитвенные нужды");
  ops.filter(o => o.t === "prayer").forEach(o => parts.push(`Молитва ${fmtDM.format(parse(o.date))}: ${(o.items || []).reduce((a, x) => a + x.m, 0)} мин`));
  if (ops.some(o => o.t === "ritual")) parts.push("вечерние 5 минут");
  if (ops.some(o => o.t === "care")) parts.push("баланс сфер");
  if (ops.some(o => o.t === "pushSub")) parts.push("напоминания на устройстве");
  if (ops.some(o => o.t === "tag")) parts.push("сферы задач");
  if (ops.some(o => o.t === "habit" || o.t === "del")) parts.push("настройка привычек");
  if (ops.some(o => o.t === "settings")) parts.push("настройки");
  return parts.join("; ") || "Обновление";
}
function errorText(e) {
  const repo = S.cfg?.repo || "репозиторий";
  if (e.status === 401) return "GitHub не принял токен. Создай новый и вставь его в «Подключение».";
  if (e.status === 403) return `Токену не хватает прав. Нужен доступ Contents: Read and write к ${repo}.`;
  if (e.status === 404) return `Не нашёл ${repo}/data.json. Проверь название репозитория и что токен выдан на него.`;
  if (e.status === "json") return "data.json в репозитории повреждён: это не JSON. Исправь файл на GitHub.";
  if (e instanceof TypeError) return "Нет связи с GitHub. Изменения остались на этом устройстве и уйдут, когда связь вернётся.";
  return `GitHub ответил ошибкой: ${e.message}. Попробуй ещё раз через минуту.`;
}
function setSync(state, err) {
  S.sync = state;
  if (state === "saved") S.savedAt = new Date();
  notice(err ? errorText(err) : "");
  if (err && (err.status === 401 || err.status === 404 || err.status === 403)) openConnect();
  renderSync();
}
async function refresh() {
  if (!S.cfg || S.saving) return;
  setSync("loading");
  try {
    S.base = await pull(); persist(); recompute();
    setSync(S.pending.length ? "pending" : "saved");
    loadTasks();
    if (S.pending.length) schedule(0);
  } catch (e) { setSync(e instanceof TypeError ? "offline" : "error", e); }
  render();
}
let timer = null;
function schedule(ms = 1200) { clearTimeout(timer); timer = setTimeout(flush, ms); }
async function flush() {
  if (!S.cfg || !S.pending.length) return;
  if (S.saving) { S.again = true; return; }
  S.saving = true; setSync("saving");
  let done = false;
  try {
    if (!S.base) S.base = await pull();
    for (let attempt = 0; attempt < 4 && !done; attempt++) {
      const ops = S.pending.slice();
      const next = normalize(clone(S.base.data));
      ops.forEach(op => applyOp(next, op));
      try {
        const r = await gh("PUT", { message: commitMsg(ops), content: b64enc(JSON.stringify(next, null, 2) + "\n"), sha: S.base.sha });
        S.base = { data: next, sha: r.content.sha };
        S.pending = S.pending.slice(ops.length);
        done = true;
      } catch (e) {
        if (e.status === 409 || (e.status === 422 && /sha/i.test(e.message))) { S.base = await pull(); continue; }
        throw e;
      }
    }
    persist(); recompute();
    if (done) setSync(S.pending.length ? "pending" : "saved");
    else setSync("error", new Error("файл всё время меняется с другого устройства"));
  } catch (e) {
    persist(); setSync(e instanceof TypeError ? "offline" : "error", e);
  }
  S.saving = false;
  render();
  if (S.pending.length && (S.again || done)) schedule(S.again ? 300 : 1200);
  S.again = false;
}
function op(...list) {
  if (!canWrite()) { openConnect(); return false; }
  S.pending.push(...list); persist(); recompute();
  setSync("pending"); render(); schedule();
  return true;
}

/* ---------- привычки: расчёты ---------- */
function weekCount(h, mon) {
  let n = 0;
  for (let i = 0; i < 7; i++) if (isDone(ymd(addDays(mon, i)), h.id)) n++;
  return n;
}
function streak(h) {
  const target = h.target || 1, first = monday(parse(h.created || ymd(todayDate())));
  let wk = monday(todayDate()), n = 0;
  if (weekCount(h, wk) >= target) n++;
  wk = addDays(wk, -7);
  for (let i = 0; i < 104 && wk >= first; i++, wk = addDays(wk, -7)) {
    if (weekCount(h, wk) >= target) n++; else break;
  }
  return n;
}
function weekStatus(h, mon) {
  const target = h.target || 1, count = weekCount(h, mon), t = todayDate();
  if (count >= target) return { count, target, cls: "ok", text: "норма недели есть" };
  if (h.created && h.created > ymd(mon) && h.created <= ymd(addDays(mon, 6)))
    return { count, target, cls: "", text: "первая неделя, норма со следующей" };
  const sun = addDays(mon, 6);
  if (sun < t) return { count, target, cls: "warn", text: `не хватило ${target - count}` };
  let free = 0;
  for (let d = new Date(Math.max(t, mon)); d <= sun; d = addDays(d, 1)) if (!isDone(ymd(d), h.id)) free++;
  const need = target - count;
  if (need > free) return { count, target, cls: "", text: free ? `до конца недели — ещё ${free} ${plural(free, "раз", "раза", "раз")}` : "неделя закончилась" };
  return { count, target, cls: "", text: `осталось ${need} ${plural(need, "раз", "раза", "раз")}` };
}
// Норма считается с первого полного понедельника после создания привычки
function effStart(h) {
  if (!h.created) return null;
  const c = parse(h.created);
  return dow(c) === 0 ? c : addDays(monday(c), 7);
}
// Выполнение нормы за период. Перевыполнение одной недели не закрывает другую.
function normStats(from, to) {
  const t = todayDate(), end = to < t ? to : t;
  const per = new Map(active().map(h => [h.id, { h, done: 0, exp: 0, cred: 0 }]));
  if (end < from) return { pct: null, per: [...per.values()], done: 0, exp: 0 };
  for (let mon = monday(from); mon <= end; mon = addDays(mon, 7)) {
    for (const r of per.values()) {
      const es = effStart(r.h);
      let days = 0, cnt = 0;
      for (let i = 0; i < 7; i++) {
        const d = addDays(mon, i);
        if (d < from || d > end || (es && d < es)) continue;
        days++;
        if (isDone(ymd(d), r.h.id)) cnt++;
      }
      if (!days) continue;
      const exp = (r.h.target || 1) * days / 7;
      r.exp += exp; r.done += cnt; r.cred += Math.min(cnt, exp);
    }
  }
  const list = [...per.values()];
  const exp = list.reduce((a, r) => a + r.exp, 0), cred = list.reduce((a, r) => a + r.cred, 0);
  list.forEach(r => { r.pct = r.exp ? r.cred / r.exp : null; });
  return { pct: exp ? cred / exp : null, per: list, done: list.reduce((a, r) => a + r.done, 0), exp };
}
function dayRatio(k) {
  const pool = active().filter(h => existed(h, k));
  const n = pool.filter(h => isDone(k, h.id)).length;
  return { n, total: pool.length, r: pool.length ? n / pool.length : 0 };
}
const lvlOf = r => r === 0 ? 0 : r >= 1 ? 4 : r > .66 ? 3 : r > .33 ? 2 : 1;
function isoWeek(d) {
  const t = new Date(d); t.setDate(t.getDate() + 3 - dow(t));
  const w1 = new Date(t.getFullYear(), 0, 4);
  return 1 + Math.round(((t - w1) / 864e5 - 3 + dow(w1)) / 7);
}

/* ---------- ребёнок: прогноз подъёма ---------- */
const wakeOf = k => toMin(S.data?.kid[k]?.wake);
const bedOf = k => bedMinOf(S.data?.kid[k]?.bed);
function wq(vals, ws, q) {
  const idx = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
  const total = ws.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (const i of idx) { acc += ws[i]; if (acc >= q * total) return vals[i]; }
  return vals[idx[idx.length - 1]];
}
// По прошлым подъёмам: взвешенная медиана, свежие дни весят больше
function baseline(target) {
  const vals = [], ws = [], t = parse(target);
  for (let i = 1; i <= K_WINDOW; i++) {
    const w = wakeOf(ymd(addDays(t, -i)));
    if (w != null) { vals.push(w); ws.push(0.5 ** (i / K_HALF)); }
  }
  if (vals.length < 3) return null;
  return { pred: wq(vals, ws, .5), lo: wq(vals, ws, .2), hi: wq(vals, ws, .8), n: vals.length };
}
// По отбою накануне: отбой + обычная длина ночи
function viaBed(target) {
  const t = parse(target), bed = bedOf(ymd(addDays(t, -1)));
  if (bed == null) return null;
  const vals = [], ws = [];
  for (let i = 1; i <= K_WINDOW; i++) {
    const d = addDays(t, -i), w = wakeOf(ymd(d)), b = bedOf(ymd(addDays(d, -1)));
    if (w != null && b != null) { vals.push(w + 1440 - b); ws.push(0.5 ** (i / K_HALF)); }
  }
  if (vals.length < 3) return null;
  const night = wq(vals, ws, .5);
  return { pred: bed + night - 1440, bed, night, n: vals.length };
}
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
function kidModel() {
  if (S.memo) return S.memo;
  const t = todayDate(), bt = [];
  for (let i = 0; i <= 120; i++) {
    const k = ymd(addDays(t, -i)), w = wakeOf(k);
    if (w == null) continue;
    const b = baseline(k), p = viaBed(k);
    bt.push({ date: k, wake: w, b: b?.pred ?? null, p: p?.pred ?? null });
  }
  const eb = bt.filter(x => x.b != null).map(x => Math.abs(x.wake - x.b));
  const ep = bt.filter(x => x.b != null && x.p != null).map(x => Math.abs(x.wake - x.p));
  // Вес поправки на отбой — по тому, насколько точнее она угадывала раньше
  let wp = .5;
  if (eb.length >= 3 && ep.length >= 3) {
    const mb = Math.max(mean(eb), 3), mp = Math.max(mean(ep), 3);
    wp = (1 / mp ** 2) / (1 / mb ** 2 + 1 / mp ** 2);
  }
  const comb = x => x.b == null ? null : x.p != null ? (1 - wp) * x.b + wp * x.p : x.b;
  const ec = bt.filter(x => x.b != null).map(x => Math.abs(x.wake - comb(x)));
  const half = ec.length >= 4 ? Math.max(10, Math.min(90, wq(ec, ec.map(() => 1), .8))) : null;
  S.memo = { bt, wp, comb, half, mae: ec.length >= 3 ? mean(ec) : null, nBt: ec.length,
    btMap: new Map(bt.map(x => [x.date, x])) };
  return S.memo;
}
function forecast(target) {
  const b = baseline(target);
  if (!b) return null;
  const p = viaBed(target), m = kidModel();
  const pred = p ? (1 - m.wp) * b.pred + m.wp * p.pred : b.pred;
  const half = m.half ?? Math.max(15, Math.min(60, (b.hi - b.lo) / 2 || 15));
  return { pred, lo: pred - half, hi: pred + half, half, b, p, wp: p ? m.wp : 0, mae: m.mae, nBt: m.nBt };
}
// Когда вставать самому: самый ранний ожидаемый подъём минус время на утро
function recFor(k) {
  if (S.recMemo.has(k)) return S.recMemo.get(k);
  const f = forecast(k), v = f ? f.lo - (settings().morningMinutes || 30) : null;
  S.recMemo.set(k, v);
  return v;
}
function kidTarget() {
  const t = todayDate(), tk = ymd(t);
  if (wakeOf(tk) == null && new Date().getHours() < 12) return tk;
  return ymd(addDays(t, 1));
}
// Какие кнопки сна показывать сейчас. night0 — «текущая» ночь для плашек и редактора:
// днём и утром это прошлая ночь, с 17:00 — сегодняшняя.
// С какого времени показывать «уснул»: из настроек, но за 30 минут до самого раннего отбоя за месяц, не раньше 18:00
function bedFrom() {
  const set = toMin(settings().bedFrom) ?? 21 * 60, beds = recentKid(30).beds;
  const early = beds.length >= 3 ? wq(beds, beds.map(() => 1), .1) - 30 : Infinity;
  return Math.max(18 * 60, Math.min(set, early));
}
function kidButtons() {
  const hr = new Date().getHours(), t = todayDate(), tk = ymd(t), nd = bedDateNow();
  const night0 = hr >= 17 ? tk : ymd(addDays(t, -1));
  const kd = S.data?.kid || {}, bed = bedOf(nd), wake = wakeOf(tk), me = meWakeOf(tk);
  const morning = hr >= 4 && hr < 14;
  // Последнее пробуждение этой ночи: если оно в первые 2 часа после засыпания — это было ложное засыпание
  const nw = (kd[nd]?.nights || []).map(bedMinOf).filter(x => x != null), lastW = nw.length ? Math.max(...nw) : null, nowN = evNow();
  return {
    wake: morning && wake == null,
    me: hr >= 3 && hr < 14 && me == null,
    bed0: (nowMin() >= bedFrom() || hr < 4) && bed == null,
    night: (hr >= 17 || hr < 12) && bed != null && !(hr < 14 && wake != null),
    resleep: (hr >= 17 || hr < 3) && bed != null && lastW != null && lastW - bed <= 120 && nowN >= lastW && nowN - lastW <= 180,
    bed, nights: kd[nd]?.nights || [], tries: kd[nd]?.tries || [], lastW, night0,
    bedDone: bedOf(night0), nightsDone: kd[night0]?.nights || [],
    wakeDone: hr >= 17 ? null : wake, meDone: hr >= 17 ? null : me,
  };
}
const evNow = () => { const m = nowMin(); return m < 720 ? m + 1440 : m; };
// Отрезки сна одной ночи: от засыпания (или прошлого пробуждения) до следующего пробуждения
function nightStretches(k) {
  const v = S.data.kid[k] || {}, bed = bedMinOf(v.bed);
  if (bed == null) return [];
  const fin = wakeOf(ymd(addDays(parse(k), 1)));
  const ws = (v.nights || []).map(bedMinOf).filter(w => w != null && w > bed);
  if (fin != null) ws.push(fin + 1440);
  ws.sort((a, b) => a - b);
  const out = [];
  let from = bed;
  ws.forEach(w => { if (w > from) { out.push({ from, len: w - from }); from = w; } });
  return out;
}
// Следующее пробуждение: сколько обычно длится отрезок сна, если он уже продлился столько, сколько сейчас
function nextWake() {
  const k = bedDateNow(), v = S.data.kid[k] || {}, bed = bedMinOf(v.bed), now = evNow();
  if (bed == null || now < bed || wakeOf(ymd(addDays(parse(k), 1))) != null) return null;
  const ws = (v.nights || []).map(bedMinOf).filter(w => w != null && w > bed && w <= now);
  const last = ws.length ? Math.max(...ws) : bed, el = now - last;
  // Первый отрезок после отбоя обычно длинный, следующие — короче: сравниваем с такими же
  const first = !ws.length, pool = [];
  for (let i = 0; i <= 30; i++) nightStretches(ymd(addDays(parse(k), -i))).forEach((x, j) => { if ((j === 0) === first) pool.push(x.len); });
  if (pool.length < 5) return { last, need: 5 - pool.length };
  const rest = pool.filter(x => x > el).map(x => x - el);
  if (rest.length < 3) return { last, long: true };
  const one = rest.map(() => 1);
  const at = now + wq(rest, one, .5), fc = forecast(ymd(addDays(parse(k), 1)));
  // Утром следующее пробуждение, скорее всего, уже на день — тогда ответ даёт прогноз подъёма
  if (fc && at >= fc.lo + 1440) return { last, morning: true };
  return { last, at, lo: now + wq(rest, one, .25), hi: now + wq(rest, one, .75) };
}
/* ---------- вечер вдвоём ---------- */
const evHabit = () => { const id = settings().eveningHabit; return id ? habits().find(h => h.id === id && !h.archived) || null : null; };
const evMinutes = () => settings().eveningMinutes || 30;
// Каждое засыпание вечером (ложное и окончательное) — сколько минут прошло до следующего пробуждения
function onsets(days = 45) {
  const t = todayDate(), out = [];
  for (let i = 0; i <= days; i++) {
    const k = ymd(addDays(t, -i)), v = S.data.kid[k];
    if (!v) continue;
    (v.tries || []).forEach(x => { const a = bedMinOf(x.s), b = bedMinOf(x.w); if (a != null && b > a) out.push(b - a); });
    const st = nightStretches(k);
    if (st.length) out.push(st[0].len);
  }
  return out;
}
// Сколько ждать после засыпания, чтобы за время молитвы и чтения он скорее всего не проснулся:
// самая короткая выдержка, после которой просыпался в ближайшие evMinutes не чаще чем в 1 случае из 5
const LIGHT_DEFAULT = 20;
function lightSleep() {
  const on = onsets(), len = evMinutes();
  // Пока засыпаний мало, держимся общего правила: первые ~20 минут сон у малышей поверхностный
  if (on.length < 8) return { d: LIGHT_DEFAULT, n: on.length, rule: true };
  const at = d => { const risk = on.filter(x => x > d); return { of: risk.length, bad: risk.filter(x => x <= d + len).length }; };
  for (let d = 10; d <= 90; d += 5) {
    const r = at(d);
    if (r.of < 4) break;
    if (r.bad / r.of <= .2) return { d, n: on.length, ...r };
  }
  return { d: 60, n: on.length, unsure: true };
}
// Обычный окончательный отбой за 30 дней
function usualBed() {
  const beds = recentKid(30).beds;
  if (beds.length < 3) return null;
  const one = beds.map(() => 1);
  return { at: median(beds), lo: wq(beds, one, .25), hi: wq(beds, one, .75) };
}
function renderDuoCard() {
  const card = $("#duo-card"), h = S.data && evHabit();
  if (!h) { card.hidden = true; return; }
  const k = bedDateNow(), now = evNow(), name = kidName(), ub = usualBed();
  const K = kidButtons(), bed = bedOf(k), L = lightSleep(), len = evMinutes(), done = isDone(k, h.id);
  const from = Math.min(bedFrom(), ub ? ub.lo - 30 : Infinity);
  card.hidden = !(now >= from && now < 26 * 60);
  if (card.hidden) return;
  card.classList.toggle("met", done);
  if (done) {
    card.innerHTML = `<span class="pc-ok">${CHECK}</span><div class="pc-t"><b>${esc(h.name)} — сегодня было</b><span>слава Богу за этот вечер</span></div>
      <button type="button" class="btn sm ghost" data-duo="undo">Отменить</button>`;
    return;
  }
  const late = 23 * 60, short = `Если затянется после ${hm(late)} — короткий вариант: глава и молитва 10 минут.`;
  let line, sub, ready = false;
  if (K.resleep) {
    line = `${name} проснулся в ${hm(K.lastW)} — через ${fmtDur(K.lastW - bed)} после засыпания`;
    sub = `Когда уснёт снова, нажми «${name} снова уснул» — я пересчитаю, когда начинать.`;
  } else if (bed == null) {
    const at = ub ? ub.at + L.d : null;
    line = at != null ? `Окно вдвоём ≈ ${hm(at)}` : `Начинайте через ${L.d} мин после того, как ${name} уснёт`;
    sub = ub ? `${name} обычно засыпает ≈ ${hm(ub.at)} (${hm(ub.lo)}–${hm(ub.hi)}), потом ${L.d} мин сон чуткий. ${at >= late ? short : ""}`
      : `Отмечай «${name} уснул» — по отбоям посчитаю, когда обычно получается.`;
  } else {
    const start = bed + L.d, left = start - now;
    ready = left <= 0;
    line = ready ? `Можно начинать — ${name} спит уже ${fmtDur(now - bed)}` : `Начинайте в ${hm(start)} — через ${fmtDur(left)}`;
    sub = ready
      ? (L.rule ? `Первые ~${L.d} минут сон у малышей поверхностный — они уже прошли.`
        : L.unsure ? `Он часто просыпается и после часа сна — если проснётся, продолжите, когда уснёт снова.`
        : L.bad ? `Раньше после такой выдержки он просыпался в ближайшие ${len} мин в ${L.bad} из ${L.of} раз.`
        : `Раньше после такой выдержки он ни разу не просыпался в ближайшие ${len} мин (${L.of} ${plural(L.of, "раз", "раза", "раз")}).`) + (now >= late ? ` ${short}` : "")
      : `${name} уснул в ${hm(bed)}, первые ${L.d} мин сон ещё чуткий${L.rule ? "" : " — так было в прошлые вечера"}. ${start >= late ? short : ""}`;
  }
  card.innerHTML = `<div class="r-ic"><svg viewBox="0 0 24 24" fill="none" stroke="var(--violet)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6.5C10 5 7 4.6 4 5v13c3-.4 6 0 8 1.5 2-1.5 5-1.9 8-1.5V5c-3-.4-6 0-8 1.5zM12 6.5v13"/></svg></div>
    <div class="pc-t"><span class="eyebrow">${esc(h.name)}</span><b>${esc(line)}</b><span>${esc(sub.trim())}</span></div>
    <button type="button" class="btn${ready ? "" : " ghost"}" data-duo="done">Сделали</button>`;
}
const bedDateNow = () => { const now = new Date(); return ymd(addDays(todayDate(), now.getHours() < 12 ? -1 : 0)); };
function countWakes() { return Object.values(S.data?.kid || {}).filter(v => v.wake).length; }

/* ---------- графики ---------- */
function roundTop(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
function chartWidth(el) { return Math.max(260, Math.round(el.clientWidth || el.parentElement?.clientWidth || 320)); }
function barChart(el, items, { h = 170, hl, max = 1, fmt = v => Math.round(v * 100) + "%", line = null, empty = "Данных за этот период пока нет." } = {}) {
  if (!items.some(it => it.value != null && (max === 1 || it.value > 0))) { el.innerHTML = `<p class="empty-c">${esc(empty)}</p>`; return; }
  const W = chartWidth(el), pl = max === 1 ? 34 : 48, pr = 4, pt = 8, pb = items.some(i => i.sub) ? 34 : 22, H = h;
  const iw = W - pl - pr, ih = H - pt - pb, step = iw / items.length, bw = Math.min(26, step * .62);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Столбчатая диаграмма">`;
  for (const g of [0, .5, 1]) {
    const y = pt + ih * (1 - g);
    s += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" class="grid"/><text x="${pl - 6}" y="${y + 3.5}" class="ax" text-anchor="end">${fmt(g * max)}</text>`;
  }
  if (line != null) { const y = pt + ih * (1 - Math.min(1, line / max)); s += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" class="fit"/>`; }
  items.forEach((it, i) => {
    const cx = pl + step * i + step / 2;
    if (it.value != null) {
      const bh = it.value > 0 ? Math.max(3, ih * Math.min(1, it.value / max)) : 0;
      if (bh) s += `<path d="${roundTop(cx - bw / 2, pt + ih - bh, bw, bh, 4)}" class="bar ${it.current ? "cur" : ""}"/>`;
    }
    s += `<rect x="${pl + step * i}" y="${pt}" width="${step}" height="${ih}" fill="transparent" data-tip="${esc(it.tip)}"/>`;
    s += `<text x="${cx}" y="${H - pb + 14}" class="ax ${hl && hl(i) ? "hl" : ""}" text-anchor="middle">${esc(it.label)}</text>`;
    if (it.sub) s += `<text x="${cx}" y="${H - pb + 26}" class="ax" text-anchor="middle">${esc(it.sub)}</text>`;
  });
  el.innerHTML = s + "</svg>";
}
// Время на вертикали идёт сверху вниз, как в календаре: раньше — выше
function timeScale(vals, padMin = 20) {
  let lo = Math.min(...vals) - padMin, hi = Math.max(...vals) + padMin;
  lo = Math.floor(lo / 30) * 30; hi = Math.ceil(hi / 30) * 30;
  if (hi - lo < 90) { const c = (hi + lo) / 2; lo = Math.floor((c - 45) / 30) * 30; hi = lo + 120; }
  const stepT = hi - lo > 240 ? 60 : 30;
  return { lo, hi, ticks: Array.from({ length: Math.floor((hi - lo) / stepT) + 1 }, (_, i) => lo + i * stepT) };
}
function scatterChart(el, pts) {
  const W = chartWidth(el), H = 220, pl = 40, pr = 10, pt = 10, pb = 26;
  const iw = W - pl - pr, ih = H - pt - pb;
  const xs = timeScale(pts.map(p => p.x)), ys = timeScale(pts.map(p => p.y));
  const X = v => pl + (v - xs.lo) / (xs.hi - xs.lo) * iw, Y = v => pt + (v - ys.lo) / (ys.hi - ys.lo) * ih;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Отбой и подъём">`;
  ys.ticks.forEach(v => { s += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${pl - 6}" y="${Y(v) + 3.5}" class="ax" text-anchor="end">${hm(v)}</text>`; });
  xs.ticks.forEach(v => { s += `<text x="${X(v)}" y="${H - 8}" class="ax" text-anchor="middle">${hm(v)}</text>`; });
  let fit = null;
  if (pts.length >= 6) {
    const mx = mean(pts.map(p => p.x)), my = mean(pts.map(p => p.y));
    const vx = pts.reduce((a, p) => a + (p.x - mx) ** 2, 0);
    if (vx > 0) {
      const slope = pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / vx;
      fit = { slope, a: my - slope * mx };
      const x1 = Math.min(...pts.map(p => p.x)), x2 = Math.max(...pts.map(p => p.x));
      s += `<line x1="${X(x1)}" y1="${Y(fit.a + slope * x1)}" x2="${X(x2)}" y2="${Y(fit.a + slope * x2)}" class="fit"/>`;
    }
  }
  pts.forEach(p => { s += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="5" class="dot" data-tip="${esc(p.tip)}"/>`; });
  el.innerHTML = s + "</svg>";
  return fit;
}
function rangeChart(el, rows) {
  const vals = rows.flatMap(r => r.q ? [r.q[0], r.q[2]] : []);
  if (!vals.length) { el.innerHTML = `<p class="empty-c">Появится, когда наберётся хотя бы по два подъёма в одни и те же дни недели.</p>`; return; }
  const W = chartWidth(el), H = 220, pl = 40, pr = 6, pt = 10, pb = 22;
  const iw = W - pl - pr, ih = H - pt - pb, ys = timeScale(vals), step = iw / 7;
  const Y = v => pt + (v - ys.lo) / (ys.hi - ys.lo) * ih;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Подъём по дням недели">`;
  ys.ticks.forEach(v => { s += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${pl - 6}" y="${Y(v) + 3.5}" class="ax" text-anchor="end">${hm(v)}</text>`; });
  rows.forEach((r, i) => {
    const cx = pl + step * i + step / 2;
    if (r.q) {
      const y1 = Y(r.q[0]), y2 = Y(r.q[2]);
      s += `<rect x="${cx - 4}" y="${y1}" width="8" height="${Math.max(2, y2 - y1)}" rx="4" fill="var(--k2)"/>`;
      s += `<circle cx="${cx}" cy="${Y(r.q[1])}" r="5" class="dot"/>`;
    }
    s += `<rect x="${pl + step * i}" y="${pt}" width="${step}" height="${ih}" fill="transparent" data-tip="${esc(r.tip)}"/>`;
    s += `<text x="${cx}" y="${H - 6}" class="ax" text-anchor="middle">${DOW[i]}</text>`;
  });
  el.innerHTML = s + "</svg>";
}

/* ---------- отрисовка ---------- */
function notice(msg) { const n = $("#notice"); n.textContent = msg || ""; n.hidden = !msg; }
function renderSync() {
  const el = $("#sync"), p = S.pending.length;
  const map = {
    idle: ["", "не подключено"], loading: ["busy", "загружаю…"], saving: ["busy", "сохраняю…"],
    pending: ["busy", "сейчас сохраню"],
    saved: ["ok", S.savedAt ? `сохранено ${fmtTime.format(S.savedAt)}` : "сохранено"],
    offline: ["warn", p ? `не отправлено: ${p}` : "нет связи"],
    error: ["warn", p ? `не сохранено: ${p}` : "ошибка"],
  };
  const [cls, text] = S.cfg ? map[S.sync] || map.idle : map.idle;
  el.className = "sync " + cls; el.textContent = text;
}
function render() {
  renderSync(); renderHeader(); renderConnect(); renderNav();
  $("#connect-wrap").hidden = !(currentView() === "settings" || !S.cfg || !S.data);
  $("#main").hidden = !S.data;
  if (!S.data) return;
  renderToday(); renderPlan(); renderKid(); renderTogether(); renderWeek(); renderGoals();
  renderProgress(); renderSystem(); renderManage(); renderSettingsPanel();
  renderRitualCard(); renderSlotCard(); renderFocus(); renderBalance(); renderSlotPlan(); renderFocusTime();
  renderPrayCard(); renderDuoCard(); renderVerse(); renderPrayStats(); renderPraySettings(); renderNeeds(); renderRemind();
}
function renderHeader() {
  const t = todayDate(), tk = ymd(t), v = currentView();
  $("#today-title").textContent = v === "today" ? fmtLong.format(t) : VIEW_TITLES[v];
  $("#period-line").textContent = v === "today"
    ? `${MONTHS[t.getMonth()]} · ${Math.floor(t.getMonth() / 3) + 1}-й квартал · неделя ${isoWeek(t)}`
    : fmtLong.format(t);
  const sum = $("#today-sum");
  sum.hidden = v !== "today";
  if (!S.cfg && !S.data) { sum.textContent = "Подключи репозиторий с данными, чтобы открыть Keel."; return; }
  if (!S.data) { sum.textContent = "Загружаю данные с GitHub…"; return; }
  const hs = active();
  if (!hs.length) { sum.textContent = "Привычек пока нет. Добавь первую в настройках."; return; }
  const doneToday = hs.filter(h => isDone(tk, h.id)).length, fc = S.data.focus[tk] || [];
  sum.innerHTML = `${fc.length ? `Главное <b>${fc.filter(x => focusDone(x, tk)).length} из ${fc.length}</b>` : "Главное не выбрано"} · привычки <b>${doneToday} из ${hs.length}</b>`;
}
function renderToday() {
  const ul = $("#today-list"), t = todayDate(), tk = ymd(t), mon = monday(t), hs = active();
  if (!hs.length) { ul.innerHTML = '<li class="empty">Здесь появятся привычки, которые ты добавишь.</li>'; return; }
  ul.innerHTML = hs.map(h => {
    const on = isDone(tk, h.id), st = weekStatus(h, mon), sr = streak(h);
    const dots = Array.from({ length: Math.min(st.target, 7) }, (_, i) => `<i class="${i < st.count ? "on" : ""}"></i>`).join("");
    const streakTxt = sr > 1 ? ` · серия ${sr} ${plural(sr, "неделя", "недели", "недель")}` : "";
    return `<li><button type="button" class="hab" aria-pressed="${on}" data-toggle data-date="${tk}" data-hid="${esc(h.id)}">
      <span class="tick">${CHECK}</span>
      <span class="hab-main"><span class="hab-name">${esc(h.name)}</span>
        <span class="hab-meta">${h.sphere ? esc(h.sphere) + " · " : ""}${st.count} из ${st.target} за неделю · <span class="${st.cls}-t">${st.text}</span>${streakTxt}</span></span>
      <span class="dots" aria-hidden="true">${dots}</span>
    </button></li>`;
  }).join("");
}

function renderKid() {
  const st = settings(), name = kidName(), t = todayDate(), tk = ymd(t);
  const target = kidTarget(), isToday = target === tk, fc = forecast(target);
  $("#fc-when").textContent = `${name} проснётся · ${isToday ? "сегодня" : "завтра"}, ${fmtShort.format(parse(target))}`;
  const mh = habits().find(h => h.id === st.morningHabit), mins = st.morningMinutes || 30;
  const what = mh ? `«${mh.name}»` : "утреннее время";
  if (!fc) {
    const n = countWakes(), need = Math.max(1, 3 - n);
    $("#fc-time").textContent = "—";
    $("#fc-range").textContent = n
      ? `Нужно ещё ${need} ${plural(need, "подъём", "подъёма", "подъёмов")}, чтобы дать первый прогноз.`
      : `Отмечай каждое утро, когда ${name} проснулся. После трёх подъёмов появится первый прогноз.`;
    $("#fc-alarm").textContent = "—";
    $("#fc-plan").textContent = `Посчитаю, когда тебе вставать, чтобы до подъёма ${kidGen()} было ${mins} минут на ${what}.`;
    $("#fc-basis").textContent = "";
    $("#kid-aside").textContent = n ? `отмечено подъёмов: ${n}` : "";
  } else {
    $("#fc-time").textContent = hm(fc.pred);
    $("#fc-range").textContent = `скорее всего между ${hm(fc.lo)} и ${hm(fc.hi)}`;
    $("#fc-alarm").textContent = hm(fc.lo - mins);
    $("#fc-plan").textContent = `Будет ${mins} минут на ${what} до самого раннего ожидаемого подъёма.`;
    const parts = [`По ${fc.b.n} ${plural(fc.b.n, "подъёму", "подъёмам", "подъёмам")} за 6 недель`];
    if (fc.p) parts.push(`с поправкой на отбой накануне в ${hm(fc.p.bed)} (ночь обычно ${dur(fc.p.night)}, вес поправки ${Math.round(fc.wp * 100)}%)`);
    else if (!isToday) parts.push(`отбой сегодня ещё не отмечен — когда отметишь, прогноз уточнится`);
    let basis = parts.join(", ") + ".";
    if (fc.mae != null) basis += ` Прошлые прогнозы ошибались в среднем на ${Math.round(fc.mae)} мин (${fc.nBt} ${plural(fc.nBt, "проверка", "проверки", "проверок")}).`;
    $("#fc-basis").textContent = basis;
    $("#kid-aside").textContent = "";
  }
  // Кнопки: видна только та, что имеет смысл сейчас, и ничего не перезаписывает
  const K = kidButtons();
  $("#kid-wake-l").textContent = `${name} проснулся на день`;
  $("#kid-wake-s").textContent = `больше не уснёт${fc && isToday ? ` · прогноз ${hm(fc.pred)}` : ""}`;
  $("#kid-sleep-l").textContent = K.resleep ? `${name} снова уснул` : `${name} уснул`;
  $("#kid-sleep-s").textContent = K.resleep ? `проснулся в ${hm(K.lastW)}, через ${fmtDur(K.lastW - K.bed)} после засыпания` : "нажми, когда уснёт на ночь";
  $("#kid-night-l").textContent = `${name} проснулся ненадолго`;
  const nx = nextWake();
  $("#kid-night-s").textContent = `покормить и снова уснёт · ${K.nights.length ? `уже просыпался: ${K.nights.map(x => hm(toMin(x))).join(", ")}` : `уснул в ${hm(K.bed)}`}`
    + (nx?.at != null ? ` · следующий раз ≈ ${hm(nx.at)}` : "");
  // Промежуточные пробуждения: пока спит — когда проснётся в следующий раз
  $("#fc-next").textContent = !nx ? ""
    : nx.need ? `Прогноз промежуточных пробуждений появится, когда наберётся ещё ${nx.need} ${plural(nx.need, "отрезок", "отрезка", "отрезков")} сна.`
    : nx.long ? `Спит с ${hm(nx.last)} — дольше, чем обычно длятся отрезки сна.`
    : nx.morning ? `Спит с ${hm(nx.last)} · следующее пробуждение, скорее всего, уже на день.`
    : `Спит с ${hm(nx.last)} · следующее пробуждение ≈ ${hm(nx.at)} (${hm(nx.lo)}–${hm(nx.hi)})`;
  const rec = recFor(tk);
  $("#me-wake-l").textContent = "Я встал";
  $("#me-wake-s").textContent = rec != null ? `нажми, когда встанешь · план ${hm(rec)}` : "нажми, когда встанешь";
  $("#kid-wake").hidden = !K.wake; $("#kid-sleep").hidden = !K.bed0 && !K.resleep; $("#kid-night").hidden = !K.night; $("#me-wake").hidden = !K.me;
  [$("#kid-wake"), $("#kid-sleep"), $("#kid-night"), $("#me-wake")].forEach(el => { el.disabled = !canWrite(); });
  // Уже отмеченное — плашками; нажатие открывает редактор этой ночи
  const chip = (color, text) => `<button type="button" class="chip-done" data-fix="${K.night0}"><i style="background:${color}"></i>${esc(text)}</button>`;
  const chips = [];
  const tries0 = S.data.kid[K.night0]?.tries?.length || 0;
  if (K.bedDone != null) chips.push(chip("var(--blue)", `уснул в ${hm(K.bedDone)}${tries0 ? ` · с ${tries0 + 1}-го раза` : ""}`));
  if (K.nightsDone.length) chips.push(chip("var(--violet)", `просыпался: ${K.nightsDone.map(x => hm(toMin(x))).join(", ")}`));
  if (K.wakeDone != null) chips.push(chip("var(--amber)", `проснулся в ${hm(K.wakeDone)}`));
  if (K.meDone != null) chips.push(chip("var(--teal)", `ты встал в ${hm(K.meDone)}`));
  if (chips.length) chips.push(`<button type="button" class="chip-done fix" data-fix="${K.night0}">Исправить</button>`);
  else if (!K.wake && !K.bed0 && !K.night && !K.me) chips.push(`<span class="chip-note">Кнопка «${esc(name)} уснул» появится в ${hm(bedFrom())}.</span>`);
  $("#kid-done").innerHTML = chips.join("");
  // Если уже встал — вместо плана показываем, когда встал
  const meW = meWakeOf(tk), up = isToday && meW != null;
  $("#fc-me").classList.toggle("done", up);
  $("#fc-me-l").textContent = up ? "Ты встал" : isToday ? "Твой подъём" : `Твой подъём · завтра`;
  if (up) {
    const recT = recFor(tk), left = fc ? fc.pred - nowMin() : null;
    $("#fc-alarm").textContent = hm(meW);
    $("#fc-plan").textContent = [recT != null ? `План был ${hm(recT)} — ${diffText(meW - recT)}.` : "",
      left != null && left > 0 ? `До ожидаемого подъёма ${kidGen()} ещё ≈ ${fmtDur(left)}.` : ""].filter(Boolean).join(" ");
  }
  $("#lg-kid-wake").textContent = `${name} проснулся`;
  $("#lg-kid").textContent = `подъём ${kidGen()}`;
  renderKidCal(fc, target);
  renderKidTiles();
  renderKidCharts();
  renderKidSettings();
}
function renderKidCal(fc, target) {
  const box = $("#kcal"), narrow = (box.clientWidth || 360) < 480, nPast = narrow ? 9 : 14;
  const tk = ymd(todayDate()), m = kidModel();
  const last = addDays(parse(target), S.kidOffset * (nPast + 1));
  const days = Array.from({ length: nPast + 1 }, (_, i) => addDays(last, i - nPast));
  const showFc = S.kidOffset === 0 && fc;
  $("#kc-label").textContent = `${fmtDay.format(days[0])} – ${fmtDay.format(days[days.length - 1])}`;
  $("#kc-next").disabled = S.kidOffset >= 0;
  // Диапазон часов: 5:00–9:00 и шире, если данные выходят за край
  let lo = 300, hi = 540;
  const pts = days.flatMap(d => [wakeOf(ymd(d)), meWakeOf(ymd(d))]).filter(v => v != null);
  if (showFc) pts.push(fc.lo, fc.hi);
  days.forEach(d => { const x = m.btMap.get(ymd(d)); const c = x && m.comb(x); if (c != null && m.half) pts.push(c - m.half, c + m.half); });
  pts.forEach(v => { lo = Math.min(lo, Math.floor(v / 60) * 60); hi = Math.max(hi, Math.ceil((v + 1) / 60) * 60); });
  lo = Math.max(lo, 180); hi = Math.min(hi, 720);
  const rows = (hi - lo) / SLOT, sigma = showFc ? fc.half / 1.2816 : 1;
  let s = `<div class="kc-grid" style="--cols:${days.length}"><span></span>`;
  s += days.map(d => {
    const k = ymd(d), cls = [k === tk ? "today" : "", showFc && k === target ? "fc" : ""].join(" ");
    return `<span class="kc-head ${cls}">${DOW[dow(d)]}<b>${d.getDate()}</b></span>`;
  }).join("");
  for (let r = 0; r < rows; r++) {
    const a = lo + r * SLOT, z = a + SLOT, hr = a % 60 === 0;
    s += `<span class="kc-time">${hr ? hm(a) : ""}</span>`;
    for (const d of days) {
      const k = ymd(d), cls = ["kc-c", hr && r ? "hr" : "", r === 0 ? "first" : "", r === rows - 1 ? "last" : ""];
      let tip = "";
      if (showFc && k === target) {
        const zz = (a + SLOT / 2 - fc.pred) / sigma, dens = Math.exp(-zz * zz / 2);
        const lv = dens > .75 ? 4 : dens > .4 ? 3 : dens > .15 ? 2 : dens > .03 ? 1 : 0;
        if (lv) cls.push("f" + lv);
        // Свой подъём рисуем и в день прогноза — он уже мог случиться
        const me = meWakeOf(k), meHere = me != null && me >= a && me < z;
        if (meHere) cls.push("me");
        tip = `${fmtShort.format(d)} · ${meHere ? `ты встал в ${hm(me)} · ` : ""}${hm(a)}–${hm(z)}${lv >= 3 ? " · самое вероятное время" : lv ? " · возможно" : ""}`;
      } else if (d <= todayDate()) {
        const w = wakeOf(k), me = meWakeOf(k), x = m.btMap.get(k), c = x ? m.comb(x) : null;
        if (c != null && m.half && z > c - m.half && a < c + m.half) cls.push("band");
        const bits = [];
        if (w != null && w >= a && w < z) { cls.push("wk"); bits.push(`${kidName()} проснулся в ${hm(w)}${c != null ? ` (прогноз ${hm(c)})` : ""}`); }
        if (me != null && me >= a && me < z) { cls.push("me"); bits.push(`ты встал в ${hm(me)}`); }
        tip = `${fmtShort.format(d)} · ` + (bits.length ? bits.join(" · ")
          : `${hm(a)}–${hm(z)}${c != null && cls.includes("band") ? ` · в прогнозе было ${hm(c)}` : ""}`);
      }
      s += `<span class="${cls.join(" ")}" data-tip="${esc(tip)}"></span>`;
    }
  }
  if (!narrow) {
    const row = (label, fn, cls = "") => `<span class="kc-foot-l">${label}</span>` + days.map(d => `<span class="kc-foot ${cls}">${fn(d) ?? ""}</span>`).join("");
    s += row("подъём", d => { const v = wakeOf(ymd(d)); return v != null ? hm(v) : null; }, "w");
    s += row("ты", d => { const v = meWakeOf(ymd(d)); return v != null ? hm(v) : null; }, "me");
    s += row("отбой", d => { const v = bedOf(ymd(addDays(d, -1))); return v != null ? hm(v) : null; });
    s += row("просып.", d => { const n = S.data.kid[ymd(addDays(d, -1))]?.nights?.length; return n ? String(n) : null; });
  }
  box.innerHTML = s + "</div>";
}
function recentKid(days) {
  const t = todayDate(), wakes = [], beds = [], nights = [];
  for (let i = 0; i < days; i++) {
    const k = ymd(addDays(t, -i)), w = wakeOf(k), b = bedOf(k), pb = bedOf(ymd(addDays(t, -i - 1)));
    if (w != null) wakes.push(w);
    if (b != null) beds.push(b);
    if (w != null && pb != null) nights.push(w + 1440 - pb);
  }
  return { wakes, beds, nights };
}
const median = a => a.length ? wq(a, a.map(() => 1), .5) : null;
function renderKidTiles() {
  const r = recentKid(30), m = kidModel(), t = todayDate();
  let nn = 0, nc = 0, onPlan = 0, meDays = 0;
  for (let i = 1; i <= 14; i++) {
    const v = S.data.kid[ymd(addDays(t, -i))];
    if (v && (v.bed || v.nights)) { nc++; nn += (v.nights || []).length; }
  }
  for (let i = 0; i < 14; i++) {
    const k = ymd(addDays(t, -i)), me = meWakeOf(k), rec = recFor(k);
    if (me != null && rec != null) { meDays++; if (me <= rec + 10) onPlan++; }
  }
  const tile = (v, l) => `<div><b>${v ?? "—"}</b><span>${l}</span></div>`;
  $("#kid-tiles").innerHTML =
    tile(r.wakes.length ? hm(median(r.wakes)) : null, `${kidName()} встаёт`) +
    tile(r.beds.length ? hm(median(r.beds)) : null, "засыпает") +
    tile(r.nights.length ? dur(median(r.nights)) : null, "ночной сон") +
    tile(nc ? fmt1(nn / nc) : null, "пробуждений за ночь") +
    tile(m.mae != null ? `±${Math.round(m.mae)} мин` : null, "точность прогноза") +
    tile(meDays ? `${onPlan} из ${meDays}` : null, "ты встал по плану");
  renderInsights();
}
function renderInsights() {
  const t = todayDate(), out = [], st = settings(), name = kidName();
  const lo = [], hi = [];
  for (let i = 1; i <= 60; i++) {
    const d = addDays(t, -i), v = S.data.kid[ymd(d)], w = wakeOf(ymd(addDays(d, 1)));
    if (!v || !(v.bed || v.nights) || w == null) continue;
    ((v.nights || []).length >= 2 ? hi : lo).push(w);
  }
  if (lo.length >= 3 && hi.length >= 3) {
    const dlt = Math.round(mean(hi) - mean(lo));
    out.push(Math.abs(dlt) >= 5
      ? `После ночей с двумя и больше пробуждениями ${name} встаёт в среднем на ${Math.abs(dlt)} мин ${dlt > 0 ? "позже" : "раньше"}.`
      : `Ночные пробуждения почти не сдвигают утренний подъём ${kidGen()}.`);
  }
  const per = (from, to) => {
    let n = 0, c = 0;
    for (let i = from; i <= to; i++) { const v = S.data.kid[ymd(addDays(t, -i))]; if (v && (v.bed || v.nights)) { c++; n += (v.nights || []).length; } }
    return c >= 4 ? n / c : null;
  };
  const a = per(1, 7), b = per(8, 14);
  if (a != null && b != null && Math.abs(a - b) >= .3)
    out.push(`Пробуждений за ночь стало ${a < b ? "меньше" : "больше"}: ${fmt1(a)} за последнюю неделю против ${fmt1(b)} неделей раньше.`);
  const mh = st.morningHabit && habits().find(h => h.id === st.morningHabit);
  if (mh) {
    const y = [], n = [];
    for (let i = 0; i < 60; i++) {
      const k = ymd(addDays(t, -i)), me = meWakeOf(k), rec = recFor(k);
      if (me == null || rec == null) continue;
      (me <= rec + 10 ? y : n).push(isDone(k, mh.id));
    }
    if (y.length >= 3 && n.length >= 3)
      out.push(`Когда встаёшь по плану, «${mh.name}» получается в ${pct(y.filter(Boolean).length / y.length)} дней, а когда позже — в ${pct(n.filter(Boolean).length / n.length)}.`);
  }
  const on = onsets(), fs = on.filter(x => x <= 60);
  if (on.length >= 5) out.push(fs.length
    ? `Ложные засыпания: в ${fs.length} из ${on.length} раз ${name} просыпался в первый час после засыпания, обычно через ${Math.round(median(fs))} мин. Начинать вдвоём спокойнее через ${lightSleep().d} мин после засыпания.`
    : `${name} ни разу не просыпался в первый час после засыпания — можно начинать вдвоём почти сразу, как уснёт.`);
  $("#kid-insights").innerHTML = out.map(x => `<li>${esc(x)}</li>`).join("");
}
function renderKidCharts() {
  const t = todayDate(), pts = [];
  for (let i = 0; i < 60; i++) {
    const d = addDays(t, -i), w = wakeOf(ymd(d)), b = bedOf(ymd(addDays(d, -1)));
    if (w != null && b != null) pts.push({ x: b, y: w, tip: `${fmtShort.format(d)} · отбой ${hm(b)} → подъём ${hm(w)}` });
  }
  const sc = $("#sc-chart");
  if (pts.length < 4) {
    sc.innerHTML = `<p class="empty-c">Появится после 4 ночей, у которых отмечены и отбой, и подъём. Сейчас: ${pts.length}.</p>`;
    $("#sc-cap").textContent = "Каждая точка — одна ночь: во сколько уснул и во сколько проснулся утром.";
  } else {
    const fit = scatterChart(sc, pts);
    let cap = "Каждая точка — одна ночь за последние 60 дней.";
    if (fit) {
      const shift = Math.round(fit.slope * 30);
      cap += Math.abs(shift) < 4 ? " Время отбоя почти не сдвигает подъём."
        : shift > 0 ? ` Уснул на 30 минут позже — встаёт примерно на ${shift} мин позже.`
        : ` Уснул на 30 минут позже — встаёт примерно на ${-shift} мин раньше.`;
    } else cap += " Линия связи появится после 6 ночей.";
    $("#sc-cap").textContent = cap;
  }
  const by = Array.from({ length: 7 }, () => []);
  for (let i = 0; i < 56; i++) { const d = addDays(t, -i), w = wakeOf(ymd(d)); if (w != null) by[dow(d)].push(w); }
  rangeChart($("#kw-chart"), by.map((a, i) => {
    if (a.length < 2) return { q: null, tip: `${DOW[i]} · мало данных (${a.length})` };
    const q = [wq(a, a.map(() => 1), .25), median(a), wq(a, a.map(() => 1), .75)];
    return { q, tip: `${DOW[i]} · обычно ${hm(q[1])}, чаще всего ${hm(q[0])}–${hm(q[2])} · ${a.length} ${plural(a.length, "день", "дня", "дней")}` };
  }));
}
function renderKidSettings() {
  const st = settings(), focus = document.activeElement;
  const set = (id, v) => { const el = $(id); if (el !== focus) el.value = v; };
  set("#ks-name", st.kidName || "");
  set("#ks-gen", st.kidNameGen || "");
  set("#ks-bedfrom", st.bedFrom || "21:00");
  if ($("#ks-min") !== focus) $("#ks-min").innerHTML = [10, 15, 20, 30, 45, 60, 90].map(n => `<option value="${n}" ${n === (st.morningMinutes || 30) ? "selected" : ""}>${n} мин</option>`).join("");
  if ($("#ks-habit") !== focus) $("#ks-habit").innerHTML = `<option value="">не выбрана</option>` +
    active().map(h => `<option value="${esc(h.id)}" ${h.id === st.morningHabit ? "selected" : ""}>${esc(h.name)}</option>`).join("");
  if ($("#ks-evhabit") !== focus) $("#ks-evhabit").innerHTML = `<option value="">не выбрана</option>` +
    active().map(h => `<option value="${esc(h.id)}" ${h.id === st.eveningHabit ? "selected" : ""}>${esc(h.name)}</option>`).join("");
  if ($("#ks-evmin") !== focus) $("#ks-evmin").innerHTML = [10, 15, 20, 30, 45, 60].map(n => `<option value="${n}" ${n === evMinutes() ? "selected" : ""}>${n} мин</option>`).join("");
  if (!$("#kf-date").value) fillKidForm(kidButtons().night0);
  else if (!$("#kid-form").contains(document.activeElement)) renderNightList();
}
// Форма описывает одну ночь: отбой и пробуждения — в день k, подъёмы — утром следующего дня
function renderNightList() {
  const t = todayDate(), hr = new Date().getHours(), sel = $("#kf-date").value, rows = [];
  for (let i = hr >= 17 ? 0 : 1; i <= 7; i++) {
    const d = addDays(t, -i), k = ymd(d), next = ymd(addDays(d, 1)), v = S.data.kid[k] || {};
    const w = wakeOf(next), me = meWakeOf(next), n = v.nights || [];
    const parts = [v.bed ? `уснул ${hm(toMin(v.bed))}` : "отбой —",
      (v.tries || []).length ? `ложно засыпал: ${v.tries.map(x => `${hm(toMin(x.s))}→${hm(toMin(x.w))}`).join(", ")}` : "",
      n.length ? `просыпался ${n.map(x => hm(toMin(x))).join(", ")}` : "",
      w != null ? `проснулся ${hm(w)}` : next <= ymd(t) ? "подъём —" : "", me != null ? `ты ${hm(me)}` : ""].filter(Boolean);
    rows.push(`<li><button type="button" class="night-row" data-night="${k}" aria-current="${k === sel}"><b>с ${fmtShort.format(d)} на ${fmtShort.format(addDays(d, 1))}</b><span>${esc(parts.join(" · "))}</span></button></li>`);
  }
  $("#night-list").innerHTML = rows.join("");
}
function openNight(k) {
  if (currentView() !== "settings") location.hash = "#settings";
  $("#kid-edit").open = true;
  fillKidForm(k);
  setTimeout(() => $("#kid-form").scrollIntoView({ behavior: "smooth", block: "center" }), 60);
}
function fillKidForm(k) {
  const v = S.data?.kid[k] || {}, next = ymd(addDays(parse(k), 1));
  $("#kf-date").value = k; $("#kf-date").max = ymd(todayDate());
  $("#kf-hint").textContent = `с ${fmtShort.format(parse(k))} на ${fmtShort.format(parse(next))}`;
  $("#kf-bed").value = v.bed || "";
  $("#kf-nights").value = (v.nights || []).map(x => hm(toMin(x))).join(", ");
  $("#kf-wake").value = S.data?.kid[next]?.wake || "";
  $("#kf-me").value = S.data?.me[next]?.wake || "";
  $("#kf-wake").disabled = $("#kf-me").disabled = next > ymd(todayDate());
  if (S.data) renderNightList();
}

function renderWeek() {
  const t = todayDate(), tk = ymd(t), st = settings();
  const busy = new Set(st.busyDays || []);
  const mon = addDays(monday(t), S.weekOffset * 7), sun = addDays(mon, 6);
  $("#week-label").textContent = mon.getMonth() === sun.getMonth()
    ? `${mon.getDate()}–${fmtDay.format(sun)}` : `${fmtDay.format(mon)} – ${fmtDay.format(sun)}`;
  $("#next").disabled = S.weekOffset >= 0;
  $("#now").disabled = S.weekOffset === 0;
  const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  const mark = i => busy.has(i) && st.busyLabel ? esc(st.busyLabel) : "&nbsp;";
  const head = `<thead><tr><th scope="col">Привычка</th>${days.map((d, i) =>
    `<th scope="col" class="${ymd(d) === tk ? "is-today" : ""}">${DOW[i]} ${d.getDate()}<span class="ch">${mark(i)}</span></th>`).join("")}</tr></thead>`;
  const hs = active();
  const body = !hs.length ? `<tr><td colspan="8" class="empty">Привычек пока нет.</td></tr>` : hs.map(h => {
    const ws = weekStatus(h, mon);
    const cells = days.map(d => {
      const k = ymd(d), on = isDone(k, h.id), future = d > t;
      return `<td class="${k === tk ? "today-col" : ""}"><button type="button" class="cell" aria-pressed="${on}" ${future ? "disabled" : ""}
        data-toggle data-date="${k}" data-hid="${esc(h.id)}" aria-label="${esc(h.name)}, ${fmtShort.format(d)}" title="${fmtShort.format(d)}">${CHECK}</button></td>`;
    }).join("");
    return `<tr><td class="name">${esc(h.name)}<small class="${ws.cls}-t">${ws.count} из ${ws.target} за неделю</small></td>${cells}</tr>`;
  }).join("");
  $("#week-table").innerHTML = head + `<tbody>${body}</tbody>`;
}

function periodFor(view, offset) {
  const t = todayDate();
  if (view === "month") {
    const from = new Date(t.getFullYear(), t.getMonth() + offset, 1);
    return { from, to: new Date(from.getFullYear(), from.getMonth() + 1, 0),
      label: `${MONTHS[from.getMonth()]} ${from.getFullYear()}`, short: MONTHS[from.getMonth()].toLowerCase() };
  }
  const from = new Date(t.getFullYear(), Math.floor(t.getMonth() / 3) * 3 + offset * 3, 1);
  const q = Math.floor(from.getMonth() / 3) + 1;
  return { from, to: new Date(from.getFullYear(), from.getMonth() + 3, 0),
    label: `${q}-й квартал ${from.getFullYear()}`,
    sub: `${MONTHS[from.getMonth()].toLowerCase()} — ${MONTHS[from.getMonth() + 2].toLowerCase()}`, short: `${q}-й квартал` };
}
function monthGrid(first, mini) {
  const t = todayDate(), tk = ymd(t), lead = dow(first), n = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  let s = mini ? `<div><p class="mini-t">${MONTHS[first.getMonth()]}</p>` : "<div>";
  s += `<div class="mgrid">${DOW.map(d => `<span class="mdow">${d}</span>`).join("")}`;
  for (let i = 0; i < lead; i++) s += "<span></span>";
  for (let day = 1; day <= n; day++) {
    const d = new Date(first.getFullYear(), first.getMonth(), day), k = ymd(d), future = d > t;
    const r = dayRatio(k), w = wakeOf(k);
    const tip = future ? `${fmtShort.format(d)} · впереди`
      : `${fmtShort.format(d)} · привычки ${r.n} из ${r.total}${w != null ? ` · ${kidName()} проснулся в ${hm(w)}` : ""}`;
    const cls = ["md", future ? "future" : "l" + lvlOf(r.r), k === tk ? "today" : ""].join(" ");
    s += `<span class="${cls}" data-tip="${esc(tip)}">${mini ? "" : `<b>${day}</b>${w != null ? `<i>${hm(w)}</i>` : ""}`}</span>`;
  }
  return s + "</div></div>";
}
function renderProgress() {
  const view = S.view, off = view === "month" ? S.monthOffset : S.quarterOffset;
  const P = periodFor(view, off), prev = periodFor(view, off - 1);
  document.querySelectorAll("#progress .seg button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.view === view)));
  $("#per-label").innerHTML = esc(P.label) + (P.sub ? `<small>${esc(P.sub)}</small>` : "");
  $("#per-next").disabled = off >= 0;
  $("#per-now").disabled = off === 0;
  $("#prog").classList.toggle("q", view === "quarter");
  $("#per-cal").innerHTML = view === "month" ? monthGrid(P.from, false)
    : `<div class="minis">${[0, 1, 2].map(i => monthGrid(new Date(P.from.getFullYear(), P.from.getMonth() + i, 1), true)).join("")}</div>`;

  const ns = normStats(P.from, P.to), ps = normStats(prev.from, prev.to);
  let cmp = "";
  if (ns.pct != null && ps.pct != null) {
    const dlt = Math.round((ns.pct - ps.pct) * 100);
    cmp = `<small class="${dlt >= 0 ? "up" : "down"}">${dlt >= 0 ? "+" : "−"}${Math.abs(dlt)} п.п. к прошлому периоду (${pct(ps.pct)})</small>`;
  }
  $("#per-stat").innerHTML = ns.pct == null
    ? `<b>—</b><span>норма ещё не начала считаться</span><small>Норма идёт с первого полного понедельника после создания привычки.</small>`
    : `<b>${pct(ns.pct)}</b><span>нормы выполнено · ${P.short}</span><small>${ns.done} ${plural(ns.done, "отметка", "отметки", "отметок")} при норме ${num(ns.exp)} на прошедшие дни</small>${cmp}`;
  $("#per-habits").innerHTML = ns.per.map(r => `<li>
      <div class="hb-top"><span>${esc(r.h.name)}</span><span class="v">${r.pct == null ? "ещё не считается" : `${r.done} из ${num(r.exp)} · ${pct(r.pct)}`}</span></div>
      <div class="hb"><i style="width:${Math.round((r.pct || 0) * 100)}%"></i></div>
    </li>`).join("") || '<li class="empty">Привычек пока нет.</li>';

  // Норма по неделям периода
  const t = todayDate(), weeks = [];
  for (let mon = monday(P.from); mon <= P.to; mon = addDays(mon, 7)) {
    if (mon > t) break;
    const sun = addDays(mon, 6), w = normStats(mon, sun), cur = t >= mon && t <= sun;
    weeks.push({ label: String(isoWeek(mon)), value: w.pct, current: cur,
      tip: `${fmtDay.format(mon)} – ${fmtDay.format(sun)} · ${w.pct == null ? "норма ещё не считалась" : pct(w.pct) + " нормы"}${cur ? " · неделя идёт" : ""}` });
  }
  barChart($("#wk-chart"), weeks);

  // Профиль по дням недели
  const end = P.to < t ? P.to : t, cnt = Array(7).fill(0), tot = Array(7).fill(0);
  for (let d = new Date(P.from); d <= end; d = addDays(d, 1)) {
    const k = ymd(d);
    for (const h of active()) {
      const es = effStart(h);
      if (es && d < es) continue;
      tot[dow(d)]++;
      if (isDone(k, h.id)) cnt[dow(d)]++;
    }
  }
  const busy = new Set(settings().busyDays || []), bl = settings().busyLabel;
  const vals = tot.map((x, i) => x ? cnt[i] / x : null);
  barChart($("#wd-chart"), DOW.map((d, i) => ({ label: d, value: vals[i],
    tip: `${d} · ${vals[i] == null ? "нет данных" : `${cnt[i]} из ${tot[i]} · ${pct(vals[i])}`}` })), { hl: i => busy.has(i) });
  const known = vals.map((v, i) => ({ v, i })).filter(x => x.v != null);
  let cap = "Доля привычек, отмеченных в этот день недели.";
  if (busy.size && bl) cap += ` Выделены дни «${bl}»: ${DOW.filter((_, i) => busy.has(i)).join(", ")}.`;
  if (known.length >= 4) {
    const best = known.reduce((a, b) => b.v > a.v ? b : a), worst = known.reduce((a, b) => b.v < a.v ? b : a);
    if (best.v - worst.v >= .15) cap += ` Лучше всего получается в ${DOW[best.i].toLowerCase()}, хуже всего — в ${DOW[worst.i].toLowerCase()}.`;
  }
  $("#wd-cap").textContent = cap;
}

function sphereOptions(sel) {
  const sp = settings().spheres || [];
  const list = !sel || sp.includes(sel) ? sp : [sel, ...sp];
  return `<option value="" ${sel ? "" : "selected"}>без сферы</option>` +
    list.map(s => `<option value="${esc(s)}" ${s === sel ? "selected" : ""}>${esc(s)}</option>`).join("");
}
function targetOptions(sel) {
  return [1, 2, 3, 4, 5, 6, 7].map(n => `<option value="${n}" ${n === sel ? "selected" : ""}>${n} в нед.</option>`).join("");
}
let addFormReady = false;
function renderManage() {
  if (!addFormReady) { $("#add-sphere").innerHTML = sphereOptions(""); $("#add-target").innerHTML = targetOptions(3); addFormReady = true; }
  if (document.activeElement?.closest?.("#mlist")) return;
  const can = canWrite(), hs = active();
  $("#add-btn").disabled = !can;
  $("#mlist").innerHTML = hs.length ? hs.map((h, i) => `<li data-hid="${esc(h.id)}">
      <label class="sr" for="n-${esc(h.id)}">Название</label>
      <input class="field name" id="n-${esc(h.id)}" type="text" value="${esc(h.name)}" maxlength="60" data-act="rename" ${can ? "" : "disabled"}>
      <label class="sr" for="s-${esc(h.id)}">Сфера</label>
      <select class="field" id="s-${esc(h.id)}" data-act="sphere" ${can ? "" : "disabled"}>${sphereOptions(h.sphere)}</select>
      <label class="sr" for="t-${esc(h.id)}">Норма</label>
      <select class="field" id="t-${esc(h.id)}" data-act="target" ${can ? "" : "disabled"}>${targetOptions(h.target || 1)}</select>
      <button type="button" class="btn ghost" data-act="up" aria-label="Выше" ${can && i > 0 ? "" : "disabled"}>↑</button>
      <button type="button" class="btn ghost" data-act="down" aria-label="Ниже" ${can && i < hs.length - 1 ? "" : "disabled"}>↓</button>
      <button type="button" class="btn ghost" data-act="archive" ${can ? "" : "disabled"}>В архив</button>
    </li>`).join("") : '<li class="empty">Добавь первую привычку формой выше.</li>';
  const ar = archived();
  $("#archive-wrap").hidden = !ar.length;
  $("#alist").innerHTML = ar.map(h => `<li data-hid="${esc(h.id)}"><span class="arch-name">${esc(h.name)}</span>
    ${S.confirmDelete === h.id
      ? `<span class="hab-meta">Удалить вместе с отметками?</span>
         <button type="button" class="btn danger" data-act="delete-yes" ${can ? "" : "disabled"}>Удалить</button>
         <button type="button" class="btn ghost" data-act="delete-no">Отмена</button>`
      : `<button type="button" class="btn ghost" data-act="restore" ${can ? "" : "disabled"}>Вернуть</button>
         <button type="button" class="btn ghost" data-act="delete" ${can ? "" : "disabled"}>Удалить</button>`}
  </li>`).join("");
}
function renderConnect() {
  const connected = !!S.cfg;
  $("#connect-state").textContent = connected
    ? `Подключено к ${S.cfg.repo}. Чтобы сменить токен, вставь новый и нажми «Сохранить».`
    : "Устройство не подключено. Нужен репозиторий с data.json и токен GitHub.";
  $("#cf-forget").hidden = !connected || !$("#cf-confirm").hidden;
  const repo = $("#cf-repo");
  if (!repo.value && document.activeElement !== repo) {
    repo.value = S.cfg?.repo || (location.hostname.endsWith(".github.io") ? location.hostname.split(".")[0] + "/habits-data" : "");
  }
  $("#cf-save").textContent = connected ? "Сохранить" : "Подключить";
}

/* ---------- всплывающее «Отменить» ---------- */
let toastTimer = null;
function toast(text, undo) {
  const el = $("#toast");
  S.undo = undo || null;
  el.innerHTML = `<span>${esc(text)}</span>${undo ? '<button type="button" id="toast-undo">Отменить</button>' : ""}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 8000);
}
function hideToast() { $("#toast").hidden = true; S.undo = null; }

/* ---------- Google Задачи (через Apps Script) ---------- */
const T = { data: lsGet(LS.tasks), loading: false, error: null, loadedAt: 0 };
function tasksUrl() {
  const st = settings();
  if (!st.tasksUrl || !st.tasksKey) return null;
  return st.tasksUrl + (st.tasksUrl.includes("?") ? "&" : "?") + "key=" + encodeURIComponent(st.tasksKey);
}
async function loadTasks(force) {
  const url = tasksUrl();
  if (!url || T.loading || (!force && Date.now() - T.loadedAt < 60000)) return;
  T.loading = true; renderPlan(); renderSettingsPanel();
  try {
    const r = await fetch(url, { cache: "no-store" });
    const j = await r.json();
    if (j.error) throw Object.assign(new Error(j.error), { code: j.error });
    T.data = { at: Date.now(), lists: j.lists || [], tasks: j.tasks || [] };
    lsSet(LS.tasks, T.data);
    T.error = null;
  } catch (e) { T.error = e; }
  T.loadedAt = Date.now(); T.loading = false;
  renderPlan(); renderBalance(); renderSystem(); renderSettingsPanel();
  if (S.data) { renderSlotCard(); renderSlotPlan(); renderNow(); }
  if (W.kind) { collectWizard(); renderWizard(); }
}
// Подзадачи: у задачи Google есть parent — id задачи-родителя из того же списка (вложенность одна)
const TIX = new WeakMap();
const byPos = (a, b) => (a.position || "") < (b.position || "") ? -1 : (a.position || "") > (b.position || "") ? 1 : 0;
function taskIndex() {
  if (!T.data) return { byId: new Map(), kids: new Map() };
  let ix = TIX.get(T.data);
  if (!ix || ix.n !== T.data.tasks.length) {
    ix = { n: T.data.tasks.length, byId: new Map(T.data.tasks.map(x => [x.id, x])), kids: new Map() };
    T.data.tasks.forEach(x => { if (x.parent) { if (!ix.kids.has(x.parent)) ix.kids.set(x.parent, []); ix.kids.get(x.parent).push(x); } });
    ix.kids.forEach(l => l.sort(byPos));
    TIX.set(T.data, ix);
  }
  return ix;
}
const parentOf = x => x.parent ? taskIndex().byId.get(x.parent) || null : null;
const kidsOf = x => taskIndex().kids.get(x.id) || [];
const effDue = x => x.due || parentOf(x)?.due || null;
// Дело, которое можно взять: открыто и не разбито на открытые подзадачи (тогда дела — сами подзадачи)
const actionable = x => x.status !== "completed" && parentOf(x)?.status !== "completed" && !kidsOf(x).some(c => c.status !== "completed");
// «Когда-нибудь» и «Ожидание» — не действия: их задачи не предлагаем, пока на обзоре недели
// не перенесёшь в проекты или следующие действия
const PARKED = /когда.?нибудь|someday|может.?быть|maybe|ожидани|^жду|waiting/i;
// Что делать со списком: сфера, "" — угадывать по словам, "__parked" — не предлагать.
// Выбор в «План → Баланс сфер» хранится в settings.listSpheres; без него парковку узнаём по названию
const listMode = title => { const m = settings().listSpheres || {}; return Object.hasOwn(m, title) ? m[title] : PARKED.test(title || "") ? "__parked" : ""; };
const listSphere = title => { const v = listMode(title); return v && v !== "__parked" && (settings().spheres || []).includes(v) ? v : null; };
const parked = x => listMode(x.list) === "__parked";
function taskSrc(x) {
  const p = parentOf(x), d = effDue(x);
  return `${x.list}${p ? ` › ${p.title}` : ""}${d ? ` · срок ${fmtDM.format(parse(d))}` : ""}`;
}
function tasksError() {
  if (!T.error) return "";
  const k = settings().tasksKey || "";
  if (T.error.code === "forbidden" && /^AKfycb/.test(k))
    return "Google Задачи: в поле ключа сохранён идентификатор развёртывания. Нужен ключ из журнала функции setup — см. шаг 4.";
  return T.error.code === "forbidden" ? "Google Задачи: ключ не подошёл. Запусти setup ещё раз и скопируй ключ из журнала выполнения."
    : "Не удалось получить Google Задачи. Проверь адрес веб-приложения и что у развёртывания доступ «Все».";
}
async function taskSet(task, done, quiet) {
  const st = settings(), before = { status: task.status, completed: task.completed };
  task.status = done ? "completed" : "needsAction";
  task.completed = done ? new Date().toISOString() : null;
  task.touched = true;
  renderPlan(); renderSystem();
  try {
    const r = await fetch(st.tasksUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ key: st.tasksKey, action: done ? "complete" : "reopen", listId: task.listId, id: task.id }) });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    lsSet(LS.tasks, T.data);
    renderBalance();
    if (done && !quiet) toast(`Готово: ${task.title}`, () => taskSet(task, false));
  } catch (e) {
    Object.assign(task, before);
    notice("Не удалось отметить задачу в Google Задачах. Проверь связь и попробуй ещё раз.");
    renderPlan(); renderSystem();
  }
}

/* ---------- план ---------- */
const ICON = {
  sun: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="12" r="4" fill="var(--wake)"/><path d="M10 3v2.5M4 6l1.6 1.6M16 6l-1.6 1.6M2 17h16" stroke="var(--wake)" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>',
  me: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="9" width="14" height="3" rx="1.5" fill="var(--pine)"/><path d="M10 3v3.5M5.5 5l1.3 2M14.5 5l-1.3 2" stroke="var(--pine)" stroke-width="1.8" stroke-linecap="round"/></svg>',
  clock: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" fill="none" stroke="var(--ink-soft)" stroke-width="1.8"/><path d="M10 5.5V10l3 2" stroke="var(--ink-soft)" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>',
  heart: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 17s-6.5-4-6.5-8.6A3.6 3.6 0 0 1 10 6a3.6 3.6 0 0 1 6.5 2.4C16.5 13 10 17 10 17z" fill="var(--gold)"/></svg>',
};
const planTarget = () => new Date().getHours() < 12 ? todayDate() : addDays(todayDate(), 1);
function slotsOn(d) { return (settings().slots || []).filter(x => x.dow === dow(d)).sort((a, b) => a.from < b.from ? -1 : 1); }
function nextSlot(d) {
  for (let i = 1; i <= 7; i++) { const x = addDays(d, i), sl = slotsOn(x); if (sl.length) return { date: x, ...sl[0] }; }
  return null;
}
S.dayOpen = lsGet("habits.dayOpen") === true;
$("#day-toggle").addEventListener("click", () => { S.dayOpen = !S.dayOpen; lsSet("habits.dayOpen", S.dayOpen || null); renderPlan(); });
const dayOffset = () => S.dayOff ?? (new Date().getHours() >= 19 ? 1 : 0);
const hz = x => String(x).replace(/^0(\d)/, "$1");
function renderPlan() {
  if (!S.data) return;
  const off = dayOffset(), d = addDays(todayDate(), off), k = ymd(d), isToday = off === 0, st = settings(), name = kidName();
  document.querySelectorAll("#day .seg button").forEach(b => b.setAttribute("aria-selected", String(Number(b.dataset.day) === off)));
  $("#day-title").textContent = isToday ? "День" : "Завтра";
  const ev = [], add = (t, time, cls, b, sub = "", end = null) => ev.push({ t, time, cls, b, sub, end });
  const mw = meWakeOf(k), rec = recFor(k), mh = habits().find(h => h.id === st.morningHabit), mins = st.morningMinutes || 30;
  if (mw != null) add(mw, hm(mw), "me done", "Ты встал", rec != null ? diffText(mw - rec) : "");
  else if (rec != null) add(rec, hm(rec), "me", "Ты встаёшь", `${mins} мин на ${mh ? `«${mh.name}»` : "утреннее время"}`);
  const kw = wakeOf(k), f = forecast(k);
  if (kw != null) add(kw, hm(kw), "kid done", `${name} проснулся`, f ? `прогноз был ${hm(f.pred)}` : "");
  else if (f) add(f.lo, `${hm(f.lo)}–${hm(f.hi)}`, "kid band", `${name} проснётся ≈ ${hm(f.pred)}`, "прогноз по прошлым утрам", f.hi);
  const w = st.work;
  if (w && w.from && w.to && (w.days || []).includes(dow(d))) add(toMin(w.from), `${hz(w.from)}–${hz(w.to)}`, "work", "Работа", "", toMin(w.to));
  if ((st.busyDays || []).includes(dow(d)) && st.busyLabel) add(18 * 60 + 30, "вечер", "busy", st.busyLabel[0].toUpperCase() + st.busyLabel.slice(1));
  const bedDay = bedOf(k), beds = recentKid(30).beds;
  if (bedDay != null) add(bedDay, hm(bedDay), "kid done", `${name} уснул`);
  else if (beds.length >= 3) {
    const one = beds.map(() => 1);
    add(median(beds), `≈ ${hm(median(beds))}`, "kid", `Отбой ${kidGen()}`, `обычно ${hm(wq(beds, one, .25))}–${hm(wq(beds, one, .75))}`);
  }
  const eh = evHabit(), ub = usualBed();
  if (eh && !isDone(k, eh.id) && (bedDay != null || ub)) {
    const L = lightSleep(), base = bedDay ?? ub.at;
    add(base + L.d, `≈ ${hm(base + L.d)}`, "tl-duo", "Молитва и чтение вдвоём", bedDay != null ? `через ${L.d} мин после того, как ${name} уснул` : `если ${name} уснёт ≈ ${hm(base)}`);
  }
  slotsOn(d).forEach(x => {
    const ss = sess(sKey(k, x.from)), stx = { done: " · сделано", started: " · идёт", skipped: " · пропущен", moved: " · перенесён" }[ss?.status] || "";
    add(toMin(x.from), `${hz(x.from)}–${hz(x.to)}`, "slot" + (ss?.status === "done" ? " done" : ""), "Свободный слот", ss?.text ? `${ss.text}${stx}` : "шаг не выбран", toMin(x.to));
  });
  (S.data.prayer[k] || []).forEach(x => add(toMin(x.s), hm(toMin(x.s)), "pr done", "Молитва", fmtDur(x.m)));
  const pr = prRun();
  if (pr && pr.date === k) add(toMin(pr.s), hm(toMin(pr.s)), "pr", pr.paused ? "Молитва на паузе" : "Молитва идёт", mmss(prElapsed(pr)));
  if (isToday) {
    const m = nowMin();
    ev.push({ t: m + .5, now: true, time: hm(m) });
    // То, что идёт прямо сейчас (работа, слот), встаёт сразу под «сейчас», а не остаётся в прошлом по времени начала
    ev.forEach(e => {
      if (e.end == null || /done/.test(e.cls) || !(e.t <= m && m < e.end)) return;
      e.t = m + .6; e.cls += " cur"; e.cur = true;
      if (!/band/.test(e.cls)) e.sub = [`идёт · до ${hm(e.end)}, ещё ${fmtDur(e.end - m)}`, e.sub].filter(Boolean).join(" · ");
    });
  }
  ev.sort((x, y) => x.t - y.t);
  const nowT = isToday ? ev.find(e => e.now).t : -1, cur = ev.filter(e => e.cur);
  const ahead = ev.filter(e => !e.now && !e.cur && e.t >= nowT && !/done/.test(e.cls)).slice(0, cur.length ? 1 : 2);
  const curTxt = cur.length ? `<span>Сейчас:</span> ${cur.map(e => `<b>${esc(e.b)}</b> до ${hm(e.end)}`).join(" · ")}` : "";
  $("#day-next").innerHTML = [curTxt, ahead.length
    ? `<span>${isToday ? "Дальше" : "Завтра"}:</span> ${ahead.map(e => `<b>${esc(e.time)}</b> ${esc(e.b)}`).join(" · ")}`
    : cur.length ? "" : `<span>${isToday ? "На сегодня в ленте больше ничего" : "На завтра в ленте пусто"}</span>`].filter(Boolean).join("<br>");
  $("#day").classList.toggle("open", !!S.dayOpen);
  $("#day-toggle").textContent = S.dayOpen ? "Свернуть" : "Показать весь день";
  $("#day-toggle").setAttribute("aria-expanded", String(!!S.dayOpen));
  $("#day-tl").innerHTML = ev.filter(e => !e.now).length
    ? ev.map(e => e.now ? `<li class="now"><time>${e.time}</time><span>сейчас</span></li>`
      : `<li class="${e.cls}"><time>${esc(e.time)}</time><div><b>${esc(e.b)}</b>${e.sub ? `<span>${esc(e.sub)}</span>` : ""}</div></li>`).join("")
    : `<li class="empty">Лента заполнится, когда появятся прогноз подъёма, рабочие часы или слоты — они задаются в настройках.</li>`;

  const hs = active(), tk0 = ymd(todayDate());
  $("#hab-count").textContent = hs.length ? `${hs.filter(h => isDone(tk0, h.id)).length} из ${hs.length}` : "";

  $("#tasks-title").textContent = isToday ? "Задачи" : "Задачи на завтра";
  const ul = $("#plan-tasks"), foot = $("#plan-foot");
  if (!tasksUrl()) {
    ul.innerHTML = `<li class="empty">Подключи Google Задачи в настройках — здесь появятся задачи с датой.</li>`;
    foot.textContent = ""; return;
  }
  if (!T.data) {
    ul.innerHTML = `<li class="empty">${T.loading ? "Загружаю задачи…" : esc(tasksError() || "Задачи ещё не загружены.")}</li>`;
    foot.textContent = ""; return;
  }
  const open = T.data.tasks.filter(x => (x.status !== "completed" || x.touched) && parentOf(x)?.status !== "completed");
  const byDue = (a, b) => (a.due || "") < (b.due || "") ? -1 : 1;
  const groups = [
    ["Просрочено", open.filter(x => x.due && x.due < tk0).sort(byDue), "warn"],
    ["Осталось на сегодня", isToday ? [] : open.filter(x => x.due === tk0), ""],
    [isToday ? "На сегодня" : "На завтра", open.filter(x => x.due === k), ""],
  ].filter(g => g[1].length);
  // Подзадачи — под своей задачей. Если в группу попала только подзадача, её задача становится заголовком
  const nodes = list => {
    const m = new Map();
    for (const x of list) { const r = parentOf(x) || x; if (!m.has(r.id)) m.set(r.id, { x: r, head: !list.includes(r) }); }
    for (const n of m.values()) n.kids = kidsOf(n.x).filter(c => open.includes(c) && (n.head ? list.includes(c) : !c.due || list.includes(c)));
    return [...m.values()];
  };
  const meta = (x, sub) => {
    const k = kidsOf(x), parts = sub ? [] : [x.list];
    if (x.due && x.due < tk0) parts.push(`срок ${fmtDM.format(parse(x.due))}`);
    if (k.length) parts.push(`подзадачи: ${k.filter(c => c.status === "completed").length} из ${k.length}`);
    return parts.length ? `<small>${esc(parts.join(" · "))}</small>` : "";
  };
  const li = (x, cls = "") => `<li class="pt${cls}${x.status === "completed" ? " done" : ""}"><button type="button" data-task="${esc(x.id)}" aria-label="${x.status === "completed" ? "Вернуть задачу" : "Отметить выполненной"}: ${esc(x.title)}">${CHECK}</button>
    <span class="pt-t">${esc(x.title)}${meta(x, cls.includes("sub"))}</span></li>`;
  const node = n => {
    const kids = n.kids.slice(0, 6), more = n.kids.length - kids.length;
    return (n.head ? `<li class="pt-head">${esc(n.x.title)}<small>${esc(n.x.list)}</small></li>` : li(n.x, kids.length ? " par" : ""))
      + kids.map((c, i) => li(c, " sub" + (i === kids.length - 1 && !more ? " last" : ""))).join("")
      + (more ? `<li class="pt sub last more">и ещё ${more} ${plural(more, "подзадача", "подзадачи", "подзадач")}</li>` : "");
  };
  const undated = open.filter(x => !x.due && !x.parent && x.status !== "completed").length;
  ul.innerHTML = groups.length
    ? groups.map(([title, list, cls]) => { const ns = nodes(list);
      return `<li class="grp ${cls}">${title} · ${ns.length}</li>` + ns.slice(0, 8).map(node).join("")
        + (ns.length > 8 ? `<li class="empty">и ещё ${ns.length - 8}</li>` : ""); }).join("")
    : `<li class="empty">На ${isToday ? "сегодня" : "завтра"} задач с датой нет.${undated ? ` Без даты: ${undated}.` : ""}</li>`;
  foot.innerHTML = `${T.loading ? "обновляю…" : `обновлено ${fmtTime.format(new Date(T.data.at))}`} · <button type="button" class="linkbtn" id="tasks-reload">Обновить</button>`
    + (T.error ? ` · <span class="warn-t">${esc(tasksError())}</span>` : "");
}

/* ---------- вкладки ---------- */
const ICONS = {
  today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg>',
  plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4M9 15l2 2 4-4"/></svg>',
  prayer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c2.5 3 4 5 4 7.5a4 4 0 0 1-8 0C8 8 9.5 6 12 3z"/><path d="M6 21h12M9 21v-4.5M15 21v-4.5"/></svg>',
  sleep: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 4a8.5 8.5 0 1 0 4.8 12.4A7 7 0 0 1 15.5 4z"/></svg>',
  results: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 19V11M10 19V6M15 19v-9M20 19v-5"/></svg>',
};
const VIEWS = [["today", "Сегодня"], ["plan", "План"], ["prayer", "Молитва"], ["sleep", "Сон"], ["results", "Итоги"]];
const VIEW_TITLES = { plan: "План", prayer: "Молитва", sleep: "Сон", results: "Итоги", settings: "Настройки" };
// старые адреса вкладок из закладок
const VIEW_ALIASES = { morning: "sleep", goals: "plan" };
function currentView() {
  const h = location.hash.slice(1), v = VIEW_ALIASES[h] || h;
  return v === "settings" || VIEWS.some(x => x[0] === v) ? v : "today";
}
function renderNav() {
  const v = currentView();
  const html = VIEWS.map(([id, title]) => `<a href="#${id}"${id === v ? ' aria-current="page"' : ""}>${ICONS[id]}<span>${title}</span></a>`).join("");
  document.querySelectorAll("[data-nav]").forEach(n => { n.innerHTML = html; });
  $(".gear").classList.toggle("on", v === "settings");
}
function route() {
  const v = currentView();
  document.querySelectorAll(".view[data-view]").forEach(el => { el.hidden = el.dataset.view !== v; });
  render();
}
function openConnect() {
  $("#connect-panel").open = true;
  if (currentView() !== "settings") location.hash = "#settings";
}
addEventListener("hashchange", () => { route(); scrollTo(0, 0); });

/* ---------- время вдвоём ---------- */
function togetherInfo() {
  const st = settings(), norm = st.togetherPerWeek || 1, dates = Object.keys(S.data?.together || {}).sort();
  const last = dates[dates.length - 1] || null;
  const days = last ? Math.round((todayDate() - parse(last)) / 864e5) : null;
  const gap = Math.ceil(7 / norm);
  const normText = norm === 1 ? "раз в неделю" : `${norm} ${plural(norm, "раз", "раза", "раз")} в неделю`;
  return { norm, dates, last, days, gap, normText, overdue: days != null && days > gap };
}
function renderTogether() {
  const tg = togetherInfo(), tk = ymd(todayDate()), T2 = S.data.together;
  if ($("#tg-norm") !== document.activeElement)
    $("#tg-norm").innerHTML = [1, 2, 3, 4, 5, 6, 7].map(n => `<option value="${n}" ${n === tg.norm ? "selected" : ""}>${n === 1 ? "раз" : n + " раза"} в нед.</option>`).join("");
  const big = $("#tg-big");
  if (!tg.last) big.innerHTML = `<b>—</b><span>пока нет записей</span><small>Отмечай вечера, прогулки и разговоры вдвоём. Счётчик покажет, сколько дней прошло с последнего.</small>`;
  else if (tg.days === 0) big.innerHTML = `<b>0</b><span>сегодня были вдвоём</span><small>${esc(T2[tg.last]?.note || "")}</small>`;
  else big.innerHTML = `<b class="${tg.overdue ? "warn" : ""}">${tg.days}</b><span>${plural(tg.days, "день", "дня", "дней")} с последнего времени вдвоём</span>
    <small>последний раз: ${fmtShort.format(parse(tg.last))}${T2[tg.last]?.note ? ` — ${esc(T2[tg.last].note)}` : ""}</small>`;
  const cur = monday(todayDate()), first = tg.dates[0] ? monday(parse(tg.dates[0])) : null;
  let cells = "", met = 0, counted = 0;
  for (let i = 11; i >= 0; i--) {
    const mon = addDays(cur, -7 * i), keys = tg.dates.filter(k => k >= ymd(mon) && k <= ymd(addDays(mon, 6)));
    const isCur = i === 0, before = !first || mon < first;
    if (!isCur && !before) { counted++; if (keys.length >= tg.norm) met++; }
    const cls = before && !keys.length ? "none" : keys.length >= tg.norm ? "on" : keys.length ? "part" : "";
    cells += `<span class="${cls} ${isCur ? "cur" : ""}" data-tip="${esc(`${fmtDay.format(mon)} – ${fmtDay.format(addDays(mon, 6))} · ${keys.length ? keys.length + " " + plural(keys.length, "раз", "раза", "раз") : "не было"}${isCur ? " · неделя идёт" : ""}`)}"></span>`;
  }
  $("#tg-weeks").innerHTML = cells;
  $("#tg-weeks-cap").textContent = counted ? `Последние 12 недель. Норма выполнена в ${met} из ${counted} прошедших недель с первой записи.` : "Последние 12 недель: закрашена неделя, где норма выполнена.";
  $("#tg-btn").textContent = T2[tk] ? "Изменить заметку" : "Сегодня были вдвоём";
  $("#tg-btn").disabled = !canWrite();
  $("#tg-list").innerHTML = tg.dates.slice(-6).reverse().map(k => `<li><span class="d">${fmtShort.format(parse(k))}</span>
    <span class="n">${esc(T2[k]?.note || "")}</span><button type="button" class="xbtn" data-tgdel="${k}" aria-label="Удалить запись">×</button></li>`).join("");
}

/* ---------- стратегические цели ---------- */
const goalsActive = () => (S.data?.goals || []).filter(g => !g.archived)
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.deadline < b.deadline ? -1 : 1));
const gCur = g => g.history?.length ? g.history[g.history.length - 1].v : Number(g.start) || 0;
function gFrac(g) {
  if (g.kind === "steps") { const s = g.steps || []; return s.length ? s.filter(x => x.done).length / s.length : 0; }
  const span = Number(g.target) - (Number(g.start) || 0);
  return span ? (gCur(g) - (Number(g.start) || 0)) / span : 0;
}
function gTime(g) {
  const s = parse(g.startDate || g.created || ymd(todayDate())), e = parse(g.deadline), t = todayDate();
  const total = Math.max(1, Math.round((e - s) / 864e5)), elapsed = Math.max(0, Math.round((t - s) / 864e5));
  return { s, e, total, elapsed, left: Math.round((e - t) / 864e5), expected: Math.max(0, Math.min(1, elapsed / total)) };
}
function gStatus(g) {
  const f = gFrac(g), tm = gTime(g);
  if (f >= 1) return { cls: "done", text: "достигнута" };
  if (tm.left < 0) return { cls: "warn", text: "срок прошёл" };
  if (tm.elapsed < 7 && f <= 0) return { cls: "", text: "старт" };
  const d = f - tm.expected;
  if (d >= .1) return { cls: "ok", text: "опережает" };
  if (d >= 0) return { cls: "ok", text: "в графике" };
  if (d >= -.05) return { cls: "", text: "чуть позади" };
  return { cls: "warn", text: "отстаёт" };
}
// Когда цель будет достигнута при среднем темпе с начала
function gEta(g) {
  const f = gFrac(g), tm = gTime(g);
  if (f >= 1 || f <= 0 || tm.elapsed < 7) return null;
  return addDays(todayDate(), Math.ceil((1 - f) / (f / tm.elapsed)));
}
function goalCard(g) {
  const st = gStatus(g), tm = gTime(g), f = gFrac(g), eta = gEta(g), unit = g.unit ? " " + esc(g.unit) : "";
  const bar = `<div class="g-bar" data-tip="${esc(`Сделано ${pct(f)} · по плану на сегодня ${pct(tm.expected)}`)}"><i style="width:${Math.max(0, Math.min(1, f)) * 100}%"></i><em style="left:${tm.expected * 100}%"></em></div>`;
  const etaTxt = !eta ? "" : eta <= tm.e ? ` При текущем темпе — к ${fmtDate(eta)}, раньше срока.` : ` При текущем темпе — только к ${fmtDate(eta)}.`;
  let body;
  if (g.kind === "steps") {
    const s = g.steps || [], done = s.filter(x => x.done).length;
    const pace = st.cls === "done" ? "Все этапы пройдены." : `По плану сейчас должно быть ${Math.round(tm.expected * s.length)} из ${s.length}.${etaTxt}`;
    body = `<p class="g-val"><b>${done}</b> из ${s.length} ${plural(s.length, "этапа", "этапов", "этапов")} · ${pct(f)}</p>${bar}<p class="g-pace">${esc(pace)}</p>
      <ul class="g-steps">${s.map(x => `<li class="${x.done ? "done" : ""}"><input type="checkbox" data-gstep="${esc(x.id)}" ${x.done ? "checked" : ""} aria-label="${esc(x.t)}" ${canWrite() ? "" : "disabled"}>
        <span>${esc(x.t)}</span><button type="button" class="xbtn" data-gstepdel="${esc(x.id)}" aria-label="Удалить этап">×</button></li>`).join("")}</ul>
      <form class="g-upd" data-gaddstep><input class="field" type="text" placeholder="Новый этап" maxlength="80" aria-label="Новый этап"><button class="btn ghost sm" type="submit">Добавить</button></form>`;
  } else {
    const cur = gCur(g), start = Number(g.start) || 0, target = Number(g.target);
    const planNow = start + tm.expected * (target - start);
    let pace = "";
    if (st.cls !== "done") {
      pace = `По плану сейчас нужно ${smart(planNow)}${g.unit ? " " + g.unit : ""}.`;
      if (tm.left > 0) {
        const need = (target - cur) / Math.max(1, tm.left / 30.44);
        pace += ` Чтобы успеть — ${need >= 0 ? "+" : "−"}${smart(Math.abs(need))}${g.unit ? " " + g.unit : ""} в месяц.`;
      }
      pace += etaTxt;
    } else pace = "Цель достигнута.";
    body = `<p class="g-val"><b>${fmtN.format(cur)}</b> из ${fmtN.format(target)}${unit} · ${pct(f)}</p>${bar}<p class="g-pace">${esc(pace)}</p>
      <div class="g-spark" data-gspark></div>
      <form class="g-upd" data-gupd><input class="field" type="number" step="any" inputmode="decimal" placeholder="Сколько" aria-label="Значение">
        <button class="btn sm" type="submit" data-mode="add">Прибавить</button><button class="btn ghost sm" type="submit" data-mode="set">Новое значение</button></form>`;
  }
  const dl = `до ${fmtDate(tm.e)}` + (tm.left >= 0 ? ` · осталось ${tm.left} ${plural(tm.left, "день", "дня", "дней")}` : "");
  const conf = S.confirmGoal === g.id;
  const edit = `<details class="g-edit"><summary>Изменить</summary><form class="fgrid" data-gedit>
    <label class="wide">Название <input class="field" name="title" value="${esc(g.title)}" maxlength="80"></label>
    ${g.kind === "steps" ? "" : `<label class="wide">Следующий шаг <input class="field" name="next" value="${esc(g.next || "")}" maxlength="100" placeholder="Конкретное действие на 1–1,5 часа"></label>`}
    <label>Сфера <select class="field" name="sphere">${sphereOptions(g.sphere)}</select></label>
    <label>Начало <input class="field" type="date" name="startDate" value="${esc(g.startDate || "")}"></label>
    <label>Срок <input class="field" type="date" name="deadline" value="${esc(g.deadline)}"></label>
    ${g.kind === "steps" ? "" : `<label>Было <input class="field" type="number" step="any" name="start" value="${esc(g.start ?? 0)}"></label>
      <label>Цель <input class="field" type="number" step="any" name="target" value="${esc(g.target)}"></label>
      <label>Единица <input class="field" name="unit" value="${esc(g.unit || "")}" maxlength="12"></label>`}
    <button class="btn sm" type="submit">Сохранить</button>
    <button class="btn ghost sm" type="button" data-garch>В архив</button>
    ${conf ? `<button class="btn danger sm" type="button" data-gdelyes>Удалить навсегда</button><button class="btn ghost sm" type="button" data-gdelno>Отмена</button>`
      : `<button class="btn ghost sm" type="button" data-gdel>Удалить</button>`}
  </form></details>`;
  const ns = nextStepOf(g);
  const nextLine = st.cls === "done" ? "" : ns
    ? `<p class="g-next">Следующий шаг: <b>${esc(ns.text)}</b></p>`
    : `<p class="g-next missing">Нет следующего шага — ${g.kind === "steps" ? "добавь этап" : "впиши его в «Изменить»"}, чтобы поставить в слот.</p>`;
  return `<article class="goal" data-gid="${esc(g.id)}"><header><h3>${esc(g.title)}</h3><span class="chip ${st.cls}">${st.text}</span></header>
    <p class="g-meta">${g.sphere ? esc(g.sphere) + " · " : ""}${dl}</p>${body}${nextLine}${edit}</article>`;
}
function goalSpark(el, g) {
  const W = chartWidth(el), H = 86, pl = 2, pr = 2, pt = 6, pb = 16, tm = gTime(g), t = todayDate();
  const x0 = tm.s, x1 = tm.e > t ? tm.e : t, span = Math.max(1, (x1 - x0) / 864e5);
  const X = d => pl + ((d - x0) / 864e5) / span * (W - pl - pr);
  const start = Number(g.start) || 0, target = Number(g.target);
  const hist = (g.history || []).filter(h => parse(h.d) >= x0).map(h => ({ d: parse(h.d), v: h.v }));
  const vals = [start, target, ...hist.map(h => h.v)], lo = Math.min(...vals), hi = Math.max(...vals);
  const Y = v => pt + (1 - (v - lo) / ((hi - lo) || 1)) * (H - pt - pb);
  const pts = [{ d: x0, v: start }, ...hist, { d: t, v: gCur(g) }];
  let path = `M${X(pts[0].d)},${Y(pts[0].v)}`;
  for (let i = 1; i < pts.length; i++) path += `H${X(pts[i].d)}V${Y(pts[i].v)}`;
  const up = target >= start, base = Y(up ? lo : hi);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Динамика цели">`;
  s += `<line x1="${pl}" x2="${W - pr}" y1="${base}" y2="${base}" class="base"/>`;
  s += `<path d="${path}V${base}H${X(pts[0].d)}Z" class="area"/>`;
  s += `<line x1="${X(x0)}" y1="${Y(start)}" x2="${X(tm.e)}" y2="${Y(target)}" class="plan-l"/>`;
  s += `<path d="${path}" class="act"/><circle cx="${X(t)}" cy="${Y(gCur(g))}" r="4" class="gp"/>`;
  s += `<text x="${pl}" y="${H - 3}" class="ax">${fmtDM.format(x0)}</text><text x="${W - pr}" y="${H - 3}" class="ax" text-anchor="end">срок ${fmtDM.format(tm.e)}</text>`;
  el.innerHTML = s + "</svg>";
}
function renderGoals() {
  if (!S.data) return;
  const list = $("#goal-list");
  if (list.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
  const open = new Set([...list.querySelectorAll("details[open]")].map(d => d.closest("[data-gid]")?.dataset.gid));
  const gs = goalsActive(), ar = (S.data.goals || []).filter(g => g.archived);
  list.innerHTML = gs.length ? gs.map(goalCard).join("")
    : `<p class="empty">Пока нет целей. Добавь крупную цель на год или квартал: накопить сумму, выйти на новый уровень в работе, пройти курс. Числовая цель показывает темп и дату, к которой ты её достигнешь, а цель из этапов — сколько шагов пройдено.</p>`;
  if (ar.length) list.insertAdjacentHTML("beforeend", `<p class="note">В архиве: ${ar.map(g => `${esc(g.title)} <button type="button" class="linkbtn" data-grestore="${esc(g.id)}">вернуть</button>`).join(", ")}</p>`);
  list.querySelectorAll("[data-gid]").forEach(card => {
    if (open.has(card.dataset.gid)) card.querySelector("details")?.setAttribute("open", "");
    const sp = card.querySelector("[data-gspark]"), g = gs.find(x => x.id === card.dataset.gid);
    if (sp && g) goalSpark(sp, g);
  });
  const ok = gs.filter(g => ["ok", "done"].includes(gStatus(g).cls)).length;
  $("#goals-aside").textContent = gs.length ? `${gs.length} ${plural(gs.length, "цель", "цели", "целей")} · в графике ${ok} · риска — где нужно быть сегодня` : "";
  if (!gs.length && !ar.length) $("#goal-add").open = true;
  if (!$("#ga-sphere").options.length) $("#ga-sphere").innerHTML = sphereOptions("");
}

/* ---------- система ---------- */
function weekKey(d) { const t = new Date(d); t.setDate(t.getDate() + 3 - dow(t)); return `${t.getFullYear()}-W${pad(isoWeek(d))}`; }
function reviewStreak() {
  const R = S.data.reviews;
  let wk = monday(todayDate()), n = 0;
  if (!R[weekKey(wk)]) wk = addDays(wk, -7);
  while (R[weekKey(wk)] && n < 520) { n++; wk = addDays(wk, -7); }
  return n;
}
function renderSystem() {
  if (!S.data) return;
  const tk = ymd(todayDate()), items = T.data?.tasks || [], has = !!(tasksUrl() && T.data);
  const open = items.filter(x => x.status !== "completed");
  const overdue = open.filter(x => x.due && x.due < tk), undated = open.filter(x => !x.due);
  const done7 = items.filter(x => x.status === "completed" && x.completed && Date.now() - Date.parse(x.completed) <= 7 * 864e5);
  const stale = open.filter(x => x.updated && Date.now() - Date.parse(x.updated) > 30 * 864e5);
  const tile = (v, l) => `<div><b>${has ? v : "—"}</b><span>${l}</span></div>`;
  $("#sys-tiles").innerHTML = tile(open.length, "открыто") + tile(overdue.length, "просрочено") + tile(undated.length, "без даты") + tile(done7.length, "закрыто за 7 дней");
  $("#sys-aside").textContent = has ? `Google Задачи · ${fmtTime.format(new Date(T.data.at))}` : "Google Задачи не подключены";
  const R = S.data.reviews, cur = weekKey(todayDate()), reviewed = !!R[cur];
  const li = (state, name, val, sub = "") => `<li class="${state}"><span class="dot"></span><span class="ck-name">${esc(name)}${sub ? `<span class="ck-sub">${esc(sub)}</span>` : ""}</span><span class="ck-val">${esc(val)}</span></li>`;
  const checks = [];
  if (has) {
    checks.push(li(overdue.length <= 3 ? "ok" : "warn", "Просрочки под контролем", `${overdue.length} шт`,
      overdue.length > 3 ? "Перенеси сроки или удали лишнее — больше трёх просрочек размывают план." : ""));
    checks.push(li(stale.length ? "warn" : "ok", stale.length ? "Висит дольше месяца" : "Ничего не висит дольше месяца", `${stale.length} шт`,
      stale.slice(0, 3).map(x => x.title).join(" · ")));
    checks.push(li(done7.length ? "ok" : "warn", "Задачи закрываются", `${done7.length} за неделю`));
  } else checks.push(`<li class="empty">Подключи Google Задачи в «Настройках», чтобы видеть гигиену задач.</li>`);
  checks.push(li(reviewed ? "ok" : dow(todayDate()) >= 5 ? "warn" : "", reviewed ? "Обзор этой недели проведён" : "Обзор этой недели ещё впереди", reviewed ? fmtShort.format(parse(R[cur])) : ""));
  $("#sys-checks").innerHTML = checks.join("");
  let cells = "";
  for (let i = 11; i >= 0; i--) {
    const mon = addDays(monday(todayDate()), -7 * i), k = weekKey(mon), done = !!R[k];
    cells += `<span class="${done ? "on" : ""} ${i === 0 ? "cur" : ""}" data-tip="${esc(`неделя ${isoWeek(mon)} · ${fmtDay.format(mon)} – ${fmtDay.format(addDays(mon, 6))} · ${done ? "обзор " + fmtShort.format(parse(R[k])) : "обзора не было"}`)}"></span>`;
  }
  $("#rv-weeks").innerHTML = cells;
  const n = reviewStreak();
  $("#rv-text").innerHTML = n ? `Серия: <b>${n}</b> ${plural(n, "неделя", "недели", "недель")} подряд.` : "Серии пока нет. Отметь первый обзор, когда проведёшь его.";
  $("#rv-btn").textContent = reviewed ? "Снять отметку" : "Отметить без шагов";
  $("#rv-start").textContent = reviewed ? "Пройти обзор ещё раз" : "Провести обзор недели";
  $("#rv-start").disabled = !canWrite();
  $("#rv-btn").disabled = !canWrite();
}

/* ---------- настройки ---------- */
function renderSettingsPanel() {
  if (!S.data) return;
  const st = settings();
  if (!$("#slot-list").contains(document.activeElement)) {
    $("#slot-list").innerHTML = (st.slots || []).map((x, i) => `<li data-slot="${i}">
      <select class="field" data-f="dow" aria-label="День">${DOW.map((d, j) => `<option value="${j}" ${j === x.dow ? "selected" : ""}>${d}</option>`).join("")}</select>
      <input class="field" type="time" data-f="from" value="${esc(x.from)}" aria-label="С"> – <input class="field" type="time" data-f="to" value="${esc(x.to)}" aria-label="До">
      <button type="button" class="xbtn" data-slotdel="${i}" aria-label="Удалить слот">×</button></li>`).join("") || '<li class="empty">Слотов пока нет.</li>';
  }
  if ($("#gt-url") !== document.activeElement && !$("#gt-url").value) $("#gt-url").value = st.tasksUrl || "";
  if (!$("#work-form").contains(document.activeElement)) {
    const w = st.work || { from: "", to: "", days: [] };
    $("#wk-from").value = w.from || ""; $("#wk-to").value = w.to || "";
    $("#wk-days").innerHTML = DOW.map((d, i) => `<label><input type="checkbox" value="${i}" ${(w.days || []).includes(i) ? "checked" : ""}>${d}</label>`).join("");
  }
  $("#gt-state").textContent = !st.tasksUrl ? "Не подключено."
    : T.loading ? "Подключено, загружаю задачи…"
    : T.error ? tasksError()
    : T.data ? `Подключено · ${T.data.tasks.filter(x => x.status !== "completed").length} открытых задач в ${T.data.lists.length} ${plural(T.data.lists.length, "списке", "списках", "списках")} · обновлено ${fmtTime.format(new Date(T.data.at))}`
    : "Подключено.";
}

/* ---------- действия ---------- */
document.addEventListener("click", e => {
  const tg = e.target.closest("[data-toggle]");
  if (tg && !tg.disabled) {
    op({ t: "check", date: tg.dataset.date, hid: tg.dataset.hid, val: !isDone(tg.dataset.date, tg.dataset.hid) });
    return;
  }
  if (e.target.closest("#toast-undo")) { const u = S.undo; hideToast(); if (u) u(); return; }
  const act = e.target.closest("button[data-act]");
  if (!act || act.disabled) return;
  const hid = act.closest("li")?.dataset.hid, a = act.dataset.act;
  if (a === "archive") op({ t: "habit", id: hid, data: { archived: true } });
  else if (a === "restore") op({ t: "habit", id: hid, data: { archived: false, order: Math.max(-1, ...active().map(h => h.order ?? 0)) + 1 } });
  else if (a === "delete") { S.confirmDelete = hid; renderManage(); }
  else if (a === "delete-no") { S.confirmDelete = null; renderManage(); }
  else if (a === "delete-yes") { S.confirmDelete = null; op({ t: "del", id: hid }); }
  else if (a === "up" || a === "down") {
    const hs = active(), i = hs.findIndex(h => h.id === hid), j = i + (a === "up" ? -1 : 1);
    if (i < 0 || j < 0 || j >= hs.length) return;
    [hs[i], hs[j]] = [hs[j], hs[i]];
    const ops = hs.map((h, n) => h.order !== n ? { t: "habit", id: h.id, data: { order: n } } : null).filter(Boolean);
    if (ops.length) op(...ops);
  }
});
function kidMark(kind) {
  if (!canWrite()) { openConnect(); return; }
  const now = nowHM(), t = hm(toMin(now)), name = kidName(), hr = new Date().getHours(), tk = ymd(todayDate());
  const K = kidButtons();
  if ((kind === "wake" && !K.wake) || (kind === "bed" && !K.bed0 && !K.resleep) || (kind === "night" && !K.night) || (kind === "me" && !K.me)) return;
  if (kind === "wake") {
    const prev = S.data.kid[tk]?.wake ?? null;
    op({ t: "kid", date: tk, data: { wake: now } });
    toast(`${name} проснулся в ${t}`, () => op({ t: "kid", date: tk, data: { wake: prev } }));
  } else if (kind === "bed" && K.resleep) {
    // Ложное засыпание: прошлый отбой и пробуждение уходят в tries, отбоем становится новое засыпание
    const date = bedDateNow(), v = S.data.kid[date] || {}, prevN = v.nights || [], prevT = v.tries || [];
    const w = prevN.find(x => bedMinOf(x) === K.lastW), nights = prevN.filter(x => x !== w);
    op({ t: "kid", date, data: { bed: now, tries: [...prevT, { s: v.bed, w }], nights: nights.length ? nights : null } });
    toast(`${name} снова уснул в ${t}`, () => op({ t: "kid", date, data: { bed: v.bed, tries: prevT.length ? prevT : null, nights: prevN.length ? prevN : null } }));
  } else if (kind === "bed") {
    const date = bedDateNow(), prev = S.data.kid[date]?.bed ?? null;
    op({ t: "kid", date, data: { bed: now } });
    toast(`${name} уснул в ${t}`, () => op({ t: "kid", date, data: { bed: prev } }));
  } else if (kind === "night") {
    const date = bedDateNow(), prev = S.data.kid[date]?.nights || [];
    op({ t: "kid", date, data: { nights: [...prev, now] } });
    toast(`${name} проснулся в ${t} — ненадолго`, () => op({ t: "kid", date, data: { nights: prev.length ? prev : null } }));
  } else if (kind === "me") {
    const prev = S.data.me[tk]?.wake ?? null, rec = recFor(tk);
    op({ t: "me", date: tk, data: { wake: now } });
    toast(`Ты встал в ${t}${rec != null ? ` · ${diffText(toMin(now) - rec)}` : ""}`, () => op({ t: "me", date: tk, data: { wake: prev } }));
  }
}
$("#kid-wake").addEventListener("click", () => kidMark("wake"));
$("#kid-done").addEventListener("click", e => { const b = e.target.closest("[data-fix]"); if (b) openNight(b.dataset.fix); });
$("#night-list").addEventListener("click", e => { const b = e.target.closest("[data-night]"); if (b) { fillKidForm(b.dataset.night); $("#kid-form").scrollIntoView({ behavior: "smooth", block: "center" }); } });
$("#kid-sleep").addEventListener("click", () => kidMark("bed"));
$("#kid-night").addEventListener("click", () => kidMark("night"));
$("#me-wake").addEventListener("click", () => kidMark("me"));
$("#kf-date").addEventListener("change", e => { if (e.target.value) fillKidForm(e.target.value); });
$("#kid-form").addEventListener("submit", e => {
  e.preventDefault();
  const k = $("#kf-date").value;
  if (!k || k > ymd(todayDate())) { notice("Выбери сегодняшний или прошедший день."); return; }
  const raw = $("#kf-nights").value.trim(), nights = raw ? raw.split(/[,;\s]+/).filter(Boolean) : [];
  if (nights.some(x => !/^\d{1,2}:\d{2}$/.test(x) || toMin(x) >= 1440)) { notice("Пробуждения пиши временем через запятую, например 23:40, 2:10."); return; }
  const norm = nights.map(x => { const m = toMin(x); return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; });
  const next = ymd(addDays(parse(k), 1)), ops = [{ t: "kid", date: k, data: { bed: $("#kf-bed").value || null, nights: norm.length ? norm : null } }];
  if (next <= ymd(todayDate())) ops.push({ t: "kid", date: next, data: { wake: $("#kf-wake").value || null } }, { t: "me", date: next, data: { wake: $("#kf-me").value || null } });
  if (op(...ops)) { notice(""); toast(`Записал ночь с ${fmtShort.format(parse(k))} на ${fmtShort.format(parse(next))}`); }
});
$("#kf-clear").addEventListener("click", () => {
  const k = $("#kf-date").value;
  if (!k) return;
  const next = ymd(addDays(parse(k), 1));
  if (op({ t: "kid", date: k, data: { bed: null, nights: null, tries: null } }, { t: "kid", date: next, data: { wake: null } }, { t: "me", date: next, data: { wake: null } })) fillKidForm(k);
});
const setSetting = data => op({ t: "settings", data });
$("#ks-name").addEventListener("change", e => setSetting({ kidName: e.target.value.trim() }));
$("#ks-gen").addEventListener("change", e => setSetting({ kidNameGen: e.target.value.trim() }));
$("#ks-min").addEventListener("change", e => setSetting({ morningMinutes: Number(e.target.value) }));
$("#ks-habit").addEventListener("change", e => setSetting({ morningHabit: e.target.value }));
$("#ks-evhabit").addEventListener("change", e => setSetting({ eveningHabit: e.target.value }));
$("#ks-evmin").addEventListener("change", e => setSetting({ eveningMinutes: Number(e.target.value) }));
$("#duo-card").addEventListener("click", e => {
  const b = e.target.closest("[data-duo]"), h = evHabit();
  if (!b || !h) return;
  if (!canWrite()) { openConnect(); return; }
  const k = bedDateNow(), val = b.dataset.duo === "done";
  op({ t: "check", date: k, hid: h.id, val });
  if (val) toast(`«${h.name}» отмечено`, () => op({ t: "check", date: k, hid: h.id, val: false }));
});
$("#ks-bedfrom").addEventListener("change", e => { if (e.target.value) setSetting({ bedFrom: e.target.value }); });
$("#kc-prev").addEventListener("click", () => { S.kidOffset--; renderKid(); });
$("#kc-next").addEventListener("click", () => { if (S.kidOffset < 0) { S.kidOffset++; renderKid(); } });

$("#mlist").addEventListener("change", e => {
  const el = e.target, hid = el.closest("li")?.dataset.hid, a = el.dataset.act;
  if (!hid) return;
  if (a === "rename") {
    const v = el.value.trim();
    if (v) op({ t: "habit", id: hid, data: { name: v } });
    else el.value = habits().find(h => h.id === hid)?.name || "";
  }
  else if (a === "sphere") op({ t: "habit", id: hid, data: { sphere: el.value } });
  else if (a === "target") op({ t: "habit", id: hid, data: { target: Number(el.value) } });
});
$("#mlist").addEventListener("keydown", e => { if (e.key === "Enter" && e.target.dataset.act === "rename") e.target.blur(); });
$("#mlist").addEventListener("focusout", () => setTimeout(() => { if (!document.activeElement?.closest?.("#mlist")) renderManage(); }, 0));
$("#add-form").addEventListener("submit", e => {
  e.preventDefault();
  const name = $("#add-name").value.trim();
  if (!name || !canWrite()) return;
  const id = "h" + Date.now().toString(36);
  op({ t: "habit", id, data: { name, sphere: $("#add-sphere").value, target: Number($("#add-target").value),
    order: Math.max(-1, ...active().map(h => h.order ?? 0)) + 1, archived: false, created: ymd(todayDate()) } });
  $("#add-name").value = "";
});
$("#prev").addEventListener("click", () => { S.weekOffset--; renderWeek(); });
$("#next").addEventListener("click", () => { if (S.weekOffset < 0) { S.weekOffset++; renderWeek(); } });
$("#now").addEventListener("click", () => { S.weekOffset = 0; renderWeek(); });
document.querySelectorAll("#progress .seg button").forEach(b => b.addEventListener("click", () => {
  S.view = b.dataset.view; lsSet(LS.view, S.view); renderProgress();
}));
const shiftPeriod = dlt => {
  if (S.view === "month") S.monthOffset = Math.min(0, S.monthOffset + dlt); else S.quarterOffset = Math.min(0, S.quarterOffset + dlt);
  renderProgress();
};
$("#per-prev").addEventListener("click", () => shiftPeriod(-1));
$("#per-next").addEventListener("click", () => shiftPeriod(1));
$("#per-now").addEventListener("click", () => { if (S.view === "month") S.monthOffset = 0; else S.quarterOffset = 0; renderProgress(); });
$("#sync").addEventListener("click", () => { if (!S.cfg) { openConnect(); return; } S.pending.length ? flush() : refresh(); });

$("#connect-form").addEventListener("submit", e => {
  e.preventDefault();
  const repo = $("#cf-repo").value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "");
  const token = $("#cf-token").value.trim() || S.cfg?.token || "";
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { notice("Укажи репозиторий в виде владелец/репозиторий, например 1337David1337/habits-data."); return; }
  if (!token) { notice("Вставь токен GitHub."); return; }
  if (S.cfg && S.cfg.repo !== repo) { S.base = null; S.pending = []; persist(); recompute(); }
  S.cfg = { repo, token }; lsSet(LS.cfg, S.cfg);
  $("#cf-token").value = "";
  $("#connect-panel").open = false;
  refresh();
});
$("#cf-forget").addEventListener("click", () => {
  const p = S.pending.length;
  $("#cf-confirm-text").textContent = p ? `${p} ${plural(p, "изменение", "изменения", "изменений")} ещё не сохранено и пропадёт.` : "Токен и данные будут стёрты с этого устройства.";
  $("#cf-confirm").hidden = false; $("#cf-forget").hidden = true;
});
$("#cf-forget-no").addEventListener("click", () => { $("#cf-confirm").hidden = true; renderConnect(); });
$("#cf-forget-yes").addEventListener("click", () => {
  S.cfg = null; S.base = null; S.pending = [];
  lsSet(LS.cfg, null); persist(); recompute();
  $("#cf-confirm").hidden = true; $("#cf-repo").value = "";
  setSync("idle"); render();
});

/* ---------- новые блоки: действия ---------- */
document.addEventListener("click", e => {
  const tb = e.target.closest("[data-task]");
  if (tb) { const task = T.data?.tasks.find(x => x.id === tb.dataset.task); if (task) taskSet(task, task.status !== "completed"); return; }
  if (e.target.closest("#tasks-reload")) { loadTasks(true); return; }
  const td = e.target.closest("[data-tgdel]");
  if (td) {
    const date = td.dataset.tgdel, prev = S.data.together[date] || {};
    op({ t: "together", date, data: null });
    toast(`Запись за ${fmtShort.format(parse(date))} удалена`, () => op({ t: "together", date, data: prev }));
    return;
  }
  const card = e.target.closest("[data-gid]"), gid = card?.dataset.gid;
  const g = gid && S.data.goals.find(x => x.id === gid);
  if (e.target.closest("[data-grestore]")) { op({ t: "goal", id: e.target.closest("[data-grestore]").dataset.grestore, data: { archived: false } }); return; }
  if (!g) return;
  if (e.target.closest("[data-gstepdel]")) {
    const sid = e.target.closest("[data-gstepdel]").dataset.gstepdel, prev = g.steps.find(x => x.id === sid);
    op({ t: "goalStep", id: gid, sid, data: null });
    toast(`Этап «${prev?.t}» удалён`, () => op({ t: "goalStep", id: gid, sid, data: { ...prev } }));
  } else if (e.target.closest("[data-garch]")) {
    op({ t: "goal", id: gid, data: { archived: true } });
    toast(`Цель «${g.title}» в архиве`, () => op({ t: "goal", id: gid, data: { archived: false } }));
  } else if (e.target.closest("[data-gdel]")) { S.confirmGoal = gid; renderGoals(); }
  else if (e.target.closest("[data-gdelno]")) { S.confirmGoal = null; renderGoals(); }
  else if (e.target.closest("[data-gdelyes]")) { S.confirmGoal = null; op({ t: "goalDel", id: gid }); }
});
$("#goal-list").addEventListener("change", e => {
  const cb = e.target.closest("[data-gstep]"), gid = e.target.closest("[data-gid]")?.dataset.gid;
  if (!cb || !gid) return;
  cb.blur();
  op({ t: "goalStep", id: gid, sid: cb.dataset.gstep, data: { done: cb.checked, doneAt: cb.checked ? ymd(todayDate()) : null } });
});
$("#goal-list").addEventListener("submit", e => {
  e.preventDefault();
  const form = e.target, gid = form.closest("[data-gid]")?.dataset.gid, g = S.data.goals.find(x => x.id === gid);
  if (!g) return;
  const tk = ymd(todayDate());
  if (form.hasAttribute("data-gupd")) {
    const v = Number(String(form.querySelector("input").value).replace(",", "."));
    if (!form.querySelector("input").value || !Number.isFinite(v)) { notice("Введи число."); return; }
    const mode = e.submitter?.dataset.mode || "add", cur = gCur(g), next = mode === "add" ? cur + v : v;
    const prev = (g.history || []).find(x => x.d === tk);
    document.activeElement?.blur?.();
    op({ t: "goalLog", id: gid, d: tk, v: Math.round(next * 1000) / 1000 });
    toast(`«${g.title}»: ${fmtN.format(next)}${g.unit ? " " + g.unit : ""}`, () => op({ t: "goalLog", id: gid, d: tk, v: prev ? prev.v : null }));
  } else if (form.hasAttribute("data-gaddstep")) {
    const text = form.querySelector("input").value.trim();
    if (!text) return;
    document.activeElement?.blur?.();
    op({ t: "goalStep", id: gid, sid: "s" + Date.now().toString(36), data: { t: text } });
  } else if (form.hasAttribute("data-gedit")) {
    const f = new FormData(form), data = { title: String(f.get("title")).trim() || g.title, sphere: f.get("sphere"),
      startDate: f.get("startDate") || g.startDate, deadline: f.get("deadline") || g.deadline };
    if (g.kind !== "steps") data.next = String(f.get("next") || "").trim();
    if (g.kind !== "steps") {
      data.start = Number(f.get("start")) || 0; data.target = Number(f.get("target")); data.unit = String(f.get("unit")).trim();
      if (!Number.isFinite(data.target) || data.target === data.start) { notice("Цель должна отличаться от начального значения."); return; }
    }
    if (data.deadline <= data.startDate) { notice("Срок должен быть позже начала."); return; }
    document.activeElement?.blur?.();
    form.closest("details").open = false;
    op({ t: "goal", id: gid, data });
  }
});
$("#ga-kind").addEventListener("change", e => {
  document.querySelectorAll("#ga-form [data-k]").forEach(l => { l.hidden = l.dataset.k !== e.target.value; });
});
$("#ga-form").addEventListener("submit", e => {
  e.preventDefault();
  if (!canWrite()) { openConnect(); return; }
  const tk = ymd(todayDate()), kind = $("#ga-kind").value, title = $("#ga-title").value.trim(), deadline = $("#ga-deadline").value;
  if (!title) return;
  if (!deadline || deadline <= tk) { notice("Срок цели должен быть в будущем."); return; }
  const data = { title, kind, sphere: $("#ga-sphere").value, deadline, startDate: tk, created: tk, archived: false,
    order: Math.max(-1, ...goalsActive().map(g => g.order ?? 0)) + 1 };
  if (kind === "number") {
    const start = Number($("#ga-start").value) || 0, target = Number($("#ga-target").value);
    if (!$("#ga-target").value || !Number.isFinite(target) || target === start) { notice("Укажи цель — число, отличное от текущего."); return; }
    Object.assign(data, { start, target, unit: $("#ga-unit").value.trim(), history: [] });
  } else {
    const lines = $("#ga-steps").value.split("\n").map(x => x.trim()).filter(Boolean);
    if (!lines.length) { notice("Добавь хотя бы один этап."); return; }
    const base = Date.now().toString(36);
    data.steps = lines.map((t, i) => ({ id: `s${base}${i}`, t, done: false }));
  }
  notice("");
  op({ t: "goal", id: "g" + Date.now().toString(36), data });
  $("#ga-form").reset(); $("#ga-kind").dispatchEvent(new Event("change"));
  $("#goal-add").open = false;
});
function markTogether(note) {
  if (!canWrite()) { openConnect(); return; }
  const date = ymd(todayDate()), prev = S.data.together[date] || null;
  op({ t: "together", date, data: { note: note || prev?.note || "" } });
  toast(prev ? "Заметка обновлена" : "Записал: сегодня были вдвоём", () => op({ t: "together", date, data: prev }));
}
$("#tg-form").addEventListener("submit", e => {
  e.preventDefault();
  const note = $("#tg-note").value.trim();
  $("#tg-note").value = "";
  markTogether(note);
});
document.querySelectorAll("#day .seg button").forEach(b => b.addEventListener("click", () => { S.dayOff = Number(b.dataset.day); renderPlan(); }));
$("#work-form").addEventListener("change", () => setSetting({ work: {
  from: $("#wk-from").value, to: $("#wk-to").value,
  days: [...document.querySelectorAll("#wk-days input:checked")].map(x => Number(x.value)),
} }));
$("#tg-norm").addEventListener("change", e => setSetting({ togetherPerWeek: Number(e.target.value) }));
$("#rv-btn").addEventListener("click", () => {
  const week = weekKey(todayDate()), prev = S.data.reviews[week] || null;
  op({ t: "review", week, date: prev ? null : ymd(todayDate()) });
  toast(prev ? "Отметка обзора снята" : "Обзор недели отмечен", () => op({ t: "review", week, date: prev }));
});
function readSlots() {
  return [...document.querySelectorAll("#slot-list li[data-slot]")].map(li => ({
    dow: Number(li.querySelector('[data-f="dow"]').value), from: li.querySelector('[data-f="from"]').value, to: li.querySelector('[data-f="to"]').value,
  })).filter(x => x.from && x.to);
}
$("#slot-list").addEventListener("change", () => setSetting({ slots: readSlots() }));
$("#slot-list").addEventListener("click", e => {
  const x = e.target.closest("[data-slotdel]");
  if (!x) return;
  const slots = (settings().slots || []).filter((_, i) => i !== Number(x.dataset.slotdel));
  setSetting({ slots });
});
$("#slot-add").addEventListener("click", () => setSetting({ slots: [...(settings().slots || []), { dow: 2, from: "20:40", to: "22:10" }] }));
$("#gt-form").addEventListener("submit", e => {
  e.preventDefault();
  const url = $("#gt-url").value.trim(), key = $("#gt-key").value.trim() || settings().tasksKey;
  if (url && !/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) { notice("Нужен адрес вида https://script.google.com/macros/s/…/exec"); return; }
  if (url && !key) { notice("Вставь ключ из журнала функции setup."); return; }
  if (url && (/^AKfycb/.test(key) || url.includes(key))) {
    notice("Это идентификатор развёртывания, а не ключ. Запусти функцию setup в редакторе скрипта и скопируй ключ из строки «Ключ для дашборда: …» в журнале выполнения.");
    return;
  }
  $("#gt-key").value = "";
  T.data = null; lsSet(LS.tasks, null); T.error = null;
  if (setSetting({ tasksUrl: url, tasksKey: url ? key : "" })) loadTasks(true);
});

/* ---------- следующий шаг цели ---------- */
function nextStepOf(g) {
  if (g.kind === "steps") { const st = (g.steps || []).find(x => !x.done); return st ? { text: st.t, goal: g.id, stepId: st.id } : null; }
  return g.next ? { text: g.next, goal: g.id } : null;
}
// Варианты для полей «что делать в слоте»: следующие шаги и ближайшие этапы целей
function stepCatalog() {
  const out = [];
  for (const g of goalsActive()) {
    if (gFrac(g) >= 1) continue;
    if (g.kind === "steps") (g.steps || []).filter(x => !x.done).slice(0, 3).forEach(x => out.push({ text: x.t, goal: g.id, stepId: x.id, gt: g.title }));
    else if (g.next) out.push({ text: g.next, goal: g.id, gt: g.title });
  }
  out.forEach(x => { x.label = `${x.text} · ${x.gt}`; });
  return out;
}
// Шаг для слота — только открытая подзадача из Google Задач: задача с подзадачами — это проект,
// подзадачи — его шаги. Своего текста нет, чтобы каждый шаг жил в списке и закрывался там же
function slotSteps() {
  if (!T.data) return [];
  const steps = T.data.tasks.filter(x => x.parent && x.status !== "completed" && parentOf(x) && parentOf(x).status !== "completed" && !parked(x));
  const projects = [...new Map(steps.map(x => [x.parent, parentOf(x)])).values()];
  const firstDue = p => kidsOf(p).filter(c => c.status !== "completed").map(effDue).filter(Boolean).sort()[0] || "9999";
  projects.sort((a, b) => firstDue(a) < firstDue(b) ? -1 : firstDue(a) > firstDue(b) ? 1 : a.title.localeCompare(b.title, "ru"));
  return projects.map(p => ({ p, steps: steps.filter(x => x.parent === p.id).sort(byPos) }));
}
// Выпадающий список шагов для слота key; data-атрибут attr — как поле узнают обработчики
function slotSelect(key, attr, { value, disabled } = {}) {
  const s = sess(key), groups = slotSteps(), cur = value ?? (["skipped", "moved"].includes(s?.status) ? "" : s?.taskId || (s?.text ? "__cur" : ""));
  const taken = new Map(upcomingSlots(14).filter(x => x.key !== key && ["planned", "started"].includes(sess(x.key)?.status) && sess(x.key)?.taskId)
    .map(x => [sess(x.key).taskId, `${DOW[dow(x.d)].toLowerCase()} ${hz(x.from)}`]));
  const known = groups.some(g => g.steps.some(x => x.id === cur));
  const opts = `<option value="">${groups.length ? "— выбери подзадачу —" : "нет подзадач в Google Задачах"}</option>`
    + (cur && !known && s?.text ? `<option value="__cur" selected>${esc(s.text)}</option>` : "")
    + groups.map(g => `<optgroup label="${esc(g.p.title)} · ${esc(g.p.list)}">${g.steps.map(x => {
      const d = effDue(x), busy = taken.get(x.id);
      return `<option value="${esc(x.id)}" ${x.id === cur ? "selected" : ""}>${esc(x.title)}${d ? ` · срок ${fmtDM.format(parse(d))}` : ""}${busy ? ` · уже в слоте ${busy}` : ""}</option>`;
    }).join("")}</optgroup>`).join("");
  return `<select class="field" ${attr}="${esc(key)}" aria-label="Шаг для слота" ${disabled ? "disabled" : ""}>${opts}</select>`;
}
const NO_STEPS = () => !tasksUrl() ? "Подключи Google Задачи в настройках — шаги для слотов берутся из подзадач."
  : !T.data ? "Загружаю подзадачи из Google Задач…"
  : "В Google Задачах пока нет подзадач. Разбей проект на шаги-подзадачи — они появятся здесь.";

/* ---------- слоты ---------- */
const sKey = (date, from) => `${date} ${from}`;
const sess = key => S.data?.sessions?.[key] || null;
const nowMin = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };
const fmtDur = m => { m = Math.round(m); const h = Math.floor(m / 60); return h ? `${h} ч${m % 60 ? ` ${m % 60} мин` : ""}` : `${m} мин`; };
const goalTitle = id => (S.data?.goals || []).find(g => g.id === id)?.title || "";
function upcomingSlots(days) {
  const out = [], t = todayDate(), m = nowMin();
  for (let i = 0; i < days; i++) {
    const d = addDays(t, i), k = ymd(d);
    for (const x of slotsOn(d)) {
      if (i === 0 && toMin(x.to) <= m && sess(sKey(k, x.from))?.status !== "started") continue;
      out.push({ ...x, d, date: k, key: sKey(k, x.from) });
    }
  }
  return out;
}
function planOp(key, value) {
  const cur = sess(key), v = String(value || "");
  if (v === "__cur") return null;
  if (!v) return cur && cur.status === "planned" ? { t: "session", key, data: null } : null;
  const task = taskIndex().byId.get(v);
  if (!task || (cur && cur.taskId === v && ["planned", "started", "done"].includes(cur.status))) return null;
  return { t: "session", key, data: { text: task.title, taskId: task.id, listId: task.listId, project: parentOf(task)?.title || null,
    goal: null, stepId: null, status: "planned", started: null, minutes: null, movedTo: null } };
}
function currentSlot() {
  const t = todayDate(), k = ymd(t), m = nowMin();
  const list = slotsOn(t).map(x => ({ ...x, date: k, key: sKey(k, x.from), a: toMin(x.from), z: toMin(x.to) }));
  return list.find(x => x.z > m || sess(x.key)?.status === "started") || list.filter(x => sess(x.key)?.status === "done").pop() || null;
}
function renderSlotCard() {
  const card = $("#slot-card"), x = S.data && currentSlot();
  card.hidden = !x;
  if (!x) return;
  const s = sess(x.key), m = nowMin(), len = x.z - x.a, gt = s?.goal ? goalTitle(s.goal) : "";
  const time = `${hz(x.from)}–${hz(x.to)}`, live = m >= x.a && m < x.z;
  const head = `<span class="eyebrow">${live ? "Сейчас слот" : m < x.a ? "Сегодня слот" : "Слот"} · ${time}</span>`;
  let html;
  if (s?.status === "done") {
    html = `${head}<h3>Сделано: ${esc(s.text)}</h3><p class="sg">${gt ? esc(gt) + " · " : ""}${fmtDur(s.minutes || 0)} на цель</p>`;
  } else if (s?.status === "started") {
    const el = Math.max(0, m - toMin(s.started));
    html = `${head}<h3>${esc(s.text)}</h3><p class="sg">${gt ? esc(gt) + " · " : ""}идёт ${fmtDur(el)} из ${fmtDur(len)}</p>
      <div class="sbar"><i style="width:${Math.min(100, el / len * 100)}%"></i></div>
      <div class="row-btns"><button type="button" class="btn" data-slot-act="done">Готово</button><button type="button" class="btn ghost" data-slot-act="move">Не успел — перенести</button></div>`;
  } else if (s?.status === "skipped") {
    html = `${head}<h3>Слот пропущен</h3><p class="sg">${esc(s.text || "")}</p><div class="row-btns"><button type="button" class="btn ghost" data-slot-act="restore">Вернуть</button></div>`;
  } else if (s?.status === "moved") {
    html = `${head}<h3>Шаг перенесён</h3><p class="sg">${esc(s.text)} → ${s.movedTo ? esc(fmtShort.format(parse(s.movedTo.slice(0, 10))) + ", " + hz(s.movedTo.slice(11))) : "следующий слот"}</p>`;
  } else if (s?.text) {
    const canStart = m >= x.a - 30;
    html = `${head}<h3>${esc(s.text)}</h3><p class="sg">${s.project ? esc(s.project) : gt ? esc(gt) : "шаг"}${!canStart ? ` · начнётся в ${hz(x.from)}` : ""}</p>
      <div class="row-btns">${canStart ? `<button type="button" class="btn" data-slot-act="start">Начать</button>` : ""}
        ${m >= x.a ? `<button type="button" class="btn ghost" data-slot-act="done">Уже сделал</button>` : ""}
        <button type="button" class="btn ghost" data-slot-act="move">Перенести</button>
        <button type="button" class="btn ghost" data-slot-act="skip">Пропустить</button></div>`;
  } else {
    html = `${head}<h3>Шаг не выбран</h3>${slotSteps().length
      ? `<p class="sg">Одна подзадача из Google Задач на ${fmtDur(len)}.</p>${slotSelect(x.key, "data-slot-pick")}`
      : `<p class="sg">${NO_STEPS()}</p>`}`;
  }
  card.dataset.key = x.key;
  card.innerHTML = html;
}
function slotAction(key, act) {
  if (!canWrite()) { openConnect(); return; }
  const s = sess(key), prev = s ? { ...s } : null, undo = () => op({ t: "session", key, data: prev });
  const [date, from] = key.split(" "), sl = slotsOn(parse(date)).find(x => x.from === from);
  const a = toMin(from), z = sl ? toMin(sl.to) : a + 90, m = nowMin(), today = ymd(todayDate());
  if (act === "start") { op({ t: "session", key, data: { status: "started", started: nowHM() } }); return; }
  if (act === "skip") { op({ t: "session", key, data: { status: "skipped" } }); toast("Слот пропущен", undo); return; }
  if (act === "restore") { op({ t: "session", key, data: { status: "planned" } }); return; }
  if (act === "done") {
    const minutes = s?.status === "started" ? Math.max(1, Math.min(240, m - toMin(s.started))) : Math.max(1, Math.min(m, z) - a);
    const ops = [{ t: "session", key, data: { status: "done", minutes } }];
    const g = s?.goal && S.data.goals.find(x => x.id === s.goal);
    const step = g && s.stepId && (g.steps || []).find(x => x.id === s.stepId);
    if (step && !step.done) ops.push({ t: "goalStep", id: g.id, sid: step.id, data: { done: true, doneAt: today } });
    const task = s?.taskId && taskIndex().byId.get(s.taskId), close = task && task.status !== "completed";
    op(...ops);
    if (close) taskSet(task, true, true);
    toast(close ? `Готово: «${task.title}» закрыта и в Google Задачах` : step ? `Готово: этап «${step.t}» пройден` : `Готово: ${fmtDur(minutes)} на шаг`, () => {
      const back = [{ t: "session", key, data: prev }];
      if (step && !step.done) back.push({ t: "goalStep", id: g.id, sid: step.id, data: { done: false, doneAt: null } });
      op(...back);
      if (close) taskSet(task, false);
    });
    return;
  }
  if (act === "move") {
    const busy = x => { const t = sess(x.key); return !!(t?.text && ["planned", "started", "done"].includes(t.status)); };
    const target = upcomingSlots(14).find(x => x.key > key && !busy(x));
    if (!target) { notice("Свободных слотов впереди нет — добавь слот в настройках или выбери шаг заново."); return; }
    const t = sess(target.key), tPrev = t ? { ...t } : null;
    op({ t: "session", key, data: { status: "moved", movedTo: target.key } },
       { t: "session", key: target.key, data: { text: s?.text || "", taskId: s?.taskId || null, listId: s?.listId || null, project: s?.project || null,
         goal: s?.goal || null, stepId: s?.stepId || null, status: "planned", started: null, minutes: null, movedTo: null } });
    toast(`Перенёс на ${fmtShort.format(target.d)}, ${hz(target.from)}`, () => op({ t: "session", key, data: prev }, { t: "session", key: target.key, data: tPrev }));
  }
}
function renderSlotPlan() {
  const ul = $("#slot-plan-list");
  if (ul.contains(document.activeElement)) return;
  const list = upcomingSlots(8), st = settings();
  $("#slot-plan-aside").textContent = list.length ? `${list.filter(x => sess(x.key)?.text).length} из ${list.length} с шагом` : "";
  if (!(st.slots || []).length) { ul.innerHTML = `<li class="empty">Свободных слотов нет. Добавь их в «Настройки → Распорядок».</li>`; return; }
  ul.innerHTML = list.map(x => {
    const s = sess(x.key), locked = ["done", "started", "moved"].includes(s?.status);
    const badge = s?.status === "done" ? `<span class="st done">сделано</span>` : s?.status === "started" ? `<span class="st">идёт</span>`
      : s?.status === "skipped" ? `<span class="st skip">пропущен</span>` : s?.status === "moved" ? `<span class="st">перенесён</span>` : "";
    return `<li><div class="sd">${fmtShort.format(x.d)}<small>${hz(x.from)}–${hz(x.to)} ${badge}</small></div>
      ${locked ? `<span class="sx">${esc(s.text)}</span>` : slotSelect(x.key, "data-plan-key", { disabled: !canWrite() })}</li>`;
  }).join("") || `<li class="empty">На ближайшую неделю слотов нет.</li>`;
  if (list.length && !slotSteps().length) ul.insertAdjacentHTML("afterbegin", `<li class="empty">${NO_STEPS()}</li>`);
}

/* ---------- главное на сегодня ---------- */
const focusDone = (it, k) => !!it.done || !!(it.habit && isDone(k, it.habit));
function renderFocus() {
  const tk = ymd(todayDate()), items = (S.data.focus[tk] || []).map(x => ({ ...x, done: focusDone(x, tk) })), ul = $("#focus-list");
  $("#focus-count").textContent = items.length ? `${items.filter(x => x.done).length} из ${items.length}` : "";
  ul.innerHTML = items.length ? items.map((it, i) => `<li class="${it.done ? "done" : ""}"><button type="button" class="fk" data-focus="${i}" aria-label="${it.done ? "Вернуть" : "Отметить сделанным"}: ${esc(it.t)}">${CHECK}</button>
      <span class="ft">${esc(it.t)}${it.src ? `<small>${esc(it.src)}</small>` : ""}</span></li>`).join("")
    : `<li class="empty">Главное на сегодня не выбрано. <button type="button" class="linkbtn" data-open-wizard="focus">Выбрать сейчас</button></li>`;
}
function toggleFocus(i) {
  const tk = ymd(todayDate()), items = (S.data.focus[tk] || []).map(x => ({ ...x }));
  const it = items[i]; if (!it) return;
  it.done = !focusDone(it, tk);
  // дело-привычка отмечает и саму привычку
  op({ t: "focus", date: tk, items }, ...(it.habit && habits().some(h => h.id === it.habit) ? [{ t: "check", date: tk, hid: it.habit, val: it.done }] : []));
  const task = it.taskId && T.data?.tasks.find(x => x.id === it.taskId);
  if (task && (task.status === "completed") !== it.done) taskSet(task, it.done);
}

/* ---------- баланс сфер ---------- */
// Сфера задачи угадывается по словам названия; ручная правка хранится в tags.<id задачи>.
// Слово с «=» совпадает только целиком, остальные — как начало слова.
const SPHERE_ALIASES = {
  "работа": ["работа", "карьера", "рост", "учеба", "профессия"], "жена": ["жена", "брак", "муж"],
  "ребенок": ["ребенок", "дети", "сын", "дочь"], "церковь": ["церковь", "вера", "служение", "бог"],
  "деньги": ["деньги", "финансы"], "здоровье": ["здоровье", "спорт", "тело"], "дом": ["дом", "быт", "квартира"], "машина": ["машина", "авто", "автомобиль"], "семья": ["семья"],
  "родные": ["родные", "родня", "родственники", "родители"],
};
const SPHERE_WORDS = {
  "работа": ["=работа", "=работе", "=работу", "=работы", "рабоч", "тест", "автотест", "автоматиз", "python", "питон", "pytest", "sql", "postman", "курс", "урок", "=дз", "=вш",
    "учеб", "книг", "читат", "прочит", "резюме", "собес", "англ", "english", "jira", "ревью", "созвон", "отчет", "вебинар", "лекци", "затрек", "трекат", "ворклог", "worklog", "=qa", "тестиров"],
  "жена": ["жен", "свидан", "вдвоем", "цвет", "подар", "годовщин", "кафе", "ресторан"],
  "ребенок": ["ребен", "сын", "малыш", "детск", "=дети", "детей", "коляск", "прививк", "педиатр", "игрушк", "подгуз", "памперс", "пюре", "садик"],
  "церковь": ["церк", "служен", "молит", "молил", "молис", "библи", "проповед", "пастор", "=хор", "поклонен", "общин", "=дг"],
  "деньги": ["деньг", "денег", "кредит", "оплат", "заплат", "плати", "платеж", "налог", "банк", "бюджет", "трат", "подписк", "перевест",
    "счет", "долг", "зарплат", "вклад", "копил", "накоп", "ипотек", "страхов", "рубл", "инвест", "продат", "кэшбэк"],
  "здоровье": ["врач", "зуб", "стомат", "спорт", "трениров", "=бег", "пробеж", "=зал", "спортзал", "анализ", "здоров", "витамин", "отжим",
    "присед", "зарядк", "=сон", "поспат", "=лечь", "больниц", "поликлин", "медосмотр", "таблет", "диет", "растяжк"],
  "дом": ["ремонт", "убор", "убрат", "квартир", "стекл", "мастер", "полк",
    "почин", "стирк", "постир", "посуд", "мебел", "розетк", "лампочк", "сантехн", "окн", "дач", "мусор", "пылесос", "двер"],
  "машина": ["машин", "=авто", "автосерв", "автомойк", "ручник", "трос", "шин", "колес", "резин", "=сто", "масл", "kia", "=киа", "ceed", "дворник",
    "гараж", "бензин", "заправ", "техосмотр", "антифриз", "аккумулятор", "фар", "парков", "клапан"],
  "родные": ["мам", "=папа", "=папе", "=папы", "=папу", "папин", "родител", "брат", "сестр", "бабушк", "дедушк", "тещ", "свекр", "родн", "родствен", "=тетя", "=тете", "=тети", "дяд", "племян"],
};
SPHERE_WORDS["семья"] = [...SPHERE_WORDS["жена"], ...SPHERE_WORDS["ребенок"], "мам", "пап", "родител", "брат", "сестр", "бабушк", "дедушк", "семь"];
const normRu = s => String(s || "").toLowerCase().replace(/ё/g, "е");
const canonOf = s => { const n = normRu(s).trim(); return Object.keys(SPHERE_ALIASES).find(k => SPHERE_ALIASES[k].includes(n)) || null; };
const sphereByCanon = c => (settings().spheres || []).find(s => canonOf(s) === c) || null;
function sphereOfText(text) {
  const words = normRu(text).split(/[^a-z0-9а-я]+/).filter(Boolean), kid = normRu(kidName());
  let best = null, top = 0;
  for (const s of settings().spheres || []) {
    const c = canonOf(s), stems = c ? [...SPHERE_WORDS[c] || [], "=" + normRu(s)] : [normRu(s).slice(0, 5)];
    // нет отдельной сферы «машина» — дела с машиной считаются домашними
    if (c === "дом" && !sphereByCanon("машина")) stems.push(...SPHERE_WORDS["машина"]);
    if ((c === "ребенок" || c === "семья") && kid.length > 2) stems.push(kid);
    const hits = words.filter(w => stems.some(st => st[0] === "=" ? w === st.slice(1)
      : st === kid ? w.startsWith(st) && w.length <= st.length + 2 : w.startsWith(st))).length;
    // люди весомее дел: «поискать маме работу» — про маму, а не про работу
    const score = c === "родные" ? hits * 2 : hits;
    if (score > top) { top = score; best = s; }
  }
  return best;
}
function taskSphere(x) {
  const tag = S.data?.tags?.[x.id];
  if (tag !== undefined) return tag || null;
  const p = parentOf(x);
  return (p && taskSphere(p)) || listSphere(x.list) || sphereOfText(x.title) || sphereOfText(x.list);
}
// Что было сделано в каждой сфере по дням: { сфера: { дата: [что] } }
function sphereActivity(from, to) {
  const st = settings(), act = {}, tk = ymd(todayDate());
  (st.spheres || []).forEach(s => { act[s] = {}; });
  const put = (s, k, what) => { if (s && act[s] && k >= from && k <= to) (act[s][k] ||= []).push(what); };
  const goalSphere = id => (S.data.goals || []).find(g => g.id === id)?.sphere || null;
  for (const [k, day] of Object.entries(S.data.log)) for (const hid of Object.keys(day)) {
    const h = habits().find(x => x.id === hid); if (h) put(h.sphere, k, h.name);
  }
  const wife = sphereByCanon("жена") || sphereByCanon("семья"), church = sphereByCanon("церковь");
  Object.keys(S.data.together).forEach(k => put(wife, k, "время вдвоём"));
  Object.keys(S.data.prayer).forEach(k => put(church, k, "молитва"));
  const busyS = (st.spheres || []).find(s => normRu(s) === normRu(st.busyLabel)) || null;
  for (let d = parse(from); ymd(d) <= to; d = addDays(d, 1)) {
    const k = ymd(d);
    if ((st.busyDays || []).includes(dow(d)) && (k < tk || new Date().getHours() >= 19)) put(busyS, k, st.busyLabel);
  }
  for (const [k, list] of Object.entries(S.data.care)) list.forEach(s => put(s, k, CARE_MARK));
  for (const [key, s] of Object.entries(S.data.sessions)) if (s.status === "done") put(goalSphere(s.goal), key.slice(0, 10), s.text);
  for (const [k, items] of Object.entries(S.data.focus)) items.forEach(x => {
    if (x.done && !x.taskId) put(goalSphere(x.goal) || sphereOfText(x.t), k, x.t);
  });
  (T.data?.tasks || []).forEach(x => { if (x.status === "completed" && x.completed) put(taskSphere(x), ymd(new Date(x.completed)), x.title); });
  return act;
}
// Норма внимания — сколько дней в неделю сфере нужно время; своя норма хранится в settings.sphereNorms.
// 0 — сфера «по делу»: ей не нужно время по ритму (здоровье, когда никто не болеет; дом, когда ничего не сломалось),
// она без заряда и попадает в «Упор» только при настоящем деле — задаче со сроком или шаге цели
const NORM_DEFAULT = { "жена": 5, "ребенок": 6, "семья": 5, "церковь": 3, "работа": 3, "деньги": 3, "здоровье": 0, "дом": 0, "родные": 0, "машина": 0 };
const normOf = s => settings().sphereNorms?.[s] ?? NORM_DEFAULT[canonOf(s)] ?? 2;
function balance(tgtK) {
  const tk = ymd(todayDate()), act = sphereActivity(addDaysK(tk, -29), tk);
  const week = Array.from({ length: 7 }, (_, i) => addDaysK(tk, i - 6));
  return (settings().spheres || []).map(s => {
    const days = act[s], keys = Object.keys(days).sort(), last = keys[keys.length - 1] || null;
    const norm = normOf(s), gap = norm ? Math.ceil(7 / norm) : Infinity, touched = week.filter(k => days[k]).length;
    const ago = last ? Math.round((parse(tgtK) - parse(last)) / 864e5) : null;
    // пора — по норме сфере уже нужно время; отстаёт — пропущено два своих промежутка подряд
    return { s, days, week: week.map(k => ({ k, what: days[k] || null })), touched, last, ago, norm, gap, onDemand: !norm,
      due: !!norm && (ago == null || ago >= gap), late: !!norm && (ago == null || ago >= gap * 2), deficit: Math.max(0, norm - touched) };
  });
}
function sphereIdeas(s, tgtK) {
  const out = [], c = canonOf(s), has = t => out.some(x => x.t === t);
  if (c === "жена") {
    const tg = togetherInfo();
    if (tg.days == null || tg.days >= tg.gap)
      out.push({ t: `Время вдвоём, когда ${kidName()} уснёт: чай и разговор без телефонов`, from: "idea", src: tg.days == null ? "вдвоём ещё не отмечали" : `вдвоём были ${tg.days} ${plural(tg.days, "день", "дня", "дней")} назад` });
  }
  if (T.data) {
    const pr = x => { const d = effDue(x); return !d ? 2 : d <= tgtK ? 0 : 1; }, roots = new Set();
    // от задачи с подзадачами — только ближайшая подзадача: это и есть следующее действие
    T.data.tasks.filter(x => actionable(x) && !parked(x) && taskSphere(x) === s && (!effDue(x) || effDue(x) <= addDaysK(tgtK, 7)))
      .sort((a, b) => pr(a) - pr(b) || ((effDue(a) || "") < (effDue(b) || "") ? -1 : (effDue(a) || "") > (effDue(b) || "") ? 1 : byPos(a, b)))
      .filter(x => { const r = x.parent || x.id; return !roots.has(r) && roots.add(r); }).slice(0, 3)
      .forEach(x => out.push({ t: x.title, from: "task", src: taskSrc(x), taskId: x.id, listId: x.listId, due: effDue(x) }));
  }
  goalsActive().filter(g => g.sphere === s).forEach(g => { const nx = nextStepOf(g); if (nx && !has(nx.text)) out.push({ t: nx.text, from: "goal", src: `«${g.title}»`, goal: g.id, stepId: nx.stepId || null }); });
  active().filter(h => h.sphere === s).forEach(h => {
    const n = weekCount(h, monday(parse(tgtK))), tgt = h.target || 1;
    if (n < tgt) out.push({ t: h.name, from: "habit", src: `${n} из ${tgt} за неделю`, habit: h.id });
  });
  const IDEA = {
    "работа": "30 минут на рост в профессии: курс, автотесты или книга",
    "ребенок": `Полчаса для ${kidGen()} без телефона: прогулка, игра, купание`,
    "церковь": "Написать или позвонить кому-то из домашней группы",
    "деньги": "10 минут на деньги: записать траты, сверить бюджет",
    "здоровье": "Прогулка 20 минут или лечь до 23:00",
    "дом": "15 минут на одно мелкое дело по дому",
    "семья": "Время с семьёй без телефона",
    "родные": "Позвонить маме или кому-то из родных",
    "машина": "10 минут на машину: масло, шины, омывайка",
    "жена": "Спросить жену, как прошёл день, и выслушать без телефона",
  };
  const idea = IDEA[c] || `15–30 минут на сферу «${s}»`;
  if (out.length < 4 && !has(idea)) out.push({ t: idea, from: "idea", src: "" });
  return out.slice(0, 4);
}
// Какие сферы поднять в день tgtK: те, кому по норме уже пора, — сильнее всех отставшие первыми
// Откуда предложение: задача Google, шаг цели, привычка или подсказка самого дашборда (её нет нигде)
const FROM = { task: "Google Задачи", goal: "Шаг цели", habit: "Привычка", idea: "Подсказка Keel" };
const fromLine = x => [FROM[x.from], x.src].filter(Boolean).join(" · ");
const focusSrc = (x, s) => x.from === "task" ? x.src : `${FROM[x.from]} · ${s}`;
function balanceRecs(tgtK, rows) {
  const st = settings(), d = parse(tgtK), busy = (st.busyDays || []).includes(dow(d));
  const busyS = (st.spheres || []).find(s => normRu(s) === normRu(st.busyLabel)) || null;
  const free = slotsOn(d).length > 0 || !(st.work?.days || []).includes(dow(d));
  // Сфера «по делу» — только с делом, которое нельзя отложить: срок подошёл или есть шаг цели
  const real = x => (x.from === "task" && x.due && x.due <= tgtK) || x.from === "goal";
  const n = busy ? 1 : free ? 3 : 2, need = r => r.onDemand ? (r.ideas.some(x => x.due && x.due < tgtK) ? 2 : 1.2) : (r.ago ?? 30) / r.gap;
  return rows.filter(r => !(busy && r.s === busyS))
    .map(r => r.onDemand ? { ...r, ideas: sphereIdeas(r.s, tgtK).filter(real) } : r)
    .filter(r => r.onDemand ? r.ideas.length : r.due)
    .sort((a, b) => need(b) - need(a) || b.deficit - a.deficit).slice(0, n).map(r => r.ideas ? r : { ...r, ideas: sphereIdeas(r.s, tgtK) });
}
function agoText(r) {
  const tk = ymd(todayDate());
  if (r.onDemand) return r.ideas?.some(x => x.due && x.due < tk) ? "когда нужно · есть просроченное" : "когда нужно · подошёл срок";
  if (!r.last) return "давно не было";
  const n = Math.round((parse(tk) - parse(r.last)) / 864e5);
  return n === 0 ? "сегодня было" : n === 1 ? "было вчера" : `${n} ${plural(n, "день", "дня", "дней")} без внимания`;
}
// Неделя сферы словами: «2 из 3», перебор — не тревога, а «✓ +3»
const dayWord = n => `${n} ${plural(n, "день", "дня", "дней")}`;
function weekState(r) {
  if (r.onDemand) return { cls: "od", t: "когда нужно" };
  if (r.touched >= r.norm) return { cls: "ok", t: r.touched > r.norm ? `✓ +${r.touched - r.norm}` : "✓ готово" };
  return { cls: r.late ? "need" : "", t: `ещё ${dayWord(r.norm - r.touched)}` };
}
// innerHTML — только когда что-то поменялось: анимация идёт на новые данные, а не на каждую перерисовку
const setHtml = (el, html) => { if (el._h !== html) { el._h = html; el.innerHTML = html; } };
// Кольцо сферы на «Сегодня»: замкнулось — дней хватает. Янтарное — только у сфер, которым Keel советует время сейчас
const RING_C = (2 * Math.PI * 15).toFixed(1);
function ringHtml(r, hot) {
  const p = Math.min(1, r.touched / r.norm), cls = r.touched >= r.norm ? "ok" : hot ? "hot" : "";
  return `<span class="rg ${cls}"><svg viewBox="0 0 40 40" aria-hidden="true"><circle class="rg-t" cx="20" cy="20" r="15"/>${p ? `<circle class="rg-a" cx="20" cy="20" r="15" style="--c:${RING_C};stroke-dasharray:${RING_C};stroke-dashoffset:${(RING_C * (1 - p)).toFixed(1)}"/>` : ""}</svg>`
    + `<b>${r.touched}<small>/${r.norm}</small></b><span class="rg-n">${esc(r.s)}</span></span>`;
}
function renderBalance() {
  const sp = settings().spheres || [];
  $("#bal-batts").hidden = $("#bal-sub").hidden = $("#balance").hidden = $("#keel-card").hidden = !sp.length;
  if (!sp.length) return;
  const tgt = planTarget(), tgtK = ymd(tgt), tk = ymd(todayDate()), isT = tgtK === tk, rows = balance(tgtK), st = settings();
  const chosen = (S.data.focus[tgtK] || []).length;
  // До полудня предложения идут в главное на сегодня (прямо в список выше), после — на завтра
  $("#bal-title").innerHTML = `Сферы за неделю<small>${isT ? "подробнее — в «Плане»" : `на завтра выбрано ${chosen} из 3`}</small>`;
  // три дела на сегодня выбраны — кольца остаются, предложения прячем
  $("#bal-rec").hidden = isT && chosen >= 3;
  const recs = balanceRecs(tgtK, rows), hot = new Set(recs.map(r => r.s)), rhythm = rows.filter(r => !r.onDemand);
  setHtml($("#bal-batts"), rhythm.map(r => ringHtml(r, hot.has(r.s))).join(""));
  $("#bal-batts").setAttribute("aria-label", `Сферы за неделю: ${rhythm.map(r => `${r.s} ${r.touched} из ${r.norm}`).join(", ")}. Открыть в «Плане»`);
  const focus = S.data.focus[tgtK] || [], full = focus.length >= 3;
  const inFocus = x => focus.some(f => (x.taskId && f.taskId === x.taskId) || f.t === x.t);
  const busy = (st.busyDays || []).includes(dow(tgt)) && st.busyLabel;
  // На виду одна сфера — самая отставшая; остальные по кнопке, чтобы не разбегались глаза
  const more = recs.length - 1, open = !!S.balMore;
  S.balIdeas = [];
  S.balAlt ||= {};
  $("#bal-rec").innerHTML = recs.length
    ? `<p class="bal-h2">Пора уделить время ${isT ? "сегодня" : "завтра"}</p>` + (busy ? `<p class="note" style="margin:0">${isT ? "Сегодня" : "Завтра"} вечер — ${esc(st.busyLabel)}, поэтому одно короткое дело.</p>` : "")
      + recs.map((r, n) => {
        const j = (S.balAlt[r.s] || 0) % r.ideas.length, x = r.ideas[j], i = S.balIdeas.push({ ...x, s: r.s }) - 1, on = inFocus(x);
        return `<div class="pick"${n && !open ? " hidden" : ""}><div class="br-h"><b>${esc(r.s)}</b><span class="${r.late ? "late-t" : ""}">${agoText(r)}${r.onDemand ? "" : ` · ${r.touched} из ${r.norm}`}</span>
          ${r.ideas.length > 1 ? `<button type="button" class="alt" data-balt="${esc(r.s)}" aria-label="Другое дело для сферы «${esc(r.s)}» (${j + 1} из ${r.ideas.length})" title="Другое дело">↻</button>` : ""}</div>
          <button type="button" class="pi${x.from === "idea" ? " idea" : ""}${on ? " on" : ""}" data-badd="${i}" aria-pressed="${on}" ${!on && full ? "disabled" : ""} aria-label="${on ? "Убрать из главного" : "Добавить в главное"}: ${esc(x.t)}"><span>${esc(x.t)}<small>${esc(fromLine(x))}</small></span><span class="plus">${on ? "✓" : "+"}</span></button></div>`;
      }).join("")
      + (more > 0 ? `<button type="button" class="linkbtn bal-more" data-bmore aria-expanded="${open}">${open ? "Свернуть" : `Ещё ${more} ${plural(more, "сфера просит", "сферы просят", "сфер просят")} времени`}</button>` : "")
      + (full ? `<p class="note" style="margin:0">На ${isT ? "сегодня" : "завтра"} уже три дела. Нажми на выбранное, чтобы убрать.</p>` : "")
    : `<p class="bal-ok">Все сферы в своей норме — можно идти по обычному плану.</p>`;
  renderBalanceStats(rows);
  renderKeel(rows);
}
const capF = s => s.charAt(0).toUpperCase() + s.slice(1);
const dayLabel = k => { const d = parse(k); return `${DOW[dow(d)].toLowerCase()}, ${d.getDate()}`; };
// «План»: неделя клетками — видно, что и в какой день засчиталось
function renderBalanceStats(rows) {
  const tk = ymd(todayDate()), week = rows[0].week;
  S.balRows = rows;
  setHtml($("#bl-list"), `<span></span>${week.map(d => `<span class="bg-d${d.k === tk ? " t" : ""}">${d.k === tk ? "сег" : DOW[dow(parse(d.k))].toLowerCase()}</span>`).join("")}<span></span>`
    + rows.map((r, i) => {
      const st = weekState(r);
      return `<span class="bg-n${r.onDemand ? " od" : ""}">${esc(r.s)}</span>`
        + r.week.map((d, j) => `<button type="button" class="bg-c${d.what ? " on" : ""}" data-bg="${i}:${j}" style="--i:${i + j}" data-tip="${esc(`${capF(dayLabel(d.k))} · ${d.what ? [...new Set(d.what)].join(", ") : "не было"}`)}" aria-label="${esc(r.s)}, ${dayLabel(d.k)}: ${d.what ? esc([...new Set(d.what)].join(", ")) : "не было"}"></button>`).join("")
        + `<span class="bg-s ${st.cls}">${r.onDemand ? "" : `<b>${r.touched}</b> из ${r.norm}`}<small>${st.t}</small></span>`;
    }).join(""));
  $("#bl-care").innerHTML = careChips(tk);
  if (!document.activeElement?.closest?.("#bal-norms"))
    $("#bal-norms ul").innerHTML = rows.map(r => `<li><span>${esc(r.s)}</span><select class="field mini" data-norm="${esc(r.s)}" aria-label="Сколько дней в неделю нужно сфере «${esc(r.s)}»">${[0, 1, 2, 3, 4, 5, 6, 7].map(n => `<option value="${n}" ${n === r.norm ? "selected" : ""}>${n ? `${dayWord(n)} в неделю` : "когда нужно"}</option>`).join("")}</select></li>`).join("");
  renderBalanceLists(); renderBalanceTags();
}
function balDetail(i, j) {
  const r = S.balRows?.[i], d = r?.week[j];
  if (!d) return;
  $("#bl-list").querySelectorAll(".bg-c.sel").forEach(c => c.classList.remove("sel"));
  $(`#bl-list [data-bg="${i}:${j}"]`)?.classList.add("sel");
  const what = d.what ? [...new Set(d.what)].join(", ") : "ничего не засчиталось";
  const tail = r.onDemand ? "Сфера без ритма: Keel предложит её, когда есть дело со сроком."
    : r.touched ? `За неделю ${r.touched} из ${r.norm}.` : `За неделю ни разу${r.last ? `, последний раз ${dayLabel(r.last)}` : ""}. Нужно ${dayWord(r.norm)} в неделю.`;
  $("#bl-detail").innerHTML = `<b>${esc(capF(r.s))}, ${dayLabel(d.k)}:</b> ${esc(what)}. ${tail}`;
}
// «Итоги»: лодка кренится, когда одним сферам достаётся больше нормы, а другим почти ничего
function renderKeel(rows) {
  const rr = rows.filter(r => !r.onDemand), box = $("#keel-card");
  box.hidden = !rr.length;
  if (!rr.length) return;
  const ratio = r => Math.min(2, r.touched / r.norm), over = rr.filter(r => r.touched > r.norm), under = rr.filter(r => ratio(r) < .5);
  const spread = rr.reduce((a, r) => a + Math.abs(ratio(r) - 1), 0) / rr.length;
  const deg = Math.min(over.length && under.length ? 18 : 6, Math.round(spread * 22));
  $("#keel-word").textContent = deg < 5 ? "идёшь ровно" : deg < 12 ? "небольшой крен" : "сильный крен";
  const wave = (y, cls) => `<path class="${cls}" d="M0 ${y}${" q15 -6 30 0 t30 0".repeat(8)} V200 H0 Z"/>`;
  setHtml($("#keel-boat"), `<svg viewBox="0 0 360 190" role="img" aria-label="Лодка накренилась на ${deg}°">${wave(132, "w1")}
    <g class="tilt" style="--deg:${-deg}deg"><g class="bob">
      <path class="kl" d="M180 130 L174 178 H186 Z"/><path class="hull" d="M96 116 H264 L244 140 H116 Z"/>
      <line class="mast" x1="180" y1="116" x2="180" y2="28"/><path class="s1" d="M184 32 V110 H240 Z"/><path class="s2" d="M176 40 V110 H132 Z"/>
    </g></g>${wave(146, "w2")}</svg>`);
  const list = l => l.map(r => `${esc(capF(r.s))} <span>${r.touched} из ${r.norm}</span>`).join("<br>");
  $("#keel-sides").innerHTML = over.length || under.length
    ? `<div><b>Перевес</b>${list(over) || "нет"}</div><div><b>Выровнять</b>${list(under) || "нет"}</div>`
    : `<p class="bal-ok">Все сферы около своей нормы.</p>`;
}
const CARE_MARK = "отмечено вручную";
// Кнопки «уделил время сфере» за день k: что уже видно по привычкам и задачам, отмечено само
function careChips(k) {
  const act = sphereActivity(k, k), man = S.data.care[k] || [];
  return `<div class="care">${(settings().spheres || []).map(s => {
    const auto = [...new Set((act[s][k] || []).filter(w => w !== CARE_MARK))], on = !!auto.length || man.includes(s);
    return `<button type="button" class="cchip" data-care="${esc(s)}" data-care-day="${k}" aria-pressed="${on}" ${auto.length ? "disabled" : ""}>
      <span class="tick">${CHECK}</span><span class="cn">${esc(s)}${auto.length ? `<small>${esc(auto.join(", "))}</small>` : ""}</span></button>`;
  }).join("")}</div>`;
}
function renderBalanceTags() {
  const box = $("#bal-tags");
  if (!T.data) { box.hidden = true; return; }
  const from = addDaysK(ymd(todayDate()), -6);
  const list = T.data.tasks.filter(x => !parentOf(x) && !parked(x) && (x.status !== "completed" || (x.completed && ymd(new Date(x.completed)) >= from)));
  const rows = list.map(x => ({ x, s: taskSphere(x), tagged: S.data.tags[x.id] !== undefined }))
    .sort((a, b) => (a.s ? 1 : 0) - (b.s ? 1 : 0)).slice(0, 30);
  const none = list.filter(x => !taskSphere(x)).length;
  box.hidden = !list.length;
  box.querySelector("summary").innerHTML = `Сферы задач${none ? ` · <span class="warn-t">без сферы: ${none}</span>` : ""}`;
  if (!document.activeElement?.closest?.("#bal-tags ul"))
    box.querySelector("ul").innerHTML = rows.map(({ x, s, tagged }) => `<li><span>${esc(x.title)}<small>${esc(x.list)}${kidsOf(x).length ? ` · ${kidsOf(x).length} ${plural(kidsOf(x).length, "подзадача", "подзадачи", "подзадач")} — с той же сферой` : ""}${tagged ? "" : listSphere(x.list) && s === listSphere(x.list) ? " · по списку" : s ? " · угадано" : ""}</small></span>
    <select class="field mini" data-tag="${esc(x.id)}" aria-label="Сфера задачи «${esc(x.title)}»">${sphereOptions(s)}</select></li>`).join("");
}
const DUE_FAIL = "Дату в Google Задачах поменять не удалось. Обнови скрипт google-tasks.gs и сделай новую версию развёртывания — см. «Настройки → Google Задачи».";
// Нажатие на предложение добавляет его в главное, повторное — убирает
function renderBalanceLists() {
  const box = $("#bal-lists");
  box.hidden = !T.data?.lists?.length;
  if (box.hidden || document.activeElement?.closest?.("#bal-lists ul")) return;
  const sp = settings().spheres || [], set = settings().listSpheres || {};
  const opts = sel => `<option value="" ${sel === "" ? "selected" : ""}>по словам</option>`
    + sp.map(x => `<option value="${esc(x)}" ${x === sel ? "selected" : ""}>${esc(x)}</option>`).join("")
    + `<option value="__parked" ${sel === "__parked" ? "selected" : ""}>не предлагать</option>`;
  const unset = T.data.lists.filter(l => !Object.hasOwn(set, l.title)).length;
  box.querySelector("summary").innerHTML = `Списки Google и сферы${unset ? ` · <span class="faint">не настроено: ${unset}</span>` : ""}`;
  box.querySelector("ul").innerHTML = T.data.lists.map(l => {
    const n = T.data.tasks.filter(x => x.listId === l.id && x.status !== "completed").length;
    return `<li><span>${esc(l.title)}<small>${n} ${plural(n, "открытая задача", "открытые задачи", "открытых задач")}</small></span>
      <select class="field mini" data-list="${esc(l.title)}" aria-label="Сфера списка «${esc(l.title)}»">${opts(listMode(l.title))}</select></li>`;
  }).join("");
}
$("#bal-lists").addEventListener("change", e => {
  const el = e.target.closest("[data-list]");
  if (el && canWrite()) { setSetting({ listSpheres: { ...(settings().listSpheres || {}), [el.dataset.list]: el.value } }); el.blur(); }
});
function addBalanceIdea(i) {
  const x = S.balIdeas?.[i], tgtK = ymd(planTarget()), day = tgtK === ymd(todayDate()) ? "сегодня" : "завтра";
  if (!x || !canWrite()) return;
  const items = (S.data.focus[tgtK] || []).map(f => ({ ...f }));
  const at = items.findIndex(f => (x.taskId && f.taskId === x.taskId) || f.t === x.t);
  if (at >= 0) { removeFocus(tgtK, at); return; }
  if (items.length >= 3) return;
  const task = x.taskId && T.data?.tasks.find(t => t.id === x.taskId), move = task && task.due !== tgtK;
  // прежняя дата задачи — чтобы вернуть её, если выбор отменят
  items.push({ t: x.t, src: focusSrc(x, x.s), done: false, taskId: x.taskId || null, listId: x.listId || null, goal: x.goal || null, habit: x.habit || null, ...(move ? { prevDue: task.due } : {}) });
  op({ t: "focus", date: tgtK, items });
  toast(`В главное на ${day}: ${x.t}`, () => { const k = (S.data.focus[tgtK] || []).findIndex(f => f.t === x.t); if (k >= 0) removeFocus(tgtK, k, true); });
  if (move) taskDue(task, tgtK).then(renderPlan).catch(() => notice(DUE_FAIL));
}
function removeFocus(k, at, quiet) {
  const items = (S.data.focus[k] || []).map(f => ({ ...f })), [it] = items.splice(at, 1);
  if (!it) return;
  op({ t: "focus", date: k, items });
  const task = it.taskId && T.data?.tasks.find(t => t.id === it.taskId);
  if (task && "prevDue" in it && task.due === k) taskDue(task, it.prevDue).then(renderPlan).catch(() => notice(DUE_FAIL));
  if (!quiet) toast(`Убрано из главного: ${it.t}`, () => {
    const now = (S.data.focus[k] || []).map(f => ({ ...f }));
    if (now.length >= 3) return;
    now.splice(at, 0, it); op({ t: "focus", date: k, items: now });
    if (task && "prevDue" in it && task.due !== k) taskDue(task, k).then(renderPlan).catch(() => notice(DUE_FAIL));
  });
}
document.addEventListener("click", e => {
  const c = e.target.closest("[data-care]");
  if (c) {
    if (c.disabled || !canWrite()) return;
    const k = c.dataset.careDay, s = c.dataset.care;
    op({ t: "care", date: k, sphere: s, val: !(S.data.care[k] || []).includes(s) });
    if (W.kind) renderWizard();
    return;
  }
  const g = e.target.closest("[data-bg]");
  if (g) { const [i, j] = g.dataset.bg.split(":").map(Number); balDetail(i, j); return; }
  if (e.target.closest("[data-bmore]")) { S.balMore = !S.balMore; renderBalance(); return; }
  const a = e.target.closest("[data-balt]");
  if (a) { S.balAlt[a.dataset.balt] = (S.balAlt[a.dataset.balt] || 0) + 1; renderBalance(); return; }
  const b = e.target.closest("[data-badd]");
  if (b && !b.disabled) addBalanceIdea(Number(b.dataset.badd));
});
$("#bal-tags").addEventListener("change", e => {
  const el = e.target.closest("[data-tag]");
  if (el && canWrite()) { op({ t: "tag", id: el.dataset.tag, sphere: el.value }); el.blur(); }
});
$("#bal-norms").addEventListener("change", e => {
  const el = e.target.closest("[data-norm]");
  if (el && canWrite()) { setSetting({ sphereNorms: { ...(settings().sphereNorms || {}), [el.dataset.norm]: Number(el.value) } }); el.blur(); }
});
function wizCare() {
  return `<p class="note" style="margin:0">Чему ${W.st.dayK === ymd(todayDate()) ? "сегодня" : "вчера"} уделил время? Отмеченное само — по привычкам, задачам и времени вдвоём; остальное отметь здесь.</p>${careChips(W.st.dayK)}`;
}

/* ---------- время на цели ---------- */
function slotStats(from, to) {
  const t = todayDate(), m = nowMin(), r = { avail: 0, done: 0, count: 0, doneN: 0, skipped: 0, byGoal: {} };
  for (let d = new Date(from); d <= to && d <= t; d = addDays(d, 1)) {
    const k = ymd(d);
    for (const x of slotsOn(d)) {
      const len = toMin(x.to) - toMin(x.from), s = sess(sKey(k, x.from));
      if (k === ymd(t) && toMin(x.to) > m && s?.status !== "done") continue;
      r.count++; r.avail += len;
      if (s?.status === "done") { r.doneN++; r.done += s.minutes || 0; const g = s.project ? "p:" + s.project : s.goal || "_"; r.byGoal[g] = (r.byGoal[g] || 0) + (s.minutes || 0); }
      if (s?.status === "skipped" || !s?.text) r.skipped++;
    }
  }
  return r;
}
function renderFocusTime() {
  const t = todayDate(), mon = monday(t), w = slotStats(mon, addDays(mon, 6));
  const tile = (v, l) => `<div><b>${v}</b><span>${l}</span></div>`;
  $("#ft-tiles").innerHTML = tile(`${fmtDur(w.done)}`, "на цели за неделю") + tile(w.avail ? pct(w.done / w.avail) : "—", "от свободного времени")
    + tile(`${w.doneN} из ${w.count}`, "слотов с шагом") + tile(String(w.skipped), "пропущено или без шага");
  $("#ft-aside").textContent = (settings().slots || []).length ? `свободно в неделю ${fmtDur((settings().slots || []).reduce((a, x) => a + toMin(x.to) - toMin(x.from), 0))}` : "";
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const m0 = addDays(mon, -7 * i), r = slotStats(m0, addDays(m0, 6));
    weeks.push({ label: String(isoWeek(m0)), value: r.avail ? r.done / r.avail : null, current: i === 0,
      tip: `${fmtDay.format(m0)} – ${fmtDay.format(addDays(m0, 6))} · ${fmtDur(r.done)} из ${fmtDur(r.avail)}` });
  }
  barChart($("#ft-chart"), weeks);
  const mr = slotStats(new Date(t.getFullYear(), t.getMonth(), 1), t), ent = Object.entries(mr.byGoal).sort((a, b) => b[1] - a[1]), max = Math.max(1, ...ent.map(e => e[1]));
  $("#ft-goals").innerHTML = ent.length ? ent.map(([g, min]) => `<li><div class="hb-top"><span>${esc(g.startsWith("p:") ? g.slice(2) : g === "_" ? "Без проекта" : goalTitle(g) || "Цель удалена")}</span><span class="v">${fmtDur(min)}</span></div>
    <div class="hb"><i style="width:${min / max * 100}%"></i></div></li>`).join("") : `<li class="empty">Пока нет сделанных слотов в этом месяце.</li>`;
}

/* ---------- ритуалы ---------- */
function ritualDue() {
  const hr = new Date().getHours(), t = todayDate(), dw = dow(t);
  if (dw >= 5 && !S.data.reviews[weekKey(t)]) return { kind: "weekly" };
  if (dw === 0 && hr < 12 && !S.data.reviews[weekKey(addDays(t, -7))]) return { kind: "weekly", last: true };
  const rd = ymd(hr < 3 ? addDays(t, -1) : t);
  if ((hr >= 19 || hr < 3) && !S.data.rituals.evening?.[rd]) return { kind: "evening" };
  return null;
}
function renderRitualCard() {
  const card = $("#ritual-card"), r = S.data && ritualDue();
  card.hidden = !r;
  if (!r) return;
  const icon = r.kind === "weekly"
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="var(--violet)" stroke-width="1.8" stroke-linecap="round"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4M8.5 14.5l2 2 4-4"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="var(--violet)" stroke-width="1.8" stroke-linecap="round"><path d="M15.5 4a8.5 8.5 0 1 0 4.8 12.4A7 7 0 0 1 15.5 4z"/></svg>';
  const [title, sub] = r.kind === "weekly"
    ? [r.last ? "Обзор прошлой недели" : "Обзор недели", "Итоги, задачи, цели и шаги на слоты — около 20 минут."]
    : ["Вечерние 5 минут", "Отметь день, выбери главное на завтра и загляни в завтрашний день."];
  card.innerHTML = `<div class="r-ic">${icon}</div><div class="r-t"><b>${title}</b><span>${sub}</span></div>
    <button type="button" class="btn" data-open-wizard="${r.kind}">Начать</button>`;
}

/* ---------- окно ритуала ---------- */
const W = { kind: null, i: 0, st: {} };
function wizHabits() {
  const k = W.st.dayK;
  return `<p class="note" style="margin:0">Отметь, что получилось ${k === ymd(todayDate()) ? "сегодня" : "вчера"}.</p>
    <ul class="today card">${active().map(h => `<li><button type="button" class="hab" aria-pressed="${isDone(k, h.id)}" data-wh="${esc(h.id)}">
      <span class="tick">${CHECK}</span><span class="hab-main"><span class="hab-name">${esc(h.name)}</span>
      <span class="hab-meta">${weekCount(h, monday(parse(k)))} из ${h.target || 1} за неделю</span></span></button></li>`).join("") || '<li class="empty">Привычек нет.</li>'}</ul>`;
}
function wizFocus() {
  const tgt = W.st.target, isT = tgt === ymd(todayDate()), f = W.st.focus, full = f.length >= 3;
  const has = c => f.some(x => (c.taskId && x.taskId === c.taskId) || x.t === c.t);
  const cands = [];
  balanceRecs(tgt, balance(tgt)).forEach(r => [r.ideas[(S.balAlt?.[r.s] || 0) % r.ideas.length]].forEach(x =>
    cands.push({ t: x.t, src: focusSrc(x, r.s), note: `${FROM[x.from]} · ${r.s}${x.taskId && parentOf(taskIndex().byId.get(x.taskId) || {}) ? ` › ${parentOf(taskIndex().byId.get(x.taskId)).title}` : ""} · ${agoText(r)}`, taskId: x.taskId || null, listId: x.listId || null, goal: x.goal || null, stepId: x.stepId || null, habit: x.habit || null, kind: "Пора уделить время — сферы, которые давно без внимания" })));
  stepCatalog().forEach(c => cands.push({ t: c.text, src: c.gt, goal: c.goal, stepId: c.stepId || null, kind: "Шаги целей" }));
  if (T.data) {
    const pr = x => { const d = effDue(x); return !d ? 3 : d < tgt ? 0 : d === tgt ? 1 : 2; };
    // то, что уже предложено в «Упоре», второй раз не показываем
    const picked = T.data.tasks.filter(x => actionable(x) && !parked(x) && !cands.some(c => c.taskId === x.id) && (!effDue(x) || effDue(x) <= addDaysK(tgt, 3)))
      .sort((a, b) => pr(a) - pr(b) || byPos(a, b)).slice(0, 12);
    // подзадачи одной задачи — подряд, под её названием
    const roots = [...new Set(picked.map(x => x.parent || x.id))];
    roots.forEach(r => picked.filter(x => (x.parent || x.id) === r).forEach(x => {
      const p = parentOf(x), d = effDue(x);
      cands.push({ t: x.title, src: taskSrc(x), note: p ? `${d ? `срок ${fmtDM.format(parse(d))}` : ""}` : taskSrc(x), under: p ? `${p.title} · ${p.list}` : null,
        taskId: x.id, listId: x.listId, kind: "Google Задачи" });
    }));
  }
  W.cands = cands;
  const groups = [...new Set(cands.map(c => c.kind))];
  return `<p class="note" style="margin:0">Не больше трёх дел на ${isT ? "сегодня" : "завтра"}. Остальное подождёт.</p>
    <ol class="chosen">${f.length ? f.map((it, i) => `<li><span>${i + 1}. ${esc(it.t)}</span><button type="button" class="xbtn" data-fdel="${i}" aria-label="Убрать">×</button></li>`).join("")
      : '<li class="empty" style="background:none;padding:0">Пока ничего не выбрано.</li>'}</ol>
    ${groups.map(gk => { let last = null; return `<div class="pick"><p class="pick-h">${gk}</p>${cands.map((c, i) => {
      if (c.kind !== gk) return "";
      const head = c.under && c.under !== last ? `<p class="pick-sub">${esc(c.under)}</p>` : "", note = c.note ?? c.src ?? "";
      last = c.under;
      return head + `<button type="button" class="pi${c.under ? " sub" : ""}" data-fadd="${i}" aria-pressed="${has(c)}" ${full && !has(c) ? "disabled" : ""}><span>${esc(c.t)}${note ? `<small>${esc(note)}</small>` : ""}</span><span class="plus">${has(c) ? "✓" : "+"}</span></button>`;
    }).join("")}</div>`; }).join("")}
    ${!T.data ? `<p class="note" style="margin:0">Google Задачи не подключены — дела из них появятся здесь после подключения.</p>` : ""}
    <div class="pick"><p class="pick-h">Своё</p><form class="inline-plan" data-fown><input class="field" id="wf-own" placeholder="Например: позвонить в банк" autocomplete="off" ${full ? "disabled" : ""}><button type="submit" class="btn ghost" ${full ? "disabled" : ""}>Добавить</button></form></div>`;
}
const addDaysK = (k, n) => ymd(addDays(parse(k), n));
function wizSlotInputs(list) {
  return list.length ? (slotSteps().length ? "" : `<p class="note" style="margin:0">${NO_STEPS()}</p>`)
    + `<ul class="splan card">${list.map(x => { const s = sess(x.key);
    return `<li><div class="sd">${fmtShort.format(x.d)}<small>${hz(x.from)}–${hz(x.to)}</small></div>
      ${s?.status === "done" ? `<span class="sx">${esc(s.text)} · сделано</span>` : slotSelect(x.key, "data-wplan", { value: W.st.plans[x.key] })}</li>`; }).join("")}</ul>`
    : `<p class="note" style="margin:0">Свободных слотов нет. Их можно задать в «Настройки → Распорядок».</p>`;
}
function wizTomorrow() {
  const tgt = W.st.target, d = parse(tgt), f = forecast(tgt), rec = recFor(tgt), st = settings();
  const busy = (st.busyDays || []).includes(dow(d)) && st.busyLabel;
  const due = T.data ? T.data.tasks.filter(x => x.status !== "completed" && x.due === tgt).length : null;
  const lines = [
    f ? `${kidName()} проснётся около <b>${hm(f.pred)}</b> (${hm(f.lo)}–${hm(f.hi)})` : `Прогноз подъёма ${kidGen()} пока не готов`,
    rec != null ? `Тебе вставать в <b>${hm(rec)}</b>` : "",
    busy ? `Вечер: ${esc(st.busyLabel)}` : "",
    due != null ? `Задач с датой на этот день: ${due}` : "",
  ].filter(Boolean);
  return `<div class="w-line">${lines.map(x => `<span>${x}</span>`).join("")}</div>
    <p class="pick-h">Слоты — один шаг на каждый</p>${wizSlotInputs(slotsOn(d).map(x => ({ ...x, d, date: tgt, key: sKey(tgt, x.from) })))}`;
}
function wizWeekSummary() {
  const mon = W.st.mon, sun = addDays(mon, 6), ns = normStats(mon, sun), sl = slotStats(mon, sun);
  const wakes = []; for (let d = new Date(mon); d <= sun; d = addDays(d, 1)) { const w = wakeOf(ymd(d)); if (w != null) wakes.push(w); }
  const tg = Object.keys(S.data.together).filter(k => k >= ymd(mon) && k <= ymd(sun)).length;
  const tile = (v, l) => `<div><b>${v}</b><span>${l}</span></div>`;
  const habits = ns.per.map(r => { const c = weekCount(r.h, mon); return `<span>${esc(r.h.name)}: ${c} из ${r.h.target || 1}${c >= (r.h.target || 1) ? " ✓" : ""}</span>`; }).join("");
  const goals = goalsActive().map(g => { const st = gStatus(g); return `<span>${esc(g.title)} — ${st.text}${g.kind === "steps" ? `, ${(g.steps || []).filter(x => x.done).length} из ${(g.steps || []).length} этапов` : `, ${fmtN.format(gCur(g))}${g.unit ? " " + esc(g.unit) : ""}`}</span>`; }).join("");
  return `<p class="note" style="margin:0">${fmtDay.format(mon)} – ${fmtDay.format(sun)}</p>
    <div class="w-stat">${tile(pct(ns.pct), "нормы привычек")}${tile(fmtDur(sl.done), "в слотах на цели")}${tile(`${sl.doneN} из ${sl.count}`, "слотов с шагом")}${tile(tg ? String(tg) : "0", "раз вдвоём")}</div>
    ${wakes.length ? `<div class="w-line"><span>${kidName()} вставал обычно в <b>${hm(median(wakes))}</b> (${wakes.length} ${plural(wakes.length, "утро", "утра", "утр")})</span></div>` : ""}
    ${habits ? `<div class="w-line"><b>Привычки</b>${habits}</div>` : ""}
    ${goals ? `<div class="w-line"><b>Цели</b>${goals}</div>` : ""}
    <p class="note" style="margin:0">Что получилось лучше всего и что мешало? Ответь себе одной фразой — это и есть вывод недели.</p>`;
}
function wizTasks() {
  if (!T.data) return `<div class="w-line"><b>Google Задачи не подключены</b><span>Открой свой список задач и разбери каждую: сделать сразу, поставить дату или удалить.</span></div>
    <a class="btn ghost" href="https://tasks.google.com/" target="_blank" rel="noopener" style="text-align:center;text-decoration:none">Открыть Google Задачи</a>`;
  const tk = ymd(todayDate()), open = T.data.tasks.filter(x => x.status !== "completed");
  const overdue = open.filter(x => x.due && x.due < tk), undated = open.filter(x => !x.due), stale = open.filter(x => x.updated && Date.now() - Date.parse(x.updated) > 30 * 864e5);
  const tile = (v, l) => `<div><b>${v}</b><span>${l}</span></div>`;
  return `<div class="w-stat">${tile(open.length, "открыто")}${tile(overdue.length, "просрочено")}${tile(undated.length, "без даты")}${tile(stale.length, "висит дольше месяца")}</div>
    ${overdue.length ? `<div class="w-line"><b>Просрочено</b>${overdue.slice(0, 6).map(x => `<span>${esc(x.title)} · ${fmtDM.format(parse(x.due))}</span>`).join("")}</div>` : ""}
    ${stale.length ? `<div class="w-line"><b>Висит дольше месяца</b>${stale.slice(0, 6).map(x => `<span>${esc(x.title)}</span>`).join("")}</div>` : ""}
    <p class="note" style="margin:0">Правило: каждую задачу — сделать сейчас, поставить дату или удалить. Третьего варианта нет.</p>
    <a class="btn ghost" href="https://tasks.google.com/" target="_blank" rel="noopener" style="text-align:center;text-decoration:none">Открыть Google Задачи</a>`;
}
function wizGoals() {
  const gs = goalsActive();
  if (!gs.length) return `<p class="note" style="margin:0">Стратегических целей пока нет. Их можно добавить во вкладке «Цели» — тогда здесь можно будет обновлять прогресс и выбирать следующий шаг.</p>`;
  return gs.map(g => {
    const st = gStatus(g), v = W.st.goals[g.id] || {};
    if (g.kind === "steps") {
      const nx = (g.steps || []).find(x => !x.done);
      return `<div class="w-line"><b>${esc(g.title)} <span class="chip ${st.cls}">${st.text}</span></b>
        ${nx ? `<label style="display:flex;gap:8px;align-items:center;font-size:14.5px"><input type="checkbox" data-wg-step="${esc(g.id)}:${esc(nx.id)}" ${v.stepDone ? "checked" : ""}> Этап «${esc(nx.t)}» пройден</label>` : "<span>Все этапы пройдены.</span>"}</div>`;
    }
    return `<div class="w-line"><b>${esc(g.title)} <span class="chip ${st.cls}">${st.text}</span></b>
      <div class="fgrid"><label>Сейчас${g.unit ? `, ${esc(g.unit)}` : ""} <input class="field" type="number" step="any" data-wg-val="${esc(g.id)}" value="${esc(v.val ?? gCur(g))}"></label>
      <label class="wide">Следующий шаг <input class="field" data-wg-next="${esc(g.id)}" value="${esc(v.next ?? g.next ?? "")}" placeholder="Конкретное следующее действие" maxlength="100"></label></div></div>`;
  }).join("");
}
const WIZ = {
  evening: { title: "Вечерние 5 минут", steps: [["Привычки за день", wizHabits], ["Чему уделил время", wizCare], ["Главное на завтра", wizFocus], ["Завтра", wizTomorrow]] },
  focus: { title: "Главное на сегодня", steps: [["Главное на сегодня", wizFocus]] },
  weekly: { title: "Обзор недели", steps: [["Итоги недели", wizWeekSummary], ["Задачи", wizTasks], ["Цели", wizGoals], ["Слоты на неделю", () => wizSlotInputs(upcomingSlots(8))]] },
};
function openWizard(kind) {
  if (!canWrite()) { openConnect(); return; }
  const hr = new Date().getHours(), t = todayDate();
  W.kind = kind; W.i = 0;
  if (kind === "evening") {
    const dayK = ymd(hr < 3 ? addDays(t, -1) : t), target = ymd(hr < 3 ? t : addDays(t, 1));
    W.st = { dayK, target, focus: (S.data.focus[target] || []).map(x => ({ ...x })), plans: {} };
  } else if (kind === "focus") {
    const tk = ymd(t);
    W.st = { dayK: tk, target: tk, focus: (S.data.focus[tk] || []).map(x => ({ ...x })), plans: {} };
  } else {
    const last = dow(t) === 0 && hr < 12 && !S.data.reviews[weekKey(addDays(t, -7))];
    const mon = monday(last ? addDays(t, -7) : t);
    W.st = { mon, week: weekKey(mon), plans: {}, goals: {} };
  }
  renderWizard();
  $("#sheet").hidden = false; document.body.classList.add("noscroll");
  loadTasks();
}
function closeWizard() { $("#sheet").hidden = true; document.body.classList.remove("noscroll"); W.kind = null; }
function collectWizard() {
  document.querySelectorAll("#sheet-body [data-wplan]").forEach(el => { if (!el.disabled) W.st.plans[el.dataset.wplan] = el.value; });
  document.querySelectorAll("#sheet-body [data-wg-val]").forEach(el => { (W.st.goals[el.dataset.wgVal] ||= {}).val = el.value; });
  document.querySelectorAll("#sheet-body [data-wg-next]").forEach(el => { (W.st.goals[el.dataset.wgNext] ||= {}).next = el.value; });
  document.querySelectorAll("#sheet-body [data-wg-step]").forEach(el => { (W.st.goals[el.dataset.wgStep.split(":")[0]] ||= {}).stepDone = el.checked; });
}
function renderWizard() {
  if (!W.kind) return;
  const def = WIZ[W.kind], steps = def.steps, [title, fn] = steps[W.i];
  $("#sheet-step").textContent = steps.length > 1 ? `${def.title} · шаг ${W.i + 1} из ${steps.length}` : def.title;
  $("#sheet-title").textContent = title;
  $("#sheet-dots").innerHTML = steps.length > 1 ? steps.map((_, i) => `<i class="${i <= W.i ? "on" : ""}"></i>`).join("") : "";
  $("#sheet-body").innerHTML = fn();
  $("#sheet-back").style.visibility = W.i ? "visible" : "hidden";
  $("#sheet-next").textContent = W.i === steps.length - 1 ? "Готово" : "Дальше";
}
async function taskDue(task, date) {
  const st = settings();
  const r = await fetch(st.tasksUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ key: st.tasksKey, action: "due", listId: task.listId, id: task.id, due: date }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  task.due = date; lsSet(LS.tasks, T.data);
}
function finishWizard() {
  collectWizard();
  const ops = [], kind = W.kind, st = W.st, tk = ymd(todayDate());
  for (const [key, v] of Object.entries(st.plans)) { const o = planOp(key, v); if (o) ops.push(o); }
  let msg = "";
  if (kind === "evening" || kind === "focus") {
    const items = st.focus.map(x => {
      const task = x.taskId && T.data?.tasks.find(t => t.id === x.taskId);
      const prev = "prevDue" in x ? { prevDue: x.prevDue } : task && task.due !== st.target ? { prevDue: task.due } : {};
      return { t: x.t, src: x.src || "", done: !!x.done, taskId: x.taskId || null, listId: x.listId || null, goal: x.goal || null, habit: x.habit || null, ...prev };
    });
    ops.push({ t: "focus", date: st.target, items });
    if (kind === "evening") ops.push({ t: "ritual", kind: "evening", date: st.dayK, time: nowHM() });
    msg = items.length ? `Главное на ${st.target === tk ? "сегодня" : "завтра"}: ${items.length}` : "Готово";
    if (tasksUrl() && T.data) {
      const need = items.map(x => x.taskId && T.data.tasks.find(t => t.id === x.taskId)).filter(t => t && t.due !== st.target);
      Promise.all(need.map(t => taskDue(t, st.target))).then(() => { if (need.length) renderPlan(); })
        .catch(() => notice("Дату в Google Задачах поставить не удалось. Обнови скрипт google-tasks.gs и сделай новую версию развёртывания — см. «Настройки → Google Задачи»."));
    }
  } else {
    for (const g of goalsActive()) {
      const v = st.goals[g.id]; if (!v) continue;
      if (g.kind === "steps") {
        const nx = (g.steps || []).find(x => !x.done);
        if (v.stepDone && nx) ops.push({ t: "goalStep", id: g.id, sid: nx.id, data: { done: true, doneAt: tk } });
      } else {
        const num = Number(String(v.val ?? "").replace(",", "."));
        if (v.val !== undefined && v.val !== "" && Number.isFinite(num) && num !== gCur(g)) ops.push({ t: "goalLog", id: g.id, d: tk, v: num });
        if (v.next !== undefined && v.next.trim() !== (g.next || "")) ops.push({ t: "goal", id: g.id, data: { next: v.next.trim() } });
      }
    }
    ops.push({ t: "review", week: st.week, date: tk });
  }
  // планы слотов, выбранные из шагов целей, обновляем после смены следующих шагов
  op(...ops);
  if (kind === "weekly") msg = `Обзор недели проведён. Серия: ${reviewStreak()} ${plural(reviewStreak(), "неделя", "недели", "недель")}`;
  closeWizard();
  toast(msg);
}
$("#sheet-next").addEventListener("click", () => {
  collectWizard();
  if (W.i < WIZ[W.kind].steps.length - 1) { W.i++; renderWizard(); $("#sheet-body").scrollTop = 0; } else finishWizard();
});
$("#sheet-back").addEventListener("click", () => { collectWizard(); if (W.i) { W.i--; renderWizard(); } });
$("#sheet-close").addEventListener("click", closeWizard);
$("#sheet").addEventListener("click", e => { if (e.target.id === "sheet") closeWizard(); });
addEventListener("keydown", e => { if (e.key === "Escape" && W.kind) closeWizard(); });
$("#sheet-body").addEventListener("click", e => {
  const h = e.target.closest("[data-wh]");
  if (h) { const k = W.st.dayK; op({ t: "check", date: k, hid: h.dataset.wh, val: !isDone(k, h.dataset.wh) }); renderWizard(); return; }
  const a = e.target.closest("[data-fadd]");
  if (a && !a.disabled) {
    const c = W.cands[Number(a.dataset.fadd)], at = c ? W.st.focus.findIndex(x => (c.taskId && x.taskId === c.taskId) || x.t === c.t) : -1;
    if (at >= 0) { W.st.focus.splice(at, 1); collectWizard(); renderWizard(); return; }
    if (c && W.st.focus.length < 3) { W.st.focus.push({ t: c.t, src: c.src, taskId: c.taskId || null, listId: c.listId || null, goal: c.goal || null, habit: c.habit || null }); collectWizard(); renderWizard(); } return; }
  const d = e.target.closest("[data-fdel]");
  if (d) { W.st.focus.splice(Number(d.dataset.fdel), 1); collectWizard(); renderWizard(); }
});
$("#sheet-body").addEventListener("submit", e => {
  e.preventDefault();
  const inp = e.target.querySelector("#wf-own"), v = inp?.value.trim();
  if (v && W.st.focus.length < 3) { W.st.focus.push({ t: v, src: "" }); collectWizard(); renderWizard(); }
});
document.addEventListener("click", e => {
  const w = e.target.closest("[data-open-wizard]");
  if (w) { openWizard(w.dataset.openWizard); return; }
  const f = e.target.closest("[data-focus]");
  if (f) { toggleFocus(Number(f.dataset.focus)); return; }
  const sa = e.target.closest("[data-slot-act]");
  if (sa) { const key = $("#slot-card").dataset.key; if (key) slotAction(key, sa.dataset.slotAct); }
});
$("#slot-card").addEventListener("change", e => {
  const el = e.target.closest("[data-slot-pick]"), o = el && planOp(el.dataset.slotPick, el.value);
  if (o) op(o);
});
$("#slot-plan-list").addEventListener("change", e => {
  const el = e.target.closest("[data-plan-key]");
  if (!el) return;
  const o = planOp(el.dataset.planKey, el.value);
  el.blur();
  if (o) op(o);
});
$("#rv-start").addEventListener("click", () => openWizard("weekly"));

/* ---------- молитва ---------- */
// Идущий таймер живёт в localStorage этого устройства: {start, paused, idle, point, marks[], chimed, date, s}
const PR_KEY = "habits.prayer";
let prTick = null, wakeLock = null, audioCtx = null;
function prRun() { try { return JSON.parse(store.getItem(PR_KEY)); } catch { return null; } }
function prSave(v) { try { v ? store.setItem(PR_KEY, JSON.stringify(v)) : store.removeItem(PR_KEY); } catch {} }
function prElapsed(r = prRun()) { return r ? Math.max(0, (r.paused || Date.now()) - r.start - (r.idle || 0)) : 0; }
const mmss = ms => { const t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60); return h ? `${h}:${pad(m)}:${pad(t % 60)}` : `${m}:${pad(t % 60)}`; };
const prTarget = () => settings().prayerTarget || 15;
const prPlan = () => (settings().prayerPlan || []).map(x => String(x).trim()).filter(Boolean);
const prHabitId = () => { const st = settings(); return st.prayerHabit == null ? st.morningHabit || "" : st.prayerHabit; };
const prayMinutes = k => (S.data?.prayer?.[k] || []).reduce((a, x) => a + (x.m || 0), 0);

function startPrayer() {
  if (!prRun()) prSave({ start: Date.now(), paused: null, idle: 0, point: 0, marks: [], chimed: false, date: ymd(todayDate()), s: nowHM() });
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume?.(); } catch {}
  openPray();
}
function openPray() {
  $("#pray").hidden = false; $("#pray-main").hidden = false; $("#pray-end").hidden = true;
  document.body.classList.add("noscroll");
  keepAwake(true); tickPray(); renderPlan();
}
function hidePray() { $("#pray").hidden = true; document.body.classList.remove("noscroll"); keepAwake(false); renderPrayCard(); renderPlan(); }
function tickPray() {
  const r = prRun();
  renderPrayCard();
  if ($("#pray").hidden || !r || !$("#pray-end").hidden) return;
  const el = prElapsed(r), tgt = prTarget() * 60000, C = 2 * Math.PI * 88, fg = $("#ring-fg");
  $("#pray-time").textContent = mmss(el);
  $("#pray-goal").textContent = el >= tgt ? `цель ${prTarget()} мин — есть` : `цель ${prTarget()} мин`;
  fg.style.strokeDasharray = C; fg.style.strokeDashoffset = C * (1 - Math.min(1, el / tgt)); fg.classList.toggle("over", el >= tgt);
  $("#pray").classList.toggle("paused", !!r.paused);
  $("#pray-state").textContent = r.paused ? "Пауза" : "Молитва";
  $("#pray-pause").textContent = r.paused ? "Продолжить" : "Пауза";
  const plan = prPlan(), i = Math.min(r.point || 0, plan.length), pn = prayNeeds(i);
  $("#pray-point").hidden = !plan.length && !pn.length;
  $("#pray-needs").innerHTML = pn.map(n => `<li>${esc(n.t)}</li>`).join("");
  if (!plan.length) { $("#pp-n").textContent = "Нужды"; $("#pp-t").textContent = ""; $("#pp-next").hidden = true; }
  if (plan.length) {
    $("#pp-n").textContent = i < plan.length ? `Пункт ${i + 1} из ${plan.length}` : "План пройден";
    $("#pp-t").textContent = i < plan.length ? plan[i] : "Можно продолжать свободно или завершить";
    $("#pp-next").hidden = i >= plan.length;
    $("#pp-next").textContent = i === plan.length - 1 ? "Последний пункт — готово" : "Дальше";
  }
  if (!r.chimed && !r.paused && el >= tgt) { r.chimed = true; prSave(r); if (settings().prayerChime !== false) chime(); }
}
// Тихий колокольчик из двух нот, без внешних файлов
function chime() {
  try {
    const ctx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(), t = ctx.currentTime;
    [[987.8, 0], [1318.5, .35]].forEach(([f, d]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(.0001, t + d); g.gain.exponentialRampToValueAtTime(.2, t + d + .02); g.gain.exponentialRampToValueAtTime(.0001, t + d + 2.4);
      o.connect(g).connect(ctx.destination); o.start(t + d); o.stop(t + d + 2.5);
    });
  } catch {}
}
async function keepAwake(on) {
  try {
    if (on && "wakeLock" in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener?.("release", () => { wakeLock = null; }); }
    else if (!on && wakeLock) { const w = wakeLock; wakeLock = null; await w.release(); }
  } catch { wakeLock = null; }
}
function finishPrayer() {
  const r = prRun(); if (!r) return;
  if (!r.paused) r.paused = Date.now();
  prSave(r);
  const plan = prPlan(), mins = Math.max(1, Math.round(prElapsed(r) / 60000)), hid = prHabitId(), h = habits().find(x => x.id === hid && !x.archived);
  $("#pray-main").hidden = true; $("#pray-end").hidden = false;
  $("#pray-mins").value = mins;
  $("#pray-end-sub").textContent = [`Начало в ${hz(r.s)}`, plan.length ? `пунктов плана: ${Math.min(r.point || 0, plan.length)} из ${plan.length}` : "",
    h && !isDone(r.date, h.id) ? `привычка «${h.name}» отметится` : ""].filter(Boolean).join(" · ");
}
function savePrayer() {
  const r = prRun(); if (!r) { hidePray(); return; }
  const m = Math.max(1, Math.min(300, Math.round(Number($("#pray-mins").value) || 0)));
  const prev = S.data.prayer[r.date] || [], plan = prPlan();
  const item = { s: r.s, m };
  // Фактический конец и паузы — чтобы видеть, что молитву прервали (например, проснулся ребёнок)
  const endAt = new Date(r.paused || Date.now()), pz = Math.round((r.idle || 0) / 60000);
  item.e = `${pad(endAt.getHours())}:${pad(endAt.getMinutes())}`;
  if (pz) item.pz = pz;
  if (plan.length) { item.p = Math.min(r.point || 0, plan.length); item.marks = (r.marks || []).map(ms => Math.round(ms / 1000)); }
  const ops = [{ t: "prayer", date: r.date, items: [...prev, item] }];
  const hid = prHabitId(), marked = hid && habits().some(x => x.id === hid && !x.archived) && !isDone(r.date, hid);
  if (marked) ops.push({ t: "check", date: r.date, hid, val: true });
  if (!op(...ops)) return;
  prSave(null); hidePray();
  toast(`Молитва ${fmtDur(m)} записана${marked ? " · привычка отмечена" : ""}`, () => {
    const back = [{ t: "prayer", date: r.date, items: prev }];
    if (marked) back.push({ t: "check", date: r.date, hid, val: false });
    op(...back);
  });
}
function renderNow() {
  if (!S.data) return;
  const hr = new Date().getHours(), m = nowMin(), r = prRun(), x = currentSlot(), s = x && sess(x.key), rit = ritualDue();
  const prayOn = !!r || (hr >= 3 && hr < 12), prayMet = prayOn && !r && prayMinutes(ymd(todayDate())) >= prTarget();
  const live = x && ((m >= x.a && m < x.z) || s?.status === "started");
  const pick = r ? "pray" : live ? "slot" : rit ? "ritual" : prayOn && !prayMet ? "pray"
    : x && s?.status !== "done" ? "slot" : prayOn ? "pray" : x ? "slot" : null;
  $("#pray-card").hidden = pick !== "pray"; $("#ritual-card").hidden = pick !== "ritual"; $("#slot-card").hidden = pick !== "slot";
}
/* ---------- стих дня ---------- */
// Каждый день — следующий стих из verses.js и маленькое дело по нему
function verseOf(k) {
  const list = window.VERSES || [];
  if (!list.length) return null;
  const n = Math.round((parse(k) - new Date(2026, 0, 1)) / 864e5);
  return list[((n % list.length) + list.length) % list.length];
}
function renderVerse() {
  const card = $("#verse-card"), tk = ymd(todayDate()), v = S.data && verseOf(tk);
  card.hidden = !v;
  if (!v) return;
  const key = `${tk}|${kidName()}`;
  if (card.dataset.key === key) return; // не перерисовываем — иначе анимация начнётся заново
  card.dataset.key = key;
  let seen = null;
  try { seen = localStorage.getItem("keel.verseSeen"); } catch {}
  const rise = seen !== tk && !card.dataset.shown;
  const words = v.t.split(" ");
  const act = v.a.replace(/\{kidGen\}/g, kidGen()).replace(/\{kid\}/g, kidName());
  card.classList.toggle("rise", rise);
  card.style.setProperty("--after", `${words.length * 70 + 450}ms`);
  card.innerHTML = `<span class="v-eye"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3v3M4.9 6.9l2.1 2.1M19.1 6.9 17 9M2 16h20M6 16a6 6 0 0 1 12 0"/></svg>Стих дня</span>
    <blockquote>${words.map((w, i) => `<span class="w" style="--i:${i}">${esc(w)}</span>`).join(" ")}</blockquote>
    <cite>${esc(v.r)}</cite>
    <div class="v-act"><p><span>Сегодня:</span> ${esc(act)}</p></div>`;
  card.dataset.shown = "1";
  if (rise) try { localStorage.setItem("keel.verseSeen", tk); } catch {}
}
function renderPrayCard() {
  if (!S.data) return;
  const r = prRun(), tk = ymd(todayDate());
  const done = prayMinutes(tk), tgt = prTarget(), met = !r && done >= tgt;
  // Цель на сегодня закрыта — карточка сворачивается в тихую строку, повторный запуск остаётся.
  // Та же карточка — на вкладке «Молитва» (всегда) и на «Сегодня» (утром или пока идёт таймер)
  const html = met
    ? `<span class="pc-ok">${CHECK}</span><div class="pc-t"><b>Молитва — цель на сегодня достигнута</b><span>сегодня ${fmtDur(done)} · цель ${tgt} мин</span></div><button type="button" class="btn sm ghost" data-pray="start">Ещё раз</button>`
    : r
    ? `<div class="pc-t"><b>${r.paused ? "Молитва на паузе" : "Молитва идёт"}</b><span class="pc-live">${mmss(prElapsed(r))}</span></div><button type="button" class="btn" data-pray="open">Открыть</button>`
    : `<div class="pc-t"><b>Молитва</b><span>${done ? `сегодня ${fmtDur(done)} · цель ${tgt} мин` : `цель ${tgt} мин · экран не погаснет`}</span></div><button type="button" class="btn" data-pray="start">Начать</button>`;
  for (const card of [$("#pray-card"), $("#pray-tab-card")]) { card.classList.toggle("met", met); card.innerHTML = html; }
  renderNow();
}
function renderPrayStats() {
  const t = todayDate(), tgt = prTarget(), days = [];
  for (let i = 13; i >= 0; i--) {
    const d = addDays(t, -i), m = prayMinutes(ymd(d));
    days.push({ label: String(d.getDate()), value: m, current: i === 0, tip: `${fmtShort.format(d)} · ${m ? fmtDur(m) : "не было"}` });
  }
  const max = Math.ceil(Math.max(tgt * 1.4, ...days.map(x => x.value)) / 10) * 10;
  barChart($("#ps-chart"), days, { max, fmt: v => `${Math.round(v)} мин`, line: tgt, empty: "Пока нет записанных молитв. Запусти таймер здесь или утром на «Сегодня»." });
  let week = 0, sum14 = 0, streak = 0, span = 0;
  for (let i = 0; i < 7; i++) week += prayMinutes(ymd(addDays(t, -i)));
  // Среднее — по дням с первой записи, но не больше 14, чтобы первые дни не занижали цифру
  const firstK = Object.keys(S.data.prayer).sort()[0];
  for (let i = 0; i < 14; i++) { const k = ymd(addDays(t, -i)); if (firstK && k >= firstK) { sum14 += prayMinutes(k); span++; } }
  for (let i = prayMinutes(ymd(t)) ? 0 : 1; i < 400 && prayMinutes(ymd(addDays(t, -i))); i++) streak++;
  const tile = (v, l) => `<div><b>${v}</b><span>${l}</span></div>`;
  $("#ps-tiles").innerHTML = tile(prayMinutes(ymd(t)) ? fmtDur(prayMinutes(ymd(t))) : "—", "сегодня") + tile(week ? fmtDur(week) : "—", "за 7 дней")
    + tile(sum14 ? fmtDur(sum14 / span) : "—", "в среднем в день") + tile(`${streak} ${plural(streak, "день", "дня", "дней")}`, "подряд");
  $("#ps-aside").textContent = `цель ${tgt} мин`;
  // Успел ли закончить до подъёма Марка
  const rows = [];
  for (let i = 0; i < 14 && rows.length < 7; i++) {
    const d = addDays(t, -i), k = ymd(d), list = S.data.prayer[k] || [], w = wakeOf(k);
    if (!list.length) continue;
    // Все пробуждения этого утра: промежуточные (записаны в прошлую ночь) и подъём на день
    const first = list[0], last = list[list.length - 1], start = toMin(first.s), name = kidName();
    const end = last.e ? toMin(last.e) : start + list.reduce((a, x) => a + x.m, 0) + list.reduce((a, x) => a + (x.pz || 0), 0);
    const pz = list.reduce((a, x) => a + (x.pz || 0), 0);
    const wakes = [...(S.data.kid[ymd(addDays(d, -1))]?.nights || []).map(toMin).filter(x => x < 720), w].filter(x => x != null).sort((a, b) => a - b);
    const during = wakes.find(x => x >= start && x < end), after = wakes.find(x => x >= end), before = wakes.filter(x => x < start);
    const state = during != null ? "mid" : after != null ? "ok" : w != null ? "warn" : "";
    const val = during != null ? `${name} проснулся в ${hm(during)}, посреди молитвы`
      : after != null ? `запас ${fmtDur(after - end)}`
      : w != null ? `${name} уже встал в ${hm(w)}`
      : before.length ? `до молитвы просыпался в ${before.map(hm).join(", ")}` : `подъём ${kidGen()} не отмечен`;
    rows.push(`<li class="${state}"><span class="dot"></span><span class="ck-name">${fmtShort.format(d)}<span class="ck-sub">${hz(first.s)}–${last.e ? "" : "≈ "}${hm(end)}${pz ? ` · пауза ${fmtDur(pz)}` : ""}</span></span><span class="ck-val">${esc(val)}</span></li>`);
  }
  $("#ps-when").innerHTML = rows.join("") || `<li class="empty">Появится после первых утренних молитв.</li>`;
}
function renderPraySettings() {
  const st = settings(), f = document.activeElement;
  if ($("#pr-target") !== f) $("#pr-target").innerHTML = [5, 10, 15, 20, 25, 30, 45, 60].map(n => `<option value="${n}" ${n === prTarget() ? "selected" : ""}>${n} мин</option>`).join("");
  if ($("#pr-habit") !== f) $("#pr-habit").innerHTML = `<option value="">ничего</option>` + active().map(h => `<option value="${esc(h.id)}" ${h.id === prHabitId() ? "selected" : ""}>«${esc(h.name)}»</option>`).join("");
  $("#pr-chime").checked = st.prayerChime !== false;
  if ($("#pr-plan") !== f) $("#pr-plan").value = (st.prayerPlan || []).join("\n");
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-pray]");
  if (!b) return;
  if (b.dataset.pray === "start") startPrayer(); else openPray();
});
$("#pray-min").addEventListener("click", hidePray);
$("#pray-pause").addEventListener("click", () => {
  const r = prRun(); if (!r) return;
  if (r.paused) { r.idle = (r.idle || 0) + Date.now() - r.paused; r.paused = null; } else r.paused = Date.now();
  prSave(r); tickPray();
});
$("#pp-next").addEventListener("click", () => {
  const r = prRun(); if (!r) return;
  r.point = (r.point || 0) + 1; (r.marks ||= []).push(prElapsed(r));
  prSave(r); tickPray();
});
$("#pray-finish").addEventListener("click", finishPrayer);
$("#pray-save").addEventListener("click", savePrayer);
$("#pray-discard").addEventListener("click", () => { prSave(null); hidePray(); toast("Молитва не записана"); });
$("#pr-target").addEventListener("change", e => setSetting({ prayerTarget: Number(e.target.value) }));
$("#pr-habit").addEventListener("change", e => setSetting({ prayerHabit: e.target.value }));
$("#pr-chime").addEventListener("change", e => setSetting({ prayerChime: e.target.checked }));
$("#pr-plan").addEventListener("change", e => setSetting({ prayerPlan: e.target.value.split("\n").map(x => x.trim()).filter(Boolean) }));
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && !$("#pray").hidden) keepAwake(true); });
setInterval(() => { if (prRun()) tickPray(); }, 1000);

/* ---------- молитвенные нужды ---------- */
// needs[] = {id, t, cat, created, answered, note}
const NV = { view: "open", month: 0, answering: null, confirmDel: null };
const needs = () => S.data?.needs || [];
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
function renderNeeds() {
  if (!S.data) return;
  const list = $("#need-list");
  if (list.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  const tk = ymd(todayDate()), plan = prPlan(), open = needs().filter(n => !n.answered), done = needs().filter(n => n.answered);
  $("#needs-aside").textContent = needs().length ? `${open.length} ${plural(open.length, "ждёт", "ждут", "ждут")} ответа · ${done.length} ${plural(done.length, "ответ", "ответа", "ответов")}` : "";
  const cat = $("#need-cat");
  cat.hidden = !plan.length;
  if (cat !== document.activeElement) cat.innerHTML = `<option value="">без темы</option>` + plan.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
  $("#need-add").disabled = !canWrite();
  document.querySelectorAll("#need-seg button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.nv === NV.view)));
  const items = NV.view === "open"
    ? open.sort((a, b) => a.created < b.created ? -1 : 1)
    : done.sort((a, b) => a.answered > b.answered ? -1 : 1);
  list.innerHTML = items.map(n => {
    const id = esc(n.id), wait = daysBetween(n.created, n.answered || tk);
    const meta = n.answered
      ? `ответ ${fmtShort.format(parse(n.answered))} · ${wait ? `через ${wait} ${plural(wait, "день", "дня", "дней")}` : "в тот же день"}${n.cat ? " · " + esc(n.cat) : ""}`
      : `с ${fmtShort.format(parse(n.created))} · ${wait ? `${wait} ${plural(wait, "день", "дня", "дней")}` : "сегодня"}${n.cat ? " · " + esc(n.cat) : ""}`;
    let act;
    if (NV.answering === n.id) act = `<form class="nd-form" data-nd-ans="${id}">
        <input class="field" type="date" value="${tk}" max="${tk}" min="${esc(n.created)}" aria-label="Когда получен ответ">
        <input class="field" type="text" maxlength="200" placeholder="Как пришёл ответ — необязательно" aria-label="Заметка об ответе">
        <button class="btn sm" type="submit">Записать</button><button class="btn ghost sm" type="button" data-nd="cancel">Отмена</button></form>`;
    else if (NV.confirmDel === n.id) act = `<div class="nd-act"><span class="nd-meta">Удалить нужду?</span><button type="button" class="btn danger sm" data-nd="del-yes" data-id="${id}">Удалить</button><button type="button" class="btn ghost sm" data-nd="cancel">Отмена</button></div>`;
    else act = `<div class="nd-act">${n.answered
        ? `<button type="button" class="btn ghost sm" data-nd="reopen" data-id="${id}">Ещё жду ответа</button>`
        : `<button type="button" class="btn teal-soft sm" data-nd="answer" data-id="${id}" ${canWrite() ? "" : "disabled"}>Ответ получен</button>`}
        <button type="button" class="btn ghost sm" data-nd="del" data-id="${id}" ${canWrite() ? "" : "disabled"}>Удалить</button></div>`;
    return `<li><div class="nd-top"><span class="nd-t">${esc(n.t)}</span></div><span class="nd-meta">${meta}</span>
      ${n.answered && n.note ? `<span class="nd-note">${esc(n.note)}</span>` : ""}${act}</li>`;
  }).join("") || `<li class="empty">${NV.view === "open" ? "Запиши, о чём молишься, — когда придёт ответ, отметь его, и он появится на календаре." : "Отвеченных пока нет."}</li>`;
  renderNeedCal();
}
function renderNeedCal() {
  const t = todayDate(), first = new Date(t.getFullYear(), t.getMonth() + NV.month, 1), n = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  $("#nc-label").textContent = `${MONTHS[first.getMonth()]} ${first.getFullYear()}`;
  $("#nc-next").disabled = NV.month >= 0;
  const byAns = {}, byNew = {};
  needs().forEach(x => { if (x.answered) (byAns[x.answered] ||= []).push(x); (byNew[x.created] ||= []).push(x); });
  let s = `<div class="mgrid">${DOW.map(d => `<span class="mdow">${d}</span>`).join("")}`;
  for (let i = 0; i < dow(first); i++) s += "<span></span>";
  let monthAns = 0;
  for (let day = 1; day <= n; day++) {
    const d = new Date(first.getFullYear(), first.getMonth(), day), k = ymd(d), a = byAns[k] || [], c = byNew[k] || [];
    monthAns += a.length;
    const tip = [a.length ? `ответ: ${a.map(x => x.t).join("; ")}` : "", c.length ? `новые: ${c.map(x => x.t).join("; ")}` : ""].filter(Boolean).join(" · ");
    const cls = ["md", d > t ? "future" : "", a.length ? "ans" : "", c.length ? "nw" : "", k === ymd(t) ? "today" : ""].join(" ");
    s += `<span class="${cls}" ${tip ? `data-tip="${esc(fmtShort.format(d) + " · " + tip)}"` : ""}><b>${day}</b>${a.length ? `<i class="cnt">${a.length > 1 ? "×" + a.length : "✓"}</i>` : ""}${c.length ? '<i class="nd-dot"></i>' : ""}</span>`;
  }
  $("#need-cal").innerHTML = s + "</div>";
  const all = needs().filter(x => x.answered), avg = all.length ? Math.round(all.reduce((a, x) => a + daysBetween(x.created, x.answered), 0) / all.length) : null;
  $("#need-cal-cap").textContent = `За месяц ответов: ${monthAns}.` + (all.length ? ` Всего отвечено ${all.length}${avg ? `, в среднем через ${avg} ${plural(avg, "день", "дня", "дней")}` : ""}.` : "");
}
// Нужды для текущего пункта плана в таймере молитвы
function prayNeeds(point) {
  const open = needs().filter(n => !n.answered), plan = prPlan();
  const list = !plan.length || point >= plan.length ? open.filter(n => !n.cat || !plan.includes(n.cat)) : open.filter(n => n.cat === plan[point]);
  return list.slice(0, 6);
}
$("#need-form").addEventListener("submit", e => {
  e.preventDefault();
  const t = $("#need-text").value.trim();
  if (!t) return;
  if (!canWrite()) { openConnect(); return; }
  const id = "n" + Date.now().toString(36);
  op({ t: "need", id, data: { t, cat: $("#need-cat").hidden ? "" : $("#need-cat").value, created: ymd(todayDate()), answered: null, note: "" } });
  $("#need-text").value = "";
  NV.view = "open"; renderNeeds();
});
document.querySelectorAll("#need-seg button").forEach(b => b.addEventListener("click", () => { NV.view = b.dataset.nv; NV.answering = NV.confirmDel = null; renderNeeds(); }));
$("#nc-prev").addEventListener("click", () => { NV.month--; renderNeedCal(); });
$("#nc-next").addEventListener("click", () => { if (NV.month < 0) { NV.month++; renderNeedCal(); } });
$("#need-list").addEventListener("click", e => {
  const b = e.target.closest("[data-nd]");
  if (!b) return;
  const a = b.dataset.nd, id = b.dataset.id, n = needs().find(x => x.id === id);
  if (a === "cancel") { NV.answering = NV.confirmDel = null; renderNeeds(); return; }
  if (a === "answer") { NV.answering = id; NV.confirmDel = null; renderNeeds(); setTimeout(() => $(`[data-nd-ans="${id}"] input[type=text]`)?.focus(), 30); return; }
  if (a === "del") { NV.confirmDel = id; NV.answering = null; renderNeeds(); return; }
  if (!n) return;
  if (a === "del-yes") { NV.confirmDel = null; const prev = { ...n }; op({ t: "need", id, data: null }); toast("Нужда удалена", () => op({ t: "need", id, data: prev })); }
  if (a === "reopen") { const prev = { answered: n.answered, note: n.note }; op({ t: "need", id, data: { answered: null, note: "" } }); toast("Вернул в «Ждут ответа»", () => op({ t: "need", id, data: prev })); }
});
$("#need-list").addEventListener("submit", e => {
  e.preventDefault();
  const f = e.target.closest("[data-nd-ans]"), id = f?.dataset.ndAns, n = needs().find(x => x.id === id);
  if (!n) return;
  const date = f.querySelector("input[type=date]").value || ymd(todayDate());
  if (date < n.created || date > ymd(todayDate())) { notice("Дата ответа — между днём, когда нужда записана, и сегодня."); return; }
  NV.answering = null;
  document.activeElement?.blur?.();
  op({ t: "need", id, data: { answered: date, note: f.querySelector("input[type=text]").value.trim() } });
  toast(`Ответ записан: ${fmtShort.format(parse(date))}`, () => op({ t: "need", id, data: { answered: null, note: "" } }));
});

/* ---------- тема ---------- */
function themeChoice() { try { const t = store.getItem("habits.theme"); return t === "light" || t === "dark" ? t : "auto"; } catch { return "auto"; } }
function applyTheme(t) {
  if (t === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  try { t === "auto" ? store.removeItem("habits.theme") : store.setItem("habits.theme", t); } catch {}
  const dark = t === "dark" || (t === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => { m.content = dark ? "#0F1216" : "#EEF1F4"; });
  document.querySelectorAll("#theme-seg button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.themeOpt === t)));
  $("#theme-note").textContent = t === "auto" ? "Как в системе телефона или компьютера." : t === "dark" ? "Всегда тёмная — удобно ночью." : "Всегда светлая.";
  if (S.data) { renderKid(); renderGoals(); renderProgress(); }
}
document.querySelectorAll("#theme-seg button").forEach(b => b.addEventListener("click", () => applyTheme(b.dataset.themeOpt)));
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { if (themeChoice() === "auto") applyTheme("auto"); });

/* ---------- подсказки ---------- */
const tip = $("#tip");
function showTip(el) {
  const text = el?.getAttribute?.("data-tip");
  if (!text) { tip.hidden = true; return; }
  tip.textContent = text; tip.hidden = false;
  const r = el.getBoundingClientRect(), w = tip.offsetWidth;
  tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + "px";
  tip.style.top = Math.max(8, r.top - tip.offsetHeight - 6) + "px";
}
document.addEventListener("pointerover", e => showTip(e.target.closest?.("[data-tip]")));
document.addEventListener("focusin", e => showTip(e.target.closest?.("[data-tip]")));
addEventListener("scroll", () => { tip.hidden = true; }, { passive: true });

/* ---------- жизненный цикл ---------- */
let lastKey = "";
setInterval(() => {
  // Раз в минуту: смена дня и полдень (после 12:00 прогноз переключается на завтра)
  const now = new Date(), key = ymd(todayDate()) + (now.getHours() < 12 ? "am" : "pm");
  if (key !== lastKey) { lastKey = key; S.memo = null; render(); }
  else if (S.data) { renderKid(); renderPlan(); renderSlotCard(); renderRitualCard(); renderDuoCard(); renderNow(); }
}, 60000);
let lastW = innerWidth;
addEventListener("resize", () => {
  clearTimeout(S.rz);
  S.rz = setTimeout(() => { if (Math.abs(innerWidth - lastW) > 20 && S.data) { lastW = innerWidth; renderKid(); renderGoals(); renderProgress(); } }, 200);
});
// GitHub Pages отдаёт index.html с кэшем на 10 минут, а ярлык на iPhone держит страницу ещё дольше.
// При открытии сверяем версию app.js с сервером: если вышла новая — обновляем кэш и перезагружаемся.
const MY_V = (document.querySelector('script[src*="app.js"]')?.getAttribute("src").match(/v=(\d+)/) || [])[1];
async function checkUpdate() {
  if (!MY_V || location.protocol === "file:") return;
  try {
    const html = await (await fetch("./", { cache: "reload" })).text(), v = (html.match(/app\.js\?v=(\d+)/) || [])[1];
    if (v && v !== MY_V && !prRun() && !sessionStorage.getItem("keel.upd" + v)) { sessionStorage.setItem("keel.upd" + v, "1"); location.reload(); }
  } catch {}
}
setTimeout(checkUpdate, 3000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") checkUpdate();
  if (document.visibilityState === "visible" && S.cfg) { S.pending.length ? flush() : refresh(); T.loadedAt = 0; }
});
addEventListener("online", () => { if (S.cfg) S.pending.length ? flush() : refresh(); });

/* ---------- напоминания ---------- */
// Подписка на push хранится в data.json; присылает их GitHub Actions в репозитории с данными
// (.github/remind.mjs) по расписанию. Здесь — открытый ключ, секретный лежит в секретах того репозитория
const VAPID_PUBLIC = "BICTIBsqLSn51VxG2CaUrh0IGbW-NDN2gklsoSYeNpxasmb_EGAbyRIpDprI-Pv5U81ORvOBV6CK8ttqlrR71XM";
const RM_DEFAULT = { morning: "06:30", evening: "21:30", weekly: "20:00", slots: true };
const rmSettings = () => ({ ...RM_DEFAULT, ...(settings().reminders || {}) });
// Время — только в окнах, когда работает расписание: утро 5:00–9:00, вечер 19:00–23:30
const rmTimes = (from, to) => { const out = []; for (let m = from; m <= to; m += 30) out.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`); return out; };
const RM_FIELDS = [["morning", rmTimes(300, 540)], ["evening", rmTimes(1140, 1410)], ["weekly", rmTimes(1140, 1410)]];
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const RM = { sub: null, busy: false };
const deviceName = () => /iPhone/.test(navigator.userAgent) ? "iPhone" : /iPad/.test(navigator.userAgent) ? "iPad" : /Android/.test(navigator.userAgent) ? "Android" : /Mac/.test(navigator.userAgent) ? "Mac" : "компьютер";
const b64u = s => { const b = atob((s + "=".repeat((4 - s.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, c => c.charCodeAt(0)); };
async function rmCheck() {
  if (DEMO || !pushSupported()) return;
  try { const reg = await navigator.serviceWorker.getRegistration(); RM.sub = reg ? await reg.pushManager.getSubscription() : null; } catch {}
  renderRemind();
}
async function rmEnable() {
  if (!canWrite()) { openConnect(); return; }
  RM.busy = true; renderRemind();
  try {
    if (await Notification.requestPermission() !== "granted") throw Object.assign(new Error("denied"), { code: "denied" });
    const reg = await navigator.serviceWorker.register("sw.js");
    await navigator.serviceWorker.ready;
    RM.sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(VAPID_PUBLIC) });
    const j = RM.sub.toJSON();
    op({ t: "pushSub", sub: { endpoint: j.endpoint, keys: j.keys, device: deviceName(), created: ymd(todayDate()) } },
       { t: "settings", data: { tz: Intl.DateTimeFormat().resolvedOptions().timeZone, reminders: rmSettings() } });
    toast("Напоминания включены на этом устройстве");
  } catch (e) {
    notice(e.code === "denied" ? "Уведомления запрещены. Разреши их: Настройки iPhone → Уведомления → Keel — и нажми «Включить» ещё раз."
      : "Не удалось включить напоминания. Проверь связь и попробуй ещё раз.");
  }
  RM.busy = false; renderRemind();
}
async function rmDisable() {
  const ep = RM.sub?.endpoint;
  try { await RM.sub?.unsubscribe(); } catch {}
  RM.sub = null;
  if (ep) op({ t: "pushSub", endpoint: ep, remove: true });
  renderRemind();
}
async function rmTest() {
  const reg = await navigator.serviceWorker.getRegistration();
  if (reg) await reg.showNotification("Keel · проверка", { body: "Так будут выглядеть напоминания.", icon: "icon-192.png", tag: "keel-test" });
}
function renderRemind() {
  if (!S.data) return;
  const st = $("#rm-state"), note = $("#rm-note"), acts = $("#rm-actions"), n = (S.data.push?.subs || []).length;
  let msg = "", btns = "";
  if (DEMO) msg = "В демо напоминания выключены.";
  else if (!pushSupported()) msg = isIOS && !standalone()
    ? "На iPhone напоминания работают, когда Keel открыт с экрана «Домой»: в Safari нажми «Поделиться» → «На экран „Домой“», открой Keel с иконки и вернись сюда."
    : "Этот браузер не умеет присылать уведомления.";
  else if (Notification.permission === "denied") msg = "Уведомления для Keel запрещены. Разреши их в настройках телефона: Уведомления → Keel.";
  else if (RM.sub) {
    msg = "Включены на этом устройстве. Если дело уже сделано — молитва записана, вечерние 5 минут пройдены, — напоминание не придёт.";
    btns = `<button type="button" class="btn ghost" id="rm-test">Показать пример</button><button type="button" class="btn ghost" id="rm-off">Выключить здесь</button>`;
  } else {
    msg = "Keel напомнит об утренней молитве, вечерних 5 минутах, обзоре недели и свободном слоте.";
    btns = `<button type="button" class="btn" id="rm-on" ${RM.busy ? "disabled" : ""}>${RM.busy ? "Включаю…" : "Включить на этом устройстве"}</button>`;
  }
  st.textContent = n ? `${n} ${plural(n, "устройство", "устройства", "устройств")}` : "";
  note.textContent = msg; acts.innerHTML = btns;
  const r = rmSettings();
  $("#rm-form").hidden = DEMO;
  if (!document.activeElement?.closest?.("#rm-form")) {
    RM_FIELDS.forEach(([k, times]) => {
      $(`#rm-${k}`).innerHTML = `<option value="">не напоминать</option>` + times.map(t => `<option value="${t}" ${t === r[k] ? "selected" : ""}>${hz(t)}</option>`).join("");
    });
    $("#rm-slots").checked = !!r.slots;
  }
}
$("#remind").addEventListener("click", e => {
  if (e.target.closest("#rm-on")) rmEnable();
  else if (e.target.closest("#rm-off")) rmDisable();
  else if (e.target.closest("#rm-test")) rmTest();
});
$("#rm-form").addEventListener("change", e => {
  if (!canWrite()) return;
  const k = e.target.id.replace("rm-", "");
  setSetting({ reminders: { ...rmSettings(), [k]: k === "slots" ? e.target.checked : e.target.value || null } });
  e.target.blur();
});

if (DEMO) {
  const bar = document.createElement("div");
  bar.className = "demo-bar";
  bar.innerHTML = `<b>Демо Keel</b><span>Вымышленная семья. Можно нажимать всё — ничего не сохраняется.</span><a href="./">Выйти</a>`;
  $("#notice").before(bar);
}
recompute();
if (!S.cfg) $("#connect-panel").open = true;
if (S.cfg && S.pending.length) setSync("pending");
lastKey = ymd(todayDate()) + (new Date().getHours() < 12 ? "am" : "pm");
route();
applyTheme(themeChoice());
if (S.cfg) S.pending.length ? flush() : refresh();
rmCheck();
})();
