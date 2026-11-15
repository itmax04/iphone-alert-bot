// Локальная проверка лент (node:sqlite, без Cloudflare и без сети): адреса, расписание, какие номера считаются
// новыми (закреплённые, опубликованные с задержкой, поднявшиеся со второй страницы), дочитывание страниц,
// режимы наблюдения и отправки, повтор после сбоя отправки, оповещение о сбое ленты.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { feedUrl } from '../src/kleinanzeigen.js';
import { FEEDS, CRON_FAST, CRON_SLOW, feedFor, initState, pickNew, nextState, isNight, runFeed } from '../src/feeds.js';
import { saveMode } from '../src/settings.js';

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

// --- Адреса (форматы проверены на живом сайте 14.11.2026) ---
const feed = (id) => FEEDS.find((f) => f.id === id);
const B = 'https://www.kleinanzeigen.de';
check('лент 12', FEEDS.length, 12);
check('адрес: телефоны, Берлин', feedUrl(feed('ph-be')), `${B}/s-handy-telekom/berlin/anbieter:privat/anzeige:angebote/preis:150:/sortierung:neuste/c173l3331`);
check('адрес: планшеты, MV, стр. 3', feedUrl(feed('tab-mv'), 3), `${B}/s-tablets-reader/mecklenburg-vorpommern/anbieter:privat/anzeige:angebote/preis:150:/seite:3/sortierung:neuste/c285l61`);
check('адрес: MacBook, Гамбург', feedUrl(feed('mac-hh')), `${B}/s-notebooks/hamburg/anbieter:privat/anzeige:angebote/preis:150:/sortierung:neuste/macbook/k0c278l9409`);
check('адрес: часы, Берлин, стр. 2', feedUrl(feed('aw-be'), 2), `${B}/s-wearables/berlin/anbieter:privat/anzeige:angebote/preis:150:/seite:2/sortierung:neuste/apple-watch/k0c405l3331`);

// --- Расписание: за 18 минут каждая лента телефонов — 6 раз, каждая из остальных — 1 раз ---
const counts = {};
for (let m = 0; m < 18; m++) {
  const date = new Date(Date.UTC(2026, 10, 14, 12, m));
  for (const cron of m % 2 ? [CRON_FAST] : [CRON_FAST, CRON_SLOW]) counts[feedFor(cron, date).id] = (counts[feedFor(cron, date).id] || 0) + 1;
}
check('расписание: телефоны по 6 раз', ['ph-be', 'ph-hh', 'ph-mv'].map((id) => counts[id]), [6, 6, 6]);
check('расписание: остальные 9 лент по разу', FEEDS.filter((f) => f.group.key !== 'ph').map((f) => counts[f.id]), Array(9).fill(1));

// --- Какие номера новые ---
const page = (from, n) => Array.from({ length: n }, (_, i) => from - i * 10); // по убыванию, шаг 10
const PINNED = 500; // закреплённое сверху: старый номер
let st = initState({ floor: 0, recent: [], page: 1, initialized: 0 }, [PINNED, ...page(10000, 25)]);
check('первый запуск: порог — 20-й номер', st.floor, 10000 - 19 * 10);
check('та же страница — новых нет', pickNew(st, [PINNED, ...page(10000, 25)]), []);
check('другое закреплённое (старый номер) — не новое', pickNew(st, [700, ...page(10000, 25)]), []);
check('удалили объявление, со 2-й страницы поднялось старое — не новое', pickNew(st, [...page(10000, 25).slice(1), 9750]), []);
check('новое и опубликованное с задержкой (номер ниже соседей)', pickNew(st, [10020, 9995, ...page(10000, 23)]), [9995, 10020]);
st = nextState(st, 2, [9995, 10020]);
check('после обработки — новых нет, страница 1', [pickNew(st, [10020, 9995, ...page(10000, 23)]), st.page], [[], 1]);
check('необработанное остаётся новым', pickNew(nextState(st, 2, [10030]), [10040, 10030]), [10040]);
let grow = st;
for (let n = 10030; n < 10600; n += 10) grow = nextState(grow, 1, [n]);
check('помним 40 номеров, порог растёт', [grow.recent.length, grow.floor], [40, 10590 - 40 * 10]);
check('вся страница новая → дочитываем страницу 2', nextState(st, 25, page(20000, 25)).page, 2);
const part = nextState(st, 25, page(20000, 12));
check('лимит за запуск: остаёмся на странице и помним о переполнении', [part.page, part.pending], [1, 1]);
check('…после остатка всё равно идём на страницу 2', nextState(part, 13, page(19880, 13)).page, 2);
const p2 = nextState(st, 25, page(20000, 25));
check('порог заморожен на время дочитывания', p2.floor, st.floor);
check('страница 2: мало новых → возврат на страницу 1', nextState(p2, 3, [19000, 18990, 18980]).page, 1);
check('страница 5 — дальше не идём', nextState({ ...p2, page: 5 }, 25, page(15000, 25)).page, 1);

// Классы и отбор (deal / haggle / low / high / nomed / flag) — scripts/test_select.js.
// Медианы рынка для проверки ленты целиком: iPhone 15 Pro 256 — 650 €, iPhone 14 128 — 500 €, iPhone 16 256 — 900 €.
for (const [model, storage, median] of [['_meta', '*', 0], ['iPhone 15 Pro', '256 GB', 650], ['iPhone 14', '128 GB', 500], ['iPhone 16', '256 GB', 900]]) {
  sqlite.prepare('INSERT INTO market (model, storage, median, p25, count, updated_at) VALUES (?, ?, ?, ?, 9, 0)').run(model, storage, median, median);
}

// --- Проверка ленты целиком (сеть подменена) ---
const ad = (num, title, price = 400) =>
  `<article class="aditem" data-adid="${num}" data-href="/s-anzeige/x/${num}"><p>10115 Berlin</p><p>${price} € VB</p>` +
  `<script type="application/ld+json">${JSON.stringify({ title, description: '' })}</script></article>`;
let pages = {}; // номер страницы → HTML
let telegram = [];
let telegramFails = false;
let siteDown = false;
const fetched = [];
globalThis.fetch = async (url, init) => {
  if (String(url).includes('api.telegram.org')) {
    telegram.push(JSON.parse(init.body));
    if (telegramFails) return { ok: false, status: 500, json: async () => ({ ok: false, description: 'fail' }) };
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 77 } }) };
  }
  fetched.push(String(url));
  if (siteDown) return { ok: false, status: 503, text: async () => '' };
  const n = Number((String(url).match(/seite:(\d+)/) || [0, 1])[1]);
  return { ok: true, status: 200, text: async () => `<ul id="srchrslt-adtable">${pages[n] || ''}</ul>` };
};
const F = feed('ph-be');
const old = page(10000, 25).map((n) => ad(n, 'iPhone 13 128GB')).join('');

pages = { 1: old };
check('первый запуск — молча', (await runFeed(env, F)).initialized, true);
check('ничего не записано в items', one('SELECT COUNT(*) n FROM items').n, 0);

pages = { 1: ad(10010, 'iPhone 15 Pro 256GB', 500) + ad(10020, 'Nokia 3310') + old };
let r = await runFeed(env, F);
check('наблюдение: 2 новых, подходит 1, отправлено 0', [r.unseen, r.matched, r.sent, telegram.length], [2, 1, 0, 0]);
check('items: запись без msg_id, с классом', one("SELECT model, storage, msg_id, class, city FROM items WHERE id = 'ka:10010'"), { model: 'iPhone 15 Pro', storage: '256 GB', msg_id: null, class: 'deal', city: 'ph-be' });
check('цена записана в prices', one("SELECT model, storage, price FROM prices WHERE id = 'ka:10010'"), { model: 'iPhone 15 Pro', storage: '256 GB', price: 500 });
check('stats: «прислал бы» 1', one("SELECT sent FROM stats WHERE city = 'ph-be'").sent, 1);
check('повторная проверка — новых нет', (await runFeed(env, F)).unseen, 0);

// Простой: вышло больше страницы → дочитываем страницу 2, потом возвращаемся.
pages = { 1: page(30000, 25).map((n) => ad(n, 'iPhone 14 128GB')).join(''), 2: page(29000, 12).map((n) => ad(n, 'iPhone 14 128GB')).join('') + old, 3: old };
r = await runFeed(env, F);
check('страница 1 вся новая: за запуск 12, остаёмся', [r.unseen, r.matched, r.nextPage], [25, 12, 1]);
r = await runFeed(env, F);
check('ещё 12', [r.unseen, r.matched, r.nextPage], [13, 12, 1]);
r = await runFeed(env, F);
check('последнее → следующая страница 2', [r.unseen, r.nextPage], [1, 2]);
r = await runFeed(env, F);
check('страница 2: запрошена seite:2, 12 новых → страница 3', [/seite:2\//.test(fetched.at(-1)), r.unseen, r.nextPage], [true, 12, 3]);
r = await runFeed(env, F);
check('страница 3: новых нет → страница 1', [r.unseen, r.nextPage], [0, 1]);
check('всего в items: 1 + 25 + 12', one('SELECT COUNT(*) n FROM items').n, 38);
check('после дочитывания — новых нет', (await runFeed(env, F)).unseen, 0);

// Режим отправки.
await saveMode(env, 'send');
pages = { 1: ad(30010, 'iPhone 16 256GB', 700) + pages[1] };
telegramFails = true;
const realError = console.error;
console.error = () => {}; // ожидаемая ошибка отправки
r = await runFeed(env, F);
console.error = realError;
check('сбой Telegram: не отправлено, номер не запомнен', [r.sent, one("SELECT COUNT(*) n FROM items WHERE id = 'ka:30010'").n], [0, 0]);
telegramFails = false;
telegram = [];
r = await runFeed(env, F);
check('повтор: отправлено 1, звук — по времени суток', [r.sent, telegram.length, Boolean(telegram[0].disable_notification)], [1, 1, isNight()]);
check('сообщение: ✅ и маржа в % и €', /✅ <b>Уже выгодно: маржа \+28\.6% \(\+200 €\)<\/b>/.test(telegram[0].caption || telegram[0].text), true);
check('items: msg_id сохранён', one("SELECT msg_id, class FROM items WHERE id = 'ka:30010'"), { msg_id: 77, class: 'deal' });
check('после отправки — новых нет', (await runFeed(env, F)).unseen, 0);

// Отбор в режиме отправки: 880 € VB — даже после торга цели нет; 800 € VB — выгодно после торга (−10 % → 720 €).
pages = { 1: ad(30020, 'iPhone 16 256GB', 880) + ad(30030, 'iPhone 16 256GB', 800) + pages[1] };
telegram = [];
r = await runFeed(env, F);
check('отбор: 2 новых, прислано 1', [r.unseen, r.matched, r.sent, telegram.length], [2, 1, 1, 1]);
check('сообщение: 🤝 и цена для торга', /🤝 <b>Выгодно после торга: предложите 720 €<\/b>\nпри 720 € маржа \+25% \(\+180 €\) · запас торга ~10% \(VB\)/.test(telegram[0].caption || telegram[0].text), true);
check('items: невыгодное записано без msg_id', one("SELECT msg_id, class FROM items WHERE id = 'ka:30020'"), { msg_id: null, class: 'low' });
check('items: класс haggle', one("SELECT msg_id, class FROM items WHERE id = 'ka:30030'"), { msg_id: 77, class: 'haggle' });
check('невыгодное запомнено — новых нет', (await runFeed(env, F)).unseen, 0);

// Выключенная лента и сбой сайта.
sqlite.prepare("UPDATE feeds SET muted = 1 WHERE feed = 'ph-be'").run();
check('выключенная лента не запрашивается', [(await runFeed(env, F)).muted, fetched.length], [true, fetched.length]);
sqlite.prepare("UPDATE feeds SET muted = 0 WHERE feed = 'ph-be'").run();
siteDown = true;
telegram = [];
await runFeed(env, F);
await runFeed(env, F);
await runFeed(env, F);
check('сбой сайта: одно оповещение после второго сбоя', telegram.length, 1);
siteDown = false;
await runFeed(env, F);
check('восстановление: сообщение и сброс счётчика', [telegram.length, one("SELECT fail_count, muted FROM feeds WHERE feed = 'ph-be'")], [2, { fail_count: 0, muted: 0 }]);

console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
process.exit(failed ? 1 : 0);
