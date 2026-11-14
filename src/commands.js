// Команды и кнопки Telegram: /feeds (ленты: просмотр и выключение), /mode, /price, /sell, /stats, сообщения продавцам.

import { feedUrl } from './kleinanzeigen.js';
import { getPriceFilter, savePriceFilter, applyPriceCommand, describePriceFilter, applySellCommand, describeSellTable, getMode, saveMode } from './settings.js';
import { getSellTable, saveSellTable, eurRate, getMarginThreshold, saveMarginThreshold } from './market.js';
import { sellerMessages } from './messages.js';
import { FEEDS, GROUPS, getFeedState, frequencyOf, berlinDay } from './feeds.js';
import { call, sendText, escapeHtml } from './telegram.js';

const HOUR = 3600 * 1000;
const FEED_ITEMS_LIMIT = 8;

export const COMMANDS = [
  { command: 'feeds', description: 'Ленты: последние объявления, вкл/выкл' },
  { command: 'mode', description: 'Режим: наблюдение или отправка' },
  { command: 'sell', description: 'Мои цены продажи в Украине (для маржи)' },
  { command: 'margin', description: 'Порог маржи для 🔥 и звука' },
  { command: 'price', description: 'Фильтр цены' },
  { command: 'models', description: 'Какие модели распознаю и как их называть' },
  { command: 'stats', description: 'Статистика за сегодня' },
  { command: 'help', description: 'Что умеет бот' },
];

function berlinTime(ts) {
  return ts ? new Date(ts).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' }) : '—';
}

/** Начало сегодняшнего дня по Берлину, мс. */
function berlinDayStart(now = Date.now()) {
  const [h, m, sec] = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    .format(new Date(now))
    .split(':')
    .map(Number);
  return now - (((h % 24) * 60 + m) * 60 + sec) * 1000;
}

async function feedsMenu(env) {
  const states = Object.fromEntries((await env.DB.prepare('SELECT feed, muted FROM feeds').all()).results.map((s) => [s.feed, s]));
  const today = Object.fromEntries(
    (await env.DB.prepare('SELECT city, sent FROM stats WHERE day = ?').bind(berlinDay()).all()).results.map((r) => [r.city, r.sent]),
  );
  const button = (f) => ({
    text: `${states[f.id]?.muted ? '🔕' : f.group.icon} ${f.region.name}${today[f.id] ? ` (${today[f.id]})` : ''}`,
    callback_data: `feed:${f.id}`,
  });
  const mode = await getMode(env);
  await sendText(
    env,
    '🗂 <b>Ленты</b>\nНажмите на ленту — покажу последние объявления и дам выключить или включить её.\n' +
      `${GROUPS.map((g) => `${g.icon} ${g.name}`).join(' · ')} · 🔕 выключена · (N) — ${mode === 'send' ? 'прислано' : 'прислал бы'} сегодня`,
    { reply_markup: { inline_keyboard: GROUPS.map((g) => FEEDS.filter((f) => f.group === g).map(button)) } },
  );
}

async function feedCard(env, id, editMessage) {
  const feed = FEEDS.find((f) => f.id === id);
  if (!feed) return;
  const [state, mode] = await Promise.all([getFeedState(env, feed), getMode(env)]);
  const stats = (await env.DB.prepare('SELECT * FROM stats WHERE day = ? AND city = ?').bind(berlinDay(), id).first()) || { sent: 0, checks: 0 };
  const items = (await env.DB.prepare('SELECT * FROM items WHERE city = ? ORDER BY sent_at DESC LIMIT ?').bind(id, FEED_ITEMS_LIMIT).all()).results;

  const lines = [
    `${feed.group.icon} <b>${escapeHtml(feed.name)}</b>${state.muted ? ' — 🔕 <b>выключена</b>' : ''}`,
    `🔄 Проверка: ${frequencyOf(feed)} · последняя ${berlinTime(state.last_ok)}${state.last_error ? ` · ⚠️ ${escapeHtml(state.last_error)}` : ''}`,
    `📬 Сегодня ${mode === 'send' ? 'прислано' : 'прислал бы'}: ${stats.sent}, проверок: ${stats.checks}`,
    '',
    items.length ? `<b>Последние ${items.length}:</b>` : 'Пока в этой ленте ничего подходящего не было.',
  ];
  for (const i of items) {
    const head = [i.model, i.storage, i.price != null ? `${i.price} €${i.negotiable ? ' VB' : ''}` : null].filter(Boolean).join(' · ');
    lines.push(`• <a href="${escapeHtml(i.url)}">${escapeHtml(head)}</a>${i.battery ? ` · 🔋${i.battery}%` : ''} · ${berlinTime(i.sent_at)}`);
  }

  const markup = {
    inline_keyboard: [
      [
        { text: state.muted ? '🔔 Включить ленту' : '🔕 Выключить ленту', callback_data: `fmute:${id}` },
        { text: '🔗 Поиск', url: feedUrl(feed) },
      ],
      [{ text: '⬅️ Все ленты', callback_data: 'feeds' }],
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

function toggleMute(env, id) {
  return env.DB.prepare('INSERT INTO feeds (feed, muted) VALUES (?, 1) ON CONFLICT(feed) DO UPDATE SET muted = 1 - muted').bind(id).run();
}

const MODE_TEXT = {
  watch: '👀 <b>Режим: наблюдение</b>\nОбъявления не присылаю — только считаю, сколько прислал бы. Итоги — в /stats и в отчёте в 21:00.',
  send: '📬 <b>Режим: отправка</b>\nПрисылаю каждое распознанное объявление, прошедшее фильтр /price. Звук — только у 🔥 (маржа от порога /margin).',
};

async function commandMode(env, text) {
  const arg = text.replace(/^\S+/, '').trim().toLowerCase();
  if (arg === 'send' || arg === 'watch') await saveMode(env, arg);
  const mode = await getMode(env);
  await sendText(env, `${arg === mode ? '✅ ' : ''}${MODE_TEXT[mode]}\n\nПереключить: <code>/mode ${mode === 'send' ? 'watch' : 'send'}</code>`);
}

async function sendSellerMessage(env, itemId) {
  const item = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(itemId).first();
  if (!item) {
    await sendText(env, 'Это объявление уже удалено из памяти бота (старше 30 дней).');
    return;
  }
  const place = (item.location || '').replace(/^\d{5}\s*/, '') || 'Rostock';
  const msg = sellerMessages(item, place);
  const head = [item.model, item.storage, item.price != null ? `${item.price} €${item.negotiable ? ' VB' : ''}` : null].filter(Boolean).join(' · ');
  const parts = [
    `✍️ <b>Сообщение продавцу: ${escapeHtml(head)} — ${escapeHtml(item.location || '')}</b>`,
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
      'Модели без цены продажи приходят без звука.\n\nИзменить: <code>/margin 100</code>',
  );
}

const CLASS_LINES = [
  ['deal', '✅ цена ≤ медиана / 1,2 (уже выгодно)'],
  ['low', '🤝 не выше медианы'],
  ['high', '▫️ выше медианы'],
  ['nomed', '❔ медианы пока нет'],
  ['flag', '🔧 дефект, аксессуар или признак обмана'],
];

export async function statsText(env, day) {
  const today = day === berlinDay();
  const [mode, statRows, stateRows, classRows] = await Promise.all([
    getMode(env),
    env.DB.prepare('SELECT * FROM stats WHERE day = ?').bind(day).all(),
    env.DB.prepare('SELECT feed, last_ok, muted FROM feeds').all(),
    // Разбивка по классам — только за сегодня (items хранит время, а не день).
    today ? env.DB.prepare('SELECT class, COUNT(*) AS n FROM items WHERE sent_at >= ? GROUP BY class').bind(berlinDayStart()).all() : { results: [] },
  ]);
  const byFeed = Object.fromEntries(statRows.results.map((r) => [r.city, r]));
  const states = Object.fromEntries(stateRows.results.map((s) => [s.feed, s]));
  const word = mode === 'send' ? 'прислано' : 'прислал бы';
  const total = FEEDS.reduce((sum, f) => sum + (byFeed[f.id]?.sent || 0), 0);
  const out = [`${mode === 'send' ? '📬 Прислано объявлений' : '👀 Наблюдение: прислал бы объявлений'}: <b>${total}</b>`];

  const classes = Object.fromEntries(classRows.results.map((r) => [r.class, r.n]));
  const classLines = CLASS_LINES.filter(([key]) => classes[key]).map(([key, label]) => `${label}: ${classes[key]}`);
  if (classLines.length) out.push(classLines.join('\n'));

  for (const g of GROUPS) {
    const lines = [`<b>${g.icon} ${g.name}</b>`];
    for (const f of FEEDS.filter((x) => x.group === g)) {
      const r = byFeed[f.id] || { checks: 0, errors: 0, sent: 0 };
      const st = states[f.id] || {};
      const icon = st.muted ? '🔕' : st.last_ok && Date.now() - st.last_ok < HOUR ? '✅' : '❌';
      lines.push(`${icon} ${escapeHtml(f.region.name)}: ${word} ${r.sent}, проверок ${r.checks}${r.errors ? `, ошибок ${r.errors}` : ''}`);
    }
    out.push(lines.join('\n'));
  }
  return out.join('\n\n');
}

function commandModels(env) {
  return sendText(
    env,
    '📚 <b>Каталог моделей</b>\nНазвание модели — ключ для медианы рынка, /sell и /price. Заголовок объявления должен назвать модель однозначно; не распознано — не присылаю.\n\n' +
      '<b>iPhone 11+</b> — <code>iPhone 15 Pro Max</code> + память\n' +
      '<b>iPad</b> — <code>iPad 10</code>, <code>iPad mini 7</code>, <code>iPad Air 5</code>, <code>iPad Air 11" M2</code>, <code>iPad Pro 13" M4</code> + память (<code>256 GB</code> / <code>256 GB LTE</code>)\n' +
      '<b>MacBook</b> (только M1 и новее) — <code>MacBook Air 13" M2 8GB</code>, <code>MacBook Pro 14" M3 Pro 18GB</code> + SSD; без RAM в объявлении — не распознаётся\n' +
      '<b>Apple Watch</b> (Series 7+, Ultra) — <code>Apple Watch Series 9 45mm</code>, <code>Apple Watch Ultra 2 49mm</code> + <code>GPS</code> / <code>LTE</code>\n' +
      '<b>Samsung</b> (S21+, Z Fold/Flip 3+) — <code>Galaxy S24 Ultra</code>, <code>Galaxy Z Flip6</code> + память\n' +
      '<b>Pixel 6+</b> — <code>Pixel 8 Pro</code>, <code>Pixel 9a</code> + память\n\n' +
      '<b>Как писать в командах</b>\n' +
      '<code>/sell 15 Pro 256 32000</code>\n' +
      '<code>/sell s24 ultra 256 25000</code>\n' +
      '<code>/sell pixel 8 pro 18000</code>\n' +
      '<code>/sell ipad air 5 256 lte 20000</code>\n' +
      '<code>/sell watch 9 45mm lte 12000</code>\n' +
      '<code>/sell macbook air 13 m2 16/512 40000</code> — диагональ, чип, RAM/SSD\n' +
      '<code>/price macbook pro 14 m3 pro 18gb 1200</code>',
  );
}

async function commandHelp(env) {
  await sendText(
    env,
    '📱 <b>Alert Bot</b>\nСлежу за новыми объявлениями на Kleinanzeigen: только частные продавцы, только продажа, от 150 €.\n' +
      'Регионы: Berlin, Hamburg, вся Mecklenburg-Vorpommern.\n\n' +
      '📱 телефоны (iPhone 11+, Samsung, Pixel) — раз в 3 минуты\n📲 iPad · 💻 MacBook · ⌚ Apple Watch — раз в 18 минут\n\n' +
      'Присылаю только объявления, где модель распознана однозначно (/models).\n' +
      '🔧 возможен дефект · 🧩 возможно аксессуар · 🔁 обмен\n\n' +
      '<b>В каждом объявлении</b>\n📈 маржа по вашей цене продажи (/sell) · 💰 сравнение с обычной ценой на Kleinanzeigen · 🚨 признаки обмана\n' +
      '✍️ Написать продавцу — готовое сообщение на немецком (два варианта: «ещё доступен?» и с ценой −10%)\n\n' +
      '<b>Команды</b>\n/feeds — ленты: последние объявления, выключить/включить\n/mode — наблюдение (только считать) или отправка\n' +
      '/sell — ваши цены продажи в Украине (₴)\n/margin — порог маржи для 🔥 и звука\n/price — фильтр цены (общий и по моделям)\n' +
      '/models — какие модели распознаю\n/stats — статистика за сегодня\n\n' +
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
    if (kind === 'feeds') return feedsMenu(env);
    if (kind === 'feed') return feedCard(env, arg, q.message);
    if (kind === 'fmute') {
      if (FEEDS.some((x) => x.id === arg)) await toggleMute(env, arg);
      return feedCard(env, arg, q.message);
    }
    if (kind === 'lt') return sendSellerMessage(env, arg);
    return;
  }

  const text = (update.message?.text || '').trim();
  const cmd = text.toLowerCase().split(/[\s@]/)[0];
  if (['/feeds', '/cities', 'ленты'].includes(cmd)) return feedsMenu(env);
  if (['/mode', 'режим'].includes(cmd)) return commandMode(env, text);
  if (['/price', 'цена'].includes(cmd)) return commandPrice(env, text);
  if (['/sell', 'продажа'].includes(cmd)) return commandSell(env, text);
  if (['/models', 'модели'].includes(cmd)) return commandModels(env);
  if (['/margin', 'маржа'].includes(cmd)) return commandMargin(env, text);
  if (['/stats', 'стат', '/стат'].includes(cmd)) return sendText(env, `📊 <b>Сегодня</b>\n\n${await statsText(env, berlinDay())}`);
  if (text) return commandHelp(env);
}
