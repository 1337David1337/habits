// Тестовые данные и запуск страницы с подменой GitHub API и моста Google Задач.
// Данные вымышленные: репозиторий публичный.
const TODAY = "2026-10-02"; // пятница
const at = hm => `${TODAY}T${hm}:00+03:00`;
const day = n => { const d = new Date(`${TODAY}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function fixture() {
  return {
    version: 1,
    settings: {
      busyDays: [0, 1, 3], busyLabel: "церковь",
      spheres: ["работа", "жена", "ребёнок", "церковь", "деньги", "здоровье", "дом"],
      kidName: "Тёма", kidNameGen: "Тёмы", morningMinutes: 30, morningHabit: "bible", bedFrom: "21:00",
      slots: [{ dow: 4, from: "20:40", to: "22:10" }, { dow: 5, from: "09:00", to: "10:30" }],
      tasksUrl: "https://script.google.com/macros/s/TEST/exec", tasksKey: "test-key",
      togetherPerWeek: 1, work: { from: "08:30", to: "17:30", days: [0, 1, 2, 3, 4] }, prayerTarget: 15,
    },
    habits: [
      { id: "bible", name: "Библия утром", sphere: "церковь", target: 6, order: 1, archived: false, created: "2026-09-01" },
      { id: "money", name: "Записать траты", sphere: "деньги", target: 7, order: 2, archived: false, created: "2026-09-01" },
      { id: "read", name: "Чтение 10 страниц", sphere: "работа", target: 5, order: 3, archived: false, created: "2026-09-01" },
    ],
    log: { [day(-1)]: { money: true }, [day(-2)]: { money: true, bible: true }, [day(-3)]: { money: true } },
    kid: { [day(-1)]: { wake: "07:40", bed: "21:30" }, [day(-2)]: { wake: "07:55", bed: "21:20" }, [day(-3)]: { wake: "08:05" } },
    me: {}, together: {}, reviews: {}, goals: [], sessions: {}, focus: {}, rituals: {}, prayer: {}, needs: [], care: {}, tags: {},
  };
}

const LISTS = [
  { id: "L1", title: "Следующие действия" }, { id: "L2", title: "Семья" }, { id: "L9", title: "Когда-нибудь/может быть" },
];
const task = (id, list, title, extra = {}) => ({ id, listId: list.id, list: list.title, title, due: null, status: "needsAction", ...extra });
const [NEXT, FAMILY, SOMEDAY] = LISTS;
const TASKS = { lists: LISTS, tasks: [
  task("t1", NEXT, "Проверить домашнее задание курса"),
  task("p1", NEXT, "Подготовить машину к зиме", { due: TODAY, position: "1" }),
  task("c1", NEXT, "Купить зимнюю резину", { parent: "p1", position: "2" }),
  task("c2", NEXT, "Записаться на шиномонтаж", { parent: "p1", due: day(-2), position: "1" }),
  task("c3", NEXT, "Оплатить страховку", { parent: "p1", status: "completed", completed: `${day(-2)}T10:00:00Z`, position: "0" }),
  task("p2", FAMILY, "Детская комната"),
  task("c4", FAMILY, "Покрасить стену", { parent: "p2", due: TODAY, position: "1" }),
  task("c5", FAMILY, "Выбрать кроватку", { parent: "p2", position: "2" }),
  task("t7", NEXT, "Подарить жене цветы"),
  task("s1", SOMEDAY, "Свозить жену на море"),
] };

async function open(page, { time = "10:00", hash = "today", data = fixture() } = {}) {
  const errors = [], puts = [], google = [];
  let current = data;
  page.on("pageerror", e => errors.push(e.message));
  await page.clock.setFixedTime(at(time));
  await page.addInitScript(() => localStorage.setItem("habits.cfg", JSON.stringify({ repo: "test/data", token: "test" })));
  await page.route("https://api.github.com/**", route => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { content: Buffer.from(JSON.stringify(current)).toString("base64"), sha: "s0" } });
    current = JSON.parse(Buffer.from(route.request().postDataJSON().content, "base64").toString());
    puts.push(current);
    return route.fulfill({ json: { content: { sha: `s${puts.length}` } } });
  });
  await page.route("https://script.google.com/**", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: TASKS });
    google.push(JSON.parse(route.request().postData()));
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto(`/#${hash}`);
  await page.locator("#main").waitFor({ state: "visible" });
  return { errors, puts, google };
}

module.exports = { TODAY, day, fixture, open };
