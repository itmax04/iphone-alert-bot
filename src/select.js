// Отбор объявлений (этап 4): маржа к цене покупки и запас торга. Чистые функции, тест — scripts/test_select.js.
//   маржа = медиана рынка − цена, в % от цены и в €. Других расходов не вычитаем (дорога, комиссии, доставка).
//   deal  — уже выгодно: маржа ≥ target % при цене объявления;
//   haggle — выгодно после торга: при цене offer = цена × (1 − запас торга) маржа ≥ target %;
//   low / high — цена не выше / выше медианы, но цели нет; nomed — нет цены или медианы;
//   flag — дефект, аксессуар или признак обмана.
// Присылаются только deal и haggle. Настройки — settings (D1, ключ 'select'), команды /target /haggle /minprofit.

export const DEFAULT_SELECT = { target: 20, haggle: 20, minprofit: null };
export const SEND_CLASSES = ['deal', 'haggle'];

// Запас торга, % от цены: VB — 10, срочность +5, давно висит или цена уже снижена +5, Festpreis — 0; не больше MAX_HAGGLE.
const MAX_HAGGLE = 20;
const URGENT_RE = /muss\s+weg|umzug|dringend|schnell/i;
export const FIXED_RE = /(?<!kein\s)(?:festpreis|fixpreis)|keine\s+verhandlung|nicht\s+verhandelbar/i;
const STALE_DAYS = 7;

/** Сколько дней объявлению: «Heute, …» — 0, «Gestern, …» — 1, «дд.мм.гггг» — по дате; неизвестно — null. */
export function ageDays(posted, now = Date.now()) {
  if (!posted) return null;
  if (posted.startsWith('Heute')) return 0;
  if (posted.startsWith('Gestern')) return 1;
  const m = posted.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? Math.max(0, Math.floor((now - Date.UTC(+m[3], +m[2] - 1, +m[1])) / 86400000)) : null;
}

/** Запас торга по сигналам объявления: { percent, reasons }. */
export function haggleOf(item, now = Date.now()) {
  const text = `${item.title || ''} ${item.description || ''}`;
  if (FIXED_RE.test(text)) return { percent: 0, reasons: ['Festpreis'] };
  let percent = 0;
  const reasons = [];
  if (item.negotiable) {
    percent += 10;
    reasons.push('VB');
  }
  if (URGENT_RE.test(text)) {
    percent += 5;
    reasons.push('срочно');
  }
  const age = ageDays(item.posted, now);
  if (item.oldPrice != null && item.price != null && item.oldPrice > item.price) {
    percent += 5;
    reasons.push('цена снижена');
  } else if (age != null && age > STALE_DAYS) {
    percent += 5;
    reasons.push('висит давно');
  }
  return { percent: Math.min(percent, MAX_HAGGLE), reasons };
}

const flagged = (tags) => tags.some((t) => t.startsWith('🔧') || t.startsWith('🧩'));
export const round5 = (n) => Math.round(n / 5) * 5;
const gain = (median, buy) => ({ marginEur: Math.round(median - buy), marginPct: Math.round(((median - buy) / buy) * 1000) / 10 });

/**
 * Класс и расчёт для объявления. Возвращает { cls, marginEur?, marginPct?, offer?, percent?, reasons? };
 * для haggle маржа посчитана при цене offer.
 */
export function evaluate(item, market, tags, warnings, sel = DEFAULT_SELECT, now = Date.now()) {
  if (warnings.length || flagged(tags)) return { cls: 'flag' };
  if (!market || item.price == null || item.price <= 0) return { cls: 'nomed' };
  const price = item.price;
  const median = market.median;
  const ok = (buy) => ((median - buy) / buy) * 100 >= sel.target && (sel.minprofit == null || median - buy >= sel.minprofit);
  if (ok(price)) return { cls: 'deal', ...gain(median, price) };
  const { percent, reasons } = haggleOf(item, now);
  const cap = Math.min(percent, sel.haggle);
  if (cap > 0) {
    const offer = round5(price * (1 - cap / 100));
    if (offer > 0 && offer < price && ok(offer)) return { cls: 'haggle', offer, percent: cap, reasons, ...gain(median, offer) };
  }
  return { cls: price <= median ? 'low' : 'high' };
}

/**
 * Разбор аргумента команд /target, /haggle, /minprofit.
 * Возвращает { show: true } | { value } | { error }. value null — выключено (только minprofit).
 */
export function parseSelectArg(name, text) {
  const arg = text.replace(/^\/\S+/, '').trim().toLowerCase();
  if (!arg) return { show: true };
  if (name === 'minprofit' && /^(off|выкл|0)$/.test(arg)) return { value: null };
  if (!/^\d{1,4}$/.test(arg)) return { error: `Нужно целое число${name === 'minprofit' ? ' или off' : ''}.` };
  const n = parseInt(arg, 10);
  if (name === 'target' && (n < 1 || n > 500)) return { error: 'Цель — от 1 до 500 %.' };
  if (name === 'haggle' && n > MAX_HAGGLE) return { error: `Запас торга — от 0 до ${MAX_HAGGLE} %.` };
  return { value: n };
}
