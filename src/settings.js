// Фильтр цены. Хранится в D1 (settings, key = 'price'), задаётся в боте командой /price.
//   min / max — общий диапазон цены, € (null — без ограничения);
//   models — максимальная цена для конкретной модели, например { "iPhone 15 Pro": 550 }.
// Лимит модели важнее общего максимума. Объявления без цены («VB», «Zu verschenken») не отсеиваются.

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

/** Причина отказа по цене или null. */
export function priceRejectReason(item, model, filter) {
  if (item.price == null) return null;
  const cap = filter.models?.[model] ?? filter.max;
  if (cap != null && item.price > cap) return `${item.price} € > ${cap} €`;
  if (filter.min != null && item.price < filter.min) return `${item.price} € < ${filter.min} €`;
  return null;
}

/** Нормализует название модели из команды: «15 pro max» → «iPhone 15 Pro Max». */
function normalizeModel(text) {
  const t = text
    .replace(/^\s*(apple\s+)?i\s?phone\s*/i, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!t) return null;
  const words = t.split(' ').map((w) => (/^\d+e$/.test(w) ? w : w[0].toUpperCase() + w.slice(1)));
  return `iPhone ${words.join(' ')}`;
}

/**
 * Разбор команды /price. Возвращает { filter, message } или { error }.
 *   /price            — показать
 *   /price 600        — максимум 600 €
 *   /price 100-600    — от 100 до 600 €
 *   /price min 80     — только минимум
 *   /price 15 Pro 550 — максимум для модели (iPhone 15 Pro)
 *   /price 15 Pro off — убрать лимит модели
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
    const model = normalizeModel(m[1]);
    if (!model || !/iPhone (1[3-9]|2\d|Air|Fold)/.test(model)) return { error: `Не понял модель «${m[1]}». Пример: /price 15 Pro 550` };
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
 *   /sell off                  — очистить таблицу
 */
export function applySellCommand(text, current) {
  const args = text.replace(/^\/sell(@\w+)?/i, '').replace(/^продажа/i, '').trim();
  const table = { ...current };
  if (!args) return { table, message: null };
  if (/^(off|сброс|reset)$/i.test(args)) return { table: {}, message: 'Таблица цен продажи очищена.' };

  const m = args.match(/^(.+?)\s+(\d{3,6}|off)\s*(₴|грн|uah)?$/i);
  if (!m) return { error: 'Не понял. Пример: /sell 15 Pro 256 32000' };
  let modelText = m[1];
  let storage = '*';
  const st = modelText.match(/\s(64|128|256|512|1024)\s*(gb)?$|\s(1|2)\s*tb$/i);
  if (st) {
    storage = st[1] ? `${st[1] === '1024' ? '1 TB' : `${st[1]} GB`}` : `${st[3]} TB`;
    modelText = modelText.slice(0, st.index);
  }
  const model = normalizeModel(modelText);
  if (!model || !/iPhone (1[3-9]|2\d|Air|Fold)/.test(model)) return { error: `Не понял модель «${modelText}». Пример: /sell 15 Pro 256 32000` };
  const key = `${model}|${storage}`;
  const label = `${model}${storage === '*' ? ' (любая память)' : ` ${storage}`}`;
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
