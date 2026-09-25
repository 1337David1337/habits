# Дашборд · трекер привычек

Статичный сайт на GitHub Pages: https://1337david1337.github.io/habits/

Код страницы публичный, данных в нём нет. Привычки и отметки лежат в `data.json`
приватного репозитория, который указывается в разделе «Подключение» на самой странице.
Страница читает и пишет этот файл через GitHub API. Каждое сохранение — отдельный коммит.

## Подключение устройства

1. Создай fine-grained токен: https://github.com/settings/personal-access-tokens/new
   - Repository access → Only select repositories → репозиторий с данными;
   - Permissions → Repository permissions → Contents → Read and write.
2. Открой сайт, в разделе «Подключение» укажи `владелец/репозиторий` и вставь токен.

Токен хранится только в localStorage этого браузера.

## Формат data.json

```json
{
  "version": 1,
  "settings": {
    "cycleStart": "2026-09-14",
    "cycleWeeks": 12,
    "busyDays": [0, 1, 3],
    "busyLabel": "занято",
    "spheres": ["работа", "здоровье"]
  },
  "habits": [
    { "id": "sleep", "name": "Лечь до 23:30", "sphere": "здоровье",
      "target": 5, "order": 0, "archived": false, "created": "2026-09-14" }
  ],
  "log": { "2026-09-26": { "sleep": true } }
}
```

`target` — сколько раз в неделю, `busyDays` — дни недели с 0 = понедельник.
