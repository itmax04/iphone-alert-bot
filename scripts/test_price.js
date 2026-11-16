// Локальная проверка потолка цены /price (src/settings.js, runFeed, /found; node:sqlite): группы, порядок
// модель → группа → общий, потолок по цене после торга (🤝), пометка в сообщении, фильтр в /found.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { applyPriceCommand, describePriceFilter, priceCap, priceRejectReason, budgetReject } from '../src/settings.js';
import { runFeed, FEEDS, formatItem } from '../src/feeds.js';
import { foundQuery, DEFAULT_FILTER } from '../src/found.js';

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
const all = (sql, ...a) => sqlite.prepare(sql).all(...a);

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `: получено ${JSON.stringify(got)}, ожидалось ${JSON.stringify(want)}`}`);
};
const empty = { min: null, max: null, groups: {}, models: {} };

// --- Команда /price ---
check('/price phones 300', applyPriceCommand('/price phones 300', empty).filter.groups, { ph: 300 });
check('/price телефоны 300', applyPriceCommand('/price телефоны 300', empty).filter.groups, { ph: 300 });
check('/price mac 600', applyPriceCommand('/price mac 600', empty).filter.groups, { mac: 600 });
check('/price ipad 400', applyPriceCommand('/price ipad 400', empty).filter.groups, { tab: 400 });
check('/price watch 200', applyPriceCommand('/price watch 200', empty).filter.groups, { aw: 200 });
check('/price mac off', applyPriceCommand('/price mac off', { ...empty, groups: { mac: 600, ph: 300 } }).filter.groups, { ph: 300 });
check('/price ipad air 5 300 — по-прежнему модель', applyPriceCommand('/price ipad air 5 300', empty).filter.models, { 'iPad Air 5': 300 });
check('/price off — снимает и группы', applyPriceCommand('/price off', { ...empty, groups: { ph: 1 } }).filter.groups, {});
check('старый фильтр без groups — работает', applyPriceCommand('/price phones 300', { min: null, max: 500, models: {} }).filter, { min: null, max: 500, models: {}, groups: { ph: 300 } });
check('описание: лимиты групп', /Лимиты групп:\n  • Телефоны — до 300 €/.test(describePriceFilter({ ...empty, groups: { ph: 300 } })), true);

// --- Порядок потолков ---
const pf = { min: null, max: 800, groups: { ph: 300 }, models: { 'iPhone 15 Pro': 550 } };
check('потолок: модель важнее группы', priceCap(pf, 'iPhone 15 Pro', 'ph'), 550);
check('потолок: группа важнее общего', priceCap(pf, 'iPhone 14', 'ph'), 300);
check('потолок: общий', priceCap(pf, 'iPad 10', 'tab'), 800);
check('потолок: нет никакого', priceCap(empty, 'iPad 10', 'tab'), null);

// --- Отсев до и после оценки ---
check('до оценки: 360 € при торге 20 % → 290 ≤ 300 — не отсеивать', priceRejectReason({ price: 360 }, 'iPhone 14', pf, 'ph', 20), null);
check('до оценки: 400 € при торге 20 % → 320 > 300 — отсеять', Boolean(priceRejectReason({ price: 400 }, 'iPhone 14', pf, 'ph', 20)), true);
check('до оценки: без торга 310 > 300 — отсеять', Boolean(priceRejectReason({ price: 310 }, 'iPhone 14', pf, 'ph', 0)), true);
check('до оценки: минимум', Boolean(priceRejectReason({ price: 90 }, 'iPhone 14', { ...pf, min: 100 }, 'ph', 20)), true);
check('до оценки: без цены не отсеивать', priceRejectReason({ price: null }, 'iPhone 14', pf, 'ph', 20), null);
check('после: 🤝 предложение 290 ≤ 300 — оставить', budgetReject({ price: 330 }, { cls: 'haggle', offer: 290 }, 300), null);
check('после: 🤝 предложение 305 > 300 — отсеять', Boolean(budgetReject({ price: 340 }, { cls: 'haggle', offer: 305 }, 300)), true);
check('после: ▫️ low 330 > 300 — отсеять', Boolean(budgetReject({ price: 330 }, { cls: 'low' }, 300)), true);
check('после: ✅ deal 280 — оставить', budgetReject({ price: 280 }, { cls: 'deal' }, 300), null);

// --- runFeed: потолок группы телефонов 500 €, медиана iPhone 14 128 GB — 600 € ---
const NOW = Date.now();
sqlite.prepare("INSERT INTO market VALUES ('iPhone 14', '128 GB', 600, 520, 12, ?)").run(NOW);
sqlite.prepare("INSERT INTO market VALUES ('_meta', '*', 0, 0, 0, ?)").run(NOW);
sqlite.prepare("INSERT INTO settings (key, value) VALUES ('price', ?)").run(JSON.stringify({ groups: { ph: 500 } }));
const F = FEEDS.find((f) => f.id === 'ph-be');
const ad = (num, title, price) =>
  `<article class="aditem" data-adid="${num}" data-href="/s-anzeige/x/${num}"><p>10115 Berlin</p><p>${price} € VB</p><script type="application/ld+json">${JSON.stringify({ title, description: '' })}</script></article>`;
const nums = Array.from({ length: 25 }, (_, i) => 10000 + i);
let pageHtml = `<ul id="srchrslt-adtable">${nums.map((n) => ad(n, 'iPhone 13 128GB', 300)).join('')}</ul>`;
globalThis.fetch = async (url) => {
  if (String(url).includes('kleinanzeigen.de/s-handy')) return { ok: true, status: 200, text: async () => pageHtml };
  throw new Error(`unexpected fetch ${url}`); // режим наблюдения: в Telegram ничего не уходит
};
await runFeed(env, F); // первый запуск — молча
const fresh = { 10100: 450, 10101: 540, 10102: 580, 10103: 600, 10104: 700 };
pageHtml = `<ul id="srchrslt-adtable">${Object.entries(fresh).map(([n, p]) => ad(n, 'iPhone 14 128GB', p)).join('') + nums.map((n) => ad(n, 'iPhone 13 128GB', 300)).join('')}</ul>`;
await runFeed(env, F);
const rows = Object.fromEntries(all("SELECT id, class FROM items WHERE model = 'iPhone 14'").map((r) => [r.id, r.class]));
check('runFeed: 450 € VB — ✅ deal, в бюджете', rows['ka:10100'], 'deal');
check('runFeed: 540 € VB — 🤝 предложите 485 ≤ 500, остаётся', rows['ka:10101'], 'haggle');
check('runFeed: 580 € VB — после торга цели нет, дороже 500 — отсеян', rows['ka:10102'], undefined);
check('runFeed: 600 € — дороже 500, не 🤝 — отсеян', rows['ka:10103'], undefined);
check('runFeed: 700 € — даже −20 % > 500 — отсеян до оценки', rows['ka:10104'], undefined);
check('runFeed: цены всех — в prices (медиана не искажается)', all("SELECT COUNT(*) AS n FROM prices WHERE model = 'iPhone 14'")[0].n, 5);
check('runFeed: «прислал бы» = 2', all("SELECT sent FROM stats WHERE city = 'ph-be'")[0].sent, 2);

// --- Пометка в сообщении ---
const ev = { cls: 'haggle', offer: 485, percent: 10, reasons: ['VB'], marginEur: 115, marginPct: 23.7 };
const insight = (cap) => ({ warnings: [], tags: [], ev, cap, market: null, margin: null });
const item = { price: 540, negotiable: true, title: 'iPhone 14', location: 'Berlin' };
const rec = { model: 'iPhone 14', variant: '128 GB' };
check('сообщение: «в бюджет только после торга»', formatItem(item, F, rec, null, insight(500)).includes('💶 В бюджет 500 € — только после торга'), true);
check('сообщение: без потолка — без пометки', formatItem(item, F, rec, null, insight(null)).includes('💶'), false);

// --- /found: потолок по цене предложения ---
const DAY = 86400000;
const add = (id, city, model, cur, offer) =>
  sqlite.prepare("INSERT INTO items (id, city, model, storage, price, cur_price, url, sent_at, checked_at, gone, s_offer, s_pct) VALUES (?, ?, ?, '128 GB', ?, ?, 'u', ?, ?, 0, ?, 25)")
    .run(id, city, model, cur, cur, NOW - 8 * DAY, NOW - 1000, offer);
add('s:1', 'ph-be', 'iPhone 13', 340, 290); // предложение 290 — в бюджете 300
add('s:2', 'ph-hh', 'iPhone 13', 400, 340); // 340 > 300
add('s:3', 'mac-be', 'MacBook Air 13" M2 8GB', 650, 560); // группа mac 600
add('s:4', 'ph-mv', 'iPhone 15 Pro', 640, 540); // модель 550
add('s:5', 'aw-be', 'Apple Watch Series 9 45mm', 260, 220); // без лимита группы, общий нет
const found = (price, f = DEFAULT_FILTER) => { const q = foundQuery(f, NOW, price); return all(q.sql, ...q.args).map((r) => r.id).filter((id) => id.startsWith('s:')).sort(); };
check('/found: без потолка — все 5', found({}), ['s:1', 's:2', 's:3', 's:4', 's:5']);
check('/found: телефоны 300, mac 600, 15 Pro 550', found({ groups: { ph: 300, mac: 600 }, models: { 'iPhone 15 Pro': 550 } }), ['s:1', 's:3', 's:4', 's:5']);
check('/found: общий 250 — только часы 220', found({ max: 250 }), ['s:5']);
check('/found: модель важнее группы (15 Pro 500 < 540)', found({ groups: { ph: 1000 }, models: { 'iPhone 15 Pro': 500 } }), ['s:1', 's:2', 's:3', 's:5']);
const plan = (() => { const q = foundQuery(DEFAULT_FILTER, NOW, { max: 300, groups: { ph: 300 } }); return all(`EXPLAIN QUERY PLAN ${q.sql}`, ...q.args).map((r) => r.detail).join(' | '); })();
check('/found: план — по индексу items_checked', /items_checked/.test(plan), true);

console.log(failed ? `\nFAIL: ${failed}` : '\nALL PASS');
process.exit(failed ? 1 : 0);
