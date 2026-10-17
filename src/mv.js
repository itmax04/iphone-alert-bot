// Обход всей земли Mecklenburg-Vorpommern раз в 3 часа — отдельно от городов с приоритетами.
// Идём по страницам «новые» (по одной за запуск), пока не встретим страницу, где всё уже видели.
// Присылаем одной тихой сводкой новые iPhone 13+ из мест, которые не покрыты мониторингом городов.

import { fetchCity, parseArticle } from './kleinanzeigen.js';
import { rejectReason, modelOf, storageOf } from './filters.js';
import { recordPrice, marketMedian } from './market.js';
import { getPriceFilter, priceRejectReason } from './settings.js';
import { sendText, escapeHtml } from './telegram.js';

export const MV = { slug: 'mecklenburg-vorpommern', loc: 'l61', name: 'Mecklenburg-Vorpommern' };
const INTERVAL = 3 * 3600 * 1000;
const MAX_PAGES = 46; // ~1 130 объявлений; дальше Kleinanzeigen не листает
const MAX_LINES = 30;

export async function getMvState(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'mv'").first();
  return { active: false, page: 1, lastStart: 0, collected: [], muted: false, lastSummary: null, ...(row ? JSON.parse(row.value) : {}) };
}
const getState = getMvState;

/** Кнопка в /cities: выключить или включить обход MV. Возвращает новое состояние muted. */
export async function toggleMvMute(env) {
  const state = await getMvState(env);
  state.muted = !state.muted;
  if (state.muted) Object.assign(state, { active: false, page: 1, collected: [] });
  await saveState(env, state).run();
  return state.muted;
}

function berlinDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(date);
}

function saveState(env, state) {
  return env.DB.prepare("INSERT INTO settings (key, value) VALUES ('mv', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(
    JSON.stringify(state),
  );
}

/** Пора ли занимать слот под MV (идёт обход или прошло 3 часа). */
export async function mvDue(env) {
  const s = await getState(env);
  if (s.muted) return false;
  return s.active || Date.now() - s.lastStart >= INTERVAL;
}

async function sendSummary(env, collected) {
  if (!collected.length) return;
  const lines = collected.slice(0, MAX_LINES).map((c) => {
    const head = [c.model, c.storage, c.price != null ? `${c.price} €` : null].filter(Boolean).join(' · ');
    const deal = c.discount != null && c.discount >= 15 ? ` · 💰 −${c.discount}%` : '';
    return `• <a href="${escapeHtml(c.url)}">${escapeHtml(head)}</a> — ${escapeHtml(c.location || '')}${deal}`;
  });
  if (collected.length > MAX_LINES) lines.push(`… и ещё ${collected.length - MAX_LINES}`);
  await sendText(
    env,
    `🗺 <b>Mecklenburg-Vorpommern за 3 часа: ${collected.length} новых iPhone 13+</b>\n` +
      '<i>места вне ваших городов · 💰 — насколько дешевле обычной цены</i>\n\n' +
      lines.join('\n'),
    { disable_notification: true },
  );
}

/** Один шаг обхода MV (одна страница). */
export async function runMvStep(env) {
  const now = Date.now();
  const state = await getState(env);
  if (!state.active) Object.assign(state, { active: true, page: 1, lastStart: now, collected: [] });

  const raw = await fetchCity({ ...MV, page: state.page });
  const ids = raw.map((i) => i.id);
  const known = new Set();
  const inCities = new Set();
  if (ids.length) {
    const marks = ids.map(() => '?').join(',');
    for (const r of (await env.DB.prepare(`SELECT id FROM mv_seen WHERE id IN (${marks})`).bind(...ids).all()).results) known.add(r.id);
    for (const r of (await env.DB.prepare(`SELECT id FROM seen WHERE id IN (${marks})`).bind(...ids).all()).results) inCities.add(r.id);
  }
  const unseen = raw.filter((i) => !known.has(i.id));
  const writes = unseen.map((i) => env.DB.prepare('INSERT OR IGNORE INTO mv_seen (id, ts) VALUES (?, ?)').bind(i.id, now));

  const priceFilter = unseen.length ? await getPriceFilter(env) : null;
  for (const i of unseen.map(parseArticle)) {
    if (rejectReason(i)) continue;
    const model = modelOf(i.title);
    const storage = storageOf(`${i.title} ${i.description}`);
    const pw = recordPrice(env, i, model, storage, now);
    if (pw) writes.push(pw);
    // Уже прислано мониторингом городов или не проходит фильтр цены — в сводку не берём.
    if (inCities.has(i.id) || priceRejectReason(i, model, priceFilter)) continue;
    const market = storage ? await marketMedian(env, model, storage) : null;
    state.collected.push({
      model, storage, price: i.price, location: i.location, url: i.url,
      discount: market && i.price ? Math.round((1 - i.price / market.median) * 100) : null,
    });
    // Чтобы города не прислали его второй раз, если доберутся позже.
    writes.push(env.DB.prepare('INSERT OR IGNORE INTO seen (id, city, first_seen, sent) VALUES (?, ?, ?, 2)').bind(i.id, 'mv', now));
  }

  // Конец обхода: страница без новых, последняя страница или неполная страница.
  const finished = unseen.length === 0 || raw.length < 25 || state.page >= MAX_PAGES;
  if (finished) {
    await sendSummary(env, state.collected).catch((e) => console.error('mv summary failed', e));
    // Для карточки в /cities: когда и что нашли в последний раз.
    state.lastSummary = { at: now, pages: state.page, count: state.collected.length, items: state.collected.slice(0, 8) };
    Object.assign(state, { active: false, page: 1, collected: [] });
  } else {
    state.page += 1;
  }
  writes.push(saveState(env, state));
  // Статистика дня, как у городов: проверка = страница, «прислано» = объявлений в сводке.
  writes.push(
    env.DB.prepare(
      `INSERT INTO stats (day, city, checks, errors, sent) VALUES (?, 'mv', 1, 0, ?)
       ON CONFLICT(day, city) DO UPDATE SET checks = checks + 1, sent = sent + excluded.sent`,
    ).bind(berlinDay(), finished ? state.lastSummary.count : 0),
  );
  await env.DB.batch(writes);
  return { mvPage: finished ? 'done' : state.page - 1, unseen: unseen.length, collected: state.collected.length };
}
