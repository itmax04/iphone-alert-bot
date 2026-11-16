-- Этап 5: «давно висящие» (16.11.2026). Перепроверка объявлений на 7-й, 10-й и 14-й день.
-- Применять ДО деплоя: runFeed пишет в items новые колонки.
ALTER TABLE items ADD COLUMN next_at INTEGER;     -- когда пора перепроверить; NULL — не кандидат / проверки закончены
ALTER TABLE items ADD COLUMN check_n INTEGER NOT NULL DEFAULT 0;  -- сколько перепроверок уже было
ALTER TABLE items ADD COLUMN cur_price REAL;      -- цена при последней перепроверке
ALTER TABLE items ADD COLUMN checked_at INTEGER;  -- время последней перепроверки
ALTER TABLE items ADD COLUMN gone INTEGER NOT NULL DEFAULT 0;     -- 1 — объявление снято
ALTER TABLE items ADD COLUMN top_price REAL;      -- цена, при которой объявление уже было в топе «давно висят»
ALTER TABLE items ADD COLUMN s_offer REAL;        -- «предложите X €» по итогам перепроверки (NULL — не подходит)
ALTER TABLE items ADD COLUMN s_pct REAL;          -- маржа к медиане при этой цене, %
CREATE INDEX IF NOT EXISTS items_next ON items(next_at) WHERE next_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS items_checked ON items(checked_at) WHERE checked_at IS NOT NULL;
