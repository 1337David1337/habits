const { test, expect } = require("@playwright/test");
const { TODAY, fixture, open } = require("./helpers");

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
