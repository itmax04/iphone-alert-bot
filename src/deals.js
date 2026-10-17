// Лучшие предложения по всей Германии — отдельно от мониторинга городов.
//
// Источник: новые объявления iPhone 13+ (частные, только продажа) по всей Германии, страница «новые» каждые 5 минут.
// Оценка: цена против медианы той же модели и памяти (prices, все увиденные объявления), плюс маржа, если задана /sell.
//
// Частота (выбрана по данным: в Германии ~150 «чистых» объявлений iPhone 13+ в час, из них на 25%+ дешевле рынка
// ~3 %, на 40%+ — ~0,4 %):
//  • 🔥 исключительные (на 40%+ дешевле, без признаков обмана) — сразу, со звуком, не больше 6 в день, только 8–22 ч;
//    ночью и сверх лимита попадают в ближайшую сводку;
//  • 📋 сводка «Топ-5» в 9, 13, 17 и 21 ч — лучшие из всех выгодных (на 25%+ дешевле или маржа от порога) за период.

import { fetchCity, parseArticle } from './kleinanzeigen.js';
import { rejectReason, modelOf, storageOf, batteryOf, tagsOf } from './filters.js';
import { marketMedian, scamAndDeal, marginOf, recordPrice, getSellTable, eurRate, getMarginThreshold } from './market.js';
import { sendText, sendItem, escapeHtml } from './telegram.js';

export const GERMANY = { slug: '', loc: '', name: 'Deutschland' };

const GOOD_DISCOUNT = 25; // % дешевле медианы
const EXCEPTIONAL_DISCOUNT = 40;
const MIN_RATIO = 0.5; // дешевле половины медианы — почти всегда обман
const MIN_SAMPLES_GOOD = 5;
const MIN_SAMPLES_EXCEPTIONAL = 8;
const MAX_INSTANT_PER_DAY = 6;
const DIGEST_SIZE = 5;
export const DIGEST_HOURS = [9, 13, 17, 21];
const DAY = 24 * 3600 * 1000;

// «Только отправка» — для покупки издалека это нормально (через «Sicher bezahlen»), но в 🔥 не пускаем.
const SOFT_WARNINGS = new Set(['только отправка почтой']);

function berlinHour(date = new Date()) {
  return parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false }).format(date), 10);
}

function berlinDayStart() {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
  return new Date(`${day}T00:00:00+02:00`).getTime(); // ±1 ч на переходе времени не важен для лимита
}

/**
 * Оценка выгоды. null — не выгодно.
 * @returns {{ kind: 'exceptional'|'good', score: number, discount: number|null, note: string|null }|null}
 */
export function evaluateDeal(item, market, margin, warnings, marginMin) {
  const hard = warnings.filter((w) => !SOFT_WARNINGS.has(w));
  if (hard.length) return null;
  const note = warnings.find((w) => SOFT_WARNINGS.has(w)) || null;
  const ratio = market ? item.price / market.median : null;
  if (ratio != null && ratio < MIN_RATIO) return null;
  const discount = ratio != null ? Math.round((1 - ratio) * 100) : null;
  const goodByMarket = market && market.count >= MIN_SAMPLES_GOOD && discount >= GOOD_DISCOUNT;
  // По марже — только если цена хотя бы на 10% ниже рынка (или рынок неизвестен).
  const goodByMargin = margin && marginMin != null && margin.marginEur >= marginMin && (discount == null || discount >= 10);
  if (!goodByMarket && !goodByMargin) return null;
  const exceptional = !note && market && market.count >= MIN_SAMPLES_EXCEPTIONAL && discount >= EXCEPTIONAL_DISCOUNT;
  const score = (discount ?? 0) + (margin ? margin.marginEur / 10 : 0);
  return { kind: exceptional ? 'exceptional' : 'good', score, discount, note };
}

function dealLine(d, index) {
  const head = [d.model, d.storage, `${d.price} €`].filter(Boolean).join(' · ');
  const parts = [];
  if (d.discount != null) parts.push(`−${d.discount}% к рынку (медиана ${d.median} € / ${d.samples})`);
  if (d.margin != null) parts.push(`📈 маржа ≈ ${d.margin} €`);
  return (
    `${index != null ? `${index}. ` : ''}${d.kind === 'exceptional' ? '🔥 ' : ''}<b>${escapeHtml(head)}</b>\n` +
    `   ${escapeHtml(parts.join(' · '))}\n` +
    `   📍 ${escapeHtml(d.location || '?')}${d.note ? ` · ⚠️ ${escapeHtml(d.note)}` : ''} · <a href="${escapeHtml(d.url)}">Kleinanzeigen</a>`
  );
}

function rememberItem(env, d, msgId) {
  // В items — чтобы работала кнопка «✍️ Написать продавцу».
  return env.DB.prepare(
    `INSERT OR REPLACE INTO items (id, city, model, storage, battery, price, negotiable, title, location, url, sent_at, msg_id)
     VALUES (?, 'de', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
  ).bind(d.id, d.model, d.storage, d.battery ?? null, d.price, (d.title || '').slice(0, 200), d.location, d.url, Date.now(), msgId);
}

async function sendInstant(env, d) {
  const lines = [
    '🔥 <b>Исключительное предложение · Германия</b>',
    dealLine(d),
    escapeHtml(d.title || ''),
  ];
  if (d.battery) lines.push(`🔋 Akku ${d.battery}%`);
  lines.push('<i>Если далеко — покупайте только через «Sicher bezahlen» на Kleinanzeigen.</i>');
  const res = await sendItem(
    env,
    lines.join('\n'),
    d.image,
    { inline_keyboard: [[{ text: '✍️ Написать продавцу', callback_data: `lt:${d.id}` }], [{ text: '🔗 Открыть', url: d.url }]] },
    false,
  );
  return res?.result?.message_id ?? null;
}

/** Одна проверка ленты по Германии: страница «новые» (и вторая, если вся первая — новые). */
export async function runGermany(env) {
  const now = Date.now();
  let raw = await fetchCity(GERMANY);
  const known = async (list) => {
    const ids = list.map((i) => i.id);
    if (!ids.length) return new Set();
    const rows = await env.DB.prepare(`SELECT id FROM deal_seen WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
    return new Set(rows.results.map((r) => r.id));
  };
  let seen = await known(raw);
  if (raw.length && raw.every((i) => !seen.has(i.id))) {
    // За 5 минут вышло больше 25 объявлений — дочитываем вторую страницу.
    const more = await fetchCity({ ...GERMANY, page: 2 }).catch(() => []);
    raw = raw.concat(more);
    seen = new Set([...seen, ...(await known(more))]);
  }
  const unseen = raw.filter((i) => !seen.has(i.id)).map(parseArticle);
  const writes = unseen.map((i) => env.DB.prepare('INSERT OR IGNORE INTO deal_seen (id, ts) VALUES (?, ?)').bind(i.id, now));

  const [sellTable, rate, marginMin] = await Promise.all([getSellTable(env), eurRate(env), getMarginThreshold(env)]);
  const medianCache = new Map();
  const found = [];
  for (const i of unseen) {
    if (rejectReason(i) || i.price == null || i.price < 100) continue;
    const text = `${i.title} ${i.description}`;
    const model = modelOf(i.title);
    const storage = storageOf(text);
    const pw = recordPrice(env, i, model, storage, now);
    if (pw) writes.push(pw);
    if (!storage || tagsOf(i).some((t) => t.startsWith('🔧') || t.startsWith('🧩'))) continue; // дефекты и аксессуары — мимо
    const key = `${model}|${storage}`;
    if (!medianCache.has(key)) medianCache.set(key, await marketMedian(env, model, storage));
    const market = medianCache.get(key);
    const margin = marginOf(i, model, storage, sellTable, rate);
    const { warnings } = scamAndDeal(i, market);
    const deal = evaluateDeal(i, market, margin, warnings, marginMin);
    if (!deal) continue;
    found.push({
      id: i.id, model, storage, battery: batteryOf(text), price: i.price, median: market?.median ?? null, samples: market?.count ?? null,
      discount: deal.discount, margin: margin?.marginEur ?? null, score: deal.score, kind: deal.kind, title: i.title.slice(0, 200),
      location: i.location, url: i.url, image: i.image, note: deal.note,
    });
  }

  // Мгновенно — только исключительные, днём и в пределах дневного лимита.
  const hour = berlinHour();
  let instantLeft = 0;
  if (hour >= 8 && hour < 23 && found.some((d) => d.kind === 'exceptional')) {
    const row = await env.DB.prepare("SELECT COUNT(*) n FROM deals WHERE kind = 'exceptional' AND sent_at >= ?").bind(berlinDayStart()).first();
    instantLeft = MAX_INSTANT_PER_DAY - (row?.n || 0);
  }
  found.sort((a, b) => b.score - a.score);
  for (const d of found) {
    let sentAt = null;
    if (d.kind === 'exceptional' && instantLeft > 0) {
      try {
        const msgId = await sendInstant(env, d);
        writes.push(rememberItem(env, d, msgId));
        sentAt = now;
        instantLeft -= 1;
      } catch (e) {
        console.error('instant deal failed', d.id, e);
      }
    }
    writes.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO deals (id, model, storage, price, median, samples, discount, margin, score, kind, title, location, url, image, note, found_at, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(d.id, d.model, d.storage, d.price, d.median, d.samples, d.discount, d.margin, d.score, d.kind, d.title, d.location, d.url, d.image, d.note, now, sentAt),
    );
  }
  if (writes.length) await env.DB.batch(writes);
  return { checked: raw.length, unseen: unseen.length, deals: found.length };
}

/** Сводка «Топ-5» за период: лучшие из ещё не отправленных; остальные помечаются как пропущенные. */
export async function sendDigest(env) {
  const now = Date.now();
  const pending = (
    await env.DB.prepare('SELECT * FROM deals WHERE sent_at IS NULL AND found_at > ? ORDER BY score DESC').bind(now - DAY / 2).all()
  ).results;
  if (!pending.length) {
    await env.DB.prepare('UPDATE deals SET sent_at = 0 WHERE sent_at IS NULL').run();
    return { sent: 0 };
  }
  // Один продавец иногда дублирует объявление в нескольких городах — показываем один раз.
  const unique = [];
  const keys = new Set();
  for (const d of pending) {
    const key = `${d.model}|${d.storage}|${d.price}|${(d.title || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 60)}`;
    if (keys.has(key)) continue;
    keys.add(key);
    unique.push(d);
  }
  const top = unique.slice(0, DIGEST_SIZE);
  const text =
    `📋 <b>Топ-${top.length} выгодных iPhone по Германии</b>\n` +
    `<i>из ${unique.length} выгодных за последние часы · −% — насколько дешевле обычной цены той же модели и памяти</i>\n\n` +
    top.map((d, n) => dealLine({ ...d }, n + 1)).join('\n\n') +
    '\n\n<i>Если далеко — покупайте только через «Sicher bezahlen» на Kleinanzeigen.</i>';
  const keyboard = {
    inline_keyboard: top.map((d, n) => [{ text: `✍️ ${n + 1} · ${[d.model, d.storage].filter(Boolean).join(' ')} · ${d.price} €`, callback_data: `lt:${d.id}` }]),
  };
  const res = await sendText(env, text, { reply_markup: keyboard });
  const msgId = res?.result?.message_id ?? null;
  await env.DB.batch([
    ...top.map((d) => env.DB.prepare('UPDATE deals SET sent_at = ? WHERE id = ?').bind(now, d.id)),
    ...top.map((d) => rememberItem(env, d, msgId)),
    env.DB.prepare('UPDATE deals SET sent_at = 0 WHERE sent_at IS NULL'), // не попали в топ — больше не предлагаем
  ]);
  return { sent: top.length, candidates: unique.length };
}

/** Для команды /deals: лучшие за 24 часа (отправленные и ожидающие). */
export async function dealsOverview(env) {
  const rows = (
    await env.DB.prepare('SELECT * FROM deals WHERE found_at > ? ORDER BY score DESC LIMIT 8').bind(Date.now() - DAY).all()
  ).results;
  if (!rows.length) return '📋 За последние 24 часа выгодных предложений по Германии пока нет.';
  return `📋 <b>Лучшие по Германии за 24 часа</b>\n\n${rows.map((d, n) => dealLine(d, n + 1)).join('\n\n')}`;
}
