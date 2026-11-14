// Рынок и маржа: медиана цен на Kleinanzeigen, ваши цены продажи в Украине, курс НБУ, признаки мошенничества.

const MARKET_DAYS = 30;
const MIN_SAMPLES = 5; // меньше — медиана ненадёжна, не показываем
const RATE_TTL = 12 * 3600 * 1000;
const DEFAULT_MARGIN_THRESHOLD = 80; // €, для 🔥 и звука

// --- Курс НБУ (bank.gov.ua, официальный открытый сервис) ---

export async function eurRate(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'rate'").first();
  const cached = row ? JSON.parse(row.value) : null;
  if (cached && Date.now() - cached.fetchedAt < RATE_TTL) return cached;
  try {
    const r = await fetch('https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=EUR&json');
    const [data] = await r.json();
    if (!data?.rate) throw new Error('нет курса');
    const fresh = { uahPerEur: data.rate, date: data.exchangedate, fetchedAt: Date.now() };
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('rate', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(JSON.stringify(fresh))
      .run();
    return fresh;
  } catch {
    return cached; // старый курс лучше, чем никакого
  }
}

// --- Ваши цены продажи (settings 'sell'): { "iPhone 15 Pro|256 GB": 32000, "iPhone 13|*": 14000 } в гривнах ---

export async function getSellTable(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'sell'").first();
  return row ? JSON.parse(row.value) : {};
}

export function saveSellTable(env, table) {
  return env.DB.prepare("INSERT INTO settings (key, value) VALUES ('sell', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(JSON.stringify(table))
    .run();
}

export async function getMarginThreshold(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'margin'").first();
  return row ? JSON.parse(row.value).min : DEFAULT_MARGIN_THRESHOLD;
}

export function saveMarginThreshold(env, min) {
  return env.DB.prepare("INSERT INTO settings (key, value) VALUES ('margin', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(JSON.stringify({ min }))
    .run();
}

/** Цена продажи в гривнах: сначала точная модель+память, потом модель с любой памятью. */
export function sellPriceUah(table, model, storage) {
  if (!model) return null;
  return table[`${model}|${storage || '*'}`] ?? table[`${model}|*`] ?? null;
}

/**
 * Маржа «чисто перепродажа»: цена продажи в Украине (по курсу НБУ) минус цена покупки.
 * @returns {{ marginEur, sellUah, sellEur }|null}
 */
export function marginOf(item, model, storage, table, rate) {
  const sellUah = sellPriceUah(table, model, storage);
  if (sellUah == null || item.price == null || !rate?.uahPerEur) return null;
  const sellEur = Math.round(sellUah / rate.uahPerEur);
  return { marginEur: Math.round(sellEur - item.price), sellUah, sellEur };
}

// --- Медиана рынка (все увиденные объявления той же модели и памяти за 30 дней) ---

export function recordPrice(env, item, model, storage, now) {
  if (!model || item.price == null || item.price < 50) return null;
  return env.DB.prepare('INSERT OR IGNORE INTO prices (id, model, storage, price, seen_at) VALUES (?, ?, ?, ?, ?)').bind(
    item.id,
    model,
    storage || null,
    item.price,
    now,
  );
}

// Честная медиана и нижний квартиль по каждой паре модель+память и по модели целиком.
// Окно: n — число цен ключа, rn — место цены по возрастанию; медиана — среднее двух средних (для нечётного n — одна).
const RECOMPUTE_SELECT = (storageExpr, partition) => `
  SELECT model, ${storageExpr} AS storage,
         AVG(CASE WHEN rn IN ((n + 1) / 2, (n + 2) / 2) THEN price END) AS median,
         MAX(CASE WHEN rn = (n + 3) / 4 THEN price END) AS p25,
         MAX(n) AS count
  FROM (
    SELECT model, storage, price,
           ROW_NUMBER() OVER (PARTITION BY ${partition} ORDER BY price) AS rn,
           COUNT(*) OVER (PARTITION BY ${partition}) AS n
    FROM prices WHERE seen_at > ?1 ${partition === 'model' ? '' : 'AND storage IS NOT NULL'}
  )
  GROUP BY ${partition}
  HAVING MAX(n) >= ?2`;

/** Операторы пересчёта таблицы market (выполнять одним batch: старое удаляется, новое пишется атомарно). */
export function recomputeStatements(db, now = Date.now()) {
  const since = now - MARKET_DAYS * 24 * 3600 * 1000;
  return [
    db.prepare('DELETE FROM market'),
    db
      .prepare(`INSERT INTO market (model, storage, median, p25, count, updated_at)
        SELECT model, storage, median, p25, count, ?3 FROM (${RECOMPUTE_SELECT('storage', 'model, storage')})`)
      .bind(since, MIN_SAMPLES, now),
    db
      .prepare(`INSERT INTO market (model, storage, median, p25, count, updated_at)
        SELECT model, storage, median, p25, count, ?3 FROM (${RECOMPUTE_SELECT("'*'", 'model')})`)
      .bind(since, MIN_SAMPLES, now),
    db.prepare("INSERT INTO market (model, storage, median, p25, count, updated_at) VALUES ('_meta', '*', 0, 0, 0, ?)").bind(now),
  ];
}

export async function recomputeMarket(env) {
  await env.DB.batch(recomputeStatements(env.DB));
}

let marketReady = false; // true — ночной пересчёт уже был, читаем только таблицу market
const marketCache = new Map(); // на время жизни запуска
const CACHE_TTL = 10 * 60 * 1000;

/** Старый способ (до первого пересчёта): 400 самых дешёвых цен — медиана занижена; только пока market пуста. */
async function legacyMedian(env, model, storage) {
  const since = Date.now() - MARKET_DAYS * 24 * 3600 * 1000;
  const sql = storage
    ? 'SELECT price FROM prices WHERE model = ? AND storage = ? AND seen_at > ? ORDER BY price LIMIT 400'
    : 'SELECT price FROM prices WHERE model = ? AND seen_at > ? ORDER BY price LIMIT 400';
  const args = storage ? [model, storage, since] : [model, since];
  const prices = (await env.DB.prepare(sql).bind(...args).all()).results.map((r) => r.price);
  if (prices.length < MIN_SAMPLES) return null;
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
  return { median: Math.round(median), count: prices.length };
}

/** @returns {{ median: number, p25: number|null, count: number }|null} */
export async function marketMedian(env, model, storage) {
  if (!model) return null;
  const key = `${model}|${storage || '*'}`;
  const hit = marketCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.value;
  let value;
  if (!marketReady) {
    marketReady = Boolean(await env.DB.prepare("SELECT 1 AS ok FROM market WHERE model = '_meta'").first());
  }
  if (marketReady) {
    const row = await env.DB.prepare('SELECT median, p25, count FROM market WHERE model = ? AND storage = ?')
      .bind(model, storage || '*')
      .first();
    value = row ? { median: Math.round(row.median), p25: Math.round(row.p25), count: row.count } : null;
  } else {
    value = await legacyMedian(env, model, storage); // до первого ночного пересчёта не кэшируем надолго
    return value;
  }
  marketCache.set(key, { at: Date.now(), value });
  return value;
}

// --- Признаки мошенничества ---

const SCAM_PHRASES = [
  ['nur versand', 'только отправка почтой'],
  ['nur per versand', 'только отправка почтой'],
  ['versand only', 'только отправка почтой'],
  ['paypal freunde', 'PayPal «для друзей» — без защиты покупателя'],
  ['freunde und familie', 'PayPal «для друзей» — без защиты покупателя'],
  ['friends and family', 'PayPal «для друзей» — без защиты покупателя'],
  ['vorkasse', 'предоплата'],
  ['zahlung im voraus', 'предоплата'],
  ['vorauszahlung', 'предоплата'],
  ['überweisung vorab', 'предоплата переводом'],
  ['western union', 'Western Union'],
  ['moneygram', 'MoneyGram'],
  ['whatsapp', 'просит перейти в WhatsApp'],
  ['telegram', 'просит перейти в Telegram'],
  ['bin im ausland', 'продавец «за границей»'],
  ['zurzeit im ausland', 'продавец «за границей»'],
  ['derzeit im ausland', 'продавец «за границей»'],
  ['bin beruflich unterwegs', 'продавец «в командировке»'],
];

/**
 * @returns {{ warnings: string[], dealPercent: number|null }}
 *   dealPercent — на сколько % дешевле медианы (отрицательное — дороже).
 */
export function scamAndDeal(item, market) {
  const warnings = [];
  const text = `${item.title} ${item.description}`.toLowerCase();
  for (const [phrase, label] of SCAM_PHRASES) {
    if (text.includes(phrase) && !warnings.includes(label)) warnings.push(label);
  }
  let dealPercent = null;
  if (market && item.price != null) {
    dealPercent = Math.round((1 - item.price / market.median) * 100);
    const sealed = /(neu|ovp|versiegelt|verschweißt|verschweisst|sealed)/i.test(item.title);
    if (item.price < market.median * 0.5) warnings.unshift(`цена в 2+ раза ниже обычной (${market.median} €) — частый признак обмана`);
    else if (sealed && item.price < market.median * 0.7) warnings.unshift('«новый/в плёнке» и при этом намного дешевле рынка');
  }
  return { warnings, dealPercent };
}
