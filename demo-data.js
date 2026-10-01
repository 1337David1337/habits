// Демо Keel: вымышленная семья, всё живёт в памяти вкладки. Открывается по адресу …/keel/?demo
// Подменяет fetch для GitHub и Google Задач, поэтому ничего не уходит в сеть и не трогает настоящие данные.
(function (root) {
  "use strict";
  const pad = n => String(n).padStart(2, "0");
  const ymdOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  // Детерминированный «случай», чтобы демо выглядело одинаково при каждом открытии
  const rnd = seed => () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

  function build(now = new Date()) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day = n => { const d = new Date(today); d.setDate(d.getDate() + n); return ymdOf(d); };
    const hm = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    const r = rnd(7);
    const log = {}, kid = {}, me = {}, prayer = {};
    for (let i = 1; i <= 21; i++) {
      const k = day(-i), dow = (new Date(today.getTime() - i * 864e5).getDay() + 6) % 7, l = {};
      if (r() < .8) l.bible = true;
      if (r() < .9) l.money = true;
      if (r() < .25) l.read = true;
      if (dow === 5 && r() < .5) l.gym = true;
      if (Object.keys(l).length) log[k] = l;
      kid[k] = { wake: hm(455 + Math.round(r() * 40)), bed: hm(1275 + Math.round(r() * 45)), ...(r() < .4 ? { nights: [hm(140 + Math.round(r() * 120))] } : {}) };
      me[k] = { wake: hm(420 + Math.round(r() * 30)) };
      if (l.bible) prayer[k] = [{ s: hm(425 + Math.round(r() * 20)), m: 10 + Math.round(r() * 9), p: 0, marks: [] }];
    }
    const data = {
      version: 1,
      settings: {
        busyDays: [0, 1, 3], busyLabel: "церковь",
        spheres: ["работа", "жена", "ребёнок", "церковь", "деньги", "здоровье", "дом"],
        kidName: "Тёма", kidNameGen: "Тёмы", morningMinutes: 30, morningHabit: "bible", bedFrom: "21:00",
        slots: [{ dow: 2, from: "20:40", to: "22:10" }, { dow: 4, from: "20:40", to: "22:10" }, { dow: 5, from: "09:00", to: "10:30" }],
        tasksUrl: "https://script.google.com/macros/s/DEMO/exec", tasksKey: "demo",
        togetherPerWeek: 1, work: { from: "09:00", to: "18:00", days: [0, 1, 2, 3, 4] }, prayerTarget: 15,
        prayerPlan: ["Поклонение", "Покаяние", "Благодарность", "Нужды"],
      },
      habits: [
        { id: "bible", name: "Библия и молитва утром", sphere: "церковь", target: 6, order: 1, archived: false, created: day(-60) },
        { id: "money", name: "Записать траты", sphere: "деньги", target: 7, order: 2, archived: false, created: day(-60) },
        { id: "read", name: "Читать 10 страниц", sphere: "работа", target: 5, order: 3, archived: false, created: day(-60) },
        { id: "gym", name: "Зарядка", sphere: "здоровье", target: 3, order: 4, archived: false, created: day(-60) },
      ],
      log, kid, me, prayer,
      together: { [day(-9)]: { note: "прогулка у реки" } },
      reviews: {}, sessions: {}, focus: {}, rituals: {}, care: { [day(-2)]: ["ребёнок"] }, tags: {},
      goals: [
        { id: "g1", title: "Подушка безопасности", kind: "number", sphere: "деньги", start: 20000, target: 150000, unit: "₽",
          startDate: day(-45), deadline: day(120), history: [{ d: day(-30), v: 45000 }, { d: day(-7), v: 62000 }], steps: [],
          next: "Перевести 10 000 ₽ в день зарплаты" },
      ],
      needs: [
        { id: "n1", t: "За здоровье бабушки", cat: "Нужды", created: day(-20), answered: null, note: "" },
        { id: "n2", t: "Мудрость в разговоре с начальником", cat: "Нужды", created: day(-14), answered: day(-3), note: "разговор прошёл спокойно" },
        { id: "n3", t: "Чтобы Тёма спал всю ночь", cat: "Нужды", created: day(-6), answered: null, note: "" },
      ],
    };
    const lists = [{ id: "L1", title: "Следующие действия" }, { id: "L2", title: "Семья" }, { id: "L3", title: "Церковь" }, { id: "L9", title: "Когда-нибудь" }];
    const t = (id, l, title, extra = {}) => ({ id, listId: l.id, list: l.title, title, due: null, status: "needsAction", ...extra });
    const [NEXT, FAMILY, CHURCH, SOMEDAY] = lists;
    const tasks = [
      t("p1", FAMILY, "Детская комната", { position: "1" }),
      t("c1", FAMILY, "Выбрать краску для стены", { parent: "p1", position: "1" }),
      t("c2", FAMILY, "Покрасить стену", { parent: "p1", position: "2", due: day(2) }),
      t("c3", FAMILY, "Собрать кроватку", { parent: "p1", position: "3" }),
      t("t1", FAMILY, "Купить жене цветы без повода"),
      t("p2", NEXT, "Машина к зиме", { position: "2", due: day(1) }),
      t("c4", NEXT, "Записаться на шиномонтаж", { parent: "p2", position: "1", due: day(-1) }),
      t("c5", NEXT, "Купить зимнюю резину", { parent: "p2", position: "2" }),
      t("c6", NEXT, "Оплатить страховку", { parent: "p2", position: "0", status: "completed", completed: `${day(-3)}T10:00:00Z` }),
      t("t2", NEXT, "Пройти урок курса по автотестам"),
      t("t3", NEXT, "Записаться к стоматологу", { due: day(0) }),
      t("t4", CHURCH, "Подготовить разбор для домашней группы", { due: day(3) }),
      t("t5", SOMEDAY, "Свозить семью на море"),
    ];
    return { data, tasks: { lists, tasks } };
  }

  // Хранилище в памяти вместо localStorage — у демо свой вход и свои настройки
  function memoryStore(seed) {
    const m = new Map(Object.entries(seed || {}));
    return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); } };
  }

  function install() {
    const { data, tasks } = build();
    let current = JSON.parse(JSON.stringify(data));
    const json = o => new Response(JSON.stringify(o), { status: 200, headers: { "Content-Type": "application/json" } });
    const b64 = s => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
    const unb64 = s => new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0)));
    root.fetch = async (url, opt = {}) => {
      const u = String(url), method = (opt.method || "GET").toUpperCase();
      if (u.startsWith("https://api.github.com/")) {
        if (method === "GET") return json({ content: b64(JSON.stringify(current)), sha: "demo" });
        current = JSON.parse(unb64(JSON.parse(opt.body).content));
        return json({ content: { sha: "demo" } });
      }
      if (u.startsWith("https://script.google.com/")) {
        if (method === "GET") return json(tasks);
        const b = JSON.parse(opt.body || "{}"), x = tasks.tasks.find(y => y.id === b.id);
        if (x && b.action === "complete") Object.assign(x, { status: "completed", completed: new Date().toISOString() });
        if (x && b.action === "reopen") Object.assign(x, { status: "needsAction", completed: null });
        if (x && b.action === "due") x.due = b.due;
        return json({ ok: true });
      }
      return new Response("Демо работает без сети", { status: 503 });
    };
    return memoryStore({ "habits.cfg": JSON.stringify({ repo: "демо", token: "demo" }) });
  }

  const api = { build, install };
  root.KeelDemo = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
