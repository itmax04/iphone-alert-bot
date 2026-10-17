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
