// Региональные ленты: 3 региона × 4 группы = 12 лент Kleinanzeigen (частные продавцы, продажа, от 150 €, сначала новые).
// Один запуск — одна страница одной ленты. Вместо таблиц seen у каждой ленты одна строка в `feeds`:
// порог (floor) и последние ~40 номеров объявлений выше порога (recent).
//
// Почему не один «последний номер»: объявления в ленте идут по времени публикации, а не по номеру.
// Часть публикуется с задержкой (номер меньше, чем у соседей) — с одним номером такие терялись бы.
// Закреплённые сверху и поднятые старые объявления имеют номер ниже порога и не считаются новыми.

import { fetchFeed, parseArticle } from './kleinanzeigen.js';
import { recognize, batteryOf, tagsOf } from './filters.js';
import { getPriceFilter, priceRejectReason, priceCap, budgetReject, getMode, getSelect } from './settings.js';
import { eurRate, getSellTable, marginOf, recordPrice, marketMedian, scamAndDeal } from './market.js';
import { evaluate, SEND_CLASSES } from './select.js';
import { staleCandidateAt } from './stale.js';
import { sendText, sendItem, escapeHtml } from './telegram.js';

export const REGIONS = [
  { key: 'be', slug: 'berlin', loc: 'l3331', name: 'Berlin' },
  { key: 'hh', slug: 'hamburg', loc: 'l9409', name: 'Hamburg' },
  { key: 'mv', slug: 'mecklenburg-vorpommern', loc: 'l61', name: 'MV' },
];

// query — поисковое слово: без него в ноутбуках и носимой электронике почти всё чужое.
export const GROUPS = [
  { key: 'ph', name: 'Телефоны', icon: '📱', path: 's-handy-telekom', cat: 173, query: '' },
  { key: 'tab', name: 'Планшеты', icon: '📲', path: 's-tablets-reader', cat: 285, query: '' },
  { key: 'mac', name: 'MacBook', icon: '💻', path: 's-notebooks', cat: 278, query: 'macbook' },
  { key: 'aw', name: 'Apple Watch', icon: '⌚', path: 's-wearables', cat: 405, query: 'apple-watch' },
];

export const FEEDS = GROUPS.flatMap((group) =>
  REGIONS.map((region) => ({ id: `${group.key}-${region.key}`, name: `${group.name} · ${region.name}`, group, region })),
);

// Расписание. Телефоны — ~90 % всех объявлений (Берлин — до 21 в час), остальное приходит редко.
export const CRON_FAST = '* * * * *'; // 3 ленты телефонов по кругу: каждая раз в 3 минуты
export const CRON_SLOW = '*/2 * * * *'; // 9 остальных лент по кругу: каждая раз в 18 минут
const FAST = FEEDS.filter((f) => f.group.key === 'ph');
const SLOW = FEEDS.filter((f) => f.group.key !== 'ph');

/** Какую ленту проверять в этот запуск. */
export function feedFor(cron, date) {
  const minute = Math.floor(date.getTime() / 60000);
  return cron === CRON_SLOW ? SLOW[Math.floor(minute / 2) % SLOW.length] : FAST[minute % FAST.length];
}

export function frequencyOf(feed) {
  return feed.group.key === 'ph' ? 'раз в 3 мин' : 'раз в 18 мин';
}

// --- Состояние ленты: какие номера новые (чистые функции, тест — scripts/test_feeds.js) ---

const RECENT_KEEP = 40; // столько последних номеров помним между проверками (страница — 25–27)
const RECENT_MAX = 200; // во время дочитывания страниц порог заморожен, список растёт
const INIT_RANK = 20; // первый запуск: порог — 20-й по величине номер страницы (ниже — закреплённые и старые)
const MAX_PAGES = 5; // дочитываем не дальше 5-й страницы
const OVERFLOW_FIRST = 20; // на первой странице столько новых — значит, вышло больше страницы
const OVERFLOW_NEXT = 10; // на следующих страницах: пока новых хотя бы столько, идём дальше

const desc = (a, b) => b - a;

/** Первый запуск ленты: запоминаем страницу молча. */
export function initState(state, nums) {
  const sorted = [...new Set(nums)].sort(desc);
  const floor = sorted.length >= INIT_RANK ? sorted[INIT_RANK - 1] : 0;
  return { ...state, initialized: 1, page: 1, pending: 0, floor, recent: sorted.filter((n) => n > floor) };
}

/** Новые номера страницы, от старых к новым. */
export function pickNew(state, nums) {
  const known = new Set(state.recent);
  return [...new Set(nums)].filter((n) => n > state.floor && !known.has(n)).sort((a, b) => a - b);
}

/**
 * Состояние после проверки. unseen — число новых на странице, done — обработанные номера.
 * Необработанные (лимит за запуск, сбой отправки) не запоминаются и придут в следующий раз.
 */
export function nextState(state, unseen, done) {
  let recent = [...state.recent, ...done].sort(desc);
  let { floor, page } = state;
  // pending: страница была переполнена, но обработана не вся (лимит за запуск) — помним, что после неё нужна следующая.
  const more = Boolean(state.pending) || unseen >= (page === 1 ? OVERFLOW_FIRST : OVERFLOW_NEXT);
  let pending = 0;
  if (done.length < unseen) {
    pending = more ? 1 : 0; // остаёмся на этой же странице
  } else if (more && page < MAX_PAGES) {
    page += 1; // за интервал вышло больше страницы — дочитываем следующую
  } else {
    page = 1;
  }
  if (page === 1) {
    if (recent.length > RECENT_KEEP) floor = Math.max(floor, recent[RECENT_KEEP]);
    recent = recent.filter((n) => n > floor);
  } else {
    recent = recent.slice(0, RECENT_MAX);
  }
  return { ...state, floor, page, pending, recent };
}

// --- D1 ---

const EMPTY = { floor: 0, recent: [], page: 1, pending: 0, initialized: 0, last_ok: null, fail_count: 0, last_error: null, alerted: 0, muted: 0 };

export async function getFeedState(env, feed) {
  const row = await env.DB.prepare('SELECT * FROM feeds WHERE feed = ?').bind(feed.id).first();
  return row ? { ...row, recent: JSON.parse(row.recent) } : { feed: feed.id, ...EMPTY };
}

// muted здесь не трогаем: его меняет только кнопка в /feeds.
function saveState(env, s) {
  return env.DB.prepare(
    `INSERT INTO feeds (feed, floor, recent, page, pending, initialized, last_ok, fail_count, last_error, alerted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(feed) DO UPDATE SET floor = excluded.floor, recent = excluded.recent, page = excluded.page, pending = excluded.pending,
       initialized = excluded.initialized, last_ok = excluded.last_ok, fail_count = excluded.fail_count,
       last_error = excluded.last_error, alerted = excluded.alerted`,
  ).bind(s.feed, s.floor, JSON.stringify(s.recent), s.page, s.pending, s.initialized, s.last_ok, s.fail_count, s.last_error, s.alerted);
}

export function berlinDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function statsUpsert(env, feed, { errors = 0, sent = 0 }) {
  return env.DB.prepare(
    `INSERT INTO stats (day, city, checks, errors, sent) VALUES (?, ?, 1, ?, ?)
     ON CONFLICT(day, city) DO UPDATE SET checks = checks + 1, errors = errors + excluded.errors, sent = sent + excluded.sent`,
  ).bind(berlinDay(), feed.id, errors, sent);
}

// --- Оценка и сообщение ---

// Класс объявления (items.class) и расчёт маржи — src/select.js (evaluate). Присылаются только deal и haggle.

// Ночью (22:00–08:00 по Берлину) объявления приходят без звука.
const HOUR_FORMAT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false });
export function isNight(now = Date.now()) {
  const hour = Number(HOUR_FORMAT.format(new Date(now))) % 24;
  return hour >= 22 || hour < 8;
}

function placeOf(item, feed) {
  return (item.location || '').replace(/^\d{5}\s*/, '').trim() || feed.region.name;
}

export function bahnUrl(place) {
  return `https://www.bahn.de/buchung/fahrplan/suche#sts=true&so=Rostock%20Hbf&zo=${encodeURIComponent(place)}`;
}

/** Кнопки под объявлением. */
export function itemKeyboard(item, feed) {
  return {
    inline_keyboard: [
      [{ text: '✍️ Написать продавцу', callback_data: `lt:${item.id}` }],
      [{ text: '🔗 Открыть', url: item.url }, { text: '🚆 Дорога', url: bahnUrl(placeOf(item, feed)) }],
    ],
  };
}

export function formatItem(item, feed, rec, battery, insight) {
  const head = [rec.model, rec.variant, item.price != null ? `${item.price} €${item.negotiable ? ' VB' : ''}` : 'цена не указана']
    .filter(Boolean)
    .join(' · ');
  const lines = [];
  if (insight.warnings.length) lines.push('🚨 <b>ОСТОРОЖНО: возможен обман</b>');
  const ev = insight.ev;
  if (ev.cls === 'deal') lines.push(`✅ <b>Уже выгодно: маржа +${ev.marginPct}% (+${ev.marginEur} €)</b>`);
  if (ev.cls === 'haggle') {
    lines.push(
      `🤝 <b>Выгодно после торга: предложите ${ev.offer} €</b>`,
      `при ${ev.offer} € маржа +${ev.marginPct}% (+${ev.marginEur} €) · запас торга ~${ev.percent}% (${escapeHtml(ev.reasons.join(', '))})`,
    );
    if (insight.cap != null && item.price > insight.cap) lines.push(`💶 В бюджет ${insight.cap} € — только после торга`);
  }
  lines.push(`${feed.group.icon} <b>${escapeHtml(head)}</b>`, escapeHtml(item.title), `📍 ${escapeHtml(item.location || feed.region.name)} · ${escapeHtml(feed.name)}`);
  if (battery) lines.push(`🔋 Akku ${battery}%`);
  if (insight.margin) {
    const m = insight.margin;
    lines.push(
      `${m.marginEur >= 0 ? '📈' : '📉'} По /sell: ≈ ${m.marginEur} € (продажа ${m.sellUah.toLocaleString('ru-RU')} ₴ ≈ ${m.sellEur} € − покупка ${item.price} €)`,
    );
  }
  if (insight.market) {
    const d = insight.dealPercent;
    const rel = d > 0 ? `на ${d}% дешевле` : d < 0 ? `на ${-d}% дороже` : 'как';
    lines.push(`💰 ${rel} обычной цены (медиана ${insight.market.median} € по ${insight.market.count} объявл.)`);
  }
  for (const w of insight.warnings) lines.push(`🚨 ${escapeHtml(w)}`);
  for (const tag of insight.tags) lines.push(escapeHtml(tag));
  return lines.join('\n');
}

// --- Проверка ленты ---

// Лимиты бесплатного тарифа: 50 подзапросов и 50 запросов D1 на запуск. На объявление — до 2 вызовов Telegram,
// чтение медианы и 2 записи; обычно новых 0–2, лимит нужен только после простоя (остальные — в следующий запуск).
const MAX_SEND_PER_RUN = 6;
const MAX_WATCH_PER_RUN = 12;

export async function runFeed(env, feed) {
  const state = await getFeedState(env, feed);
  if (state.muted) return { feed: feed.id, muted: true };
  const now = Date.now();

  let articles;
  try {
    articles = await fetchFeed(feed, state.page);
  } catch (e) {
    state.fail_count += 1;
    state.last_error = String(e.message || e);
    if (state.fail_count >= 2 && !state.alerted) {
      await sendText(env, `⚠️ <b>${escapeHtml(feed.name)}: сбой проверки</b>\n${escapeHtml(state.last_error)}\nОстальные ленты проверяются как обычно.`, {
        disable_notification: true,
      }).catch(() => {});
      state.alerted = 1;
    }
    await env.DB.batch([saveState(env, state), statsUpsert(env, feed, { errors: 1 })]);
    return { feed: feed.id, error: state.last_error };
  }

  if (state.alerted) await sendText(env, `✅ <b>${escapeHtml(feed.name)} снова проверяется.</b>`, { disable_notification: true }).catch(() => {});
  Object.assign(state, { fail_count: 0, alerted: 0, last_error: null, last_ok: now });
  const nums = articles.map((a) => a.num);

  // Первая проверка ленты: запоминаем текущие объявления молча — присылаем только новые.
  if (!state.initialized) {
    await env.DB.batch([saveState(env, initState(state, nums)), statsUpsert(env, feed, {})]);
    return { feed: feed.id, initialized: true, items: articles.length };
  }

  const unseen = pickNew(state, nums);
  const writes = [];
  const done = [];
  let sent = 0;
  let matched = 0;
  if (unseen.length) {
    const byNum = new Map(articles.map((a) => [a.num, a]));
    const [mode, priceFilter, sel] = await Promise.all([getMode(env), getPriceFilter(env), getSelect(env)]);
    const send = mode === 'send';
    const [sellTable, rate] = send ? await Promise.all([getSellTable(env), eurRate(env)]) : [{}, null];
    const silent = isNight(now);

    // Полностью разбираем только новые объявления — это экономит большую часть процессорного времени.
    for (const num of unseen.slice(0, send ? MAX_SEND_PER_RUN : MAX_WATCH_PER_RUN)) {
      const item = parseArticle(byNum.get(num));
      const rec = recognize(item.title, item.description);
      if (!rec) {
        done.push(num); // модель не распознана — не присылаем
        continue;
      }
      // Цены всех распознанных — в статистику рынка (даже если по фильтру цены не пришлём).
      const priceWrite = recordPrice(env, item, rec.model, rec.variant, now);
      if (priceWrite) writes.push(priceWrite);
      if (priceRejectReason(item, rec.model, priceFilter, feed.group.key, sel.haggle)) {
        done.push(num);
        continue;
      }
      const battery = batteryOf(`${item.title} ${item.description}`);
      const market = await marketMedian(env, rec.model, rec.variant);
      const { warnings, dealPercent } = scamAndDeal(item, market);
      const tags = tagsOf(item, rec);
      const ev = evaluate(item, market, tags, warnings, sel, now);
      // Потолок /price — по цене, которую реально заплатить (для 🤝 — по предложению после торга).
      const cap = priceCap(priceFilter, rec.model, feed.group.key);
      if (budgetReject(item, ev, cap)) {
        done.push(num);
        continue;
      }
      const wanted = SEND_CLASSES.includes(ev.cls); // ✅ уже выгодно или 🤝 выгодно после торга
      let msgId = null;
      if (send && wanted) {
        const margin = marginOf(item, rec.model, rec.variant, sellTable, rate);
        try {
          // Днём со звуком, ночью без.
          const res = await sendItem(env, formatItem(item, feed, rec, battery, { market, margin, warnings, dealPercent, ev, tags, cap }), item.image, itemKeyboard(item, feed), silent);
          msgId = res?.result?.message_id ?? null;
          sent += 1;
        } catch (e) {
          console.error('send failed', item.id, e); // номер не запоминаем — попробуем в следующий раз
          continue;
        }
      }
      done.push(num);
      if (wanted) matched += 1;
      // items: все оценённые объявления с классом; msg_id — только у присланных.
      writes.push(
        env.DB.prepare(
          `INSERT OR REPLACE INTO items (id, city, model, storage, battery, price, negotiable, title, location, url, sent_at, msg_id, class, next_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(item.id, feed.id, rec.model, rec.variant, battery, item.price, item.negotiable ? 1 : 0, item.title.slice(0, 200), item.location, item.url, now, msgId, ev.cls, staleCandidateAt(item, market, ev.cls, sel, now)),
      );
    }
  }

  const next = nextState(state, unseen.length, done);
  // «Прислано» — число ✅ и 🤝; в режиме наблюдения — сколько прислали бы.
  writes.push(saveState(env, next), statsUpsert(env, feed, { sent: matched }));
  await env.DB.batch(writes);
  return { feed: feed.id, page: state.page, items: articles.length, unseen: unseen.length, matched, sent, nextPage: next.page };
}
