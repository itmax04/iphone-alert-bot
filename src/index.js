// iPhone Alert Bot: следит за новыми объявлениями iPhone 13+ на Kleinanzeigen в городах из таблицы
// и присылает их в Telegram с учётом приоритета города.
//
// Один запуск — одна страница Kleinanzeigen (лимит бесплатного тарифа: 10 мс CPU на запуск). Два расписания:
//  • каждую минуту: 8 городов высокого приоритета по разу в 10 минут + лента «вся Германия» для лучших
//    предложений каждые 5 минут (слоты 4 и 9 десятиминутного цикла);
//  • каждые 2 минуты: 15 городов среднего приоритета, каждый раз в 30 минут; раз в 3 часа эти слоты
//    на время обхода занимает вся земля Mecklenburg-Vorpommern (обычно 1–3 страницы).
// Данные — в D1 (KV на аккаунте почти исчерпан квартирным ботом).

import { CITIES } from './cities.js';
import { fetchCity, parseArticle } from './kleinanzeigen.js';
import { rejectReason, modelOf, storageOf, batteryOf, tagsOf } from './filters.js';
import { getPriceFilter, priceRejectReason, describeSellTable } from './settings.js';
import { eurRate, getSellTable, getMarginThreshold, marginOf, recordPrice, marketMedian, scamAndDeal } from './market.js';
import { handleUpdate, statsText, itemKeyboard, COMMANDS } from './commands.js';
import { runGermany, sendDigest, DIGEST_HOURS } from './deals.js';
import { runMvStep, mvDue } from './mv.js';
import { sendText, sendItem, call, escapeHtml } from './telegram.js';

const HIGH = CITIES.filter((c) => c.priority === 'high');
const MEDIUM = CITIES.filter((c) => c.priority === 'medium');
const MAX_MESSAGES_PER_RUN = 5;
const SEEN_TTL_DAYS = 30;
const DAILY_REPORT_HOUR = 21;
const DAY = 24 * 3600 * 1000;

export const CRON_HIGH = '* * * * *';
export const CRON_MEDIUM = '*/2 * * * *';
export const GERMANY_SLOT = 'germany';
// 10-минутный цикл основного расписания: 8 городов и два слота ленты по Германии (каждые 5 минут).
const HIGH_CYCLE = [0, 1, 2, 3, GERMANY_SLOT, 4, 5, 6, 7, GERMANY_SLOT];

/** Что проверять в этот запуск: город или GERMANY_SLOT. */
export function cityFor(cron, date) {
  const minute = Math.floor(date.getTime() / 60000);
  if (cron === CRON_MEDIUM) return MEDIUM[Math.floor(minute / 2) % MEDIUM.length];
  const slot = HIGH_CYCLE[minute % 10];
  return slot === GERMANY_SLOT ? GERMANY_SLOT : HIGH[slot];
}

function berlinParts(date = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (t) => f.find((p) => p.type === t).value;
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: parseInt(get('hour'), 10), minute: parseInt(get('minute'), 10) };
}

function formatItem(item, city, details, insight) {
  const head = [details.model, details.storage, item.price != null ? `${item.price} €${item.negotiable ? ' VB' : ''}` : 'цена не указана']
    .filter(Boolean)
    .join(' · ');
  const lines = [];
  if (insight.warnings.length) lines.push('🚨 <b>ОСТОРОЖНО: возможен обман</b>');
  if (insight.hot) lines.push(`🔥 <b>Выгодно: маржа ≈ ${insight.margin.marginEur} €</b>`);
  lines.push(
    city.priority === 'high' ? `⭐ <b>Высокий приоритет</b> · ${escapeHtml(city.name)}` : `▫️ Средний приоритет · ${escapeHtml(city.name)}`,
    `📱 <b>${escapeHtml(head)}</b>`,
    escapeHtml(item.title),
    `📍 ${escapeHtml(item.location || city.name)}`,
    `🚆 ~${escapeHtml(city.minutes)} мин из Ростока · ${escapeHtml(city.route)}`,
  );
  if (details.battery) lines.push(`🔋 Akku ${details.battery}%`);
  if (insight.margin) {
    const m = insight.margin;
    lines.push(
      `${m.marginEur >= 0 ? '📈' : '📉'} Маржа ≈ ${m.marginEur} € (продажа ${m.sellUah.toLocaleString('ru-RU')} ₴ ≈ ${m.sellEur} € − покупка ${item.price} €)`,
    );
  } else if (details.model && item.price != null) {
    lines.push(`📈 Маржа: задайте цену продажи — /sell ${escapeHtml(details.model.replace('iPhone ', ''))}${details.storage ? ` ${details.storage.replace(' GB', '')}` : ''} …₴`);
  }
  if (insight.market) {
    const d = insight.dealPercent;
    const rel = d > 0 ? `на ${d}% дешевле` : d < 0 ? `на ${-d}% дороже` : 'как';
    lines.push(`💰 ${rel} обычной цены (медиана ${insight.market.median} € по ${insight.market.count} объявл.)`);
  }
  for (const w of insight.warnings) lines.push(`🚨 ${escapeHtml(w)}`);
  for (const tag of tagsOf(item)) lines.push(escapeHtml(tag));
  if (/SEV|Ремонт|стыковки/.test(city.note)) lines.push(`⚠️ ${escapeHtml(city.note)}`);
  return lines.join('\n');
}

async function getState(env, city) {
  return (
    (await env.DB.prepare('SELECT * FROM city_state WHERE city = ?').bind(city.slug).first()) || {
      city: city.slug,
      initialized: 0,
      last_ok: null,
      fail_count: 0,
      last_error: null,
      alerted: 0,
      muted: 0,
    }
  );
}

// muted здесь не трогаем: его меняет только кнопка в /cities.
function saveState(env, s) {
  return env.DB.prepare(
    `INSERT INTO city_state (city, initialized, last_ok, fail_count, last_error, alerted) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(city) DO UPDATE SET initialized = excluded.initialized, last_ok = excluded.last_ok,
       fail_count = excluded.fail_count, last_error = excluded.last_error, alerted = excluded.alerted`,
  ).bind(s.city, s.initialized, s.last_ok, s.fail_count, s.last_error, s.alerted);
}

function statsUpsert(env, city, { errors = 0, sent = 0 }) {
  return env.DB.prepare(
    `INSERT INTO stats (day, city, checks, errors, sent) VALUES (?, ?, 1, ?, ?)
     ON CONFLICT(day, city) DO UPDATE SET checks = checks + 1, errors = errors + excluded.errors, sent = sent + excluded.sent`,
  ).bind(berlinParts().day, city.slug, errors, sent);
}

function markSeen(env, item, city, now, sent) {
  return env.DB.prepare('INSERT OR IGNORE INTO seen (id, city, first_seen, sent) VALUES (?, ?, ?, ?)').bind(item.id, city.slug, now, sent);
}

export async function runCity(env, city) {
  const state = await getState(env, city);
  if (state.muted) return { city: city.slug, muted: true };
  const now = Date.now();

  let items;
  try {
    items = await fetchCity(city);
  } catch (e) {
    state.fail_count += 1;
    state.last_error = String(e.message || e);
    if (state.fail_count >= 2 && !state.alerted) {
      await sendText(env, `⚠️ <b>${escapeHtml(city.name)}: сбой проверки</b>\n${escapeHtml(state.last_error)}\nОстальные города проверяются как обычно.`, {
        disable_notification: true,
      }).catch(() => {});
      state.alerted = 1;
    }
    await env.DB.batch([saveState(env, state), statsUpsert(env, city, { errors: 1 })]);
    return { city: city.slug, error: state.last_error };
  }

  if (state.alerted) await sendText(env, `✅ <b>${escapeHtml(city.name)} снова проверяется.</b>`, { disable_notification: true }).catch(() => {});
  state.fail_count = 0;
  state.alerted = 0;
  state.last_error = null;
  state.last_ok = now;

  // Какие из этих объявлений уже видели.
  const ids = items.map((i) => i.id);
  const known = new Set();
  if (ids.length) {
    const rows = await env.DB.prepare(`SELECT id FROM seen WHERE id IN (${ids.map(() => '?').join(',')})`)
      .bind(...ids)
      .all();
    for (const r of rows.results) known.add(r.id);
  }
  // Полностью разбираем только новые объявления — это экономит большую часть процессорного времени.
  const unseenRaw = items.filter((i) => !known.has(i.id));
  const writes = [];

  // Первая проверка города: запоминаем текущие объявления молча — присылаем только новые.
  if (!state.initialized) {
    for (const i of unseenRaw) writes.push(markSeen(env, i, city, now, 0));
    state.initialized = 1;
    writes.push(saveState(env, state), statsUpsert(env, city, {}));
    await env.DB.batch(writes);
    return { city: city.slug, initialized: true, items: items.length };
  }

  const unseen = unseenRaw.map(parseArticle);
  const priceFilter = unseen.length ? await getPriceFilter(env) : null;
  const fresh = [];
  for (const i of unseen) {
    const model = modelOf(i.title);
    // Цены всех новых iPhone 13+ — в статистику рынка (даже если по фильтру не пришлём).
    const priceWrite = !rejectReason(i) && recordPrice(env, i, model, storageOf(`${i.title} ${i.description}`), now);
    if (priceWrite) writes.push(priceWrite);
    if (rejectReason(i) || priceRejectReason(i, model, priceFilter)) writes.push(markSeen(env, i, city, now, 0));
    else fresh.push(i);
  }
  const [sellTable, rate, marginMin] = fresh.length
    ? await Promise.all([getSellTable(env), eurRate(env), getMarginThreshold(env)])
    : [{}, null, null];

  let sent = 0;
  for (const i of fresh.slice(0, MAX_MESSAGES_PER_RUN)) {
    const text = `${i.title} ${i.description}`;
    const details = { model: modelOf(i.title), storage: storageOf(text), battery: batteryOf(text) };
    const market = await marketMedian(env, details.model, details.storage);
    const margin = marginOf(i, details.model, details.storage, sellTable, rate);
    const { warnings, dealPercent } = scamAndDeal(i, market);
    const hot = Boolean(margin && marginMin != null && margin.marginEur >= marginMin && !warnings.length);
    // Звук: если для модели задана цена продажи — только для 🔥; иначе — по приоритету города.
    const silent = margin ? !hot : city.priority !== 'high';
    try {
      const res = await sendItem(env, formatItem(i, city, details, { market, margin, warnings, dealPercent, hot }), i.image, itemKeyboard(i.id, i.url, city), silent);
      writes.push(
        markSeen(env, i, city, now, 1),
        env.DB.prepare(
          `INSERT OR REPLACE INTO items (id, city, model, storage, battery, price, negotiable, title, location, url, sent_at, msg_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(i.id, city.slug, details.model, details.storage, details.battery, i.price, i.negotiable ? 1 : 0, i.title.slice(0, 200), i.location, i.url, now, res?.result?.message_id ?? null),
      );
      sent += 1;
    } catch (e) {
      console.error('send failed', i.id, e); // попробуем в следующий раз
    }
  }
  // Если за раз нашлось больше 5, остальные придут при следующей проверке города.

  writes.push(saveState(env, state), statsUpsert(env, city, { sent }));
  await env.DB.batch(writes);
  return { city: city.slug, items: items.length, fresh: fresh.length, sent };
}

async function sellReminder(env) {
  const [table, rate] = await Promise.all([getSellTable(env), eurRate(env)]);
  await sendText(
    env,
    `🗓 <b>Понедельник: проверьте цены продажи на OLX</b>\nБот считает маржу по этой таблице, курс НБУ сегодня: ${rate?.uahPerEur ?? '?'} ₴ за €.\n\n` +
      `${escapeHtml(describeSellTable(table, rate))}\n\nИзменить: <code>/sell 15 Pro 256 32000</code>`,
    { disable_notification: true },
  );
}

async function dailyReport(env) {
  await sendText(env, `📊 <b>Итоги дня, iPhone</b>\n\n${await statsText(env, berlinParts().day)}`);
}

export default {
  async scheduled(event, env) {
    const date = new Date(event.scheduledTime);
    const target = cityFor(event.cron, date);
    if (event.cron === CRON_MEDIUM && (await mvDue(env).catch(() => false))) {
      await runMvStep(env).catch((e) => console.error('mv failed', e));
    } else if (target === GERMANY_SLOT) {
      await runGermany(env).catch((e) => console.error('germany failed', e));
    } else {
      await runCity(env, target).catch((e) => console.error('run failed', e));
    }
    if (event.cron !== CRON_HIGH) return; // отчёты и чистка — только в основном расписании

    const { hour, minute } = berlinParts(date);
    if (DIGEST_HOURS.includes(hour) && minute === 1) await sendDigest(env).catch((e) => console.error('digest failed', e));
    if (hour === DAILY_REPORT_HOUR && minute === 0) await dailyReport(env).catch((e) => console.error('report failed', e));
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', weekday: 'short' }).format(date);
    if (weekday === 'Mon' && hour === 10 && minute === 0) await sellReminder(env).catch((e) => console.error('reminder failed', e));
    // Раз в час чистим старые записи.
    if (minute === 30) {
      const cutoff = Date.now() - SEEN_TTL_DAYS * DAY;
      await env.DB.batch([
        env.DB.prepare('DELETE FROM seen WHERE first_seen < ?').bind(cutoff),
        env.DB.prepare('DELETE FROM items WHERE sent_at < ?').bind(cutoff),
        env.DB.prepare('DELETE FROM prices WHERE seen_at < ?').bind(cutoff),
        env.DB.prepare('DELETE FROM deal_seen WHERE ts < ?').bind(Date.now() - 3 * DAY),
        env.DB.prepare('DELETE FROM mv_seen WHERE ts < ?').bind(cutoff),
        env.DB.prepare('DELETE FROM deals WHERE found_at < ?').bind(Date.now() - 7 * DAY),
      ]);
    }
  },

  // /telegram — команды и кнопки (секрет в заголовке знает только Telegram).
  // /setup?key=<RUN_KEY> — подключить webhook и меню. /run?key=<RUN_KEY>&city=<slug>|report — ручная проверка.
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/telegram' && request.method === 'POST') {
      if (!env.WEBHOOK_SECRET || request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
        return new Response('forbidden', { status: 403 });
      }
      try {
        await handleUpdate(env, await request.json());
      } catch (e) {
        console.error('telegram update failed', e);
      }
      return new Response('ok');
    }
    const authorized = env.RUN_KEY && url.searchParams.get('key') === env.RUN_KEY;
    if (!authorized) return new Response('iPhone Alert Bot');
    if (url.pathname === '/setup') {
      const webhook = await call(
        env,
        'setWebhook',
        { url: `${url.origin}/telegram`, secret_token: env.WEBHOOK_SECRET, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true },
        { withChat: false },
      );
      const commands = await call(env, 'setMyCommands', { commands: COMMANDS }, { withChat: false });
      return Response.json({ webhook: webhook.ok, commands: commands.ok });
    }
    if (url.pathname === '/run') {
      const slug = url.searchParams.get('city');
      if (slug === 'report') {
        await dailyReport(env);
        return Response.json({ report: 'sent' });
      }
      if (slug === 'germany') return Response.json(await runGermany(env));
      if (slug === 'mv') return Response.json(await runMvStep(env));
      if (slug === 'digest') return Response.json(await sendDigest(env));
      const city = CITIES.find((c) => c.slug === slug);
      if (!city) return Response.json({ error: 'unknown city', cities: CITIES.map((c) => c.slug) }, { status: 400 });
      // debug=1: только показать разобранные объявления, без записи в базу и без Telegram.
      if (url.searchParams.get('debug')) {
        const parsed = (await fetchCity(city)).map(parseArticle);
        return Response.json(parsed.slice(0, 6).map((i) => ({ id: i.id, price: i.price, vb: i.negotiable, location: i.location, title: i.title.slice(0, 60), model: modelOf(i.title), img: Boolean(i.image), url: i.url.slice(0, 60) })).concat([{ total: parsed.length }]));
      }
      return Response.json(await runCity(env, city));
    }
    return new Response('iPhone Alert Bot');
  },
};
