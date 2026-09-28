(() => {
"use strict";
const DOW = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];
const MONTHS = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
const CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="var(--pine-ink)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const LS = { cfg: "habits.cfg", base: "habits.base", pending: "habits.pending", view: "habits.view" };
const DEFAULT_SETTINGS = {
  busyDays: [], busyLabel: "", spheres: ["работа","семья","здоровье","дом","деньги"],
  kidName: "", kidNameGen: "", morningMinutes: 30, morningHabit: "",
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
function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function lsSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} }
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
  kidOffset: 0, kidUndo: null,
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
  } else if (op.t === "kid") {
    const day = { ...(d.kid[op.date] || {}) };
    for (const [k, v] of Object.entries(op.data)) { if (v == null || v === "") delete day[k]; else day[k] = v; }
    if (Object.keys(day).length) d.kid[op.date] = day; else delete d.kid[op.date];
  } else if (op.t === "settings") {
    Object.assign(d.settings, op.data);
  }
  return d;
}
function normalize(d) {
  d = d && typeof d === "object" ? d : {};
  const obj = v => v && typeof v === "object" && !Array.isArray(v) ? v : {};
  return { version: 1, ...d, settings: { ...DEFAULT_SETTINGS, ...obj(d.settings) },
    habits: Array.isArray(d.habits) ? d.habits : [], log: obj(d.log), kid: obj(d.kid) };
}
function recompute() {
  S.memo = null;
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
  const kid = ops.filter(o => o.t === "kid").flatMap(o => Object.entries(o.data).map(([f, v]) =>
    `${f === "wake" ? "подъём" : "отбой"} ${fmtDM.format(parse(o.date))} ${v || "удалён"}`));
  if (kid.length) parts.push(`${kidName()}: ${kid.join(", ")}`);
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
  if (err && (err.status === 401 || err.status === 404 || err.status === 403)) $("#connect-panel").open = true;
  renderSync();
}
async function refresh() {
  if (!S.cfg || S.saving) return;
  setSync("loading");
  try {
    S.base = await pull(); persist(); recompute();
    setSync(S.pending.length ? "pending" : "saved");
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
  if (!canWrite()) { $("#connect-panel").open = true; return false; }
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
  if (need > free) return { count, target, cls: "warn", text: "норму уже не добрать" };
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
function kidTarget() {
  const t = todayDate(), tk = ymd(t);
  if (wakeOf(tk) == null && new Date().getHours() < 12) return tk;
  return ymd(addDays(t, 1));
}
const bedDateNow = () => { const now = new Date(); return ymd(addDays(todayDate(), now.getHours() < 12 ? -1 : 0)); };
function countWakes() { return Object.values(S.data?.kid || {}).filter(v => v.wake).length; }

/* ---------- графики ---------- */
function roundTop(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
function chartWidth(el) { return Math.max(260, Math.round(el.clientWidth || el.parentElement?.clientWidth || 320)); }
function barChart(el, items, { h = 170, hl } = {}) {
  if (!items.some(it => it.value != null)) { el.innerHTML = `<p class="empty-c">Данных за этот период пока нет.</p>`; return; }
  const W = chartWidth(el), pl = 34, pr = 4, pt = 8, pb = items.some(i => i.sub) ? 34 : 22, H = h;
  const iw = W - pl - pr, ih = H - pt - pb, step = iw / items.length, bw = Math.min(26, step * .62);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Столбчатая диаграмма">`;
  for (const g of [0, .5, 1]) {
    const y = pt + ih * (1 - g);
    s += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" class="grid"/><text x="${pl - 6}" y="${y + 3.5}" class="ax" text-anchor="end">${g * 100}%</text>`;
  }
  items.forEach((it, i) => {
    const cx = pl + step * i + step / 2;
    if (it.value != null) {
      const bh = it.value > 0 ? Math.max(3, ih * Math.min(1, it.value)) : 0;
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
  renderSync(); renderHeader(); renderConnect();
  $("#main").hidden = !S.data;
  if (!S.data) return;
  renderToday(); renderKid(); renderWeek(); renderProgress(); renderManage();
}
function renderHeader() {
  const t = todayDate(), tk = ymd(t);
  $("#today-title").textContent = fmtLong.format(t);
  $("#period-line").textContent = `${MONTHS[t.getMonth()]} · ${Math.floor(t.getMonth() / 3) + 1}-й квартал · неделя ${isoWeek(t)}`;
  const sum = $("#today-sum");
  if (!S.cfg && !S.data) { sum.textContent = "Подключи репозиторий с данными, чтобы увидеть дашборд."; return; }
  if (!S.data) { sum.textContent = "Загружаю данные с GitHub…"; return; }
  const hs = active();
  if (!hs.length) { sum.textContent = "Привычек пока нет. Добавь первую в настройке ниже."; return; }
  const doneToday = hs.filter(h => isDone(tk, h.id)).length;
  const month = normStats(new Date(t.getFullYear(), t.getMonth(), 1), new Date(t.getFullYear(), t.getMonth() + 1, 0));
  sum.innerHTML = `Сегодня отмечено <b>${doneToday} из ${hs.length}</b> · норма месяца выполнена на <b>${pct(month.pct)}</b>`;
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
  $("#kid-title").textContent = `Утро ${kidGen()}`;
  const target = kidTarget(), isToday = target === tk, fc = forecast(target);
  $("#fc-when").textContent = `Прогноз на ${isToday ? "сегодня" : "завтра"}, ${fmtShort.format(parse(target))}`;
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
  // Кнопки
  const w = S.data.kid[tk]?.wake, bd = bedDateNow(), b = S.data.kid[bd]?.bed;
  $("#kid-wake-l").textContent = `${name} проснулся`;
  const night = new Date().getHours() < 4;
  $("#kid-wake-s").textContent = night ? "сейчас ночь: утренний подъём отмечается с 4:00"
    : w ? `сегодня в ${hm(toMin(w))} · нажми, чтобы заменить на ${hm(toMin(nowHM()))}` : `запишу ${hm(toMin(nowHM()))}`;
  $("#kid-sleep-l").textContent = `${name} уснул`;
  $("#kid-sleep-s").textContent = b ? `${bd === tk ? "сегодня" : "вчера"} в ${hm(toMin(b))} · нажми, чтобы заменить` : `запишу ${hm(toMin(nowHM()))} как отбой`;
  $("#kid-wake").disabled = !canWrite() || night;
  $("#kid-sleep").disabled = !canWrite();
  const u = $("#kid-undo");
  u.hidden = !S.kidUndo;
  if (S.kidUndo) u.innerHTML = `Записал: ${esc(S.kidUndo.text)}. <button type="button" class="linkbtn" id="kid-undo-btn">Отменить</button>`;
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
  const pts = days.map(d => wakeOf(ymd(d))).filter(v => v != null);
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
        tip = `${fmtShort.format(d)} · ${hm(a)}–${hm(z)}${lv >= 3 ? " · самое вероятное время" : lv ? " · возможно" : ""}`;
      } else if (d <= todayDate()) {
        const w = wakeOf(k), x = m.btMap.get(k), c = x ? m.comb(x) : null;
        if (c != null && m.half && z > c - m.half && a < c + m.half) cls.push("band");
        if (w != null && w >= a && w < z) {
          cls.push("wk");
          tip = `${fmtShort.format(d)} · проснулся в ${hm(w)}${c != null ? ` · прогноз был ${hm(c)}` : ""}`;
        } else tip = `${fmtShort.format(d)} · ${hm(a)}–${hm(z)}${c != null && cls.includes("band") ? ` · в прогнозе было ${hm(c)}` : ""}`;
      }
      s += `<span class="${cls.join(" ")}" data-tip="${esc(tip)}"></span>`;
    }
  }
  if (!narrow) {
    s += `<span class="kc-foot-l">подъём</span>` + days.map(d => { const w = wakeOf(ymd(d)); return `<span class="kc-foot w">${w != null ? hm(w) : ""}</span>`; }).join("");
    s += `<span class="kc-foot-l">отбой</span>` + days.map(d => { const b = bedOf(ymd(addDays(d, -1))); return `<span class="kc-foot">${b != null ? hm(b) : ""}</span>`; }).join("");
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
  const r = recentKid(30), m = kidModel();
  const tile = (v, l) => `<div><b>${v ?? "—"}</b><span>${l}</span></div>`;
  $("#kid-tiles").innerHTML =
    tile(r.wakes.length ? hm(median(r.wakes)) : null, "обычно встаёт") +
    tile(r.beds.length ? hm(median(r.beds)) : null, "обычно засыпает") +
    tile(r.nights.length ? dur(median(r.nights)) : null, "ночной сон") +
    tile(m.mae != null ? `±${Math.round(m.mae)} мин` : null, "точность прогноза");
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
  if ($("#ks-min") !== focus) $("#ks-min").innerHTML = [10, 15, 20, 30, 45, 60, 90].map(n => `<option value="${n}" ${n === (st.morningMinutes || 30) ? "selected" : ""}>${n} мин</option>`).join("");
  if ($("#ks-habit") !== focus) $("#ks-habit").innerHTML = `<option value="">не выбрана</option>` +
    active().map(h => `<option value="${esc(h.id)}" ${h.id === st.morningHabit ? "selected" : ""}>${esc(h.name)}</option>`).join("");
  if (!$("#kf-date").value) fillKidForm(ymd(todayDate()));
}
function fillKidForm(k) {
  const v = S.data?.kid[k] || {};
  $("#kf-date").value = k; $("#kf-date").max = ymd(todayDate());
  $("#kf-wake").value = v.wake || ""; $("#kf-bed").value = v.bed || "";
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
    `<th scope="col" class="${ymd(d) === tk ? "is-today" : ""}">${DOW[i]} ${d.getDate()}<span class="ch">${mark(i)}</span></th>`).join("")}<th scope="col">Итог</th></tr></thead>`;
  const hs = active();
  const body = !hs.length ? `<tr><td colspan="9" class="empty">Привычек пока нет.</td></tr>` : hs.map(h => {
    const ws = weekStatus(h, mon);
    const cells = days.map(d => {
      const k = ymd(d), on = isDone(k, h.id), future = d > t;
      return `<td class="${k === tk ? "today-col" : ""}"><button type="button" class="cell" aria-pressed="${on}" ${future ? "disabled" : ""}
        data-toggle data-date="${k}" data-hid="${esc(h.id)}" aria-label="${esc(h.name)}, ${fmtShort.format(d)}" title="${fmtShort.format(d)}">${CHECK}</button></td>`;
    }).join("");
    return `<tr><td class="name">${esc(h.name)}<small>норма ${ws.target} в нед.</small></td>${cells}<td class="sum ${ws.cls}">${ws.count}/${ws.target}</td></tr>`;
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
  document.querySelectorAll(".seg button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.view === view)));
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

/* ---------- действия ---------- */
document.addEventListener("click", e => {
  const tg = e.target.closest("[data-toggle]");
  if (tg && !tg.disabled) {
    op({ t: "check", date: tg.dataset.date, hid: tg.dataset.hid, val: !isDone(tg.dataset.date, tg.dataset.hid) });
    return;
  }
  if (e.target.closest("#kid-undo-btn") && S.kidUndo) {
    const u = S.kidUndo; S.kidUndo = null;
    op({ t: "kid", date: u.date, data: { [u.field]: u.prev } });
    return;
  }
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
function kidMark(field) {
  if (!canWrite()) { $("#connect-panel").open = true; return; }
  if (field === "wake" && new Date().getHours() < 4) return;
  const date = field === "wake" ? ymd(todayDate()) : bedDateNow(), now = nowHM();
  const prev = S.data.kid[date]?.[field] ?? null;
  S.kidUndo = { date, field, prev, text: `${kidName()} ${field === "wake" ? "проснулся" : "уснул"} в ${hm(toMin(now))}` };
  op({ t: "kid", date, data: { [field]: now } });
}
$("#kid-wake").addEventListener("click", () => kidMark("wake"));
$("#kid-sleep").addEventListener("click", () => kidMark("bed"));
$("#kf-date").addEventListener("change", e => { if (e.target.value) fillKidForm(e.target.value); });
$("#kid-form").addEventListener("submit", e => {
  e.preventDefault();
  const k = $("#kf-date").value;
  if (!k || k > ymd(todayDate())) { notice("Выбери сегодняшний или прошедший день."); return; }
  S.kidUndo = null;
  if (op({ t: "kid", date: k, data: { wake: $("#kf-wake").value || null, bed: $("#kf-bed").value || null } })) notice("");
});
$("#kf-clear").addEventListener("click", () => {
  const k = $("#kf-date").value;
  if (!k) return;
  S.kidUndo = null;
  if (op({ t: "kid", date: k, data: { wake: null, bed: null } })) fillKidForm(k);
});
const setSetting = data => op({ t: "settings", data });
$("#ks-name").addEventListener("change", e => setSetting({ kidName: e.target.value.trim() }));
$("#ks-gen").addEventListener("change", e => setSetting({ kidNameGen: e.target.value.trim() }));
$("#ks-min").addEventListener("change", e => setSetting({ morningMinutes: Number(e.target.value) }));
$("#ks-habit").addEventListener("change", e => setSetting({ morningHabit: e.target.value }));
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
document.querySelectorAll(".seg button").forEach(b => b.addEventListener("click", () => {
  S.view = b.dataset.view; lsSet(LS.view, S.view); renderProgress();
}));
const shiftPeriod = dlt => {
  if (S.view === "month") S.monthOffset = Math.min(0, S.monthOffset + dlt); else S.quarterOffset = Math.min(0, S.quarterOffset + dlt);
  renderProgress();
};
$("#per-prev").addEventListener("click", () => shiftPeriod(-1));
$("#per-next").addEventListener("click", () => shiftPeriod(1));
$("#per-now").addEventListener("click", () => { if (S.view === "month") S.monthOffset = 0; else S.quarterOffset = 0; renderProgress(); });
$("#sync").addEventListener("click", () => { if (!S.cfg) { $("#connect-panel").open = true; return; } S.pending.length ? flush() : refresh(); });

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
  else if (S.data) renderKid();
}, 60000);
let lastW = innerWidth;
addEventListener("resize", () => {
  clearTimeout(S.rz);
  S.rz = setTimeout(() => { if (Math.abs(innerWidth - lastW) > 20 && S.data) { lastW = innerWidth; renderKid(); renderProgress(); } }, 200);
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && S.cfg) S.pending.length ? flush() : refresh();
});
addEventListener("online", () => { if (S.cfg) S.pending.length ? flush() : refresh(); });

recompute();
if (!S.cfg) $("#connect-panel").open = true;
if (S.cfg && S.pending.length) setSync("pending");
lastKey = ymd(todayDate()) + (new Date().getHours() < 12 ? "am" : "pm");
render();
if (S.cfg) S.pending.length ? flush() : refresh();
})();
