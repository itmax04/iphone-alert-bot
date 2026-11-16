// Этап 5: «давно висящие». Объявления, которые ленты уже видели, перепроверяются ночью на 7-й, 10-й и 14-й день
// (одна страница объявления за запуск), в 21:00 уходит сообщение «🕰 Давно висят».
//   кандидат   — items.next_at (ставит runFeed при записи, staleCandidateAt);
//   перепроверка — recheckOne: живо ли, цена, снижалась ли, «предложите X €» (staleOffer);
//   отчёт      — staleReport: цифры и топ-10 по марже; объявление в топе один раз, снова — только после нового снижения цены.
// Чистые функции — тест scripts/test_stale.js.

import { parseNumber } from './kleinanzeigen.js';
import { FIXED_RE, round5, DEFAULT_SELECT } from './select.js';
import { marketMedian } from './market.js';
import { getSelect } from './settings.js';
import { sendText, escapeHtml } from './telegram.js';

const DAY = 24 * 3600 * 1000;
export const CHECK_DAYS = [7, 10, 14]; // возраст объявления при 1-й, 2-й и 3-й перепроверке
const EXPIRE_DAYS = 15; // кандидат старше этого без проверки гасится (ночная чистка)
export const MAX_ROOM = 30; // максимальный запас торга, %
const DROP_BONUS = 5; // +5 %, если цена уже снижена
const TOP_SIZE = 10;
const RETRY_MS = 3 * 3600 * 1000; // сбой загрузки страницы — вернёмся к объявлению позже
const NIGHT_FROM = 1; // ночное окно перепроверок (Берлин): 01:00–06:00
const NIGHT_TO = 6;
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// --- Чистые функции ---

/** Запас торга по возрасту, %: 7–9 дней — 15, 10–13 — 20, 14+ — 25; +5 за снижение цены; Festpreis — 0; не больше 30. */
export function staleRoom(days, dropped, fixed) {
  if (fixed) return 0;
  const base = days >= 14 ? 25 : days >= 10 ? 20 : 15;
  return Math.min(MAX_ROOM, base + (dropped ? DROP_BONUS : 0));
}

/**
 * Подходит ли объявление после торга: { offer, pct, eur, room } или null.
 * Маржа = медиана − предложение, в % от предложения; нужна ≥ target (и ≥ minprofit €, если задан).
 */
export function staleOffer({ price, median, days, dropped, fixed }, sel = DEFAULT_SELECT) {
  if (!median || price == null || price <= 0) return null;
  const room = staleRoom(days, dropped, fixed);
  const offer = room > 0 ? round5(price * (1 - room / 100)) : price;
  if (offer <= 0 || offer > price) return null;
  const pct = ((median - offer) / offer) * 100;
  if (pct < sel.target || (sel.minprofit != null && median - offer < sel.minprofit)) return null;
  return { offer, pct: Math.round(pct * 10) / 10, eur: Math.round(median - offer), room };
}

/** Когда перепроверять новое объявление впервые: через 7 дней — если даже при максимальном торге цель достижима. */
export function staleCandidateAt(item, market, cls, sel, now) {
  if (cls === 'flag' || cls === 'nomed' || !market || item.price == null || item.price <= 0) return null;
  const best = round5(item.price * (1 - MAX_ROOM / 100));
  if (best <= 0 || ((market.median - best) / best) * 100 < sel.target) return null;
  return now + CHECK_DAYS[0] * DAY;
}

/** Когда следующая проверка после n-й (n — сколько уже проведено); null — проверки закончены. */
export function nextCheckAt(sentAt, n, now) {
  if (n >= CHECK_DAYS.length) return null;
  return Math.max(sentAt + CHECK_DAYS[n] * DAY, now + DAY);
}

const HOUR_FORMAT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false });
/**
 * Ночью (01:00–06:00 Берлин) каждый второй запуск каждого расписания — перепроверка вместо ленты.
 * Быстрое расписание (раз в минуту): нечётные минуты; медленное (раз в 2 минуты): нечётные номера запусков.
 * Ленты при этом по-прежнему обходятся все (нечётное число лент — каждая лента рано или поздно попадает в чётный слот).
 */
export function isRecheckSlot(slow, date) {
  const hour = Number(HOUR_FORMAT.format(date)) % 24;
  if (hour < NIGHT_FROM || hour >= NIGHT_TO) return false;
  const minute = Math.floor(date.getTime() / 60000);
  return (slow ? Math.floor(minute / 2) : minute) % 2 === 1;
}

/** Разбор страницы объявления: цена (null — не указана), VB, Festpreis в описании. null — это не страница объявления. */
export function parseListing(html) {
  if (!html.includes('viewad-main')) return null;
  const at = html.indexOf('id="viewad-price">');
  const priceText = at === -1 ? '' : html.slice(at, at + 160).replace(/&nbsp;|\s+/g, ' ');
  const m = priceText.match(/>\s*([\d.,]+)\s*€/);
  const d = html.indexOf('id="viewad-description-text"');
  const desc = d === -1 ? '' : html.slice(d, d + 8000);
  return { price: m ? parseNumber(m[1]) : null, negotiable: /VB/.test(priceText), fixed: FIXED_RE.test(desc) };
}

// --- Перепроверка (ночью, один запуск — одна страница объявления) ---

/**
 * Открывает самое «просроченное» объявление очереди. Возвращает { id, outcome } или null, если очередь пуста.
 * outcome: gone | live | error. 4 запроса D1: очередь, медиана, настройки, запись.
 */
export async function recheckOne(env, now = Date.now()) {
  const row = await env.DB.prepare(
    `SELECT id, url, price, model, storage, sent_at, check_n, negotiable FROM items
     WHERE next_at IS NOT NULL AND next_at <= ? ORDER BY next_at LIMIT 1`,
  )
    .bind(now)
    .first();
  if (!row) return null;
  const update = (sets, ...args) => env.DB.prepare(`UPDATE items SET ${sets} WHERE id = ?`).bind(...args, row.id).run();

  let r;
  try {
    r = await fetch(row.url, { headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'de-DE,de;q=0.9' }, redirect: 'manual' });
  } catch (e) {
    await update('next_at = ?', now + RETRY_MS);
    return { id: row.id, outcome: 'error' };
  }
  const n = row.check_n + 1;
  if ([301, 302, 404, 410].includes(r.status)) {
    // Снятое объявление Kleinanzeigen перенаправляет на категорию (301) или отвечает 404/410.
    await update('gone = 1, checked_at = ?, check_n = ?, next_at = NULL, s_offer = NULL, s_pct = NULL', now, n);
    return { id: row.id, outcome: 'gone' };
  }
  const listing = r.status === 200 ? parseListing(await r.text()) : null;
  if (!listing) {
    await update('next_at = ?', now + RETRY_MS); // 403/5xx или страница не похожа на объявление — не считаем проверкой
    return { id: row.id, outcome: 'error', status: r.status };
  }

  const [market, sel] = await Promise.all([marketMedian(env, row.model, row.storage), getSelect(env)]);
  const price = listing.price;
  const days = Math.floor((now - row.sent_at) / DAY);
  const dropped = price != null && row.price != null && price < row.price;
  const res = staleOffer({ price, median: market?.median, days, dropped, fixed: listing.fixed }, sel);
  await update(
    'cur_price = ?, checked_at = ?, check_n = ?, gone = 0, next_at = ?, s_offer = ?, s_pct = ?',
    price,
    now,
    n,
    nextCheckAt(row.sent_at, n, now),
    res?.offer ?? null,
    res?.pct ?? null,
  );
  return { id: row.id, outcome: 'live', price, dropped, match: Boolean(res) };
}

// --- Сообщение «🕰 Давно висят» (21:00) ---

const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many);

/** Цифры и топ из строк items, перепроверенных за сутки. */
export function buildReport(rows, now = Date.now()) {
  const gone = rows.filter((r) => r.gone).length;
  const fresh = rows
    .filter((r) => !r.gone && r.s_offer != null && (r.top_price == null || (r.cur_price != null && r.cur_price < r.top_price)))
    .sort((a, b) => b.s_pct - a.s_pct);
  const top = fresh.slice(0, TOP_SIZE);
  const lines = [
    '🕰 <b>Давно висят</b>',
    `Перепроверено: ${rows.length} · продано или снято: ${gone} · подходит: ${fresh.length}`,
  ];
  top.forEach((r, i) => {
    const days = Math.floor((now - r.sent_at) / DAY);
    const dropped = r.cur_price != null && r.price != null && r.cur_price < r.price;
    const head = [r.model, r.storage].filter(Boolean).join(' · ');
    const price = r.cur_price === r.s_offer ? `${r.cur_price} €` : `${r.cur_price} €${r.negotiable ? ' VB' : ''}`;
    lines.push(
      '',
      `${i + 1}. <b>${escapeHtml(head)}</b> — ${price}`,
      `   предложите <b>${r.s_offer} €</b> → <b>+${r.s_pct}%</b> · висит ${days} ${plural(days, 'день', 'дня', 'дней')}` +
        (dropped ? ` · ⬇️ цена снижена (было ${r.price} €)` : ''),
      `   📍 ${escapeHtml((r.location || '').replace(/^\d{5}\s*/, ''))}`,
    );
  });
  if (fresh.length > top.length) lines.push('', `…и ещё ${fresh.length - top.length} подходящих не вошли в топ-${TOP_SIZE}.`);
  const keyboard = top.map((r, i) => [
    { text: `✍️ ${i + 1}. Написать продавцу`, callback_data: `lt:${r.id}` },
    { text: `🔗 ${i + 1}`, url: r.url },
  ]);
  return { text: lines.join('\n'), keyboard, top };
}

/** Отправляет отчёт и помечает показанные (top_price). Пока перепроверок не было (до ~22.11) — молчит. */
export async function staleReport(env, now = Date.now()) {
  const { results } = await env.DB.prepare(
    `SELECT id, url, model, storage, location, negotiable, price, cur_price, sent_at, gone, top_price, s_offer, s_pct
     FROM items WHERE checked_at IS NOT NULL AND checked_at > ?`,
  )
    .bind(now - DAY)
    .all();
  if (!results.length) return { sent: false, rows: 0 };
  const { text, keyboard, top } = buildReport(results, now);
  await sendText(env, text, keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : {});
  if (top.length) await env.DB.batch(top.map((r) => env.DB.prepare('UPDATE items SET top_price = ? WHERE id = ?').bind(r.cur_price, r.id)));
  return { sent: true, rows: results.length, shown: top.length };
}

/** Ночная чистка очереди: кандидаты старше 15 дней без проверки. */
export function expireQueue(env, now = Date.now()) {
  return env.DB.prepare('UPDATE items SET next_at = NULL WHERE next_at IS NOT NULL AND next_at < ?').bind(now - (EXPIRE_DAYS - CHECK_DAYS[0]) * DAY);
}
