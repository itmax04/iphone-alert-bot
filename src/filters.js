// Отбор и разбор объявлений. Модель распознаёт каталог (src/catalog.js): не распознано — не присылаем.
// Цена не ограничена. Дефекты и аксессуары не отсеиваем — только помечаем.
import { identify } from './catalog.js';

// Что включено в действующих лентах (города, MV, Германия). Каталог уже умеет iPhone 11/12, iPad, MacBook,
// Apple Watch, Samsung и Pixel — они включаются вместе с региональными лентами (этап 3), чтобы число
// сообщений не выросло раньше времени.
const ACTIVE_CATEGORIES = ['iphone'];
const MIN_IPHONE = 13;

const DEFECT_WORDS = [
  'defekt',
  'mängel',
  'kaputt',
  'gesprungen',
  'gebrochen',
  'riss',
  'ersatzteil',
  'bastler',
  'icloud gesperrt',
  'icloud-sperre',
  'icloud sperre',
  'aktivierungssperre',
  'gesperrt',
  'face id geht nicht',
  'faceid defekt',
];
const ACCESSORY_WORDS = [
  'hülle',
  'huelle',
  'case',
  'cover',
  'panzerglas',
  'schutzglas',
  'displayschutz',
  'ladekabel',
  'kabel',
  'netzteil',
  'ladegerät',
  'halterung',
  'magsafe',
  'airpods',
  'nur karton',
  'ovp leer',
];

function containsAny(text, words) {
  const lower = (text || '').toLowerCase();
  return words.find((w) => lower.includes(w)) || null;
}

// «keine Mängel», «nicht gesperrt», «ohne Riss» — это как раз отсутствие дефекта.
const NEGATION_BEFORE = /(kein|keine|keinen|keiner|nicht|ohne|frei von|null)\s+(\S+\s+){0,2}$/;

/** Слово-признак дефекта, если оно встречается без отрицания перед ним. */
function defectWord(text) {
  const lower = (text || '').toLowerCase();
  for (const w of DEFECT_WORDS) {
    let at = lower.indexOf(w);
    while (at !== -1) {
      if (!NEGATION_BEFORE.test(lower.slice(Math.max(0, at - 30), at))) return w;
      at = lower.indexOf(w, at + w.length);
    }
  }
  return null;
}

/** Ключ модели из заголовка, например «iPhone 15 Pro Max», или null, если модель не распознана или не включена. */
export function modelOf(title) {
  const r = identify(title);
  if (!r || !ACTIVE_CATEGORIES.includes(r.category)) return null;
  if (r.category === 'iphone' && r.gen < MIN_IPHONE) return null;
  return r.model;
}

export function storageOf(text) {
  const m = (text || '').match(/(\d{2,4})\s?gb|(1|2)\s?tb/i);
  if (!m) return null;
  return m[1] ? `${m[1]} GB` : `${m[2]} TB`;
}

export function batteryOf(text) {
  const m = (text || '').match(/(\d{2,3})\s?%\s?(akku|batterie|battery|kapazität)|(akku|batterie)[^0-9]{0,20}(\d{2,3})\s?%/i);
  const value = m ? parseInt(m[1] || m[4], 10) : null;
  return value && value <= 100 ? value : null;
}

/** Причина отказа или null. */
export function rejectReason(item) {
  if (!modelOf(item.title)) return 'модель не распознана';
  return null;
}

/** Пометки: возможный дефект, аксессуар, обмен. Не влияют на отбор. */
export function tagsOf(item) {
  const text = `${item.title} ${item.description}`;
  const tags = [];
  const defect = defectWord(text);
  if (defect) tags.push(`🔧 возможно дефект («${defect}»)`);
  // Аксессуар — если в заголовке есть такое слово, но нет объёма памяти (у телефонов его обычно пишут).
  const accessory = containsAny(item.title, ACCESSORY_WORDS);
  if (accessory && !storageOf(item.title)) tags.push(`🧩 возможно аксессуар («${accessory}»)`);
  if (/tausch/i.test(item.title)) tags.push('🔁 продавец рассматривает обмен');
  if (item.price != null && item.price < 50) tags.push('⚠️ подозрительно низкая цена');
  return tags;
}
