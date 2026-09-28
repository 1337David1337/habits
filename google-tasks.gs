/**
 * Мост между дашбордом и Google Задачами.
 *
 * Разворачивается как веб-приложение Apps Script в твоём Google-аккаунте.
 * Дашборд забирает отсюда задачи и отмечает их выполненными. Доступ — только по ключу,
 * который создаёт функция setup() и хранит в свойствах скрипта (в коде ключа нет).
 *
 * Установка:
 * 1. script.google.com → новый проект → вставить этот код.
 * 2. «Сервисы» → «+» → Google Tasks API → «Добавить».
 * 3. Выбрать функцию setup → «Выполнить» → разрешить доступ. Ключ появится в журнале.
 * 4. «Начать развёртывание» → «Новое развёртывание» → «Веб-приложение»,
 *    запуск от своего имени, доступ «Все». Скопировать URL.
 * 5. Вставить URL и ключ в «Настройки дашборда».
 */

const COMPLETED_DAYS = 35;

function setup() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('KEY');
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    props.setProperty('KEY', key);
  }
  Tasks.Tasklists.list({ maxResults: 1 });
  Logger.log('Ключ для дашборда: ' + key);
}

function doGet(e) {
  if (!authorized_(e && e.parameter && e.parameter.key)) return json_({ error: 'forbidden' });
  const since = new Date(Date.now() - COMPLETED_DAYS * 864e5).toISOString();
  const lists = [];
  const tasks = [];
  (Tasks.Tasklists.list({ maxResults: 100 }).items || []).forEach(function (list) {
    lists.push({ id: list.id, title: list.title });
    collect_(list, { showCompleted: false }, tasks);
    collect_(list, { showCompleted: true, showHidden: true, completedMin: since }, tasks);
  });
  return json_({ lists: lists, tasks: tasks, at: new Date().toISOString() });
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return json_({ error: 'bad request' }); }
  if (!authorized_(body.key)) return json_({ error: 'forbidden' });
  if (body.action === 'complete') {
    Tasks.Tasks.patch({ status: 'completed' }, body.listId, body.id);
    return json_({ ok: true });
  }
  if (body.action === 'reopen') {
    Tasks.Tasks.patch({ status: 'needsAction', completed: null }, body.listId, body.id);
    return json_({ ok: true });
  }
  return json_({ error: 'unknown action' });
}

function collect_(list, options, out) {
  let pageToken = null;
  do {
    const opts = Object.assign({ maxResults: 100 }, options);
    if (pageToken) opts.pageToken = pageToken;
    const res = Tasks.Tasks.list(list.id, opts);
    (res.items || []).forEach(function (t) {
      if (!t.title) return;
      if (options.showCompleted && t.status !== 'completed') return;
      out.push({
        id: t.id, listId: list.id, list: list.title, title: t.title,
        due: t.due ? t.due.slice(0, 10) : null, status: t.status,
        completed: t.completed || null, updated: t.updated || null, parent: t.parent || null,
      });
    });
    pageToken = res.nextPageToken;
  } while (pageToken);
}

function authorized_(key) {
  const expected = PropertiesService.getScriptProperties().getProperty('KEY');
  return !!expected && key === expected;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
