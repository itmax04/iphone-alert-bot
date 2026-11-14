// Каталог моделей: уверенное распознавание и канонические ключи для market, /sell, /price.
//
//   identify(title, description) → { category, model, variant, gen? } или null.
//     model   — ключ модели (колонка prices.model / market.model, ключи /sell и /price);
//     variant — значение для колонки storage: «256 GB», «256 GB LTE» (iPad), «GPS»/«LTE» (Watch),
//               объём SSD (MacBook; RAM входит в ключ модели) или null.
//
// Правило: заголовок должен однозначно дать ключ целиком. Сомнение — null (объявление не присылается и
// не попадает в prices). Ключи iPhone совпадают с прежними («iPhone 15 Pro Max»).
// Все RegExp собраны один раз на уровне модуля (10 мс CPU); вызывается только для новых объявлений.

const norm = (s) =>
  (s || '')
    .toLowerCase()
    .replace(/[   ]/g, ' ')
    .replace(/[“”„‟″]|''|’’|´´/g, '"')
    .replace(/[‐‑–—]/g, '-');

// --- общие отсечки (по заголовку) ---
const WANTED_RE = /^\W*(suche|gesucht|ankauf|kaufe)(?![a-zäöü])/; // «Suche iPhone…» — это не предложение
const LOT_RE = /konvolut|sammlung|(^|\s)[2-9]\s?(x|stück|stk\.?)\s/; // несколько устройств одной ценой
// «Hülle für iPhone 15», «Tausch gegen MacBook» — устройство названо, но продаётся не оно.
const FOR_RE = /(^|\s)(für|fuer|for|gegen|passend|kompatibel mit)\s+(\S+\s+){0,2}$/;
// Аксессуар: слово-аксессуар в заголовке, перед ним нет «mit/inkl/+/&/,», и объём памяти не указан.
const ACCESSORY_RE = /hülle|huelle|case|cover|panzerglas|schutzglas|displayschutz|folie|ladekabel|netzteil|ladegerät|halterung|armband|tastatur|keyboard|pencil|stift|originalverpackung|leerkarton|nur karton|ovp leer|dockingstation|ständer/;
const CONNECTOR_RE = /(^|\s)(mit|inkl\.?|incl\.?|inklusive|samt|plus|und)\s|[+&,]/;

// Семейства. Два разных семейства в заголовке (iPhone + Apple Watch) — комплект, цену не сравнить → null.
const FAMILIES = [
  ['iphone', /\bi\s?phone/g],
  ['ipad', /\bi\s?pad/g],
  ['macbook', /mac\s?book/g],
  ['watch', /watch/g],
  ['samsung', /galaxy|samsung/g],
  ['pixel', /pixel/g],
];

// --- объём памяти ---
const CAP_RE = /(?<!\d|\d[.,])(\d{1,4})\s?(gb|tb)(?![a-z])/g;
const PHONE_STORAGE = new Set([64, 128, 256, 512, 1024, 2048]);
const MAC_SSD = new Set([256, 512, 1024, 2048, 4096, 8192]);
const MAC_RAM = new Set([8, 16, 18, 24, 32, 36, 48, 64, 96, 128]);
const SSD_ALIAS = { 250: 256, 500: 512, 1000: 1024 };

/** Все объёмы из текста в ГБ, по порядку. */
function capacities(t) {
  const out = [];
  for (const m of t.matchAll(CAP_RE)) out.push(m[2] === 'tb' ? parseInt(m[1], 10) * 1024 : parseInt(m[1], 10));
  return out;
}
const fmtCap = (gb) => (gb >= 1024 ? `${gb / 1024} TB` : `${gb} GB`);
function pickStorage(t, valid) {
  const gb = capacities(t).find((c) => valid.has(c));
  return gb ? fmtCap(gb) : null;
}

const LTE_RE = /cellular|(?<![a-z\d])lte(?![a-z\d])|(?<![a-z\d])[45]g(?![a-z\d])/;
const NO_LTE_RE = /(kein|keine|ohne|nicht|no)\s+(\S+\s+)?(cellular|lte|sim)|nur\s+(wi-?fi|wlan)|(wi-?fi|wlan)\s+only/;
const WIFI_RE = /wi-?fi|wlan/;
/** Есть ли сотовый модуль. Заголовок важнее описания; «Kein Cellular», «nur WLAN» — нет. */
function hasLte(t, d) {
  if (LTE_RE.test(t)) return !NO_LTE_RE.test(t);
  if (WIFI_RE.test(t) || NO_LTE_RE.test(d)) return false;
  return LTE_RE.test(d);
}
const YEAR_RE = /(?<!\d)(20[12]\d)(?!\d)/;

/** Единственное значение из набора или undefined (пусто), null (противоречие). */
function single(set) {
  if (set.size === 0) return undefined;
  return set.size === 1 ? [...set][0] : null;
}

// ---------------------------------------------------------------- iPhone
const IPHONE_RE = /\bi\s?phone\s*(?:(1[1-9]|2\d)(?!\d)\s*(?:(pro\s*max|pro|plus|mini|air|max|e)(?![a-zäöü]))?|(air|fold)(?![a-zäöü]))/g;

function iphoneName(m) {
  if (m[3]) return m[3] === 'air' ? { model: 'iPhone Air', gen: 17 } : { model: 'iPhone Fold', gen: 18 };
  const n = parseInt(m[1], 10);
  const v = (m[2] || '').replace(/\s+/g, '');
  if (v === 'max') return null; // «14 Max» — Pro Max или Plus? непонятно
  if (v === 'mini' && n !== 12 && n !== 13) return null;
  if (v === 'e' && n < 16) return null;
  if (v === 'plus' && n < 14) return null;
  if (v === 'air') return n === 17 ? { model: 'iPhone Air', gen: 17 } : n > 17 ? { model: `iPhone ${n} Air`, gen: n } : null;
  const suffix = { '': '', e: 'e', pro: ' Pro', promax: ' Pro Max', plus: ' Plus', mini: ' Mini' }[v] // «Mini» с большой буквы — как в уже накопленных ключах;
  return { model: `iPhone ${n}${suffix}`, gen: n };
}

function parseIphone(t, d) {
  const found = new Map();
  for (const m of t.matchAll(IPHONE_RE)) {
    const r = iphoneName(m);
    if (!r) return null;
    found.set(r.model, r);
  }
  if (found.size !== 1) return null;
  const r = [...found.values()][0];
  return { category: 'iphone', model: r.model, gen: r.gen, variant: pickStorage(`${t} ${d}`, PHONE_STORAGE) };
}

// ---------------------------------------------------------------- Samsung
const GALAXY_S_RE = /(?:galaxy|samsung)\s*(?:galaxy\s*)?s\s?(2[1-9]|3\d)(?!\d)\s*(?:(ultra|plus|\+|fe|edge)(?![a-zäöü]))?/g;
const GALAXY_Z_RE = /(?:galaxy|samsung)\s*(?:galaxy\s*)?(?:z\s*)?(fold|flip)\s?(\d{1,2})(?!\d)\s*(?:(fe)(?![a-zäöü]))?/g;

function parseSamsung(t, d) {
  const found = new Set();
  for (const m of t.matchAll(GALAXY_S_RE)) {
    const v = m[2] || '';
    found.add(`Galaxy S${m[1]}${v === 'plus' || v === '+' ? '+' : v === 'ultra' ? ' Ultra' : v === 'fe' ? ' FE' : v === 'edge' ? ' Edge' : ''}`);
  }
  for (const m of t.matchAll(GALAXY_Z_RE)) {
    if (parseInt(m[2], 10) < 3) return null;
    found.add(`Galaxy Z ${m[1] === 'fold' ? 'Fold' : 'Flip'}${m[2]}${m[3] ? ' FE' : ''}`);
  }
  if (found.size !== 1) return null;
  return { category: 'samsung', model: [...found][0], variant: pickStorage(`${t} ${d}`, PHONE_STORAGE) };
}

// ---------------------------------------------------------------- Pixel
const PIXEL_RE = /pixel\s*(?:(\d{1,2})(?!\d)\s*(?:(pro\s*xl|pro\s*fold|pro|xl|fold|a)(?![a-zäöü]))?|(fold)(?![a-zäöü]))/g;

function parsePixel(t, d) {
  const found = new Set();
  for (const m of t.matchAll(PIXEL_RE)) {
    if (m[3]) {
      found.add('Pixel Fold');
      continue;
    }
    const n = parseInt(m[1], 10);
    const v = (m[2] || '').replace(/\s+/g, '');
    if (n < 6 || v === 'xl' || v === 'fold') return null; // «Pixel 9 XL», «Pixel 9 Fold» — таких моделей нет
    found.add(`Pixel ${n}${{ '': '', a: 'a', pro: ' Pro', proxl: ' Pro XL', profold: ' Pro Fold' }[v]}`);
  }
  if (found.size !== 1) return null;
  return { category: 'pixel', model: [...found][0], variant: pickStorage(`${t} ${d}`, PHONE_STORAGE) };
}

// ---------------------------------------------------------------- Apple Watch (Series 7+ и Ultra)
const WATCH_RE = /(?:apple|appel)\s*(?:smart\s*)?watch/;
const WATCH_SE_RE = /(?<![a-z\d])se(?![a-z])/;
const WATCH_ULTRA_RE = /ultra\s*(\d)?(?!\d|\s?mm)/;
const WATCH_SERIES_RE = /^\s*(?:series|serie|s)?\s*(\d{1,2})(?!\d|\s?mm|\s?gb)|(?:series|serie)\s*(\d{1,2})(?!\d|\s?mm)/;
const WATCH_MM_RE = /(?<!\d)(4\d)\s?mm/g;

function parseWatch(t, d) {
  const w = WATCH_RE.exec(t);
  if (!w) return null;
  const rest = t.slice(w.index + w[0].length);
  if (WATCH_SE_RE.test(rest)) return null;
  const ultra = WATCH_ULTRA_RE.exec(rest);
  const series = WATCH_SERIES_RE.exec(rest);
  if (ultra && series) return null; // «Watch 4 Ultra» — непонятно, что это
  let sizes = new Set([...t.matchAll(WATCH_MM_RE)].map((m) => parseInt(m[1], 10)));
  if (sizes.size === 0) sizes = new Set([...d.matchAll(WATCH_MM_RE)].map((m) => parseInt(m[1], 10)));
  const mm = single(sizes);
  if (mm === null) return null;
  if (ultra) {
    if (mm !== undefined && mm !== 49) return null;
    const n = ultra[1] ? parseInt(ultra[1], 10) : 1;
    if (n < 1) return null;
    return { category: 'watch', model: `Apple Watch Ultra${n > 1 ? ` ${n}` : ''} 49mm`, variant: null };
  }
  if (!series) return null;
  const n = parseInt(series[1] || series[2], 10);
  if (n < 7 || n > 19 || mm === undefined) return null;
  if (!(n <= 9 ? mm === 41 || mm === 45 : mm === 42 || mm === 46)) return null;
  // Сталь и титан бывают только с LTE и стоят дороже алюминия — отдельный вариант.
  const all = `${t} ${d}`;
  const variant = /edelstahl|stainless|steel/.test(all) ? 'LTE Edelstahl' : /titan/.test(all) ? 'LTE Titan' : hasLte(t, d) ? 'LTE' : 'GPS';
  return { category: 'watch', model: `Apple Watch Series ${n} ${mm}mm`, variant };
}

// ---------------------------------------------------------------- iPad
// Линейка — сразу после «iPad» (допускается диагональ между ними: «iPad 11" Air»).
const IPAD_LINE_RE = /\bi\s?pad\s*(?:\d{1,2}(?:[.,]\d)?\s*(?:"|zoll|inch)?\s*)?(pro|air|mini)(?![a-zäöü])/;
const IPAD_BARE_RE = /\bi\s?pad\s*(?:pro|air|mini)?\s*(\d{1,2})(?![\d"]|[.,]\d|\.|\s*(?:zoll|inch|gb|"))/;
const IPAD_GEN_RE = /(?<!\d)(\d{1,2})\s*\.?\s*(?:te|th|rd|nd|st)?\.?\s*\(?\s*gen|gen(?:eration)?\.?\s*(\d{1,2})(?!\d)/g;
const IPAD_SIZE_RE = /(?<![\d.,])(11|12[.,]9|13)\s*-?\s*(?:"|zoll|inch)|\bi\s?pad\s*(?:pro|air)\s*(11|12[.,]9|13)(?![\d.,]\d|\d)/g;
const M_CHIP_RE = /(?<![a-z\d])m([1-9])(?![a-z\d])(?:\s*(pro|max|ultra)(?![a-zäöü]))?/g;
const A_CHIP_RE = /(?<![a-z\d])a(1[3-9])(?!\d)/g;

const PRO_GEN = { S: { 3: 1, 4: 2, 5: 4 }, L: { 5: 1, 6: 2, 7: 4 } }; // поколение → чип M
const PRO_YEAR = { 2021: 1, 2022: 2, 2024: 4, 2025: 5 };

function ipadAttrs(text, line) {
  const gens = new Set();
  for (const m of text.matchAll(IPAD_GEN_RE)) gens.add(parseInt(m[1] || m[2], 10));
  const sizes = new Set();
  for (const m of text.matchAll(IPAD_SIZE_RE)) sizes.add((m[1] || m[2]).startsWith('11') ? 'S' : 'L');
  const mChips = new Set([...text.matchAll(M_CHIP_RE)].map((m) => parseInt(m[1], 10)));
  const aChips = new Set([...text.matchAll(A_CHIP_RE)].map((m) => parseInt(m[1], 10)));
  let gen = single(gens);
  let size = single(sizes);
  const bare = IPAD_BARE_RE.exec(text);
  if (bare) {
    const n = parseInt(bare[1], 10);
    // У Pro голое число — диагональ, у Air 11/13 — диагональ, иначе — поколение.
    if (line === 'pro' || (line === 'air' && n > 10)) {
      if (size === undefined && (n === 11 || n === 13)) size = n === 11 ? 'S' : 'L';
    } else if (gen === undefined) gen = n;
    else if (gen !== n) gen = null;
  }
  const year = YEAR_RE.exec(text);
  return { gen, size, m: single(mChips), a: single(aChips), year: year ? parseInt(year[1], 10) : undefined };
}

function ipadModel(line, { gen, size, m, a, year }) {
  if (gen === null || size === null || m === null || a === null) return null;
  if (line === 'pro') {
    if (!size) return null;
    let chip = m;
    if (gen !== undefined) {
      const byGen = PRO_GEN[size][gen];
      if (!byGen || (chip !== undefined && chip !== byGen)) return null;
      chip = byGen;
    }
    if (chip === undefined) chip = PRO_YEAR[year];
    if (!chip || chip === 3) return null;
    return `iPad Pro ${size === 'S' ? '11' : chip <= 2 ? '12.9' : '13'}" M${chip}`;
  }
  if (line === 'air') {
    let g = gen;
    if (g === undefined && m === 1) g = 5;
    if (g === undefined && a === 14) g = 4;
    if (g === 4 || g === 5) return (g === 5 && m !== undefined && m !== 1) || (g === 4 && m !== undefined) ? null : `iPad Air ${g}`;
    if (g !== undefined && g < 4) return null;
    let chip = m ?? { 6: 2, 7: 3 }[g];
    if (chip === undefined && g === undefined) {
      if (year === 2020) return 'iPad Air 4';
      if (year === 2022) return 'iPad Air 5';
      chip = { 2024: 2, 2025: 3 }[year];
    }
    if (!chip || chip < 2 || !size) return null;
    return `iPad Air ${size === 'S' ? '11' : '13'}" M${chip}`;
  }
  if (m !== undefined) return null; // у mini и обычного iPad чипов M нет
  if (line === 'mini') {
    const g = gen ?? { 15: 6, 17: 7 }[a] ?? { 2021: 6, 2024: 7 }[year];
    return g === 6 || g === 7 ? `iPad mini ${g}` : null;
  }
  const byChip = { 13: 9, 14: 10, 16: 11 }[a];
  if (gen !== undefined && byChip !== undefined && gen !== byChip) return null;
  const g = gen ?? byChip ?? { 2021: 9, 2022: 10, 2025: 11 }[year];
  return g >= 9 && g <= 19 ? `iPad ${g}` : null;
}

function parseIpad(t, d) {
  const line = (IPAD_LINE_RE.exec(t) || [])[1] || 'base';
  const model = ipadModel(line, ipadAttrs(t, line)) || (d ? ipadModel(line, ipadAttrs(`${t} ${d}`, line)) : null);
  if (!model) return null;
  const all = `${t} ${d}`;
  const storage = pickStorage(all, PHONE_STORAGE);
  return { category: 'ipad', model, variant: storage ? `${storage}${hasLte(t, d) ? ' LTE' : ''}` : null };
}

// ---------------------------------------------------------------- MacBook (только Apple Silicon)
const MAC_LINE_RE = /mac\s?book\s*(air|pro)(?![a-zäöü])/;
const MAC_INTEL_RE = /intel|core\s?i\d|(?<![a-z\d])i[3579](?![a-z\d])|(?<!\d)20(0\d|1\d)(?!\d)/;
const MAC_SIZE_RE = /(?<![\d.,])(1[3-6])(?:[.,]\d)?\s*-?\s*(?:"|zoll|inch|')|(?:air|pro)\s*(1[3-6])(?!\d|[.,]\d|\s?gb|\s?\/)|(?<![\d.,])(1[3-6])"?\s*mac\s?book/g;
const MAC_PAIR_RE = /(?<![\d.,/])(8|16|18|24|32|36|48|64|96|128)\s?(?:gb)?\s?[/+]\s?(?:(256|512)(?:\s?gb)?|([1248])\s?tb)(?![\da-z/])/g;

function macAttrs(text) {
  const chips = new Set([...text.matchAll(M_CHIP_RE)].map((m) => `${m[1]}${m[2] ? ` ${m[2]}` : ''}`));
  const sizes = new Set();
  for (const m of text.matchAll(MAC_SIZE_RE)) sizes.add(parseInt(m[1] || m[2] || m[3], 10));
  const rams = new Set();
  const ssds = new Set();
  for (const c of capacities(text)) {
    const ssd = SSD_ALIAS[c] || c;
    if (c <= 128 && MAC_RAM.has(c)) rams.add(c);
    else if (MAC_SSD.has(ssd)) ssds.add(ssd);
  }
  for (const m of text.matchAll(MAC_PAIR_RE)) {
    rams.add(parseInt(m[1], 10));
    ssds.add(m[2] ? parseInt(m[2], 10) : parseInt(m[3], 10) * 1024);
  }
  const year = YEAR_RE.exec(text);
  return { chip: single(chips), size: single(sizes), ram: single(rams), ssd: single(ssds), year: year ? parseInt(year[1], 10) : undefined };
}

function macModel(line, { chip, size, ram, year }) {
  if (!chip || size === null || !ram) return null; // RAM обязательна: без неё ключ не собрать
  const [num, tier] = chip.split(' ');
  const n = parseInt(num, 10);
  let s = size;
  if (line === 'air') {
    if (tier) return null;
    // Air M1 был только 13"; Air M2 в 2022 году — тоже (15" вышел в 2023).
    if (s === undefined && (n === 1 || (n === 2 && year === 2022))) s = 13;
    if (s !== 13 && s !== 15) return null;
    if (s === 15 && n < 2) return null;
  } else {
    if (s === undefined) return null;
    if (s === 15) return null;
    if (s === 13 && (tier || n > 2)) return null; // Pro 13" — только M1 и M2
    if (s !== 13 && !tier && n < 3) return null; // Pro 14"/16" с M1/M2 — только Pro/Max
    if (s === 16 && !tier && n <= 5) return null; // обычный M3–M5 — только 14"
  }
  const chipName = `M${n}${tier ? ` ${tier[0].toUpperCase()}${tier.slice(1)}` : ''}`;
  return `MacBook ${line === 'air' ? 'Air' : 'Pro'} ${s}" ${chipName} ${ram}GB`;
}

function parseMacbook(t, d) {
  const line = (MAC_LINE_RE.exec(t) || [])[1];
  if (!line || MAC_INTEL_RE.test(t)) return null;
  let attrs = macAttrs(t);
  let model = macModel(line, attrs);
  if (!model && d && !MAC_INTEL_RE.test(d)) {
    attrs = macAttrs(`${t} ${d}`);
    model = macModel(line, attrs);
  }
  if (!model) return null;
  const ssd = attrs.ssd ?? macAttrs(`${t} ${d}`).ssd;
  return { category: 'macbook', model, variant: ssd ? fmtCap(ssd) : null };
}

const PARSERS = { iphone: parseIphone, ipad: parseIpad, macbook: parseMacbook, watch: parseWatch, samsung: parseSamsung, pixel: parsePixel };

/** Распознаёт объявление. Заголовок решает, описание — только для недостающих признаков. */
export function identify(title, description = '') {
  const t = norm(title);
  if (!t || WANTED_RE.test(t) || LOT_RE.test(t)) return null;
  let family = null;
  for (const [name, re] of FAMILIES) {
    for (const m of t.matchAll(re)) {
      if (family && family !== name) return null;
      if (FOR_RE.test(t.slice(0, m.index))) return null;
      family = name;
    }
  }
  if (!family) return null;
  const acc = ACCESSORY_RE.exec(t);
  if (acc && !CONNECTOR_RE.test(t.slice(0, acc.index)) && capacities(t).length === 0) return null;
  return PARSERS[family](t, norm(description));
}

// ---------------------------------------------------------------- модель из команды (/sell, /price)
const Q_FAMILY_RE = /i\s?phone|i\s?pad|mac\s?book|watch|galaxy|samsung|pixel/i;

/**
 * Модель из текста команды: «15 Pro 256», «s24 ultra 256», «pixel 8 pro», «ipad air 5 256 lte»,
 * «watch 9 45mm lte», «macbook air 13 m2 16/512». Возвращает { category, model, variant } или null;
 * variant — null, если в команде его нет (тогда цена действует для любого варианта).
 */
export function identifyQuery(text) {
  let q = (text || '').trim().replace(/\s+/g, ' ');
  if (!q) return null;
  // «… 256» в конце — объём памяти; «1024» — 1 TB.
  q = q.replace(/(\s)(64|128|256|512|1024)( lte| cellular)?$/i, (_, sp, n, lte) => `${sp}${n === '1024' ? '1 TB' : `${n} GB`}${lte || ''}`);
  let full = q;
  if (!Q_FAMILY_RE.test(q)) {
    if (/(^|\s)m[1-9](\s|$)/i.test(q)) full = `MacBook ${q}`;
    else if (/^(s\s?\d\d|z\s|(fold|flip)\s?\d)/i.test(q)) full = `Galaxy ${q}`;
    else if (/^(ultra|series|serie)(\s|\d|$)/i.test(q)) full = `Apple Watch ${q}`;
    else full = `iPhone ${q}`;
  } else if (/^watch/i.test(q)) full = `Apple ${q}`;
  const r = identify(full);
  if (!r) return null;
  let variant = r.variant;
  if (r.category === 'watch' && !/gps|lte|cellular/i.test(q)) variant = null;
  return { category: r.category, model: r.model, variant };
}
