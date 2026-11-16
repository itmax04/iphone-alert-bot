// Локальная проверка /found («давно висят», src/found.js; node:sqlite): разбор аргументов, кнопки, выборка, пагинация, план запроса.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { parseFoundArgs, encodeFilter, decodeFilter, foundQuery, renderFound, showFound, PAGE_SIZE, DEFAULT_FILTER } from '../src/found.js';
import { COMMANDS, handleUpdate } from '../src/commands.js';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
  first: async () => sqlite.prepare(sql).all(...args)[0] ?? null,
  run: async () => sqlite.prepare(sql).run(...args),
});
const env = { DB: { prepare: (sql) => stmt(sql) }, TELEGRAM_TOKEN: 't', TELEGRAM_CHAT_ID: '1' };

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `: получено ${JSON.stringify(got)}, ожидалось ${JSON.stringify(want)}`}`);
};

const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 25, 12);
let seq = 0;
function add(o) {
  const r = { id: `ka:${++seq}`, city: 'ph-be', model: 'iPhone 14', storage: '128 GB', price: 500, cur_price: 480, negotiable: 1, url: `https://x/${seq}`, sent_at: NOW - 8 * DAY, checked_at: NOW - 1000 * seq, gone: 0, s_offer: 450, s_pct: 25, ...o };
  sqlite.prepare('INSERT INTO items (id, city, model, storage, price, cur_price, negotiable, url, sent_at, checked_at, gone, s_offer, s_pct) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(r.id, r.city, r.model, r.storage, r.price, r.cur_price, r.negotiable, r.url, r.sent_at, r.checked_at, r.gone, r.s_offer, r.s_pct);
}
for (let k = 0; k < 7; k++) add({}); // 7 подходящих, 8 дней
add({ sent_at: NOW - 15 * DAY, city: 'mac-hh', model: 'MacBook Air 13" M2 8GB' }); // 14+ , Hamburg, MacBook
add({ gone: 1 }); // снято
add({ s_offer: null, s_pct: null }); // перепроверено, но не подходит
add({ sent_at: NOW - 2 * DAY }); // свежее — не «давно»
sqlite.prepare("INSERT INTO items (id, city, sent_at, url) VALUES ('ka:new', 'ph-be', ?, 'u')").run(NOW - 9 * DAY); // не перепроверено

// --- Разбор ---
check('/found — по умолчанию 7+, подходят', parseFoundArgs('/found'), { filter: DEFAULT_FILTER });
check('/found 14 be mac', parseFoundArgs('/found 14 be mac').filter, { age: '14', fit: 'y', reg: 'be', grp: 'mac', page: 0 });
check('/found all', parseFoundArgs('/found all').filter.fit, 'n');
check('/found мусор — ошибка', Boolean(parseFoundArgs('/found zzz').error), true);
check('кнопка: туда-обратно', decodeFilter(encodeFilter({ age: '14', fit: 'n', reg: 'hh', grp: 'aw', page: 3 }).slice(3)), { age: '14', fit: 'n', reg: 'hh', grp: 'aw', page: 3 });
check('кнопка: мусор → умолчания', decodeFilter('x:y:z:q:99'), { age: '7', fit: 'y', reg: '*', grp: '*', page: 9 });
check('callback_data ≤ 64 байт', encodeFilter({ age: '14', fit: 'n', reg: 'hh', grp: 'tab', page: 9 }).length <= 64, true);
check('команда в меню', COMMANDS.some((c) => c.command === 'found'), true);

// --- Выборка ---
const q = (f) => { const x = foundQuery(f, NOW); return sqlite.prepare(x.sql).all(...x.args); };
check('7+ подходят: 7 + 1 (14+) = 8 → на странице PAGE_SIZE+1', q(DEFAULT_FILTER).length, PAGE_SIZE + 1);
check('вторая страница: остаток 3', q({ ...DEFAULT_FILTER, page: 1 }).length, 3);
check('14+: одно объявление', q({ ...DEFAULT_FILTER, age: '14' }).map((r) => r.city), ['mac-hh']);
check('all: добавляется «не подходит», снятое и свежее — нет', q({ ...DEFAULT_FILTER, fit: 'n', page: 1 }).length, 4);
check('регион hh', q({ ...DEFAULT_FILTER, reg: 'hh' }).length, 1);
check('регион hh + группа ph — пусто', q({ ...DEFAULT_FILTER, reg: 'hh', grp: 'ph' }).length, 0);
const plan = (() => { const x = foundQuery(DEFAULT_FILTER, NOW); return sqlite.prepare(`EXPLAIN QUERY PLAN ${x.sql}`).all(...x.args).map((r) => r.detail).join(' | '); })();
check('план: индекс items_checked, без полного скана', /items_checked/.test(plan) && !/SCAN items$/.test(plan.trim()), true);

// --- Карточки ---
const page = renderFound(q(DEFAULT_FILTER), DEFAULT_FILTER, NOW);
const btns = page.markup.inline_keyboard.flat();
check('карточка: PAGE_SIZE кнопок ✍️ lt:', btns.filter((b) => b.callback_data?.startsWith('lt:')).length, PAGE_SIZE);
check('карточка: PAGE_SIZE кнопок 🔗 с url', btns.filter((b) => b.url).length, PAGE_SIZE);
check('карточка: есть «Дальше», нет «Назад»', [btns.some((b) => b.text.includes('Дальше')), btns.some((b) => b.text.includes('Назад'))], [true, false]);
check('карточка: цена, предложение, маржа, «было»', /iPhone 14 · 128 GB · 480 € VB.*\(было 500 €\)[\s\S]*предложите <b>450 €<\/b> → <b>\+25%<\/b> · висит 8 дней/.test(page.text), true);
const last = renderFound(q({ ...DEFAULT_FILTER, page: 1 }), { ...DEFAULT_FILTER, page: 1 }, NOW);
check('последняя страница: нет «Дальше», есть «Назад»', [last.markup.inline_keyboard.flat().some((b) => b.text.includes('Дальше')), last.markup.inline_keyboard.flat().some((b) => b.text.includes('Назад'))], [false, true]);
check('пусто: подсказка про ночную перепроверку', /Пока пусто/.test(renderFound([], DEFAULT_FILTER, NOW).text), true);

// --- Через handleUpdate: ответ уходит в Telegram, продавцам и mode не трогаем ---
const calls = [];
globalThis.fetch = async (url, init) => { calls.push({ url: String(url), body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) }; };
await handleUpdate(env, { message: { chat: { id: 1 }, text: '/found 14' } });
check('/found → sendMessage', [calls.length, calls[0].url.endsWith('/sendMessage')], [1, true]);
await handleUpdate(env, { callback_query: { id: 'c', data: encodeFilter({ ...DEFAULT_FILTER, age: '14' }), message: { chat: { id: 1 }, message_id: 7 } } });
check('кнопка → editMessageText', calls.some((c) => c.url.endsWith('/editMessageText') && c.body.message_id === 7), true);
check('settings не тронуты', sqlite.prepare('SELECT COUNT(*) AS n FROM settings').get().n, 0);

console.log(failed ? `\nFAIL: ${failed}` : '\nALL PASS');
process.exit(failed ? 1 : 0);
