-- Найденные и присланные объявления: для просмотра городов и писем продавцам.
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
ALTER TABLE city_state ADD COLUMN muted INTEGER NOT NULL DEFAULT 0;
