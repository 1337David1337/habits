const { test, expect } = require("@playwright/test");
const { TODAY, day, fixture, open } = require("./helpers");

const TABS = { today: "Главное на сегодня", plan: "Баланс сфер", prayer: "Молитвенные нужды", sleep: "Календарь подъёмов", results: "Неделя" };

for (const [hash, heading] of Object.entries(TABS)) {
  test(`вкладка #${hash} открывается без ошибок и без горизонтальной прокрутки`, async ({ page }) => {
    const { errors } = await open(page, { hash });
    await expect(page.locator(`.view[data-view="${hash}"] h2`, { hasText: heading }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    expect(errors).toEqual([]);
  });
}

test("старые адреса вкладок открывают новые", async ({ page }) => {
  await open(page, { hash: "morning" });
  await expect(page.locator('.view[data-view="sleep"]')).toBeVisible();
  await page.goto("/#goals");
  await expect(page.locator('.view[data-view="plan"]')).toBeVisible();
});

test("отметка привычки сохраняется в GitHub", async ({ page }) => {
  const { puts } = await open(page);
  await page.locator('#today-list button[data-hid="read"]').click();
  await expect.poll(() => puts.at(-1)?.log?.[TODAY]?.read).toBe(true);
});

test("упор: нажатие добавляет дело в главное, повторное — убирает", async ({ page }) => {
  const { puts } = await open(page);
  const pick = page.locator("#bal-rec button.pi").first();
  const title = (await pick.locator("span").first().evaluate(el => el.firstChild.textContent)).trim();
  await pick.click();
  await expect(pick).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#focus-list")).toContainText(title);
  await pick.click();
  await expect(pick).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#focus-list")).not.toContainText(title);
  await expect.poll(() => (puts.at(-1)?.focus?.[TODAY] || []).length).toBe(0);
});

test("задачи из «Когда-нибудь» не предлагаются", async ({ page }) => {
  await open(page);
  const seen = new Set();
  for (const alt of await page.locator("#bal-rec [data-balt]").all()) {
    for (let i = 0; i < 4; i++) {
      (await page.locator("#bal-rec button.pi").allInnerTexts()).forEach(t => seen.add(t));
      await alt.click();
    }
  }
  expect([...seen].join("\n")).not.toContain("море");
  await page.locator('#focus-list [data-open-wizard="focus"]').click();
  await expect(page.locator("#sheet-body")).toContainText("Подарить жене цветы");
  await expect(page.locator("#sheet-body")).not.toContainText("море");
});

test("подзадачи показываются под своей задачей", async ({ page }) => {
  await open(page);
  const list = page.locator("#plan-tasks");
  await expect(list.locator("li.pt-head", { hasText: "Детская комната" })).toBeVisible();
  await expect(list.locator("li.pt.sub", { hasText: "Покрасить стену" })).toBeVisible();
  await expect(list.locator("li.pt.par", { hasText: "Подготовить машину к зиме" })).toContainText("подзадачи: 1 из 3");
  await expect(list.locator("li.pt.sub", { hasText: "Купить зимнюю резину" })).toBeVisible();
});

test("на «Сегодня» видна одна карточка «Сейчас»", async ({ page }) => {
  const now = () => page.locator("#pray-card, #ritual-card, #slot-card").evaluateAll(els => els.filter(e => !e.hidden).map(e => e.id));
  await open(page, { time: "10:00" });
  expect(await now()).toEqual(["pray-card"]);
  await page.clock.setFixedTime(`${TODAY}T21:00:00+03:00`);
  await page.reload();
  await page.locator("#main").waitFor({ state: "visible" });
  expect(await now()).toEqual(["slot-card"]);
});

test("сфера списка важнее слов в названии задачи", async ({ page }) => {
  const data = fixture();
  data.settings.listSpheres = { "Семья": "жена" };
  await open(page, { hash: "plan", data });
  await page.locator("#bal-tags summary").click();
  await expect(page.locator('#bal-tags select[data-tag="p2"]')).toHaveValue("жена");
  await page.locator("#bal-lists summary").click();
  await expect(page.locator('#bal-lists select[data-list="Когда-нибудь/может быть"]')).toHaveValue("__parked");
});

test("слот: шаг выбирается из подзадач Google, «Уже сделал» закрывает её там", async ({ page }) => {
  const { puts, google } = await open(page, { time: "21:00" });
  const card = page.locator("#slot-card");
  await expect(card.locator("input")).toHaveCount(0);
  const pick = card.locator("select[data-slot-pick]");
  await expect(pick.locator("optgroup")).toHaveCount(2);
  await expect(pick.locator("option", { hasText: "море" })).toHaveCount(0);
  await pick.selectOption({ label: "Выбрать кроватку" });
  await expect(card.locator("h3")).toHaveText("Выбрать кроватку");
  await expect(card).toContainText("Детская комната");
  await expect.poll(() => puts.at(-1)?.sessions?.[`${TODAY} 20:40`]?.taskId).toBe("c5");
  await card.locator('[data-slot-act="done"]').click();
  await expect.poll(() => google.find(x => x.action === "complete")?.id).toBe("c5");
  await expect.poll(() => puts.at(-1)?.sessions?.[`${TODAY} 20:40`]?.status).toBe("done");
});

test("«План → Слоты на неделю»: только выбор подзадачи, без своего текста", async ({ page }) => {
  await open(page, { hash: "plan" });
  const list = page.locator("#slot-plan-list");
  await expect(list.locator("input")).toHaveCount(0);
  await expect(list.locator("select[data-plan-key]").first()).toBeVisible();
  await expect(list.locator("select[data-plan-key]").first().locator("optgroup")).toHaveCount(2);
});

test("демо: вымышленные данные, настоящий вход и сеть не трогаются", async ({ page }) => {
  const net = [], errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem("habits.cfg", JSON.stringify({ repo: "real/data", token: "REAL" }));
    localStorage.setItem("habits.base", "REAL-BASE");
  });
  await page.route(/api\.github\.com|script\.google\.com/, route => { net.push(route.request().url()); return route.abort(); });
  await page.goto("/?demo#today");
  await expect(page.locator(".demo-bar")).toBeVisible();
  await expect(page.locator("#today-list button[data-hid]").first()).toBeVisible();
  await expect(page.locator("#plan-tasks")).toContainText("Машина к зиме");
  await page.locator('#today-list button[data-hid="read"]').click();
  await expect(page.locator('#today-list button[data-hid="read"]')).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(1600);
  expect(await page.evaluate(() => [localStorage.getItem("habits.cfg"), localStorage.getItem("habits.base"), localStorage.getItem("habits.pending")]))
    .toEqual([JSON.stringify({ repo: "real/data", token: "REAL" }), "REAL-BASE", null]);
  expect(net).toEqual([]);
  expect(errors).toEqual([]);
});

test("напоминания: время сохраняется, на устройстве можно включить", async ({ page }) => {
  const { puts, errors } = await open(page, { hash: "settings" });
  await expect(page.locator("#rm-on")).toBeVisible();
  await expect(page.locator("#rm-evening")).toHaveValue("21:30");
  await page.locator("#rm-evening").selectOption("22:00");
  await page.locator("#rm-slots").uncheck();
  await expect.poll(() => puts.at(-1)?.settings?.reminders).toEqual({ morning: "06:30", evening: "22:00", weekly: "20:00", slots: false });
  expect((await page.request.get("/sw.js")).ok()).toBe(true);
  expect(errors).toEqual([]);
});

test("сон: после своего подъёма вместо плана — «Ты встал»", async ({ page }) => {
  const data = fixture();
  data.me[TODAY] = { wake: "06:50" };
  await open(page, { hash: "sleep", time: "07:10", data });
  await expect(page.locator("#fc-me-l")).toHaveText("Ты встал");
  await expect(page.locator("#fc-alarm")).toHaveText("6:50");
});

test("вечер: ложное засыпание — «снова уснул» переносит отбой, карточка вдвоём считает окно", async ({ page }) => {
  const data = fixture();
  data.settings.eveningHabit = "duo";
  data.habits.push({ id: "duo", name: "Молитва и чтение с женой", sphere: "жена", target: 5, order: 4, archived: false, created: "2026-09-01" });
  data.kid[TODAY] = { bed: "21:50", nights: ["22:00"] };
  const { puts, errors } = await open(page, { time: "22:05", data });
  await expect(page.locator("#kid-night-l")).toContainText("проснулся ненадолго");
  await expect(page.locator("#kid-sleep-l")).toHaveText("Тёма снова уснул");
  await expect(page.locator("#duo-card")).toContainText("снова уснул");
  await page.locator("#kid-sleep").click();
  await expect.poll(() => puts.at(-1)?.kid?.[TODAY]).toEqual({ bed: "22:05", tries: [{ s: "21:50", w: "22:00" }] });
  await expect(page.locator("#duo-card")).toContainText("Начинайте в 22:25");
  await page.locator('#duo-card [data-duo="done"]').click();
  await expect.poll(() => puts.at(-1)?.log?.[TODAY]?.duo).toBe(true);
  await expect(page.locator("#duo-card")).toContainText("сегодня было");
  expect(errors).toEqual([]);
});

test("молитва: пробуждение ненадолго посреди молитвы видно в «Успел до подъёма»", async ({ page }) => {
  const data = fixture();
  data.kid[day(-1)] = { bed: "23:35", nights: ["06:50", "08:04"] };
  data.prayer[TODAY] = [{ s: "07:58", m: 14 }];
  await open(page, { hash: "prayer", time: "08:30", data });
  await expect(page.locator("#ps-when li").first()).toContainText("Тёма проснулся в 8:04, посреди молитвы");
});

test("календарь подъёмов: свой подъём виден и в день прогноза", async ({ page }) => {
  const data = fixture();
  data.me[TODAY] = { wake: "06:50" };
  await open(page, { hash: "sleep", time: "07:10", data });
  await expect(page.locator('#kcal .kc-c.me[data-tip*="ты встал в 6:50"]')).toHaveCount(1);
});

test("баланс: сфера «по делу» без дел не подсвечивается и не лезет в упор", async ({ page }) => {
  await open(page);
  await expect(page.locator("#bal-batts")).not.toContainText("здоровье");
  await expect(page.locator("#bal-rec")).not.toContainText("здоровье", { ignoreCase: true });
  await page.goto("/#plan");
  await expect(page.locator("#bl-list li.od", { hasText: "здоровье" })).toContainText("без ритма");
});
