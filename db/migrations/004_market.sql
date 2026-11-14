-- Медианы рынка, пересчитываются раз в ночь из prices (вместо чтения ~3 900 строк на каждое объявление).
-- storage = '*' — строка «модель с любой памятью». Строка model = '_meta' — отметка, что пересчёт уже был.
CREATE TABLE IF NOT EXISTS market (
  model TEXT NOT NULL,
  storage TEXT NOT NULL,
  median REAL NOT NULL,
  p25 REAL NOT NULL,
  count INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (model, storage)
);

-- Индексы под ежесуточную чистку (без них DELETE перебирает всю таблицу).
CREATE INDEX IF NOT EXISTS prices_seen_at ON prices(seen_at);
CREATE INDEX IF NOT EXISTS mv_seen_ts ON mv_seen(ts);
CREATE INDEX IF NOT EXISTS items_sent_at ON items(sent_at);
CREATE INDEX IF NOT EXISTS deals_found_at ON deals(found_at);
