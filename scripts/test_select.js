// Локальная проверка отбора (src/select.js): запас торга по сигналам, классы deal / haggle / low / high / nomed / flag,
// разбор даты и зачёркнутой цены из карточки, команды /target /haggle /minprofit.
import { ageDays, haggleOf, evaluate, parseSelectArg, DEFAULT_SELECT } from '../src/select.js';
import { parseArticle } from '../src/kleinanzeigen.js';
import { isNight } from '../src/feeds.js';
import { sellerMessages } from '../src/messages.js';

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `: получено ${JSON.stringify(got)}, ожидалось ${JSON.stringify(want)}`}`);
};

const NOW = Date.UTC(2026, 10, 15, 12);
const it = (o) => ({ title: 'iPhone 15 Pro 256GB', description: '', price: 500, negotiable: false, posted: 'Heute, 11:50', oldPrice: null, ...o });

// --- Возраст объявления ---
check('возраст: сегодня', ageDays('Heute, 11:50', NOW), 0);
check('возраст: вчера', ageDays('Gestern, 09:15', NOW), 1);
check('возраст: дата', ageDays('05.11.2026', NOW), 10);
check('возраст: неизвестно', ageDays(null, NOW), null);

// --- Запас торга ---
check('торг: без сигналов — 0', haggleOf(it({}), NOW).percent, 0);
check('торг: VB — 10', haggleOf(it({ negotiable: true }), NOW), { percent: 10, reasons: ['VB'] });
check('торг: VB + срочно — 15', haggleOf(it({ negotiable: true, description: 'Muss weg wegen Umzug' }), NOW).percent, 15);
check('торг: VB + срочно + цена снижена — 20', haggleOf(it({ negotiable: true, title: 'iPhone dringend', oldPrice: 560 }), NOW).percent, 20);
check('торг: VB + висит давно — 15', haggleOf(it({ negotiable: true, posted: '01.11.2026' }), NOW), { percent: 15, reasons: ['VB', 'висит давно'] });
check('торг: снижена и давно — одна прибавка', haggleOf(it({ oldPrice: 560, posted: '01.11.2026' }), NOW).percent, 5);
check('торг: неделя — ещё не «давно»', haggleOf(it({ posted: '08.11.2026' }), NOW).percent, 0);
check('торг: Festpreis — 0 при любых сигналах', haggleOf(it({ negotiable: true, description: 'Festpreis, muss weg' }), NOW), { percent: 0, reasons: ['Festpreis'] });
check('торг: keine Verhandlung — 0', haggleOf(it({ negotiable: true, description: 'Keine Verhandlung!' }), NOW).percent, 0);
check('торг: «kein Festpreis» — не запрет', haggleOf(it({ negotiable: true, description: 'kein Festpreis' }), NOW).percent, 10);

// --- Классы ---
const m = { median: 600, count: 9 };
const ev = (o, market = m, tags = [], warnings = [], sel = DEFAULT_SELECT) => evaluate(it(o), market, tags, warnings, sel, NOW);
check('deal: маржа ровно 20 %', ev({ price: 500 }), { cls: 'deal', marginEur: 100, marginPct: 20 });
check('low: 19,8 % без торга', ev({ price: 501 }).cls, 'low');
check('haggle: 550 € VB → 495 €, маржа 21,2 %', ev({ price: 550, negotiable: true }), { cls: 'haggle', offer: 495, percent: 10, reasons: ['VB'], marginEur: 105, marginPct: 21.2 });
check('low: 560 € VB — после −10 % цели нет', ev({ price: 560, negotiable: true }).cls, 'low');
check('haggle: 560 € VB + срочно → 475 €', ev({ price: 560, negotiable: true, description: 'muss weg' }).offer, 475);
check('high: выше медианы без торга', ev({ price: 650 }).cls, 'high');
check('high: Festpreis выше медианы', ev({ price: 650, negotiable: true, description: 'Festpreis' }).cls, 'high');
check('nomed: нет медианы', ev({ price: 500 }, null).cls, 'nomed');
check('nomed: нет цены', ev({ price: null }).cls, 'nomed');
check('flag: дефект', ev({ price: 300 }, m, ['🔧 возможно дефект («defekt»)']).cls, 'flag');
check('flag: аксессуар', ev({ price: 300 }, m, ['🧩 возможно аксессуар']).cls, 'flag');
check('flag: признак обмана', ev({ price: 300 }, m, [], ['цена вдвое ниже рынка']).cls, 'flag');
check('обмен — не отсеивается', ev({ price: 500 }, m, ['🔁 обмен']).cls, 'deal');

// --- Настройки ---
check('/target 30: 500 € уже не deal', ev({ price: 500 }, m, [], [], { ...DEFAULT_SELECT, target: 30 }).cls, 'low');
check('/haggle 5: запас ограничен', ev({ price: 550, negotiable: true }, m, [], [], { ...DEFAULT_SELECT, haggle: 5 }).cls, 'low');
check('/haggle 0: торг выключен', ev({ price: 550, negotiable: true }, m, [], [], { ...DEFAULT_SELECT, haggle: 0 }).cls, 'low');
check('/minprofit 150: 100 € мало', ev({ price: 500 }, m, [], [], { ...DEFAULT_SELECT, minprofit: 150 }).cls, 'low');
check('/minprofit 100: хватает', ev({ price: 500 }, m, [], [], { ...DEFAULT_SELECT, minprofit: 100 }).cls, 'deal');

// --- Команды ---
check('/target', parseSelectArg('target', '/target'), { show: true });
check('/target 25', parseSelectArg('target', '/target 25'), { value: 25 });
check('/target 0 — ошибка', Boolean(parseSelectArg('target', '/target 0').error), true);
check('/haggle 15', parseSelectArg('haggle', '/haggle 15'), { value: 15 });
check('/haggle 30 — ошибка', Boolean(parseSelectArg('haggle', '/haggle 30').error), true);
check('/minprofit 50', parseSelectArg('minprofit', '/minprofit@bot 50'), { value: 50 });
check('/minprofit off', parseSelectArg('minprofit', '/minprofit off'), { value: null });
check('/target abc — ошибка', Boolean(parseSelectArg('target', '/target abc').error), true);

// --- Карточка: дата и зачёркнутая цена (разметка с живой страницы 15.11.2026) ---
const card = (inner) =>
  parseArticle({
    id: 'ka:1',
    raw: `<article data-adid="1" data-href="/s-anzeige/x/1"><span>10115 Berlin</span>${inner}<script type="application/ld+json">{"title":"Iphone 12 pro","description":""}</script>`,
  });
const reduced = card('<span>Gestern, 09:15</span><p class="my-xsmall text-title3 font-strong text-secondary">250 € VB</p><p class="m-xsmall text-title3 text-onSurfaceNonessential line-through">290 €</p>');
check('карточка: цена, VB, прежняя цена, дата', [reduced.price, reduced.negotiable, reduced.oldPrice, reduced.posted], [250, true, 290, 'Gestern, 09:15']);
const plain = card('<span>Heute, 11:50</span><p>1.250 €</p>');
check('карточка: без снижения', [plain.price, plain.negotiable, plain.oldPrice, plain.posted], [1250, false, null, 'Heute, 11:50']);
check('карточка: дата числом', card('<span>05.11.2026</span><p>300 €</p>').posted, '05.11.2026');

// --- Звук ---
check('ночь: 23:00 по Берлину', isNight(Date.UTC(2026, 10, 15, 22)), true);
check('ночь: 07:59', isNight(Date.UTC(2026, 10, 15, 6, 59)), true);
check('день: 08:00', isNight(Date.UTC(2026, 10, 15, 7)), false);
check('день: 21:59', isNight(Date.UTC(2026, 10, 15, 20, 59)), false);

// --- Текст продавцу: та же цена, что в карточке; без вопроса про iCloud ---
{
  const median = { median: 400 };
  const ev = evaluate(it({ price: 400, negotiable: true, description: 'muss weg', oldPrice: 450 }), median, [], [], { target: 20, haggle: 20, minprofit: null }, NOW);
  check('карточка: 400 € VB + срочность + снижение → 🤝 320 €', [ev.cls, ev.offer], ['haggle', 320]);
  const row = { model: 'iPhone 16 Pro', storage: '256 GB', price: 400, cur_price: null, s_offer: ev.offer, battery: null };
  const m = sellerMessages(row, 'Völschow');
  check('текст продавцу: цена из карточки', [m.offer, m.fromCard], [320, true]);
  check('текст: ещё доступен', m.de,
    'Hallo,\n\nich interessiere mich für Ihr iPhone 16 Pro 256 GB. Ist es noch verfügbar?\n\nIch könnte es zeitnah in Völschow persönlich abholen und bar bezahlen.\n\nViele Grüße\n\nMaksym');
  check('текст: с предложением цены', m.deOffer,
    'Hallo,\n\nich interessiere mich für Ihr iPhone 16 Pro 256 GB. Ist es noch verfügbar?\nWären Sie mit 320 € einverstanden?\n\nIch könnte es zeitnah in Völschow persönlich abholen und bar bezahlen.\n\nViele Grüße\n\nMaksym');
  check('текст: без iCloud и аккумулятора', /iCloud|Akku/.test(m.de + m.deOffer), false);
  check('давно висят: s_offer после перепроверки', sellerMessages({ ...row, price: 500, cur_price: 450, s_offer: 360 }, 'X').offer, 360);
  check('без предложения в карточке → −10 %', [sellerMessages({ ...row, s_offer: null }, 'X').offer, sellerMessages({ ...row, s_offer: null }, 'X').fromCard], [360, false]);
}

console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
process.exit(failed ? 1 : 0);
