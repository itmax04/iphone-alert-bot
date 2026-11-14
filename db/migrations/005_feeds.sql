-- Региональные ленты: состояние каждой ленты вместо таблиц seen / mv_seen / deal_seen / city_state.
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

-- Класс объявления для отчёта режима наблюдения: deal | low | high | nomed | flag (src/feeds.js, classOf).
ALTER TABLE items ADD COLUMN class TEXT;
