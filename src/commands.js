// Команды и кнопки Telegram: /cities (просмотр и выключение городов), /price, /stats, сообщения продавцам.

import { CITIES } from './cities.js';
import { searchUrl } from './kleinanzeigen.js';
import { getPriceFilter, savePriceFilter, applyPriceCommand, describePriceFilter, applySellCommand, describeSellTable } from './settings.js';
import { getSellTable, saveSellTable, eurRate, getMarginThreshold, saveMarginThreshold } from './market.js';
import { sellerMessages } from './messages.js';
import { dealsOverview } from './deals.js';
import { MV, getMvState, toggleMvMute } from './mv.js';
import { call, sendText, escapeHtml } from './telegram.js';

const HIGH = CITIES.filter((c) => c.priority === 'high');
const MEDIUM = CITIES.filter((c) => c.priority === 'medium');
const HOUR = 3600 * 1000;
const CITY_ITEMS_LIMIT = 8;

export const COMMANDS = [
  { command: 'deals', description: 'Лучшие предложения по Германии за 24 ч' },
  { command: 'cities', description: 'Города: последние объявления, вкл/выкл' },
  { command: 'sell', description: 'Мои цены продажи в Украине (для маржи)' },
  { command: 'margin', description: 'Порог маржи для 🔥 и звука' },
  { command: 'price', description: 'Фильтр цены' },
  { command: 'stats', description: 'Статистика за сегодня' },
  { command: 'help', description: 'Что умеет бот' },
];

export function bahnUrl(city) {
  return `https://www.bahn.de/buchung/fahrplan/suche#sts=true&so=Rostock%20Hbf&zo=${encodeURIComponent(city.name)}`;
}

export function frequencyOf(city) {
  if (city.priority === 'medium') return 'раз в 30 мин, без звука';
  return 'каждые 10 мин, со звуком';
}

function berlinTime(ts) {
  return ts ? new Date(ts).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' }) : '—';
}

function berlinDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Кнопки под объявлением. */
export function itemKeyboard(itemId, url, city) {
  return {
    inline_keyboard: [
      [{ text: '✍️ Написать продавцу', callback_data: `lt:${itemId}` }],
      [{ text: '🔗 Открыть', url }, { text: '🚆 Дорога', url: bahnUrl(city) }],
    ],
  };
}

async function citiesMenu(env) {
  const states = Object.fromEntries((await env.DB.prepare('SELECT city, muted FROM city_state').all()).results.map((s) => [s.city, s]));
  const today = Object.fromEntries(
    (await env.DB.prepare('SELECT city, sent FROM stats WHERE day = ?').bind(berlinDay()).all()).results.map((r) => [r.city, r.sent]),
  );
  const button = (c) => ({
    text: `${states[c.slug]?.muted ? '🔕 ' : c.priority === 'high' ? '⭐ ' : ''}${c.name}${today[c.slug] ? ` (${today[c.slug]})` : ''}`,
    callback_data: `city:${c.slug}`,
  });
  const rows = (list, perRow) => {
    const out = [];
    for (let i = 0; i < list.length; i += perRow) out.push(list.slice(i, i + perRow).map(button));
    return out;
  };
  const mv = await getMvState(env);
  const mvButton = {
    text: `${mv.muted ? '🔕 ' : '🗺 '}Mecklenburg-Vorpommern${today.mv ? ` (${today.mv})` : ''}`,
    callback_data: 'mvcard',
  };
  await sendText(
    env,
    '🏙 <b>Города</b>\nНажмите на город — покажу последние iPhone оттуда и дам выключить или включить город.\n' +
      '⭐ высокий приоритет · 🗺 вся земля MV · 🔕 выключен · (N) — прислано сегодня',
    { reply_markup: { inline_keyboard: [...rows(HIGH, 2), ...rows(MEDIUM, 3), [mvButton]] } },
  );
}

async function mvCard(env, editMessage) {
  const s = await getMvState(env);
  const stats = (await env.DB.prepare("SELECT * FROM stats WHERE day = ? AND city = 'mv'").bind(berlinDay()).first()) || { sent: 0, checks: 0 };
  const next = s.lastStart ? s.lastStart + 3 * HOUR : null;
  const status = s.muted
    ? '🔕 <b>выключен</b>'
    : s.active
      ? `🔄 идёт обход: страница ${s.page} · найдено пока ${s.collected.length}`
      : `следующий обход ≈ ${berlinTime(next && next > Date.now() ? next : Date.now())}`;
  const lines = [
    '🗺 <b>Mecklenburg-Vorpommern — вся земля</b>',
    'Раз в 3 часа бот проходит все объявления iPhone 13+ по MV и присылает тихую сводку новых из мест вне ваших городов.',
    '',
    `🔄 Статус: ${status}`,
    `🕐 Последний обход начат: ${berlinTime(s.lastStart)}`,
    `📱 Сегодня в сводках: ${stats.sent}, просмотрено страниц: ${stats.checks}`,
  ];
  const last = s.lastSummary;
  if (last) {
    lines.push('', `<b>Последняя сводка</b> (${berlinTime(last.at)}): ${last.count} новых, страниц ${last.pages}`);
    for (const c of last.items || []) {
      const head = [c.model, c.storage, c.price != null ? `${c.price} €` : null].filter(Boolean).join(' · ');
      lines.push(`• <a href="${escapeHtml(c.url)}">${escapeHtml(head)}</a> — ${escapeHtml(c.location || '')}${c.discount >= 15 ? ` · 💰 −${c.discount}%` : ''}`);
    }
    if (!last.count) lines.push('Новых вне ваших городов не было.');
  } else {
    lines.push('', 'Первая сводка придёт после ближайшего обхода.');
  }
  const markup = {
    inline_keyboard: [
      [
        { text: s.muted ? '🔔 Включить обход MV' : '🔕 Выключить обход MV', callback_data: 'mvmute' },
        { text: '🔗 Поиск по MV', url: searchUrl(MV) },
      ],
      [{ text: '⬅️ Все города', callback_data: 'cities' }],
    ],
  };
  const text = lines.join('\n');
  if (editMessage) {
    await call(
      env,
      'editMessageText',
      { chat_id: editMessage.chat.id, message_id: editMessage.message_id, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: markup },
      { withChat: false },
    ).catch(() => sendText(env, text, { reply_markup: markup }));
  } else {
    await sendText(env, text, { reply_markup: markup });
  }
}

async function cityCard(env, slug, editMessage) {
  const city = CITIES.find((c) => c.slug === slug);
  if (!city) return;
  const state = (await env.DB.prepare('SELECT * FROM city_state WHERE city = ?').bind(slug).first()) || {};
  const stats = (await env.DB.prepare('SELECT * FROM stats WHERE day = ? AND city = ?').bind(berlinDay(), slug).first()) || { sent: 0, checks: 0 };
  const items = (
    await env.DB.prepare('SELECT * FROM items WHERE city = ? ORDER BY sent_at DESC LIMIT ?').bind(slug, CITY_ITEMS_LIMIT).all()
  ).results;

  const lines = [
    `${city.priority === 'high' ? '⭐' : '▫️'} <b>${escapeHtml(city.name)}</b>${state.muted ? ' — 🔕 <b>выключен</b>' : ''}`,
    `🚆 ~${escapeHtml(city.minutes)} мин из Ростока · ${escapeHtml(city.route)}`,
    `🔄 Проверка: ${frequencyOf(city)} · последняя ${berlinTime(state.last_ok)}${state.last_error ? ` · ⚠️ ${escapeHtml(state.last_error)}` : ''}`,
    `📱 Сегодня прислано: ${stats.sent}, проверок: ${stats.checks}`,
  ];
  if (/SEV|Ремонт|стыковки/.test(city.note)) lines.push(`⚠️ ${escapeHtml(city.note)}`);
  lines.push('', items.length ? `<b>Последние ${items.length}:</b>` : 'Пока бот ничего отсюда не присылал.');
  for (const i of items) {
    const head = [i.model, i.storage, i.price != null ? `${i.price} €${i.negotiable ? ' VB' : ''}` : null].filter(Boolean).join(' · ');
    lines.push(`• <a href="${escapeHtml(i.url)}">${escapeHtml(head)}</a>${i.battery ? ` · 🔋${i.battery}%` : ''} · ${berlinTime(i.sent_at)}`);
  }

  const markup = {
    inline_keyboard: [
      [
        { text: state.muted ? '🔔 Включить город' : '🔕 Выключить город', callback_data: `mute:${slug}` },
        { text: '🔗 Поиск', url: searchUrl(city) },
      ],
      [{ text: '🚆 Дорога (DB)', url: bahnUrl(city) }, { text: '⬅️ Все города', callback_data: 'cities' }],
    ],
  };
  const text = lines.join('\n');
  if (editMessage) {
    await call(
      env,
      'editMessageText',
      { chat_id: editMessage.chat.id, message_id: editMessage.message_id, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: markup },
      { withChat: false },
    ).catch(() => sendText(env, text, { reply_markup: markup }));
  } else {
    await sendText(env, text, { reply_markup: markup });
  }
}

async function toggleMute(env, slug) {
  await env.DB.prepare(
    `INSERT INTO city_state (city, muted) VALUES (?, 1)
     ON CONFLICT(city) DO UPDATE SET muted = 1 - muted`,
  )
    .bind(slug)
    .run();
  const row = await env.DB.prepare('SELECT muted FROM city_state WHERE city = ?').bind(slug).first();
  return Boolean(row?.muted);
}

async function sendSellerMessage(env, itemId) {
  const item = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(itemId).first();
  if (!item) {
    await sendText(env, 'Это объявление уже удалено из памяти бота (старше 30 дней).');
    return;
  }
  const city = CITIES.find((c) => c.slug === item.city);
  // Из ленты по Германии — обычно далеко: предлагаем отправку через «Sicher bezahlen».
  const remote = item.city === 'de';
  const place = city?.name || (item.location || '').replace(/^\d{5}\s*/, '') || 'Rostock';
  const msg = sellerMessages(item, place, { remote });
  const head = [item.model, item.storage, item.price != null ? `${item.price} €${item.negotiable ? ' VB' : ''}` : null].filter(Boolean).join(' · ');
  const parts = [
    `✍️ <b>Сообщение продавцу: ${escapeHtml(head)} — ${escapeHtml(city?.name || item.location || '')}</b>`,
    'Нажмите на текст — он скопируется, затем «🔗 Открыть» → «Nachricht schreiben» → вставить.',
    '',
    '<b>1. Ещё доступен?</b>',
    `<pre>${escapeHtml(msg.de)}</pre>`,
  ];
  if (msg.deOffer) parts.push('', `<b>2. С предложением цены: ${msg.offer} €</b> (−10%)`, `<pre>${escapeHtml(msg.deOffer)}</pre>`);
  parts.push(`<blockquote expandable>🇷🇺 Перевод:\n${escapeHtml(msg.ruOffer || msg.ru)}</blockquote>`);
  await sendText(env, parts.join('\n'), { reply_markup: { inline_keyboard: [[{ text: '🔗 Открыть объявление', url: item.url }]] } });
  if (item.status === 'new') await env.DB.prepare("UPDATE items SET status = 'opened' WHERE id = ?").bind(itemId).run();
}

async function commandPrice(env, text) {
  const current = await getPriceFilter(env);
  const result = applyPriceCommand(text, current);
  if (result.error) return sendText(env, `⚠️ ${escapeHtml(result.error)}`);
  if (result.message) await savePriceFilter(env, result.filter);
  await sendText(
    env,
    `${result.message ? `✅ ${escapeHtml(result.message)}\n\n` : ''}💶 <b>Фильтр цены</b>\n${escapeHtml(describePriceFilter(result.filter))}\n\n` +
      '<b>Как задать</b>\n' +
      '<code>/price 600</code> — максимум 600 €\n' +
      '<code>/price 100-600</code> — от 100 до 600 €\n' +
      '<code>/price min 80</code> — отсеять дешёвое (аксессуары, мусор)\n' +
      '<code>/price 15 Pro 550</code> — лимит для модели (важнее общего)\n' +
      '<code>/price 15 Pro off</code> — убрать лимит модели\n' +
      '<code>/price off</code> — снять все ограничения\n\n' +
      '<i>Объявления без цены не отсеиваются. Новый фильтр действует на новые объявления.</i>',
  );
}

async function commandSell(env, text) {
  const [current, rate] = await Promise.all([getSellTable(env), eurRate(env)]);
  const result = applySellCommand(text, current);
  if (result.error) return sendText(env, `⚠️ ${escapeHtml(result.error)}`);
  if (result.message) await saveSellTable(env, result.table);
  await sendText(
    env,
    `${result.message ? `✅ ${escapeHtml(result.message)}\n\n` : ''}🇺🇦 <b>Цены продажи в Украине</b> (курс НБУ: ${rate?.uahPerEur ?? '?'} ₴ за €${rate?.date ? `, ${rate.date}` : ''})\n` +
      `${escapeHtml(describeSellTable(result.table, rate))}\n\n` +
      '<b>Как задать</b> (в гривнах, за сколько реально продаёте)\n' +
      '<code>/sell 15 Pro 256 32000</code> — модель и память\n' +
      '<code>/sell 13 Pro 15500</code> — для любой памяти\n' +
      '<code>/sell 15 Pro 256 off</code> — удалить\n\n' +
      '<i>Маржа = цена продажи по курсу НБУ − цена покупки. Без доставки, растаможки и комиссий.</i>',
  );
}

async function commandMargin(env, text) {
  const arg = text.replace(/^\/margin(@\w+)?/i, '').replace(/^маржа/i, '').trim();
  if (/^\d+$/.test(arg)) {
    await saveMarginThreshold(env, parseInt(arg, 10));
    return sendText(env, `✅ 🔥 и звук — при марже от <b>${parseInt(arg, 10)} €</b>.`);
  }
  const min = await getMarginThreshold(env);
  await sendText(
    env,
    `🔥 <b>Порог маржи: ${min} €</b>\nОбъявления с маржой от этой суммы помечаются 🔥 и приходят со звуком; остальные по моделям из /sell — без звука.\n` +
      'Модели без цены продажи — как раньше, по приоритету города.\n\nИзменить: <code>/margin 100</code>',
  );
}

export async function statsText(env, day) {
  const rows = (await env.DB.prepare('SELECT * FROM stats WHERE day = ?').bind(day).all()).results;
  const byCity = Object.fromEntries(rows.map((r) => [r.city, r]));
  const states = Object.fromEntries((await env.DB.prepare('SELECT * FROM city_state').all()).results.map((s) => [s.city, s]));
  const block = (list, title) => {
    const lines = [`<b>${title}</b>`];
    for (const c of list) {
      const r = byCity[c.slug] || { checks: 0, errors: 0, sent: 0 };
      const st = states[c.slug] || {};
      const ok = st.last_ok && Date.now() - st.last_ok < HOUR;
      const icon = st.muted ? '🔕' : ok ? '✅' : '❌';
      lines.push(`${icon} ${escapeHtml(c.name)}: прислано ${r.sent}, проверок ${r.checks}${r.errors ? `, ошибок ${r.errors}` : ''}`);
    }
    return lines.join('\n');
  };
  const total = rows.reduce((s, r) => s + r.sent, 0);
  return [`📱 Прислано объявлений: <b>${total}</b>`, block(HIGH, '⭐ Высокий приоритет'), block(MEDIUM, '▫️ Средний приоритет')].join('\n\n');
}

async function commandHelp(env) {
  await sendText(
    env,
    '📱 <b>iPhone Alert Bot</b>\nСлежу за новыми объявлениями iPhone 13 и новее на Kleinanzeigen: только частные продавцы, только продажа. ' +
      'Города и приоритеты — из вашей таблицы.\n\n' +
      '⭐ высокий приоритет — каждые 10 минут, со звуком\n▫️ средний — раз в 30 минут, без звука\n' +
      '🗺 вся Mecklenburg-Vorpommern — раз в 3 часа, сводка новых вне ваших городов\n\n' +
      '<b>Лучшие предложения по всей Германии</b> (отдельно от городов)\n' +
      '🔥 исключительные (на 40%+ дешевле рынка) — сразу, не больше 6 в день, 8–23 ч\n' +
      '📋 «Топ-5 выгодных» (на 25%+ дешевле или маржа от порога) — в 9, 13, 17 и 21 ч\n\n' +
      '🔧 возможен дефект · 🧩 возможно аксессуар · 🔁 обмен\n\n' +
      '<b>В каждом объявлении</b>\n📈 маржа по вашей цене продажи (/sell) · 💰 сравнение с обычной ценой на Kleinanzeigen · 🚨 признаки обмана\n' +
      '✍️ Написать продавцу — готовое сообщение на немецком (два варианта: «ещё доступен?» и с ценой −10%)\n\n' +
      '<b>Команды</b>\n/deals — лучшие по Германии за 24 ч\n/sell — ваши цены продажи в Украине (₴)\n/margin — порог маржи для 🔥 и звука\n/cities — города: последние объявления, выключить/включить\n/price — фильтр цены (общий и по моделям)\n/stats — статистика за сегодня\n\n' +
      'Каждый вечер в 21:00 — итоги дня.',
  );
}

export async function handleUpdate(env, update) {
  const chatId = String(update.message?.chat?.id ?? update.callback_query?.message?.chat?.id ?? '');
  if (chatId !== String(env.TELEGRAM_CHAT_ID)) return;

  const q = update.callback_query;
  if (q) {
    await call(env, 'answerCallbackQuery', { callback_query_id: q.id }, { withChat: false }).catch(() => {});
    const [kind, ...rest] = (q.data || '').split(':');
    const arg = rest.join(':');
    if (kind === 'cities') return citiesMenu(env);
    if (kind === 'mvcard') return mvCard(env, q.message);
    if (kind === 'mvmute') {
      await toggleMvMute(env);
      return mvCard(env, q.message);
    }
    if (kind === 'city') return cityCard(env, arg, q.message);
    if (kind === 'mute') {
      await toggleMute(env, arg);
      return cityCard(env, arg, q.message);
    }
    if (kind === 'lt') return sendSellerMessage(env, arg);
    return;
  }

  const text = (update.message?.text || '').trim();
  const cmd = text.toLowerCase().split(/[\s@]/)[0];
  if (['/deals', 'выгодные', 'лучшие'].includes(cmd)) return sendText(env, await dealsOverview(env));
  if (['/cities', 'города'].includes(cmd)) return citiesMenu(env);
  if (['/price', 'цена'].includes(cmd)) return commandPrice(env, text);
  if (['/sell', 'продажа'].includes(cmd)) return commandSell(env, text);
  if (['/margin', 'маржа'].includes(cmd)) return commandMargin(env, text);
  if (['/stats', 'стат', '/стат'].includes(cmd)) return sendText(env, `📊 <b>Сегодня</b>\n\n${await statsText(env, berlinDay())}`);
  if (text) return commandHelp(env);
}
