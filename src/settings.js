// Фильтр цены. Хранится в D1 (settings, key = 'price'), задаётся в боте командой /price.
//   min / max — общий диапазон цены, € (null — без ограничения);
//   models — максимальная цена для конкретной модели, например { "iPhone 15 Pro": 550 }.
// Лимит модели важнее общего максимума. Объявления без цены («VB», «Zu verschenken») не отсеиваются.

import { identifyQuery } from './catalog.js';
import { DEFAULT_SELECT } from './select.js';

const DEFAULT = { min: null, max: null, models: {} };

export async function getPriceFilter(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'price'").first();
  return row ? { ...DEFAULT, ...JSON.parse(row.value) } : { ...DEFAULT };
}

export function savePriceFilter(env, filter) {
  return env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('price', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  )
    .bind(JSON.stringify(filter))
    .run();
}

/** Режим лент: 'watch' — наблюдение (считаем, но не присылаем), 'send' — присылаем. По умолчанию — наблюдение. */
export async function getMode(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'mode'").first();
  return row && JSON.parse(row.value) === 'send' ? 'send' : 'watch';
}

export function saveMode(env, mode) {
  return env.DB.prepare("INSERT INTO settings (key, value) VALUES ('mode', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(JSON.stringify(mode))
    .run();
}

/** Настройки отбора (src/select.js): { target %, haggle % — максимум запаса торга, minprofit € или null }. */
export async function getSelect(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'select'").first();
  return row ? { ...DEFAULT_SELECT, ...JSON.parse(row.value) } : { ...DEFAULT_SELECT };
}

export function saveSelect(env, select) {
  return env.DB.prepare("INSERT INTO settings (key, value) VALUES ('select', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(JSON.stringify(select))
    .run();
}

/** Причина отказа по цене или null. */
export function priceRejectReason(item, model, filter) {
  if (item.price == null) return null;
  const cap = filter.models?.[model] ?? filter.max;
  if (cap != null && item.price > cap) return `${item.price} € > ${cap} €`;
  if (filter.min != null && item.price < filter.min) return `${item.price} € < ${filter.min} €`;
  return null;
}

/**
 * Разбор команды /price. Возвращает { filter, message } или { error }.
 *   /price            — показать
 *   /price 600        — максимум 600 €
 *   /price 100-600    — от 100 до 600 €
 *   /price min 80     — только минимум
 *   /price 15 Pro 550 — максимум для модели (iPhone 15 Pro)
 *   /price 15 Pro off — убрать лимит модели
 *   /price s24 ultra 500 · /price ipad air 5 300 — другие категории (ключи — src/catalog.js, /models)
 *   /price off        — убрать все ограничения
 */
export function applyPriceCommand(text, current) {
  const args = text.replace(/^\/price(@\w+)?/i, '').replace(/^цена/i, '').trim();
  const f = { ...current, models: { ...(current.models || {}) } };
  if (!args) return { filter: f, message: null };
  if (/^(off|выкл|сброс|reset)$/i.test(args)) return { filter: { ...DEFAULT, models: {} }, message: 'Все ограничения цены сняты.' };

  let m = args.match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (m) {
    const [min, max] = [parseInt(m[1], 10), parseInt(m[2], 10)].sort((a, b) => a - b);
    return { filter: { ...f, min, max }, message: `Цена: от ${min} до ${max} €.` };
  }
  m = args.match(/^(min|мин)\s+(\d+|off)$/i);
  if (m) {
    const min = /off/i.test(m[2]) ? null : parseInt(m[2], 10);
    return { filter: { ...f, min }, message: min == null ? 'Минимум цены снят.' : `Минимум: ${min} €.` };
  }
  m = args.match(/^(max|макс)?\s*(\d+)$/i);
  if (m) return { filter: { ...f, max: parseInt(m[2], 10) }, message: `Максимум: ${parseInt(m[2], 10)} €.` };

  m = args.match(/^(.+?)\s+(\d+|off)$/i);
  if (m) {
    const model = identifyQuery(m[1])?.model;
    if (!model) return { error: `Не понял модель «${m[1]}». Пример: /price 15 Pro 550 · список моделей: /models` };
    if (/off/i.test(m[2])) {
      delete f.models[model];
      return { filter: f, message: `Лимит для ${model} снят.` };
    }
    f.models[model] = parseInt(m[2], 10);
    return { filter: f, message: `${model}: максимум ${f.models[model]} €.` };
  }
  return { error: 'Не понял. Примеры: /price 600 · /price 100-600 · /price 15 Pro 550 · /price off' };
}

/**
 * Разбор команды /sell (цены продажи в Украине, в гривнах). Возвращает { table, message } или { error }.
 *   /sell                      — показать
 *   /sell 15 Pro 256 32000     — iPhone 15 Pro 256 GB продаю за 32 000 ₴
 *   /sell 13 Pro 15500         — для любого объёма памяти
 *   /sell 15 Pro 256 off       — удалить
 *   /sell macbook air 13 m2 16/512 40000 — MacBook: диагональ, чип, RAM/SSD (RAM входит в ключ модели)
 *   /sell watch 9 45mm lte 12000 · /sell ipad air 5 256 lte 20000 · /sell s24 ultra 256 25000
 *   /sell off                  — очистить таблицу
 */
export function applySellCommand(text, current) {
  const args = text.replace(/^\/sell(@\w+)?/i, '').replace(/^продажа/i, '').trim();
  const table = { ...current };
  if (!args) return { table, message: null };
  if (/^(off|сброс|reset)$/i.test(args)) return { table: {}, message: 'Таблица цен продажи очищена.' };

  const m = args.match(/^(.+?)\s+(\d{3,6}|off)\s*(₴|грн|uah)?$/i);
  if (!m) return { error: 'Не понял. Пример: /sell 15 Pro 256 32000' };
  const q = identifyQuery(m[1]);
  if (!q) return { error: `Не понял модель «${m[1]}». Пример: /sell 15 Pro 256 32000 · список моделей: /models` };
  const { model } = q;
  const storage = q.variant || '*';
  const key = `${model}|${storage}`;
  const label = `${model}${storage === '*' ? ' (любой вариант)' : ` ${storage}`}`;
  if (/off/i.test(m[2])) {
    delete table[key];
    return { table, message: `${label}: удалено.` };
  }
  table[key] = parseInt(m[2], 10);
  return { table, message: `${label}: продаю за ${table[key].toLocaleString('ru-RU')} ₴.` };
}

export function describeSellTable(table, rate) {
  const rows = Object.entries(table).sort();
  if (!rows.length) return 'Пока пусто.';
  return rows
    .map(([key, uah]) => {
      const [model, storage] = key.split('|');
      const eur = rate?.uahPerEur ? ` ≈ ${Math.round(uah / rate.uahPerEur)} €` : '';
      return `• ${model}${storage === '*' ? '' : ` ${storage}`} — ${uah.toLocaleString('ru-RU')} ₴${eur}`;
    })
    .join('\n');
}

export function describePriceFilter(f) {
  const lines = [];
  if (f.min == null && f.max == null) lines.push('Общий диапазон: без ограничений');
  else lines.push(`Общий диапазон: ${f.min != null ? `от ${f.min} €` : ''}${f.min != null && f.max != null ? ' ' : ''}${f.max != null ? `до ${f.max} €` : ''}`);
  const models = Object.entries(f.models || {}).sort();
  if (models.length) {
    lines.push('Лимиты моделей:');
    for (const [model, cap] of models) lines.push(`  • ${model} — до ${cap} €`);
  }
  return lines.join('\n');
}
