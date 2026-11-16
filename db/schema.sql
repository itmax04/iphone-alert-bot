-- Хранилище бота (Cloudflare D1).
-- Региональные ленты: состояние каждой ленты (порог и последние номера объявлений).
CREATE TABLE IF NOT EXISTS feeds (
  feed TEXT PRIMARY KEY,                -- ph-be, tab-hh, mac-mv, aw-be … (src/feeds.js)
  floor INTEGER NOT NULL DEFAULT 0,     -- номера объявлений не выше порога — старые
  recent TEXT NOT NULL DEFAULT '[]',    -- JSON: последние ~40 номеров выше порога
  page INTEGER NOT NULL DEFAULT 1,      -- > 1 — идёт дочитывание следующих страниц
  pending INTEGER NOT NULL DEFAULT 0,   -- 1 — страница переполнена и обработана не вся: после неё нужна следующая
  initialized INTEGER NOT NULL DEFAULT 0,
  last_ok INTEGER,
  fail_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  alerted INTEGER NOT NULL DEFAULT 0,
  muted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stats (
  day TEXT NOT NULL,            -- YYYY-MM-DD по Берлину
  city TEXT NOT NULL,           -- id ленты (исторически — город)
  checks INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, city)
);
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  city TEXT NOT NULL,            -- id ленты
  model TEXT,
  storage TEXT,
  battery INTEGER,
  price REAL,
  negotiable INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  location TEXT,
  url TEXT,
  sent_at INTEGER NOT NULL,
  msg_id INTEGER,                -- NULL — не присылалось (режим наблюдения)
  status TEXT NOT NULL DEFAULT 'new',
  class TEXT,                    -- deal | haggle | low | high | nomed | flag (src/select.js, evaluate)
  next_at INTEGER,               -- этап 5 («давно висят»): когда перепроверить; NULL — не кандидат
  check_n INTEGER NOT NULL DEFAULT 0,
  cur_price REAL,
  checked_at INTEGER,
  gone INTEGER NOT NULL DEFAULT 0,
  top_price REAL,
  s_offer REAL,
  s_pct REAL
);
CREATE INDEX IF NOT EXISTS items_city_sent ON items(city, sent_at);

-- Настройки (фильтр цены и т.п.), значение — JSON.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Цены всех распознанных объявлений (для медианы рынка и защиты от мошенников).
CREATE TABLE IF NOT EXISTS prices (
  id TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  storage TEXT,
  price REAL NOT NULL,
  seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS prices_model ON prices(model, storage, seen_at);
-- Медианы рынка: пересчёт раз в ночь из prices (storage = '*' — модель с любой памятью; model = '_meta' — отметка пересчёта).
CREATE TABLE IF NOT EXISTS market (
  model TEXT NOT NULL,
  storage TEXT NOT NULL,
  median REAL NOT NULL,
  p25 REAL NOT NULL,
  count INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (model, storage)
);

-- Индексы под ежесуточную чистку.
CREATE INDEX IF NOT EXISTS prices_seen_at ON prices(seen_at);
CREATE INDEX IF NOT EXISTS items_sent_at ON items(sent_at);
CREATE INDEX IF NOT EXISTS items_next ON items(next_at) WHERE next_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS items_checked ON items(checked_at) WHERE checked_at IS NOT NULL;
