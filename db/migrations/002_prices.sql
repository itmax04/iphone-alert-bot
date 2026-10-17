-- Цены всех увиденных iPhone 13+ (для медианы рынка и защиты от мошенников).
CREATE TABLE IF NOT EXISTS prices (
  id TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  storage TEXT,
  price REAL NOT NULL,
  seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS prices_model ON prices(model, storage, seen_at);
