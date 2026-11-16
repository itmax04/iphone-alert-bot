// /found — «давно висят»: объявления, которые бот перепроверил на 7-й, 10-й или 14-й день (src/stale.js), с ценой
// предложения и маржей к медиане. Работает в любом режиме /mode. Фильтры: возраст (7+ / 14+ дней), «подходит» / все
// перепроверенные, регион, группа; пагинация. Запрос идёт по частичному индексу items_checked и всегда с LIMIT.

import { FEEDS, GROUPS, REGIONS } from './feeds.js';
import { call, sendText, escapeHtml } from './telegram.js';

export const PAGE_SIZE = 5;
export const MAX_PAGE = 9;
const DAY = 86400000;
const AGES = { 7: '7+ дней', 14: '14+ дней' };

export const DEFAULT_FILTER = { age: '7', fit: 'y', reg: '*', grp: '*', page: 0 };

/** «/found», «/found 14», «/found all be mac» → фильтр. Слова: 7, 14, all (не только подходящие), be/hh/mv, ph/tab/mac/aw. */
export function parseFoundArgs(text) {
  const f = { ...DEFAULT_FILTER };
  for (const w of text.replace(/^\S+/, '').toLowerCase().split(/\s+/).filter(Boolean)) {
    if (AGES[w]) f.age = w;
    else if (w === 'all' || w === 'все') f.fit = 'n';
    else if (REGIONS.some((r) => r.key === w)) f.reg = w;
    else if (GROUPS.some((g) => g.key === w)) f.grp = w;
    else return { error: `Не понял «${w}». Возраст: 7, 14 · все перепроверенные: all · регион: be, hh, mv · группа: ph, tab, mac, aw.` };
  }
  return { filter: f };
}

/** Данные кнопки: fd:<возраст>:<подходит>:<регион>:<группа>:<страница>. */
export const encodeFilter = (f, page = f.page) => `fd:${f.age}:${f.fit}:${f.reg}:${f.grp}:${page}`;
export function decodeFilter(arg) {
  const [age, fit, reg, grp, page] = arg.split(':');
  return {
    age: AGES[age] ? age : '7',
    fit: fit === 'n' ? 'n' : 'y',
    reg: REGIONS.some((r) => r.key === reg) ? reg : '*',
    grp: GROUPS.some((g) => g.key === grp) ? grp : '*',
    page: Math.min(Math.max(parseInt(page, 10) || 0, 0), MAX_PAGE),
  };
}

/** SQL: PAGE_SIZE + 1 строк (лишняя — признак следующей страницы). Только живые, уже перепроверенные. */
export function foundQuery(f, now = Date.now()) {
  const where = ['checked_at IS NOT NULL', 'gone = 0', 'sent_at <= ?'];
  const args = [now - Number(f.age) * DAY];
  if (f.fit === 'y') where.push('s_offer IS NOT NULL');
  const feeds = FEEDS.filter((x) => (f.reg === '*' || x.region.key === f.reg) && (f.grp === '*' || x.group.key === f.grp));
  if (feeds.length < FEEDS.length) {
    where.push(`city IN (${feeds.map(() => '?').join(',')})`);
    args.push(...feeds.map((x) => x.id));
  }
  args.push(PAGE_SIZE + 1, f.page * PAGE_SIZE);
  return { sql: `SELECT * FROM items WHERE ${where.join(' AND ')} ORDER BY checked_at DESC LIMIT ? OFFSET ?`, args };
}

const plural = (n, a, b, c) => (n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c);

function line(i, n, now) {
  const feed = FEEDS.find((x) => x.id === i.city);
  const days = Math.floor((now - i.sent_at) / DAY);
  const price = i.cur_price ?? i.price;
  const head = [i.model, i.storage, price != null ? `${price} €${i.negotiable ? ' VB' : ''}` : 'цена не указана'].filter(Boolean).join(' · ');
  const dropped = i.cur_price != null && i.price != null && i.cur_price < i.price ? ` (было ${i.price} €)` : '';
  const offer = i.s_offer != null ? `предложите <b>${i.s_offer} €</b> → <b>+${i.s_pct}%</b>` : 'до цели не дотягивает';
  return (
    `${n}. 🕰 <a href="${escapeHtml(i.url)}">${escapeHtml(head)}</a>${dropped}\n` +
    `   ${offer} · висит ${days} ${plural(days, 'день', 'дня', 'дней')} · ${feed ? `${feed.group.icon} ${escapeHtml(feed.region.name)}` : escapeHtml(i.city)}`
  );
}

export function renderFound(rows, f, now = Date.now()) {
  const shown = rows.slice(0, PAGE_SIZE);
  const region = REGIONS.find((r) => r.key === f.reg)?.name || 'все регионы';
  const group = GROUPS.find((g) => g.key === f.grp);
  const lines = [
    `🕰 <b>Давно висят</b> · ${AGES[f.age]} · ${f.fit === 'y' ? 'подходят' : 'все перепроверенные'} · ${escapeHtml(region)} · ${group ? `${group.icon} ${escapeHtml(group.name)}` : 'все группы'}`,
    '',
  ];
  if (!shown.length) lines.push('Пока пусто: перепроверка идёт по ночам (01:00–06:00) на 7-й, 10-й и 14-й день объявления. Попробуйте «все» или другой фильтр.');
  shown.forEach((i, k) => lines.push(line(i, f.page * PAGE_SIZE + k + 1, now)));

  const mark = (on, text) => (on ? `• ${text}` : text);
  const keyboard = shown.map((i, k) => [
    { text: `✍️ ${f.page * PAGE_SIZE + k + 1}`, callback_data: `lt:${i.id}` },
    { text: `🔗 ${f.page * PAGE_SIZE + k + 1}`, url: i.url },
  ]);
  keyboard.push([
    ...Object.entries(AGES).map(([k, label]) => ({ text: mark(f.age === k, label), callback_data: encodeFilter({ ...f, age: k }, 0) })),
    { text: mark(f.fit === 'y', 'подходят'), callback_data: encodeFilter({ ...f, fit: 'y' }, 0) },
    { text: mark(f.fit === 'n', 'все'), callback_data: encodeFilter({ ...f, fit: 'n' }, 0) },
  ]);
  keyboard.push([{ text: mark(f.reg === '*', 'Все'), callback_data: encodeFilter({ ...f, reg: '*' }, 0) }, ...REGIONS.map((r) => ({ text: mark(f.reg === r.key, r.name), callback_data: encodeFilter({ ...f, reg: r.key }, 0) }))]);
  keyboard.push([{ text: mark(f.grp === '*', 'Все'), callback_data: encodeFilter({ ...f, grp: '*' }, 0) }, ...GROUPS.map((g) => ({ text: mark(f.grp === g.key, g.icon), callback_data: encodeFilter({ ...f, grp: g.key }, 0) }))]);
  const nav = [];
  if (f.page > 0) nav.push({ text: '⬅️ Назад', callback_data: encodeFilter(f, f.page - 1) });
  if (rows.length > PAGE_SIZE && f.page < MAX_PAGE) nav.push({ text: 'Дальше ➡️', callback_data: encodeFilter(f, f.page + 1) });
  nav.push({ text: '🗂 Ленты', callback_data: 'feeds' });
  keyboard.push(nav);
  return { text: lines.join('\n'), markup: { inline_keyboard: keyboard } };
}

/** Показать страницу: новым сообщением (команда) или правкой существующего (кнопка). */
export async function showFound(env, f, editMessage, now = Date.now()) {
  const q = foundQuery(f, now);
  const rows = (await env.DB.prepare(q.sql).bind(...q.args).all()).results;
  const { text, markup } = renderFound(rows, f, now);
  if (editMessage) {
    return call(env, 'editMessageText', { chat_id: editMessage.chat.id, message_id: editMessage.message_id, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: markup }, { withChat: false })
      .catch(() => {}); // «message is not modified» при повторном нажатии — не ошибка
  }
  return sendText(env, text, { reply_markup: markup });
}
