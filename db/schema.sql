-- Хранилище iPhone-бота (Cloudflare D1).
CREATE TABLE IF NOT EXISTS seen (
  id TEXT PRIMARY KEY,          -- ka:<id объявления>
  city TEXT NOT NULL,
  first_seen INTEGER NOT NULL,  -- мс
  sent INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS seen_first_seen ON seen(first_seen);

CREATE TABLE IF NOT EXISTS city_state (
  city TEXT PRIMARY KEY,
  initialized INTEGER NOT NULL DEFAULT 0,
  last_ok INTEGER,
  fail_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  alerted INTEGER NOT NULL DEFAULT 0,
  muted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stats (
  day TEXT NOT NULL,            -- YYYY-MM-DD по Берлину
  city TEXT NOT NULL,
  checks INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, city)
);
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  city TEXT NOT NULL,
  model TEXT,
  storage TEXT,
  battery INTEGER,
  price REAL,
  negotiable INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  location TEXT,
  url TEXT,
  sent_at INTEGER NOT NULL,
  msg_id INTEGER,
  status TEXT NOT NULL DEFAULT 'new'
);
CREATE INDEX IF NOT EXISTS items_city_sent ON items(city, sent_at);

-- Настройки (фильтр цены и т.п.), значение — JSON.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Выключенные города.
-- Цены всех увиденных iPhone 13+ (для медианы рынка и защиты от мошенников).
CREATE TABLE IF NOT EXISTS prices (
  id TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  storage TEXT,
  price REAL NOT NULL,
  seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS prices_model ON prices(model, storage, seen_at);
-- Лучшие предложения по Германии.
CREATE TABLE IF NOT EXISTS deal_seen (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS deal_seen_ts ON deal_seen(ts);

CREATE TABLE IF NOT EXISTS deals (
  id TEXT PRIMARY KEY,
  model TEXT,
  storage TEXT,
  price REAL,
  median REAL,
  samples INTEGER,
  discount INTEGER,       -- % дешевле медианы
  margin INTEGER,         -- € (если задана цена продажи)
  score REAL NOT NULL,
  kind TEXT NOT NULL,     -- exceptional | good
  title TEXT,
  location TEXT,
  url TEXT,
  image TEXT,
  note TEXT,              -- «nur Versand» и т.п.
  found_at INTEGER NOT NULL,
  sent_at INTEGER         -- когда отправлено (мгновенно или в сводке)
);
CREATE INDEX IF NOT EXISTS deals_pending ON deals(sent_at, found_at);

-- Обход всей земли MV раз в 3 часа: что уже обработано.
CREATE TABLE IF NOT EXISTS mv_seen (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL
);
