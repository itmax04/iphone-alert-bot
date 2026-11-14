// Отбор и разбор объявлений. Модель распознаёт каталог (src/catalog.js): не распознано — не присылаем.
// Дефекты и аксессуары не отсеиваем — только помечаем.
import { identify } from './catalog.js';

// Что включено в лентах (src/feeds.js). iPhone — с 11-го.
const ACTIVE_CATEGORIES = ['iphone', 'ipad', 'macbook', 'watch', 'samsung', 'pixel'];
const MIN_IPHONE = 11;

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

/**
 * Распознанное объявление { category, model, variant } или null, если модель не распознана или не включена.
 * variant — вариант для ключа рынка из каталога (память, «256 GB LTE», SSD, GPS/LTE) или null.
 */
export function recognize(title, description = '') {
  const r = identify(title, description);
  if (!r || !ACTIVE_CATEGORIES.includes(r.category)) return null;
  if (r.category === 'iphone' && r.gen < MIN_IPHONE) return null;
  return r;
}

/** Ключ модели из заголовка, например «iPhone 15 Pro Max», или null. */
export function modelOf(title) {
  return recognize(title)?.model ?? null;
}

export function batteryOf(text) {
  const m = (text || '').match(/(\d{2,3})\s?%\s?(akku|batterie|battery|kapazität)|(akku|batterie)[^0-9]{0,20}(\d{2,3})\s?%/i);
  const value = m ? parseInt(m[1] || m[4], 10) : null;
  return value && value <= 100 ? value : null;
}

/** Пометки: возможный дефект, аксессуар, обмен. rec — результат recognize(). */
export function tagsOf(item, rec) {
  const text = `${item.title} ${item.description}`;
  const tags = [];
  const defect = defectWord(text);
  if (defect) tags.push(`🔧 возможно дефект («${defect}»)`);
  // Аксессуар — если в заголовке есть такое слово, а варианта (памяти) каталог не нашёл. У часов памяти не пишут.
  const accessory = containsAny(item.title, ACCESSORY_WORDS);
  if (accessory && !rec?.variant && rec?.category !== 'watch') tags.push(`🧩 возможно аксессуар («${accessory}»)`);
  if (/tausch/i.test(item.title)) tags.push('🔁 продавец рассматривает обмен');
  return tags;
}
