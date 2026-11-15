# Handoff — iphone-alert-bot: экономия D1 и переделка поиска

## Идентичность
- Репозиторий: `itmax04/iphone-alert-bot`, локально `~/Developer/iphone-alert-bot`, ветка `main`, код этапа 4 — коммит `9851764` (запушен 15.11.2026).
- **Этап 4 задеплоен 15.11.2026** (версия 7b6650c3; откат — `wrangler rollback` на 8e831d5c, этап 3). Режим по-прежнему `watch`;
  отправку включает только владелец (`/mode send`). Новые файлы: `src/select.js`, `scripts/test_select.js`; изменены `src/feeds.js`,
  `kleinanzeigen.js`, `settings.js`, `commands.js`, `scripts/test_feeds.js`, `README.md`, `AGENTS.md`.
- **Этап 3 задеплоен 15.11.2026** (версия 8e831d5c; коммиты `0d7571e`, `c2b50ab` в `origin/main`). Миграция 005 применена, `items.class` есть. Файлы этапа 3:
  новые `src/feeds.js`, `scripts/test_feeds.js`, `db/migrations/005_feeds.sql`; изменены `src/index.js`, `commands.js`,
  `filters.js`, `kleinanzeigen.js`, `settings.js`, `messages.js`, `db/schema.sql`, `scripts/check.js`, `scripts/test_models.js`,
  `README.md`, `AGENTS.md`, `wrangler.toml`, `package.json`; удалены (git rm) `src/cities.js`, `src/mv.js`, `src/deals.js`,
  `scripts/seed_prices.js`, `scripts/sweep_mv.js`.

## Цель и рамки
Четыре улучшения (запрос владельца):
1. Категории: iPhone **11+**, iPad, MacBook, Apple Watch (Series 7+/Ultra), Samsung S21+ / Z Fold/Flip 3+, Pixel 6+. — сделано в коде этапа 3.
2. География: региональные ленты — вся MV (`l61`), Берлин (`l3331`), Гамбург (`l9409`); опрос 23 городов и лента «вся Германия» убраны. — сделано в коде этапа 3.
3. Отбор (этап 4, СДЕЛАН 15.11, кроме ночного обхода и сводки в 8:00 — нет свободных cron): эталон — медиана Kleinanzeigen по той же модели (без вычета расходов). Главное — **потенциал торга**:
   целевая цена = медиана / 1,2 (решение владельца 14.11: **только процент +20 %, без минимума в евро**;
   считается **только маржа**: медиана − цена покупки, в % от цены покупки; никаких других расходов (дорога, комиссии,
   доставка) не вычитать; в сообщении показывать маржу в % и €; команда /minprofit — по умолчанию выключена); запас торга по сигналам: VB 10 %, +5 % за срочность
   (muss weg, Umzug, dringend, schnell), +5 % за давно висящее объявление или уже сниженную цену, Festpreis — 0 %, максимум 20 %.
   ✅ «уже выгодно» и 🤝 «выгодно после торга: предложите X €». Порог меняется командами
   (/target 20, /haggle 15). Дефекты, аксессуары и признаки обмана отсеиваются.
   Каждое объявление присылается сразу: днём со звуком, ночью без звука. Ночью — обход регионов, в 8:00 сводка давно висящих и подешевевших.
4. Cloudflare: обеспечить работу весь день на бесплатном тарифе.

Ограничения (AGENTS.md проекта): 10 мс CPU и одна страница за запуск; 5 cron на аккаунт, все заняты
(2 здесь + 3 у rostock-wohnung-bot); не обходить защиту сайтов; не писать продавцам автоматически; секреты только через `wrangler secret put`.
Режим отправки включает только владелец (`/mode send`).

## Этапы 1 и 2 (закоммичены, задеплоены)
- Этап 1 `b506f49`: таблица `market` (ночные медианы и p25), индексы по времени, суточная чистка; миграция `004` применена.
  До этого `rows_read_24h` = 5 531 823 (73 % — медианы по 3 887 строк на вызов).
- Этап 2 `59fa058`: каталог `src/catalog.js` (`identify`, `identifyQuery`), `/sell` и `/price` через каталог, `/models`. Deploy 9afeb298.
- NOT RUN с тех этапов: `GET /setup?key=…` (нет локального `.run_key`); замер `rows_read_24h` после ночного пересчёта
  (ждать 16.11); `SELECT COUNT(*) FROM market` после ночи 15.11.

## Факты этапа 3 (проверено обычными запросами 14.11.2026, суббота ~18:30)
- Лента категории **без слова** — `…/sortierung:neuste/c173l3331` (без `k0`); со словом — `…/macbook/k0c278l3331`.
  Страницы: `…/preis:150:/seite:N/sortierung:neuste/…`. Все 12 адресов отвечают 200, 25–27 объявлений, 0,8–1,2 МБ.
- **Apple Watch лежат в Wearables (`s-wearables`, `c405`)**, а не в `c173`: Берлин от 150 € — 436 против 47. Поэтому лент 12, а не 9 (одобрено владельцем).
- Объём: телефоны Berlin ~300 в сутки (21 в час днём), Hamburg ~200, MV ~110; планшеты ~60 на три региона; MacBook ~75;
  часы — редко (страница Берлина покрывает ~27 ч). Распознаётся: телефоны 67–89 %, планшеты 36–58 %, MacBook 15–27 %, часы 60–78 %.
  Оценка без отбора: ~575 сообщений в сутки.
- Лента отсортирована по времени публикации, а не по номеру: на 52 объявлениях часов — одно с задержкой публикации
  (номер ниже соседей) и одно поднятое старое; сверху 1–2 закреплённых со старыми номерами. Поэтому состояние ленты —
  порог + последние ~40 номеров, а не один «последний номер».

## Сделано (этап 3, не закоммичено)
- `src/feeds.js`: `REGIONS` × `GROUPS` = 12 лент (`ph-be` … `aw-mv`); расписание `feedFor` — `* * * * *`: 3 ленты телефонов,
  каждая раз в 3 мин; `*/2 * * * *`: 9 остальных, каждая раз в 18 мин (2 160 запросов в сутки, как раньше).
  Состояние: `initState` (первый запуск молча, порог — 20-й номер), `pickNew`, `nextState` (порог, `recent`, дочитывание страниц
  до 5-й при ≥ 20 новых на первой, `pending`). `runFeed`: разбор только новых, `recognize` → `prices` → класс → `items`;
  лимит 12 объявлений за запуск в наблюдении, 6 при отправке; номер запоминается только после обработки.
- Режим: `settings.mode`, по умолчанию `watch` (ничего не присылает, пишет в `items` с `msg_id` NULL и `class`); `/mode send` — отправка
  каждого распознанного, звук только у 🔥.
- `src/filters.js`: `ACTIVE_CATEGORIES` — все 6 категорий, `MIN_IPHONE = 11`, `recognize(title, description)`; `storageOf` и `rejectReason` удалены,
  вариант — из каталога. `tagsOf(item, rec)`.
- `src/kleinanzeigen.js`: `feedUrl`, `fetchFeed`, `MIN_PRICE = 150`; у объявления появился `num`.
- `src/commands.js`: `/feeds` (меню и карточки 12 лент, вкл/выкл) вместо `/cities`; `/mode`; `/stats` и отчёт 21:00 — по лентам
  с разбивкой по классам (`deal` ≤ медиана/1,2, `low`, `high`, `nomed`, `flag`). `/deals` и сводки «Топ-5» убраны.
- `src/messages.js`: вопрос про блокировку — iCloud для Apple, учётная запись Google/Samsung для остальных.
- `src/index.js`: cron → `runFeed`; `/run?key=…&feed=<id>|report|market` (параметр `city` заменён на `feed`).
- `db/migrations/005_feeds.sql` (+ `schema.sql`): таблица `feeds`, колонка `items.class`.
- Старые таблицы `seen`, `city_state`, `deal_seen`, `deals`, `mv_seen` не используются и **не удалены** (откат); ночная чистка их дочищает.
- README, AGENTS.md, `wrangler.toml`, `package.json` обновлены.

## Проверено (этап 3, рабочее дерево поверх `c824a3a`, 14.11.2026)
- PASS `for f in src/*.js scripts/*.js; do node --check "$f"; done` — exit 0, 14 файлов.
- PASS `node scripts/test_models.js` — 164/164, ленты 7/7, /sell 21/21, /price 6/6, ALL PASS.
- PASS `node scripts/test_market.js` — ALL PASS.
- PASS `node scripts/test_feeds.js` — 47 PASS, 0 FAIL (адреса, расписание, новые номера, дочитывание, наблюдение/отправка, сбой Telegram, сбой сайта).
- PASS `npm run check` — exit 0, 12 лент, 25–27 объявлений в каждой.
- PASS `npx wrangler@4 deploy --dry-run` — сборка 85,33 КиБ (без публикации).
- NOT RUN: миграция 005 на удалённой D1, deploy, `wrangler tail` (cpuTime на новых лентах), `/setup` (меню с `/feeds`, `/mode`),
  команды в Telegram. Независимое ревью не проводилось (самопроверка диффа).

## Открыто
- **Порядок выкладки важен:** сначала миграция 005, потом deploy (иначе `runFeed` падает на отсутствующей таблице `feeds`).
  После deploy — `/setup`, 18 минут на молчаливый первый проход всех лент.
- После deploy на 1–2 дня объявления не приходят вообще (наблюдение) — владелец предупреждён и согласен.
- Не измерено на Cloudflare: cpuTime новых лент; считается ли `DB.batch` одним запросом D1 (лимиты за запуск выбраны с запасом).
- Риск: объявление, опубликованное с задержкой больше ~40 позиций ленты, будет пропущено (Берлин, телефоны — около 2 часов).
- Медианы новых категорий появятся после ≥ 5 цен на ключ и ночного пересчёта; порог 150 € слегка завышает медианы дешёвых моделей.
- MacBook распознаётся в 15–27 % объявлений (нет RAM/чипа в заголовке; MacBook Neo нет в каталоге) — кандидат на доработку каталога.
- OLX.ua: с Mac владельца 403; из Cloudflare не проверено. Защиту не обходить.
- Удалить старые таблицы отдельной миграцией 006 — после включения отправки.

## Этап 4 (15.11.2026) — сделано и проверено
- Сделано: `src/select.js` (`haggleOf`, `evaluate`, `parseSelectArg`, `DEFAULT_SELECT` = target 20, haggle 20, minprofit null);
  `parseArticle` отдаёт `posted` и `oldPrice`; `runFeed` присылает только `deal`/`haggle`, в `items` пишет все классы,
  `stats.sent` = deal + haggle; звук — `isNight` (22:00–08:00 Берлин без звука); команды `/target`, `/haggle`, `/minprofit`
  (settings, ключ `select`); `/margin` и 🔥 убраны (функции в `market.js` остались без вызовов); карточка `/feeds` показывает только ✅/🤝.
- PASS (рабочее дерево = `9851764`): `node --check` всех файлов; `test_models.js`, `test_market.js`, `test_feeds.js`, `test_select.js` — ALL PASS;
  `npm run check` — 12 лент; `wrangler deploy --dry-run` — 92,45 КиБ; deploy — версия 7b6650c3.
- NOT RUN / не закончено: **проверка tail после deploy этапа 4** (outcome, exceptions, cpuTime ≤ 10–15 мс) — tail запущен в фоне
  прошлой сессией, результат не прочитан; `GET /setup` (владелец, нужен для меню с `/target`, `/haggle`, `/minprofit`); команды в Telegram.
  Независимое ревью не проводилось (самопроверка диффа).
- Числа наблюдения (15.11, первые ~25 минут этапа 3, 28 объявлений): deal 1, low 8, high 11, nomed 5, flag 3. Оценка с отбором —
  десятки сообщений в сутки вместо ~575; уточнить по `SELECT class, COUNT(*) FROM items GROUP BY class` через несколько часов.
- В `market` 158 ключей; модели без медианы (`nomed`) не присылаются, пока не накопится ≥ 5 цен и не пройдёт ночной пересчёт (03:20).
- Отложено: ночной обход регионов и сводка в 8:00 (нет свободных cron); миграция 006 (удаление старых таблиц).

## Проверка этапа 4 в проде (шаг A, 15.11.2026)
- **Tail — PASS.** 12 запусков (cron, без ручных), outcome ok 12/12, exceptions 0/12, logs пусто. cpuTime (мс): 5, 5, 6, 6, 9, 9, 12, 12, 12, 15, 17, 18;
  медиана 9, максимум 18 (два запуска > 15 мс, не подряд и не стабильно — порог «стабильно > 15» не сработал). Версия в tail-выводе не печатается;
  деплой 7b6650c3 — по handoff, новых деплоев после него не было.
- **Разбивка по классам** (`items`, за 24 ч, наблюдение): deal 1, haggle 0, low 8, high 12, nomed 5, flag 3 (всего 29).
  Оценка для отправки: deal + haggle = 1 из 29 (≈ 3,5 %) → при нынешнем потоке ~5–10 сообщений в сутки
  (наблюдение пока короткое, это грубо; без отбора было ~575).
- **feeds:** 12 строк, все `initialized = 1`, `page = 1`; у `aw-hh` `fail_count = 1`, `HTTP 403` (разовый; как в этапе 3).
- Остановлен мой tail (PID 99674/99746/99748). Оставшиеся tail-процессы 98253/98311/98312 — от прошлой сессии, не трогал.
- NOT RUN: `GET /setup?key=<RUN_KEY>` и проверка `/target`, `/haggle`, `/minprofit`, `/stats` — делает владелец в Telegram.

## Следующий шаг (актуальный)
A. ВЫПОЛНЕНО 15.11 (PASS, см. «Проверка этапа 4 в проде»). Было: `nohup npx --yes wrangler@4 tail iphone-alert-bot --format json > файл &` (на macOS нет `timeout`),
   10–15 запусков: outcome ok, exceptions 0, cpuTime ≤ 10–15 мс; при exceptions или cpuTime стабильно > 15 мс — остановиться,
   показать вывод владельцу, откат `wrangler rollback` на 8e831d5c. Затем `SELECT class, COUNT(*) FROM items WHERE sent_at > … GROUP BY class`.
B. Владелец: `GET /setup?key=<RUN_KEY>`, проверить `/target`, `/haggle`, `/minprofit`, `/stats`, `/feeds`; когда готов — `/mode send`.
C. Через сутки: `npx --yes wrangler@4 d1 info iphone-alert-bot` (rows_read_24h < 1 млн), число сообщений в день.

## Следующий шаг (история, выполнено)
0. ~~Выкладка~~ ВЫПОЛНЕНО 15.11: tail — outcome ok, exceptions 0, cpuTime 10–14 мс (≈ 5 запусков, выборка небольшая); `feeds`: 12 строк, `initialized = 1`; у `aw-hh` разовый `HTTP 403` (fail_count 1). Осталось: владелец вызывает `GET /setup?key=<RUN_KEY>`, проверяет `/feeds`, `/mode`, `/stats`. (Было: после 00:00 UTC (≈ 01:00 по Берлину 15.11):** проверить `SELECT class FROM items LIMIT 1` (если колонки нет — `ALTER TABLE items ADD COLUMN class TEXT`), затем `npm run deploy` → `npm run tail` в фоне (outcome ok, cpuTime ≤ 10–15 мс) → `SELECT feed, initialized, page, last_ok, last_error FROM feeds` через ~18 мин (12 строк, `initialized = 1`) → владелец вызывает `GET /setup?key=<RUN_KEY>` и проверяет `/feeds`, `/mode`, `/stats`. Откат: `wrangler rollback` (9afeb298).
1. С разрешения владельца: commit + push этапа 3 → миграция `005_feeds.sql` на удалённой D1 → `npm run deploy` → `npm run tail`
   (outcome ok, cpuTime ≈ ≤ 10–15 мс) → владелец вызывает `GET /setup?key=<RUN_KEY>`.
2. Через 1–2 дня: `/stats` и отчёты 21:00 — сколько «прислал бы» и разбивка по классам; `SELECT class, COUNT(*) FROM items GROUP BY class`;
   `npx --yes wrangler@4 d1 info iphone-alert-bot` (rows_read_24h, цель < 1 млн). Записать сюда.
3. Этап 4 — отбор по потенциалу торга (п. 3 в «Цель и рамки»): целевая цена = медиана / 1,2, запас торга по сигналам, ✅ / 🤝,
   команды `/target`, `/haggle`; отсев `flag`. Файлы: `src/feeds.js` (`classOf`, `runFeed`, `formatItem`), `src/kleinanzeigen.js`
   (дата и зачёркнутая цена из карточки), `src/settings.js`, `src/commands.js`. Сначала план с числами из наблюдения и одобрение владельца.
