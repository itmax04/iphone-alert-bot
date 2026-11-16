// Локальная проверка «давно висящих» (src/stale.js; node:sqlite, без сети и Cloudflare): запас торга, кандидаты,
// ночные слоты, разбор страницы объявления, перепроверка (живо / снято / сбой), отчёт 21:00, «в топе один раз».
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { staleRoom, staleOffer, staleCandidateAt, nextCheckAt, isRecheckSlot, parseListing, recheckOne, staleReport, buildReport, expireQueue } from '../src/stale.js';
import { runFeed, FEEDS, CRON_FAST, CRON_SLOW, feedFor } from '../src/feeds.js';
import { DEFAULT_SELECT } from '../src/select.js';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
const run = (st) => {
  const s = sqlite.prepare(st.sql);
  return /^\s*(SELECT|WITH)/i.test(st.sql) ? s.all(...st.args) : s.run(...st.args);
};
const stmt = (sql, args = []) => ({
  sql, args, bind: (...a) => stmt(sql, a), run: async () => run(stmt(sql, args)),
  first: async () => run(stmt(sql, args))[0] ?? null, all: async () => ({ results: run(stmt(sql, args)) }),
});
const env = { DB: { prepare: (sql) => stmt(sql), batch: async (list) => list.forEach(run) }, TELEGRAM_TOKEN: 't', TELEGRAM_CHAT_ID: '1' };
const one = (sql, ...a) => sqlite.prepare(sql).get(...a);

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `: получено ${JSON.stringify(got)}, ожидалось ${JSON.stringify(want)}`}`);
};

const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 25, 12); // ср. 25.11.2026 13:00 по Берлину

// --- Запас торга ---
check('запас: 7 дней — 15', staleRoom(7, false, false), 15);
check('запас: 10 дней — 20', staleRoom(10, false, false), 20);
check('запас: 14 дней — 25', staleRoom(14, false, false), 25);
check('запас: 14 дней + снижена — 30', staleRoom(14, true, false), 30);
check('запас: потолок 30', staleRoom(20, true, false), 30);
check('запас: 7 дней + снижена — 20', staleRoom(7, true, false), 20);
check('запас: Festpreis — 0', staleRoom(14, true, true), 0);

// --- Предложение: медиана 600, цель 20 % ---
const S = (o) => staleOffer({ price: 480, median: 600, days: 7, dropped: false, fixed: false, ...o });
check('предложение: 480 € уже +25 %, торг 15 % → 410 € (+46,3 %)', S({}), { offer: 410, pct: 46.3, eur: 190, room: 15 });
check('предложение: 650 €, 7 дней → 550 € (+9,1 %) — не подходит', S({ price: 650 }), null);
check('предложение: 650 €, 14 дней + снижена (30 %) → 455 € → 455 €', S({ price: 650, days: 14, dropped: true })?.offer, 455);
check('предложение: Festpreis 500 € при медиане 600 — цена как есть (+20 %)', S({ price: 500, fixed: true }), { offer: 500, pct: 20, eur: 100, room: 0 });
check('предложение: Festpreis 520 € — не подходит', S({ price: 520, fixed: true }), null);
check('предложение: нет медианы', S({ median: null }), null);
check('предложение: /minprofit 200 отсекает маржу 190 €', staleOffer({ price: 480, median: 600, days: 7, dropped: false, fixed: false }, { ...DEFAULT_SELECT, minprofit: 200 }), null);

// --- Кандидаты и расписание проверок ---
const sel = DEFAULT_SELECT;
check('кандидат: цена 700 при медиане 600 (700×0,7 = 490 → +22 %) — да', staleCandidateAt({ price: 700 }, { median: 600 }, 'high', sel, NOW), NOW + 7 * DAY);
check('кандидат: цена 800 — нет (даже −30 % = 560 даёт +7 %)', staleCandidateAt({ price: 800 }, { median: 600 }, 'high', sel, NOW), null);
check('кандидат: flag — нет', staleCandidateAt({ price: 400 }, { median: 600 }, 'flag', sel, NOW), null);
check('кандидат: nomed — нет', staleCandidateAt({ price: 400 }, null, 'nomed', sel, NOW), null);
check('кандидат: без цены — нет', staleCandidateAt({ price: null }, { median: 600 }, 'nomed', sel, NOW), null);
check('следующая проверка: после 1-й — на 10-й день', nextCheckAt(NOW - 7 * DAY, 1, NOW), NOW + 3 * DAY);
check('следующая проверка: после 2-й — на 14-й день', nextCheckAt(NOW - 10 * DAY, 2, NOW), NOW + 4 * DAY);
check('следующая проверка: после 3-й — конец', nextCheckAt(NOW - 14 * DAY, 3, NOW), null);
check('следующая проверка: отставание — не раньше чем через сутки', nextCheckAt(NOW - 12 * DAY, 1, NOW), NOW + DAY);

// --- Ночные слоты: 01:00–06:00 по Берлину, каждый второй запуск ---
const berlin = (h, m) => new Date(Date.UTC(2026, 10, 25, h - 1, m)); // ноябрь: UTC+1
let fastSlots = 0, slowSlots = 0, dayOnly = 0;
for (let t = 0; t < 24 * 60; t++) {
  const d = new Date(Date.UTC(2026, 10, 25) + t * 60000);
  if (isRecheckSlot(false, d)) fastSlots++;
  if (t % 2 === 0 && isRecheckSlot(true, d)) slowSlots++;
  if (isRecheckSlot(false, d) && (t < 0 || t >= 0) && Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false }).format(d)) % 24 >= 6) dayOnly++;
}
check('слоты: быстрое расписание — 150 в сутки (5 ч, каждый второй запуск)', fastSlots, 150);
check('слоты: медленное расписание — 75 в сутки', slowSlots, 75);
check('слоты: днём перепроверок нет', dayOnly, 0);
check('слоты: 00:59 — нет', isRecheckSlot(false, berlin(0, 59)), false);
check('слоты: 06:01 — нет (окно закрыто)', isRecheckSlot(false, berlin(6, 1)), false);
// все ленты обходятся и в оставшихся (чётных) слотах ночью
const seen = new Set();
for (let t = 0; t < 12 * 60; t++) {
  const d = new Date(Date.UTC(2026, 10, 25, 0) + t * 60000);
  if (!isRecheckSlot(false, d)) seen.add(feedFor(CRON_FAST, d).id);
  if (t % 2 === 0 && !isRecheckSlot(true, d)) seen.add(feedFor(CRON_SLOW, d).id);
}
check('все 12 лент обходятся ночью (в слотах без перепроверки)', seen.size, 12);

// --- Разбор страницы объявления (разметка проверена на живой странице 16.11.2026) ---
const html = (price, desc = 'Top Zustand') =>
  `<div id="viewad-main"><h2 class="boxedarticle--price" id="viewad-price">\n   ${price}</h2><p id="viewad-description-text">${desc}</p></div>`;
check('страница: 400 € VB', parseListing(html('400 € VB')), { price: 400, negotiable: true, fixed: false });
check('страница: 1.250 €', parseListing(html('1.250 €')).price, 1250);
check('страница: Festpreis в описании', parseListing(html('400 €', 'Festpreis!')).fixed, true);
check('страница: «Zu verschenken» — цены нет', parseListing(html('Zu verschenken')).price, null);
check('страница: не объявление (капча)', parseListing('<html>Captcha</html>'), null);

// --- Перепроверка ---
let status = 200, body = html('450 € VB'), requests = [];
globalThis.fetch = async (url, init) => {
  if (String(url).includes('api.telegram.org')) {
    telegram.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
  }
  requests.push([String(url), init?.redirect]);
  return { ok: status === 200, status, text: async () => body };
};
let telegram = [];
sqlite.prepare("INSERT INTO market VALUES ('iPhone 14', '128 GB', 600, 520, 12, ?)").run(NOW);
sqlite.prepare("INSERT INTO market VALUES ('_meta', '*', 0, 0, 0, ?)").run(NOW);
const addItem = (id, price, ageDays, o = {}) =>
  sqlite.prepare(`INSERT INTO items (id, city, model, storage, price, negotiable, title, location, url, sent_at, class, next_at) VALUES (?, 'ph-be', 'iPhone 14', '128 GB', ?, 1, 't', '10115 Berlin', ?, ?, 'high', ?)`)
    .run(id, price, `https://www.kleinanzeigen.de/s-anzeige/x/${id}`, NOW - ageDays * DAY, o.next ?? NOW - ageDays * DAY + 7 * DAY);

check('очередь пуста', await recheckOne(env, NOW), null);
addItem('ka:1', 500, 7);   // через неделю цена 450 → снижена
addItem('ka:2', 500, 7);   // снято
addItem('ka:3', 500, 7);   // сбой
addItem('ka:4', 500, 3);   // ещё рано
// порядок: самое просроченное первым (ka:1/2/3 одного возраста — берём по next_at; задаём разные)
sqlite.prepare("UPDATE items SET next_at = ? WHERE id = 'ka:1'").run(NOW - 3000);
sqlite.prepare("UPDATE items SET next_at = ? WHERE id = 'ka:2'").run(NOW - 2000);
sqlite.prepare("UPDATE items SET next_at = ? WHERE id = 'ka:3'").run(NOW - 1000);

let r = await recheckOne(env, NOW);
check('живо: цена 450, снижена, подходит', r, { id: 'ka:1', outcome: 'live', price: 450, dropped: true, match: true });
check('живо: запрос без редиректа', requests.at(-1)[1], 'manual');
check('живо: записано (7 дней, цена снижена → 20 % → 360 €)', one("SELECT cur_price, check_n, gone, s_offer, s_pct, next_at = ? AS next10 FROM items WHERE id = 'ka:1'", NOW + 3 * DAY),
  { cur_price: 450, check_n: 1, gone: 0, s_offer: 360, s_pct: 66.7, next10: 1 });
status = 301; body = '';
r = await recheckOne(env, NOW);
check('снято (301 на категорию)', [r.id, r.outcome, one("SELECT gone, check_n, next_at, s_offer FROM items WHERE id = 'ka:2'")], ['ka:2', 'gone', { gone: 1, check_n: 1, next_at: null, s_offer: null }]);
status = 403;
r = await recheckOne(env, NOW);
check('сбой 403: проверкой не считается, повтор позже', [r.outcome, one("SELECT check_n, gone, next_at = ? AS later FROM items WHERE id = 'ka:3'", NOW + 3 * 3600 * 1000)], ['error', { check_n: 0, gone: 0, later: 1 }]);
check('больше в очереди нет (ka:4 рано, ka:3 отложен)', await recheckOne(env, NOW), null);
status = 200; body = html('450 € VB');
sqlite.prepare("UPDATE items SET next_at = ? WHERE id = 'ka:3'").run(NOW - 1);
body = '<html>Captcha</html>';
check('страница не похожа на объявление — сбой', (await recheckOne(env, NOW)).outcome, 'error');
sqlite.prepare("UPDATE items SET next_at = ? WHERE id = 'ka:3'").run(NOW - 1);
body = html('600 € VB', 'Festpreis'); // 600 при медиане 600, фикс. — не подходит
r = await recheckOne(env, NOW);
check('живо, но не подходит (Festpreis, цена = медиана)', [r.outcome, r.match, one("SELECT s_offer, s_pct FROM items WHERE id = 'ka:3'")], ['live', false, { s_offer: null, s_pct: null }]);

// --- Отчёт ---
const rep = await staleReport(env, NOW + 1000);
check('отчёт отправлен: 3 перепроверено (ka:1, ka:2, ka:3)', [rep.sent, rep.rows, rep.shown], [true, 3, 1]);
const msg = telegram.at(-1);
check('отчёт: цифры', /Перепроверено: 3 · продано или снято: 1 · подходит: 1/.test(msg.text), true);
check('отчёт: предложение, процент, дни, снижение', /предложите <b>360 €<\/b> → <b>\+66\.7%<\/b> · висит 7 дней · ⬇️ цена снижена \(было 500 €\)/.test(msg.text), true);
check('отчёт: кнопка «Написать продавцу» → lt:<id>', msg.reply_markup.inline_keyboard[0][0], { text: '✍️ 1. Написать продавцу', callback_data: 'lt:ka:1' });
check('в топе отмечено: top_price = 450', one("SELECT top_price FROM items WHERE id = 'ka:1'").top_price, 450);
telegram = [];
const rep2 = await staleReport(env, NOW + 2000);
check('повторный отчёт: то же объявление в топ не попадает', [rep2.shown, /подходит: 0/.test(telegram.at(-1).text), telegram.at(-1).reply_markup], [0, true, undefined]);
// новое снижение цены → снова в топе
sqlite.prepare("UPDATE items SET cur_price = 400, s_offer = 320, s_pct = 87.5 WHERE id = 'ka:1'").run();
check('после нового снижения (450 → 400) — снова в топе', (await staleReport(env, NOW + 3000)).shown, 1);
check('без перепроверок за сутки — отчёта нет', (await staleReport(env, NOW + 5 * DAY)), { sent: false, rows: 0 });

// --- Топ-10 по марже ---
const many = Array.from({ length: 14 }, (_, i) => ({ id: `ka:${100 + i}`, url: 'u', model: 'iPhone 14', storage: '128 GB', location: '10115 Berlin', negotiable: 1, price: 500, cur_price: 500, sent_at: NOW - 8 * DAY, gone: 0, top_price: null, s_offer: 425, s_pct: 30 + i }));
const big = buildReport(many, NOW);
check('топ: 10 из 14, по убыванию маржи', [big.top.length, big.top[0].s_pct, big.top[9].s_pct, /ещё 4 подходящих/.test(big.text)], [10, 43, 34, true]);

// --- Запись кандидата в runFeed и чистка очереди ---
sqlite.exec("DELETE FROM items");
const F = FEEDS.find((f) => f.id === 'ph-be');
const ad = (num, title, price) =>
  `<article class="aditem" data-adid="${num}" data-href="/s-anzeige/x/${num}"><p>10115 Berlin</p><p>${price} € VB</p><script type="application/ld+json">${JSON.stringify({ title, description: '' })}</script></article>`;
const nums = Array.from({ length: 25 }, (_, i) => 10000 + i);
const feedFetch = globalThis.fetch;
let pageHtml = `<ul id="srchrslt-adtable">${nums.map((n) => ad(n, 'iPhone 13 128GB', 300)).join('')}</ul>`;
globalThis.fetch = async (url, init) => (String(url).includes('kleinanzeigen.de/s-handy') ? { ok: true, status: 200, text: async () => pageHtml } : feedFetch(url, init));
await runFeed(env, F); // первый запуск — молча
pageHtml = `<ul id="srchrslt-adtable">${ad(10100, 'iPhone 14 128GB', 650) + ad(10101, 'iPhone 14 128GB', 900) + nums.map((n) => ad(n, 'iPhone 13 128GB', 300)).join('')}</ul>`;
await runFeed(env, F);
const t0 = Date.now();
check('runFeed: 650 € (−30 % = 455 → +31,9 %) — кандидат, next_at ≈ +7 дней', Math.abs(one("SELECT next_at FROM items WHERE id = 'ka:10100'").next_at - (t0 + 7 * DAY)) < 60000, true);
check('runFeed: 900 € — не кандидат', one("SELECT next_at FROM items WHERE id = 'ka:10101'").next_at, null);

addItem('ka:old', 500, 20, { next: NOW - 9 * DAY });
addItem('ka:ok', 500, 8, { next: NOW - 1 * DAY });
await env.DB.batch([expireQueue(env, NOW)]);
check('чистка: старше 15 дней гасится, остальные остаются', [one("SELECT next_at FROM items WHERE id = 'ka:old'").next_at, one("SELECT next_at IS NOT NULL AS q FROM items WHERE id = 'ka:ok'").q], [null, 1]);

console.log(failed ? `\nFAIL: ${failed}` : '\nALL PASS');
process.exit(failed ? 1 : 0);
